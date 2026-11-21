-- ==============================================================================
-- PGwala UX Hardening, Announcements & Owner-Managed Property Metadata
-- File: supabase/migrations/20260101000024_ux_hardening_and_announcements.sql
-- ==============================================================================
-- Formalises docs/supabase-ux-upgrade.sql (sections 1-9) as a versioned,
-- idempotent migration, with the following security / integrity corrections:
--
--   * Washing machine 'out_of_order' is added to the ENUM (the doc version
--     added a TEXT CHECK on an ENUM column, which errors, and its ILIKE
--     '%status%' lookup could drop the chk_wm_unit_status invariant).
--   * announcements: owner policy now pins owner_id = auth.uid(); resident room
--     matching uses the same normalisation as normalizeRoomCode() in the app;
--     anon access revoked; least-privilege grants; listing index.
--   * food_menus: column grants for meal_time (owner menu editor writes it).
--   * set_my_emergency_contact: length cap, empty search_path.
--   * washing_machine_requests: residents can only file 'pending' requests for
--     their own property; owner UPDATE gets a WITH CHECK.
--   * anon revoked on rooms / announcements / washing_machines /
--     washing_machine_requests; EXECUTE revoked from PUBLIC/anon on WM RPCs.
--
-- Policies whose definition changed are DROP + CREATE so environments that ran
-- the older doc script pick up the corrected definition.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 0. Helpers
-- ------------------------------------------------------------------------------
-- Mirrors normalizeRoomCode() in src/lib/ux-utils.ts: trims, collapses spaces,
-- strips any leading "Room " / "Rm " prefixes, and lower-cases for comparison.
CREATE OR REPLACE FUNCTION public.pgwala_normalize_room(p_raw TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT pg_catalog.regexp_replace(
        pg_catalog.lower(
            pg_catalog.regexp_replace(pg_catalog.btrim(COALESCE(p_raw, '')), '\s+', ' ', 'g')
        ),
        '^((room|rm) )+',
        ''
    );
$$;

GRANT EXECUTE ON FUNCTION public.pgwala_normalize_room(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.pgwala_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at = pg_catalog.now();
    RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------------------
-- 1. Properties: gender classification & total bed capacity
-- ------------------------------------------------------------------------------
ALTER TABLE public.properties
    ADD COLUMN IF NOT EXISTS gender_type TEXT NOT NULL DEFAULT 'coed'
        CHECK (gender_type IN ('coed', 'girls', 'boys'));

ALTER TABLE public.properties
    ADD COLUMN IF NOT EXISTS total_beds INTEGER NOT NULL DEFAULT 0
        CHECK (total_beds >= 0);

-- Backfill only rows still on the default whose name clearly states the type.
UPDATE public.properties
SET gender_type = 'girls'
WHERE gender_type = 'coed'
  AND name ~* '\m(girl|girls|ladies|women|womens|female)\M';

UPDATE public.properties
SET gender_type = 'boys'
WHERE gender_type = 'coed'
  AND name ~* '\m(boy|boys|mens|men|gents|male)\M';

-- ------------------------------------------------------------------------------
-- 2. Rooms
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    room_number TEXT NOT NULL,
    total_beds INTEGER NOT NULL DEFAULT 2 CHECK (total_beds >= 1),
    gender_type TEXT NOT NULL DEFAULT 'coed' CHECK (gender_type IN ('coed', 'girls', 'boys')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (property_id, room_number)
);

ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners manage their property rooms" ON public.rooms;
CREATE POLICY "Owners manage their property rooms"
    ON public.rooms
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.properties p
            WHERE p.id = rooms.property_id AND p.owner_id = (SELECT auth.uid())
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.properties p
            WHERE p.id = rooms.property_id AND p.owner_id = (SELECT auth.uid())
        )
    );

REVOKE ALL ON TABLE public.rooms FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rooms TO authenticated;

DROP TRIGGER IF EXISTS set_rooms_updated_at ON public.rooms;
CREATE TRIGGER set_rooms_updated_at
    BEFORE UPDATE ON public.rooms
    FOR EACH ROW
    EXECUTE FUNCTION public.pgwala_touch_updated_at();

-- ------------------------------------------------------------------------------
-- 3. Residents: stay details
-- ------------------------------------------------------------------------------
ALTER TABLE public.residents
    ADD COLUMN IF NOT EXISTS gender TEXT
        CHECK (gender IN ('male', 'female', 'other'));

ALTER TABLE public.residents
    ADD COLUMN IF NOT EXISTS joining_date DATE DEFAULT CURRENT_DATE;

ALTER TABLE public.residents
    ADD COLUMN IF NOT EXISTS deposit_paise INTEGER NOT NULL DEFAULT 0
        CHECK (deposit_paise >= 0);

ALTER TABLE public.residents
    ADD COLUMN IF NOT EXISTS bed_label TEXT;

ALTER TABLE public.residents
    ADD COLUMN IF NOT EXISTS emergency_contact TEXT;

ALTER TABLE public.residents
    ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE public.residents
    ADD COLUMN IF NOT EXISTS left_at DATE;

ALTER TABLE public.residents
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS set_residents_updated_at ON public.residents;
CREATE TRIGGER set_residents_updated_at
    BEFORE UPDATE ON public.residents
    FOR EACH ROW
    EXECUTE FUNCTION public.pgwala_touch_updated_at();

-- Two active residents can never occupy the same bed in a room.
CREATE UNIQUE INDEX IF NOT EXISTS idx_residents_active_bed
    ON public.residents (property_id, room_number, bed_label)
    WHERE is_active = true AND bed_label IS NOT NULL;

-- ------------------------------------------------------------------------------
-- 4. Washing machines: 'out_of_order' status
-- ------------------------------------------------------------------------------
-- status is the ENUM public.washing_machine_status_type. A new ENUM value
-- cannot be *used* in the transaction that adds it, so the invariant below
-- compares status::text instead of the enum literal.
ALTER TYPE public.washing_machine_status_type ADD VALUE IF NOT EXISTS 'out_of_order';

ALTER TABLE public.washing_machines DROP CONSTRAINT IF EXISTS chk_wm_unit_status;
ALTER TABLE public.washing_machines DROP CONSTRAINT IF EXISTS washing_machines_status_check;

ALTER TABLE public.washing_machines
    ADD CONSTRAINT chk_wm_unit_status CHECK (
        (status::text = 'free'         AND current_resident_id IS NULL     AND started_at IS NULL) OR
        (status::text = 'in_use'       AND current_resident_id IS NOT NULL AND started_at IS NOT NULL) OR
        (status::text = 'out_of_order' AND current_resident_id IS NULL     AND started_at IS NULL)
    );

REVOKE ALL ON TABLE public.washing_machines FROM anon;
REVOKE ALL ON TABLE public.washing_machine_requests FROM anon;

-- Residents may only file a 'pending' request for the property they live in.
-- (request_wm_access() is SECURITY DEFINER and remains the normal path.)
DROP POLICY IF EXISTS "wm_requests_resident_insert" ON public.washing_machine_requests;
CREATE POLICY "wm_requests_resident_insert"
    ON public.washing_machine_requests FOR INSERT
    TO authenticated
    WITH CHECK (
        status = 'pending'
        AND EXISTS (
            SELECT 1 FROM public.residents r
            WHERE r.id = washing_machine_requests.resident_id
              AND r.property_id = washing_machine_requests.property_id
              AND r.profile_id = (SELECT auth.uid())
              AND r.is_active = true
        )
    );

DROP POLICY IF EXISTS "wm_requests_owner_update" ON public.washing_machine_requests;
CREATE POLICY "wm_requests_owner_update"
    ON public.washing_machine_requests FOR UPDATE
    TO authenticated
    USING (
        property_id IN (SELECT id FROM public.properties WHERE owner_id = (SELECT auth.uid()))
    )
    WITH CHECK (
        property_id IN (SELECT id FROM public.properties WHERE owner_id = (SELECT auth.uid()))
    );

-- Owner policy on machines: add explicit WITH CHECK so a row cannot be moved
-- into a property the caller does not own.
DROP POLICY IF EXISTS "wm_machines_owner_all" ON public.washing_machines;
CREATE POLICY "wm_machines_owner_all"
    ON public.washing_machines FOR ALL
    TO authenticated
    USING (
        property_id IN (SELECT id FROM public.properties WHERE owner_id = (SELECT auth.uid()))
    )
    WITH CHECK (
        property_id IN (SELECT id FROM public.properties WHERE owner_id = (SELECT auth.uid()))
    );

REVOKE EXECUTE ON FUNCTION public.get_or_create_wm_units(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.request_wm_access(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.start_washing_machine_unit(UUID, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.release_washing_machine_unit(UUID, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.toggle_resident_wm_billing(UUID, UUID, BOOLEAN, DATE) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_property_wm_count(UUID, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_wm_units(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_wm_access(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_washing_machine_unit(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_washing_machine_unit(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_resident_wm_billing(UUID, UUID, BOOLEAN, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_property_wm_count(UUID, INT) TO authenticated;

-- ------------------------------------------------------------------------------
-- 5. Owner INSERT policies: Gate quick actions & Maintenance logging
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Owners insert movement logs for owned properties" ON public.movement_logs;
CREATE POLICY "Owners insert movement logs for owned properties"
    ON public.movement_logs
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.properties p
            WHERE p.id = movement_logs.property_id AND p.owner_id = (SELECT auth.uid())
        )
        AND EXISTS (
            SELECT 1 FROM public.residents r
            WHERE r.id = movement_logs.resident_id
              AND r.property_id = movement_logs.property_id
        )
    );

DROP POLICY IF EXISTS "Owners insert complaints for owned properties" ON public.complaints;
CREATE POLICY "Owners insert complaints for owned properties"
    ON public.complaints
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.properties p
            WHERE p.id = complaints.property_id AND p.owner_id = (SELECT auth.uid())
        )
    );

-- ------------------------------------------------------------------------------
-- 6. Column-level grants (properties / residents / food_menus)
-- ------------------------------------------------------------------------------
-- Row access is still governed by RLS: only owners have UPDATE policies on
-- properties and residents, so residents cannot use these column grants.
ALTER TABLE public.properties
    ADD COLUMN IF NOT EXISTS upi_id TEXT
        CHECK (upi_id IS NULL OR upi_id ~ '^[a-zA-Z0-9._-]+@[a-zA-Z]+$');

ALTER TABLE public.properties
    ADD COLUMN IF NOT EXISTS upi_payee_name TEXT;

ALTER TABLE public.properties
    ADD COLUMN IF NOT EXISTS wifi_ssid TEXT;

ALTER TABLE public.properties
    ADD COLUMN IF NOT EXISTS wifi_password TEXT;

ALTER TABLE public.properties
    ADD COLUMN IF NOT EXISTS curfew_time TEXT
        CHECK (curfew_time IS NULL OR curfew_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

ALTER TABLE public.food_menus
    ADD COLUMN IF NOT EXISTS meal_time TEXT
        CHECK (meal_time IS NULL OR meal_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

GRANT UPDATE (
    name,
    address,
    is_active,
    gender_type,
    total_beds,
    upi_id,
    upi_payee_name,
    wifi_ssid,
    wifi_password,
    curfew_time
) ON TABLE public.properties TO authenticated;

GRANT UPDATE (
    full_name,
    phone_number,
    room_number,
    is_active,
    gender,
    joining_date,
    monthly_rent_paise,
    deposit_paise,
    bed_label,
    emergency_contact,
    notes,
    left_at
) ON TABLE public.residents TO authenticated;

GRANT INSERT (meal_time) ON TABLE public.food_menus TO authenticated;
GRANT UPDATE (meal_time) ON TABLE public.food_menus TO authenticated;

-- ------------------------------------------------------------------------------
-- 7. Announcements
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    audience TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'room')),
    room_number TEXT,
    channel TEXT NOT NULL DEFAULT 'push' CHECK (channel IN ('push', 'whatsapp')),
    recipient_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Integrity: room broadcasts must name a room; sane lengths.
ALTER TABLE public.announcements DROP CONSTRAINT IF EXISTS chk_announcements_room_target;
ALTER TABLE public.announcements
    ADD CONSTRAINT chk_announcements_room_target
    CHECK (audience <> 'room' OR pg_catalog.length(pg_catalog.btrim(COALESCE(room_number, ''))) > 0)
    NOT VALID;

ALTER TABLE public.announcements DROP CONSTRAINT IF EXISTS chk_announcements_lengths;
ALTER TABLE public.announcements
    ADD CONSTRAINT chk_announcements_lengths
    CHECK (
        pg_catalog.length(pg_catalog.btrim(title)) BETWEEN 1 AND 200
        AND pg_catalog.length(pg_catalog.btrim(message)) BETWEEN 1 AND 4000
        AND recipient_count >= 0
    )
    NOT VALID;

CREATE INDEX IF NOT EXISTS idx_announcements_property_created
    ON public.announcements (property_id, created_at DESC);

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.announcements FROM anon;
REVOKE ALL ON TABLE public.announcements FROM authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.announcements TO authenticated;
GRANT ALL ON TABLE public.announcements TO service_role;

DROP POLICY IF EXISTS "Owners manage their announcements" ON public.announcements;
CREATE POLICY "Owners manage their announcements"
    ON public.announcements
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.properties p
            WHERE p.id = announcements.property_id AND p.owner_id = (SELECT auth.uid())
        )
    )
    WITH CHECK (
        owner_id = (SELECT auth.uid())
        AND EXISTS (
            SELECT 1 FROM public.properties p
            WHERE p.id = announcements.property_id AND p.owner_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Residents view announcements for their property" ON public.announcements;
CREATE POLICY "Residents view announcements for their property"
    ON public.announcements
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.residents r
            WHERE r.property_id = announcements.property_id
              AND r.profile_id = (SELECT auth.uid())
              AND r.is_active = true
              AND (
                  announcements.audience = 'all'
                  OR public.pgwala_normalize_room(announcements.room_number)
                     = public.pgwala_normalize_room(r.room_number)
              )
        )
    );

-- ------------------------------------------------------------------------------
-- 8. Resident self-service emergency contact
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_my_emergency_contact(p_value TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_clean TEXT;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
    END IF;

    v_clean := NULLIF(pg_catalog.btrim(COALESCE(p_value, '')), '');

    IF v_clean IS NOT NULL AND pg_catalog.length(v_clean) > 120 THEN
        RAISE EXCEPTION 'Emergency contact must be 120 characters or fewer'
            USING ERRCODE = '22001';
    END IF;

    -- Only the caller's own active residency rows; no other column is touched.
    UPDATE public.residents
    SET emergency_contact = v_clean
    WHERE profile_id = (SELECT auth.uid())
      AND is_active = true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_my_emergency_contact(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_emergency_contact(TEXT) TO authenticated;

-- ------------------------------------------------------------------------------
-- 9. Resident read access to the active warden of their property
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Residents view active warden for their property" ON public.property_wardens;
CREATE POLICY "Residents view active warden for their property"
    ON public.property_wardens
    FOR SELECT
    TO authenticated
    USING (
        is_active = true
        AND EXISTS (
            SELECT 1 FROM public.residents r
            WHERE r.property_id = property_wardens.property_id
              AND r.profile_id = (SELECT auth.uid())
              AND r.is_active = true
        )
    );

DROP POLICY IF EXISTS "profiles_select_property_owner_and_warden" ON public.profiles;
CREATE POLICY "profiles_select_property_owner_and_warden"
    ON public.profiles
    FOR SELECT
    TO authenticated
    USING (
        id IN (
            SELECT p.owner_id
            FROM public.properties p
            JOIN public.residents r ON r.property_id = p.id
            WHERE r.profile_id = (SELECT auth.uid()) AND r.is_active = true
        )
        OR id IN (
            SELECT pw.warden_profile_id
            FROM public.property_wardens pw
            JOIN public.residents r ON r.property_id = pw.property_id
            WHERE r.profile_id = (SELECT auth.uid())
              AND r.is_active = true
              AND pw.is_active = true
        )
    );

COMMIT;
