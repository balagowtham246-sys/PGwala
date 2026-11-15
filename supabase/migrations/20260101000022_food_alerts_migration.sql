-- ==============================================================================
-- PGwala: Food Alerts, Wardens and Push Tokens
--
-- New tables:
--   property_wardens        one active warden per property (owner managed)
--   push_tokens             Expo push tokens per user/device
--   food_alerts             stored announcements (written only by Edge Function)
--   food_alert_recipients   per-resident audience + delivery tracking
--
-- Design notes:
--   * All writes to wardens / alerts / recipients happen in Edge Functions using
--     the service role. Authenticated clients only get SELECT (RLS scoped).
--   * Wardens never get direct access to `residents` (phones etc.). They use the
--     get_alert_audience() RPC which returns only id, name and room.
--   * Resident opt-in for meal alerts lives on residents.meal_opt_in.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. ENUM + COLUMNS
-- ------------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE public.food_alert_status AS ENUM ('ready', 'delayed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.residents
  ADD COLUMN IF NOT EXISTS meal_opt_in BOOLEAN NOT NULL DEFAULT true;

-- ------------------------------------------------------------------------------
-- 2. TABLES
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.property_wardens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  warden_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One active warden per property, and one active property per warden
CREATE UNIQUE INDEX IF NOT EXISTS uq_property_wardens_active_property
  ON public.property_wardens(property_id) WHERE is_active;
CREATE UNIQUE INDEX IF NOT EXISTS uq_property_wardens_active_warden
  ON public.property_wardens(warden_profile_id) WHERE is_active;

CREATE TABLE IF NOT EXISTS public.push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  expo_token TEXT NOT NULL UNIQUE,
  platform TEXT,
  is_valid BOOLEAN NOT NULL DEFAULT true,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_tokens_profile ON public.push_tokens(profile_id) WHERE is_valid;

CREATE TABLE IF NOT EXISTS public.food_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  meal_type public.meal_type NOT NULL,
  status public.food_alert_status NOT NULL,
  message TEXT CHECK (message IS NULL OR char_length(message) <= 200),
  audience_type TEXT NOT NULL CHECK (audience_type IN ('all', 'rooms', 'residents')),
  target_rooms TEXT[],
  target_resident_ids UUID[],
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 80),
  alert_date DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata')::date),
  dispatch_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (dispatch_status IN ('pending', 'sent', 'partial', 'failed', 'no_push')),
  recipients_count INTEGER NOT NULL DEFAULT 0,
  push_sent INTEGER NOT NULL DEFAULT 0,
  push_failed INTEGER NOT NULL DEFAULT 0,
  no_token_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_food_alerts_idempotency UNIQUE (created_by, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_food_alerts_property_created
  ON public.food_alerts(property_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.food_alert_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID NOT NULL REFERENCES public.food_alerts(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES public.residents(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  delivery_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending', 'sent', 'failed', 'no_token')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_food_alert_recipient UNIQUE (alert_id, resident_id)
);
CREATE INDEX IF NOT EXISTS idx_food_alert_recipients_profile
  ON public.food_alert_recipients(profile_id, created_at DESC);

-- ------------------------------------------------------------------------------
-- 3. SECURITY DEFINER HELPERS
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_warden_of(p_property_id UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = '' STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.property_wardens pw
    JOIN public.profiles pr ON pr.id = pw.warden_profile_id
    WHERE pw.property_id = p_property_id
      AND pw.warden_profile_id = (SELECT auth.uid())
      AND pw.is_active
      AND pr.role = 'warden'
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_property_alerts(p_property_id UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = '' STABLE
AS $$
  SELECT public.is_warden_of(p_property_id)
      OR (public.is_owner() AND EXISTS (
            SELECT 1 FROM public.properties
            WHERE id = p_property_id AND owner_id = (SELECT auth.uid())));
$$;

CREATE OR REPLACE FUNCTION public.can_view_alert_recipients(p_alert_id UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = '' STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.food_alerts a
    WHERE a.id = p_alert_id AND public.can_manage_property_alerts(a.property_id)
  );
$$;

-- Audience picker for owner/warden: only id, name, room. Active + opted-in residents
-- that have a linked login (a profile) can actually receive alerts.
CREATE OR REPLACE FUNCTION public.get_alert_audience(p_property_id UUID)
RETURNS TABLE (resident_id UUID, full_name TEXT, room_number TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' STABLE
AS $$
BEGIN
  IF NOT public.can_manage_property_alerts(p_property_id) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT r.id, r.full_name, r.room_number
    FROM public.residents r
    WHERE r.property_id = p_property_id
      AND r.is_active
      AND r.meal_opt_in
      AND r.profile_id IS NOT NULL
    ORDER BY r.room_number, r.full_name;
END;
$$;

-- Register/refresh the caller's Expo push token (handles device account switching)
CREATE OR REPLACE FUNCTION public.register_push_token(p_token TEXT, p_platform TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_token IS NULL OR p_token !~ '^(Expo|Exponent)PushToken\[.+\]$' THEN
    RAISE EXCEPTION 'Invalid Expo push token';
  END IF;
  INSERT INTO public.push_tokens (profile_id, expo_token, platform, is_valid, last_seen_at)
  VALUES ((SELECT auth.uid()), p_token, p_platform, true, now())
  ON CONFLICT (expo_token) DO UPDATE
    SET profile_id = EXCLUDED.profile_id,
        platform = EXCLUDED.platform,
        is_valid = true,
        last_seen_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.unregister_push_token(p_token TEXT)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  DELETE FROM public.push_tokens
  WHERE expo_token = p_token AND profile_id = (SELECT auth.uid());
$$;

-- Resident toggles their own meal alert preference
CREATE OR REPLACE FUNCTION public.set_my_meal_opt_in(p_value BOOLEAN)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  UPDATE public.residents SET meal_opt_in = p_value
  WHERE profile_id = (SELECT auth.uid());
$$;

REVOKE EXECUTE ON FUNCTION public.is_warden_of(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_manage_property_alerts(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_view_alert_recipients(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_alert_audience(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.register_push_token(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.unregister_push_token(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_my_meal_opt_in(BOOLEAN) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_warden_of(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_property_alerts(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_alert_recipients(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_alert_audience(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_push_token(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unregister_push_token(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_my_meal_opt_in(BOOLEAN) TO authenticated;

-- ------------------------------------------------------------------------------
-- 4. GRANTS (SELECT only for clients; service_role writes via Edge Functions)
-- ------------------------------------------------------------------------------

REVOKE ALL ON TABLE public.property_wardens FROM anon, authenticated;
REVOKE ALL ON TABLE public.push_tokens FROM anon, authenticated;
REVOKE ALL ON TABLE public.food_alerts FROM anon, authenticated;
REVOKE ALL ON TABLE public.food_alert_recipients FROM anon, authenticated;

GRANT SELECT ON TABLE public.property_wardens TO authenticated;
GRANT SELECT ON TABLE public.food_alerts TO authenticated;
GRANT SELECT ON TABLE public.food_alert_recipients TO authenticated;
-- push_tokens: no direct client access at all (RPCs only)

GRANT ALL ON TABLE public.property_wardens TO service_role;
GRANT ALL ON TABLE public.push_tokens TO service_role;
GRANT ALL ON TABLE public.food_alerts TO service_role;
GRANT ALL ON TABLE public.food_alert_recipients TO service_role;

-- ------------------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY
-- ------------------------------------------------------------------------------

ALTER TABLE public.property_wardens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.food_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.food_alert_recipients ENABLE ROW LEVEL SECURITY;

-- property_wardens: owner of the property, or the warden themself
DROP POLICY IF EXISTS "property_wardens_owner_select" ON public.property_wardens;
CREATE POLICY "property_wardens_owner_select"
  ON public.property_wardens FOR SELECT TO authenticated
  USING (public.is_owner() AND property_id IN (SELECT public.get_my_property_ids()));

DROP POLICY IF EXISTS "property_wardens_self_select" ON public.property_wardens;
CREATE POLICY "property_wardens_self_select"
  ON public.property_wardens FOR SELECT TO authenticated
  USING (warden_profile_id = (SELECT auth.uid()));

-- food_alerts: owner/warden of property, or a resident who is a recipient
DROP POLICY IF EXISTS "food_alerts_staff_select" ON public.food_alerts;
CREATE POLICY "food_alerts_staff_select"
  ON public.food_alerts FOR SELECT TO authenticated
  USING (public.can_manage_property_alerts(property_id));

DROP POLICY IF EXISTS "food_alerts_recipient_select" ON public.food_alerts;
CREATE POLICY "food_alerts_recipient_select"
  ON public.food_alerts FOR SELECT TO authenticated
  USING (
    id IN (
      SELECT alert_id FROM public.food_alert_recipients
      WHERE profile_id = (SELECT auth.uid())
    )
  );

-- food_alert_recipients: own rows, or staff of the alert's property
DROP POLICY IF EXISTS "food_alert_recipients_self_select" ON public.food_alert_recipients;
CREATE POLICY "food_alert_recipients_self_select"
  ON public.food_alert_recipients FOR SELECT TO authenticated
  USING (profile_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "food_alert_recipients_staff_select" ON public.food_alert_recipients;
CREATE POLICY "food_alert_recipients_staff_select"
  ON public.food_alert_recipients FOR SELECT TO authenticated
  USING (public.can_view_alert_recipients(alert_id));

-- Warden can read the property row (name) of their assigned property
DROP POLICY IF EXISTS "properties_warden_select" ON public.properties;
CREATE POLICY "properties_warden_select"
  ON public.properties FOR SELECT TO authenticated
  USING (public.is_warden_of(id));

-- ------------------------------------------------------------------------------
-- 6. updated_at trigger
-- ------------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trigger_set_updated_at_property_wardens ON public.property_wardens;
CREATE TRIGGER trigger_set_updated_at_property_wardens
  BEFORE UPDATE ON public.property_wardens
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
