-- ==============================================================================
-- PGwala Food Menu Management Migration
-- File: supabase/food_menus_migration.sql
-- Description:
--   Creates the public.food_menus table with Row Level Security (RLS),
--   scoped SQL permissions, unique date-meal constraints, and automated updated_at triggers.
-- ==============================================================================

-- 1. Create Meal Type Enum (Idempotent)
DO $$ BEGIN
    CREATE TYPE public.meal_type AS ENUM ('breakfast', 'lunch', 'dinner');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- 2. Create public.food_menus Table
CREATE TABLE IF NOT EXISTS public.food_menus (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    menu_date DATE NOT NULL,
    meal_type public.meal_type NOT NULL,
    items TEXT NOT NULL,
    notes TEXT,
    is_published BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_food_menus_property_date_meal UNIQUE (property_id, menu_date, meal_type)
);

-- 3. Indexes for fast date lookups and tenant queries
CREATE INDEX IF NOT EXISTS idx_food_menus_property_date ON public.food_menus(property_id, menu_date);
CREATE INDEX IF NOT EXISTS idx_food_menus_published ON public.food_menus(is_published);

-- 4. Automated updated_at Trigger
DROP TRIGGER IF EXISTS trigger_set_updated_at_food_menus ON public.food_menus;
CREATE TRIGGER trigger_set_updated_at_food_menus
    BEFORE UPDATE ON public.food_menus
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5. Defense-in-Depth Scoped Permissions
-- Strip anon access
REVOKE ALL ON TABLE public.food_menus FROM anon;

-- Strip inherited write privileges from authenticated
REVOKE INSERT, UPDATE, DELETE ON TABLE public.food_menus FROM authenticated;

-- Explicit grants to authenticated
GRANT SELECT ON TABLE public.food_menus TO authenticated;
GRANT INSERT (property_id, menu_date, meal_type, items, notes, is_published) ON TABLE public.food_menus TO authenticated;
GRANT UPDATE (items, notes, is_published) ON TABLE public.food_menus TO authenticated;
GRANT DELETE ON TABLE public.food_menus TO authenticated;

-- 6. Row Level Security (RLS)
ALTER TABLE public.food_menus ENABLE ROW LEVEL SECURITY;

-- Owner Policies (Manage menus only for owned properties)
DROP POLICY IF EXISTS "food_menus_owner_select" ON public.food_menus;
CREATE POLICY "food_menus_owner_select"
    ON public.food_menus FOR SELECT
    TO authenticated
    USING (
        property_id IN (SELECT public.get_my_property_ids()) AND public.is_owner()
    );

DROP POLICY IF EXISTS "food_menus_owner_insert" ON public.food_menus;
CREATE POLICY "food_menus_owner_insert"
    ON public.food_menus FOR INSERT
    TO authenticated
    WITH CHECK (
        property_id IN (SELECT public.get_my_property_ids()) AND public.is_owner()
    );

DROP POLICY IF EXISTS "food_menus_owner_update" ON public.food_menus;
CREATE POLICY "food_menus_owner_update"
    ON public.food_menus FOR UPDATE
    TO authenticated
    USING (
        property_id IN (SELECT public.get_my_property_ids()) AND public.is_owner()
    )
    WITH CHECK (
        property_id IN (SELECT public.get_my_property_ids()) AND public.is_owner()
    );

DROP POLICY IF EXISTS "food_menus_owner_delete" ON public.food_menus;
CREATE POLICY "food_menus_owner_delete"
    ON public.food_menus FOR DELETE
    TO authenticated
    USING (
        property_id IN (SELECT public.get_my_property_ids()) AND public.is_owner()
    );

-- Student Policies (Read-only for published menus of their enrolled property)
DROP POLICY IF EXISTS "food_menus_student_select" ON public.food_menus;
CREATE POLICY "food_menus_student_select"
    ON public.food_menus FOR SELECT
    TO authenticated
    USING (
        is_published = true AND
        property_id IN (
            SELECT r.property_id FROM public.residents r
            WHERE r.profile_id = (SELECT auth.uid()) AND r.is_active = true
        )
    );

