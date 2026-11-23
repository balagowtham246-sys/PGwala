import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

interface RequestBody {
  property_id: string;
  full_name: string;
  room_number: string;
  phone_number?: string;
  email: string;
  temporary_password: string;
  bed_label?: string | null;
  gender?: 'male' | 'female' | 'other' | null;
  joining_date?: string | null;
  monthly_rent_paise?: number | null;
  deposit_paise?: number | null;
  emergency_contact?: string | null;
}

function normalizePhoneLast10(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, {
      success: false,
      code: 'METHOD_NOT_ALLOWED',
      error: 'Only POST requests are supported.',
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseServiceKey) {
      return jsonResponse(500, {
        success: false,
        code: 'CONFIG_ERROR',
        error: 'Server configuration error: missing Supabase service credentials.',
      });
    }

    // 1. Extract and validate Bearer JWT from Authorization header
    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return jsonResponse(401, {
        success: false,
        code: 'AUTH_MISSING',
        error: 'Authentication required: missing or malformed Authorization Bearer header.',
      });
    }

    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!jwt) {
      return jsonResponse(401, {
        success: false,
        code: 'AUTH_MISSING',
        error: 'Authentication required: empty access token.',
      });
    }

    // Initialize privileged admin client with service_role key (never exposed to clients)
    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Validate caller identity server-side by passing the raw JWT directly to getUser(jwt)
    const {
      data: { user: callerUser },
      error: userAuthError,
    } = await adminClient.auth.getUser(jwt);

    if (userAuthError || !callerUser) {
      return jsonResponse(401, {
        success: false,
        code: 'AUTH_INVALID',
        error: 'Your login session is invalid or has expired. Please sign in again.',
      });
    }

    // 2. Parse and validate request payload
    let body: RequestBody;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, {
        success: false,
        code: 'VALIDATION_ERROR',
        error: 'Invalid JSON request body.',
      });
    }

    const {
      property_id,
      full_name,
      room_number,
      phone_number,
      email,
      temporary_password,
      bed_label,
      gender,
      joining_date,
      monthly_rent_paise,
      deposit_paise,
      emergency_contact,
    } = body;

    const trimmedPropertyId = property_id?.trim();
    const trimmedName = full_name?.trim();
    const trimmedRoom = room_number?.trim();
    const trimmedEmail = email?.trim().toLowerCase();
    const trimmedPassword = temporary_password?.trim();
    const trimmedPhone = phone_number?.trim() || null;
    const normalizedPhone10 = normalizePhoneLast10(trimmedPhone);
    const trimmedBedLabel = typeof bed_label === 'string' && bed_label.trim() ? bed_label.trim() : null;
    const validGender =
      gender === 'male' || gender === 'female' || gender === 'other' ? gender : null;
    const validJoiningDate =
      typeof joining_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(joining_date.trim())
        ? joining_date.trim()
        : null;
    const validMonthlyRentPaise =
      typeof monthly_rent_paise === 'number' && Number.isFinite(monthly_rent_paise) && monthly_rent_paise >= 0
        ? Math.round(monthly_rent_paise)
        : null;
    const validDepositPaise =
      typeof deposit_paise === 'number' && Number.isFinite(deposit_paise) && deposit_paise >= 0
        ? Math.round(deposit_paise)
        : null;
    const trimmedEmergencyContact =
      typeof emergency_contact === 'string' && emergency_contact.trim()
        ? emergency_contact.trim().slice(0, 120)
        : null;

    if (!trimmedPropertyId || !trimmedName || !trimmedRoom || !trimmedEmail || !trimmedPassword) {
      return jsonResponse(400, {
        success: false,
        code: 'VALIDATION_ERROR',
        error: 'Missing required fields: Property, Full Name, Room Number, Login Email, and Temporary Password are all required.',
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      return jsonResponse(400, {
        success: false,
        code: 'VALIDATION_ERROR',
        error: 'Please provide a valid login email address.',
      });
    }

    if (trimmedPassword.length < 6) {
      return jsonResponse(400, {
        success: false,
        code: 'VALIDATION_ERROR',
        error: 'Temporary password must be at least 6 characters long.',
      });
    }

    if (trimmedPhone && trimmedPhone.length < 10) {
      return jsonResponse(400, {
        success: false,
        code: 'VALIDATION_ERROR',
        error: 'Phone number must be at least 10 digits when provided.',
      });
    }

    // 3. Server-side authorization check:
    // Verify caller has role === 'owner' in public.profiles AND owns the active target property
    const { data: callerProfile, error: profileError } = await adminClient
      .from('profiles')
      .select('id, role')
      .eq('id', callerUser.id)
      .maybeSingle();

    if (profileError || !callerProfile || callerProfile.role !== 'owner') {
      return jsonResponse(403, {
        success: false,
        code: 'FORBIDDEN',
        error: 'Access denied: only authorized PG owners can create resident accounts.',
      });
    }

    const { data: propData, error: propError } = await adminClient
      .from('properties')
      .select('id, name, owner_id, is_active')
      .eq('id', trimmedPropertyId)
      .eq('owner_id', callerUser.id)
      .eq('is_active', true)
      .maybeSingle();

    if (propError || !propData) {
      return jsonResponse(403, {
        success: false,
        code: 'FORBIDDEN',
        error: 'Access denied: you do not own this PG property or the property is inactive.',
      });
    }

    // 4. Check for duplicate active resident profile in the same property and room
    const { data: duplicateResident } = await adminClient
      .from('residents')
      .select('id, full_name, room_number, profile_id')
      .eq('property_id', trimmedPropertyId)
      .eq('room_number', trimmedRoom)
      .ilike('full_name', trimmedName)
      .eq('is_active', true)
      .maybeSingle();

    if (duplicateResident && duplicateResident.profile_id) {
      return jsonResponse(409, {
        success: false,
        code: 'DUPLICATE_RESIDENT',
        error: `Resident "${trimmedName}" in Room ${trimmedRoom} already has an active linked login account.`,
      });
    }

    // 4b. Block duplicate active phone number within the same property
    if (normalizedPhone10) {
      const { data: activePhones } = await adminClient
        .from('residents')
        .select('id, full_name, room_number, phone_number')
        .eq('property_id', trimmedPropertyId)
        .eq('is_active', true)
        .not('phone_number', 'is', null);

      const phoneConflict = (activePhones ?? []).find(
        (r: { phone_number?: string | null }) =>
          normalizePhoneLast10(r.phone_number) === normalizedPhone10
      ) as { full_name?: string; room_number?: string } | undefined;

      if (phoneConflict) {
        return jsonResponse(409, {
          success: false,
          code: 'DUPLICATE_PHONE',
          error: `Phone number ${trimmedPhone} is already assigned to active resident "${phoneConflict.full_name || 'another resident'}" in Room ${phoneConflict.room_number || '?'}.`,
        });
      }
    }

    // 5. Create new Supabase Auth account (never overwrite or delete an existing Auth user on conflict)
    const { data: createdUser, error: createAuthError } = await adminClient.auth.admin.createUser({
      email: trimmedEmail,
      password: trimmedPassword,
      email_confirm: true,
      user_metadata: {
        full_name: trimmedName,
        role: 'student',
        must_change_password: true,
      },
    });

    if (createAuthError || !createdUser?.user) {
      const errMsg = createAuthError?.message || '';
      const isDuplicateEmail =
        errMsg.toLowerCase().includes('already') ||
        errMsg.toLowerCase().includes('exists') ||
        errMsg.toLowerCase().includes('registered') ||
        (createAuthError as any)?.status === 422;

      if (isDuplicateEmail) {
        return jsonResponse(409, {
          success: false,
          code: 'DUPLICATE_EMAIL',
          error: `An account with email "${trimmedEmail}" already exists. Please use a different email address.`,
        });
      }

      return jsonResponse(400, {
        success: false,
        code: 'AUTH_CREATE_FAILED',
        error: `Could not create authentication account: ${errMsg || 'Unknown error'}`,
      });
    }

    const newAuthUserId = createdUser.user.id;

    // 6. Atomically create or link resident profile via SECURITY DEFINER RPC
    const { data: rpcResult, error: rpcError } = await adminClient.rpc(
      'create_or_link_resident_with_auth',
      {
        p_property_id: trimmedPropertyId,
        p_auth_user_id: newAuthUserId,
        p_full_name: trimmedName,
        p_room_number: trimmedRoom,
        p_phone_number: trimmedPhone,
        p_must_change_password: true,
      }
    );

    if (rpcError || !rpcResult?.success) {
      // Partial failure rollback: delete ONLY the newly created Auth user so retry is clean
      try {
        await adminClient.auth.admin.deleteUser(newAuthUserId);
      } catch (rollbackErr) {
        console.error('[create-resident] Failed to roll back newly created auth user:', rollbackErr);
      }

      return jsonResponse(400, {
        success: false,
        code: 'DB_LINK_FAILED',
        error: rpcResult?.error || rpcError?.message || 'Failed to save resident profile in database.',
      });
    }

    // 6b. Persist optional rich onboarding fields (bed, gender, joining date, rent, deposit, emergency contact)
    const richPatch: Record<string, unknown> = {};
    if (trimmedBedLabel !== null) richPatch.bed_label = trimmedBedLabel;
    if (validGender !== null) richPatch.gender = validGender;
    if (validJoiningDate !== null) richPatch.joining_date = validJoiningDate;
    if (validMonthlyRentPaise !== null) richPatch.monthly_rent_paise = validMonthlyRentPaise;
    if (validDepositPaise !== null) richPatch.deposit_paise = validDepositPaise;
    if (trimmedEmergencyContact !== null) richPatch.emergency_contact = trimmedEmergencyContact;

    if (rpcResult.resident_id && Object.keys(richPatch).length > 0) {
      const { error: richUpdateError } = await adminClient
        .from('residents')
        .update(richPatch)
        .eq('id', rpcResult.resident_id);
      if (richUpdateError) {
        console.warn(
          '[create-resident] Optional rich fields update warning:',
          richUpdateError.message
        );
      }
    }

    // 7. Return success without exposing passwords or sensitive tokens
    return jsonResponse(200, {
      success: true,
      code: 'CREATED',
      message: `Resident account and login created for ${trimmedEmail}.`,
      resident_id: rpcResult.resident_id,
      profile_id: newAuthUserId,
      email: trimmedEmail,
      full_name: trimmedName,
      room_number: trimmedRoom,
      is_existing: Boolean(rpcResult.is_existing),
    });
  } catch (err: unknown) {
    console.error('[create-resident] Unexpected server error:', err instanceof Error ? err.message : String(err));
    return jsonResponse(500, {
      success: false,
      code: 'INTERNAL_ERROR',
      error: 'An unexpected server error occurred while creating the resident account.',
    });
  }
});
