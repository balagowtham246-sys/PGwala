-- ==============================================================================
-- Migration: Remote App Version & Force-Update Guard
-- File: supabase/app_version_guard_migration.sql
-- Description:
--   Creates the public.app_versions table to enforce client-side minimum version
--   requirements, preventing outdated sideloaded APKs from making incompatible
--   API calls after database migrations.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.app_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform TEXT NOT NULL UNIQUE, -- 'android' or 'ios'
    min_version TEXT NOT NULL DEFAULT '1.0.0',
    latest_version TEXT NOT NULL DEFAULT '1.0.0',
    apk_download_url TEXT,
    release_notes TEXT,
    is_mandatory BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.app_versions ENABLE ROW LEVEL SECURITY;

-- Least-privilege table grants: clients can only SELECT; writes require service_role / SQL Editor
REVOKE ALL ON TABLE public.app_versions FROM anon, authenticated, PUBLIC;
GRANT SELECT ON TABLE public.app_versions TO anon, authenticated;

-- Allow anyone (anonymous or authenticated) to read version config so the app can check before login
DROP POLICY IF EXISTS "Allow public read app_versions" ON public.app_versions;
CREATE POLICY "Allow public read app_versions"
    ON public.app_versions
    FOR SELECT
    USING (true);

-- Remove overly permissive policy that allowed any PG owner to overwrite global app_versions
DROP POLICY IF EXISTS "Allow owners to update app_versions" ON public.app_versions;

-- Seed initial Android version row
INSERT INTO public.app_versions (platform, min_version, latest_version, apk_download_url, release_notes, is_mandatory)
VALUES (
    'android',
    '1.0.0',
    '1.0.0',
    'https://expo.dev',
    'Initial production release of PGwala with live billing, complaints, and student management.',
    false
)
ON CONFLICT (platform) DO UPDATE
SET updated_at = now();

