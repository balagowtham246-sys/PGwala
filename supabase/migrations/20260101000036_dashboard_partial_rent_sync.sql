-- ============================================================================
-- Migration 36: Sync Owner Dashboard Partial Rent Collection
-- ============================================================================
-- Updates get_owner_dashboard_summary so rentCollectedPaise includes partial
-- payments recorded via active payment_allocations, keeping Owner Home 100%
-- consistent with the Billing screen.

BEGIN;

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
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'Unauthenticated.');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.properties WHERE id = p_property_id AND owner_id = v_uid) THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'Unauthorized: You do not own this property.');
    END IF;

    v_month_start := pg_catalog.date_trunc('month', COALESCE(p_date, CURRENT_DATE))::date;

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

    -- 2. Monthly Rent Collection Summary (includes partial payments via active allocations)
    WITH rent_charges AS (
        SELECT
            c.id,
            c.resident_id,
            COALESCE(c.amount_paise, 0)::BIGINT AS amount_paise,
            c.status::TEXT AS status_text,
            COALESCE((
                SELECT SUM(pa.settled_amount_paise)
                FROM public.payment_allocations pa
                WHERE pa.charge_id = c.id
                  AND pa.status = 'active'
            ), 0)::BIGINT AS allocated_paise
        FROM public.charges c
        WHERE c.property_id = p_property_id
          AND c.billing_period_start = v_month_start
          AND c.category = 'rent'
          AND c.status != 'cancelled'
    )
    SELECT
        COALESCE(SUM(
            CASE
                WHEN rc.status_text IN ('paid', 'settled') THEN rc.amount_paise
                ELSE LEAST(rc.amount_paise, rc.allocated_paise)
            END
        ), 0),
        COALESCE(SUM(rc.amount_paise), 0),
        COUNT(DISTINCT rc.resident_id) FILTER (
            WHERE rc.status_text NOT IN ('paid', 'settled')
              AND rc.allocated_paise < rc.amount_paise
        )
    INTO v_rent_collected_paise, v_rent_total_paise, v_unpaid_residents_count
    FROM rent_charges rc;

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
    SELECT COALESCE(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
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
        COALESCE(pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
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
    SELECT COALESCE(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
            'id', l.id,
            'residentId', l.resident_id,
            'residentName', r.full_name,
            'roomNumber', r.room_number,
            'direction', l.direction,
            'purpose', l.purpose,
            'eventTime', l.event_time,
            'time', pg_catalog.to_char(l.event_time AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM')
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

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'stats', pg_catalog.jsonb_build_object(
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
        'washingMachines', pg_catalog.jsonb_build_object(
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

COMMIT;
