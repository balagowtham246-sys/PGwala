-- ==============================================================================
-- PGwala Complaint Photos Storage Migration
-- File: supabase/complaint_photos_storage_migration.sql
-- ==============================================================================
-- 1. Creates/configures the 'complaint-photos' storage bucket as PRIVATE.
-- 2. Restricts uploads strictly to authenticated active residents.
-- 3. Restricts reads strictly to:
--    a) The filing resident
--    b) The PG owner of the property where the resident lives
-- 4. Rejects all public / anonymous access.
-- ==============================================================================

BEGIN;

-- 1. Ensure bucket exists and mark it PRIVATE
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'complaint-photos',
    'complaint-photos',
    false,
    10485760, -- 10 MB limit
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/jpg']
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];

-- 2. Drop existing policies to prevent conflicts
DROP POLICY IF EXISTS "complaint_photos_secure_insert" ON storage.objects;
DROP POLICY IF EXISTS "complaint_photos_secure_select" ON storage.objects;

-- 3. Policy: Authenticated Upload (INSERT)
-- Students can only upload files partitioned under their active resident ID:
-- Path format: <resident_id>/<filename.ext> or <property_id>/<resident_id>/<filename.ext>
CREATE POLICY "complaint_photos_secure_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'complaint-photos' AND (
        (storage.foldername(name))[1] IN (
            SELECT r.id::text FROM public.residents r
            WHERE r.profile_id = (SELECT auth.uid()) AND r.is_active = true
        )
        OR
        (storage.foldername(name))[2] IN (
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
    )
);

-- 4. Policy: Authenticated Read (SELECT / createSignedUrl)
-- Only:
--   a) The resident who uploaded the photo
--   b) The property owner whose property contains the resident
CREATE POLICY "complaint_photos_secure_select"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'complaint-photos' AND (
        -- 1. Resident access to own complaint photos
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
        -- 2. Property Owner access to resident photos for managed properties
        (
            public.is_owner() AND (
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

COMMIT;

