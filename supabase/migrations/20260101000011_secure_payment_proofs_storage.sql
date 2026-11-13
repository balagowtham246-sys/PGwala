-- ==============================================================================
-- PGwala Payment Proofs Storage Security Hardening Migration
-- File: supabase/secure_payment_proofs_storage.sql
-- ==============================================================================
-- 1. Sets the 'payment-proofs' storage bucket to private (public = false).
-- 2. Removes permissive public SELECT policies.
-- 3. Implements strict Row-Level Security (RLS) on storage.objects:
--    a) INSERT: Only authenticated students uploading to their own resident directory,
--       or authenticated owners.
--    b) SELECT: Only the resident who owns the proof or the property owner who manages
--       the property.
--    c) UPDATE/DELETE: Denied to general users; managed via administrative functions.
-- ==============================================================================

BEGIN;

-- 1. Ensure bucket exists and mark it PRIVATE
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'payment-proofs',
    'payment-proofs',
    false,
    10485760, -- 10 MB limit
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/jpg']
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];

-- 2. Drop all legacy / overly-permissive storage policies for payment-proofs
DROP POLICY IF EXISTS "payment_proofs_public_select" ON storage.objects;
DROP POLICY IF EXISTS "payment_proofs_authenticated_insert" ON storage.objects;
DROP POLICY IF EXISTS "payment_proofs_authenticated_select" ON storage.objects;
DROP POLICY IF EXISTS "payment_proofs_owner_select" ON storage.objects;
DROP POLICY IF EXISTS "payment_proofs_student_select" ON storage.objects;
DROP POLICY IF EXISTS "payment_proofs_student_insert" ON storage.objects;
DROP POLICY IF EXISTS "payment_proofs_secure_insert" ON storage.objects;
DROP POLICY IF EXISTS "payment_proofs_secure_select" ON storage.objects;

-- 3. Policy: Authenticated Upload (INSERT)
-- Students can only upload files partitioned under their active resident ID or prefixed with it.
-- Owners can also upload if necessary.
CREATE POLICY "payment_proofs_secure_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'payment-proofs' AND (
        -- Subfolder format: resident_id/filename.ext
        (storage.foldername(name))[1] IN (
            SELECT r.id::text FROM public.residents r
            WHERE r.profile_id = (SELECT auth.uid()) AND r.is_active = true
        )
        OR
        -- Legacy flat prefix format: resident_id_timestamp.ext
        EXISTS (
            SELECT 1 FROM public.residents r
            WHERE r.profile_id = (SELECT auth.uid()) 
              AND r.is_active = true
              AND storage.objects.name LIKE (r.id::text || '%')
        )
        OR
        public.is_owner()
    )
);

-- 4. Policy: Authenticated Read (SELECT / createSignedUrl)
-- Only:
--   a) The student whose resident_id matches the path/prefix
--   b) The property owner whose properties contain the resident_id
CREATE POLICY "payment_proofs_secure_select"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'payment-proofs' AND (
        -- 1. Student access to own resident proofs
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
        -- 2. Owner access to resident proofs for owned properties
        (
            public.is_owner() AND (
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

COMMIT;
