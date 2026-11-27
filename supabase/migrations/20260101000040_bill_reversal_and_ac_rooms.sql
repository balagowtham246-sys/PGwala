-- ============================================================================
-- Migration 40: Owner Bill Reversal RPCs & Room-Level AC / Non-AC (+₹500 Fee)
-- ============================================================================
-- 1. Adds rooms.is_ac (BOOLEAN DEFAULT false) and charges.ac_amount_paise (BIGINT DEFAULT 0)
-- 2. Ensures uq_charges_resident_month excludes cancelled charges so owners can
--    re-allocate EB or re-generate Rent cleanly after cancelling a mistaken bill
-- 3. Adds reverse_charge_payments(p_charge_id, p_reason) — reverses all active
--    payment allocations & payments for a Paid/Partial charge and reopens it
-- 4. Adds cancel_unpaid_charge(p_charge_id, p_reason) — cancels an unpaid charge
--    with zero active payments while preserving audit history
-- 5. Updates generate_monthly_bills, update_resident_rent, toggle_resident_wm_billing,
--    and get_owner_billing_summary to automatically include +₹500 AC fee for AC rooms

BEGIN;

-- 1. Schema additions
ALTER TABLE public.rooms
ADD COLUMN IF NOT EXISTS is_ac BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.charges
ADD COLUMN IF NOT EXISTS ac_amount_paise BIGINT NOT NULL DEFAULT 0 CHECK (ac_amount_paise >= 0);

-- Ensure cancelled bills do not block re-generation or re-allocation of corrected bills
DROP INDEX IF EXISTS public.uq_charges_resident_month;
CREATE UNIQUE INDEX uq_charges_resident_month
    ON public.charges (resident_id, category, billing_period_start)
    WHERE status != 'cancelled';

-- Helper: check if a resident's assigned room is marked AC (case/prefix normalized)
CREATE OR REPLACE FUNCTION public.is_room_ac(
    p_property_id UUID,
    p_room_number TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.rooms rm
        WHERE rm.property_id = p_property_id
          AND rm.is_ac = true
          AND lower(regexp_replace(pg_catalog.btrim(rm.room_number), '^(room|rm)\s+', '', 'i'))
            = lower(regexp_replace(pg_catalog.btrim(COALESCE(p_room_number, '')), '^(room|rm)\s+', '', 'i'))
    );
$$;

-- Helper: format consistent monthly bill description
CREATE OR REPLACE FUNCTION public.build_monthly_rent_description(
    p_month_label TEXT,
    p_rent_paise BIGINT,
    p_wm_paise BIGINT,
    p_ac_paise BIGINT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
    v_parts TEXT := 'Rent ₹' || (COALESCE(p_rent_paise, 0) / 100)::TEXT;
BEGIN
    IF COALESCE(p_wm_paise, 0) > 0 THEN
        v_parts := v_parts || ' + WM ₹' || (p_wm_paise / 100)::TEXT;
    END IF;
    IF COALESCE(p_ac_paise, 0) > 0 THEN
        v_parts := v_parts || ' + AC ₹' || (p_ac_paise / 100)::TEXT;
    END IF;
    IF COALESCE(p_wm_paise, 0) = 0 AND COALESCE(p_ac_paise, 0) = 0 THEN
        RETURN p_month_label || ' Bill (Room Rent ₹' || (COALESCE(p_rent_paise, 0) / 100)::TEXT || ')';
    END IF;
    RETURN p_month_label || ' Bill (' || v_parts || ')';
END;
$$;

-- 2. Owner RPC: reverse_charge_payments (handles full & partial payments atomically)
CREATE OR REPLACE FUNCTION public.reverse_charge_payments(
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
    v_reversed_allocs INT := 0;
    v_reversed_payments INT := 0;
    v_payment_ids UUID[];
    v_pid UUID;
BEGIN
    v_owner_id := (SELECT auth.uid());
    IF v_owner_id IS NULL OR NOT public.is_owner() THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Unauthorized: Only authenticated PG owners can reverse payments.'
        );
    END IF;

    v_clean_reason := NULLIF(pg_catalog.btrim(COALESCE(p_reason, '')), '');
    IF v_clean_reason IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Please provide a reason for reversing this payment.'
        );
    END IF;

    SELECT c.id, c.property_id, c.resident_id, c.status, c.category
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

    SELECT ARRAY_AGG(DISTINCT pa.payment_id)
    INTO v_payment_ids
    FROM public.payment_allocations pa
    WHERE pa.charge_id = p_charge_id
      AND pa.status = 'active';

    IF v_payment_ids IS NULL OR array_length(v_payment_ids, 1) IS NULL THEN
        IF v_charge.status = 'settled' THEN
            UPDATE public.charges
            SET status = 'outstanding', updated_at = pg_catalog.now()
            WHERE id = p_charge_id;
            RETURN pg_catalog.jsonb_build_object(
                'success', true,
                'reversed_allocations', 0,
                'reversed_payments', 0,
                'message', 'Bill reopened as unpaid.'
            );
        END IF;
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'No active payment found on this bill to reverse.'
        );
    END IF;

    -- Mark active allocations on this charge as reversed
    UPDATE public.payment_allocations
    SET status = 'reversed'
    WHERE charge_id = p_charge_id
      AND status = 'active';
    GET DIAGNOSTICS v_reversed_allocs = ROW_COUNT;

    -- Mark payments as reversed if they have no remaining active allocations
    FOREACH v_pid IN ARRAY v_payment_ids LOOP
        IF NOT EXISTS (
            SELECT 1 FROM public.payment_allocations pa
            WHERE pa.payment_id = v_pid AND pa.status = 'active'
        ) THEN
            UPDATE public.payments
            SET status = 'reversed',
                reversal_reason = v_clean_reason,
                reversed_at = pg_catalog.now(),
                reversed_by = v_owner_id,
                unallocated_amount_paise = 0,
                updated_at = pg_catalog.now()
            WHERE id = v_pid
              AND status != 'reversed';
            IF FOUND THEN
                v_reversed_payments := v_reversed_payments + 1;
            END IF;
        END IF;
    END LOOP;

    -- Reopen the charge as outstanding
    UPDATE public.charges
    SET status = 'outstanding',
        updated_at = pg_catalog.now()
    WHERE id = p_charge_id;

    -- Mark any previously approved payment proofs on this charge as rejected with reversal note
    UPDATE public.student_payment_reports
    SET status = 'rejected',
        rejection_reason = 'Payment reversed: ' || v_clean_reason,
        reviewed_by = v_owner_id,
        reviewed_at = pg_catalog.now()
    WHERE charge_id = p_charge_id
      AND status = 'approved';

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'reversed_allocations', v_reversed_allocs,
        'reversed_payments', v_reversed_payments,
        'message', 'Payment reversed and bill reopened as unpaid.'
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reverse_charge_payments(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_charge_payments(UUID, TEXT) TO authenticated;

-- 3. Owner RPC: cancel_unpaid_charge (audit-safe cancellation of mistaken unpaid bills)
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

    SELECT c.id, c.status, c.description
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

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'message', 'Unpaid bill cancelled.'
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_unpaid_charge(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_unpaid_charge(UUID, TEXT) TO authenticated;

-- 4. Update generate_monthly_bills to automatically include +₹500 AC fee for AC rooms
CREATE OR REPLACE FUNCTION public.generate_monthly_bills(
    p_property_id UUID,
    p_billing_month DATE,
    p_default_rent_paise BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner_id UUID;
    v_month_start DATE;
    v_month_end DATE;
    v_due_date DATE;
    v_month_label TEXT;
    v_resident RECORD;
    v_existing_charge RECORD;
    v_rent_paise BIGINT;
    v_wm_paise BIGINT;
    v_ac_paise BIGINT;
    v_total_paise BIGINT;
    v_wm_opted BOOLEAN;
    v_is_ac BOOLEAN;
    v_created_count INT := 0;
    v_updated_count INT := 0;
    v_skipped_count INT := 0;
    v_desc TEXT;
BEGIN
    v_owner_id := (SELECT auth.uid());
    IF v_owner_id IS NULL OR NOT public.is_owner() THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Unauthorized: Only authenticated PG owners can generate monthly bills.'
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

    v_month_start := pg_catalog.date_trunc('month', p_billing_month)::DATE;
    v_month_end := (pg_catalog.date_trunc('month', p_billing_month) + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
    v_due_date := (v_month_start + INTERVAL '4 days')::DATE;
    v_month_label := pg_catalog.to_char(v_month_start, 'FMMonth YYYY');

    FOR v_resident IN
        SELECT r.id, r.full_name, r.room_number, r.monthly_rent_paise
        FROM public.residents r
        WHERE r.property_id = p_property_id AND r.is_active = true
        ORDER BY r.room_number, r.full_name
    LOOP
        v_is_ac := public.is_room_ac(p_property_id, v_resident.room_number);
        v_ac_paise := CASE WHEN v_is_ac THEN 50000::BIGINT ELSE 0::BIGINT END;

        SELECT c.id, c.status, c.wm_amount_paise, c.rent_amount_paise, c.ac_amount_paise
        INTO v_existing_charge
        FROM public.charges c
        WHERE c.resident_id = v_resident.id
          AND c.billing_period_start = v_month_start
          AND c.category = 'rent'
          AND c.status != 'cancelled'
        LIMIT 1;

        IF FOUND THEN
            IF v_existing_charge.status = 'outstanding' AND p_default_rent_paise IS NOT NULL AND p_default_rent_paise > 0 THEN
                v_rent_paise := p_default_rent_paise;

                UPDATE public.residents
                SET monthly_rent_paise = v_rent_paise
                WHERE id = v_resident.id;

                SELECT COALESCE(opt.is_enabled, false)
                INTO v_wm_opted
                FROM public.resident_opt_ins opt
                WHERE opt.resident_id = v_resident.id
                  AND opt.feature_name = 'washing_machine'
                LIMIT 1;

                v_wm_paise := CASE WHEN v_wm_opted THEN 50000::BIGINT ELSE 0::BIGINT END;
                v_total_paise := v_rent_paise + v_wm_paise + v_ac_paise;
                v_desc := public.build_monthly_rent_description(v_month_label, v_rent_paise, v_wm_paise, v_ac_paise);

                UPDATE public.charges
                SET rent_amount_paise = v_rent_paise,
                    wm_amount_paise = v_wm_paise,
                    ac_amount_paise = v_ac_paise,
                    amount_paise = v_total_paise,
                    description = v_desc
                WHERE id = v_existing_charge.id;

                v_updated_count := v_updated_count + 1;
            ELSE
                v_skipped_count := v_skipped_count + 1;
            END IF;
            CONTINUE;
        END IF;

        v_rent_paise := COALESCE(p_default_rent_paise, v_resident.monthly_rent_paise, 800000::BIGINT);
        IF v_rent_paise <= 0 THEN
            v_rent_paise := 800000::BIGINT;
        END IF;

        IF p_default_rent_paise IS NOT NULL AND p_default_rent_paise > 0 THEN
            UPDATE public.residents
            SET monthly_rent_paise = v_rent_paise
            WHERE id = v_resident.id;
        END IF;

        SELECT COALESCE(opt.is_enabled, false)
        INTO v_wm_opted
        FROM public.resident_opt_ins opt
        WHERE opt.resident_id = v_resident.id
          AND opt.feature_name = 'washing_machine'
        LIMIT 1;

        v_wm_paise := CASE WHEN v_wm_opted THEN 50000::BIGINT ELSE 0::BIGINT END;
        v_total_paise := v_rent_paise + v_wm_paise + v_ac_paise;
        v_desc := public.build_monthly_rent_description(v_month_label, v_rent_paise, v_wm_paise, v_ac_paise);

        INSERT INTO public.charges (
            property_id,
            resident_id,
            category,
            description,
            billing_period_start,
            billing_period_end,
            due_date,
            amount_paise,
            rent_amount_paise,
            wm_amount_paise,
            ac_amount_paise,
            status,
            is_opening_balance
        ) VALUES (
            p_property_id,
            v_resident.id,
            'rent',
            v_desc,
            v_month_start,
            v_month_end,
            v_due_date,
            v_total_paise,
            v_rent_paise,
            v_wm_paise,
            v_ac_paise,
            'outstanding',
            false
        );

        v_created_count := v_created_count + 1;
    END LOOP;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'created_count', v_created_count,
        'updated_count', v_updated_count,
        'skipped_count', v_skipped_count,
        'billing_month', v_month_start,
        'month_label', v_month_label
    );
END;
$$;

-- 5. Update update_resident_rent to preserve ac_amount_paise
CREATE OR REPLACE FUNCTION public.update_resident_rent(
    p_property_id UUID,
    p_resident_id UUID,
    p_rent_paise BIGINT,
    p_billing_month DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner_id UUID;
    v_month_start DATE;
    v_month_label TEXT;
    v_wm_paise BIGINT;
    v_ac_paise BIGINT;
    v_total_paise BIGINT;
    v_desc TEXT;
    v_charge RECORD;
BEGIN
    v_owner_id := (SELECT auth.uid());
    IF v_owner_id IS NULL OR NOT public.is_owner() THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Unauthorized: Only authenticated PG owners can update rent.'
        );
    END IF;

    IF p_rent_paise <= 0 THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Rent amount must be greater than zero.'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.residents r
        JOIN public.properties p ON p.id = r.property_id
        WHERE r.id = p_resident_id
          AND r.property_id = p_property_id
          AND p.owner_id = v_owner_id
    ) THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Resident not found or you do not own this property.'
        );
    END IF;

    UPDATE public.residents
    SET monthly_rent_paise = p_rent_paise
    WHERE id = p_resident_id;

    IF p_billing_month IS NOT NULL THEN
        v_month_start := pg_catalog.date_trunc('month', p_billing_month)::DATE;
        v_month_label := pg_catalog.to_char(v_month_start, 'FMMonth YYYY');

        SELECT c.id, c.wm_amount_paise, c.ac_amount_paise, c.status
        INTO v_charge
        FROM public.charges c
        WHERE c.resident_id = p_resident_id
          AND c.billing_period_start = v_month_start
          AND c.category = 'rent'
          AND c.status != 'cancelled'
        LIMIT 1;

        IF FOUND AND v_charge.status = 'outstanding' THEN
            v_wm_paise := COALESCE(v_charge.wm_amount_paise, 0);
            v_ac_paise := COALESCE(v_charge.ac_amount_paise, 0);
            v_total_paise := p_rent_paise + v_wm_paise + v_ac_paise;
            v_desc := public.build_monthly_rent_description(v_month_label, p_rent_paise, v_wm_paise, v_ac_paise);

            UPDATE public.charges
            SET rent_amount_paise = p_rent_paise,
                amount_paise = v_total_paise,
                description = v_desc
            WHERE id = v_charge.id;
        END IF;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'resident_id', p_resident_id,
        'monthly_rent_paise', p_rent_paise
    );
END;
$$;

-- 6. Update toggle_resident_wm_billing to preserve ac_amount_paise
CREATE OR REPLACE FUNCTION public.toggle_resident_wm_billing(
    p_property_id UUID,
    p_resident_id UUID,
    p_is_enabled BOOLEAN,
    p_billing_month DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner_id UUID;
    v_month_start DATE;
    v_month_label TEXT;
    v_rent_paise BIGINT;
    v_wm_paise BIGINT;
    v_ac_paise BIGINT;
    v_total_paise BIGINT;
    v_desc TEXT;
    v_charge RECORD;
BEGIN
    v_owner_id := (SELECT auth.uid());
    IF v_owner_id IS NULL OR NOT public.is_owner() THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Unauthorized: Only authenticated PG owners can update washing machine settings.'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.residents r
        JOIN public.properties p ON p.id = r.property_id
        WHERE r.id = p_resident_id
          AND r.property_id = p_property_id
          AND p.owner_id = v_owner_id
    ) THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Resident not found or you do not own this property.'
        );
    END IF;

    INSERT INTO public.resident_opt_ins (resident_id, feature_name, is_enabled, effective_from_date)
    VALUES (p_resident_id, 'washing_machine', p_is_enabled, CURRENT_DATE)
    ON CONFLICT (resident_id, feature_name)
    DO UPDATE SET is_enabled = p_is_enabled;

    IF p_is_enabled THEN
        UPDATE public.washing_machine_requests
        SET status = 'accepted', updated_at = now()
        WHERE property_id = p_property_id AND resident_id = p_resident_id AND status = 'pending';
    END IF;

    IF p_billing_month IS NOT NULL THEN
        v_month_start := pg_catalog.date_trunc('month', p_billing_month)::DATE;
        v_month_label := pg_catalog.to_char(v_month_start, 'FMMonth YYYY');

        SELECT c.id, c.rent_amount_paise, c.ac_amount_paise, c.status
        INTO v_charge
        FROM public.charges c
        WHERE c.resident_id = p_resident_id
          AND c.billing_period_start = v_month_start
          AND c.category = 'rent'
          AND c.status != 'cancelled'
        LIMIT 1;

        IF FOUND AND v_charge.status = 'outstanding' THEN
            v_rent_paise := COALESCE(v_charge.rent_amount_paise, 800000::BIGINT);
            v_wm_paise := CASE WHEN p_is_enabled THEN 50000::BIGINT ELSE 0::BIGINT END;
            v_ac_paise := COALESCE(v_charge.ac_amount_paise, 0);
            v_total_paise := v_rent_paise + v_wm_paise + v_ac_paise;
            v_desc := public.build_monthly_rent_description(v_month_label, v_rent_paise, v_wm_paise, v_ac_paise);

            UPDATE public.charges
            SET wm_amount_paise = v_wm_paise,
                amount_paise = v_total_paise,
                description = v_desc
            WHERE id = v_charge.id;
        END IF;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'resident_id', p_resident_id,
        'is_enabled', p_is_enabled
    );
END;
$$;

-- 7. Update get_owner_billing_summary to include is_ac, ac_amount_paise, and exclude cancelled charges
CREATE OR REPLACE FUNCTION public.get_owner_billing_summary(
    p_property_id UUID DEFAULT NULL,
    p_billing_month DATE DEFAULT date_trunc('month', CURRENT_DATE)::DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = ''
AS $$
DECLARE
    v_uid UUID;
    v_property RECORD;
    v_residents JSONB;
    v_opt_ins JSONB;
    v_wm_pending_requests JSONB;
    v_charges JSONB;
    v_reports JSONB;
    v_payment_allocations JSONB;
BEGIN
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthenticated.');
    END IF;

    IF p_property_id IS NOT NULL THEN
        SELECT p.id, p.name
        INTO v_property
        FROM public.properties p
        WHERE p.id = p_property_id;

        IF v_property.id IS NULL THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Unauthorized: You do not own this property.'
            );
        END IF;
    ELSE
        SELECT p.id, p.name
        INTO v_property
        FROM public.properties p
        WHERE p.owner_id = v_uid
          AND p.is_active = true
        LIMIT 1;

        IF v_property.id IS NULL THEN
            RETURN jsonb_build_object(
                'success', true,
                'property', NULL,
                'residents', '[]'::jsonb,
                'opt_ins', '[]'::jsonb,
                'wm_pending_requests', '[]'::jsonb,
                'charges', '[]'::jsonb,
                'reports', '[]'::jsonb,
                'payment_allocations', '[]'::jsonb
            );
        END IF;
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', r.id,
            'full_name', r.full_name,
            'room_number', r.room_number,
            'phone_number', r.phone_number,
            'monthly_rent_paise', r.monthly_rent_paise,
            'is_active', r.is_active,
            'is_ac', public.is_room_ac(v_property.id, r.room_number)
        ) ORDER BY r.room_number ASC
    ), '[]'::jsonb)
    INTO v_residents
    FROM public.residents r
    WHERE r.property_id = v_property.id
      AND r.is_active = true;

    IF jsonb_array_length(v_residents) = 0 THEN
        RETURN jsonb_build_object(
            'success', true,
            'property', jsonb_build_object('id', v_property.id, 'name', v_property.name),
            'residents', '[]'::jsonb,
            'opt_ins', '[]'::jsonb,
            'wm_pending_requests', '[]'::jsonb,
            'charges', '[]'::jsonb,
            'reports', '[]'::jsonb,
            'payment_allocations', '[]'::jsonb
        );
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'resident_id', oi.resident_id,
            'is_enabled', oi.is_enabled
        )
    ), '[]'::jsonb)
    INTO v_opt_ins
    FROM public.resident_opt_ins oi
    JOIN public.residents r ON r.id = oi.resident_id
    WHERE oi.feature_name = 'washing_machine'
      AND r.property_id = v_property.id
      AND r.is_active = true;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object('resident_id', wmr.resident_id)
    ), '[]'::jsonb)
    INTO v_wm_pending_requests
    FROM public.washing_machine_requests wmr
    WHERE wmr.property_id = v_property.id
      AND wmr.status = 'pending';

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', c.id,
            'resident_id', c.resident_id,
            'category', c.category,
            'amount_paise', c.amount_paise,
            'rent_amount_paise', c.rent_amount_paise,
            'wm_amount_paise', c.wm_amount_paise,
            'ac_amount_paise', COALESCE(c.ac_amount_paise, 0),
            'status', c.status,
            'due_date', c.due_date
        )
    ), '[]'::jsonb)
    INTO v_charges
    FROM public.charges c
    WHERE c.property_id = v_property.id
      AND c.billing_period_start = p_billing_month
      AND c.status != 'cancelled';

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', spr.id,
            'resident_id', spr.resident_id,
            'charge_id', spr.charge_id,
            'amount_paise', spr.amount_paise,
            'claimed_method', spr.claimed_method,
            'payment_date', spr.payment_date,
            'reference_number', spr.reference_number,
            'screenshot_url', spr.screenshot_url,
            'notes', spr.notes,
            'status', spr.status,
            'rejection_reason', spr.rejection_reason,
            'normalized_utr', spr.normalized_utr,
            'screenshot_sha256', spr.screenshot_sha256,
            'ai_extracted_data', spr.ai_extracted_data,
            'verification_status', spr.verification_status,
            'verification_warnings', spr.verification_warnings
        ) ORDER BY spr.created_at DESC
    ), '[]'::jsonb)
    INTO v_reports
    FROM public.student_payment_reports spr
    WHERE spr.property_id = v_property.id
      AND spr.status IN ('pending', 'rejected');

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'charge_id', pa.charge_id,
            'settled_amount_paise', pa.settled_amount_paise,
            'payment', jsonb_build_object(
                'id', p.id,
                'receipt_number', p.receipt_number,
                'payment_date', p.payment_date,
                'method', p.method
            )
        ) ORDER BY pa.created_at ASC
    ), '[]'::jsonb)
    INTO v_payment_allocations
    FROM public.payment_allocations pa
    JOIN public.payments p ON p.id = pa.payment_id
    JOIN public.charges c ON c.id = pa.charge_id
    WHERE c.property_id = v_property.id
      AND c.billing_period_start = p_billing_month
      AND c.status IN ('settled', 'outstanding')
      AND pa.status = 'active';

    RETURN jsonb_build_object(
        'success', true,
        'property', jsonb_build_object('id', v_property.id, 'name', v_property.name),
        'residents', v_residents,
        'opt_ins', v_opt_ins,
        'wm_pending_requests', v_wm_pending_requests,
        'charges', v_charges,
        'reports', v_reports,
        'payment_allocations', v_payment_allocations
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_owner_billing_summary(UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_owner_billing_summary(UUID, DATE) TO authenticated;

COMMIT;
