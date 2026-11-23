-- ==============================================================================
-- PGwala In-App Delete RLS Policies
-- File: supabase/migrations/20260101000033_in_app_delete_policies.sql
--
-- Enables safe, scoped in-app DELETE actions for:
--   1. Announcements (owner can delete their property's announcements)
--   2. Complaints (owner can delete property complaints; resident can delete own open complaints)
--   3. Properties (owner can delete an empty property with 0 active residents)
--   4. Residents (owner can permanently delete mistakenly added / checked-out residents)
-- ==============================================================================

BEGIN;

-- Ensure authenticated role has table-level DELETE privilege (RLS policies still enforce row-level ownership)
GRANT DELETE ON TABLE
    public.announcements,
    public.complaints,
    public.properties,
    public.residents
TO authenticated;

-- 1. Announcements DELETE (owner-scoped)
DROP POLICY IF EXISTS "owners_delete_own_announcements" ON public.announcements;
CREATE POLICY "owners_delete_own_announcements"
    ON public.announcements
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.properties p
            WHERE p.id = announcements.property_id
              AND p.owner_id = (SELECT auth.uid())
              AND public.is_owner()
        )
    );

-- 2. Complaints DELETE (owner-scoped + resident own open complaints)
DROP POLICY IF EXISTS "owners_delete_property_complaints" ON public.complaints;
CREATE POLICY "owners_delete_property_complaints"
    ON public.complaints
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.properties p
            WHERE p.id = complaints.property_id
              AND p.owner_id = (SELECT auth.uid())
              AND public.is_owner()
        )
    );

DROP POLICY IF EXISTS "students_delete_own_open_complaints" ON public.complaints;
CREATE POLICY "students_delete_own_open_complaints"
    ON public.complaints
    FOR DELETE
    TO authenticated
    USING (
        complaints.status = 'open'
        AND EXISTS (
            SELECT 1
            FROM public.residents r
            WHERE r.id = complaints.resident_id
              AND r.profile_id = (SELECT auth.uid())
        )
    );

-- 3. Properties DELETE (owner-scoped, only when 0 active residents remain)
DROP POLICY IF EXISTS "owners_delete_empty_properties" ON public.properties;
CREATE POLICY "owners_delete_empty_properties"
    ON public.properties
    FOR DELETE
    TO authenticated
    USING (
        properties.owner_id = (SELECT auth.uid())
        AND public.is_owner()
        AND NOT EXISTS (
            SELECT 1
            FROM public.residents r
            WHERE r.property_id = properties.id
              AND r.is_active = true
        )
    );

-- 4. Residents DELETE (owner-scoped)
DROP POLICY IF EXISTS "owners_delete_property_residents" ON public.residents;
CREATE POLICY "owners_delete_property_residents"
    ON public.residents
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.properties p
            WHERE p.id = residents.property_id
              AND p.owner_id = (SELECT auth.uid())
              AND public.is_owner()
        )
    );

COMMIT;
