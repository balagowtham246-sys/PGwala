-- ==============================================================================
-- PGWALA SIMPLIFIED MONTHLY BILLING MIGRATION
-- File: supabase/simplified_monthly_billing_migration.sql
-- ==============================================================================
-- Replaces complex accounting with a clean, month-by-month billing lifecycle:
-- 1. Owner generates monthly bill (Rent + Washing Machine fee if opted).
-- 2. Resident submits payment proof (UPI screenshot/reference or Cash).
-- 3. Owner confirms payment with 1 tap (or marks paid directly in-person).
-- 4. Simple, transparent English terminology throughout.
-- ==============================================================================

-- 1. EXTEND RESIDENTS WITH MONTHLY RENT
ALTER TABLE public.residents
ADD COLUMN IF NOT EXISTS monthly_rent_paise BIGINT DEFAULT 800000 CHECK (monthly_rent_paise >= 0);

-- 2. EXTEND CHARGES FOR MONTH-WISE BREAKDOWN
ALTER TABLE public.charges
ADD COLUMN IF NOT EXISTS rent_amount_paise BIGINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS wm_amount_paise BIGINT DEFAULT 0;

-- Ensure unique monthly charge per resident per billing month
CREATE UNIQUE INDEX IF NOT EXISTS uq_charges_resident_month
ON public.charges (resident_id, billing_period_start)
WHERE category = 'rent';

-- 3. EXTEND STUDENT PAYMENT REPORTS FOR SCREENSHOTS & MONTH LINK
ALTER TABLE public.student_payment_reports
ADD COLUMN IF NOT EXISTS screenshot_url TEXT,
ADD COLUMN IF NOT EXISTS billing_month DATE,
ADD COLUMN IF NOT EXISTS charge_id UUID REFERENCES public.charges(id);

-- Update column grants for student insertion
GRANT INSERT (property_id, resident_id, charge_id, amount_paise, claimed_method, payment_date, reference_number, notes, screenshot_url, billing_month)
ON TABLE public.student_payment_reports TO authenticated;

-- Ensure students can upload payment reports for their own active resident record
DROP POLICY IF EXISTS "student_reports_student_insert_proof" ON public.student_payment_reports;
CREATE POLICY "student_reports_student_insert_proof"
    ON public.student_payment_reports FOR INSERT
    TO authenticated
    WITH CHECK (
        resident_id IN (
            SELECT id FROM public.residents
            WHERE profile_id = (SELECT auth.uid()) AND is_active = true
        )
    );

-- 4. STORAGE BUCKET FOR PAYMENT PROOFS (Idempotent)
-- Note: storage.buckets & storage.objects are pre-managed by Supabase.
INSERT INTO storage.buckets (id, name, public)
VALUES ('payment-proofs', 'payment-proofs', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Storage policies: authenticated users can upload screenshots
DROP POLICY IF EXISTS "payment_proofs_authenticated_insert" ON storage.objects;
CREATE POLICY "payment_proofs_authenticated_insert"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'payment-proofs');

DROP POLICY IF EXISTS "payment_proofs_public_select" ON storage.objects;
CREATE POLICY "payment_proofs_public_select"
    ON storage.objects FOR SELECT
    TO public
    USING (bucket_id = 'payment-proofs');

-- 5. ATOMIC RPC: generate_monthly_bills
-- Generates or updates consolidated bills per active resident for the given month.
-- If p_default_rent_paise is provided, it updates resident rent and updates any existing unpaid charges.
CREATE OR REPLACE FUNCTION public.generate_monthly_bills(
    p_property_id UUID,
    p_billing_month DATE, -- e.g. '2026-11-01'
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
    v_total_paise BIGINT;
    v_wm_opted BOOLEAN;
    v_created_count INT := 0;
    v_updated_count INT := 0;
    v_skipped_count INT := 0;
    v_desc TEXT;
BEGIN
    -- Verify caller is owner of the property
    v_owner_id := auth.uid();
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

    -- Normalize month dates
    v_month_start := pg_catalog.date_trunc('month', p_billing_month)::DATE;
    v_month_end := (pg_catalog.date_trunc('month', p_billing_month) + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
    v_due_date := (v_month_start + INTERVAL '4 days')::DATE; -- Due 5th of the month
    v_month_label := pg_catalog.to_char(v_month_start, 'FMMonth YYYY');

    -- Loop over active residents of this property
    FOR v_resident IN
        SELECT r.id, r.full_name, r.room_number, r.monthly_rent_paise
        FROM public.residents r
        WHERE r.property_id = p_property_id AND r.is_active = true
        ORDER BY r.room_number, r.full_name
    LOOP
        -- Check if bill already exists for this resident and month
        SELECT c.id, c.status, c.wm_amount_paise, c.rent_amount_paise
        INTO v_existing_charge
        FROM public.charges c
        WHERE c.resident_id = v_resident.id
          AND c.billing_period_start = v_month_start
          AND c.category = 'rent'
        LIMIT 1;

        IF FOUND THEN
            -- If charge exists and is still outstanding, and owner specified a new rent amount, update it!
            IF v_existing_charge.status = 'outstanding' AND p_default_rent_paise IS NOT NULL AND p_default_rent_paise > 0 THEN
                v_rent_paise := p_default_rent_paise;

                -- Update resident default monthly rent
                UPDATE public.residents
                SET monthly_rent_paise = v_rent_paise
                WHERE id = v_resident.id;

                -- Check washing machine opt-in
                SELECT COALESCE(opt.is_enabled, false)
                INTO v_wm_opted
                FROM public.resident_opt_ins opt
                WHERE opt.resident_id = v_resident.id
                  AND opt.feature_name = 'washing_machine'
                LIMIT 1;

                IF v_wm_opted THEN
                    v_wm_paise := 50000::BIGINT;
                    v_desc := v_month_label || ' Bill (Rent ₹' || (v_rent_paise / 100)::TEXT || ' + Washing Machine ₹500)';
                ELSE
                    v_wm_paise := 0::BIGINT;
                    v_desc := v_month_label || ' Bill (Room Rent ₹' || (v_rent_paise / 100)::TEXT || ')';
                END IF;

                v_total_paise := v_rent_paise + v_wm_paise;

                UPDATE public.charges
                SET rent_amount_paise = v_rent_paise,
                    wm_amount_paise = v_wm_paise,
                    amount_paise = v_total_paise,
                    description = v_desc
                WHERE id = v_existing_charge.id;

                v_updated_count := v_updated_count + 1;
            ELSE
                v_skipped_count := v_skipped_count + 1;
            END IF;
            CONTINUE;
        END IF;

        -- Create new bill: if p_default_rent_paise is passed, it takes precedence!
        v_rent_paise := COALESCE(p_default_rent_paise, v_resident.monthly_rent_paise, 800000::BIGINT);
        IF v_rent_paise <= 0 THEN
            v_rent_paise := 800000::BIGINT;
        END IF;

        -- Keep resident's default rent in sync if owner specified p_default_rent_paise
        IF p_default_rent_paise IS NOT NULL AND p_default_rent_paise > 0 THEN
            UPDATE public.residents
            SET monthly_rent_paise = v_rent_paise
            WHERE id = v_resident.id;
        END IF;

        -- Check washing machine opt-in
        SELECT COALESCE(opt.is_enabled, false)
        INTO v_wm_opted
        FROM public.resident_opt_ins opt
        WHERE opt.resident_id = v_resident.id
          AND opt.feature_name = 'washing_machine'
        LIMIT 1;

        IF v_wm_opted THEN
            v_wm_paise := 50000::BIGINT; -- ₹500
            v_desc := v_month_label || ' Bill (Rent ₹' || (v_rent_paise / 100)::TEXT || ' + Washing Machine ₹500)';
        ELSE
            v_wm_paise := 0::BIGINT;
            v_desc := v_month_label || ' Bill (Room Rent ₹' || (v_rent_paise / 100)::TEXT || ')';
        END IF;

        v_total_paise := v_rent_paise + v_wm_paise;

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

-- 6. ATOMIC RPC: submit_student_payment_proof
-- Allows a student to submit their payment screenshot/reference or cash payment confirmation.
CREATE OR REPLACE FUNCTION public.submit_student_payment_proof(
    p_charge_id UUID,
    p_claimed_method TEXT, -- 'upi' or 'cash'
    p_screenshot_url TEXT DEFAULT NULL,
    p_reference_number TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
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
    IF lower(p_claimed_method) = 'cash' THEN
        v_method := 'cash'::public.billing_payment_method;
    ELSE
        v_method := 'upi'::public.billing_payment_method;
    END IF;

    -- Insert student payment report
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
        status
    ) VALUES (
        v_charge.property_id,
        v_charge.resident_id,
        v_charge.id,
        v_charge.amount_paise,
        v_method,
        CURRENT_DATE,
        p_reference_number,
        p_notes,
        p_screenshot_url,
        v_charge.billing_period_start,
        'pending'
    ) RETURNING id INTO v_report_id;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'report_id', v_report_id,
        'charge_id', v_charge.id,
        'amount_paise', v_charge.amount_paise
    );
END;
$$;

-- 7. ATOMIC RPC: confirm_monthly_payment
-- Owner confirms payment report or directly marks resident as Paid (Cash / In-person).
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
    v_payment_method public.billing_payment_method;
    v_receipt_no TEXT;
    v_payment_id UUID;
BEGIN
    v_owner_id := auth.uid();
    IF v_owner_id IS NULL OR NOT public.is_owner() THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Unauthorized: Only PG owners can confirm payments.'
        );
    END IF;

    -- Fetch charge and verify owner ownership
    SELECT c.id, c.property_id, c.resident_id, c.amount_paise, c.status, c.billing_period_start
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

    -- Validate payment method
    IF lower(p_method) = 'cash' THEN
        v_payment_method := 'cash'::public.billing_payment_method;
    ELSE
        v_payment_method := 'upi'::public.billing_payment_method;
    END IF;

    -- Generate receipt number
    v_receipt_no := 'RCT-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMM') || '-' ||
                    pg_catalog.lpad(pg_catalog.nextval('public.receipt_number_seq')::TEXT, 4, '0');

    -- Create approved payment record
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
        v_charge.amount_paise,
        0,
        v_payment_method,
        CURRENT_DATE,
        'approved',
        v_owner_id,
        COALESCE(p_notes, 'Monthly bill payment confirmed')
    ) RETURNING id INTO v_payment_id;

    -- Record allocation
    INSERT INTO public.payment_allocations (
        charge_id,
        payment_id,
        settled_amount_paise,
        status
    ) VALUES (
        v_charge.id,
        v_payment_id,
        v_charge.amount_paise,
        'active'
    );

    -- Mark charge settled
    UPDATE public.charges
    SET status = 'settled'
    WHERE id = v_charge.id;

    -- If a student payment report was attached, mark it approved
    IF p_report_id IS NOT NULL THEN
        UPDATE public.student_payment_reports
        SET status = 'approved'
        WHERE id = p_report_id;
    ELSE
        -- Also approve any pending report for this charge if one existed
        UPDATE public.student_payment_reports
        SET status = 'approved'
        WHERE charge_id = v_charge.id AND status = 'pending';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'receipt_number', v_receipt_no,
        'charge_id', v_charge.id,
        'payment_id', v_payment_id
    );
END;
$$;

-- 8. ATOMIC RPC: update_resident_rent
-- Allows owner to update a resident's monthly rent amount directly.
-- If an unpaid rent charge exists for the given billing month, updates that charge too.
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
    v_total_paise BIGINT;
    v_desc TEXT;
    v_charge RECORD;
BEGIN
    v_owner_id := auth.uid();
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

    -- Verify property ownership and resident
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

    -- Update resident's base monthly rent
    UPDATE public.residents
    SET monthly_rent_paise = p_rent_paise
    WHERE id = p_resident_id;

    -- If a billing month is specified, update any outstanding charge for that month
    IF p_billing_month IS NOT NULL THEN
        v_month_start := pg_catalog.date_trunc('month', p_billing_month)::DATE;
        v_month_label := pg_catalog.to_char(v_month_start, 'FMMonth YYYY');

        SELECT c.id, c.wm_amount_paise, c.status
        INTO v_charge
        FROM public.charges c
        WHERE c.resident_id = p_resident_id
          AND c.billing_period_start = v_month_start
          AND c.category = 'rent'
        LIMIT 1;

        IF FOUND AND v_charge.status = 'outstanding' THEN
            v_wm_paise := COALESCE(v_charge.wm_amount_paise, 0);
            v_total_paise := p_rent_paise + v_wm_paise;
            
            IF v_wm_paise > 0 THEN
                v_desc := v_month_label || ' Bill (Rent ₹' || (p_rent_paise / 100)::TEXT || ' + Washing Machine ₹' || (v_wm_paise / 100)::TEXT || ')';
            ELSE
                v_desc := v_month_label || ' Bill (Room Rent ₹' || (p_rent_paise / 100)::TEXT || ')';
            END IF;

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

-- 9. ATOMIC RPC: toggle_resident_wm_billing
-- Toggles a resident's washing machine opt-in.
-- If an unpaid rent charge exists for the given billing month, updates the charge breakdown and total.
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
    v_total_paise BIGINT;
    v_desc TEXT;
    v_charge RECORD;
BEGIN
    v_owner_id := auth.uid();
    IF v_owner_id IS NULL OR NOT public.is_owner() THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Unauthorized: Only authenticated PG owners can update washing machine settings.'
        );
    END IF;

    -- Verify resident belongs to property owned by caller
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

    -- Upsert resident_opt_ins
    INSERT INTO public.resident_opt_ins (resident_id, feature_name, is_enabled, effective_from_date)
    VALUES (p_resident_id, 'washing_machine', p_is_enabled, CURRENT_DATE)
    ON CONFLICT (resident_id, feature_name)
    DO UPDATE SET is_enabled = p_is_enabled;

    -- If billing month specified, update outstanding rent charge
    IF p_billing_month IS NOT NULL THEN
        v_month_start := pg_catalog.date_trunc('month', p_billing_month)::DATE;
        v_month_label := pg_catalog.to_char(v_month_start, 'FMMonth YYYY');

        SELECT c.id, c.rent_amount_paise, c.status
        INTO v_charge
        FROM public.charges c
        WHERE c.resident_id = p_resident_id
          AND c.billing_period_start = v_month_start
          AND c.category = 'rent'
        LIMIT 1;

        IF FOUND AND v_charge.status = 'outstanding' THEN
            v_rent_paise := COALESCE(v_charge.rent_amount_paise, 800000::BIGINT);
            v_wm_paise := CASE WHEN p_is_enabled THEN 50000::BIGINT ELSE 0::BIGINT END;
            v_total_paise := v_rent_paise + v_wm_paise;

            IF v_wm_paise > 0 THEN
                v_desc := v_month_label || ' Bill (Rent ₹' || (v_rent_paise / 100)::TEXT || ' + Washing Machine ₹500)';
            ELSE
                v_desc := v_month_label || ' Bill (Room Rent ₹' || (v_rent_paise / 100)::TEXT || ')';
            END IF;

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

-- 10. GRANT RPC EXECUTE
GRANT EXECUTE ON FUNCTION public.generate_monthly_bills(UUID, DATE, BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_student_payment_proof(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_monthly_payment(UUID, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_resident_rent(UUID, UUID, BIGINT, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_resident_wm_billing(UUID, UUID, BOOLEAN, DATE) TO authenticated;

ALTER FUNCTION public.generate_monthly_bills(UUID, DATE, BIGINT) OWNER TO postgres;
ALTER FUNCTION public.submit_student_payment_proof(UUID, TEXT, TEXT, TEXT, TEXT) OWNER TO postgres;
ALTER FUNCTION public.confirm_monthly_payment(UUID, UUID, TEXT, TEXT) OWNER TO postgres;
ALTER FUNCTION public.update_resident_rent(UUID, UUID, BIGINT, DATE) OWNER TO postgres;
ALTER FUNCTION public.toggle_resident_wm_billing(UUID, UUID, BOOLEAN, DATE) OWNER TO postgres;
