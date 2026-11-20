-- PGwala Senior UI/UX Upgrade & Residents Directory Migration
-- Run this idempotent script in your Supabase SQL Editor to enable:
--   1. Property gender classification & bed capacity (+ automatic backfill)
--   2. Dedicated `rooms` table with gender & bed capacity
--   3. Resident gender, joining date, deposit, bed_label, emergency_contact,
--      private owner notes, left_at, updated_at concurrency trigger, and
--      unique active bed constraint
--   4. Washing machine 'out_of_order' status support
--   5. Owner INSERT RLS policies for movement_logs & complaints

-- 1. Properties: gender classification & total bed capacity
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS gender_type TEXT NOT NULL DEFAULT 'coed'
    CHECK (gender_type IN ('coed', 'girls', 'boys'));

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS total_beds INTEGER NOT NULL DEFAULT 0
    CHECK (total_beds >= 0);

-- Backfill existing properties still defaulted to 'coed' whose name clearly specifies Girls/Boys
UPDATE public.properties
SET gender_type = 'girls'
WHERE gender_type = 'coed'
  AND name ~* '\m(girl|girls|ladies|women|womens|female)\M';

UPDATE public.properties
SET gender_type = 'boys'
WHERE gender_type = 'coed'
  AND name ~* '\m(boy|boys|mens|men|gents|male)\M';

-- 2. Rooms table: capacity, gender rules & unique room codes per property
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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'rooms' AND policyname = 'Owners manage their property rooms'
  ) THEN
    CREATE POLICY "Owners manage their property rooms"
      ON public.rooms
      FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM public.properties p
          WHERE p.id = rooms.property_id AND p.owner_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.properties p
          WHERE p.id = rooms.property_id AND p.owner_id = auth.uid()
        )
      );
  END IF;
END $$;

-- 3. Residents: gender, joining_date, deposit, bed_label, emergency_contact, notes, left_at, updated_at
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

CREATE OR REPLACE FUNCTION public.pgwala_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_residents_updated_at ON public.residents;
CREATE TRIGGER set_residents_updated_at
  BEFORE UPDATE ON public.residents
  FOR EACH ROW
  EXECUTE FUNCTION public.pgwala_touch_updated_at();

-- Enforce that two active residents can never occupy the same bed in a room
CREATE UNIQUE INDEX IF NOT EXISTS idx_residents_active_bed
  ON public.residents (property_id, room_number, bed_label)
  WHERE is_active = true AND bed_label IS NOT NULL;

-- 4. Washing machines: allow 'out_of_order' status in addition to 'free' and 'in_use'
DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT c.conname INTO v_constraint_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'washing_machines'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%status%';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.washing_machines DROP CONSTRAINT %I', v_constraint_name);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'washing_machines'
  ) THEN
    ALTER TABLE public.washing_machines
      ADD CONSTRAINT washing_machines_status_check
      CHECK (status IN ('free', 'in_use', 'out_of_order'));
  END IF;
END $$;

-- 5. Owner INSERT RLS policies for Gate quick actions & Maintenance complaint logging
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'movement_logs'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'movement_logs' AND policyname = 'Owners insert movement logs for owned properties'
  ) THEN
    CREATE POLICY "Owners insert movement logs for owned properties"
      ON public.movement_logs
      FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.properties p
          WHERE p.id = movement_logs.property_id AND p.owner_id = auth.uid()
        )
      );
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'complaints'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'complaints' AND policyname = 'Owners insert complaints for owned properties'
  ) THEN
    CREATE POLICY "Owners insert complaints for owned properties"
      ON public.complaints
      FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.properties p
          WHERE p.id = complaints.property_id AND p.owner_id = auth.uid()
        )
      );
  END IF;
END $$;

-- 6. Column-level UPDATE grants for new property & resident fields (critical for RLS + column-scoped schemas)
GRANT SELECT, INSERT ON TABLE public.properties TO authenticated;
GRANT UPDATE (name, address, is_active, gender_type, total_beds) ON TABLE public.properties TO authenticated;
GRANT UPDATE (full_name, phone_number, room_number, is_active, gender, joining_date, monthly_rent_paise, deposit_paise, bed_label, emergency_contact, notes, left_at) ON TABLE public.residents TO authenticated;

-- 7. Announcements broadcast table (All residents or a single room, via Push or WhatsApp)
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

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'announcements' AND policyname = 'Owners manage their announcements'
  ) THEN
    CREATE POLICY "Owners manage their announcements"
      ON public.announcements
      FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM public.properties p
          WHERE p.id = announcements.property_id AND p.owner_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.properties p
          WHERE p.id = announcements.property_id AND p.owner_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'announcements' AND policyname = 'Residents view announcements for their property'
  ) THEN
    CREATE POLICY "Residents view announcements for their property"
      ON public.announcements
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM public.residents r
          WHERE r.property_id = announcements.property_id
            AND r.profile_id = auth.uid()
            AND r.is_active = true
            AND (
              announcements.audience = 'all'
              OR LOWER(TRIM(COALESCE(announcements.room_number, ''))) = LOWER(TRIM(COALESCE(r.room_number, '')))
            )
        )
      );
  END IF;
END $$;

-- 8. Resident self-service emergency contact RPC (mirrors set_my_meal_opt_in)
CREATE OR REPLACE FUNCTION public.set_my_emergency_contact(p_value TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.residents
  SET emergency_contact = NULLIF(TRIM(COALESCE(p_value, '')), '')
  WHERE profile_id = auth.uid()
    AND is_active = true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_my_emergency_contact(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_my_emergency_contact(TEXT) TO authenticated;

-- 9. Owner-managed UPI payment details, PG Wi-Fi/curfew info, optional meal times & warden contact read RLS
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

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'property_wardens'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'property_wardens' AND policyname = 'Residents view active warden for their property'
  ) THEN
    CREATE POLICY "Residents view active warden for their property"
      ON public.property_wardens
      FOR SELECT
      TO authenticated
      USING (
        is_active = true
        AND EXISTS (
          SELECT 1 FROM public.residents r
          WHERE r.property_id = property_wardens.property_id
            AND r.profile_id = auth.uid()
            AND r.is_active = true
        )
      );
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'property_wardens'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_select_property_owner_and_warden'
  ) THEN
    CREATE POLICY "profiles_select_property_owner_and_warden"
      ON public.profiles
      FOR SELECT
      TO authenticated
      USING (
        id IN (
          SELECT p.owner_id
          FROM public.properties p
          JOIN public.residents r ON r.property_id = p.id
          WHERE r.profile_id = auth.uid() AND r.is_active = true
        )
        OR id IN (
          SELECT pw.warden_profile_id
          FROM public.property_wardens pw
          JOIN public.residents r ON r.property_id = pw.property_id
          WHERE r.profile_id = auth.uid()
            AND r.is_active = true
            AND pw.is_active = true
        )
      );
  END IF;
END $$;
