-- ==============================================================================
-- PGWALA UNIFIED RESIDENT ONBOARDING & ATOMIC CREATION MIGRATION
-- File: supabase/unified_resident_onboarding_migration.sql
-- ==============================================================================
-- Ensures an owner can atomically provision or link a resident profile to an 
-- authenticated student profile, enforcing multi-tenant isolation, 
-- role invariants, and unique active assignments.
-- ==============================================================================

-- 1. ADD must_change_password BOOLEAN COLUMN TO public.profiles IF NOT EXISTS
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;

-- Allow authenticated users to update their own must_change_password flag when changing password
-- (Column-level update permission update on public.profiles)
GRANT UPDATE (must_change_password) ON TABLE public.profiles TO authenticated;

-- 2. SECURITY DEFINER RPC: create_or_link_resident_with_auth
-- Called by the Edge Function or backend with service role / authenticated owner.
-- Atomically creates/updates the profile (if not present) and creates the resident record.
CREATE OR REPLACE FUNCTION public.create_or_link_resident_with_auth(
    p_property_id UUID,
    p_auth_user_id UUID,
    p_full_name TEXT,
    p_room_number TEXT,
    p_phone_number TEXT DEFAULT NULL,
    p_must_change_password BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_trimmed_name TEXT;
    v_trimmed_room TEXT;
    v_trimmed_phone TEXT;
    v_resident_id UUID;
    v_existing_resident RECORD;
BEGIN
    v_caller_id := (SELECT auth.uid());
    
    -- Canonical whitespace trimming
    v_trimmed_name := pg_catalog.btrim(p_full_name);
    v_trimmed_room := pg_catalog.btrim(p_room_number);
    v_trimmed_phone := NULLIF(pg_catalog.btrim(p_phone_number), '');

    -- Input validations
    IF v_trimmed_name IS NULL OR v_trimmed_name = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Resident full name cannot be empty.');
    END IF;

    IF v_trimmed_room IS NULL OR v_trimmed_room = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Room number cannot be empty.');
    END IF;

    IF p_property_id IS NULL OR p_auth_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Property ID and Auth User ID are required.');
    END IF;

    -- Authorization check:
    -- If caller is authenticated (not service_role/internal without auth context),
    -- assert caller is an owner who actually owns this active property.
    IF v_caller_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.properties
            WHERE id = p_property_id AND owner_id = v_caller_id AND is_active = true
        ) THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Unauthorized: You do not own this PG property or the property is inactive.'
            );
        END IF;
    END IF;

    -- Verify that the target auth user exists in auth.users
    IF NOT EXISTS (
        SELECT 1 FROM auth.users WHERE id = p_auth_user_id
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Associated authentication user account does not exist.'
        );
    END IF;

    -- Prevent converting an existing owner profile into a student resident
    IF EXISTS (
        SELECT 1 FROM public.profiles WHERE id = p_auth_user_id AND role = 'owner'
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Cannot register a PG owner account as a resident.'
        );
    END IF;

    -- Upsert/ensure public.profiles record exists for the student
    INSERT INTO public.profiles (id, full_name, phone_number, role, must_change_password, created_at, updated_at)
    VALUES (
        p_auth_user_id,
        v_trimmed_name,
        v_trimmed_phone,
        'student',
        p_must_change_password,
        now(),
        now()
    )
    ON CONFLICT (id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        phone_number = COALESCE(EXCLUDED.phone_number, public.profiles.phone_number),
        updated_at = now();

    -- Check if this student profile is already linked to a resident record
    SELECT id, property_id, full_name, room_number, is_active
    INTO v_existing_resident
    FROM public.residents
    WHERE profile_id = p_auth_user_id
    LIMIT 1;

    IF v_existing_resident.id IS NOT NULL THEN
        IF v_existing_resident.property_id = p_property_id THEN
            -- Already linked to this property -> update room/name if needed and return success (idempotent)
            UPDATE public.residents
            SET
                full_name = v_trimmed_name,
                room_number = v_trimmed_room,
                phone_number = COALESCE(v_trimmed_phone, public.residents.phone_number),
                is_active = true,
                updated_at = now()
            WHERE id = v_existing_resident.id;

            RETURN jsonb_build_object(
                'success', true,
                'message', 'Resident profile updated and linked successfully.',
                'resident_id', v_existing_resident.id,
                'profile_id', p_auth_user_id,
                'is_existing', true
            );
        ELSE
            -- Student is linked to a resident record in another PG property!
            RETURN jsonb_build_object(
                'success', false,
                'error', 'This user is already registered as an active resident in another PG property.'
            );
        END IF;
    END IF;

    -- Insert new resident record linked to profile_id
    INSERT INTO public.residents (
        property_id,
        profile_id,
        full_name,
        phone_number,
        room_number,
        is_active,
        created_at,
        updated_at
    )
    VALUES (
        p_property_id,
        p_auth_user_id,
        v_trimmed_name,
        v_trimmed_phone,
        v_trimmed_room,
        true,
        now(),
        now()
    )
    RETURNING id INTO v_resident_id;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Resident profile and authentication record linked successfully.',
        'resident_id', v_resident_id,
        'profile_id', p_auth_user_id,
        'is_existing', false
    );
END;
$$;

-- 3. ROUTINE EXECUTION GRANTS
REVOKE EXECUTE ON FUNCTION public.create_or_link_resident_with_auth(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_or_link_resident_with_auth(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_or_link_resident_with_auth(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;

ALTER FUNCTION public.create_or_link_resident_with_auth(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN) OWNER TO postgres;

