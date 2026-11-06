-- ==============================================================================
-- PGwala Resident-Only Community Chat Migration
-- File: supabase/property_chat_migration.sql
-- ==============================================================================
-- Capabilities:
-- 1. Property-scoped real-time discussion channel for residents in the same PG.
-- 2. Strict Owner Exclusion: PG owners are completely blocked via RLS from reading
--    or writing to this table, keeping tenant discussions 100% private.
-- 3. Soft-delete support: Residents can delete their own messages ("This message was deleted").
-- 4. Supabase Realtime publication registration for instant push notifications.
-- ==============================================================================

BEGIN;

-- 1. Create property_chat_messages table
CREATE TABLE IF NOT EXISTS public.property_chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    resident_id UUID NOT NULL REFERENCES public.residents(id) ON DELETE CASCADE,
    message TEXT NOT NULL CHECK (char_length(trim(message)) >= 1 AND char_length(message) <= 2000),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Indexes for fast timeline retrieval and sender queries
CREATE INDEX IF NOT EXISTS idx_property_chat_timeline
    ON public.property_chat_messages (property_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_property_chat_resident
    ON public.property_chat_messages (resident_id);

-- 3. Grants & Permissions
REVOKE ALL ON TABLE public.property_chat_messages FROM anon;
REVOKE TRUNCATE, DELETE ON TABLE public.property_chat_messages FROM authenticated, anon, PUBLIC;

GRANT SELECT, INSERT ON TABLE public.property_chat_messages TO authenticated;
-- Only permit UPDATE on is_deleted and updated_at for soft deletion
GRANT UPDATE (is_deleted, updated_at) ON TABLE public.property_chat_messages TO authenticated;

-- 4. Row Level Security (RLS)
ALTER TABLE public.property_chat_messages ENABLE ROW LEVEL SECURITY;

-- Policy A: SELECT - Only active residents of that property can read messages.
-- EXPLICITLY excludes PG owners so owners cannot read resident chat.
DROP POLICY IF EXISTS "property_chat_resident_select" ON public.property_chat_messages;
CREATE POLICY "property_chat_resident_select"
    ON public.property_chat_messages FOR SELECT
    TO authenticated
    USING (
        property_id IN (
            SELECT r.property_id FROM public.residents r
            WHERE r.profile_id = (SELECT auth.uid())
              AND r.is_active = true
        )
        AND NOT public.is_owner()
    );

-- Policy B: INSERT - Only active residents can post messages to their own property room
DROP POLICY IF EXISTS "property_chat_resident_insert" ON public.property_chat_messages;
CREATE POLICY "property_chat_resident_insert"
    ON public.property_chat_messages FOR INSERT
    TO authenticated
    WITH CHECK (
        resident_id IN (
            SELECT r.id FROM public.residents r
            WHERE r.profile_id = (SELECT auth.uid())
              AND r.property_id = property_chat_messages.property_id
              AND r.is_active = true
        )
        AND NOT public.is_owner()
    );

-- Policy C: UPDATE (Soft-delete) - A resident can only soft-delete their own messages
DROP POLICY IF EXISTS "property_chat_resident_soft_delete" ON public.property_chat_messages;
CREATE POLICY "property_chat_resident_soft_delete"
    ON public.property_chat_messages FOR UPDATE
    TO authenticated
    USING (
        resident_id IN (
            SELECT r.id FROM public.residents r
            WHERE r.profile_id = (SELECT auth.uid())
              AND r.is_active = true
        )
        AND NOT public.is_owner()
    )
    WITH CHECK (
        resident_id IN (
            SELECT r.id FROM public.residents r
            WHERE r.profile_id = (SELECT auth.uid())
              AND r.is_active = true
        )
    );

-- 5. Trigger for updated_at
CREATE OR REPLACE FUNCTION public.set_chat_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_chat_updated_at ON public.property_chat_messages;
CREATE TRIGGER trg_set_chat_updated_at
    BEFORE UPDATE ON public.property_chat_messages
    FOR EACH ROW
    EXECUTE FUNCTION public.set_chat_updated_at();

-- 6. Add to Realtime Publication
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
          AND schemaname = 'public' 
          AND tablename = 'property_chat_messages'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.property_chat_messages;
    END IF;
END $$;

COMMIT;

