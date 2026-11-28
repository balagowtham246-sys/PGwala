-- ============================================================================
-- Migration 42: Allow Re-Allocating Room EB Bills After Cancelling Unpaid EB
-- ============================================================================
-- 1. Adds is_cancelled BOOLEAN DEFAULT false to public.eb_room_bills so audit
--    history is preserved while cancelled room EB bills no longer block
--    re-splitting a corrected EB bill for the same room & billing period.
-- 2. Replaces uq_idx_eb_room_bills_room_period with a partial unique index
--    (WHERE is_cancelled = false) and backfills any already-cancelled EB bills.
-- 3. Updates cancel_unpaid_charge to mark the parent eb_room_bills row as
--    is_cancelled = true once all its allocated charges are cancelled.
-- 4. Updates allocate_eb_bill to ignore cancelled eb_room_bills rows.

BEGIN;

-- 1. Add is_cancelled column to eb_room_bills
ALTER TABLE public.eb_room_bills
ADD COLUMN IF NOT EXISTS is_cancelled BOOLEAN NOT NULL DEFAULT false;

-- 2. Backfill any existing eb_room_bills whose allocated charges are all cancelled
UPDATE public.eb_room_bills erb
SET is_cancelled = true,
    updated_at = pg_catalog.now()
WHERE erb.is_cancelled = false
  AND NOT EXISTS (
      SELECT 1
      FROM public.eb_allocations ea
      JOIN public.charges c ON c.id = ea.charge_id
      WHERE ea.eb_room_bill_id = erb.id
        AND c.status != 'cancelled'
  );

-- 3. Replace unique index with partial unique index excluding cancelled room EB bills
DROP INDEX IF EXISTS public.uq_idx_eb_room_bills_room_period;
CREATE UNIQUE INDEX uq_idx_eb_room_bills_room_period
    ON public.eb_room_bills (property_id, room_number, period_start, period_end)
    WHERE is_cancelled = false;

-- 4. Update cancel_unpaid_charge to also mark parent eb_room_bills cancelled when all shares are cancelled
CREATE OR REPLACE FUNCTION public.cancel_unpaid_charge(
    p_charge_id UUID,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner_id UUID;
    v_charge RECORD;
    v_clean_reason TEXT;
BEGIN
    v_owner_id := (SELECT auth.uid());
    IF v_owner_id IS NULL OR NOT public.is_owner() THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Unauthorized: Only authenticated PG owners can cancel bills.'
        );
    END IF;

    v_clean_reason := NULLIF(pg_catalog.btrim(COALESCE(p_reason, '')), '');
    IF v_clean_reason IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Please provide a reason for cancelling this bill.'
        );
    END IF;

    SELECT c.id, c.status, c.category, c.description
    INTO v_charge
    FROM public.charges c
    JOIN public.properties p ON p.id = c.property_id
    WHERE c.id = p_charge_id
      AND p.owner_id = v_owner_id
      AND p.is_active = true
    FOR UPDATE OF c;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Bill not found or you do not own this property.'
        );
    END IF;

    IF v_charge.status = 'cancelled' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'This bill is already cancelled.'
        );
    END IF;

    IF v_charge.status = 'settled' OR EXISTS (
        SELECT 1 FROM public.payment_allocations pa
        WHERE pa.charge_id = p_charge_id AND pa.status = 'active'
    ) THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Reverse the recorded payment first before cancelling this bill.'
        );
    END IF;

    UPDATE public.charges
    SET status = 'cancelled',
        description = COALESCE(v_charge.description, 'Bill') || ' [Cancelled: ' || v_clean_reason || ']',
        updated_at = pg_catalog.now()
    WHERE id = p_charge_id;

    UPDATE public.student_payment_reports
    SET status = 'rejected',
        rejection_reason = 'Bill cancelled: ' || v_clean_reason,
        reviewed_by = v_owner_id,
        reviewed_at = pg_catalog.now()
    WHERE charge_id = p_charge_id
      AND status = 'pending';

    -- If this was an EB charge and all allocated charges for its room EB bill are now cancelled,
    -- mark the parent eb_room_bills header cancelled so the owner can re-allocate a corrected EB bill.
    IF v_charge.category = 'electricity' THEN
        UPDATE public.eb_room_bills erb
        SET is_cancelled = true,
            updated_at = pg_catalog.now()
        WHERE erb.is_cancelled = false
          AND erb.id IN (
              SELECT ea.eb_room_bill_id
              FROM public.eb_allocations ea
              WHERE ea.charge_id = p_charge_id
          )
          AND NOT EXISTS (
              SELECT 1
              FROM public.eb_allocations ea2
              JOIN public.charges c2 ON c2.id = ea2.charge_id
              WHERE ea2.eb_room_bill_id = erb.id
                AND c2.status != 'cancelled'
          );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'message', 'Unpaid bill cancelled.'
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_unpaid_charge(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_unpaid_charge(UUID, TEXT) TO authenticated;
ALTER FUNCTION public.cancel_unpaid_charge(UUID, TEXT) OWNER TO postgres;

-- 5. Update allocate_eb_bill to ignore cancelled eb_room_bills
CREATE OR REPLACE FUNCTION public.allocate_eb_bill(
    p_property_id UUID,
    p_room_number TEXT,
    p_period_start DATE,
    p_period_end DATE,
    p_due_date DATE,
    p_total_amount_paise BIGINT,
    p_resident_ids UUID[],
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner_id UUID;
    v_bill_id UUID;
    v_resident_count INT;
    v_base_rupees BIGINT;
    v_remainder_rupees BIGINT;
    v_share_paise BIGINT;
    v_idx INT := 0;
    v_resident RECORD;
    v_charge_id UUID;
    v_total_allocated BIGINT := 0;
BEGIN
    v_owner_id := (SELECT auth.uid());
    IF v_owner_id IS NULL OR NOT public.is_owner() THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Unauthorized: Only authenticated PG owners can allocate EB bills.'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.properties p
        WHERE p.id = p_property_id AND p.owner_id = v_owner_id AND p.is_active = true
    ) THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Property not found or you do not own this property.'
        );
    END IF;

    IF p_total_amount_paise <= 0 OR (p_total_amount_paise % 100 != 0) THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'EB bill total amount must be a positive whole rupee amount without fractional paise.'
        );
    END IF;

    v_resident_count := pg_catalog.array_length(p_resident_ids, 1);
    IF v_resident_count IS NULL OR v_resident_count = 0 THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'At least one resident must be selected for EB bill allocation.'
        );
    END IF;

    IF (SELECT COUNT(*) FROM pg_catalog.unnest(p_resident_ids)) != (SELECT COUNT(DISTINCT r_id) FROM pg_catalog.unnest(p_resident_ids) r_id) THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Duplicate resident IDs found in the allocation list.'
        );
    END IF;

    IF p_total_amount_paise < (v_resident_count * 100) THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Total EB bill amount (₹' || (p_total_amount_paise / 100) || ') must be at least ₹' || v_resident_count || ' to allocate at least ₹1 to each of the ' || v_resident_count || ' residents.'
        );
    END IF;

    -- Check for active (non-cancelled) duplicate EB bill for this property, room, and period
    IF EXISTS (
        SELECT 1 FROM public.eb_room_bills
        WHERE property_id = p_property_id
          AND room_number = p_room_number
          AND period_start = p_period_start
          AND period_end = p_period_end
          AND is_cancelled = false
    ) THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'An electricity bill for room ' || p_room_number || ' covering this exact period (' || pg_catalog.to_char(p_period_start, 'DD Mon YYYY') || ' to ' || pg_catalog.to_char(p_period_end, 'DD Mon YYYY') || ') has already been recorded.'
        );
    END IF;

    v_base_rupees := (p_total_amount_paise / (v_resident_count * 100));
    v_remainder_rupees := (p_total_amount_paise / 100) - (v_base_rupees * v_resident_count);

    INSERT INTO public.eb_room_bills (
        property_id,
        room_number,
        period_start,
        period_end,
        due_date,
        total_amount_paise,
        notes,
        created_by,
        is_cancelled
    ) VALUES (
        p_property_id,
        p_room_number,
        p_period_start,
        p_period_end,
        p_due_date,
        p_total_amount_paise,
        p_notes,
        v_owner_id,
        false
    ) RETURNING id INTO v_bill_id;

    FOR v_resident IN
        SELECT r.id, r.full_name, r.room_number
        FROM public.residents r
        WHERE r.id = ANY(p_resident_ids)
          AND r.property_id = p_property_id
          AND r.room_number = p_room_number
          AND r.is_active = true
        ORDER BY pg_catalog.lower(r.full_name) ASC, r.id ASC
    LOOP
        v_idx := v_idx + 1;

        IF v_idx <= v_remainder_rupees THEN
            v_share_paise := (v_base_rupees + 1) * 100;
        ELSE
            v_share_paise := v_base_rupees * 100;
        END IF;

        INSERT INTO public.charges (
            property_id,
            resident_id,
            category,
            description,
            billing_period_start,
            billing_period_end,
            due_date,
            amount_paise,
            status,
            is_opening_balance,
            reference_note
        ) VALUES (
            p_property_id,
            v_resident.id,
            'electricity',
            'EB Bill (Room ' || p_room_number || ') ' || pg_catalog.to_char(p_period_start, 'DD Mon') || ' - ' || pg_catalog.to_char(p_period_end, 'DD Mon YYYY'),
            p_period_start,
            p_period_end,
            p_due_date,
            v_share_paise,
            'outstanding',
            false,
            p_notes
        ) RETURNING id INTO v_charge_id;

        INSERT INTO public.eb_allocations (
            eb_room_bill_id,
            resident_id,
            charge_id,
            allocated_amount_paise,
            resident_name_snapshot,
            room_number_snapshot
        ) VALUES (
            v_bill_id,
            v_resident.id,
            v_charge_id,
            v_share_paise,
            v_resident.full_name,
            v_resident.room_number
        );

        v_total_allocated := v_total_allocated + v_share_paise;
    END LOOP;

    IF v_idx != v_resident_count THEN
        RAISE EXCEPTION 'Validation failure: Expected % valid room residents but matched %.', v_resident_count, v_idx;
    END IF;

    IF v_total_allocated != p_total_amount_paise THEN
        RAISE EXCEPTION 'Integrity error: Allocated total (%) does not match bill total (%).', v_total_allocated, p_total_amount_paise;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'eb_room_bill_id', v_bill_id,
        'allocated_count', v_idx,
        'total_allocated_paise', v_total_allocated
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.allocate_eb_bill(UUID, TEXT, DATE, DATE, DATE, BIGINT, UUID[], TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_eb_bill(UUID, TEXT, DATE, DATE, DATE, BIGINT, UUID[], TEXT) TO authenticated;
ALTER FUNCTION public.allocate_eb_bill(UUID, TEXT, DATE, DATE, DATE, BIGINT, UUID[], TEXT) OWNER TO postgres;

COMMIT;
