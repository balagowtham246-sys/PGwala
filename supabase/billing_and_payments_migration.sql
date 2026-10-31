-- ==============================================================================
-- PGwala Billing, EB, Washing-Machine, and Payments Migration (Repaired & Hardened)
-- File: supabase/billing_and_payments_migration.sql
--
-- Financial & Security Guarantees:
-- 1. Precision: All monetary amounts are stored in integer paise (BIGINT NOT NULL CHECK >= 0).
--    ₹1 = 100 paise; ₹9,000 = 900,000 paise; ₹500 = 50,000 paise.
--    No floating-point arithmetic is ever used for money.
-- 2. Audit Trail & Immutability: Charges and payment allocations are never physically deleted.
--    Reversals mark allocations and payments as 'reversed' while preserving full historical records.
-- 3. Strict Settlement: Payments settle complete charges in oldest-first order.
--    Individual charges are never partially settled.
-- 4. Defense-in-Depth Authorization & Scoping:
--    - In all RPCs, target residents MUST belong to an active property owned by the caller.
--    - get_resident_billing_summary verifies caller owns the resident's property or is the linked student.
-- 5. Concurrency & Allocation Safety:
--    - Partial unique index on payment_allocations (charge_id) WHERE status = 'active'.
--    - Internal receipt sequence public.receipt_number_seq with direct access revoked from authenticated.
--    - Student payment reports locked with FOR UPDATE upon review.
-- 6. Auditable Student Payment Corrections:
--    - If owner adjusts amount, method, or date when approving a report, original values are preserved
--      and a structured correction record is logged with actor, timestamp, and reason.
-- 7. Unallocated Credit Management:
--    - Full support for viewing active credit and applying credit to future complete charges.
--    - Payment reversals safely clear credit without corrupting audit trails.
-- 8. Hardened RPCs: Financial state changes run inside SECURITY DEFINER transactions with
--    SET search_path = '' and explicit postgres ownership.
-- ==============================================================================

-- 1. Create Enums (Idempotent DO blocks)
DO $$ BEGIN
    CREATE TYPE public.charge_category AS ENUM (
        'rent',
        'electricity',
        'washing_machine',
        'opening_balance'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE public.charge_status AS ENUM (
        'outstanding',
        'settled',
        'cancelled'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE public.billing_payment_method AS ENUM (
        'cash',
        'upi'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE public.billing_payment_status AS ENUM (
        'approved',
        'reversed'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE public.student_report_status AS ENUM (
        'pending',
        'approved',
        'rejected'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE public.payment_allocation_status AS ENUM (
        'active',
        'reversed'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- 2. Receipt Number Database Sequence (Concurrency-Safe, Internal Only)
CREATE SEQUENCE IF NOT EXISTS public.receipt_number_seq START 1;
ALTER SEQUENCE public.receipt_number_seq OWNER TO postgres;
REVOKE ALL ON SEQUENCE public.receipt_number_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.receipt_number_seq FROM anon;
REVOKE ALL ON SEQUENCE public.receipt_number_seq FROM authenticated;

-- 3. Table: resident_opt_ins (Washing machine opt-in configuration per resident)
CREATE TABLE IF NOT EXISTS public.resident_opt_ins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resident_id UUID NOT NULL REFERENCES public.residents(id) ON DELETE RESTRICT,
    feature_name TEXT NOT NULL DEFAULT 'washing_machine',
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    effective_from_date DATE NOT NULL,
    opt_out_effective_date DATE,
    disabled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_resident_opt_in_feature UNIQUE (resident_id, feature_name)
);

DO $$ BEGIN
    ALTER TABLE public.resident_opt_ins ADD COLUMN IF NOT EXISTS opt_out_effective_date DATE;
EXCEPTION
    WHEN duplicate_column THEN NULL;
END $$;

-- 4. Table: charges (Authoritative ledger of dues)
CREATE TABLE IF NOT EXISTS public.charges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
    resident_id UUID NOT NULL REFERENCES public.residents(id) ON DELETE RESTRICT,
    category public.charge_category NOT NULL,
    description TEXT NOT NULL,
    billing_period_start DATE NOT NULL,
    billing_period_end DATE NOT NULL,
    due_date DATE NOT NULL,
    amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
    status public.charge_status NOT NULL DEFAULT 'outstanding',
    is_opening_balance BOOLEAN NOT NULL DEFAULT false,
    reference_note TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique indexes to prevent duplicate charges
CREATE UNIQUE INDEX IF NOT EXISTS uq_idx_charges_monthly_rent
    ON public.charges (resident_id, category, billing_period_start)
    WHERE category = 'rent' AND status != 'cancelled';

CREATE UNIQUE INDEX IF NOT EXISTS uq_idx_charges_monthly_wm
    ON public.charges (resident_id, category, billing_period_start)
    WHERE category = 'washing_machine' AND status != 'cancelled';

CREATE UNIQUE INDEX IF NOT EXISTS uq_idx_charges_opening_balance
    ON public.charges (resident_id, category, is_opening_balance)
    WHERE is_opening_balance = true AND status != 'cancelled';

-- 5. Table: eb_room_bills (Room-level electricity bills)
CREATE TABLE IF NOT EXISTS public.eb_room_bills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
    room_number TEXT NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    due_date DATE NOT NULL,
    total_amount_paise BIGINT NOT NULL CHECK (total_amount_paise > 0),
    notes TEXT,
    created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Prevent duplicate room bills for the exact same property, room, and billing period
CREATE UNIQUE INDEX IF NOT EXISTS uq_idx_eb_room_bills_room_period
    ON public.eb_room_bills (property_id, room_number, period_start, period_end);

-- 6. Table: eb_allocations (Historical snapshot of resident shares per room EB bill)
CREATE TABLE IF NOT EXISTS public.eb_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    eb_room_bill_id UUID NOT NULL REFERENCES public.eb_room_bills(id) ON DELETE RESTRICT,
    resident_id UUID NOT NULL REFERENCES public.residents(id) ON DELETE RESTRICT,
    charge_id UUID NOT NULL REFERENCES public.charges(id) ON DELETE RESTRICT,
    allocated_amount_paise BIGINT NOT NULL CHECK (allocated_amount_paise > 0),
    resident_name_snapshot TEXT NOT NULL,
    room_number_snapshot TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_eb_allocation_resident_bill UNIQUE (eb_room_bill_id, resident_id)
);

-- 7. Table: payments (Verified payments received by the owner)
CREATE TABLE IF NOT EXISTS public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
    resident_id UUID NOT NULL REFERENCES public.residents(id) ON DELETE RESTRICT,
    receipt_number TEXT NOT NULL UNIQUE,
    amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
    unallocated_amount_paise BIGINT NOT NULL DEFAULT 0 CHECK (unallocated_amount_paise >= 0),
    method public.billing_payment_method NOT NULL,
    payment_date DATE NOT NULL,
    status public.billing_payment_status NOT NULL DEFAULT 'approved',
    notes TEXT,
    student_report_id UUID,
    recorded_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    reversal_reason TEXT,
    reversed_at TIMESTAMPTZ,
    reversed_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sync sequence with any existing payments in table (safe for both fresh installs and existing tables)
DO $$
DECLARE
    v_max_id BIGINT;
BEGIN
    SELECT COALESCE(MAX(
        CASE 
            WHEN receipt_number ~ '^[0-9]+$' THEN receipt_number::BIGINT
            WHEN receipt_number ~ '-([0-9]+)$' THEN (regexp_matches(receipt_number, '-([0-9]+)$'))[1]::BIGINT
            ELSE 0
        END
    ), 0) INTO v_max_id FROM public.payments;
    
    IF v_max_id > 0 THEN
        PERFORM setval('public.receipt_number_seq', v_max_id);
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        NULL;
END $$;

-- 8. Table: payment_allocations (Map of which payment settled which charge)
CREATE TABLE IF NOT EXISTS public.payment_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
    charge_id UUID NOT NULL REFERENCES public.charges(id) ON DELETE RESTRICT,
    settled_amount_paise BIGINT NOT NULL CHECK (settled_amount_paise > 0),
    status public.payment_allocation_status NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
    ALTER TABLE public.payment_allocations
        ADD COLUMN IF NOT EXISTS status public.payment_allocation_status NOT NULL DEFAULT 'active';
EXCEPTION
    WHEN duplicate_column THEN NULL;
END $$;

-- Drop legacy table-wide unique constraint if present
DO $$ BEGIN
    ALTER TABLE public.payment_allocations
        DROP CONSTRAINT IF EXISTS uq_payment_allocation_charge;
EXCEPTION
    WHEN undefined_object THEN NULL;
END $$;

-- Concurrency and reversal safe partial unique index on ACTIVE allocations only
CREATE UNIQUE INDEX IF NOT EXISTS uq_idx_payment_allocations_active_charge
    ON public.payment_allocations (charge_id)
    WHERE status = 'active';

-- 9. Table: student_payment_reports (Payment reports declared by students awaiting owner review)
CREATE TABLE IF NOT EXISTS public.student_payment_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
    resident_id UUID NOT NULL REFERENCES public.residents(id) ON DELETE RESTRICT,
    amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
    claimed_method public.billing_payment_method NOT NULL,
    payment_date DATE NOT NULL,
    reference_number TEXT,
    notes TEXT,
    status public.student_report_status NOT NULL DEFAULT 'pending',
    rejection_reason TEXT,
    has_corrections BOOLEAN NOT NULL DEFAULT false,
    correction_details JSONB,
    approved_payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL,
    reviewed_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
    ALTER TABLE public.student_payment_reports
        ADD COLUMN IF NOT EXISTS has_corrections BOOLEAN NOT NULL DEFAULT false;
EXCEPTION
    WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE public.student_payment_reports
        ADD COLUMN IF NOT EXISTS correction_details JSONB;
EXCEPTION
    WHEN duplicate_column THEN NULL;
END $$;

-- Foreign key link back from payments to student_payment_reports
DO $$ BEGIN
    ALTER TABLE public.payments
        ADD CONSTRAINT fk_payments_student_report
        FOREIGN KEY (student_report_id)
        REFERENCES public.student_payment_reports(id)
        ON DELETE SET NULL;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- 10. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_charges_resident_status ON public.charges (resident_id, status);
CREATE INDEX IF NOT EXISTS idx_charges_property_due ON public.charges (property_id, due_date);
CREATE INDEX IF NOT EXISTS idx_eb_room_bills_prop_room ON public.eb_room_bills (property_id, room_number);
CREATE INDEX IF NOT EXISTS idx_payments_resident ON public.payments (resident_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_receipt_number ON public.payments (receipt_number);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment ON public.payment_allocations (payment_id, status);
CREATE INDEX IF NOT EXISTS idx_student_reports_resident ON public.student_payment_reports (resident_id, status);
CREATE INDEX IF NOT EXISTS idx_student_reports_property ON public.student_payment_reports (property_id, status);

-- 11. Automated updated_at triggers
DROP TRIGGER IF EXISTS trigger_set_updated_at_charges ON public.charges;
CREATE TRIGGER trigger_set_updated_at_charges
    BEFORE UPDATE ON public.charges
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trigger_set_updated_at_payments ON public.payments;
CREATE TRIGGER trigger_set_updated_at_payments
    BEFORE UPDATE ON public.payments
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trigger_set_updated_at_student_reports ON public.student_payment_reports;
CREATE TRIGGER trigger_set_updated_at_student_reports
    BEFORE UPDATE ON public.student_payment_reports
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trigger_set_updated_at_opt_ins ON public.resident_opt_ins;
CREATE TRIGGER trigger_set_updated_at_opt_ins
    BEFORE UPDATE ON public.resident_opt_ins
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 12. Scoped Permissions & Privileges
REVOKE ALL ON TABLE public.resident_opt_ins FROM anon;
REVOKE ALL ON TABLE public.charges FROM anon;
REVOKE ALL ON TABLE public.eb_room_bills FROM anon;
REVOKE ALL ON TABLE public.eb_allocations FROM anon;
REVOKE ALL ON TABLE public.payments FROM anon;
REVOKE ALL ON TABLE public.payment_allocations FROM anon;
REVOKE ALL ON TABLE public.student_payment_reports FROM anon;

-- Direct write is revoked from authenticated; mutations go through audited policies or RPCs
REVOKE INSERT, UPDATE, DELETE ON TABLE public.charges FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.eb_room_bills FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.eb_allocations FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.payments FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.payment_allocations FROM authenticated;

-- Authenticated can SELECT from tables under RLS
GRANT SELECT ON TABLE public.resident_opt_ins TO authenticated;
GRANT SELECT ON TABLE public.charges TO authenticated;
GRANT SELECT ON TABLE public.eb_room_bills TO authenticated;
GRANT SELECT ON TABLE public.eb_allocations TO authenticated;
GRANT SELECT ON TABLE public.payments TO authenticated;
GRANT SELECT ON TABLE public.payment_allocations TO authenticated;
GRANT SELECT ON TABLE public.student_payment_reports TO authenticated;

-- Allow students to submit pending payment reports directly
GRANT INSERT (property_id, resident_id, amount_paise, claimed_method, payment_date, reference_number, notes)
    ON TABLE public.student_payment_reports TO authenticated;

-- 13. Row Level Security (RLS)
ALTER TABLE public.resident_opt_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eb_room_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eb_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_payment_reports ENABLE ROW LEVEL SECURITY;

-- === RLS POLICIES: charges ===
DROP POLICY IF EXISTS "charges_owner_select" ON public.charges;
CREATE POLICY "charges_owner_select"
    ON public.charges FOR SELECT
    TO authenticated
    USING (
        property_id IN (SELECT public.get_my_property_ids()) AND public.is_owner()
    );

DROP POLICY IF EXISTS "charges_student_select_own" ON public.charges;
CREATE POLICY "charges_student_select_own"
    ON public.charges FOR SELECT
    TO authenticated
    USING (
        resident_id IN (
            SELECT r.id FROM public.residents r
            WHERE r.profile_id = (SELECT auth.uid())
        )
    );

-- === RLS POLICIES: resident_opt_ins ===
DROP POLICY IF EXISTS "opt_ins_owner_all" ON public.resident_opt_ins;
CREATE POLICY "opt_ins_owner_all"
    ON public.resident_opt_ins FOR ALL
    TO authenticated
    USING (
        resident_id IN (
            SELECT r.id FROM public.residents r
            WHERE r.property_id IN (SELECT public.get_my_property_ids())
        ) AND public.is_owner()
    );

DROP POLICY IF EXISTS "opt_ins_student_select" ON public.resident_opt_ins;
CREATE POLICY "opt_ins_student_select"
    ON public.resident_opt_ins FOR SELECT
    TO authenticated
    USING (
        resident_id IN (
            SELECT r.id FROM public.residents r
            WHERE r.profile_id = (SELECT auth.uid())
        )
    );

-- === RLS POLICIES: eb_room_bills & eb_allocations ===
DROP POLICY IF EXISTS "eb_bills_owner_select" ON public.eb_room_bills;
CREATE POLICY "eb_bills_owner_select"
    ON public.eb_room_bills FOR SELECT
    TO authenticated
    USING (
        property_id IN (SELECT public.get_my_property_ids()) AND public.is_owner()
    );

DROP POLICY IF EXISTS "eb_allocations_owner_select" ON public.eb_allocations;
CREATE POLICY "eb_allocations_owner_select"
    ON public.eb_allocations FOR SELECT
    TO authenticated
    USING (
        resident_id IN (
            SELECT r.id FROM public.residents r
            WHERE r.property_id IN (SELECT public.get_my_property_ids())
        ) AND public.is_owner()
    );

DROP POLICY IF EXISTS "eb_allocations_student_select_own" ON public.eb_allocations;
CREATE POLICY "eb_allocations_student_select_own"
    ON public.eb_allocations FOR SELECT
    TO authenticated
    USING (
        resident_id IN (
            SELECT r.id FROM public.residents r
            WHERE r.profile_id = (SELECT auth.uid())
        )
    );

-- === RLS POLICIES: payments & payment_allocations ===
DROP POLICY IF EXISTS "payments_owner_select" ON public.payments;
CREATE POLICY "payments_owner_select"
    ON public.payments FOR SELECT
    TO authenticated
    USING (
        property_id IN (SELECT public.get_my_property_ids()) AND public.is_owner()
    );

DROP POLICY IF EXISTS "payments_student_select_own" ON public.payments;
CREATE POLICY "payments_student_select_own"
    ON public.payments FOR SELECT
    TO authenticated
    USING (
        resident_id IN (
            SELECT r.id FROM public.residents r
            WHERE r.profile_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "payment_allocations_owner_select" ON public.payment_allocations;
CREATE POLICY "payment_allocations_owner_select"
    ON public.payment_allocations FOR SELECT
    TO authenticated
    USING (
        payment_id IN (
            SELECT p.id FROM public.payments p
            WHERE p.property_id IN (SELECT public.get_my_property_ids())
        ) AND public.is_owner()
    );

DROP POLICY IF EXISTS "payment_allocations_student_select_own" ON public.payment_allocations;
CREATE POLICY "payment_allocations_student_select_own"
    ON public.payment_allocations FOR SELECT
    TO authenticated
    USING (
        payment_id IN (
            SELECT p.id FROM public.payments p
            JOIN public.residents r ON r.id = p.resident_id
            WHERE r.profile_id = (SELECT auth.uid())
        )
    );

-- === RLS POLICIES: student_payment_reports ===
DROP POLICY IF EXISTS "student_reports_owner_select" ON public.student_payment_reports;
CREATE POLICY "student_reports_owner_select"
    ON public.student_payment_reports FOR SELECT
    TO authenticated
    USING (
        property_id IN (SELECT public.get_my_property_ids()) AND public.is_owner()
    );

DROP POLICY IF EXISTS "student_reports_student_select_own" ON public.student_payment_reports;
CREATE POLICY "student_reports_student_select_own"
    ON public.student_payment_reports FOR SELECT
    TO authenticated
    USING (
        resident_id IN (
            SELECT r.id FROM public.residents r
            WHERE r.profile_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "student_reports_student_insert" ON public.student_payment_reports;
CREATE POLICY "student_reports_student_insert"
    ON public.student_payment_reports FOR INSERT
    TO authenticated
    WITH CHECK (
        status = 'pending' AND
        resident_id IN (
            SELECT r.id FROM public.residents r
            WHERE r.profile_id = (SELECT auth.uid()) AND r.is_active = true
        ) AND
        property_id IN (
            SELECT r.property_id FROM public.residents r
            WHERE r.profile_id = (SELECT auth.uid()) AND r.is_active = true
        )
    );

-- ------------------------------------------------------------------------------
-- 14. HARDENED SECURITY DEFINER PROCEDURES / RPCS
-- ------------------------------------------------------------------------------

-- Internal Helper: generate concurrency-safe receipt number
-- Directly callable only by postgres superuser/SECURITY DEFINER contexts.
CREATE OR REPLACE FUNCTION public.generate_receipt_number(p_property_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_prefix TEXT;
    v_seq BIGINT;
BEGIN
    v_prefix := 'RCP-' || pg_catalog.to_char(pg_catalog.now(), 'YYYYMM') || '-';
    v_seq := nextval('public.receipt_number_seq');
    RETURN v_prefix || pg_catalog.lpad(v_seq::TEXT, 5, '0');
END;
$$;

ALTER FUNCTION public.generate_receipt_number(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.generate_receipt_number(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_receipt_number(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.generate_receipt_number(UUID) FROM authenticated;

-- RPC 1: generate_monthly_charges
-- Automatically generates monthly rent and washing machine charges for all active residents.
-- Rent default: ₹9,000 (900,000 paise). Due on 5th of billing month.
-- Washing machine: ₹500 (50,000 paise). Opt-out takes effect from next billing month.
CREATE OR REPLACE FUNCTION public.generate_monthly_charges(
    p_property_id UUID,
    p_billing_month DATE, -- e.g. 2026-11-01
    p_custom_rent_paise BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner_id UUID;
    v_rent_paise BIGINT;
    v_wm_paise BIGINT := 50000; -- ₹500
    v_period_start DATE;
    v_period_end DATE;
    v_due_date DATE;
    v_resident RECORD;
    v_rent_count INT := 0;
    v_wm_count INT := 0;
BEGIN
    -- Verify caller is an authenticated owner of this property
    v_owner_id := auth.uid();
    IF v_owner_id IS NULL OR NOT public.is_owner() THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Unauthorized: Only authenticated PG owners can generate monthly charges.'
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

    -- Calculate normalized dates for the billing month
    v_period_start := pg_catalog.date_trunc('month', p_billing_month)::DATE;
    v_period_end := (pg_catalog.date_trunc('month', p_billing_month) + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
    v_due_date := (v_period_start + INTERVAL '4 days')::DATE; -- Due on the 5th

    -- Rent amount: default ₹9,000 (900,000 paise) unless custom specified
    v_rent_paise := COALESCE(p_custom_rent_paise, 900000::BIGINT);
    IF v_rent_paise <= 0 THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Rent amount must be greater than zero.'
        );
    END IF;

    -- Loop over all active residents in this property
    FOR v_resident IN
        SELECT r.id, r.full_name, r.room_number
        FROM public.residents r
        WHERE r.property_id = p_property_id AND r.is_active = true
    LOOP
        -- 1. Insert Rent Charge (idempotent: ignore if already generated)
        BEGIN
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
                is_opening_balance
            ) VALUES (
                p_property_id,
                v_resident.id,
                'rent',
                'Monthly Rent - ' || pg_catalog.to_char(v_period_start, 'Mon YYYY'),
                v_period_start,
                v_period_end,
                v_due_date,
                v_rent_paise,
                'outstanding',
                false
            );
            v_rent_count := v_rent_count + 1;
        EXCEPTION
            WHEN unique_violation THEN
                -- Rent already generated for this resident and month; safely skip
                NULL;
        END;

        -- 2. Insert Washing Machine Fee if opted in
        -- Eligible if:
        -- a) is_enabled = true AND effective_from_date <= v_period_start
        -- OR
        -- b) is_enabled = false BUT opt_out_effective_date > v_period_start (opt-out takes effect from next month)
        IF EXISTS (
            SELECT 1 FROM public.resident_opt_ins oi
            WHERE oi.resident_id = v_resident.id
              AND oi.feature_name = 'washing_machine'
              AND oi.effective_from_date <= v_period_start
              AND (
                  oi.is_enabled = true
                  OR (oi.opt_out_effective_date IS NOT NULL AND oi.opt_out_effective_date > v_period_start)
              )
        ) THEN
            BEGIN
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
                    is_opening_balance
                ) VALUES (
                    p_property_id,
                    v_resident.id,
                    'washing_machine',
                    'Washing Machine Fee - ' || pg_catalog.to_char(v_period_start, 'Mon YYYY'),
                    v_period_start,
                    v_period_end,
                    v_due_date,
                    v_wm_paise,
                    'outstanding',
                    false
                );
                v_wm_count := v_wm_count + 1;
            EXCEPTION
                WHEN unique_violation THEN
                    -- Washing machine fee already generated; safely skip
                    NULL;
            END;
        END IF;
    END LOOP;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'billing_month', v_period_start,
        'rent_charges_created', v_rent_count,
        'washing_machine_charges_created', v_wm_count,
        'message', 'Generated ' || v_rent_count || ' rent charges and ' || v_wm_count || ' washing machine charges.'
    );
END;
$$;

-- RPC 2: allocate_eb_bill
-- Manually allocates an electricity bill for a room among eligible residents.
-- Validates that residents belong to caller's property, specified room, and are active.
-- Rejects duplicate resident IDs and prevents duplicate bills for the same period.
-- Implements deterministic whole-rupee allocation with explicit stable resident ordering.
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
    v_owner_id := auth.uid();
    IF v_owner_id IS NULL OR NOT public.is_owner() THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Unauthorized: Only authenticated PG owners can allocate EB bills.'
        );
    END IF;

    -- Verify property ownership and active status
    IF NOT EXISTS (
        SELECT 1 FROM public.properties p
        WHERE p.id = p_property_id AND p.owner_id = v_owner_id AND p.is_active = true
    ) THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Property not found or you do not own this property.'
        );
    END IF;

    -- Enforce whole-rupee amounts (₹1 = 100 paise)
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

    -- Reject duplicate resident IDs
    IF (SELECT COUNT(*) FROM pg_catalog.unnest(p_resident_ids)) != (SELECT COUNT(DISTINCT r_id) FROM pg_catalog.unnest(p_resident_ids) r_id) THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Duplicate resident IDs found in the allocation list.'
        );
    END IF;

    -- Guarantee every allocated resident receives at least ₹1 (100 paise)
    IF p_total_amount_paise < (v_resident_count * 100) THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Total EB bill amount (₹' || (p_total_amount_paise / 100) || ') must be at least ₹' || v_resident_count || ' to allocate at least ₹1 to each of the ' || v_resident_count || ' residents.'
        );
    END IF;

    -- Check for duplicate EB bill for this property, room, and period
    IF EXISTS (
        SELECT 1 FROM public.eb_room_bills
        WHERE property_id = p_property_id
          AND room_number = p_room_number
          AND period_start = p_period_start
          AND period_end = p_period_end
    ) THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'An electricity bill for room ' || p_room_number || ' covering this exact period (' || pg_catalog.to_char(p_period_start, 'DD Mon YYYY') || ' to ' || pg_catalog.to_char(p_period_end, 'DD Mon YYYY') || ') has already been recorded.'
        );
    END IF;

    -- Whole-rupee deterministic calculation:
    v_base_rupees := (p_total_amount_paise / (v_resident_count * 100));
    v_remainder_rupees := (p_total_amount_paise / 100) - (v_base_rupees * v_resident_count);

    -- 1. Create EB Room Bill header
    INSERT INTO public.eb_room_bills (
        property_id,
        room_number,
        period_start,
        period_end,
        due_date,
        total_amount_paise,
        notes,
        created_by
    ) VALUES (
        p_property_id,
        p_room_number,
        p_period_start,
        p_period_end,
        p_due_date,
        p_total_amount_paise,
        p_notes,
        v_owner_id
    ) RETURNING id INTO v_bill_id;

    -- 2. Allocate shares using an EXPLICIT, STABLE resident ordering:
    -- Ordering by LOWER(full_name) ASC, id ASC guarantees 100% determinism.
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

        -- Create charge record for this resident
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

        -- Snapshot into eb_allocations
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

    -- Verify that all residents in p_resident_ids were valid, active, and in this room
    IF v_idx != v_resident_count THEN
        RAISE EXCEPTION 'Validation failure: Expected % valid room residents but matched %.', v_resident_count, v_idx;
    END IF;

    -- Integrity invariant check
    IF v_total_allocated != p_total_amount_paise THEN
        RAISE EXCEPTION 'Math error: allocated amount % does not equal bill total %', v_total_allocated, p_total_amount_paise;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'eb_room_bill_id', v_bill_id,
        'residents_allocated', v_resident_count,
        'total_amount_paise', v_total_allocated,
        'message', 'Electricity bill of ₹' || (v_total_allocated / 100) || ' allocated among ' || v_resident_count || ' residents.'
    );
END;
$$;

-- RPC 3: record_opening_balance
-- Records an initial balance for an active resident under an allowed category.
-- Allowed categories: rent, electricity, washing_machine.
CREATE OR REPLACE FUNCTION public.record_opening_balance(
    p_resident_id UUID,
    p_category public.charge_category,
    p_amount_paise BIGINT,
    p_due_date DATE,
    p_reference TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner_id UUID;
    v_resident RECORD;
    v_charge_id UUID;
BEGIN
    v_owner_id := auth.uid();
    IF v_owner_id IS NULL OR NOT public.is_owner() THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Unauthorized: Only authenticated PG owners can record opening balances.'
        );
    END IF;

    -- Category validation: opening balances are only allowed for operational charge categories
    IF p_category NOT IN ('rent', 'electricity', 'washing_machine') THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Invalid category for opening balance. Must be one of: rent, electricity, washing_machine.'
        );
    END IF;

    -- Verify resident is active and belongs to an active property owned by caller
    SELECT r.id, r.property_id, r.full_name, r.room_number
    INTO v_resident
    FROM public.residents r
    INNER JOIN public.properties p ON p.id = r.property_id
    WHERE r.id = p_resident_id
      AND p.owner_id = v_owner_id
      AND p.is_active = true
      AND r.is_active = true;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Resident not found, inactive, or you do not own the associated property.'
        );
    END IF;

    IF p_amount_paise <= 0 THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Opening balance amount must be greater than zero.'
        );
    END IF;

    BEGIN
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
            v_resident.property_id,
            v_resident.id,
            p_category,
            'Opening Balance - ' || pg_catalog.initcap(p_category::TEXT),
            p_due_date,
            p_due_date,
            p_due_date,
            p_amount_paise,
            'outstanding',
            true,
            p_reference
        ) RETURNING id INTO v_charge_id;
    EXCEPTION
        WHEN unique_violation THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error', 'An opening balance for category "' || p_category::TEXT || '" already exists for this resident.'
            );
    END;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'charge_id', v_charge_id,
        'message', 'Opening balance of ₹' || (p_amount_paise / 100) || ' recorded for ' || v_resident.full_name || '.'
    );
END;
$$;

-- RPC 4: approve_payment_and_allocate
-- Settles complete outstanding charges in oldest-first order.
-- Concurrency-safe: locks student reports with FOR UPDATE.
-- Validates student-reported inputs; logs structured corrections if owner modifies values.
-- Guarantees exact mathematical invariant: payment amount = sum(active settled charges) + unallocated amount.
CREATE OR REPLACE FUNCTION public.approve_payment_and_allocate(
    p_property_id UUID,
    p_resident_id UUID,
    p_amount_paise BIGINT,
    p_method public.billing_payment_method,
    p_payment_date DATE,
    p_notes TEXT DEFAULT NULL,
    p_student_report_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner_id UUID;
    v_resident RECORD;
    v_payment_id UUID;
    v_receipt_no TEXT;
    v_remaining_paise BIGINT;
    v_charge RECORD;
    v_settled_count INT := 0;
    v_total_settled_paise BIGINT := 0;
    v_report RECORD;
    v_has_corrections BOOLEAN := false;
    v_correction_json JSONB := NULL;
BEGIN
    v_owner_id := auth.uid();
    IF v_owner_id IS NULL OR NOT public.is_owner() THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Unauthorized: Only authenticated PG owners can approve payments.'
        );
    END IF;

    -- Verify resident and property ownership
    SELECT r.id, r.full_name, r.room_number
    INTO v_resident
    FROM public.residents r
    INNER JOIN public.properties p ON p.id = r.property_id
    WHERE r.id = p_resident_id AND p.id = p_property_id AND p.owner_id = v_owner_id AND p.is_active = true;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Resident not found or property not owned by caller.'
        );
    END IF;

    IF p_amount_paise <= 0 THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Payment amount must be greater than zero.'
        );
    END IF;

    -- If originated from student report, lock and verify report
    IF p_student_report_id IS NOT NULL THEN
        SELECT id, status, resident_id, property_id, amount_paise, claimed_method, payment_date, notes
        INTO v_report
        FROM public.student_payment_reports
        WHERE id = p_student_report_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error', 'Student report not found.'
            );
        END IF;

        IF v_report.status != 'pending' THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error', 'This student report has already been reviewed.'
            );
        END IF;

        IF v_report.property_id != p_property_id THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error', 'Student report property does not match target property.'
            );
        END IF;

        IF v_report.resident_id != p_resident_id THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error', 'Student report resident does not match target resident.'
            );
        END IF;

        -- Detect and record explicit owner corrections
        IF (p_amount_paise != v_report.amount_paise OR
            p_method != v_report.claimed_method OR
            p_payment_date != v_report.payment_date) THEN
            v_has_corrections := true;
            v_correction_json := pg_catalog.jsonb_build_object(
                'original', pg_catalog.jsonb_build_object(
                    'amount_paise', v_report.amount_paise,
                    'claimed_method', v_report.claimed_method,
                    'payment_date', v_report.payment_date
                ),
                'approved', pg_catalog.jsonb_build_object(
                    'amount_paise', p_amount_paise,
                    'method', p_method,
                    'payment_date', p_payment_date
                ),
                'corrected_by', v_owner_id,
                'corrected_at', pg_catalog.now(),
                'correction_reason', COALESCE(pg_catalog.btrim(p_notes), 'Owner adjusted payment values upon verification.')
            );
        END IF;
    END IF;

    -- Concurrency-safe receipt number generation via sequence
    v_receipt_no := public.generate_receipt_number(p_property_id);
    v_remaining_paise := p_amount_paise;

    -- 1. Create Payment record
    INSERT INTO public.payments (
        property_id,
        resident_id,
        receipt_number,
        amount_paise,
        unallocated_amount_paise,
        method,
        payment_date,
        status,
        notes,
        student_report_id,
        recorded_by
    ) VALUES (
        p_property_id,
        p_resident_id,
        v_receipt_no,
        p_amount_paise,
        0, -- updated after allocation
        p_method,
        p_payment_date,
        'approved',
        p_notes,
        p_student_report_id,
        v_owner_id
    ) RETURNING id INTO v_payment_id;

    -- 2. Allocate payment to oldest complete charges first
    -- Sort by due_date ASC, created_at ASC, id ASC
    FOR v_charge IN
        SELECT c.id, c.amount_paise, c.category, c.description
        FROM public.charges c
        WHERE c.resident_id = p_resident_id
          AND c.status = 'outstanding'
        ORDER BY c.due_date ASC, c.created_at ASC, c.id ASC
        FOR UPDATE OF c
    LOOP
        -- Only settle if payment can settle the ENTIRE charge (No partial settlement!)
        IF v_remaining_paise >= v_charge.amount_paise THEN
            -- Record active allocation
            INSERT INTO public.payment_allocations (
                payment_id,
                charge_id,
                settled_amount_paise,
                status
            ) VALUES (
                v_payment_id,
                v_charge.id,
                v_charge.amount_paise,
                'active'
            );

            -- Update charge status
            UPDATE public.charges
            SET status = 'settled',
                updated_at = pg_catalog.now()
            WHERE id = v_charge.id;

            v_remaining_paise := v_remaining_paise - v_charge.amount_paise;
            v_total_settled_paise := v_total_settled_paise + v_charge.amount_paise;
            v_settled_count := v_settled_count + 1;
        ELSE
            -- Insufficient funds to settle this full charge; per rule, leave it outstanding
            EXIT;
        END IF;
    END LOOP;

    -- 3. Update unallocated amount on payment
    UPDATE public.payments
    SET unallocated_amount_paise = v_remaining_paise,
        updated_at = pg_catalog.now()
    WHERE id = v_payment_id;

    -- 4. If student report was provided, mark it approved with audit reference and corrections
    IF p_student_report_id IS NOT NULL THEN
        UPDATE public.student_payment_reports
        SET status = 'approved',
            approved_payment_id = v_payment_id,
            has_corrections = v_has_corrections,
            correction_details = v_correction_json,
            reviewed_by = v_owner_id,
            reviewed_at = pg_catalog.now(),
            updated_at = pg_catalog.now()
        WHERE id = p_student_report_id;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'payment_id', v_payment_id,
        'receipt_number', v_receipt_no,
        'amount_paid_paise', p_amount_paise,
        'settled_charges_count', v_settled_count,
        'total_settled_paise', v_total_settled_paise,
        'unallocated_amount_paise', v_remaining_paise,
        'has_corrections', v_has_corrections,
        'message', 'Payment of ₹' || (p_amount_paise / 100) || ' approved. ' || v_settled_count || ' complete charges settled. Receipt: ' || v_receipt_no
    );
END;
$$;

-- RPC 5: reject_student_payment_report
CREATE OR REPLACE FUNCTION public.reject_student_payment_report(
    p_report_id UUID,
    p_rejection_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner_id UUID;
    v_report RECORD;
BEGIN
    v_owner_id := auth.uid();
    IF v_owner_id IS NULL OR NOT public.is_owner() THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Unauthorized: Only authenticated PG owners can review payment reports.'
        );
    END IF;

    IF p_rejection_reason IS NULL OR pg_catalog.btrim(p_rejection_reason) = '' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Please provide a reason for rejecting this payment report.'
        );
    END IF;

    SELECT r.id, r.status, r.property_id
    INTO v_report
    FROM public.student_payment_reports r
    INNER JOIN public.properties p ON p.id = r.property_id
    WHERE r.id = p_report_id AND p.owner_id = v_owner_id AND p.is_active = true
    FOR UPDATE OF r;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Payment report not found or you do not own the property.'
        );
    END IF;

    IF v_report.status != 'pending' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'This report has already been reviewed.'
        );
    END IF;

    UPDATE public.student_payment_reports
    SET status = 'rejected',
        rejection_reason = pg_catalog.btrim(p_rejection_reason),
        reviewed_by = v_owner_id,
        reviewed_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE id = p_report_id;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'message', 'Payment report marked as rejected.'
    );
END;
$$;

-- RPC 6: reverse_payment
-- Reverses an approved payment.
-- Reopens charges settled by this payment as 'outstanding'.
-- Marks matching allocations as 'reversed' (never deletes rows).
-- Marks payment status as 'reversed' with zeroed unallocated credit and full audit log.
CREATE OR REPLACE FUNCTION public.reverse_payment(
    p_payment_id UUID,
    p_reversal_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner_id UUID;
    v_payment RECORD;
    v_alloc RECORD;
    v_unsettled_count INT := 0;
BEGIN
    v_owner_id := auth.uid();
    IF v_owner_id IS NULL OR NOT public.is_owner() THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Unauthorized: Only authenticated PG owners can reverse payments.'
        );
    END IF;

    IF p_reversal_reason IS NULL OR pg_catalog.btrim(p_reversal_reason) = '' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Please provide a reason for reversing this payment.'
        );
    END IF;

    -- Lock payment record and verify property ownership
    SELECT p.id, p.status, p.property_id, p.resident_id, p.receipt_number, p.amount_paise, p.unallocated_amount_paise
    INTO v_payment
    FROM public.payments p
    INNER JOIN public.properties prop ON prop.id = p.property_id
    WHERE p.id = p_payment_id AND prop.owner_id = v_owner_id AND prop.is_active = true
    FOR UPDATE OF p;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Payment record not found or you do not own this property.'
        );
    END IF;

    IF v_payment.status = 'reversed' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'This payment has already been reversed.'
        );
    END IF;

    -- Re-open charges settled by this payment and mark active allocations reversed
    FOR v_alloc IN
        SELECT pa.id, pa.charge_id, pa.settled_amount_paise
        FROM public.payment_allocations pa
        WHERE pa.payment_id = p_payment_id AND pa.status = 'active'
        FOR UPDATE OF pa
    LOOP
        UPDATE public.charges
        SET status = 'outstanding',
            updated_at = pg_catalog.now()
        WHERE id = v_alloc.charge_id AND status = 'settled';

        UPDATE public.payment_allocations
        SET status = 'reversed'
        WHERE id = v_alloc.id;

        v_unsettled_count := v_unsettled_count + 1;
    END LOOP;

    -- Mark payment reversed and clear unallocated credit
    UPDATE public.payments
    SET status = 'reversed',
        reversal_reason = pg_catalog.btrim(p_reversal_reason),
        reversed_at = pg_catalog.now(),
        reversed_by = v_owner_id,
        unallocated_amount_paise = 0,
        updated_at = pg_catalog.now()
    WHERE id = p_payment_id;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'receipt_number', v_payment.receipt_number,
        'charges_reopened_count', v_unsettled_count,
        'message', 'Payment ' || v_payment.receipt_number || ' reversed. ' || v_unsettled_count || ' charges reopened as outstanding.'
    );
END;
$$;

-- RPC 7: toggle_washing_machine
-- Opt-in or opt-out resident from washing machine recurring fee.
-- Rule: Opt-out takes effect from the NEXT billing month, preserving current month eligibility.
CREATE OR REPLACE FUNCTION public.toggle_washing_machine(
    p_resident_id UUID,
    p_enabled BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner_id UUID;
    v_resident RECORD;
    v_next_month DATE;
BEGIN
    v_owner_id := auth.uid();
    IF v_owner_id IS NULL OR NOT public.is_owner() THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Unauthorized: Only authenticated PG owners can update washing machine settings.'
        );
    END IF;

    SELECT r.id, r.full_name
    INTO v_resident
    FROM public.residents r
    INNER JOIN public.properties p ON p.id = r.property_id
    WHERE r.id = p_resident_id AND p.owner_id = v_owner_id AND p.is_active = true;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Resident not found or property not owned by caller.'
        );
    END IF;

    -- If disabling, opt-out takes effect on the 1st of next month
    v_next_month := (pg_catalog.date_trunc('month', CURRENT_DATE) + INTERVAL '1 month')::DATE;

    INSERT INTO public.resident_opt_ins (
        resident_id,
        feature_name,
        is_enabled,
        effective_from_date,
        opt_out_effective_date,
        disabled_at
    ) VALUES (
        p_resident_id,
        'washing_machine',
        p_enabled,
        CURRENT_DATE,
        CASE WHEN p_enabled THEN NULL ELSE v_next_month END,
        CASE WHEN p_enabled THEN NULL ELSE pg_catalog.now() END
    )
    ON CONFLICT (resident_id, feature_name)
    DO UPDATE SET
        is_enabled = EXCLUDED.is_enabled,
        opt_out_effective_date = CASE WHEN EXCLUDED.is_enabled THEN NULL ELSE v_next_month END,
        disabled_at = CASE WHEN EXCLUDED.is_enabled THEN NULL ELSE pg_catalog.now() END,
        updated_at = pg_catalog.now();

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'is_enabled', p_enabled,
        'opt_out_effective_date', CASE WHEN p_enabled THEN NULL ELSE v_next_month END,
        'message', 'Washing machine ' || (CASE WHEN p_enabled THEN 'enabled' ELSE 'disabled (effective ' || pg_catalog.to_char(v_next_month, 'Mon YYYY') || ')' END) || ' for ' || v_resident.full_name || '.'
    );
END;
$$;

-- RPC 8: get_resident_billing_summary
-- Summarizes total outstanding, overdue, settled charges, and active unallocated credit.
-- Enforces strict caller authorization: must be the owner of the resident's property OR the resident student.
CREATE OR REPLACE FUNCTION public.get_resident_billing_summary(
    p_resident_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_is_owner_of_resident BOOLEAN := false;
    v_is_resident BOOLEAN := false;
    v_outstanding_paise BIGINT := 0;
    v_overdue_paise BIGINT := 0;
    v_settled_paise BIGINT := 0;
    v_unallocated_paise BIGINT := 0;
    v_charges_count INT := 0;
    v_overdue_count INT := 0;
    v_today DATE := CURRENT_DATE;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Unauthorized: User is not authenticated.'
        );
    END IF;

    -- Authorization check:
    -- 1. Caller is an authenticated owner of the property where this resident resides
    SELECT EXISTS (
        SELECT 1 FROM public.residents r
        INNER JOIN public.properties p ON p.id = r.property_id
        WHERE r.id = p_resident_id
          AND p.owner_id = v_caller_id
          AND p.is_active = true
    ) INTO v_is_owner_of_resident;

    -- 2. Caller is the authenticated student linked to this resident
    SELECT EXISTS (
        SELECT 1 FROM public.residents r
        WHERE r.id = p_resident_id
          AND r.profile_id = v_caller_id
          AND r.is_active = true
    ) INTO v_is_resident;

    IF NOT v_is_owner_of_resident AND NOT v_is_resident THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Unauthorized: You cannot access billing data for this resident.'
        );
    END IF;

    -- Aggregate charges
    SELECT
        COALESCE(SUM(CASE WHEN status = 'outstanding' THEN amount_paise ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN status = 'outstanding' AND due_date < v_today THEN amount_paise ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN status = 'settled' THEN amount_paise ELSE 0 END), 0),
        COALESCE(COUNT(CASE WHEN status = 'outstanding' THEN 1 END), 0),
        COALESCE(COUNT(CASE WHEN status = 'outstanding' AND due_date < v_today THEN 1 END), 0)
    INTO
        v_outstanding_paise,
        v_overdue_paise,
        v_settled_paise,
        v_charges_count,
        v_overdue_count
    FROM public.charges
    WHERE resident_id = p_resident_id
      AND status != 'cancelled';

    -- Active unallocated credit from approved payments
    SELECT COALESCE(SUM(unallocated_amount_paise), 0)
    INTO v_unallocated_paise
    FROM public.payments
    WHERE resident_id = p_resident_id
      AND status = 'approved';

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'resident_id', p_resident_id,
        'outstanding_paise', v_outstanding_paise,
        'overdue_paise', v_overdue_paise,
        'settled_paise', v_settled_paise,
        'unallocated_paise', v_unallocated_paise,
        'outstanding_charges_count', v_charges_count,
        'overdue_charges_count', v_overdue_count
    );
END;
$$;

-- RPC 9: apply_unallocated_credit
-- Settle outstanding charges for a resident using their available unallocated credit from approved payments.
-- Complete oldest charges first.
CREATE OR REPLACE FUNCTION public.apply_unallocated_credit(
    p_resident_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner_id UUID;
    v_resident RECORD;
    v_payment RECORD;
    v_charge RECORD;
    v_settled_count INT := 0;
    v_total_applied_paise BIGINT := 0;
    v_rem_credit BIGINT;
BEGIN
    v_owner_id := auth.uid();
    IF v_owner_id IS NULL OR NOT public.is_owner() THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Unauthorized: Only authenticated PG owners can apply unallocated credit.'
        );
    END IF;

    -- Verify resident is active and belongs to an active property owned by caller
    SELECT r.id, r.full_name, r.room_number, r.property_id
    INTO v_resident
    FROM public.residents r
    INNER JOIN public.properties p ON p.id = r.property_id
    WHERE r.id = p_resident_id
      AND p.owner_id = v_owner_id
      AND p.is_active = true
      AND r.is_active = true;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Resident not found, inactive, or property not owned by caller.'
        );
    END IF;

    -- Iterate over approved payments having unallocated credit in oldest-first order
    FOR v_payment IN
        SELECT p.id, p.unallocated_amount_paise, p.receipt_number
        FROM public.payments p
        WHERE p.resident_id = p_resident_id
          AND p.status = 'approved'
          AND p.unallocated_amount_paise > 0
        ORDER BY p.payment_date ASC, p.created_at ASC, p.id ASC
        FOR UPDATE OF p
    LOOP
        v_rem_credit := v_payment.unallocated_amount_paise;

        -- Iterate over outstanding charges in oldest-first order
        FOR v_charge IN
            SELECT c.id, c.amount_paise, c.category, c.description
            FROM public.charges c
            WHERE c.resident_id = p_resident_id
              AND c.status = 'outstanding'
            ORDER BY c.due_date ASC, c.created_at ASC, c.id ASC
            FOR UPDATE OF c
        LOOP
            -- Only settle if credit can settle the complete charge (Strict settlement rule: no partial settlement!)
            IF v_rem_credit >= v_charge.amount_paise THEN
                INSERT INTO public.payment_allocations (
                    payment_id,
                    charge_id,
                    settled_amount_paise,
                    status
                ) VALUES (
                    v_payment.id,
                    v_charge.id,
                    v_charge.amount_paise,
                    'active'
                );

                UPDATE public.charges
                SET status = 'settled',
                    updated_at = pg_catalog.now()
                WHERE id = v_charge.id;

                v_rem_credit := v_rem_credit - v_charge.amount_paise;
                v_total_applied_paise := v_total_applied_paise + v_charge.amount_paise;
                v_settled_count := v_settled_count + 1;
            ELSE
                -- Insufficient credit to settle this entire charge
                EXIT;
            END IF;
        END LOOP;

        -- Update payment unallocated credit
        IF v_rem_credit != v_payment.unallocated_amount_paise THEN
            UPDATE public.payments
            SET unallocated_amount_paise = v_rem_credit,
                updated_at = pg_catalog.now()
            WHERE id = v_payment.id;
        END IF;
    END LOOP;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'resident_id', p_resident_id,
        'charges_settled_count', v_settled_count,
        'total_credit_applied_paise', v_total_applied_paise,
        'message', CASE
            WHEN v_settled_count > 0 THEN 'Applied ₹' || (v_total_applied_paise / 100) || ' credit from previous payments to settle ' || v_settled_count || ' complete charges.'
            ELSE 'No complete outstanding charges could be settled with current available credit.'
        END
    );
END;
$$;

-- 15. Grant Execute on Functions to Authenticated Users
REVOKE EXECUTE ON FUNCTION public.generate_monthly_charges(UUID, DATE, BIGINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.allocate_eb_bill(UUID, TEXT, DATE, DATE, DATE, BIGINT, UUID[], TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_opening_balance(UUID, public.charge_category, BIGINT, DATE, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_payment_and_allocate(UUID, UUID, BIGINT, public.billing_payment_method, DATE, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reject_student_payment_report(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reverse_payment(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.toggle_washing_machine(UUID, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_resident_billing_summary(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_unallocated_credit(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.generate_monthly_charges(UUID, DATE, BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_eb_bill(UUID, TEXT, DATE, DATE, DATE, BIGINT, UUID[], TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_opening_balance(UUID, public.charge_category, BIGINT, DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_payment_and_allocate(UUID, UUID, BIGINT, public.billing_payment_method, DATE, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_student_payment_report(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_payment(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_washing_machine(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_resident_billing_summary(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_unallocated_credit(UUID) TO authenticated;

-- Explicit function ownership
ALTER FUNCTION public.generate_monthly_charges(UUID, DATE, BIGINT) OWNER TO postgres;
ALTER FUNCTION public.allocate_eb_bill(UUID, TEXT, DATE, DATE, DATE, BIGINT, UUID[], TEXT) OWNER TO postgres;
ALTER FUNCTION public.record_opening_balance(UUID, public.charge_category, BIGINT, DATE, TEXT) OWNER TO postgres;
ALTER FUNCTION public.approve_payment_and_allocate(UUID, UUID, BIGINT, public.billing_payment_method, DATE, TEXT, UUID) OWNER TO postgres;
ALTER FUNCTION public.reject_student_payment_report(UUID, TEXT) OWNER TO postgres;
ALTER FUNCTION public.reverse_payment(UUID, TEXT) OWNER TO postgres;
ALTER FUNCTION public.toggle_washing_machine(UUID, BOOLEAN) OWNER TO postgres;
ALTER FUNCTION public.get_resident_billing_summary(UUID) OWNER TO postgres;
ALTER FUNCTION public.apply_unallocated_credit(UUID) OWNER TO postgres;
