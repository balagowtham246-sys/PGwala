-- ============================================================================
-- Migration 38: Multi-Day Home Visit / Vacation Leave
-- ============================================================================
-- Adds nullable expected_return_date DATE to public.movement_logs so long-term
-- college PG residents can log multi-day home visits / semester breaks inside
-- the existing append-only gate log:
--   * Automatically sets food_required = false while on leave
--   * Clears expected_return_date when checking back IN
--   * Exposes expectedReturnDate in get_student_dashboard_summary
--   * Excludes residents currently on multi-day leave from get_alert_audience

BEGIN;

-- 1. Add nullable expected_return_date column to append-only movement_logs
ALTER TABLE public.movement_logs
ADD COLUMN IF NOT EXISTS expected_return_date DATE DEFAULT NULL;

-- Preserve strict append-only column-scoped INSERT grants (still NO UPDATE/DELETE)
GRANT INSERT (
    property_id,
    resident_id,
    direction,
    note,
    recorded_by,
    purpose,
    expected_return_time,
    expected_return_date,
    food_required
) ON TABLE public.movement_logs TO authenticated;

-- 2. Replace record_student_movement (drop 5-arg signature to prevent overload ambiguity)
DROP FUNCTION IF EXISTS public.record_student_movement(
    public.movement_direction,
    TEXT,
    TEXT,
    BOOLEAN,
    TEXT
);

CREATE OR REPLACE FUNCTION public.record_student_movement(
    p_direction public.movement_direction,
    p_purpose TEXT DEFAULT NULL,
    p_expected_return_time TEXT DEFAULT NULL,
    p_food_required BOOLEAN DEFAULT true,
    p_note TEXT DEFAULT NULL,
    p_expected_return_date DATE DEFAULT NULL
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
    v_effective_return_date DATE;
    v_effective_food_required BOOLEAN;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Authentication required.');
    END IF;

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

    IF p_direction = 'IN' THEN
        v_effective_return_date := NULL;
        v_effective_food_required := COALESCE(p_food_required, true);
    ELSE
        v_effective_return_date := p_expected_return_date;
        IF v_effective_return_date IS NOT NULL THEN
            -- Multi-day Home / Vacation Leave automatically pauses daily meals until check-in
            v_effective_food_required := false;
        ELSE
            v_effective_food_required := COALESCE(p_food_required, true);
        END IF;
    END IF;

    INSERT INTO public.movement_logs (
        property_id,
        resident_id,
        direction,
        event_time,
        purpose,
        expected_return_time,
        expected_return_date,
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
        v_effective_return_date,
        v_effective_food_required,
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
        'expected_return_date', v_effective_return_date,
        'food_required', v_effective_food_required
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_student_movement(
    public.movement_direction,
    TEXT,
    TEXT,
    BOOLEAN,
    TEXT,
    DATE
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_student_movement(
    public.movement_direction,
    TEXT,
    TEXT,
    BOOLEAN,
    TEXT,
    DATE
) TO authenticated;

-- 3. Update get_student_dashboard_summary to include expectedReturnDate in gateStatus
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

    PERFORM public.auto_release_expired_washing_machines(p_property_id);

    SELECT EXISTS (
        SELECT 1
        FROM public.charges c
        WHERE c.resident_id = p_resident_id
          AND c.billing_period_start = v_month_start
          AND c.category IN ('rent', 'electricity')
          AND c.status != 'cancelled'
    ) INTO v_current_month_bill_generated;

    SELECT COALESCE(is_enabled, false) INTO v_wm_enabled
    FROM public.resident_opt_ins
    WHERE resident_id = p_resident_id AND feature_name = 'washing_machine';

    SELECT COALESCE(status, 'none') INTO v_wm_request_status
    FROM public.washing_machine_requests
    WHERE property_id = p_property_id AND resident_id = p_resident_id;

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

    SELECT direction, event_time, purpose, expected_return_time, expected_return_date, food_required
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
            'expectedReturnDate', v_latest_gate.expected_return_date,
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

-- 4. Update get_alert_audience to exclude residents currently on multi-day leave
CREATE OR REPLACE FUNCTION public.get_alert_audience(p_property_id UUID)
RETURNS TABLE (resident_id UUID, full_name TEXT, room_number TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' STABLE
AS $$
BEGIN
  IF NOT public.can_manage_property_alerts(p_property_id) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    WITH latest_movement AS (
      SELECT DISTINCT ON (ml.resident_id)
        ml.resident_id,
        ml.direction,
        ml.expected_return_date
      FROM public.movement_logs ml
      WHERE ml.property_id = p_property_id
      ORDER BY ml.resident_id, ml.event_time DESC
    )
    SELECT r.id, r.full_name, r.room_number
    FROM public.residents r
    LEFT JOIN latest_movement lm ON lm.resident_id = r.id
    WHERE r.property_id = p_property_id
      AND r.is_active
      AND r.meal_opt_in
      AND r.profile_id IS NOT NULL
      AND NOT (lm.direction = 'OUT' AND lm.expected_return_date IS NOT NULL)
    ORDER BY r.room_number, r.full_name;
END;
$$;

COMMIT;
