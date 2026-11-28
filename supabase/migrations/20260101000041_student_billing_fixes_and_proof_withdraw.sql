-- ============================================================================
-- Migration 41: Student Billing Consistency, Cancelled-Bill Protection &
--               Payment Proof Withdrawal
-- ============================================================================
-- 1. Updates public.get_student_billing_summary:
--    * Filters out cancelled charges (c.status != 'cancelled')
--    * Includes ac_amount_paise on every charge
--    * Returns active payment_allocations (with settled_amount_paise) for both
--      settled and partially-paid outstanding charges
--    * Excludes reports attached to cancelled charges
-- 2. Updates public.submit_student_payment_proof:
--    * Rejects cancelled charges cleanly
--    * Rejects duplicate pending proofs on the same charge
--    * Uses remaining unpaid balance when a charge is partially paid
-- 3. Adds public.withdraw_student_payment_proof(p_report_id UUID):
--    * Lets an authenticated resident delete their own pending payment proof
--      so they can re-upload or cancel an accidental submission

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Updated RPC: get_student_billing_summary (SECURITY INVOKER)
-- ----------------------------------------------------------------------------
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

    -- All non-cancelled rent and electricity charges (newest billing month first, Rent before EB)
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
            'billing_period_start', c.billing_period_start,
            'due_date', c.due_date
        ) ORDER BY c.billing_period_start DESC, CASE WHEN c.category = 'rent' THEN 0 ELSE 1 END ASC
    ), '[]'::jsonb)
    INTO v_charges
    FROM public.charges c
    WHERE c.resident_id = v_resident.id
      AND c.category IN ('rent', 'electricity')
      AND c.status != 'cancelled';

    -- Pending and rejected payment reports for non-cancelled charges (newest first)
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
    LEFT JOIN public.charges c ON c.id = spr.charge_id
    WHERE spr.resident_id = v_resident.id
      AND spr.status IN ('pending', 'rejected')
      AND (c.id IS NULL OR c.status != 'cancelled');

    -- Active payment allocations & receipt metadata for settled and partially-paid charges
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
        )
    ), '[]'::jsonb)
    INTO v_payment_allocations
    FROM public.payment_allocations pa
    JOIN public.payments p ON p.id = pa.payment_id
    JOIN public.charges c ON c.id = pa.charge_id
    WHERE c.resident_id = v_resident.id
      AND c.category IN ('rent', 'electricity')
      AND c.status != 'cancelled'
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

REVOKE EXECUTE ON FUNCTION public.get_student_billing_summary(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_billing_summary(UUID) TO authenticated;
ALTER FUNCTION public.get_student_billing_summary(UUID) OWNER TO postgres;

-- ----------------------------------------------------------------------------
-- 2. Updated RPC: submit_student_payment_proof (rejects cancelled & duplicate pending)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_student_payment_proof(
    p_charge_id UUID,
    p_claimed_method TEXT, -- 'upi' or 'cash'
    p_screenshot_url TEXT DEFAULT NULL,
    p_reference_number TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_screenshot_sha256 TEXT DEFAULT NULL,
    p_ai_extracted_data JSONB DEFAULT NULL,
    p_verification_status TEXT DEFAULT 'unverified',
    p_verification_warnings TEXT[] DEFAULT '{}'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_charge RECORD;
    v_method public.billing_payment_method;
    v_report_id UUID;
    v_normalized_utr TEXT;
    v_clean_sha256 TEXT;
    v_ver_status TEXT;
    v_ver_warnings TEXT[];
    v_already_paid_paise BIGINT := 0;
    v_remaining_paise BIGINT := 0;
BEGIN
    v_user_id := (SELECT auth.uid());
    IF v_user_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'Unauthenticated');
    END IF;

    -- Validate charge exists and belongs to this student
    SELECT c.id, c.property_id, c.resident_id, c.amount_paise, c.billing_period_start, c.status
    INTO v_charge
    FROM public.charges c
    JOIN public.residents r ON r.id = c.resident_id
    WHERE c.id = p_charge_id
      AND r.profile_id = v_user_id
      AND r.is_active = true
    FOR UPDATE OF c;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Bill not found or you are not authorized to pay this bill.'
        );
    END IF;

    IF v_charge.status = 'cancelled' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'code', 'BILL_CANCELLED',
            'error', 'This bill was cancelled by your PG owner.'
        );
    END IF;

    IF v_charge.status = 'settled' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'This bill has already been marked as Paid.'
        );
    END IF;

    -- Prevent duplicate pending proof on the same bill
    IF EXISTS (
        SELECT 1
        FROM public.student_payment_reports spr
        WHERE spr.charge_id = v_charge.id
          AND spr.status = 'pending'
    ) THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'code', 'PROOF_ALREADY_PENDING',
            'error', 'A payment proof is already under review. Withdraw it first to upload a new one.'
        );
    END IF;

    SELECT COALESCE(SUM(pa.settled_amount_paise), 0)::BIGINT
    INTO v_already_paid_paise
    FROM public.payment_allocations pa
    WHERE pa.charge_id = v_charge.id
      AND pa.status = 'active';

    v_remaining_paise := GREATEST(0, v_charge.amount_paise - v_already_paid_paise);
    IF v_remaining_paise <= 0 THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'This bill has already been paid in full.'
        );
    END IF;

    -- Validate method
    IF pg_catalog.lower(p_claimed_method) = 'cash' THEN
        v_method := 'cash'::public.billing_payment_method;
    ELSE
        v_method := 'upi'::public.billing_payment_method;
    END IF;

    v_normalized_utr := public.normalize_upi_utr(p_reference_number);
    IF v_normalized_utr IS NULL AND p_ai_extracted_data IS NOT NULL THEN
        v_normalized_utr := public.normalize_upi_utr(p_ai_extracted_data->>'utr_number');
    END IF;

    v_clean_sha256 := NULLIF(pg_catalog.lower(pg_catalog.btrim(COALESCE(p_screenshot_sha256, ''))), '');

    IF p_verification_status IN ('verified_match', 'warning', 'unverified') THEN
        v_ver_status := p_verification_status;
    ELSE
        v_ver_status := 'unverified';
    END IF;

    v_ver_warnings := COALESCE(p_verification_warnings, '{}'::TEXT[]);

    -- Explicit duplicate checks for clean, actionable fraud-shield errors
    IF v_clean_sha256 IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.student_payment_reports spr
        WHERE spr.property_id = v_charge.property_id
          AND spr.screenshot_sha256 = v_clean_sha256
          AND spr.status IN ('pending', 'approved')
    ) THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'code', 'DUPLICATE_SCREENSHOT',
            'error', 'This payment screenshot has already been submitted for another bill. Please upload a fresh payment receipt.'
        );
    END IF;

    IF v_normalized_utr IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.student_payment_reports spr
        WHERE spr.property_id = v_charge.property_id
          AND spr.normalized_utr = v_normalized_utr
          AND spr.status IN ('pending', 'approved')
    ) THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'code', 'DUPLICATE_UTR',
            'error', 'UPI Transaction ID (UTR ' || v_normalized_utr || ') has already been used for another payment. Please check your receipt.'
        );
    END IF;

    -- Insert student payment report
    BEGIN
        INSERT INTO public.student_payment_reports (
            property_id,
            resident_id,
            charge_id,
            amount_paise,
            claimed_method,
            payment_date,
            reference_number,
            notes,
            screenshot_url,
            billing_month,
            status,
            normalized_utr,
            screenshot_sha256,
            ai_extracted_data,
            verification_status,
            verification_warnings
        ) VALUES (
            v_charge.property_id,
            v_charge.resident_id,
            v_charge.id,
            v_remaining_paise,
            v_method,
            CURRENT_DATE,
            COALESCE(NULLIF(pg_catalog.btrim(COALESCE(p_reference_number, '')), ''), v_normalized_utr),
            p_notes,
            p_screenshot_url,
            v_charge.billing_period_start,
            'pending',
            v_normalized_utr,
            v_clean_sha256,
            p_ai_extracted_data,
            v_ver_status,
            v_ver_warnings
        ) RETURNING id INTO v_report_id;
    EXCEPTION
        WHEN unique_violation THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'code', 'DUPLICATE_PROOF',
                'error', 'This UPI Transaction ID or screenshot has already been submitted for another bill.'
            );
    END;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'report_id', v_report_id,
        'charge_id', v_charge.id,
        'amount_paise', v_remaining_paise
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_student_payment_proof(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_student_payment_proof(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT[]) TO authenticated;
ALTER FUNCTION public.submit_student_payment_proof(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT[]) OWNER TO postgres;

-- ----------------------------------------------------------------------------
-- 3. New RPC: withdraw_student_payment_proof(p_report_id UUID)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.withdraw_student_payment_proof(
    p_report_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_report RECORD;
BEGIN
    v_user_id := (SELECT auth.uid());
    IF v_user_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'Unauthenticated.');
    END IF;

    SELECT spr.id, spr.charge_id, spr.status, spr.screenshot_url
    INTO v_report
    FROM public.student_payment_reports spr
    JOIN public.residents r ON r.id = spr.resident_id
    WHERE spr.id = p_report_id
      AND r.profile_id = v_user_id
      AND r.is_active = true
    FOR UPDATE OF spr;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Payment proof not found or you are not authorized to withdraw it.'
        );
    END IF;

    IF v_report.status != 'pending' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Only payment proofs currently under review can be withdrawn.'
        );
    END IF;

    DELETE FROM public.student_payment_reports
    WHERE id = p_report_id;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'report_id', p_report_id,
        'charge_id', v_report.charge_id,
        'screenshot_url', v_report.screenshot_url,
        'message', 'Payment proof withdrawn.'
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.withdraw_student_payment_proof(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_student_payment_proof(UUID) TO authenticated;
ALTER FUNCTION public.withdraw_student_payment_proof(UUID) OWNER TO postgres;

COMMIT;
