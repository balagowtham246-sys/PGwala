-- ==============================================================================
-- Phase 0 / Task 2: Lock Down public.app_versions RLS & Grants
-- File: supabase/phase0_2_lock_app_versions_rls.sql
--
-- Purpose:
--   Removes the overly permissive policy that allowed any PG owner to update
--   global app_versions rows (min_version, apk_download_url, is_mandatory).
--   Enforces read-only SELECT access for anon & authenticated clients.
--   Updates to app_versions must be performed via service_role or SQL Editor.
-- ==============================================================================

BEGIN;

ALTER TABLE public.app_versions ENABLE ROW LEVEL SECURITY;

-- 1. Drop the permissive owner write policy
DROP POLICY IF EXISTS "Allow owners to update app_versions" ON public.app_versions;

-- 2. Revoke all write/truncate privileges from client roles
REVOKE ALL ON TABLE public.app_versions FROM anon, authenticated, PUBLIC;
GRANT SELECT ON TABLE public.app_versions TO anon, authenticated;

-- 3. Ensure public read-only SELECT policy remains intact
DROP POLICY IF EXISTS "Allow public read app_versions" ON public.app_versions;
CREATE POLICY "Allow public read app_versions"
    ON public.app_versions
    FOR SELECT
    USING (true);

COMMIT;

-- Verification: Confirm only SELECT policy exists on public.app_versions
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'app_versions';

SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'app_versions'
  AND grantee IN ('anon', 'authenticated', 'PUBLIC')
ORDER BY grantee, privilege_type;
