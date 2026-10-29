-- ==============================================================================
-- PGwala Account-Linking Migration: Link Resident Record to Student Profile
-- File: supabase/link_resident_migration.sql
--
-- Security Design:
-- 1. In pgwala_schema.sql, GRANT UPDATE on public.residents deliberately omits
--    profile_id to prevent direct client SDK mutations or account hijacking:
--      GRANT UPDATE (full_name, phone_number, room_number, is_active) ON TABLE public.residents TO authenticated;
-- 2. This migration introduces two hardened SECURITY DEFINER RPC functions:
--    - public.link_resident_profile(p_resident_id uuid, p_student_email text)
--    - public.unlink_resident_profile(p_resident_id uuid)
-- 3. Both functions:
--    - Use SET search_path = '' and fully qualify all schemas, tables, and built-ins.
--    - Use pg_catalog.btrim() for canonical PostgreSQL whitespace trimming.
--    - Restrict execution strictly to authenticated owners (verified via auth.uid() and public.is_owner()).
--    - Assert that target resident is active and belongs to an active property owned by caller.
--    - Prevent silently overwriting resident links (idempotent if same, error if different).
--    - Validate student account existence and role in a unified join to prevent user enumeration and unassigned record errors.
--    - Enforce the global UNIQUE constraint on residents(profile_id) across active and inactive rows.
--    - Contain exception blocks to catch unique_violation cleanly without transaction aborts.
--    - Log unexpected internal errors using RAISE WARNING without exposing raw SQLERRM or emails to clients.
--    - Revoke execution from PUBLIC and grant solely to authenticated users.
--    - Are explicitly assigned to the postgres owner for secure auth.users access.
-- ==============================================================================

-- 1. Create the hardened link_resident_profile RPC function
CREATE OR REPLACE FUNCTION public.link_resident_profile(
    p_resident_id uuid,
    p_student_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner_id uuid;
    v_resident record;
    v_student_profile record;
BEGIN
    -- A. Verify caller is an authenticated owner
    v_owner_id := auth.uid();
    IF v_owner_id IS NULL OR NOT public.is_owner() THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Unauthorized: Only authenticated PG owners can link resident profiles.'
        );
    END IF;

    -- B. Verify target resident exists, is active, and belongs to an active property owned by caller
    SELECT r.id, r.property_id, r.full_name, r.profile_id, r.is_active
    INTO v_resident
    FROM public.residents r
    INNER JOIN public.properties p ON p.id = r.property_id
    WHERE r.id = p_resident_id
      AND p.owner_id = v_owner_id
      AND p.is_active = true
      AND r.is_active = true;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Active resident not found or you do not own the associated property.'
        );
    END IF;

    -- C. Look up student auth user and profile simultaneously with role verification.
    --    Uses a single joined query to prevent unassigned record access and user/role enumeration.
    --    Uses pg_catalog.btrim() for canonical, multi-version PostgreSQL string trimming.
    SELECT u.id, p.full_name
    INTO v_student_profile
    FROM auth.users u
    INNER JOIN public.profiles p ON p.id = u.id
    WHERE pg_catalog.lower(u.email) = pg_catalog.lower(pg_catalog.btrim(p_student_email))
      AND p.role = 'student';

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Unable to link: No registered student account found for this email address. Please ensure the student has created an account first.'
        );
    END IF;

    -- D. Prevent silently overwriting an existing resident link:
    --    - If resident is already linked to this exact student -> idempotent success
    --    - If resident is linked to another student -> return clear error requiring explicit unlink first
    IF v_resident.profile_id IS NOT NULL THEN
        IF v_resident.profile_id = v_student_profile.id THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', true,
                'message', 'Student ' || v_student_profile.full_name || ' is already linked to this resident record.',
                'resident_id', p_resident_id,
                'profile_id', v_student_profile.id
            );
        ELSE
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error', 'This resident record is already linked to another student account. Please unlink the current student before linking a new one.'
            );
        END IF;
    END IF;

    -- E. Check whether student is linked to ANY other resident (active or inactive, due to global UNIQUE constraint).
    --    Uses PERFORM to check existence globally without leaking another property's resident data across owners.
    PERFORM 1
    FROM public.residents r
    WHERE r.profile_id = v_student_profile.id
      AND r.id != p_resident_id;

    IF FOUND THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'This student account is already linked to another resident record. Unlink it before linking it here.'
        );
    END IF;

    -- F. Perform secure update with safe unique-constraint handling and sanitized errors
    BEGIN
        UPDATE public.residents
        SET profile_id = v_student_profile.id,
            updated_at = pg_catalog.now()
        WHERE id = p_resident_id;

        RETURN pg_catalog.jsonb_build_object(
            'success', true,
            'message', 'Successfully linked student ' || v_student_profile.full_name || ' to resident record.',
            'resident_id', p_resident_id,
            'profile_id', v_student_profile.id
        );
    EXCEPTION
        WHEN unique_violation THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error', 'Conflict: This student profile is already linked to another resident record.'
            );
        WHEN OTHERS THEN
            RAISE WARNING '[link_resident_profile] Unexpected error: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error', 'An unexpected error occurred while linking the profile. Please try again or contact support.'
            );
    END;
END;
$$;

-- 2. Create the hardened unlink_resident_profile RPC function
CREATE OR REPLACE FUNCTION public.unlink_resident_profile(
    p_resident_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner_id uuid;
    v_resident record;
BEGIN
    -- A. Verify caller is an authenticated owner
    v_owner_id := auth.uid();
    IF v_owner_id IS NULL OR NOT public.is_owner() THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Unauthorized: Only authenticated PG owners can unlink resident profiles.'
        );
    END IF;

    -- B. Verify resident exists and belongs to an active property owned by caller
    SELECT r.id, r.full_name, r.profile_id
    INTO v_resident
    FROM public.residents r
    INNER JOIN public.properties p ON p.id = r.property_id
    WHERE r.id = p_resident_id
      AND p.owner_id = v_owner_id
      AND p.is_active = true;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error', 'Resident not found or you do not own the associated property.'
        );
    END IF;

    -- C. Idempotent check: if already unlinked, return success without redundant update
    IF v_resident.profile_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', true,
            'message', 'Resident is already unlinked.',
            'resident_id', p_resident_id
        );
    END IF;

    -- D. Unlink profile_id with sanitized error handling
    BEGIN
        UPDATE public.residents
        SET profile_id = NULL,
            updated_at = pg_catalog.now()
        WHERE id = p_resident_id;

        RETURN pg_catalog.jsonb_build_object(
            'success', true,
            'message', 'Successfully unlinked student profile from resident record.',
            'resident_id', p_resident_id
        );
    EXCEPTION
        WHEN OTHERS THEN
            RAISE WARNING '[unlink_resident_profile] Unexpected error: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error', 'An unexpected error occurred while unlinking the profile. Please try again or contact support.'
            );
    END;
END;
$$;

-- 3. Scoped execution grants
REVOKE EXECUTE ON FUNCTION public.link_resident_profile(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.unlink_resident_profile(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.link_resident_profile(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unlink_resident_profile(uuid) TO authenticated;

-- 4. Explicit function ownership
ALTER FUNCTION public.link_resident_profile(uuid, text) OWNER TO postgres;
ALTER FUNCTION public.unlink_resident_profile(uuid) OWNER TO postgres;
