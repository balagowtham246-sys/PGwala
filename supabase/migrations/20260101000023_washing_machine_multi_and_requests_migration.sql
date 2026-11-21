-- ==============================================================================
-- PGwala Washing Machine Access Control, Multi-Unit & Chat Sender Migration
-- File: supabase/washing_machine_multi_and_requests_migration.sql
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. WASHING MACHINE ENABLEMENT REQUESTS (R1)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.washing_machine_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    resident_id UUID NOT NULL REFERENCES public.residents(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_wm_resident_request UNIQUE (property_id, resident_id)
);

CREATE INDEX IF NOT EXISTS idx_wm_requests_property_status
    ON public.washing_machine_requests(property_id, status);

CREATE INDEX IF NOT EXISTS idx_wm_requests_resident
    ON public.washing_machine_requests(resident_id);

ALTER TABLE public.washing_machine_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wm_requests_resident_select" ON public.washing_machine_requests;
CREATE POLICY "wm_requests_resident_select"
    ON public.washing_machine_requests FOR SELECT
    TO authenticated
    USING (
        resident_id IN (
            SELECT r.id FROM public.residents r
            WHERE r.profile_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "wm_requests_resident_insert" ON public.washing_machine_requests;
CREATE POLICY "wm_requests_resident_insert"
    ON public.washing_machine_requests FOR INSERT
    TO authenticated
    WITH CHECK (
        resident_id IN (
            SELECT r.id FROM public.residents r
            WHERE r.profile_id = (SELECT auth.uid()) AND r.is_active = true
        )
    );

DROP POLICY IF EXISTS "wm_requests_owner_select" ON public.washing_machine_requests;
CREATE POLICY "wm_requests_owner_select"
    ON public.washing_machine_requests FOR SELECT
    TO authenticated
    USING (
        property_id IN (
            SELECT id FROM public.properties WHERE owner_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "wm_requests_owner_update" ON public.washing_machine_requests;
CREATE POLICY "wm_requests_owner_update"
    ON public.washing_machine_requests FOR UPDATE
    TO authenticated
    USING (
        property_id IN (
            SELECT id FROM public.properties WHERE owner_id = (SELECT auth.uid())
        )
    );

GRANT SELECT, INSERT, UPDATE ON TABLE public.washing_machine_requests TO authenticated;

-- Realtime publication for washing_machine_requests
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables 
            WHERE pubname = 'supabase_realtime' AND tablename = 'washing_machine_requests'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.washing_machine_requests;
        END IF;
    END IF;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;


-- ------------------------------------------------------------------------------
-- 2. MULTI-WASHING MACHINE UNITS TABLE (R2)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.washing_machines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    machine_number INT NOT NULL DEFAULT 1,
    machine_name TEXT NOT NULL DEFAULT 'Washing Machine 1',
    is_active BOOLEAN NOT NULL DEFAULT true, -- Active vs out of order / disabled
    status public.washing_machine_status_type NOT NULL DEFAULT 'free',
    current_resident_id UUID REFERENCES public.residents(id) ON DELETE SET NULL,
    started_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_property_machine_number UNIQUE (property_id, machine_number),
    CONSTRAINT chk_wm_unit_status CHECK (
        (status = 'free' AND current_resident_id IS NULL AND started_at IS NULL) OR
        (status = 'in_use' AND current_resident_id IS NOT NULL AND started_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_wm_machines_property ON public.washing_machines(property_id);

ALTER TABLE public.washing_machines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wm_machines_owner_all" ON public.washing_machines;
CREATE POLICY "wm_machines_owner_all"
    ON public.washing_machines FOR ALL
    TO authenticated
    USING (
        property_id IN (
            SELECT id FROM public.properties WHERE owner_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "wm_machines_resident_select" ON public.washing_machines;
CREATE POLICY "wm_machines_resident_select"
    ON public.washing_machines FOR SELECT
    TO authenticated
    USING (
        property_id IN (
            SELECT property_id FROM public.residents
            WHERE profile_id = (SELECT auth.uid()) AND is_active = true
        )
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.washing_machines TO authenticated;

-- Realtime publication for washing_machines
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables 
            WHERE pubname = 'supabase_realtime' AND tablename = 'washing_machines'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.washing_machines;
        END IF;
    END IF;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;


-- ------------------------------------------------------------------------------
-- 4. SECURITY DEFINER RPC: get_or_create_wm_units (R1, R2)
-- ------------------------------------------------------------------------------
-- Returns list of machines for property, plus caller's enablement and request status
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

    -- Check if caller is owner
    IF EXISTS (SELECT 1 FROM public.properties WHERE id = p_property_id AND owner_id = v_uid) THEN
        v_is_owner := true;
    END IF;

    -- Check if caller is active resident
    SELECT id, full_name, room_number INTO v_resident
    FROM public.residents
    WHERE property_id = p_property_id AND profile_id = v_uid AND is_active = true
    LIMIT 1;

    IF NOT v_is_owner AND v_resident.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized. You do not belong to this property.');
    END IF;

    -- Ensure default machines exist (at least 2 units for multi-machine support)
    INSERT INTO public.washing_machines (property_id, machine_number, machine_name, is_active, status)
    VALUES 
        (p_property_id, 1, 'Washing Machine 1', true, 'free'),
        (p_property_id, 2, 'Washing Machine 2', true, 'free')
    ON CONFLICT (property_id, machine_number) DO NOTHING;

    -- Also ensure legacy table has machine 1 status synced
    INSERT INTO public.washing_machine_status (property_id, status, current_resident_id, started_at, updated_at)
    VALUES (p_property_id, 'free', NULL, NULL, now())
    ON CONFLICT (property_id) DO NOTHING;

    -- Check resident enablement and pending request if resident
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

    -- Query all machines with occupant details
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


-- ------------------------------------------------------------------------------
-- 5. SECURITY DEFINER RPC: request_wm_access (R1)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_wm_access(p_property_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID;
    v_resident_id UUID;
BEGIN
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthenticated request.');
    END IF;

    SELECT id INTO v_resident_id
    FROM public.residents
    WHERE property_id = p_property_id AND profile_id = v_uid AND is_active = true
    LIMIT 1;

    IF v_resident_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Only active residents of this PG can request washing machine access.');
    END IF;

    INSERT INTO public.washing_machine_requests (property_id, resident_id, status, updated_at)
    VALUES (p_property_id, v_resident_id, 'pending', now())
    ON CONFLICT (property_id, resident_id) DO UPDATE SET
        status = 'pending',
        updated_at = now();

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Washing machine access requested successfully. The owner has been notified.'
    );
END;
$$;


-- ------------------------------------------------------------------------------
-- 6. SECURITY DEFINER RPC: start_washing_machine_unit (R1, R2)
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
    v_machine RECORD;
    v_target_id UUID;
BEGIN
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthenticated request.');
    END IF;

    -- 1. Identify active resident record
    SELECT id, full_name, room_number INTO v_resident
    FROM public.residents
    WHERE property_id = p_property_id AND profile_id = v_uid AND is_active = true
    LIMIT 1;

    IF v_resident.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized. Only active residents can use the washing machine.');
    END IF;

    -- 2. ENFORCE R1: Check that resident has been enabled by owner in billing
    SELECT is_enabled INTO v_is_enabled
    FROM public.resident_opt_ins
    WHERE resident_id = v_resident.id AND feature_name = 'washing_machine';

    IF NOT COALESCE(v_is_enabled, false) THEN
        RETURN jsonb_build_object(
            'success', false,
            'not_enabled', true,
            'error', 'Washing machine access is not enabled for your room. Please request access from your PG owner.'
        );
    END IF;

    -- 3. Resolve target machine ID (use specified machine or find first free active unit)
    IF p_machine_id IS NOT NULL THEN
        v_target_id := p_machine_id;
    ELSE
        SELECT id INTO v_target_id
        FROM public.washing_machines
        WHERE property_id = p_property_id AND is_active = true AND status = 'free'
        ORDER BY machine_number ASC
        LIMIT 1;
    END IF;

    IF v_target_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'No washing machines are currently free.');
    END IF;

    -- 4. Lock machine row FOR UPDATE
    SELECT * INTO v_machine
    FROM public.washing_machines
    WHERE id = v_target_id AND property_id = p_property_id
    FOR UPDATE;

    IF v_machine.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Washing machine not found.');
    END IF;

    IF NOT v_machine.is_active THEN
        RETURN jsonb_build_object('success', false, 'error', 'This washing machine is currently under maintenance.');
    END IF;

    IF v_machine.status != 'free' THEN
        RETURN jsonb_build_object('success', false, 'error', 'This washing machine is currently in use.');
    END IF;

    -- 5. Transition to 'in_use'
    UPDATE public.washing_machines
    SET
        status = 'in_use',
        current_resident_id = v_resident.id,
        started_at = now(),
        updated_at = now()
    WHERE id = v_target_id;

    -- Also keep legacy single-machine table synced if machine 1
    IF v_machine.machine_number = 1 THEN
        UPDATE public.washing_machine_status
        SET status = 'in_use', current_resident_id = v_resident.id, started_at = now(), updated_at = now()
        WHERE property_id = p_property_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Washing machine session started successfully.',
        'machine_id', v_target_id,
        'machine_name', v_machine.machine_name,
        'status', 'in_use',
        'current_resident_id', v_resident.id,
        'current_resident_name', v_resident.full_name,
        'current_resident_room', v_resident.room_number,
        'started_at', now()
    );
END;
$$;


-- ------------------------------------------------------------------------------
-- 7. SECURITY DEFINER RPC: release_washing_machine_unit (R1, R2)
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
    v_resident RECORD;
    v_machine RECORD;
    v_target_id UUID;
BEGIN
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthenticated request.');
    END IF;

    SELECT id, full_name INTO v_resident
    FROM public.residents
    WHERE property_id = p_property_id AND profile_id = v_uid AND is_active = true
    LIMIT 1;

    -- If target machine specified, find it
    IF p_machine_id IS NOT NULL THEN
        v_target_id := p_machine_id;
    ELSE
        -- Find machine currently occupied by this resident
        SELECT id INTO v_target_id
        FROM public.washing_machines
        WHERE property_id = p_property_id AND current_resident_id = v_resident.id
        LIMIT 1;
    END IF;

    IF v_target_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'No active washing machine session found for your account.');
    END IF;

    -- Lock machine row FOR UPDATE
    SELECT * INTO v_machine
    FROM public.washing_machines
    WHERE id = v_target_id AND property_id = p_property_id
    FOR UPDATE;

    IF v_machine.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Washing machine not found.');
    END IF;

    -- Verify caller owns the session or is owner
    IF v_machine.current_resident_id != v_resident.id AND NOT EXISTS (
        SELECT 1 FROM public.properties WHERE id = p_property_id AND owner_id = v_uid
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'You can only release your own washing machine session.');
    END IF;

    -- Transition to 'free'
    UPDATE public.washing_machines
    SET
        status = 'free',
        current_resident_id = NULL,
        started_at = NULL,
        updated_at = now()
    WHERE id = v_target_id;

    -- Also keep legacy single-machine table synced if machine 1
    IF v_machine.machine_number = 1 THEN
        UPDATE public.washing_machine_status
        SET status = 'free', current_resident_id = NULL, started_at = NULL, updated_at = now()
        WHERE property_id = p_property_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Washing machine marked free successfully.'
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. ATOMIC RPC: toggle_resident_wm_billing (R1: Syncs opt-in, outstanding rent, & requests)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.toggle_resident_wm_billing(
    p_property_id UUID,
    p_resident_id UUID,
    p_is_enabled BOOLEAN,
    p_billing_month DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner_id UUID;
    v_month_start DATE;
    v_month_label TEXT;
    v_rent_paise BIGINT;
    v_wm_paise BIGINT;
    v_total_paise BIGINT;
    v_desc TEXT;
    v_charge RECORD;
BEGIN
    v_owner_id := (SELECT auth.uid());
    IF v_owner_id IS NULL OR NOT public.is_owner() THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Unauthorized: Only authenticated PG owners can update washing machine settings.'
        );
    END IF;

    -- Verify resident belongs to property owned by caller
    IF NOT EXISTS (
        SELECT 1 FROM public.residents r
        JOIN public.properties p ON p.id = r.property_id
        WHERE r.id = p_resident_id
          AND r.property_id = p_property_id
          AND p.owner_id = v_owner_id
    ) THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Resident not found or you do not own this property.'
        );
    END IF;

    -- Upsert resident_opt_ins
    INSERT INTO public.resident_opt_ins (resident_id, feature_name, is_enabled, effective_from_date)
    VALUES (p_resident_id, 'washing_machine', p_is_enabled, CURRENT_DATE)
    ON CONFLICT (resident_id, feature_name)
    DO UPDATE SET is_enabled = p_is_enabled;

    -- If enabled, mark any pending washing machine requests as accepted
    IF p_is_enabled THEN
        UPDATE public.washing_machine_requests
        SET status = 'accepted', updated_at = now()
        WHERE property_id = p_property_id AND resident_id = p_resident_id AND status = 'pending';
    END IF;

    -- If billing month specified, update outstanding rent charge
    IF p_billing_month IS NOT NULL THEN
        v_month_start := pg_catalog.date_trunc('month', p_billing_month)::DATE;
        v_month_label := pg_catalog.to_char(v_month_start, 'FMMonth YYYY');

        SELECT c.id, c.rent_amount_paise, c.status
        INTO v_charge
        FROM public.charges c
        WHERE c.resident_id = p_resident_id
          AND c.billing_period_start = v_month_start
          AND c.category = 'rent'
        LIMIT 1;

        IF FOUND AND v_charge.status = 'outstanding' THEN
            v_rent_paise := COALESCE(v_charge.rent_amount_paise, 800000::BIGINT);
            v_wm_paise := CASE WHEN p_is_enabled THEN 50000::BIGINT ELSE 0::BIGINT END;
            v_total_paise := v_rent_paise + v_wm_paise;

            IF v_wm_paise > 0 THEN
                v_desc := v_month_label || ' Bill (Rent ₹' || (v_rent_paise / 100)::TEXT || ' + Washing Machine ₹500)';
            ELSE
                v_desc := v_month_label || ' Bill (Room Rent ₹' || (v_rent_paise / 100)::TEXT || ')';
            END IF;

            UPDATE public.charges
            SET wm_amount_paise = v_wm_paise,
                amount_paise = v_total_paise,
                description = v_desc
            WHERE id = v_charge.id;
        END IF;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'resident_id', p_resident_id,
        'is_enabled', p_is_enabled
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.toggle_resident_wm_billing(UUID, UUID, BOOLEAN, DATE) TO authenticated;

COMMIT;
