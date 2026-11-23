import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_PENDING_PER_PROPERTY = 50;
const INVITE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function jsonResponse(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function normalizeInviteCode(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').trim();
}

function normalizePhoneLast10(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

function isGenderCompatible(
  propertyGender: string | null | undefined,
  residentGender: string | null | undefined
): boolean {
  if (!propertyGender || propertyGender === 'coed') return true;
  if (!residentGender) return false;
  if (propertyGender === 'girls') return residentGender === 'female';
  if (propertyGender === 'boys') return residentGender === 'male';
  return true;
}

function generateCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += INVITE_CHARS[bytes[i] % INVITE_CHARS.length];
  }
  return out;
}

async function verifyOwnerCaller(
  req: Request,
  adminClient: ReturnType<typeof createClient>,
  propertyId: string
): Promise<{ userId: string } | Response> {
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    return jsonResponse(401, {
      success: false,
      code: 'AUTH_MISSING',
      error: 'Authentication required.',
    });
  }
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  const { data: userData, error: userErr } = await adminClient.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return jsonResponse(401, {
      success: false,
      code: 'AUTH_INVALID',
      error: 'Invalid or expired session. Please sign in again.',
    });
  }

  const userId = userData.user.id;
  const { data: callerProfile } = await adminClient
    .from('profiles')
    .select('id, role')
    .eq('id', userId)
    .maybeSingle();

  if (!callerProfile || callerProfile.role !== 'owner') {
    return jsonResponse(403, {
      success: false,
      code: 'FORBIDDEN',
      error: 'Only PG owners can perform this action.',
    });
  }

  const { data: prop } = await adminClient
    .from('properties')
    .select('id, owner_id, is_active')
    .eq('id', propertyId)
    .eq('owner_id', userId)
    .eq('is_active', true)
    .maybeSingle();

  if (!prop) {
    return jsonResponse(403, {
      success: false,
      code: 'FORBIDDEN',
      error: 'You do not own this active PG property.',
    });
  }

  return { userId };
}

serve(async (req) => {
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
        error: 'Server configuration error.',
      });
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.action !== 'string') {
      return jsonResponse(400, {
        success: false,
        code: 'INVALID_BODY',
        error: 'Missing action field.',
      });
    }

    const action = body.action;

    // -------------------------------------------------------------------------
    // ACTION 1 (Public): lookup PG by invite code
    // -------------------------------------------------------------------------
    if (action === 'lookup') {
      const code = normalizeInviteCode(body.invite_code);
      if (code.length !== 6) {
        return jsonResponse(400, {
          success: false,
          code: 'INVALID_CODE_FORMAT',
          error: 'Please enter a valid 6-character PG invite code.',
        });
      }

      const { data: prop, error: propErr } = await adminClient
        .from('properties')
        .select('id, name, address, gender_type, invite_enabled, is_active')
        .ilike('invite_code', code)
        .eq('is_active', true)
        .maybeSingle();

      if (propErr || !prop) {
        return jsonResponse(404, {
          success: false,
          code: 'CODE_NOT_FOUND',
          error: 'No active PG found for this invite code. Double-check with your PG owner.',
        });
      }

      if (prop.invite_enabled === false) {
        return jsonResponse(403, {
          success: false,
          code: 'INVITES_PAUSED',
          error: 'Joining is currently paused for this PG. Ask your PG owner to enable it.',
        });
      }

      return jsonResponse(200, {
        success: true,
        property: {
          id: prop.id,
          name: prop.name,
          address: prop.address,
          gender_type: prop.gender_type ?? 'coed',
        },
      });
    }

    // -------------------------------------------------------------------------
    // ACTION 2 (Public): submit self-onboarding join request
    // -------------------------------------------------------------------------
    if (action === 'submit') {
      const code = normalizeInviteCode(body.invite_code);
      const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : '';
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const phoneNumber = typeof body.phone_number === 'string' ? body.phone_number.trim() : '';
      const gender =
        body.gender === 'male' || body.gender === 'female' || body.gender === 'other'
          ? body.gender
          : null;
      const emergencyContact =
        typeof body.emergency_contact === 'string' && body.emergency_contact.trim()
          ? body.emergency_contact.trim()
          : null;
      const roomHint =
        typeof body.room_hint === 'string' && body.room_hint.trim()
          ? body.room_hint.trim().slice(0, 30)
          : null;

      if (code.length !== 6) {
        return jsonResponse(400, {
          success: false,
          code: 'INVALID_CODE_FORMAT',
          error: 'Please enter a valid 6-character PG invite code.',
        });
      }
      if (!fullName || fullName.length < 2) {
        return jsonResponse(400, {
          success: false,
          code: 'VALIDATION_ERROR',
          error: 'Please enter your full name.',
        });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return jsonResponse(400, {
          success: false,
          code: 'VALIDATION_ERROR',
          error: 'Please enter a valid email address.',
        });
      }
      if (password.length < 6) {
        return jsonResponse(400, {
          success: false,
          code: 'VALIDATION_ERROR',
          error: 'Password must be at least 6 characters long.',
        });
      }
      const normPhone = normalizePhoneLast10(phoneNumber);
      if (!normPhone) {
        return jsonResponse(400, {
          success: false,
          code: 'VALIDATION_ERROR',
          error: 'Please enter a valid 10-digit mobile number.',
        });
      }

      const { data: prop } = await adminClient
        .from('properties')
        .select('id, name, gender_type, invite_enabled, is_active')
        .ilike('invite_code', code)
        .eq('is_active', true)
        .maybeSingle();

      if (!prop) {
        return jsonResponse(404, {
          success: false,
          code: 'CODE_NOT_FOUND',
          error: 'Invalid PG invite code.',
        });
      }
      if (prop.invite_enabled === false) {
        return jsonResponse(403, {
          success: false,
          code: 'INVITES_PAUSED',
          error: 'Joining is currently paused for this PG. Ask your PG owner.',
        });
      }
      if (!isGenderCompatible(prop.gender_type, gender)) {
        const policy = prop.gender_type === 'girls' ? 'Girls-only' : 'Boys-only';
        return jsonResponse(400, {
          success: false,
          code: 'GENDER_MISMATCH',
          error: `${prop.name} is a ${policy} PG.`,
        });
      }

      // Guard against spam floods
      const { count: pendingCount } = await adminClient
        .from('resident_join_requests')
        .select('id', { count: 'exact', head: true })
        .eq('property_id', prop.id)
        .eq('status', 'pending');

      if ((pendingCount ?? 0) >= MAX_PENDING_PER_PROPERTY) {
        return jsonResponse(429, {
          success: false,
          code: 'QUEUE_FULL',
          error: 'This PG has too many pending requests. Please ask the PG owner to review them.',
        });
      }

      // Create auth account (resident sets their own password; must_change_password = false)
      const { data: createdUser, error: createAuthErr } =
        await adminClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            full_name: fullName,
            role: 'student',
            must_change_password: false,
          },
        });

      if (createAuthErr || !createdUser?.user) {
        const msg = createAuthErr?.message || '';
        const isDup =
          msg.toLowerCase().includes('already') ||
          msg.toLowerCase().includes('exists') ||
          msg.toLowerCase().includes('registered') ||
          (createAuthErr as { status?: number } | null)?.status === 422;

        if (isDup) {
          return jsonResponse(409, {
            success: false,
            code: 'DUPLICATE_EMAIL',
            error: 'An account with this email already exists. Try signing in instead.',
          });
        }
        return jsonResponse(400, {
          success: false,
          code: 'AUTH_CREATE_FAILED',
          error: msg || 'Could not create your account.',
        });
      }

      const newUserId = createdUser.user.id;

      // Ensure profiles row exists with role='student' and phone/name
      const { error: profErr } = await adminClient.from('profiles').upsert(
        {
          id: newUserId,
          full_name: fullName,
          phone_number: normPhone,
          role: 'student',
          must_change_password: false,
        },
        { onConflict: 'id' }
      );

      if (profErr) {
        await adminClient.auth.admin.deleteUser(newUserId).catch(() => {});
        return jsonResponse(500, {
          success: false,
          code: 'PROFILE_CREATE_FAILED',
          error: 'Could not initialize your profile. Please try again.',
        });
      }

      // Insert pending join request
      const { data: joinReq, error: reqErr } = await adminClient
        .from('resident_join_requests')
        .insert({
          property_id: prop.id,
          profile_id: newUserId,
          full_name: fullName,
          email,
          phone_number: normPhone,
          gender,
          emergency_contact: emergencyContact,
          room_hint: roomHint,
          status: 'pending',
        })
        .select('id, property_id, status')
        .single();

      if (reqErr || !joinReq) {
        await adminClient.auth.admin.deleteUser(newUserId).catch(() => {});
        return jsonResponse(500, {
          success: false,
          code: 'REQUEST_CREATE_FAILED',
          error: 'Could not submit your join request. Please try again.',
        });
      }

      return jsonResponse(200, {
        success: true,
        request_id: joinReq.id,
        property_name: prop.name,
      });
    }

    // -------------------------------------------------------------------------
    // ACTION 3 (Owner): approve pending join request & create active resident
    // -------------------------------------------------------------------------
    if (action === 'approve') {
      const requestId = typeof body.request_id === 'string' ? body.request_id.trim() : '';
      const roomNumber = typeof body.room_number === 'string' ? body.room_number.trim() : '';
      const bedLabel =
        typeof body.bed_label === 'string' && body.bed_label.trim()
          ? body.bed_label.trim()
          : null;
      const monthlyRentPaise =
        typeof body.monthly_rent_paise === 'number' && Number.isFinite(body.monthly_rent_paise)
          ? Math.max(0, Math.round(body.monthly_rent_paise))
          : 0;
      const depositPaise =
        typeof body.deposit_paise === 'number' && Number.isFinite(body.deposit_paise)
          ? Math.max(0, Math.round(body.deposit_paise))
          : 0;

      if (!requestId || !roomNumber) {
        return jsonResponse(400, {
          success: false,
          code: 'VALIDATION_ERROR',
          error: 'Request ID and Room Number are required.',
        });
      }

      const { data: joinReq, error: fetchErr } = await adminClient
        .from('resident_join_requests')
        .select('*')
        .eq('id', requestId)
        .maybeSingle();

      if (fetchErr || !joinReq) {
        return jsonResponse(404, {
          success: false,
          code: 'REQUEST_NOT_FOUND',
          error: 'Join request not found.',
        });
      }

      const authCheck = await verifyOwnerCaller(req, adminClient, joinReq.property_id);
      if (authCheck instanceof Response) return authCheck;

      if (joinReq.status !== 'pending') {
        return jsonResponse(409, {
          success: false,
          code: 'ALREADY_REVIEWED',
          error: `This request was already ${joinReq.status}.`,
        });
      }

      // Check bed conflict if bedLabel was supplied
      if (bedLabel) {
        const { data: takenBed } = await adminClient
          .from('residents')
          .select('id, full_name')
          .eq('property_id', joinReq.property_id)
          .eq('room_number', roomNumber)
          .eq('bed_label', bedLabel)
          .eq('is_active', true)
          .maybeSingle();

        if (takenBed) {
          return jsonResponse(409, {
            success: false,
            code: 'BED_TAKEN',
            error: `${bedLabel} in Room ${roomNumber} is already occupied by ${takenBed.full_name}. Pick another bed.`,
          });
        }
      }

      // Link resident atomically using existing RPC
      const { data: rpcRes, error: rpcErr } = await adminClient.rpc(
        'create_or_link_resident_with_auth',
        {
          p_property_id: joinReq.property_id,
          p_auth_user_id: joinReq.profile_id,
          p_full_name: joinReq.full_name,
          p_room_number: roomNumber,
          p_phone_number: joinReq.phone_number,
          p_must_change_password: false,
        }
      );

      if (rpcErr || !rpcRes?.success || !rpcRes?.resident_id) {
        return jsonResponse(400, {
          success: false,
          code: 'APPROVE_FAILED',
          error: rpcRes?.error || rpcErr?.message || 'Could not approve resident.',
        });
      }

      // Persist rich resident fields
      const patch: Record<string, unknown> = {
        monthly_rent_paise: monthlyRentPaise,
        deposit_paise: depositPaise,
        joining_date: new Date().toISOString().slice(0, 10),
      };
      if (bedLabel) patch.bed_label = bedLabel;
      if (joinReq.gender) patch.gender = joinReq.gender;
      if (joinReq.emergency_contact) patch.emergency_contact = joinReq.emergency_contact;

      await adminClient.from('residents').update(patch).eq('id', rpcRes.resident_id);

      await adminClient
        .from('resident_join_requests')
        .update({
          status: 'approved',
          reviewed_by: authCheck.userId,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', requestId);

      return jsonResponse(200, {
        success: true,
        resident_id: rpcRes.resident_id,
      });
    }

    // -------------------------------------------------------------------------
    // ACTION 4 (Owner): reject pending join request
    // -------------------------------------------------------------------------
    if (action === 'reject') {
      const requestId = typeof body.request_id === 'string' ? body.request_id.trim() : '';
      const reason =
        typeof body.rejection_reason === 'string' && body.rejection_reason.trim()
          ? body.rejection_reason.trim().slice(0, 200)
          : 'Declined by PG owner';

      if (!requestId) {
        return jsonResponse(400, {
          success: false,
          code: 'VALIDATION_ERROR',
          error: 'Request ID is required.',
        });
      }

      const { data: joinReq } = await adminClient
        .from('resident_join_requests')
        .select('*')
        .eq('id', requestId)
        .maybeSingle();

      if (!joinReq) {
        return jsonResponse(404, {
          success: false,
          code: 'REQUEST_NOT_FOUND',
          error: 'Join request not found.',
        });
      }

      const authCheck = await verifyOwnerCaller(req, adminClient, joinReq.property_id);
      if (authCheck instanceof Response) return authCheck;

      await adminClient
        .from('resident_join_requests')
        .update({
          status: 'rejected',
          rejection_reason: reason,
          reviewed_by: authCheck.userId,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', requestId);

      return jsonResponse(200, { success: true });
    }

    // -------------------------------------------------------------------------
    // ACTION 5 (Owner): regenerate PG invite code
    // -------------------------------------------------------------------------
    if (action === 'regenerate_code') {
      const propertyId = typeof body.property_id === 'string' ? body.property_id.trim() : '';
      if (!propertyId) {
        return jsonResponse(400, {
          success: false,
          code: 'VALIDATION_ERROR',
          error: 'Property ID is required.',
        });
      }

      const authCheck = await verifyOwnerCaller(req, adminClient, propertyId);
      if (authCheck instanceof Response) return authCheck;

      let nextCode = generateCode();
      for (let attempt = 0; attempt < 20; attempt++) {
        const { data: clash } = await adminClient
          .from('properties')
          .select('id')
          .ilike('invite_code', nextCode)
          .maybeSingle();
        if (!clash) break;
        nextCode = generateCode();
      }

      const { error: updErr } = await adminClient
        .from('properties')
        .update({ invite_code: nextCode })
        .eq('id', propertyId);

      if (updErr) {
        return jsonResponse(500, {
          success: false,
          code: 'UPDATE_FAILED',
          error: 'Could not regenerate invite code.',
        });
      }

      return jsonResponse(200, { success: true, invite_code: nextCode });
    }

    // -------------------------------------------------------------------------
    // ACTION 6 (Owner): pause or resume invite joining
    // -------------------------------------------------------------------------
    if (action === 'toggle_invite') {
      const propertyId = typeof body.property_id === 'string' ? body.property_id.trim() : '';
      const enabled = Boolean(body.invite_enabled);
      if (!propertyId) {
        return jsonResponse(400, {
          success: false,
          code: 'VALIDATION_ERROR',
          error: 'Property ID is required.',
        });
      }

      const authCheck = await verifyOwnerCaller(req, adminClient, propertyId);
      if (authCheck instanceof Response) return authCheck;

      const { error: updErr } = await adminClient
        .from('properties')
        .update({ invite_enabled: enabled })
        .eq('id', propertyId);

      if (updErr) {
        return jsonResponse(500, {
          success: false,
          code: 'UPDATE_FAILED',
          error: 'Could not update invite status.',
        });
      }

      return jsonResponse(200, { success: true, invite_enabled: enabled });
    }

    return jsonResponse(400, {
      success: false,
      code: 'UNKNOWN_ACTION',
      error: `Unsupported action "${action}".`,
    });
  } catch (err) {
    console.error('[resident-join-request] Unexpected error:', err);
    return jsonResponse(500, {
      success: false,
      code: 'INTERNAL_ERROR',
      error: 'An unexpected error occurred. Please try again.',
    });
  }
});
