-- ==============================================================================
-- PGwala Phase 1: Partial Rent / Advance Payments & Property Expenses
-- File: supabase/migrations/20260101000034_phase1_partial_payments_and_expenses.sql
--
-- Includes:
--   1. Multi-installment active payment_allocations index (charge_id, payment_id)
--   2. record_partial_payment() RPC supporting partial, full, and advance credit
--   3. confirm_monthly_payment() updated to settle remaining balance accurately
--   4. get_owner_billing_summary() & get_student_billing_summary() return
--      settled_amount_paise for both settled and partially-paid outstanding charges
--   5. get_owner_dashboard_summary() & get_residents_directory_summary() account
--      for partial allocations in collected rent & pending dues
--   6. public.property_expenses table with strict owner-scoped RLS
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Allow multiple active partial payment allocations per charge
-- ------------------------------------------------------------------------------
DROP INDEX IF EXISTS public.uq_idx_payment_allocations_active_charge;

CREATE UNIQUE INDEX IF NOT EXISTS uq_idx_payment_allocations_active_charge_payment
    ON public.payment_allocations (charge_id, payment_id)
    WHERE status = 'active';

-- ------------------------------------------------------------------------------
-- 2. Partial & Advance Payment Recording RPC
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_partial_payment(
    p_charge_id UUID,
    p_amount_paise BIGINT,
    p_method TEXT DEFAULT 'cash',
    p_notes TEXT DEFAULT NULL,
    p_report_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner_id UUID;
    v_charge RECORD;
    v_already_paid BIGINT := 0;
    v_remaining BIGINT := 0;
    v_alloc_paise BIGINT := 0;
    v_advance_paise BIGINT := 0;
    v_total_paid BIGINT := 0;
    v_is_fully_settled BOOLEAN := false;
    v_payment_method public.billing_payment_method;
    v_receipt_no TEXT;
    v_payment_id UUID;
BEGIN
    v_owner_id := auth.uid();
    IF v_owner_id IS NULL OR NOT public.is_owner() THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Unauthorized: Only PG owners can record payments.'
        );
    END IF;

    IF p_amount_paise IS NULL OR p_amount_paise <= 0 THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Payment amount must be greater than zero.'
        );
    END IF;

    SELECT c.id, c.property_id, c.resident_id, c.amount_paise, c.status, c.billing_period_start
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

    IF v_charge.status = 'settled' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'This bill has already been settled in full.'
        );
    END IF;

    SELECT COALESCE(SUM(pa.settled_amount_paise), 0)::BIGINT
    INTO v_already_paid
    FROM public.payment_allocations pa
    WHERE pa.charge_id = v_charge.id
      AND pa.status = 'active';

    v_remaining := GREATEST(0, v_charge.amount_paise - v_already_paid);
    IF v_remaining <= 0 THEN
        UPDATE public.charges SET status = 'settled', updated_at = pg_catalog.now() WHERE id = v_charge.id;
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'This bill has no remaining balance.'
        );
    END IF;

    v_alloc_paise := LEAST(p_amount_paise, v_remaining);
    v_advance_paise := GREATEST(0, p_amount_paise - v_remaining);
    v_total_paid := v_already_paid + v_alloc_paise;
    v_is_fully_settled := v_total_paid >= v_charge.amount_paise;

    IF lower(COALESCE(p_method, 'cash')) = 'upi' THEN
        v_payment_method := 'upi'::public.billing_payment_method;
    ELSE
        v_payment_method := 'cash'::public.billing_payment_method;
    END IF;

    v_receipt_no := 'RCT-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMM') || '-' ||
                    pg_catalog.lpad(pg_catalog.nextval('public.receipt_number_seq')::TEXT, 4, '0');

    INSERT INTO public.payments (
        property_id,
        resident_id,
        receipt_number,
        amount_paise,
        unallocated_amount_paise,
        method,
        payment_date,
        status,
        recorded_by,
        notes
    ) VALUES (
        v_charge.property_id,
        v_charge.resident_id,
        v_receipt_no,
        p_amount_paise,
        v_advance_paise,
        v_payment_method,
        CURRENT_DATE,
        'approved',
        v_owner_id,
        COALESCE(
            NULLIF(pg_catalog.btrim(p_notes), ''),
            CASE WHEN v_is_fully_settled THEN 'Monthly bill payment confirmed' ELSE 'Partial payment received' END
        )
    ) RETURNING id INTO v_payment_id;

    INSERT INTO public.payment_allocations (
        charge_id,
        payment_id,
        settled_amount_paise,
        status
    ) VALUES (
        v_charge.id,
        v_payment_id,
        v_alloc_paise,
        'active'
    );

    IF v_is_fully_settled THEN
        UPDATE public.charges
        SET status = 'settled',
            updated_at = pg_catalog.now()
        WHERE id = v_charge.id;

        UPDATE public.student_payment_reports
        SET status = 'approved',
            reviewed_by = v_owner_id,
            reviewed_at = pg_catalog.now(),
            updated_at = pg_catalog.now()
        WHERE (p_report_id IS NOT NULL AND id = p_report_id)
           OR (charge_id = v_charge.id AND status = 'pending');
    ELSIF p_report_id IS NOT NULL THEN
        UPDATE public.student_payment_reports
        SET status = 'approved',
            reviewed_by = v_owner_id,
            reviewed_at = pg_catalog.now(),
            updated_at = pg_catalog.now()
        WHERE id = p_report_id;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'receipt_number', v_receipt_no,
        'charge_id', v_charge.id,
        'payment_id', v_payment_id,
        'allocated_paise', v_alloc_paise,
        'unallocated_paise', v_advance_paise,
        'total_paid_paise', v_total_paid,
        'remaining_paise', GREATEST(0, v_charge.amount_paise - v_total_paid),
        'is_fully_settled', v_is_fully_settled
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_partial_payment(UUID, BIGINT, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_partial_payment(UUID, BIGINT, TEXT, TEXT, UUID) TO authenticated;
ALTER FUNCTION public.record_partial_payment(UUID, BIGINT, TEXT, TEXT, UUID) OWNER TO postgres;

-- ------------------------------------------------------------------------------
-- 3. Update confirm_monthly_payment to settle only the remaining balance
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_monthly_payment(
    p_charge_id UUID,
    p_report_id UUID DEFAULT NULL,
    p_method TEXT DEFAULT 'upi',
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner_id UUID;
    v_charge RECORD;
    v_already_paid BIGINT := 0;
    v_remaining BIGINT := 0;
BEGIN
    v_owner_id := auth.uid();
    IF v_owner_id IS NULL OR NOT public.is_owner() THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Unauthorized: Only PG owners can confirm payments.'
        );
    END IF;

    SELECT c.id, c.amount_paise, c.status
    INTO v_charge
    FROM public.charges c
    JOIN public.properties p ON p.id = c.property_id
    WHERE c.id = p_charge_id
      AND p.owner_id = v_owner_id
      AND p.is_active = true;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Bill not found or you do not own this property.'
        );
    END IF;

    IF v_charge.status = 'settled' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'This bill has already been confirmed as Paid.'
        );
    END IF;

    SELECT COALESCE(SUM(pa.settled_amount_paise), 0)::BIGINT
    INTO v_already_paid
    FROM public.payment_allocations pa
    WHERE pa.charge_id = v_charge.id
      AND pa.status = 'active';

    v_remaining := GREATEST(1, v_charge.amount_paise - v_already_paid);

    RETURN public.record_partial_payment(
        p_charge_id,
        v_remaining,
        p_method,
        COALESCE(p_notes, 'Monthly bill payment confirmed'),
        p_report_id
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.confirm_monthly_payment(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_monthly_payment(UUID, UUID, TEXT, TEXT) TO authenticated;
ALTER FUNCTION public.confirm_monthly_payment(UUID, UUID, TEXT, TEXT) OWNER TO postgres;

-- ------------------------------------------------------------------------------
-- 4. Update get_owner_billing_summary to include settled_amount_paise & partial allocations
-- ------------------------------------------------------------------------------
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
            'is_active', r.is_active
        ) ORDER BY r.room_number ASC
    ), '[]'::jsonb)
    INTO v_residents
    FROM public.residents r
    WHERE r.property_id = v_property.id
      AND r.is_active = true;

    IF jsonb_array_length(v_residents) = 0 THEN
        RETURN jsonb_build_object(
            'success', true,
            'property', jsonb_build_object(
                'id', v_property.id,
                'name', v_property.name
            ),
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
            'status', c.status,
            'due_date', c.due_date
        )
    ), '[]'::jsonb)
    INTO v_charges
    FROM public.charges c
    WHERE c.property_id = v_property.id
      AND c.billing_period_start = p_billing_month;

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

    -- Include ALL active payment allocations (for both settled and partially-paid outstanding charges)
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
        'property', jsonb_build_object(
            'id', v_property.id,
            'name', v_property.name
        ),
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
ALTER FUNCTION public.get_owner_billing_summary(UUID, DATE) OWNER TO postgres;

-- ------------------------------------------------------------------------------
-- 5. Update get_residents_directory_summary to subtract partial payments from dues
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_residents_directory_summary(
    p_property_id UUID
)
RETURNS TABLE (
    id UUID,
    property_id UUID,
    full_name TEXT,
    room_number TEXT,
    bed_label TEXT,
    phone_number TEXT,
    gender TEXT,
    joining_date DATE,
    monthly_rent_paise BIGINT,
    deposit_paise INTEGER,
    is_active BOOLEAN,
    updated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    gate_status TEXT,
    last_gate_event_time TIMESTAMPTZ,
    pending_dues_paise BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
    WITH latest_gate AS (
        SELECT DISTINCT ON (ml.resident_id)
            ml.resident_id,
            ml.direction::TEXT AS direction,
            ml.event_time
        FROM public.movement_logs ml
        WHERE ml.property_id = p_property_id
        ORDER BY ml.resident_id, ml.event_time DESC
    ),
    charge_allocs AS (
        SELECT
            pa.charge_id,
            COALESCE(SUM(pa.settled_amount_paise), 0)::BIGINT AS paid_paise
        FROM public.payment_allocations pa
        WHERE pa.status = 'active'
        GROUP BY pa.charge_id
    ),
    unpaid_dues AS (
        SELECT
            c.resident_id,
            COALESCE(
                SUM(GREATEST(0, c.amount_paise - COALESCE(ca.paid_paise, 0))),
                0
            )::BIGINT AS total_due_paise
        FROM public.charges c
        LEFT JOIN charge_allocs ca ON ca.charge_id = c.id
        WHERE c.property_id = p_property_id
          AND c.status::TEXT NOT IN ('settled', 'voided', 'paid', 'cancelled')
        GROUP BY c.resident_id
    )
    SELECT
        r.id,
        r.property_id,
        r.full_name,
        r.room_number,
        r.bed_label,
        r.phone_number,
        r.gender,
        r.joining_date,
        COALESCE(r.monthly_rent_paise, 0)::BIGINT AS monthly_rent_paise,
        COALESCE(r.deposit_paise, 0)::INTEGER AS deposit_paise,
        r.is_active,
        r.updated_at,
        r.created_at,
        COALESCE(lg.direction, 'IN') AS gate_status,
        lg.event_time AS last_gate_event_time,
        COALESCE(ud.total_due_paise, 0)::BIGINT AS pending_dues_paise
    FROM public.residents r
    JOIN public.properties p ON p.id = r.property_id
    LEFT JOIN latest_gate lg ON lg.resident_id = r.id
    LEFT JOIN unpaid_dues ud ON ud.resident_id = r.id
    WHERE r.property_id = p_property_id
      AND r.is_active = true
      AND (
          (p.owner_id = (SELECT auth.uid()) AND public.is_owner())
          OR EXISTS (
              SELECT 1
              FROM public.property_wardens pw
              WHERE pw.property_id = p.id
                AND pw.warden_profile_id = (SELECT auth.uid())
                AND pw.is_active = true
          )
      )
    ORDER BY r.room_number ASC, r.full_name ASC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_residents_directory_summary(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_residents_directory_summary(UUID) TO authenticated;
ALTER FUNCTION public.get_residents_directory_summary(UUID) OWNER TO postgres;

-- ------------------------------------------------------------------------------
-- 6. Property Expenses Table (Simple Expense & Net Profit Tracker)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.property_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK (
        category IN ('salary', 'electricity', 'water', 'grocery', 'maintenance', 'wifi', 'other')
    ),
    amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
    expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_property_expenses_prop_date
    ON public.property_expenses (property_id, expense_date DESC);

ALTER TABLE public.property_expenses ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.property_expenses TO authenticated;

DROP POLICY IF EXISTS "owners_select_property_expenses" ON public.property_expenses;
CREATE POLICY "owners_select_property_expenses"
    ON public.property_expenses
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.properties p
            WHERE p.id = property_expenses.property_id
              AND p.owner_id = (SELECT auth.uid())
              AND public.is_owner()
        )
    );

DROP POLICY IF EXISTS "owners_insert_property_expenses" ON public.property_expenses;
CREATE POLICY "owners_insert_property_expenses"
    ON public.property_expenses
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.properties p
            WHERE p.id = property_expenses.property_id
              AND p.owner_id = (SELECT auth.uid())
              AND public.is_owner()
        )
    );

DROP POLICY IF EXISTS "owners_delete_property_expenses" ON public.property_expenses;
CREATE POLICY "owners_delete_property_expenses"
    ON public.property_expenses
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.properties p
            WHERE p.id = property_expenses.property_id
              AND p.owner_id = (SELECT auth.uid())
              AND public.is_owner()
        )
    );

COMMIT;
