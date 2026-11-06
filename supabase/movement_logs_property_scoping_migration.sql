-- ==============================================================================
-- PGwala Movement Logs Property Scoping & Realtime Optimization Migration
-- File: supabase/movement_logs_property_scoping_migration.sql
-- ==============================================================================
-- Objectives:
-- 1. Add property_id to public.movement_logs for direct property partitioning.
-- 2. Backfill existing movement_logs with property_id from public.residents.
-- 3. Install a BEFORE INSERT trigger (trg_set_movement_log_property_id) to guarantee
--    property_id is always populated even on legacy or raw inserts.
-- 4. Create performant composite index on (property_id, event_time DESC).
-- 5. Update atomic RPC record_student_movement to explicitly populate property_id.
-- 6. Grant INSERT on property_id to authenticated users.
-- 7. Update RLS policies to leverage direct property_id evaluation without joins.
-- 8. Enable REPLICA IDENTITY FULL and ensure publication in supabase_realtime.
-- ==============================================================================

BEGIN;

-- 1. Add property_id column
ALTER TABLE public.movement_logs
ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES public.properties(id) ON DELETE RESTRICT;

-- 2. Backfill existing records
UPDATE public.movement_logs m
SET property_id = r.property_id
FROM public.residents r
WHERE m.resident_id = r.id AND m.property_id IS NULL;

-- 3. Trigger Function to guarantee property_id is populated on every insert
CREATE OR REPLACE FUNCTION public.set_movement_log_property_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.property_id IS NULL THEN
        SELECT property_id INTO NEW.property_id
        FROM public.residents
        WHERE id = NEW.resident_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_movement_log_property_id ON public.movement_logs;
CREATE TRIGGER trg_set_movement_log_property_id
    BEFORE INSERT ON public.movement_logs
    FOR EACH ROW EXECUTE FUNCTION public.set_movement_log_property_id();

-- 4. Composite Index for property-scoped range queries
CREATE INDEX IF NOT EXISTS idx_movement_logs_property_event_time
ON public.movement_logs (property_id, event_time DESC);

-- 5. Update column grants for authenticated role
GRANT INSERT (property_id, resident_id, direction, note, recorded_by, purpose, expected_return_time, food_required)
ON TABLE public.movement_logs TO authenticated;

-- 6. Update Owner Select Policy to utilize property_id directly
DROP POLICY IF EXISTS "movement_logs_owner_select" ON public.movement_logs;
CREATE POLICY "movement_logs_owner_select"
    ON public.movement_logs FOR SELECT
    TO authenticated
    USING (
        public.is_owner() AND (
            property_id IN (SELECT public.get_my_property_ids())
            OR
            (property_id IS NULL AND resident_id IN (
                SELECT id FROM public.residents
                WHERE property_id IN (SELECT public.get_my_property_ids())
            ))
        )
    );

-- 7. Update Student Select Policy
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

-- 8. Update Atomic RPC: record_student_movement to explicitly write property_id
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

    -- Insert append-only movement log with explicit property_id
    INSERT INTO public.movement_logs (
        property_id,
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
        v_resident.property_id,
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
        'property_id', v_resident.property_id,
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

REVOKE EXECUTE ON FUNCTION public.record_student_movement(public.movement_direction, TEXT, TEXT, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_student_movement(public.movement_direction, TEXT, TEXT, BOOLEAN, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_student_movement(public.movement_direction, TEXT, TEXT, BOOLEAN, TEXT) TO authenticated;

-- 9. Realtime publication & replica identity
ALTER TABLE public.movement_logs REPLICA IDENTITY FULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.movement_logs;
    END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;

