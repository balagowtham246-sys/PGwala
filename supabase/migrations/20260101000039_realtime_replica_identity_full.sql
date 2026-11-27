-- ============================================================================
-- Migration 39: Realtime REPLICA IDENTITY FULL & Complete Publication Coverage
-- ============================================================================
-- 1. Adds properties, profiles, and property_wardens to supabase_realtime so
--    owner phone, Wi-Fi, UPI, curfew, and warden changes propagate live.
-- 2. Sets REPLICA IDENTITY FULL on all 20 realtime tables so filtered UPDATE
--    and DELETE events (property_id=eq.<id>) always include property_id and
--    are never silently dropped by Supabase Realtime.

BEGIN;

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
        'washing_machine_requests',
        'washing_machine_status',
        'resident_join_requests',
        'property_chat_messages',
        'properties',
        'profiles',
        'property_wardens'
    ];
BEGIN
    FOREACH v_table IN ARRAY v_tables LOOP
        IF EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = v_table
        ) THEN
            EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', v_table);

            IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
               AND NOT EXISTS (
                   SELECT 1
                   FROM pg_publication_tables
                   WHERE pubname = 'supabase_realtime'
                     AND schemaname = 'public'
                     AND tablename = v_table
               ) THEN
                EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
            END IF;
        END IF;
    END LOOP;
END;
$$;

COMMIT;
