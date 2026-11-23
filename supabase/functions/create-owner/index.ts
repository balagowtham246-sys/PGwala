import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const DEFAULT_ADMIN_EMAILS = ['balagowtham246@gmail.com', 'admin.pgwala@gmail.com'];

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

function getAllowedAdminEmails(): Set<string> {
  const fromEnv = (Deno.env.get('ADMIN_EMAILS') ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...DEFAULT_ADMIN_EMAILS, ...fromEnv]);
}

function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

interface CreateOwnerPayload {
  owner_name: string;
  owner_phone?: string;
  owner_email: string;
  temporary_password: string;
  pg_name: string;
  pg_address?: string | null;
  pg_gender_type?: 'coed' | 'boys' | 'girls';
  total_beds?: number | null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { success: false, error: 'Only POST requests are supported.' });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !supabaseServiceKey) {
      return jsonResponse(500, { success: false, error: 'Missing Supabase service credentials.' });
    }

    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return jsonResponse(401, { success: false, error: 'Authentication required.' });
    }
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();

    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const {
      data: { user: callerUser },
      error: authErr,
    } = await adminClient.auth.getUser(jwt);

    if (authErr || !callerUser?.email) {
      return jsonResponse(401, { success: false, error: 'Invalid or expired session.' });
    }

    const allowedAdmins = getAllowedAdminEmails();
    if (!allowedAdmins.has(callerUser.email.trim().toLowerCase())) {
      return jsonResponse(403, {
        success: false,
        error: 'Forbidden: only PGwala administrators can create new PG owners.',
      });
    }

    let body: CreateOwnerPayload;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { success: false, error: 'Invalid JSON request body.' });
    }

    const ownerName = (body.owner_name ?? '').trim();
    const ownerEmail = (body.owner_email ?? '').trim().toLowerCase();
    const password = (body.temporary_password ?? '').trim();
    const pgName = (body.pg_name ?? '').trim();
    const ownerPhone = normalizePhone(body.owner_phone);
    const pgAddress = (body.pg_address ?? '').trim() || null;
    const pgGenderType =
      body.pg_gender_type === 'boys' || body.pg_gender_type === 'girls'
        ? body.pg_gender_type
        : 'coed';
    const totalBeds =
      typeof body.total_beds === 'number' && Number.isFinite(body.total_beds) && body.total_beds > 0
        ? Math.min(500, Math.round(body.total_beds))
        : 20;

    if (ownerName.length < 2) {
      return jsonResponse(400, { success: false, error: 'Owner full name is required.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
      return jsonResponse(400, { success: false, error: 'A valid owner email address is required.' });
    }
    if (password.length < 6) {
      return jsonResponse(400, {
        success: false,
        error: 'Temporary password must be at least 6 characters.',
      });
    }
    if (pgName.length < 2) {
      return jsonResponse(400, { success: false, error: 'PG / Hostel name is required.' });
    }

    // 1. Create Supabase Auth user with email confirmed immediately
    const { data: createdAuth, error: createAuthErr } = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: ownerName,
        role: 'owner',
      },
    });

    if (createAuthErr || !createdAuth?.user) {
      return jsonResponse(400, {
        success: false,
        error: createAuthErr?.message || 'Could not create owner login account.',
      });
    }

    const ownerId = createdAuth.user.id;

    // 2. Upsert owner profile
    const { error: profileErr } = await adminClient.from('profiles').upsert(
      {
        id: ownerId,
        full_name: ownerName,
        phone_number: ownerPhone,
        role: 'owner',
      },
      { onConflict: 'id' }
    );

    if (profileErr) {
      await adminClient.auth.admin.deleteUser(ownerId).catch(() => {});
      return jsonResponse(500, {
        success: false,
        error: `Failed to initialize owner profile: ${profileErr.message}`,
      });
    }

    // 3. Create their first PG property
    const { data: propRow, error: propErr } = await adminClient
      .from('properties')
      .insert({
        owner_id: ownerId,
        name: pgName,
        address: pgAddress,
        gender_type: pgGenderType,
        total_beds: totalBeds,
        is_active: true,
      })
      .select('id, name')
      .single();

    if (propErr || !propRow) {
      await adminClient.auth.admin.deleteUser(ownerId).catch(() => {});
      return jsonResponse(500, {
        success: false,
        error: `Failed to create PG property: ${propErr?.message || 'Unknown error'}`,
      });
    }

    return jsonResponse(200, {
      success: true,
      owner_id: ownerId,
      property_id: propRow.id,
      owner_name: ownerName,
      owner_email: ownerEmail,
      owner_phone: ownerPhone,
      pg_name: propRow.name,
    });
  } catch (err) {
    return jsonResponse(500, {
      success: false,
      error: err instanceof Error ? err.message : 'Unexpected server error.',
    });
  }
});
