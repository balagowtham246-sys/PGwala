-- ==============================================================================
-- Phase 0 / Task 3: Read-Only Live Supabase Security & Schema Audit
-- File: supabase/phase0_3_readonly_audit.sql
--
-- Purpose:
--   100% READ-ONLY inspection of your live Supabase database.
--   Run this in the Supabase SQL Editor and paste the query outputs back
--   so we can confirm live bucket privacy, RLS policies, and applied RPCs.
-- ==============================================================================

-- 1. Storage Bucket Privacy & Limits
SELECT
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
FROM storage.buckets
WHERE id IN ('payment-proofs', 'complaint-photos')
ORDER BY id;

-- 2. Storage Object RLS Policies (payment-proofs & complaint-photos)
SELECT
    policyname,
    cmd,
    roles,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND (
      policyname ILIKE '%payment%'
      OR policyname ILIKE '%complaint%'
      OR qual ILIKE '%payment-proofs%'
      OR qual ILIKE '%complaint-photos%'
      OR with_check ILIKE '%payment-proofs%'
      OR with_check ILIKE '%complaint-photos%'
  )
ORDER BY policyname;

-- 3. Public Tables Existence & RLS Enabled Status
SELECT
    c.relname AS table_name,
    c.relrowsecurity AS rls_enabled,
    c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY c.relname;

-- 4. All RLS Policies on Public Tables
SELECT
    tablename,
    policyname,
    cmd,
    roles,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 5. Key RPC Functions (Existence, SECURITY DEFINER, search_path, and movement_logs check)
SELECT
    p.proname AS function_name,
    pg_get_function_identity_arguments(p.oid) AS args,
    p.prosecdef AS security_definer,
    p.proconfig AS function_config,
    CASE
        WHEN p.proname IN ('get_owner_dashboard_summary', 'get_student_dashboard_summary')
        THEN pg_get_functiondef(p.oid) LIKE '%student_movement_logs%'
        ELSE NULL
    END AS has_broken_student_movement_logs_ref
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
      'is_owner',
      'get_my_property_ids',
      'create_or_link_resident_with_auth',
      'link_resident_profile',
      'unlink_resident_profile',
      'record_student_movement',
      'generate_monthly_charges',
      'generate_monthly_bills',
      'allocate_eb_bill',
      'approve_payment_and_allocate',
      'reject_student_payment_report',
      'reverse_payment',
      'submit_student_payment_proof',
      'toggle_washing_machine',
      'get_or_create_wm_units',
      'request_wm_access',
      'set_property_wm_count',
      'get_owner_dashboard_summary',
      'get_student_dashboard_summary'
  )
ORDER BY p.proname;
