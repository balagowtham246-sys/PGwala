-- ==============================================================================
-- PGwala Indexes & RLS Performance Optimization Migration (Prompt 2)
-- File: supabase/migrations/20260101000026_indexes_and_rls_performance.sql
--
-- Goals (zero behavioral change):
--   1. Add missing composite indexes for billing, complaints, residents,
--      payment reports, and washing-machine opt-ins to eliminate sequential
--      scans and extra in-memory sorts.
--   2. Rewrite RLS policies calling bare `public.is_owner()` to
--      `(SELECT public.is_owner())` so PostgreSQL evaluates the SECURITY DEFINER
--      helper (and its internal `auth.uid()` lookup) once per statement via
--      InitPlan instead of once per candidate row.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. COMPOSITE INDEXES
-- ------------------------------------------------------------------------------

-- 1a. public.charges
-- Speeds up: Owner Billing (getOwnerBilling) & Owner Home Dashboard (fetchOwnerDashboard)
-- Query pattern: WHERE property_id = $1 AND billing_period_start = $2
CREATE INDEX IF NOT EXISTS idx_charges_property_period
    ON public.charges (property_id, billing_period_start);

-- Speeds up: Resident Monthly Bills (getStudentBilling) & Owner Resident Profile (fetchResidentProfileDetail)
-- Query pattern: WHERE resident_id = $1 [AND category IN (...)] ORDER BY billing_period_start DESC
CREATE INDEX IF NOT EXISTS idx_charges_resident_period
    ON public.charges (resident_id, billing_period_start DESC);

-- 1b. public.complaints
-- Speeds up: Owner Maintenance (owner-complaints.tsx) & Owner Notification Center
-- Query pattern: WHERE property_id = $1 ORDER BY created_at DESC LIMIT 30
CREATE INDEX IF NOT EXISTS idx_complaints_property_created
    ON public.complaints (property_id, created_at DESC);

-- 1c. public.residents
-- Speeds up: Owner Billing, Residents Directory, Announcements audience, Owner Complaints
-- resident lookup, Add/Edit Resident room checks, Property occupancy count
-- Query pattern: WHERE property_id = $1 AND is_active = true ORDER BY room_number ASC
CREATE INDEX IF NOT EXISTS idx_residents_property_active_room
    ON public.residents (property_id, is_active, room_number);

-- Speeds up: Resident Context, Student Home Dashboard, Resident Portal, and all
-- active-resident RLS subqueries (WHERE profile_id = (SELECT auth.uid()) AND is_active = true)
CREATE INDEX IF NOT EXISTS idx_residents_profile_active
    ON public.residents (profile_id, is_active);

-- 1d. public.resident_opt_ins
-- Speeds up: Owner Billing (getOwnerBilling) washing-machine opt-in batch fetch
-- Query pattern: WHERE feature_name = 'washing_machine' AND resident_id IN (...)
CREATE INDEX IF NOT EXISTS idx_resident_opt_ins_feature_resident
    ON public.resident_opt_ins (feature_name, resident_id);

-- 1e. public.student_payment_reports
-- Speeds up: Owner Billing (getOwnerBilling) & Owner Home Dashboard (fetchOwnerDashboard)
-- Query pattern: WHERE property_id = $1 AND status IN ('pending', 'rejected') ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_student_reports_property_status_created
    ON public.student_payment_reports (property_id, status, created_at DESC);

-- Speeds up: Resident Monthly Bills (getStudentBilling) & Resident Home Dashboard (fetchStudentDashboard)
-- Query pattern: WHERE resident_id = $1 AND status IN ('pending', 'rejected') ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_student_reports_resident_status_created
    ON public.student_payment_reports (resident_id, status, created_at DESC);

-- Note: public.movement_logs already has:
--   - idx_movement_logs_property_event_time (property_id, event_time DESC)
--   - idx_movement_logs_resident_time (resident_id, event_time DESC)
-- which cover all current gate attendance and resident gate history queries.

-- ------------------------------------------------------------------------------
-- 2. RLS POLICIES: WRAP public.is_owner() IN (SELECT public.is_owner())
--    (Eliminates per-row SECURITY DEFINER + auth.uid() re-evaluation via InitPlan)
-- ------------------------------------------------------------------------------

-- === public.profiles ===
DROP POLICY IF EXISTS "profiles_select_owner_residents" ON public.profiles;
CREATE POLICY "profiles_select_owner_residents"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (
        (SELECT public.is_owner()) AND id IN (
            SELECT r.profile_id FROM public.residents r
            WHERE r.property_id IN (SELECT public.get_my_property_ids())
        )
    );

-- === public.properties ===
DROP POLICY IF EXISTS "properties_owner_select" ON public.properties;
CREATE POLICY "properties_owner_select"
    ON public.properties FOR SELECT
    TO authenticated
    USING (owner_id = (SELECT auth.uid()) AND (SELECT public.is_owner()));

DROP POLICY IF EXISTS "properties_owner_insert" ON public.properties;
CREATE POLICY "properties_owner_insert"
    ON public.properties FOR INSERT
    TO authenticated
    WITH CHECK (owner_id = (SELECT auth.uid()) AND (SELECT public.is_owner()));

DROP POLICY IF EXISTS "properties_owner_update" ON public.properties;
CREATE POLICY "properties_owner_update"
    ON public.properties FOR UPDATE
    TO authenticated
    USING (owner_id = (SELECT auth.uid()) AND (SELECT public.is_owner()))
    WITH CHECK (owner_id = (SELECT auth.uid()) AND (SELECT public.is_owner()));

-- === public.residents ===
DROP POLICY IF EXISTS "residents_owner_select" ON public.residents;
CREATE POLICY "residents_owner_select"
    ON public.residents FOR SELECT
    TO authenticated
    USING (
        property_id IN (SELECT public.get_my_property_ids()) AND (SELECT public.is_owner())
    );

DROP POLICY IF EXISTS "residents_owner_insert" ON public.residents;
CREATE POLICY "residents_owner_insert"
    ON public.residents FOR INSERT
    TO authenticated
    WITH CHECK (
        property_id IN (SELECT public.get_my_property_ids()) AND (SELECT public.is_owner())
    );

DROP POLICY IF EXISTS "residents_owner_update" ON public.residents;
CREATE POLICY "residents_owner_update"
    ON public.residents FOR UPDATE
    TO authenticated
    USING (
        property_id IN (SELECT public.get_my_property_ids()) AND (SELECT public.is_owner())
    )
    WITH CHECK (
        property_id IN (SELECT public.get_my_property_ids()) AND (SELECT public.is_owner())
    );

-- === public.food_menus ===
DROP POLICY IF EXISTS "food_menus_owner_select" ON public.food_menus;
CREATE POLICY "food_menus_owner_select"
    ON public.food_menus FOR SELECT
    TO authenticated
    USING (
        property_id IN (SELECT public.get_my_property_ids()) AND (SELECT public.is_owner())
    );

DROP POLICY IF EXISTS "food_menus_owner_insert" ON public.food_menus;
CREATE POLICY "food_menus_owner_insert"
    ON public.food_menus FOR INSERT
    TO authenticated
    WITH CHECK (
        property_id IN (SELECT public.get_my_property_ids()) AND (SELECT public.is_owner())
    );

DROP POLICY IF EXISTS "food_menus_owner_update" ON public.food_menus;
CREATE POLICY "food_menus_owner_update"
    ON public.food_menus FOR UPDATE
    TO authenticated
    USING (
        property_id IN (SELECT public.get_my_property_ids()) AND (SELECT public.is_owner())
    )
    WITH CHECK (
        property_id IN (SELECT public.get_my_property_ids()) AND (SELECT public.is_owner())
    );

DROP POLICY IF EXISTS "food_menus_owner_delete" ON public.food_menus;
CREATE POLICY "food_menus_owner_delete"
    ON public.food_menus FOR DELETE
    TO authenticated
    USING (
        property_id IN (SELECT public.get_my_property_ids()) AND (SELECT public.is_owner())
    );

-- === public.charges ===
DROP POLICY IF EXISTS "charges_owner_select" ON public.charges;
CREATE POLICY "charges_owner_select"
    ON public.charges FOR SELECT
    TO authenticated
    USING (
        property_id IN (SELECT public.get_my_property_ids()) AND (SELECT public.is_owner())
    );

-- === public.eb_room_bills ===
DROP POLICY IF EXISTS "eb_bills_owner_select" ON public.eb_room_bills;
CREATE POLICY "eb_bills_owner_select"
    ON public.eb_room_bills FOR SELECT
    TO authenticated
    USING (
        property_id IN (SELECT public.get_my_property_ids()) AND (SELECT public.is_owner())
    );

-- === public.eb_allocations ===
DROP POLICY IF EXISTS "eb_allocations_owner_select" ON public.eb_allocations;
CREATE POLICY "eb_allocations_owner_select"
    ON public.eb_allocations FOR SELECT
    TO authenticated
    USING (
        resident_id IN (
            SELECT r.id FROM public.residents r
            WHERE r.property_id IN (SELECT public.get_my_property_ids())
        ) AND (SELECT public.is_owner())
    );

-- === public.payments ===
DROP POLICY IF EXISTS "payments_owner_select" ON public.payments;
CREATE POLICY "payments_owner_select"
    ON public.payments FOR SELECT
    TO authenticated
    USING (
        property_id IN (SELECT public.get_my_property_ids()) AND (SELECT public.is_owner())
    );

-- === public.payment_allocations ===
DROP POLICY IF EXISTS "payment_allocations_owner_select" ON public.payment_allocations;
CREATE POLICY "payment_allocations_owner_select"
    ON public.payment_allocations FOR SELECT
    TO authenticated
    USING (
        payment_id IN (
            SELECT p.id FROM public.payments p
            WHERE p.property_id IN (SELECT public.get_my_property_ids())
        ) AND (SELECT public.is_owner())
    );

-- === public.student_payment_reports ===
DROP POLICY IF EXISTS "student_reports_owner_select" ON public.student_payment_reports;
CREATE POLICY "student_reports_owner_select"
    ON public.student_payment_reports FOR SELECT
    TO authenticated
    USING (
        property_id IN (SELECT public.get_my_property_ids()) AND (SELECT public.is_owner())
    );

-- === public.resident_opt_ins ===
DROP POLICY IF EXISTS "opt_ins_owner_select" ON public.resident_opt_ins;
CREATE POLICY "opt_ins_owner_select"
    ON public.resident_opt_ins FOR SELECT
    TO authenticated
    USING (
        resident_id IN (
            SELECT r.id FROM public.residents r
            WHERE r.property_id IN (SELECT public.get_my_property_ids())
        ) AND (SELECT public.is_owner())
    );

-- === public.complaints ===
DROP POLICY IF EXISTS "complaints_owner_select" ON public.complaints;
CREATE POLICY "complaints_owner_select"
    ON public.complaints FOR SELECT
    TO authenticated
    USING (
        property_id IN (SELECT public.get_my_property_ids())
        AND (SELECT public.is_owner())
    );

DROP POLICY IF EXISTS "complaints_owner_update" ON public.complaints;
CREATE POLICY "complaints_owner_update"
    ON public.complaints FOR UPDATE
    TO authenticated
    USING (
        property_id IN (SELECT public.get_my_property_ids())
        AND (SELECT public.is_owner())
    )
    WITH CHECK (
        property_id IN (SELECT public.get_my_property_ids())
        AND (SELECT public.is_owner())
    );

-- === public.movement_logs ===
DROP POLICY IF EXISTS "movement_logs_owner_insert" ON public.movement_logs;
CREATE POLICY "movement_logs_owner_insert"
    ON public.movement_logs FOR INSERT
    TO authenticated
    WITH CHECK (
        (SELECT public.is_owner()) AND
        recorded_by = (SELECT auth.uid()) AND
        resident_id IN (
            SELECT id FROM public.residents
            WHERE property_id IN (SELECT public.get_my_property_ids())
        )
    );

DROP POLICY IF EXISTS "movement_logs_owner_select" ON public.movement_logs;
CREATE POLICY "movement_logs_owner_select"
    ON public.movement_logs FOR SELECT
    TO authenticated
    USING (
        (SELECT public.is_owner()) AND (
            property_id IN (SELECT public.get_my_property_ids())
            OR
            (property_id IS NULL AND resident_id IN (
                SELECT id FROM public.residents
                WHERE property_id IN (SELECT public.get_my_property_ids())
            ))
        )
    );

-- === public.property_chat_messages ===
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
        AND NOT (SELECT public.is_owner())
    );

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
        AND NOT (SELECT public.is_owner())
    );

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
        AND NOT (SELECT public.is_owner())
    )
    WITH CHECK (
        resident_id IN (
            SELECT r.id FROM public.residents r
            WHERE r.profile_id = (SELECT auth.uid())
              AND r.is_active = true
        )
    );

-- === public.property_wardens ===
DROP POLICY IF EXISTS "property_wardens_owner_select" ON public.property_wardens;
CREATE POLICY "property_wardens_owner_select"
    ON public.property_wardens FOR SELECT
    TO authenticated
    USING ((SELECT public.is_owner()) AND property_id IN (SELECT public.get_my_property_ids()));

-- === public.can_manage_property_alerts (used by food_alerts & food_alert_recipients RLS) ===
CREATE OR REPLACE FUNCTION public.can_manage_property_alerts(p_property_id UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = '' STABLE
AS $$
  SELECT public.is_warden_of(p_property_id)
      OR ((SELECT public.is_owner()) AND EXISTS (
            SELECT 1 FROM public.properties
            WHERE id = p_property_id AND owner_id = (SELECT auth.uid())));
$$;

-- === storage.objects (guarded in case migration runner lacks storage table ownership) ===
DO $$
BEGIN
    DROP POLICY IF EXISTS "payment_proofs_secure_insert" ON storage.objects;
    CREATE POLICY "payment_proofs_secure_insert"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'payment-proofs' AND (
            (storage.foldername(name))[1] IN (
                SELECT r.id::text FROM public.residents r
                WHERE r.profile_id = (SELECT auth.uid()) AND r.is_active = true
            )
            OR
            EXISTS (
                SELECT 1 FROM public.residents r
                WHERE r.profile_id = (SELECT auth.uid())
                  AND r.is_active = true
                  AND storage.objects.name LIKE (r.id::text || '%')
            )
            OR
            (SELECT public.is_owner())
        )
    );

    DROP POLICY IF EXISTS "payment_proofs_secure_select" ON storage.objects;
    CREATE POLICY "payment_proofs_secure_select"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'payment-proofs' AND (
            (storage.foldername(name))[1] IN (
                SELECT r.id::text FROM public.residents r
                WHERE r.profile_id = (SELECT auth.uid())
            )
            OR
            EXISTS (
                SELECT 1 FROM public.residents r
                WHERE r.profile_id = (SELECT auth.uid())
                  AND storage.objects.name LIKE (r.id::text || '%')
            )
            OR
            (
                (SELECT public.is_owner()) AND (
                    (storage.foldername(name))[1] IN (
                        SELECT r.id::text FROM public.residents r
                        WHERE r.property_id IN (SELECT public.get_my_property_ids())
                    )
                    OR
                    EXISTS (
                        SELECT 1 FROM public.residents r
                        WHERE r.property_id IN (SELECT public.get_my_property_ids())
                          AND storage.objects.name LIKE (r.id::text || '%')
                    )
                )
            )
        )
    );

    DROP POLICY IF EXISTS "complaint_photos_secure_select" ON storage.objects;
    CREATE POLICY "complaint_photos_secure_select"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'complaint-photos' AND (
            (storage.foldername(name))[1] IN (
                SELECT r.id::text FROM public.residents r
                WHERE r.profile_id = (SELECT auth.uid())
            )
            OR
            (storage.foldername(name))[2] IN (
                SELECT r.id::text FROM public.residents r
                WHERE r.profile_id = (SELECT auth.uid())
            )
            OR
            EXISTS (
                SELECT 1 FROM public.residents r
                WHERE r.profile_id = (SELECT auth.uid())
                  AND storage.objects.name LIKE (r.id::text || '%')
            )
            OR
            (
                (SELECT public.is_owner()) AND (
                    (storage.foldername(name))[1] IN (
                        SELECT r.id::text FROM public.residents r
                        WHERE r.property_id IN (SELECT public.get_my_property_ids())
                    )
                    OR
                    (storage.foldername(name))[2] IN (
                        SELECT r.id::text FROM public.residents r
                        WHERE r.property_id IN (SELECT public.get_my_property_ids())
                    )
                    OR
                    EXISTS (
                        SELECT 1 FROM public.residents r
                        WHERE r.property_id IN (SELECT public.get_my_property_ids())
                          AND storage.objects.name LIKE (r.id::text || '%')
                    )
                )
            )
        )
    );
EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE NOTICE 'Skipping storage.objects policy updates due to insufficient_privilege';
END $$;

COMMIT;
