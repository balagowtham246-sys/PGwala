-- ==============================================================================
-- PGWALA REAL-TIME WASHING MACHINE STATUS MIGRATION
-- ==============================================================================
-- Single shared washing machine per property with live availability, 
-- atomic state transitions, strict resident-only controls, and multi-tenant RLS.
-- ==============================================================================

-- 1. ENUM FOR MACHINE STATUS
DO $$ BEGIN
    CREATE TYPE public.washing_machine_status_type AS ENUM ('free', 'in_use');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- 2. TABLE: public.washing_machine_status
-- Exactly one status record per property (enforced by PK property_id)
CREATE TABLE IF NOT EXISTS public.washing_machine_status (
    property_id UUID PRIMARY KEY REFERENCES public.properties(id) ON DELETE CASCADE,
    status public.washing_machine_status_type NOT NULL DEFAULT 'free',
    current_resident_id UUID REFERENCES public.residents(id) ON DELETE SET NULL,
    started_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Invariants:
    -- When 'free': current_resident_id and started_at MUST BE NULL
    -- When 'in_use': current_resident_id and started_at MUST NOT BE NULL
    CONSTRAINT chk_wm_status_invariants CHECK (
        (status = 'free' AND current_resident_id IS NULL AND started_at IS NULL) OR
        (status = 'in_use' AND current_resident_id IS NOT NULL AND started_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_wm_status_property_id ON public.washing_machine_status(property_id);
CREATE INDEX IF NOT EXISTS idx_wm_status_resident_id ON public.washing_machine_status(current_resident_id);

-- 3. PUBLICATION FOR SUPABASE REALTIME
-- Safely add washing_machine_status to supabase_realtime publication if publication exists
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.washing_machine_status;
    END IF;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Enable REPLICA IDENTITY FULL so updates broadcast complete row data in Realtime payloads
ALTER TABLE public.washing_machine_status REPLICA IDENTITY FULL;

-- 4. ROW LEVEL SECURITY (RLS)
ALTER TABLE public.washing_machine_status ENABLE ROW LEVEL SECURITY;

-- 4.1 SELECT POLICY: Authenticated Owners of the property
DROP POLICY IF EXISTS "wm_status_owner_select" ON public.washing_machine_status;
CREATE POLICY "wm_status_owner_select"
    ON public.washing_machine_status FOR SELECT
    TO authenticated
    USING (
        property_id IN (
            SELECT id FROM public.properties WHERE owner_id = (SELECT auth.uid())
        )
    );

-- 4.2 SELECT POLICY: Authenticated Active Residents of the property
DROP POLICY IF EXISTS "wm_status_resident_select" ON public.washing_machine_status;
CREATE POLICY "wm_status_resident_select"
    ON public.washing_machine_status FOR SELECT
    TO authenticated
    USING (
        property_id IN (
            SELECT property_id FROM public.residents
            WHERE profile_id = (SELECT auth.uid()) AND is_active = true
        )
    );

-- 5. LEAST-PRIVILEGE PERMISSIONS (Defense in depth)
-- Clients cannot perform direct INSERT, UPDATE, or DELETE on washing_machine_status.
-- All state transitions and safe initialization route through SECURITY DEFINER RPCs.
REVOKE ALL ON TABLE public.washing_machine_status FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.washing_machine_status FROM authenticated;
GRANT SELECT ON TABLE public.washing_machine_status TO authenticated;

-- 6. SECURITY DEFINER RPC: get_or_create_wm_status
-- Ensures exactly one record exists per property with concurrency protection.
CREATE OR REPLACE FUNCTION public.get_or_create_wm_status(p_property_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID;
    v_is_authorized BOOLEAN := false;
    v_record public.washing_machine_status%ROWTYPE;
    v_resident_name TEXT := NULL;
    v_resident_room TEXT := NULL;
BEGIN
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthenticated request.');
    END IF;

    -- Verify caller is either the owner or an active resident of this property
    IF EXISTS (
        SELECT 1 FROM public.properties 
        WHERE id = p_property_id AND owner_id = v_uid
    ) THEN
        v_is_authorized := true;
    ELSIF EXISTS (
        SELECT 1 FROM public.residents 
        WHERE property_id = p_property_id AND profile_id = v_uid AND is_active = true
    ) THEN
        v_is_authorized := true;
    END IF;

    IF NOT v_is_authorized THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized. You do not belong to this property.');
    END IF;

    -- Idempotent upsert to ensure the row exists without duplicate collision
    INSERT INTO public.washing_machine_status (property_id, status, current_resident_id, started_at, updated_at)
    VALUES (p_property_id, 'free', NULL, NULL, now())
    ON CONFLICT (property_id) DO NOTHING;

    -- Read current status
    SELECT * INTO v_record
    FROM public.washing_machine_status
    WHERE property_id = p_property_id;

    -- If in_use, fetch resident display name and room safely
    IF v_record.status = 'in_use' AND v_record.current_resident_id IS NOT NULL THEN
        SELECT full_name, room_number INTO v_resident_name, v_resident_room
        FROM public.residents
        WHERE id = v_record.current_resident_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'property_id', v_record.property_id,
        'status', v_record.status,
        'current_resident_id', v_record.current_resident_id,
        'current_resident_name', COALESCE(v_resident_name, 'A resident'),
        'current_resident_room', v_resident_room,
        'started_at', v_record.started_at,
        'updated_at', v_record.updated_at
    );
END;
$$;

-- 7. SECURITY DEFINER RPC: start_washing_machine
-- Resident starts machine: validates active residency, ensures status is 'free',
-- locks row FOR UPDATE to prevent race conditions.
CREATE OR REPLACE FUNCTION public.start_washing_machine(p_property_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID;
    v_resident RECORD;
    v_current RECORD;
BEGIN
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthenticated request.');
    END IF;

    -- 1. Identify active resident record for this user and property
    SELECT id, full_name, room_number INTO v_resident
    FROM public.residents
    WHERE property_id = p_property_id AND profile_id = v_uid AND is_active = true
    LIMIT 1;

    IF v_resident.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized. Only active residents of this PG can use the washing machine.');
    END IF;

    -- 2. Ensure row exists before locking
    INSERT INTO public.washing_machine_status (property_id, status, current_resident_id, started_at, updated_at)
    VALUES (p_property_id, 'free', NULL, NULL, now())
    ON CONFLICT (property_id) DO NOTHING;

    -- 3. Lock machine status row for update to prevent concurrent race conditions
    SELECT * INTO v_current
    FROM public.washing_machine_status
    WHERE property_id = p_property_id
    FOR UPDATE;

    -- 4. Check availability
    IF v_current.status != 'free' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Washing machine is currently in use. Please wait until it is free.'
        );
    END IF;

    -- 5. Atomically transition to 'in_use'
    UPDATE public.washing_machine_status
    SET
        status = 'in_use',
        current_resident_id = v_resident.id,
        started_at = now(),
        updated_at = now()
    WHERE property_id = p_property_id;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Washing machine session started successfully.',
        'property_id', p_property_id,
        'status', 'in_use',
        'current_resident_id', v_resident.id,
        'current_resident_name', v_resident.full_name,
        'current_resident_room', v_resident.room_number,
        'started_at', now()
    );
END;
$$;

-- 8. SECURITY DEFINER RPC: release_washing_machine
-- Resident marks machine free: validates current session ownership, locks row FOR UPDATE,
-- and atomically clears current_resident_id and started_at.
CREATE OR REPLACE FUNCTION public.release_washing_machine(p_property_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID;
    v_resident RECORD;
    v_current RECORD;
BEGIN
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthenticated request.');
    END IF;

    -- 1. Identify active resident record for caller
    SELECT id, full_name INTO v_resident
    FROM public.residents
    WHERE property_id = p_property_id AND profile_id = v_uid AND is_active = true
    LIMIT 1;

    IF v_resident.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized. Only active residents of this PG can release the washing machine.');
    END IF;

    -- 2. Lock status row
    SELECT * INTO v_current
    FROM public.washing_machine_status
    WHERE property_id = p_property_id
    FOR UPDATE;

    IF v_current.property_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Washing machine status record not found.');
    END IF;

    -- 3. Check if machine is in use
    IF v_current.status != 'in_use' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Washing machine is already free.');
    END IF;

    -- 4. Verify session ownership: ONLY the resident who started it can mark it free
    IF v_current.current_resident_id != v_resident.id THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Unauthorized. Only the resident who started this wash session can mark it free.'
        );
    END IF;

    -- 5. Atomically transition back to 'free'
    UPDATE public.washing_machine_status
    SET
        status = 'free',
        current_resident_id = NULL,
        started_at = NULL,
        updated_at = now()
    WHERE property_id = p_property_id;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Washing machine marked free.',
        'property_id', p_property_id,
        'status', 'free'
    );
END;
$$;

-- 9. EXECUTE GRANTS
REVOKE EXECUTE ON FUNCTION public.get_or_create_wm_status(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_or_create_wm_status(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_wm_status(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.start_washing_machine(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.start_washing_machine(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.start_washing_machine(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.release_washing_machine(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.release_washing_machine(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.release_washing_machine(UUID) TO authenticated;

ALTER FUNCTION public.get_or_create_wm_status(UUID) OWNER TO postgres;
ALTER FUNCTION public.start_washing_machine(UUID) OWNER TO postgres;
ALTER FUNCTION public.release_washing_machine(UUID) OWNER TO postgres;

