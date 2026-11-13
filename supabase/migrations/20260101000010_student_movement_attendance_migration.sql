-- ==============================================================================
-- PGWALA STUDENT-DRIVEN GATE MOVEMENT & ATTENDANCE MIGRATION
-- File: supabase/student_movement_attendance_migration.sql
-- ==============================================================================
-- Modifies movement logs so students directly mark their In/Out status,
-- conveying purpose of leaving, expected return time, and food requirements.
-- Owners have a live view-only attendance roster.
-- ==============================================================================

-- 1. ENSURE TYPE AND MOVEMENT_LOGS TABLE EXIST
DO $$ BEGIN
    CREATE TYPE public.movement_direction AS ENUM ('IN', 'OUT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.movement_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resident_id UUID NOT NULL REFERENCES public.residents(id) ON DELETE RESTRICT,
    direction public.movement_direction NOT NULL,
    event_time TIMESTAMPTZ NOT NULL DEFAULT now(),
    note TEXT,
    purpose TEXT,
    expected_return_time TEXT,
    food_required BOOLEAN NOT NULL DEFAULT true,
    recorded_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Extend table with detail columns if table already existed prior
ALTER TABLE public.movement_logs
ADD COLUMN IF NOT EXISTS purpose TEXT,
ADD COLUMN IF NOT EXISTS expected_return_time TEXT,
ADD COLUMN IF NOT EXISTS food_required BOOLEAN NOT NULL DEFAULT true;

-- Ensure indexes exist
CREATE INDEX IF NOT EXISTS idx_movement_logs_resident_time ON public.movement_logs(resident_id, event_time DESC);
CREATE INDEX IF NOT EXISTS idx_movement_logs_recorded_by ON public.movement_logs(recorded_by);

-- Enable RLS
ALTER TABLE public.movement_logs ENABLE ROW LEVEL SECURITY;

-- 2. UPDATE TABLE GRANTS FOR AUTHENTICATED USERS
GRANT SELECT ON TABLE public.movement_logs TO authenticated;
GRANT INSERT (resident_id, direction, note, recorded_by, purpose, expected_return_time, food_required) 
ON TABLE public.movement_logs TO authenticated;

-- 3. RLS POLICIES FOR MOVEMENT LOGS
-- Allow students to insert their own movement logs
DROP POLICY IF EXISTS "movement_logs_student_insert_own" ON public.movement_logs;
CREATE POLICY "movement_logs_student_insert_own"
    ON public.movement_logs FOR INSERT
    TO authenticated
    WITH CHECK (
        recorded_by = (SELECT auth.uid()) AND
        resident_id IN (
            SELECT id FROM public.residents
            WHERE profile_id = (SELECT auth.uid()) AND is_active = true
        )
    );

-- Keep owner insert policy in case needed by migration/system scripts
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

-- Ensure students can read their own logs
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

-- Ensure owners can view all logs for their properties
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

-- 4. ATOMIC SECURITY DEFINER RPC: record_student_movement
-- Allows a student to atomically update their In/Out status
CREATE OR REPLACE FUNCTION public.record_student_movement(
    p_direction public.movement_direction,
    p_purpose TEXT DEFAULT NULL,
    p_expected_return_time TEXT DEFAULT NULL,
    p_food_required BOOLEAN DEFAULT true,
    p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_resident RECORD;
    v_log_id UUID;
    v_trimmed_purpose TEXT;
    v_trimmed_return TEXT;
    v_trimmed_note TEXT;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Authentication required.');
    END IF;

    -- Find the caller's active resident record
    SELECT id, property_id, full_name, room_number
    INTO v_resident
    FROM public.residents
    WHERE profile_id = v_caller_id AND is_active = true
    LIMIT 1;

    IF v_resident.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'No active resident record found for your account.');
    END IF;

    v_trimmed_purpose := NULLIF(pg_catalog.btrim(p_purpose), '');
    v_trimmed_return := NULLIF(pg_catalog.btrim(p_expected_return_time), '');
    v_trimmed_note := NULLIF(pg_catalog.btrim(p_note), '');

    -- Insert append-only movement log
    INSERT INTO public.movement_logs (
        resident_id,
        direction,
        event_time,
        purpose,
        expected_return_time,
        food_required,
        note,
        recorded_by,
        created_at
    )
    VALUES (
        v_resident.id,
        p_direction,
        now(),
        v_trimmed_purpose,
        v_trimmed_return,
        COALESCE(p_food_required, true),
        v_trimmed_note,
        v_caller_id,
        now()
    )
    RETURNING id INTO v_log_id;

    RETURN jsonb_build_object(
        'success', true,
        'log_id', v_log_id,
        'direction', p_direction,
        'resident_id', v_resident.id,
        'resident_name', v_resident.full_name,
        'room_number', v_resident.room_number,
        'event_time', now(),
        'purpose', v_trimmed_purpose,
        'expected_return_time', v_trimmed_return,
        'food_required', COALESCE(p_food_required, true)
    );
END;
$$;

-- Permissions for record_student_movement
REVOKE EXECUTE ON FUNCTION public.record_student_movement(public.movement_direction, TEXT, TEXT, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_student_movement(public.movement_direction, TEXT, TEXT, BOOLEAN, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_student_movement(public.movement_direction, TEXT, TEXT, BOOLEAN, TEXT) TO authenticated;
