-- ==============================================================================
-- Phase 1 / Task 7: Sync public.profiles.phone_number -> public.residents
-- File: supabase/phase1_7_sync_profile_phone_to_residents.sql
--
-- Purpose:
--   Students cannot directly UPDATE public.residents (restricted to owners by RLS).
--   This SECURITY DEFINER trigger automatically propagates phone_number updates
--   from public.profiles to any linked public.residents record.
--
-- Instructions:
--   Review and execute this script in the Supabase SQL Editor.
-- ==============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.sync_profile_phone_to_residents()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE public.residents
    SET
        phone_number = NEW.phone_number,
        updated_at = pg_catalog.now()
    WHERE profile_id = NEW.id;

    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_profile_phone_to_residents() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_profile_phone_to_residents() FROM anon;
REVOKE EXECUTE ON FUNCTION public.sync_profile_phone_to_residents() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sync_profile_phone_to_residents() TO postgres;
ALTER FUNCTION public.sync_profile_phone_to_residents() OWNER TO postgres;

DROP TRIGGER IF EXISTS trigger_sync_profile_phone_to_residents ON public.profiles;
CREATE TRIGGER trigger_sync_profile_phone_to_residents
    AFTER UPDATE OF phone_number ON public.profiles
    FOR EACH ROW
    WHEN (OLD.phone_number IS DISTINCT FROM NEW.phone_number)
    EXECUTE FUNCTION public.sync_profile_phone_to_residents();

COMMIT;

-- Read-only verification: Confirm trigger is attached to public.profiles
SELECT
    t.tgname AS trigger_name,
    p.proname AS function_name,
    p.prosecdef AS security_definer,
    p.proconfig AS function_config
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE n.nspname = 'public'
  AND c.relname = 'profiles'
  AND t.tgname = 'trigger_sync_profile_phone_to_residents';
