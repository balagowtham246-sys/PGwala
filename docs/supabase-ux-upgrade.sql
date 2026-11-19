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
