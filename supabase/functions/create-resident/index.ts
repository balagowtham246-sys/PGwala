import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

interface RequestBody {
  property_id: string;
  full_name: string;
  room_number: string;
  phone_number?: string;
  email: string;
  temporary_password: string;
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

    const { property_id, full_name, room_number, phone_number, email, temporary_password } = body;

    const trimmedPropertyId = property_id?.trim();
    const trimmedName = full_name?.trim();
    const trimmedRoom = room_number?.trim();
    const trimmedEmail = email?.trim().toLowerCase();
    const trimmedPassword = temporary_password?.trim();
    const trimmedPhone = phone_number?.trim() || null;

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
