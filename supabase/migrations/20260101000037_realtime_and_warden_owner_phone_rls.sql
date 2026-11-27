-- ============================================================================
-- Migration 37: Live Realtime Publication Coverage & Warden-to-Owner Phone RLS
-- ============================================================================
-- 1. Ensures all operational tables emit Supabase Realtime postgres_changes
--    events so Owner, Resident, and Warden apps stay live-synced automatically.
-- 2. Allows active wardens to read their assigned property owner's profile
--    (full_name, phone_number) so "Call Owner" works in Warden Settings.

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Add operational tables to supabase_realtime publication (idempotent)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_table TEXT;
    v_tables TEXT[] := ARRAY[
        'charges',
        'payment_allocations',
        'student_payment_reports',
        'property_expenses',
        'food_menus',
        'announcements',
        'food_alerts',
        'complaints',
        'movement_logs',
        'residents',
        'rooms',
        'bed_reservations',
        'washing_machines',
        'resident_join_requests'
    ];
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        FOREACH v_table IN ARRAY v_tables LOOP
            IF EXISTS (
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = 'public'
                  AND table_name = v_table
            ) AND NOT EXISTS (
                SELECT 1
                FROM pg_publication_tables
                WHERE pubname = 'supabase_realtime'
                  AND schemaname = 'public'
                  AND tablename = v_table
            ) THEN
                EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
            END IF;
        END LOOP;
    END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. Zero-recursion helper + RLS policy: active warden reads assigned owner profile
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_warden_owner_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT DISTINCT p.owner_id
    FROM public.property_wardens pw
    JOIN public.properties p ON p.id = pw.property_id
    WHERE pw.warden_profile_id = (SELECT auth.uid())
      AND pw.is_active = true
      AND p.owner_id IS NOT NULL;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_warden_owner_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_warden_owner_ids() TO authenticated;
ALTER FUNCTION public.get_my_warden_owner_ids() OWNER TO postgres;

DROP POLICY IF EXISTS "wardens_select_assigned_property_owner_profile" ON public.profiles;
CREATE POLICY "wardens_select_assigned_property_owner_profile"
    ON public.profiles
    FOR SELECT
    TO authenticated
    USING (id IN (SELECT public.get_my_warden_owner_ids()));

COMMIT;
