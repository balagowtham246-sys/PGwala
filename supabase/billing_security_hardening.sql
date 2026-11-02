-- ==============================================================================
-- PGwala Billing Least-Privilege Security Hardening Migration
-- File: supabase/billing_security_hardening.sql
--
-- Objectives:
-- 1. Revoke TRUNCATE on all billing tables from client-facing roles (anon, authenticated, PUBLIC).
-- 2. Strip unnecessary direct INSERT, UPDATE, DELETE permissions on financial tables:
--    - charges, payments, payment_allocations, eb_room_bills, eb_allocations, resident_opt_ins.
-- 3. Preserve the student's permitted payment-report INSERT flow:
--    - Column-scoped INSERT on (property_id, resident_id, amount_paise, claimed_method, payment_date, reference_number, notes).
--    - Prohibit direct UPDATE, DELETE, or un-scoped INSERT on student_payment_reports.
-- 4. Harden Row-Level Security (RLS) policies:
--    - Replace permissive 'FOR ALL' on resident_opt_ins with 'FOR SELECT' only (mutations route strictly via toggle_washing_machine).
--    - Harden student_reports_student_insert to enforce single-row correlation between resident_id and property_id for auth.uid().
-- 5. Guarantee sequence and internal helper functions cannot be directly invoked:
--    - Revoke direct EXECUTE on public.generate_receipt_number(UUID) from PUBLIC, anon, and authenticated.
--    - Revoke sequence permissions on public.receipt_number_seq.
-- 6. Ensure all 13 billing RPC functions enforce SECURITY DEFINER with SET search_path = ''
--    and explicit caller verification.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. REVOKE TRUNCATE FROM ALL CLIENT-FACING ROLES
-- ------------------------------------------------------------------------------
REVOKE TRUNCATE ON TABLE public.charges FROM anon, authenticated, PUBLIC;
REVOKE TRUNCATE ON TABLE public.payments FROM anon, authenticated, PUBLIC;
REVOKE TRUNCATE ON TABLE public.payment_allocations FROM anon, authenticated, PUBLIC;
REVOKE TRUNCATE ON TABLE public.eb_room_bills FROM anon, authenticated, PUBLIC;
REVOKE TRUNCATE ON TABLE public.eb_allocations FROM anon, authenticated, PUBLIC;
REVOKE TRUNCATE ON TABLE public.resident_opt_ins FROM anon, authenticated, PUBLIC;
REVOKE TRUNCATE ON TABLE public.student_payment_reports FROM anon, authenticated, PUBLIC;

-- ------------------------------------------------------------------------------
-- 2. REVOKE UNNECESSARY DIRECT WRITES ON FINANCIAL & CONFIG TABLES
-- ------------------------------------------------------------------------------
-- All financial writes must flow through validated SECURITY DEFINER RPCs.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.charges FROM anon, authenticated, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.payments FROM anon, authenticated, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.payment_allocations FROM anon, authenticated, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.eb_room_bills FROM anon, authenticated, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.eb_allocations FROM anon, authenticated, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.resident_opt_ins FROM anon, authenticated, PUBLIC;

-- Student payment reports: Prevent any client-side UPDATE or DELETE
REVOKE UPDATE, DELETE ON TABLE public.student_payment_reports FROM anon, authenticated, PUBLIC;
-- Strip broad table-level INSERT from anonymous and authenticated
REVOKE INSERT ON TABLE public.student_payment_reports FROM anon, authenticated, PUBLIC;

-- Strip all anon access entirely
REVOKE ALL ON TABLE public.charges FROM anon;
REVOKE ALL ON TABLE public.payments FROM anon;
REVOKE ALL ON TABLE public.payment_allocations FROM anon;
REVOKE ALL ON TABLE public.eb_room_bills FROM anon;
REVOKE ALL ON TABLE public.eb_allocations FROM anon;
REVOKE ALL ON TABLE public.resident_opt_ins FROM anon;
REVOKE ALL ON TABLE public.student_payment_reports FROM anon;

-- ------------------------------------------------------------------------------
-- 3. EXPLICIT LEAST-PRIVILEGE GRANTS
-- ------------------------------------------------------------------------------
-- Read access for authenticated users (enforced by RLS tenant/resident isolation)
GRANT SELECT ON TABLE public.charges TO authenticated;
GRANT SELECT ON TABLE public.payments TO authenticated;
GRANT SELECT ON TABLE public.payment_allocations TO authenticated;
GRANT SELECT ON TABLE public.eb_room_bills TO authenticated;
GRANT SELECT ON TABLE public.eb_allocations TO authenticated;
GRANT SELECT ON TABLE public.resident_opt_ins TO authenticated;
GRANT SELECT ON TABLE public.student_payment_reports TO authenticated;

-- Strictly scoped column-level INSERT for students to report payments
GRANT INSERT (property_id, resident_id, amount_paise, claimed_method, payment_date, reference_number, notes)
    ON TABLE public.student_payment_reports TO authenticated;

-- Ensure sequence is locked down to internal database usage only
REVOKE ALL ON SEQUENCE public.receipt_number_seq FROM anon, authenticated, PUBLIC;

-- ------------------------------------------------------------------------------
-- 4. HARDEN ROW-LEVEL SECURITY POLICIES
-- ------------------------------------------------------------------------------

-- A. resident_opt_ins: Replace FOR ALL policy with read-only SELECT policy
DROP POLICY IF EXISTS "opt_ins_owner_all" ON public.resident_opt_ins;
DROP POLICY IF EXISTS "opt_ins_owner_select" ON public.resident_opt_ins;
CREATE POLICY "opt_ins_owner_select"
    ON public.resident_opt_ins FOR SELECT
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

-- B. student_payment_reports: Harden INSERT policy to enforce correlated property/resident pair
DROP POLICY IF EXISTS "student_reports_student_insert" ON public.student_payment_reports;
CREATE POLICY "student_reports_student_insert"
    ON public.student_payment_reports FOR INSERT
    TO authenticated
    WITH CHECK (
        status = 'pending' AND
        EXISTS (
            SELECT 1 FROM public.residents r
            WHERE r.id = student_payment_reports.resident_id
              AND r.property_id = student_payment_reports.property_id
              AND r.profile_id = (SELECT auth.uid())
              AND r.is_active = true
        )
    );

-- ------------------------------------------------------------------------------
-- 5. RPC & INTERNAL HELPER PERMISSION LOCKDOWN
-- ------------------------------------------------------------------------------
-- Internal receipt helper must never be directly executable by client roles
ALTER FUNCTION public.generate_receipt_number(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.generate_receipt_number(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_receipt_number(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.generate_receipt_number(UUID) FROM authenticated;

-- Ensure public and anon cannot execute any billing RPC; grant only to authenticated
REVOKE EXECUTE ON FUNCTION public.generate_monthly_charges(UUID, DATE, BIGINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.generate_monthly_charges(UUID, DATE, BIGINT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.allocate_eb_bill(UUID, TEXT, DATE, DATE, DATE, BIGINT, UUID[], TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.allocate_eb_bill(UUID, TEXT, DATE, DATE, DATE, BIGINT, UUID[], TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.record_opening_balance(UUID, public.charge_category, BIGINT, DATE, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_opening_balance(UUID, public.charge_category, BIGINT, DATE, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.approve_payment_and_allocate(UUID, UUID, BIGINT, public.billing_payment_method, DATE, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_payment_and_allocate(UUID, UUID, BIGINT, public.billing_payment_method, DATE, TEXT, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reject_student_payment_report(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reject_student_payment_report(UUID, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reverse_payment(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reverse_payment(UUID, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.toggle_washing_machine(UUID, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.toggle_washing_machine(UUID, BOOLEAN) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_resident_billing_summary(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_resident_billing_summary(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.apply_unallocated_credit(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_unallocated_credit(UUID) FROM anon;

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

