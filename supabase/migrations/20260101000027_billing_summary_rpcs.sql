-- ==============================================================================
-- PGwala Single-Roundtrip Billing Summary RPCs (Prompt 3)
-- File: supabase/migrations/20260101000027_billing_summary_rpcs.sql
--
-- Goals (zero behavioral change):
--   1. Collapse Owner Billing multi-query waterfall (properties -> residents ->
--      [resident_opt_ins, washing_machine_requests, charges, student_payment_reports]
--      -> payment_allocations + payments) into a single RPC:
--      public.get_owner_billing_summary(p_property_id, p_billing_month).
--   2. Collapse Student Billing multi-query waterfall (residents -> [charges,
--      student_payment_reports, properties] -> payment_allocations + payments)
--      into a single RPC:
--      public.get_student_billing_summary(p_resident_id).
--   3. Both functions use SECURITY INVOKER with SET search_path = '' so every
--      underlying table continues to enforce existing Row Level Security (RLS)
--      policies for the authenticated caller.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Owner Billing Summary RPC (SECURITY INVOKER)
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

    -- Resolve target property (existing RLS on public.properties enforces owner_id = auth.uid() AND is_owner())
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

    -- 1. Active residents for the property (ordered by room_number ASC)
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

    -- Short-circuit when the property has no active residents
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

    -- 2. Washing machine opt-ins for active residents of the property
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

    -- 3. Pending washing machine requests for the property
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object('resident_id', wmr.resident_id)
    ), '[]'::jsonb)
    INTO v_wm_pending_requests
    FROM public.washing_machine_requests wmr
    WHERE wmr.property_id = v_property.id
      AND wmr.status = 'pending';

    -- 4. Charges for the selected billing month
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

    -- 5. Pending and rejected payment reports (newest first)
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
            'rejection_reason', spr.rejection_reason
        ) ORDER BY spr.created_at DESC
    ), '[]'::jsonb)
    INTO v_reports
    FROM public.student_payment_reports spr
    WHERE spr.property_id = v_property.id
      AND spr.status IN ('pending', 'rejected');

    -- 6. Active payment allocations & receipt metadata for settled charges in this month
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'charge_id', pa.charge_id,
            'payment', jsonb_build_object(
                'id', p.id,
                'receipt_number', p.receipt_number,
                'payment_date', p.payment_date,
                'method', p.method
            )
        )
    ), '[]'::jsonb)
    INTO v_payment_allocations
    FROM public.payment_allocations pa
    JOIN public.payments p ON p.id = pa.payment_id
    JOIN public.charges c ON c.id = pa.charge_id
    WHERE c.property_id = v_property.id
      AND c.billing_period_start = p_billing_month
      AND c.status = 'settled'
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

REVOKE EXECUTE ON FUNCTION public.get_owner_billing_summary(UUID, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_owner_billing_summary(UUID, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_owner_billing_summary(UUID, DATE) TO authenticated;
ALTER FUNCTION public.get_owner_billing_summary(UUID, DATE) OWNER TO postgres;

-- ------------------------------------------------------------------------------
-- 2. Student Billing Summary RPC (SECURITY INVOKER)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_student_billing_summary(
    p_resident_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = ''
AS $$
DECLARE
    v_uid UUID;
    v_resident RECORD;
    v_charges JSONB;
    v_reports JSONB;
    v_payment_allocations JSONB;
BEGIN
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthenticated.');
    END IF;

    -- 1. Resolve active resident + property metadata (including owner UPI info)
    -- Existing RLS on public.residents and public.properties applies automatically.
    SELECT
        r.id,
        r.property_id,
        r.full_name,
        r.room_number,
        p.name AS property_name,
        p.upi_id AS owner_upi_id,
        p.upi_payee_name AS owner_upi_payee_name
    INTO v_resident
    FROM public.residents r
    LEFT JOIN public.properties p ON p.id = r.property_id
    WHERE r.profile_id = v_uid
      AND r.is_active = true
      AND (p_resident_id IS NULL OR r.id = p_resident_id)
    LIMIT 1;

    IF v_resident.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', true,
            'resident', NULL,
            'charges', '[]'::jsonb,
            'reports', '[]'::jsonb,
            'payment_allocations', '[]'::jsonb
        );
    END IF;

    -- 2. All rent and electricity charges (newest billing period first)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', c.id,
            'resident_id', c.resident_id,
            'category', c.category,
            'amount_paise', c.amount_paise,
            'rent_amount_paise', c.rent_amount_paise,
            'wm_amount_paise', c.wm_amount_paise,
            'status', c.status,
            'billing_period_start', c.billing_period_start,
            'due_date', c.due_date
        ) ORDER BY c.billing_period_start DESC
    ), '[]'::jsonb)
    INTO v_charges
    FROM public.charges c
    WHERE c.resident_id = v_resident.id
      AND c.category IN ('rent', 'electricity');

    -- 3. Pending and rejected payment reports (newest first)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', spr.id,
            'charge_id', spr.charge_id,
            'amount_paise', spr.amount_paise,
            'claimed_method', spr.claimed_method,
            'reference_number', spr.reference_number,
            'screenshot_url', spr.screenshot_url,
            'notes', spr.notes,
            'status', spr.status,
            'rejection_reason', spr.rejection_reason,
            'created_at', spr.created_at
        ) ORDER BY spr.created_at DESC
    ), '[]'::jsonb)
    INTO v_reports
    FROM public.student_payment_reports spr
    WHERE spr.resident_id = v_resident.id
      AND spr.status IN ('pending', 'rejected');

    -- 4. Active payment allocations & receipt metadata for settled charges
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'charge_id', pa.charge_id,
            'payment', jsonb_build_object(
                'id', p.id,
                'receipt_number', p.receipt_number,
                'payment_date', p.payment_date,
                'method', p.method
            )
        )
    ), '[]'::jsonb)
    INTO v_payment_allocations
    FROM public.payment_allocations pa
    JOIN public.payments p ON p.id = pa.payment_id
    JOIN public.charges c ON c.id = pa.charge_id
    WHERE c.resident_id = v_resident.id
      AND c.category IN ('rent', 'electricity')
      AND c.status = 'settled'
      AND pa.status = 'active';

    RETURN jsonb_build_object(
        'success', true,
        'resident', jsonb_build_object(
            'id', v_resident.id,
            'property_id', v_resident.property_id,
            'full_name', v_resident.full_name,
            'room_number', v_resident.room_number,
            'property_name', v_resident.property_name,
            'owner_upi_id', v_resident.owner_upi_id,
            'owner_upi_payee_name', v_resident.owner_upi_payee_name
        ),
        'charges', v_charges,
        'reports', v_reports,
        'payment_allocations', v_payment_allocations
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_student_billing_summary(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_student_billing_summary(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_student_billing_summary(UUID) TO authenticated;
ALTER FUNCTION public.get_student_billing_summary(UUID) OWNER TO postgres;

COMMIT;
