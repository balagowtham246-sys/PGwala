-- ==============================================================================
-- PGwala Washing Machine Single-Session Invariant, Release Auth Fix &
-- Active-Resident Property Scoping
-- File: supabase/migrations/20260101000025_washing_machine_single_session_and_auth.sql
-- ==============================================================================
-- Fixes:
--   1. Prevents a resident from holding more than 1 'in_use' machine at a time:
--        * Cleans up any historical duplicate active washes (keeping newest).
--        * Adds partial unique index uq_washing_machines_active_resident.
--        * Locks the resident row FOR UPDATE inside start_washing_machine_unit
--          so concurrent requests serialize atomically.
--        * Distinguishes 'out_of_order' / inactive machines from 'in_use'.
--   2. Fixes release_washing_machine_unit NULL-comparison authorization bug
--      where a non-resident authenticated user passed p_machine_id and
--      (current_resident_id != NULL) evaluated to NULL (falsy).
--   3. Routes legacy start_washing_machine / release_washing_machine through the
--      unit RPCs so older entry points cannot bypass opt-in or single-session rules.
--   4. Restricts properties_resident_view RLS to active residents (is_active = true)
--      so checked-out residents cannot read wifi_password / upi_id / curfew_time.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Deduplicate any pre-existing multi-machine active rows, then lock invariant
-- ------------------------------------------------------------------------------
WITH ranked AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY current_resident_id
            ORDER BY started_at DESC NULLS LAST, updated_at DESC NULLS LAST, id DESC
        ) AS rn
    FROM public.washing_machines
    WHERE status::text = 'in_use'
      AND current_resident_id IS NOT NULL
)
UPDATE public.washing_machines wm
SET
    status = 'free',
    current_resident_id = NULL,
    started_at = NULL,
    updated_at = pg_catalog.now()
FROM ranked r
WHERE wm.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_washing_machines_active_resident
    ON public.washing_machines (current_resident_id)
    WHERE status = 'in_use'::public.washing_machine_status_type AND current_resident_id IS NOT NULL;

-- ------------------------------------------------------------------------------
-- 2. Atomic single-session start_washing_machine_unit
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_washing_machine_unit(
    p_property_id UUID,
    p_machine_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID;
    v_resident RECORD;
    v_is_enabled BOOLEAN := false;
    v_active_machine RECORD;
    v_machine RECORD;
    v_target_id UUID;
    v_started_at TIMESTAMPTZ;
BEGIN
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'Unauthenticated request.');
    END IF;

    -- Lock the active resident row so concurrent taps serialize for this resident.
    SELECT id, full_name, room_number
    INTO v_resident
    FROM public.residents
    WHERE property_id = p_property_id
      AND profile_id = v_uid
      AND is_active = true
    ORDER BY created_at DESC NULLS LAST, id DESC
    LIMIT 1
    FOR UPDATE;

    IF v_resident.id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Unauthorized. Only active residents can use the washing machine.'
        );
    END IF;

    -- Enforce owner-approved washing machine opt-in
    SELECT is_enabled
    INTO v_is_enabled
    FROM public.resident_opt_ins
    WHERE resident_id = v_resident.id
      AND feature_name = 'washing_machine';

    IF NOT COALESCE(v_is_enabled, false) THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'not_enabled', true,
            'error', 'Washing machine access is not enabled for your room. Please request access from your PG owner.'
        );
    END IF;

    -- Enforce single active machine per resident across the database
    SELECT wm.id, wm.machine_name
    INTO v_active_machine
    FROM public.washing_machines wm
    WHERE wm.current_resident_id = v_resident.id
      AND wm.status::text = 'in_use'
    LIMIT 1;

    IF v_active_machine.id IS NOT NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'code', 'WM_RESIDENT_ACTIVE_SESSION',
            'active_machine_id', v_active_machine.id,
            'active_machine_name', v_active_machine.machine_name,
            'error', 'You are already using ' || COALESCE(v_active_machine.machine_name, 'a washing machine') || '. Mark it free before starting another machine.'
        );
    END IF;

    -- Resolve target machine ID
    IF p_machine_id IS NOT NULL THEN
        v_target_id := p_machine_id;
    ELSE
        SELECT wm.id
        INTO v_target_id
        FROM public.washing_machines wm
        WHERE wm.property_id = p_property_id
          AND wm.is_active = true
          AND wm.status::text = 'free'
        ORDER BY wm.machine_number ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED;
    END IF;

    IF v_target_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'No washing machines are currently free.'
        );
    END IF;

    -- Lock target machine row FOR UPDATE
    SELECT *
    INTO v_machine
    FROM public.washing_machines
    WHERE id = v_target_id
      AND property_id = p_property_id
    FOR UPDATE;

    IF v_machine.id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'Washing machine not found.');
    END IF;

    IF NOT v_machine.is_active OR v_machine.status::text = 'out_of_order' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'This washing machine is currently under maintenance.'
        );
    END IF;

    IF v_machine.status::text != 'free' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'This washing machine is currently in use.'
        );
    END IF;

    v_started_at := pg_catalog.now();

    BEGIN
        UPDATE public.washing_machines
        SET
            status = 'in_use',
            current_resident_id = v_resident.id,
            started_at = v_started_at,
            updated_at = v_started_at
        WHERE id = v_target_id;
    EXCEPTION
        WHEN unique_violation THEN
            SELECT wm.id, wm.machine_name
            INTO v_active_machine
            FROM public.washing_machines wm
            WHERE wm.current_resident_id = v_resident.id
              AND wm.status::text = 'in_use'
            LIMIT 1;

            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'code', 'WM_RESIDENT_ACTIVE_SESSION',
                'active_machine_id', v_active_machine.id,
                'active_machine_name', v_active_machine.machine_name,
                'error', 'You are already using ' || COALESCE(v_active_machine.machine_name, 'a washing machine') || '. Mark it free before starting another machine.'
            );
    END;

    -- Keep legacy single-machine table synced if machine 1
    IF v_machine.machine_number = 1 THEN
        INSERT INTO public.washing_machine_status (
            property_id, status, current_resident_id, started_at, updated_at
        )
        VALUES (p_property_id, 'in_use', v_resident.id, v_started_at, v_started_at)
        ON CONFLICT (property_id) DO UPDATE SET
            status = 'in_use',
            current_resident_id = EXCLUDED.current_resident_id,
            started_at = EXCLUDED.started_at,
            updated_at = EXCLUDED.updated_at;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'message', 'Washing machine session started successfully.',
        'machine_id', v_target_id,
        'machine_name', v_machine.machine_name,
        'status', 'in_use',
        'current_resident_id', v_resident.id,
        'current_resident_name', v_resident.full_name,
        'current_resident_room', v_resident.room_number,
        'started_at', v_started_at
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. Fixed authorization in release_washing_machine_unit
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_washing_machine_unit(
    p_property_id UUID,
    p_machine_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID;
    v_is_owner BOOLEAN := false;
    v_resident RECORD;
    v_machine RECORD;
    v_target_id UUID;
BEGIN
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'Unauthenticated request.');
    END IF;

    v_is_owner := EXISTS (
        SELECT 1
        FROM public.properties p
        WHERE p.id = p_property_id
          AND p.owner_id = v_uid
    );

    SELECT id, full_name
    INTO v_resident
    FROM public.residents
    WHERE property_id = p_property_id
      AND profile_id = v_uid
      AND is_active = true
    LIMIT 1;

    IF NOT v_is_owner AND v_resident.id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Unauthorized. Only the PG owner or an active resident can release a washing machine.'
        );
    END IF;

    IF p_machine_id IS NOT NULL THEN
        v_target_id := p_machine_id;
    ELSE
        IF v_resident.id IS NULL THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error', 'Specify which washing machine to mark free.'
            );
        END IF;

        SELECT wm.id
        INTO v_target_id
        FROM public.washing_machines wm
        WHERE wm.property_id = p_property_id
          AND wm.status::text = 'in_use'
          AND wm.current_resident_id = v_resident.id
        LIMIT 1;
    END IF;

    IF v_target_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'No active washing machine session found for your account.'
        );
    END IF;

    -- Lock machine row FOR UPDATE
    SELECT *
    INTO v_machine
    FROM public.washing_machines
    WHERE id = v_target_id
      AND property_id = p_property_id
    FOR UPDATE;

    IF v_machine.id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'Washing machine not found.');
    END IF;

    IF v_machine.status::text != 'in_use' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'This washing machine is not currently in use.'
        );
    END IF;

    -- Explicit NULL-safe ownership check: only property owner or active session holder
    IF NOT v_is_owner
       AND (v_resident.id IS NULL OR v_machine.current_resident_id IS DISTINCT FROM v_resident.id) THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'You can only release your own washing machine session.'
        );
    END IF;

    UPDATE public.washing_machines
    SET
        status = 'free',
        current_resident_id = NULL,
        started_at = NULL,
        updated_at = pg_catalog.now()
    WHERE id = v_target_id;

    IF v_machine.machine_number = 1 THEN
        INSERT INTO public.washing_machine_status (
            property_id, status, current_resident_id, started_at, updated_at
        )
        VALUES (p_property_id, 'free', NULL, NULL, pg_catalog.now())
        ON CONFLICT (property_id) DO UPDATE SET
            status = 'free',
            current_resident_id = NULL,
            started_at = NULL,
            updated_at = EXCLUDED.updated_at;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'message', 'Washing machine marked free successfully.'
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. Route legacy single-machine RPCs through the hardened unit RPCs
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_washing_machine(p_property_id UUID)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT public.start_washing_machine_unit(p_property_id, NULL);
$$;

CREATE OR REPLACE FUNCTION public.release_washing_machine(p_property_id UUID)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT public.release_washing_machine_unit(p_property_id, NULL);
$$;

REVOKE EXECUTE ON FUNCTION public.start_washing_machine_unit(UUID, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.release_washing_machine_unit(UUID, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.start_washing_machine(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.release_washing_machine(UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.start_washing_machine_unit(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_washing_machine_unit(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_washing_machine(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_washing_machine(UUID) TO authenticated;

ALTER FUNCTION public.start_washing_machine_unit(UUID, UUID) OWNER TO postgres;
ALTER FUNCTION public.release_washing_machine_unit(UUID, UUID) OWNER TO postgres;
ALTER FUNCTION public.start_washing_machine(UUID) OWNER TO postgres;
ALTER FUNCTION public.release_washing_machine(UUID) OWNER TO postgres;

-- ------------------------------------------------------------------------------
-- 5. Restrict property metadata read access to active residents only
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "properties_resident_view" ON public.properties;
CREATE POLICY "properties_resident_view"
    ON public.properties FOR SELECT
    TO authenticated
    USING (
        id IN (
            SELECT property_id
            FROM public.residents
            WHERE profile_id = (SELECT auth.uid())
              AND is_active = true
        )
    );

COMMIT;
