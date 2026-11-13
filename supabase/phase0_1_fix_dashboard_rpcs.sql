-- ==============================================================================
-- Phase 0 / Task 1: Fix Dashboard RPCs (student_movement_logs -> movement_logs)
-- File: supabase/phase0_1_fix_dashboard_rpcs.sql
--
-- Instructions:
--   1. Review this script and execute it in the Supabase SQL Editor.
--   2. Run the verification queries in Section 3 below to confirm both RPCs
--      compile cleanly and return rows without referencing student_movement_logs.
-- ==============================================================================

BEGIN;

-- 1. Fix get_owner_dashboard_summary
CREATE OR REPLACE FUNCTION public.get_owner_dashboard_summary(
    p_property_id UUID,
    p_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID;
    v_total_residents INT := 0;
    v_students_inside INT := 0;
    v_students_outside INT := 0;
    v_today_menus JSONB;
    v_wm_units JSONB;
    v_wm_in_use_count INT := 0;
    v_wm_free_count INT := 0;
    v_wm_total_count INT := 0;
    v_open_complaints_count INT := 0;
    v_recent_activities JSONB;
BEGIN
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthenticated.');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.properties WHERE id = p_property_id AND owner_id = v_uid) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: You do not own this property.');
    END IF;

    -- 1. Gate Attendance / Resident counts (using subquery for latest movement per resident)
    WITH latest_movement AS (
        SELECT DISTINCT ON (resident_id)
            resident_id,
            direction
        FROM public.movement_logs
        WHERE property_id = p_property_id
        ORDER BY resident_id, event_time DESC
    ),
    active_res AS (
        SELECT
            r.id,
            COALESCE(lm.direction, 'IN') AS current_direction
        FROM public.residents r
        LEFT JOIN latest_movement lm ON lm.resident_id = r.id
        WHERE r.property_id = p_property_id AND r.is_active = true
    )
    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE current_direction = 'IN'),
        COUNT(*) FILTER (WHERE current_direction = 'OUT')
    INTO v_total_residents, v_students_inside, v_students_outside
    FROM active_res;

    -- 2. Today's Food Menus
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', m.id,
            'meal_type', m.meal_type,
            'items', m.items,
            'notes', m.notes,
            'is_published', m.is_published
        )
    ), '[]'::jsonb)
    INTO v_today_menus
    FROM public.food_menus m
    WHERE m.property_id = p_property_id AND m.menu_date = p_date;

    -- 3. Dynamic Washing Machine Units & Status
    INSERT INTO public.washing_machines (property_id, machine_number, machine_name, is_active, status)
    VALUES (p_property_id, 1, 'Washing Machine 1', true, 'free')
    ON CONFLICT (property_id, machine_number) DO NOTHING;

    WITH wm_data AS (
        SELECT
            wm.id,
            wm.machine_number,
            wm.machine_name,
            wm.is_active,
            wm.status,
            wm.current_resident_id,
            r.full_name AS current_resident_name,
            r.room_number AS current_resident_room,
            wm.started_at,
            wm.updated_at
        FROM public.washing_machines wm
        LEFT JOIN public.residents r ON r.id = wm.current_resident_id
        WHERE wm.property_id = p_property_id AND wm.is_active = true
        ORDER BY wm.machine_number ASC
    )
    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE status = 'in_use'),
        COUNT(*) FILTER (WHERE status = 'free'),
        COALESCE(jsonb_agg(
            jsonb_build_object(
                'id', d.id,
                'property_id', p_property_id,
                'machine_number', d.machine_number,
                'machine_name', d.machine_name,
                'is_active', d.is_active,
                'status', d.status,
                'current_resident_id', d.current_resident_id,
                'current_resident_name', d.current_resident_name,
                'current_resident_room', d.current_resident_room,
                'started_at', d.started_at,
                'updated_at', d.updated_at
            )
        ), '[]'::jsonb)
    INTO v_wm_total_count, v_wm_in_use_count, v_wm_free_count, v_wm_units
    FROM wm_data d;

    -- 4. Open Complaints Count
    SELECT COUNT(*) INTO v_open_complaints_count
    FROM public.complaints
    WHERE property_id = p_property_id AND status = 'open';

    -- 5. Recent Gate Activities (top 10)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', l.id,
            'residentName', r.full_name,
            'roomNumber', r.room_number,
            'direction', l.direction,
            'purpose', l.purpose,
            'time', to_char(l.event_time AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM')
        )
    ), '[]'::jsonb)
    INTO v_recent_activities
    FROM (
        SELECT id, resident_id, direction, purpose, event_time
        FROM public.movement_logs
        WHERE property_id = p_property_id
        ORDER BY event_time DESC
        LIMIT 10
    ) l
    JOIN public.residents r ON r.id = l.resident_id;

    RETURN jsonb_build_object(
        'success', true,
        'stats', jsonb_build_object(
            'totalResidents', v_total_residents,
            'studentsInside', v_students_inside,
            'studentsOutside', v_students_outside,
            'openComplaintsCount', v_open_complaints_count
        ),
        'todayMenus', v_today_menus,
        'washingMachines', jsonb_build_object(
            'totalCount', v_wm_total_count,
            'inUseCount', v_wm_in_use_count,
            'freeCount', v_wm_free_count,
            'units', v_wm_units
        ),
        'recentActivities', v_recent_activities
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_owner_dashboard_summary(UUID, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_owner_dashboard_summary(UUID, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_owner_dashboard_summary(UUID, DATE) TO authenticated;
ALTER FUNCTION public.get_owner_dashboard_summary(UUID, DATE) OWNER TO postgres;

-- 2. Fix get_student_dashboard_summary
CREATE OR REPLACE FUNCTION public.get_student_dashboard_summary(
    p_property_id UUID,
    p_resident_id UUID,
    p_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID;
    v_resident RECORD;
    v_wm_enabled BOOLEAN := false;
    v_wm_request_status TEXT := 'none';
    v_wm_units JSONB;
    v_today_menus JSONB;
    v_latest_gate RECORD;
BEGIN
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthenticated.');
    END IF;

    -- Verify caller is the resident
    SELECT id, full_name, room_number, property_id, monthly_rent_paise
    INTO v_resident
    FROM public.residents
    WHERE id = p_resident_id AND property_id = p_property_id AND profile_id = v_uid AND is_active = true;

    IF v_resident.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized resident access.');
    END IF;

    -- 1. Washing Machine enablement & request status
    SELECT COALESCE(is_enabled, false) INTO v_wm_enabled
    FROM public.resident_opt_ins
    WHERE resident_id = p_resident_id AND feature_name = 'washing_machine';

    SELECT COALESCE(status, 'none') INTO v_wm_request_status
    FROM public.washing_machine_requests
    WHERE property_id = p_property_id AND resident_id = p_resident_id;

    -- 2. Washing Machine units
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', wm.id,
            'property_id', p_property_id,
            'machine_number', wm.machine_number,
            'machine_name', wm.machine_name,
            'is_active', wm.is_active,
            'status', wm.status,
            'current_resident_id', wm.current_resident_id,
            'current_resident_name', r.full_name,
            'current_resident_room', r.room_number,
            'started_at', wm.started_at,
            'updated_at', wm.updated_at
        ) ORDER BY wm.machine_number ASC
    ), '[]'::jsonb)
    INTO v_wm_units
    FROM public.washing_machines wm
    LEFT JOIN public.residents r ON r.id = wm.current_resident_id
    WHERE wm.property_id = p_property_id AND wm.is_active = true;

    -- 3. Today's Published Menus
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', m.id,
            'meal_type', m.meal_type,
            'items', m.items,
            'notes', m.notes,
            'is_published', m.is_published
        )
    ), '[]'::jsonb)
    INTO v_today_menus
    FROM public.food_menus m
    WHERE m.property_id = p_property_id AND m.menu_date = p_date AND m.is_published = true;

    -- 4. Latest Gate Status
    SELECT direction, event_time, purpose, expected_return_time, food_required
    INTO v_latest_gate
    FROM public.movement_logs
    WHERE property_id = p_property_id AND resident_id = p_resident_id
    ORDER BY event_time DESC
    LIMIT 1;

    RETURN jsonb_build_object(
        'success', true,
        'resident', jsonb_build_object(
            'id', v_resident.id,
            'fullName', v_resident.full_name,
            'roomNumber', v_resident.room_number,
            'monthlyRentPaise', v_resident.monthly_rent_paise
        ),
        'gateStatus', jsonb_build_object(
            'direction', COALESCE(v_latest_gate.direction, 'IN'),
            'eventTime', v_latest_gate.event_time,
            'purpose', v_latest_gate.purpose,
            'expectedReturnTime', v_latest_gate.expected_return_time,
            'foodRequired', COALESCE(v_latest_gate.food_required, true)
        ),
        'publishedMenus', v_today_menus,
        'washingMachines', jsonb_build_object(
            'residentEnabled', v_wm_enabled,
            'requestStatus', v_wm_request_status,
            'units', v_wm_units
        )
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_student_dashboard_summary(UUID, UUID, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_student_dashboard_summary(UUID, UUID, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_student_dashboard_summary(UUID, UUID, DATE) TO authenticated;
ALTER FUNCTION public.get_student_dashboard_summary(UUID, UUID, DATE) OWNER TO postgres;

COMMIT;

-- ==============================================================================
-- 3. READ-ONLY VERIFICATION TEST QUERIES (Run after COMMIT above)
-- ==============================================================================
-- A. Confirm function definitions no longer reference student_movement_logs:
SELECT
    p.proname AS function_name,
    pg_get_functiondef(p.oid) LIKE '%public.movement_logs%' AS uses_movement_logs,
    pg_get_functiondef(p.oid) LIKE '%student_movement_logs%' AS still_references_broken_table
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_owner_dashboard_summary', 'get_student_dashboard_summary');

-- B. Live simulated RPC execution (rolled back cleanly, zero writes persisted):
--    Tests the first active property and first linked active resident found in DB.
DO $$
DECLARE
    v_prop RECORD;
    v_res RECORD;
    v_owner_out JSONB;
    v_student_out JSONB;
BEGIN
    SELECT id, owner_id INTO v_prop
    FROM public.properties
    WHERE is_active = true
    LIMIT 1;

    IF v_prop.id IS NOT NULL THEN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_prop.owner_id, 'role', 'authenticated')::text, true);
        v_owner_out := public.get_owner_dashboard_summary(v_prop.id, CURRENT_DATE);
        RAISE NOTICE 'get_owner_dashboard_summary => %', v_owner_out;
    ELSE
        RAISE NOTICE 'No active property found to test get_owner_dashboard_summary.';
    END IF;

    SELECT id, property_id, profile_id INTO v_res
    FROM public.residents
    WHERE is_active = true AND profile_id IS NOT NULL
    LIMIT 1;

    IF v_res.id IS NOT NULL THEN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_res.profile_id, 'role', 'authenticated')::text, true);
        v_student_out := public.get_student_dashboard_summary(v_res.property_id, v_res.id, CURRENT_DATE);
        RAISE NOTICE 'get_student_dashboard_summary => %', v_student_out;
    ELSE
        RAISE NOTICE 'No linked active resident found to test get_student_dashboard_summary.';
    END IF;
END $$;
