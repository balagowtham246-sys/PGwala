-- =============================================================================
-- Migration 30: QR & Invite Code Resident Self-Onboarding
-- =============================================================================
-- Adds unambiguous 6-character invite codes on properties + a guarded
-- resident_join_requests queue so residents can self-register via QR/code
-- while owners retain 1-tap approval + room/bed/rent assignment control.
-- =============================================================================

-- 1. Helper function to generate an unambiguous 6-character invite code
--    Excludes visually confusing characters: 0, O, 1, I, L
CREATE OR REPLACE FUNCTION public.generate_property_invite_code()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  chars CONSTANT TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  candidate TEXT;
  i INT;
  attempts INT := 0;
BEGIN
  LOOP
    attempts := attempts + 1;
    candidate := '';
    FOR i IN 1..6 LOOP
      candidate := candidate || substr(chars, 1 + floor(random() * length(chars))::INT, 1);
    END LOOP;

    IF NOT EXISTS (SELECT 1 FROM public.properties WHERE invite_code = candidate) THEN
      RETURN candidate;
    END IF;

    IF attempts > 50 THEN
      RAISE EXCEPTION 'Could not generate unique invite code after 50 attempts';
    END IF;
  END LOOP;
END;
$$;

-- 2. Add invite_code and invite_enabled columns to public.properties
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS invite_code TEXT,
  ADD COLUMN IF NOT EXISTS invite_enabled BOOLEAN NOT NULL DEFAULT true;

-- Backfill invite_code for all existing properties
UPDATE public.properties
SET invite_code = public.generate_property_invite_code()
WHERE invite_code IS NULL;

-- Ensure uniqueness & default for newly created properties
ALTER TABLE public.properties
  ALTER COLUMN invite_code SET DEFAULT public.generate_property_invite_code();

CREATE UNIQUE INDEX IF NOT EXISTS idx_properties_invite_code_unique
  ON public.properties (UPPER(invite_code))
  WHERE invite_code IS NOT NULL;

-- 3. Create resident_join_requests table
CREATE TABLE IF NOT EXISTS public.resident_join_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  gender TEXT CHECK (gender IS NULL OR gender IN ('male', 'female', 'other')),
  emergency_contact TEXT,
  room_hint TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason TEXT,
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_join_requests_property_status
  ON public.resident_join_requests (property_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_join_requests_profile_id
  ON public.resident_join_requests (profile_id, created_at DESC);

-- Prevent duplicate pending requests for the same profile + property
CREATE UNIQUE INDEX IF NOT EXISTS idx_join_requests_unique_pending
  ON public.resident_join_requests (property_id, profile_id)
  WHERE status = 'pending';

-- 4. Row Level Security on resident_join_requests
ALTER TABLE public.resident_join_requests ENABLE ROW LEVEL SECURITY;

-- Owners can view requests for properties they own
DROP POLICY IF EXISTS join_requests_owner_select ON public.resident_join_requests;
CREATE POLICY join_requests_owner_select
  ON public.resident_join_requests
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.properties p
      WHERE p.id = resident_join_requests.property_id
        AND p.owner_id = auth.uid()
    )
  );

-- Pending/rejected residents can view only their own join requests
DROP POLICY IF EXISTS join_requests_self_select ON public.resident_join_requests;
CREATE POLICY join_requests_self_select
  ON public.resident_join_requests
  FOR SELECT
  USING (profile_id = auth.uid());

-- Direct client INSERT/UPDATE/DELETE are intentionally omitted:
-- all submissions, approvals, and rejections go through the resident-join-request Edge Function.
