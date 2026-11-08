-- ==============================================================================
-- PGwala Chat Sender Attribution & Privacy Safe Attribution Migration
-- File: supabase/chat_sender_attribution_migration.sql
-- ==============================================================================
-- Resolves flatmate name attribution in property community chat without
-- recursive RLS on public.residents.
-- Stores immutable sender_name and sender_room on message insertion.
-- ==============================================================================

BEGIN;

-- 1. Add sender_name and sender_room columns if not already present
ALTER TABLE public.property_chat_messages
ADD COLUMN IF NOT EXISTS sender_name TEXT,
ADD COLUMN IF NOT EXISTS sender_room TEXT;

-- 2. Backfill existing chat messages from residents table
UPDATE public.property_chat_messages m
SET sender_name = r.full_name,
    sender_room = COALESCE(r.room_number, '')
FROM public.residents r
WHERE m.resident_id = r.id
  AND (m.sender_name IS NULL OR m.sender_name = '');

-- 3. Trigger Function: Automatically populate sender_name & sender_room on INSERT
CREATE OR REPLACE FUNCTION public.set_chat_sender_info()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_res RECORD;
BEGIN
    -- Populate sender_name and sender_room from residents table if not already populated
    IF NEW.sender_name IS NULL OR pg_catalog.btrim(NEW.sender_name) = '' THEN
        SELECT full_name, room_number
        INTO v_res
        FROM public.residents
        WHERE id = NEW.resident_id;

        IF FOUND THEN
            NEW.sender_name := v_res.full_name;
            NEW.sender_room := COALESCE(v_res.room_number, '');
        ELSE
            NEW.sender_name := 'Resident';
            NEW.sender_room := '';
        END IF;
    END IF;

    IF NEW.sender_room IS NULL THEN
        NEW.sender_room := '';
    END IF;

    RETURN NEW;
END;
$$;

-- 4. Attach trigger to property_chat_messages
DROP TRIGGER IF EXISTS trg_set_chat_sender_info ON public.property_chat_messages;
CREATE TRIGGER trg_set_chat_sender_info
    BEFORE INSERT ON public.property_chat_messages
    FOR EACH ROW
    EXECUTE FUNCTION public.set_chat_sender_info();

-- 5. Ensure authenticated users can insert and select these columns
GRANT SELECT, INSERT ON TABLE public.property_chat_messages TO authenticated;

COMMIT;

