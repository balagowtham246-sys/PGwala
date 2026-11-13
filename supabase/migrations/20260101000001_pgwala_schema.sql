-- ==============================================================================
-- PGwala Complete Database Schema & Security Specification
-- File: supabase/pgwala_schema.sql
-- Description:
--   Complete schema for PG accommodation management.
--   Includes:
--     - public.profiles (linked 1:1 to auth.users, role-protected)
--     - public.properties (PG property tenant root)
--     - public.residents (student records, room allocation, soft deactivation)
--     - public.movement_logs (append-only student IN/OUT gate records)
--     - Row Level Security (RLS) policies (idempotent with DROP POLICY IF EXISTS)
--     - Defense-in-depth SQL grants & column-level restrictions
--     - Hardened SECURITY DEFINER helpers
--     - Automated updated_at triggers
--     - Auth user signup trigger
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. EXTENSIONS & CUSTOM ENUM TYPES
-- ------------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$ BEGIN
    CREATE TYPE public.user_role AS ENUM ('owner', 'student');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE public.movement_direction AS ENUM ('IN', 'OUT');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- ------------------------------------------------------------------------------
-- 2. APPLICATION TABLES
-- ------------------------------------------------------------------------------

-- Table: public.profiles (Linked 1:1 to auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    phone_number TEXT,
    role public.user_role NOT NULL DEFAULT 'student',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: public.properties (Tenant boundary for PG accommodation)
CREATE TABLE IF NOT EXISTS public.properties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    address TEXT,
    owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: public.residents (Resident directory within a PG property)
CREATE TABLE IF NOT EXISTS public.residents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
    profile_id UUID UNIQUE REFERENCES public.profiles(id) ON DELETE SET NULL,
    full_name TEXT NOT NULL,
    phone_number TEXT,
    room_number TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: public.movement_logs (Append-only gate access record)
CREATE TABLE IF NOT EXISTS public.movement_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resident_id UUID NOT NULL REFERENCES public.residents(id) ON DELETE RESTRICT,
    direction public.movement_direction NOT NULL,
    event_time TIMESTAMPTZ NOT NULL DEFAULT now(),
    note TEXT,
    recorded_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 3. INDEXES
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_properties_owner_id ON public.properties(owner_id);
CREATE INDEX IF NOT EXISTS idx_residents_property_id ON public.residents(property_id);
CREATE INDEX IF NOT EXISTS idx_residents_profile_id ON public.residents(profile_id);
CREATE INDEX IF NOT EXISTS idx_residents_active ON public.residents(is_active);
CREATE INDEX IF NOT EXISTS idx_movement_logs_resident_time ON public.movement_logs(resident_id, event_time DESC);
CREATE INDEX IF NOT EXISTS idx_movement_logs_recorded_by ON public.movement_logs(recorded_by);

-- ------------------------------------------------------------------------------
-- 4. SECURITY DEFINER HELPER FUNCTIONS
-- ------------------------------------------------------------------------------

-- Check if authenticated caller is an owner (bypasses RLS recursion on profiles)
CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = (SELECT auth.uid()) AND role = 'owner'
    );
$$;

-- Retrieve set of property IDs owned by authenticated caller
CREATE OR REPLACE FUNCTION public.get_my_property_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
    SELECT id FROM public.properties
    WHERE owner_id = (SELECT auth.uid());
$$;

-- ------------------------------------------------------------------------------
-- 5. DEFENSE-IN-DEPTH: SCOPED SQL GRANTS & COLUMN PERMISSIONS
-- ------------------------------------------------------------------------------

-- A. Strip ALL permissions on PGwala tables from anonymous clients
REVOKE ALL ON TABLE public.profiles FROM anon;
REVOKE ALL ON TABLE public.properties FROM anon;
REVOKE ALL ON TABLE public.residents FROM anon;
REVOKE ALL ON TABLE public.movement_logs FROM anon;

-- B. Strip existing/inherited table-level INSERT, UPDATE, and DELETE from authenticated
REVOKE INSERT, UPDATE, DELETE ON TABLE public.profiles FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.properties FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.residents FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.movement_logs FROM authenticated;

-- C. Explicit SELECT grants
GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT SELECT ON TABLE public.properties TO authenticated;
GRANT SELECT ON TABLE public.residents TO authenticated;
GRANT SELECT ON TABLE public.movement_logs TO authenticated;

-- D. Explicit INSERT grants
GRANT INSERT ON TABLE public.profiles TO authenticated;
GRANT INSERT ON TABLE public.properties TO authenticated;
GRANT INSERT ON TABLE public.residents TO authenticated;
-- Column-scoped INSERT on movement_logs: id, event_time, and created_at cannot be provided by clients
GRANT INSERT (resident_id, direction, note, recorded_by) ON TABLE public.movement_logs TO authenticated;

-- E. Explicit Column-Level UPDATE grants
-- profiles: role and updated_at omitted (students cannot self-escalate)
GRANT UPDATE (full_name, phone_number) ON TABLE public.profiles TO authenticated;

-- properties: updated_at omitted; DELETE denied
GRANT UPDATE (name, address, is_active) ON TABLE public.properties TO authenticated;

-- residents: property_id, profile_id, and updated_at omitted; DELETE denied
-- (profile_id is writeable ONLY on INSERT to prevent account hijacking/re-linking)
GRANT UPDATE (full_name, phone_number, room_number, is_active) ON TABLE public.residents TO authenticated;

-- movement_logs: NO UPDATE or DELETE is granted to anyone under any circumstances.

-- F. Routine Execution Grants
REVOKE EXECUTE ON FUNCTION public.is_owner() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_property_ids() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_owner() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_property_ids() TO authenticated;

-- ------------------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY (RLS) POLICIES
-- ------------------------------------------------------------------------------

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.residents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movement_logs ENABLE ROW LEVEL SECURITY;

-- === PROFILES POLICIES ===

DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "profiles_select_owner_residents" ON public.profiles;
CREATE POLICY "profiles_select_owner_residents"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (
        public.is_owner() AND id IN (
            SELECT r.profile_id FROM public.residents r
            WHERE r.property_id IN (SELECT public.get_my_property_ids())
        )
    );

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (id = (SELECT auth.uid()))
    WITH CHECK (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own"
    ON public.profiles FOR INSERT
    TO authenticated
    WITH CHECK (
        id = (SELECT auth.uid()) AND
        role = 'student'
    );

-- === PROPERTIES POLICIES (Explicit SELECT, INSERT, UPDATE; No DELETE) ===

DROP POLICY IF EXISTS "properties_owner_manage" ON public.properties;
DROP POLICY IF EXISTS "properties_owner_select" ON public.properties;
CREATE POLICY "properties_owner_select"
    ON public.properties FOR SELECT
    TO authenticated
    USING (owner_id = (SELECT auth.uid()) AND public.is_owner());

DROP POLICY IF EXISTS "properties_owner_insert" ON public.properties;
CREATE POLICY "properties_owner_insert"
    ON public.properties FOR INSERT
    TO authenticated
    WITH CHECK (owner_id = (SELECT auth.uid()) AND public.is_owner());

DROP POLICY IF EXISTS "properties_owner_update" ON public.properties;
CREATE POLICY "properties_owner_update"
    ON public.properties FOR UPDATE
    TO authenticated
    USING (owner_id = (SELECT auth.uid()) AND public.is_owner())
    WITH CHECK (owner_id = (SELECT auth.uid()) AND public.is_owner());

DROP POLICY IF EXISTS "properties_resident_view" ON public.properties;
CREATE POLICY "properties_resident_view"
    ON public.properties FOR SELECT
    TO authenticated
    USING (
        id IN (
            SELECT property_id FROM public.residents
            WHERE profile_id = (SELECT auth.uid())
        )
    );

-- === RESIDENTS POLICIES ===

DROP POLICY IF EXISTS "residents_owner_all" ON public.residents;
DROP POLICY IF EXISTS "residents_owner_select" ON public.residents;
CREATE POLICY "residents_owner_select"
    ON public.residents FOR SELECT
    TO authenticated
    USING (
        property_id IN (SELECT public.get_my_property_ids()) AND public.is_owner()
    );

DROP POLICY IF EXISTS "residents_owner_insert" ON public.residents;
CREATE POLICY "residents_owner_insert"
    ON public.residents FOR INSERT
    TO authenticated
    WITH CHECK (
        property_id IN (SELECT public.get_my_property_ids()) AND public.is_owner()
    );

DROP POLICY IF EXISTS "residents_owner_update" ON public.residents;
CREATE POLICY "residents_owner_update"
    ON public.residents FOR UPDATE
    TO authenticated
    USING (
        property_id IN (SELECT public.get_my_property_ids()) AND public.is_owner()
    )
    WITH CHECK (
        property_id IN (SELECT public.get_my_property_ids()) AND public.is_owner()
    );

DROP POLICY IF EXISTS "residents_student_select_own" ON public.residents;
CREATE POLICY "residents_student_select_own"
    ON public.residents FOR SELECT
    TO authenticated
    USING (profile_id = (SELECT auth.uid()));

-- === MOVEMENT LOGS POLICIES ===

DROP POLICY IF EXISTS "movement_logs_owner_insert" ON public.movement_logs;
CREATE POLICY "movement_logs_owner_insert"
    ON public.movement_logs FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_owner() AND
        recorded_by = (SELECT auth.uid()) AND
        resident_id IN (
            SELECT id FROM public.residents
            WHERE property_id IN (SELECT public.get_my_property_ids())
        )
    );

DROP POLICY IF EXISTS "movement_logs_owner_select" ON public.movement_logs;
CREATE POLICY "movement_logs_owner_select"
    ON public.movement_logs FOR SELECT
    TO authenticated
    USING (
        public.is_owner() AND
        resident_id IN (
            SELECT id FROM public.residents
            WHERE property_id IN (SELECT public.get_my_property_ids())
        )
    );

DROP POLICY IF EXISTS "movement_logs_student_select_own" ON public.movement_logs;
CREATE POLICY "movement_logs_student_select_own"
    ON public.movement_logs FOR SELECT
    TO authenticated
    USING (
        resident_id IN (
            SELECT id FROM public.residents
            WHERE profile_id = (SELECT auth.uid())
        )
    );

-- ------------------------------------------------------------------------------
-- 7. AUTOMATED TIMESTAMPS: updated_at TRIGGER FUNCTION & TRIGGERS
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- Security hardening: Revoke execution from PUBLIC.
-- Triggers run within postgres table context; authenticated clients do NOT need direct EXECUTE rights.
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO postgres;

DROP TRIGGER IF EXISTS trigger_set_updated_at_profiles ON public.profiles;
CREATE TRIGGER trigger_set_updated_at_profiles
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trigger_set_updated_at_properties ON public.properties;
CREATE TRIGGER trigger_set_updated_at_properties
    BEFORE UPDATE ON public.properties
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trigger_set_updated_at_residents ON public.residents;
CREATE TRIGGER trigger_set_updated_at_residents
    BEFORE UPDATE ON public.residents
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------------------------
-- 8. AUTH TRIGGER FUNCTION (Auto-create profile entry on auth.users sign-up)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, phone_number, role)
    VALUES (
        new.id,
        COALESCE(new.raw_user_meta_data->>'full_name', 'Resident User'),
        new.phone,
        'student'::public.user_role
    );
    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO postgres;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
