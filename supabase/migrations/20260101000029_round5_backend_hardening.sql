-- ==============================================================================
-- PGwala Round 5 Backend & Data-Integrity Hardening Migration
-- File: supabase/migrations/20260101000029_round5_backend_hardening.sql
--
-- Fixes (all backwards-compatible & idempotent):
--   1. Announcements idempotency: adds idempotency_key + unique index per owner.
--   2. Washing machine 60-minute server-side auto-free helper invoked inside
--      get_or_create_wm_units, start_washing_machine_unit,
--      get_owner_dashboard_summary, and get_student_dashboard_summary.
--   3. Push token invalidation RPC: invalidate_resident_push_tokens(property_id, resident_id)
--      so checked-out residents immediately stop receiving PG notifications.
--   4. get_student_dashboard_summary now returns currentMonthBillGenerated so
--      residents see "Bill not generated yet" on the 1st of a new month instead
--      of a misleading "Rent settled" banner.
--   5. reject_student_payment_report returns the rejected report's screenshot_url
--      (and nulls it out), paired with an owner-scoped storage DELETE policy on
--      payment-proofs so rejected screenshots are cleaned up from free-tier storage.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Announcements Idempotency Key
-- ------------------------------------------------------------------------------
ALTER TABLE public.announcements
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_announcements_owner_idempotency
    ON public.announcements (owner_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- ------------------------------------------------------------------------------
-- 2. Washing Machine 60-Minute Auto-Free Helper
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_release_expired_washing_machines(
    p_property_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_released_count INTEGER := 0;
    v_released_m1 BOOLEAN := false;
BEGIN
    WITH released AS (
        UPDATE public.washing_machines
        SET
            status = 'free',
            current_resident_id = NULL,
            started_at = NULL,
            updated_at = pg_catalog.now()
        WHERE property_id = p_property_id
          AND status::text = 'in_use'
          AND started_at IS NOT NULL
          AND started_at < (pg_catalog.now() - INTERVAL '60 minutes')
        RETURNING machine_number
    )
    SELECT
        COUNT(*)::INTEGER,
        COALESCE(bool_or(machine_number = 1), false)
    INTO v_released_count, v_released_m1
    FROM released;

    IF v_released_m1 THEN
        UPDATE public.washing_machine_status
        SET
            status = 'free',
            current_resident_id = NULL,
            started_at = NULL,
            updated_at = pg_catalog.now()
        WHERE property_id = p_property_id
          AND status::text = 'in_use';
    END IF;

    RETURN v_released_count;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_release_expired_washing_machines(UUID) FROM PUBLIC, anon, authenticated;
ALTER FUNCTION public.auto_release_expired_washing_machines(UUID) OWNER TO postgres;

-- Update get_or_create_wm_units to auto-release expired sessions first
CREATE OR REPLACE FUNCTION public.get_or_create_wm_units(p_property_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID;
    v_is_owner BOOLEAN := false;
    v_resident RECORD;
    v_resident_enabled BOOLEAN := false;
    v_request_status TEXT := 'none';
    v_machines JSONB;
BEGIN
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthenticated request.');
    END IF;

    IF EXISTS (SELECT 1 FROM public.properties WHERE id = p_property_id AND owner_id = v_uid) THEN
        v_is_owner := true;
    END IF;

    SELECT id, full_name, room_number INTO v_resident
    FROM public.residents
    WHERE property_id = p_property_id AND profile_id = v_uid AND is_active = true
    LIMIT 1;

    IF NOT v_is_owner AND v_resident.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized. You do not belong to this property.');
    END IF;

    -- Auto-release any washing machine stuck in_use for more than 60 minutes
    PERFORM public.auto_release_expired_washing_machines(p_property_id);

    INSERT INTO public.washing_machines (property_id, machine_number, machine_name, is_active, status)
    VALUES
        (p_property_id, 1, 'Washing Machine 1', true, 'free'),
        (p_property_id, 2, 'Washing Machine 2', true, 'free')
    ON CONFLICT (property_id, machine_number) DO NOTHING;

    INSERT INTO public.washing_machine_status (property_id, status, current_resident_id, started_at, updated_at)
    VALUES (p_property_id, 'free', NULL, NULL, now())
    ON CONFLICT (property_id) DO NOTHING;

    IF v_resident.id IS NOT NULL THEN
        SELECT is_enabled INTO v_resident_enabled
        FROM public.resident_opt_ins
        WHERE resident_id = v_resident.id AND feature_name = 'washing_machine';
        v_resident_enabled := COALESCE(v_resident_enabled, false);

        SELECT status INTO v_request_status
        FROM public.washing_machine_requests
        WHERE property_id = p_property_id AND resident_id = v_resident.id;
        v_request_status := COALESCE(v_request_status, 'none');
    END IF;

    SELECT jsonb_agg(
        jsonb_build_object(
            'id', m.id,
            'property_id', m.property_id,
            'machine_number', m.machine_number,
            'machine_name', m.machine_name,
            'is_active', m.is_active,
            'status', m.status,
            'current_resident_id', m.current_resident_id,
            'current_resident_name', COALESCE(r.full_name, 'A resident'),
            'current_resident_room', r.room_number,
            'started_at', m.started_at,
            'updated_at', m.updated_at
        ) ORDER BY m.machine_number ASC
    ) INTO v_machines
    FROM public.washing_machines m
    LEFT JOIN public.residents r ON m.current_resident_id = r.id
    WHERE m.property_id = p_property_id;

    RETURN jsonb_build_object(
        'success', true,
        'property_id', p_property_id,
        'resident_enabled', v_resident_enabled,
        'request_status', v_request_status,
        'machines', COALESCE(v_machines, '[]'::jsonb)
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_or_create_wm_units(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_wm_units(UUID) TO authenticated;
ALTER FUNCTION public.get_or_create_wm_units(UUID) OWNER TO postgres;

-- Update start_washing_machine_unit to auto-release expired sessions before locking
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

    -- Auto-release any washing machine stuck in_use for more than 60 minutes
    PERFORM public.auto_release_expired_washing_machines(p_property_id);

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

REVOKE EXECUTE ON FUNCTION public.start_washing_machine_unit(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_washing_machine_unit(UUID, UUID) TO authenticated;
ALTER FUNCTION public.start_washing_machine_unit(UUID, UUID) OWNER TO postgres;

-- Update get_owner_dashboard_summary to auto-release expired washing machines
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
    v_month_start DATE;
    v_total_residents INT := 0;
    v_students_inside INT := 0;
    v_students_outside INT := 0;
    v_rent_collected_paise BIGINT := 0;
    v_rent_total_paise BIGINT := 0;
    v_unpaid_residents_count INT := 0;
    v_pending_proofs_count INT := 0;
    v_today_menus JSONB;
    v_wm_units JSONB;
    v_wm_in_use_count INT := 0;
    v_wm_free_count INT := 0;
    v_wm_out_of_order_count INT := 0;
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

    v_month_start := date_trunc('month', COALESCE(p_date, CURRENT_DATE))::date;

    -- Auto-release any washing machine stuck in_use for more than 60 minutes
    PERFORM public.auto_release_expired_washing_machines(p_property_id);

    -- 1. Gate Attendance / Resident counts
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

    -- 2. Monthly Rent Collection Summary & Pending Proofs Count
    SELECT
        COALESCE(SUM(CASE WHEN c.status IN ('paid', 'settled') THEN COALESCE(c.amount_paise, 0) ELSE 0 END), 0),
        COALESCE(SUM(COALESCE(c.amount_paise, 0)), 0),
        COUNT(DISTINCT c.resident_id) FILTER (WHERE c.status NOT IN ('paid', 'settled'))
    INTO v_rent_collected_paise, v_rent_total_paise, v_unpaid_residents_count
    FROM public.charges c
    WHERE c.property_id = p_property_id
      AND c.billing_period_start = v_month_start
      AND c.category = 'rent';

    SELECT COUNT(*)
    INTO v_pending_proofs_count
    FROM public.student_payment_reports spr
    JOIN public.charges c ON c.id = spr.charge_id
    JOIN public.residents r ON r.id = spr.resident_id
    WHERE spr.property_id = p_property_id
      AND spr.status = 'pending'
      AND r.is_active = true
      AND c.status = 'outstanding'
      AND c.billing_period_start = v_month_start;

    -- 3. Today's Food Menus
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

    -- 4. Dynamic Washing Machine Units & Status
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
        COUNT(*) FILTER (WHERE status = 'out_of_order'),
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
    INTO v_wm_total_count, v_wm_in_use_count, v_wm_free_count, v_wm_out_of_order_count, v_wm_units
    FROM wm_data d;

    -- 5. Open Complaints Count
    SELECT COUNT(*) INTO v_open_complaints_count
    FROM public.complaints
    WHERE property_id = p_property_id AND status = 'open';

    -- 6. Recent Gate Activities (top 10)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', l.id,
            'residentId', l.resident_id,
            'residentName', r.full_name,
            'roomNumber', r.room_number,
            'direction', l.direction,
            'purpose', l.purpose,
            'eventTime', l.event_time,
            'time', to_char(l.event_time AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM')
        ) ORDER BY l.event_time DESC
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
            'openComplaintsCount', v_open_complaints_count,
            'rentCollectedPaise', v_rent_collected_paise,
            'rentTotalPaise', v_rent_total_paise,
            'unpaidResidentsCount', v_unpaid_residents_count,
            'pendingProofsCount', v_pending_proofs_count
        ),
        'todayMenus', v_today_menus,
        'washingMachines', jsonb_build_object(
            'totalCount', v_wm_total_count,
            'inUseCount', v_wm_in_use_count,
            'freeCount', v_wm_free_count,
            'outOfOrderCount', v_wm_out_of_order_count,
            'units', v_wm_units
        ),
        'recentActivities', v_recent_activities
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_owner_dashboard_summary(UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_owner_dashboard_summary(UUID, DATE) TO authenticated;
ALTER FUNCTION public.get_owner_dashboard_summary(UUID, DATE) OWNER TO postgres;

-- Update get_student_dashboard_summary to auto-release expired washing machines
-- AND return currentMonthBillGenerated for accurate resident rent banner copy.
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
    v_month_start DATE;
    v_resident RECORD;
    v_wm_enabled BOOLEAN := false;
    v_wm_request_status TEXT := 'none';
    v_wm_units JSONB;
    v_today_menus JSONB;
    v_latest_gate RECORD;
    v_current_month_bill_generated BOOLEAN := false;
BEGIN
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthenticated.');
    END IF;

    SELECT id, full_name, room_number, property_id, monthly_rent_paise
    INTO v_resident
    FROM public.residents
    WHERE id = p_resident_id AND property_id = p_property_id AND profile_id = v_uid AND is_active = true;

    IF v_resident.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized resident access.');
    END IF;

    v_month_start := date_trunc('month', COALESCE(p_date, CURRENT_DATE))::date;

    -- Auto-release any washing machine stuck in_use for more than 60 minutes
    PERFORM public.auto_release_expired_washing_machines(p_property_id);

    -- Check whether any bill (rent or electricity) has been generated for the current month
    SELECT EXISTS (
        SELECT 1
        FROM public.charges c
        WHERE c.resident_id = p_resident_id
          AND c.billing_period_start = v_month_start
          AND c.category IN ('rent', 'electricity')
          AND c.status != 'cancelled'
    ) INTO v_current_month_bill_generated;

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
        'currentMonthBillGenerated', v_current_month_bill_generated,
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

REVOKE EXECUTE ON FUNCTION public.get_student_dashboard_summary(UUID, UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_dashboard_summary(UUID, UUID, DATE) TO authenticated;
ALTER FUNCTION public.get_student_dashboard_summary(UUID, UUID, DATE) OWNER TO postgres;

-- ------------------------------------------------------------------------------
-- 3. Invalidate Resident Push Tokens on Checkout (Owner-scoped SECURITY DEFINER)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invalidate_resident_push_tokens(
    p_property_id UUID,
    p_resident_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner_id UUID;
    v_profile_id UUID;
    v_invalidated INT := 0;
BEGIN
    v_owner_id := (SELECT auth.uid());
    IF v_owner_id IS NULL OR NOT public.is_owner() THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized.');
    END IF;

    SELECT r.profile_id
    INTO v_profile_id
    FROM public.residents r
    JOIN public.properties p ON p.id = r.property_id
    WHERE r.id = p_resident_id
      AND r.property_id = p_property_id
      AND p.owner_id = v_owner_id
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Resident not found or unauthorized.');
    END IF;

    IF v_profile_id IS NOT NULL THEN
        UPDATE public.push_tokens
        SET is_valid = false
        WHERE profile_id = v_profile_id
          AND is_valid = true;
        GET DIAGNOSTICS v_invalidated = ROW_COUNT;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'invalidated_count', v_invalidated
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.invalidate_resident_push_tokens(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invalidate_resident_push_tokens(UUID, UUID) TO authenticated;
ALTER FUNCTION public.invalidate_resident_push_tokens(UUID, UUID) OWNER TO postgres;

-- ------------------------------------------------------------------------------
-- 4. Rejected Payment Proof Storage Cleanup Support
-- ------------------------------------------------------------------------------
-- Return screenshot_url from reject_student_payment_report and clear it on the row
-- so the client can delete the orphaned file from the payment-proofs bucket.
CREATE OR REPLACE FUNCTION public.reject_student_payment_report(
    p_report_id UUID,
    p_rejection_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner_id UUID;
    v_report RECORD;
BEGIN
    v_owner_id := auth.uid();
    IF v_owner_id IS NULL OR NOT public.is_owner() THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Unauthorized: Only authenticated PG owners can review payment reports.'
        );
    END IF;

    IF p_rejection_reason IS NULL OR pg_catalog.btrim(p_rejection_reason) = '' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Please provide a reason for rejecting this payment report.'
        );
    END IF;

    SELECT r.id, r.status, r.property_id, r.screenshot_url
    INTO v_report
    FROM public.student_payment_reports r
    INNER JOIN public.properties p ON p.id = r.property_id
    WHERE r.id = p_report_id AND p.owner_id = v_owner_id AND p.is_active = true
    FOR UPDATE OF r;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Payment report not found or you do not own the property.'
        );
    END IF;

    IF v_report.status != 'pending' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'This report has already been reviewed.'
        );
    END IF;

    UPDATE public.student_payment_reports
    SET status = 'rejected',
        rejection_reason = pg_catalog.btrim(p_rejection_reason),
        screenshot_url = NULL,
        reviewed_by = v_owner_id,
        reviewed_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE id = p_report_id;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'screenshot_url', v_report.screenshot_url,
        'message', 'Payment report marked as rejected.'
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reject_student_payment_report(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_student_payment_report(UUID, TEXT) TO authenticated;
ALTER FUNCTION public.reject_student_payment_report(UUID, TEXT) OWNER TO postgres;

-- Allow property owners to delete payment proof files belonging to their residents
DROP POLICY IF EXISTS "payment_proofs_owner_delete" ON storage.objects;
CREATE POLICY "payment_proofs_owner_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'payment-proofs'
    AND public.is_owner()
    AND (
        (storage.foldername(name))[1] IN (
            SELECT r.id::text FROM public.residents r
            WHERE r.property_id IN (SELECT public.get_my_property_ids())
        )
        OR EXISTS (
            SELECT 1 FROM public.residents r
            WHERE r.property_id IN (SELECT public.get_my_property_ids())
              AND storage.objects.name LIKE (r.id::text || '%')
        )
    )
);

-- ------------------------------------------------------------------------------
-- 5. Close all pending reports for a charge on confirm_monthly_payment + cleanup
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_monthly_payment(
    p_charge_id UUID,
    p_report_id UUID DEFAULT NULL,
    p_method TEXT DEFAULT 'upi',
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner_id UUID;
    v_charge RECORD;
    v_payment_method public.billing_payment_method;
    v_receipt_no TEXT;
    v_payment_id UUID;
BEGIN
    v_owner_id := auth.uid();
    IF v_owner_id IS NULL OR NOT public.is_owner() THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Unauthorized: Only PG owners can confirm payments.'
        );
    END IF;

    SELECT c.id, c.property_id, c.resident_id, c.amount_paise, c.status, c.billing_period_start
    INTO v_charge
    FROM public.charges c
    JOIN public.properties p ON p.id = c.property_id
    WHERE c.id = p_charge_id
      AND p.owner_id = v_owner_id
      AND p.is_active = true;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Bill not found or you do not own this property.'
        );
    END IF;

    IF v_charge.status = 'settled' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'This bill has already been confirmed as Paid.'
        );
    END IF;

    IF lower(p_method) = 'cash' THEN
        v_payment_method := 'cash'::public.billing_payment_method;
    ELSE
        v_payment_method := 'upi'::public.billing_payment_method;
    END IF;

    v_receipt_no := 'RCT-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMM') || '-' ||
                    pg_catalog.lpad(pg_catalog.nextval('public.receipt_number_seq')::TEXT, 4, '0');

    INSERT INTO public.payments (
        property_id,
        resident_id,
        receipt_number,
        amount_paise,
        unallocated_amount_paise,
        method,
        payment_date,
        status,
        recorded_by,
        notes
    ) VALUES (
        v_charge.property_id,
        v_charge.resident_id,
        v_receipt_no,
        v_charge.amount_paise,
        0,
        v_payment_method,
        CURRENT_DATE,
        'approved',
        v_owner_id,
        COALESCE(p_notes, 'Monthly bill payment confirmed')
    ) RETURNING id INTO v_payment_id;

    INSERT INTO public.payment_allocations (
        charge_id,
        payment_id,
        settled_amount_paise,
        status
    ) VALUES (
        v_charge.id,
        v_payment_id,
        v_charge.amount_paise,
        'active'
    );

    UPDATE public.charges
    SET status = 'settled'
    WHERE id = v_charge.id;

    -- Approve the explicitly passed report AND close any other pending reports for this charge
    UPDATE public.student_payment_reports
    SET status = 'approved',
        reviewed_by = v_owner_id,
        reviewed_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE (p_report_id IS NOT NULL AND id = p_report_id)
       OR (charge_id = v_charge.id AND status = 'pending');

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'receipt_number', v_receipt_no,
        'charge_id', v_charge.id,
        'payment_id', v_payment_id
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.confirm_monthly_payment(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_monthly_payment(UUID, UUID, TEXT, TEXT) TO authenticated;
ALTER FUNCTION public.confirm_monthly_payment(UUID, UUID, TEXT, TEXT) OWNER TO postgres;

-- One-time cleanup: resolve any orphaned pending reports for already-settled charges or inactive residents
UPDATE public.student_payment_reports spr
SET status = 'approved',
    updated_at = pg_catalog.now()
WHERE spr.status = 'pending'
  AND EXISTS (
      SELECT 1 FROM public.charges c
      WHERE c.id = spr.charge_id AND c.status = 'settled'
  );

UPDATE public.student_payment_reports spr
SET status = 'rejected',
    rejection_reason = COALESCE(spr.rejection_reason, 'Closed automatically (no active unpaid bill)'),
    updated_at = pg_catalog.now()
WHERE spr.status = 'pending'
  AND (
      spr.charge_id IS NULL
      OR EXISTS (
          SELECT 1 FROM public.residents r
          WHERE r.id = spr.resident_id AND r.is_active = false
      )
  );

-- ------------------------------------------------------------------------------
-- 6. Fast Single-Query RPC for Owner Wardens (replaces N+1 Edge Function calls)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_owner_wardens()
RETURNS TABLE (
    property_id UUID,
    profile_id UUID,
    full_name TEXT,
    phone_number TEXT,
    email TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
    SELECT
        pw.property_id,
        pw.warden_profile_id AS profile_id,
        COALESCE(pr.full_name, '') AS full_name,
        pr.phone_number,
        au.email::TEXT AS email
    FROM public.properties p
    JOIN public.property_wardens pw
      ON pw.property_id = p.id
     AND pw.is_active = true
    LEFT JOIN public.profiles pr
      ON pr.id = pw.warden_profile_id
    LEFT JOIN auth.users au
      ON au.id = pw.warden_profile_id
    WHERE p.owner_id = (SELECT auth.uid())
      AND p.is_active = true
      AND public.is_owner();
$$;

REVOKE EXECUTE ON FUNCTION public.get_owner_wardens() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_owner_wardens() TO authenticated;
ALTER FUNCTION public.get_owner_wardens() OWNER TO postgres;

-- ------------------------------------------------------------------------------
-- 7. Single-RPC Residents Directory Summary (exact gate status + unpaid dues)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_residents_directory_summary(
    p_property_id UUID
)
RETURNS TABLE (
    id UUID,
    property_id UUID,
    full_name TEXT,
    room_number TEXT,
    bed_label TEXT,
    phone_number TEXT,
    gender TEXT,
    joining_date DATE,
    monthly_rent_paise BIGINT,
    deposit_paise INTEGER,
    is_active BOOLEAN,
    updated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    gate_status TEXT,
    last_gate_event_time TIMESTAMPTZ,
    pending_dues_paise BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
    WITH latest_gate AS (
        SELECT DISTINCT ON (ml.resident_id)
            ml.resident_id,
            ml.direction::TEXT AS direction,
            ml.event_time
        FROM public.movement_logs ml
        WHERE ml.property_id = p_property_id
        ORDER BY ml.resident_id, ml.event_time DESC
    ),
    unpaid_dues AS (
        SELECT
            c.resident_id,
            COALESCE(SUM(c.amount_paise), 0)::BIGINT AS total_due_paise
        FROM public.charges c
        WHERE c.property_id = p_property_id
          AND c.status::TEXT NOT IN ('settled', 'voided', 'paid', 'cancelled')
        GROUP BY c.resident_id
    )
    SELECT
        r.id,
        r.property_id,
        r.full_name,
        r.room_number,
        r.bed_label,
        r.phone_number,
        r.gender,
        r.joining_date,
        COALESCE(r.monthly_rent_paise, 0)::BIGINT AS monthly_rent_paise,
        COALESCE(r.deposit_paise, 0)::INTEGER AS deposit_paise,
        r.is_active,
        r.updated_at,
        r.created_at,
        COALESCE(lg.direction, 'IN') AS gate_status,
        lg.event_time AS last_gate_event_time,
        COALESCE(ud.total_due_paise, 0)::BIGINT AS pending_dues_paise
    FROM public.residents r
    JOIN public.properties p ON p.id = r.property_id
    LEFT JOIN latest_gate lg ON lg.resident_id = r.id
    LEFT JOIN unpaid_dues ud ON ud.resident_id = r.id
    WHERE r.property_id = p_property_id
      AND r.is_active = true
      AND (
          (p.owner_id = (SELECT auth.uid()) AND public.is_owner())
          OR EXISTS (
              SELECT 1
              FROM public.property_wardens pw
              WHERE pw.property_id = p.id
                AND pw.warden_profile_id = (SELECT auth.uid())
                AND pw.is_active = true
          )
      )
    ORDER BY r.room_number ASC, r.full_name ASC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_residents_directory_summary(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_residents_directory_summary(UUID) TO authenticated;
ALTER FUNCTION public.get_residents_directory_summary(UUID) OWNER TO postgres;

COMMIT;
