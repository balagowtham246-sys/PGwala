-- ==============================================================================
-- Migration 31: UPI Screenshot Fraud Shield & AI Auto-Verifier
-- File: supabase/migrations/20260101000031_upi_fraud_shield.sql
--
-- Adds:
--   1. Verification & fingerprint columns on public.student_payment_reports:
--      - normalized_utr (12-digit normalized UPI reference number)
--      - screenshot_sha256 (SHA-256 hex digest of uploaded proof image)
--      - ai_extracted_data (structured JSON from Gemini 2.5 Flash vision)
--      - verification_status ('verified_match' | 'warning' | 'unverified')
--      - verification_warnings (human-readable discrepancy messages)
--   2. Partial unique indexes per property on pending/approved reports to
--      hard-block duplicate UTRs and recycled screenshots while allowing
--      legitimate resubmission after an owner rejection.
--   3. Updated submit_student_payment_proof(...) RPC with server-side UTR
--      normalization + clean DUPLICATE_UTR / DUPLICATE_SCREENSHOT errors.
--   4. Updated get_owner_billing_summary(...) RPC to return verification
--      metadata for the Owner Review Payment Proof modal.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Helper: Normalize Indian UPI UTR (extracts 12-digit numeric UTR when present)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_upi_utr(p_raw TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
    v_digits TEXT;
    v_match TEXT[];
BEGIN
    IF p_raw IS NULL OR pg_catalog.btrim(p_raw) = '' THEN
        RETURN NULL;
    END IF;

    -- Prefer an explicit 12-digit sequence (standard NPCI UPI UTR / RRN format)
    v_match := pg_catalog.regexp_match(p_raw, '(^|[^0-9])([0-9]{12})([^0-9]|$)');
    IF v_match IS NOT NULL AND v_match[2] IS NOT NULL THEN
        RETURN v_match[2];
    END IF;

    -- Fallback: strip non-digits; if exactly 12 digits remain, accept it
    v_digits := pg_catalog.regexp_replace(p_raw, '[^0-9]', '', 'g');
    IF pg_catalog.length(v_digits) = 12 THEN
        RETURN v_digits;
    END IF;

    RETURN NULL;
END;
$$;

-- ------------------------------------------------------------------------------
-- 2. Columns & Partial Unique Indexes on public.student_payment_reports
-- ------------------------------------------------------------------------------
ALTER TABLE public.student_payment_reports
    ADD COLUMN IF NOT EXISTS normalized_utr TEXT,
    ADD COLUMN IF NOT EXISTS screenshot_sha256 TEXT,
    ADD COLUMN IF NOT EXISTS ai_extracted_data JSONB,
    ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'unverified',
    ADD COLUMN IF NOT EXISTS verification_warnings TEXT[] NOT NULL DEFAULT '{}';

DO $$ BEGIN
    ALTER TABLE public.student_payment_reports
        ADD CONSTRAINT chk_student_payment_reports_verification_status
        CHECK (verification_status IN ('verified_match', 'warning', 'unverified'));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Backfill normalized_utr for existing pending/approved rows (only where unique)
WITH candidates AS (
    SELECT
        id,
        property_id,
        public.normalize_upi_utr(reference_number) AS utr,
        ROW_NUMBER() OVER (
            PARTITION BY property_id, public.normalize_upi_utr(reference_number)
            ORDER BY created_at ASC, id ASC
        ) AS rn
    FROM public.student_payment_reports
    WHERE normalized_utr IS NULL
      AND reference_number IS NOT NULL
      AND status IN ('pending', 'approved')
)
UPDATE public.student_payment_reports spr
SET normalized_utr = c.utr
FROM candidates c
WHERE spr.id = c.id
  AND c.utr IS NOT NULL
  AND c.rn = 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_student_payment_reports_property_utr
    ON public.student_payment_reports (property_id, normalized_utr)
    WHERE status IN ('pending', 'approved') AND normalized_utr IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_student_payment_reports_property_sha256
    ON public.student_payment_reports (property_id, screenshot_sha256)
    WHERE status IN ('pending', 'approved') AND screenshot_sha256 IS NOT NULL;

-- ------------------------------------------------------------------------------
-- 3. Updated RPC: submit_student_payment_proof (backwards-compatible)
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.submit_student_payment_proof(UUID, TEXT, TEXT, TEXT, TEXT);

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
BEGIN
    v_user_id := auth.uid();
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
      AND r.is_active = true;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Bill not found or you are not authorized to pay this bill.'
        );
    END IF;

    IF v_charge.status = 'settled' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'This bill has already been marked as Paid.'
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
            v_charge.amount_paise,
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
        'amount_paise', v_charge.amount_paise
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_student_payment_proof(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_student_payment_proof(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT[]) TO authenticated;
ALTER FUNCTION public.submit_student_payment_proof(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT[]) OWNER TO postgres;

-- ------------------------------------------------------------------------------
-- 4. Updated RPC: get_owner_billing_summary (includes AI verification fields)
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

REVOKE EXECUTE ON FUNCTION public.get_owner_billing_summary(UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_owner_billing_summary(UUID, DATE) TO authenticated;
ALTER FUNCTION public.get_owner_billing_summary(UUID, DATE) OWNER TO postgres;

COMMIT;
