const fs = require('fs');
const path = require('path');
const { PGlite } = require('./pgtest/node_modules/@electric-sql/pglite');

async function testCleanInstall() {
  const db = new PGlite();
  
  // Create minimal baseline schema matching user's exact production description:
  // - profiles, properties, residents, movement_logs, food_menus
  // - user_role, movement_direction, meal_type
  // - is_owner(), get_my_property_ids(), set_updated_at()
  // - NO billing tables exist!
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    CREATE TABLE IF NOT EXISTS auth.users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT UNIQUE
    );

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql AS $$ SELECT NULL::UUID; $$;

    DO $$ BEGIN CREATE TYPE public.user_role AS ENUM ('owner', 'student'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE TYPE public.movement_direction AS ENUM ('IN', 'OUT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE TYPE public.meal_type AS ENUM ('breakfast', 'lunch', 'dinner'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    CREATE TABLE public.profiles (
        id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
        full_name TEXT NOT NULL,
        phone_number TEXT,
        role public.user_role NOT NULL DEFAULT 'student',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE public.properties (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        address TEXT,
        owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE public.residents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
        profile_id UUID UNIQUE REFERENCES public.profiles(id) ON DELETE SET NULL,
        full_name TEXT NOT NULL,
        phone_number TEXT,
        room_number TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE public.movement_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        resident_id UUID NOT NULL REFERENCES public.residents(id) ON DELETE RESTRICT,
        direction public.movement_direction NOT NULL,
        event_time TIMESTAMPTZ NOT NULL DEFAULT now(),
        note TEXT,
        recorded_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE public.food_menus (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
        day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
        meal_type public.meal_type NOT NULL,
        items TEXT[] NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_food_menu_prop_day_meal UNIQUE (property_id, day_of_week, meal_type)
    );

    CREATE OR REPLACE FUNCTION public.set_updated_at()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
    BEGIN
        NEW.updated_at = now();
        RETURN NEW;
    END;
    $$;

    CREATE OR REPLACE FUNCTION public.is_owner()
    RETURNS BOOLEAN LANGUAGE sql AS $$
        SELECT EXISTS (
            SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'owner'
        );
    $$;

    CREATE OR REPLACE FUNCTION public.get_my_property_ids()
    RETURNS SETOF UUID LANGUAGE sql AS $$
        SELECT id FROM public.properties WHERE owner_id = (SELECT auth.uid());
    $$;
  `);

  console.log('Baseline production schema created successfully.');

  // Now apply the billing migration to this clean baseline schema:
  const migrationSqlPath = path.resolve(__dirname, '../supabase/billing_and_payments_migration.sql');
  const migrationSql = fs.readFileSync(migrationSqlPath, 'utf8');

  try {
    await db.exec(migrationSql);
    console.log('MIGRATION APPLIED CLEANLY WITHOUT ERRORS!');
  } catch (err) {
    console.error('MIGRATION FAILED:', err);
  }
}

testCleanInstall();

