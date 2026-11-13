-- ==============================================================================
-- PGwala Complaints & Maintenance Ticketing System Migration
-- File: supabase/complaints_migration.sql
--
-- Capabilities:
-- 1. Student issue reporting across standardized categories (plumbing, electrical, Wi-Fi, etc.)
-- 2. Owner issue tracking, status workflows (open -> in_progress -> resolved / rejected), and resolution notes
-- 3. Strict Row Level Security:
--    - Students can ONLY insert complaints for their own active resident record
--    - Students cannot tamper with status, owner_notes, or resolved_at during insert
--    - Students can only view their own submitted complaints
--    - Owners can only view and update complaints for properties they own
-- 4. Automated timestamp management via set_updated_at trigger
-- ==============================================================================

-- 1. Enums for Categorization, Priority & Status Lifecycle
DO $$ BEGIN
    CREATE TYPE public.complaint_category AS ENUM (
        'plumbing',
        'electrical',
        'wifi_internet',
        'cleaning',
        'food_mess',
        'carpentry_furniture',
        'other'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE public.complaint_priority AS ENUM (
        'low',
        'medium',
        'high',
        'urgent'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE public.complaint_status AS ENUM (
        'open',
        'in_progress',
        'resolved',
        'rejected'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- 2. Complaints Table
CREATE TABLE IF NOT EXISTS public.complaints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
    resident_id UUID NOT NULL REFERENCES public.residents(id) ON DELETE RESTRICT,
    category public.complaint_category NOT NULL,
    priority public.complaint_priority NOT NULL DEFAULT 'medium',
    status public.complaint_status NOT NULL DEFAULT 'open',
    title TEXT NOT NULL CHECK (char_length(title) >= 3 AND char_length(title) <= 120),
    description TEXT NOT NULL CHECK (char_length(description) >= 5),
    photo_url TEXT,
    owner_notes TEXT,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Indexes for Dashboard Queries & History Filtering
CREATE INDEX IF NOT EXISTS idx_complaints_property_status
    ON public.complaints (property_id, status);

CREATE INDEX IF NOT EXISTS idx_complaints_resident_created
    ON public.complaints (resident_id, created_at DESC);

-- 4. Grants & Least-Privilege Access Controls
REVOKE ALL ON TABLE public.complaints FROM anon;
REVOKE TRUNCATE, DELETE ON TABLE public.complaints FROM authenticated, anon, PUBLIC;

GRANT SELECT ON TABLE public.complaints TO authenticated;

-- Column-level INSERT permissions: Clients cannot directly set status, owner_notes, or resolved_at
GRANT INSERT (property_id, resident_id, category, priority, title, description, photo_url)
    ON TABLE public.complaints TO authenticated;

-- Column-level UPDATE permissions: Permitted for status transitions and resolution notes
GRANT UPDATE (status, owner_notes, resolved_at)
    ON TABLE public.complaints TO authenticated;

-- 5. Row Level Security (RLS)
ALTER TABLE public.complaints ENABLE ROW LEVEL SECURITY;

-- Policy A: Students can only insert complaints for their own verified, active resident record
DROP POLICY IF EXISTS "complaints_student_insert" ON public.complaints;
CREATE POLICY "complaints_student_insert"
    ON public.complaints FOR INSERT
    TO authenticated
    WITH CHECK (
        resident_id IN (
            SELECT r.id FROM public.residents r
            WHERE r.profile_id = (SELECT auth.uid())
              AND r.property_id = complaints.property_id
              AND r.is_active = true
        )
    );

-- Policy B: Students can only view their own complaints
DROP POLICY IF EXISTS "complaints_student_select_own" ON public.complaints;
CREATE POLICY "complaints_student_select_own"
    ON public.complaints FOR SELECT
    TO authenticated
    USING (
        resident_id IN (
            SELECT r.id FROM public.residents r
            WHERE r.profile_id = (SELECT auth.uid())
        )
    );

-- Policy C: Owners can view all complaints for their properties
DROP POLICY IF EXISTS "complaints_owner_select" ON public.complaints;
CREATE POLICY "complaints_owner_select"
    ON public.complaints FOR SELECT
    TO authenticated
    USING (
        property_id IN (SELECT public.get_my_property_ids())
        AND public.is_owner()
    );

-- Policy D: Owners can update complaints (status, notes, resolution) for properties they own
DROP POLICY IF EXISTS "complaints_owner_update" ON public.complaints;
CREATE POLICY "complaints_owner_update"
    ON public.complaints FOR UPDATE
    TO authenticated
    USING (
        property_id IN (SELECT public.get_my_property_ids())
        AND public.is_owner()
    )
    WITH CHECK (
        property_id IN (SELECT public.get_my_property_ids())
        AND public.is_owner()
    );

-- 6. Trigger for updated_at Automated Timestamps
DROP TRIGGER IF EXISTS trigger_set_complaints_updated_at ON public.complaints;
CREATE TRIGGER trigger_set_complaints_updated_at
    BEFORE UPDATE ON public.complaints
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

