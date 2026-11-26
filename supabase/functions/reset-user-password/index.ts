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

interface ResetPasswordBody {
  target_type: 'resident' | 'owner';
  resident_id?: string;
  owner_email?: string;
  new_password: string;
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

    if (authErr || !callerUser) {
      return jsonResponse(401, { success: false, error: 'Invalid or expired session.' });
    }

    let body: ResetPasswordBody;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { success: false, error: 'Invalid JSON request body.' });
    }

    const newPassword = (body.new_password ?? '').trim();
    if (newPassword.length < 6) {
      return jsonResponse(400, {
        success: false,
        error: 'New password must be at least 6 characters.',
      });
    }

    if (body.target_type === 'resident') {
      const residentId = (body.resident_id ?? '').trim();
      if (!residentId) {
        return jsonResponse(400, { success: false, error: 'resident_id is required.' });
      }

      // Verify caller is an owner and owns the resident's property
      const { data: residentRow, error: resErr } = await adminClient
        .from('residents')
        .select('id, full_name, phone_number, profile_id, property:properties!inner(id, owner_id, name)')
        .eq('id', residentId)
        .maybeSingle();

      if (resErr || !residentRow) {
        return jsonResponse(404, { success: false, error: 'Resident not found.' });
      }

      const prop = Array.isArray(residentRow.property)
        ? residentRow.property[0]
        : residentRow.property;

      if (!prop || prop.owner_id !== callerUser.id) {
        return jsonResponse(403, {
          success: false,
          error: 'Forbidden: you do not own this resident’s PG property.',
        });
      }

      if (!residentRow.profile_id) {
        return jsonResponse(400, {
          success: false,
          error: 'This resident does not have an app login linked yet.',
        });
      }

      // Defense-in-depth: ensure target profile is actually a resident ('student') account
      const { data: targetProfile } = await adminClient
        .from('profiles')
        .select('role')
        .eq('id', residentRow.profile_id)
        .maybeSingle();

      if (targetProfile?.role && targetProfile.role !== 'student') {
        return jsonResponse(403, {
          success: false,
          error: 'Forbidden: target account is not a resident account.',
        });
      }

      const { data: targetAuthUser, error: getUserErr } =
        await adminClient.auth.admin.getUserById(residentRow.profile_id);

      if (getUserErr || !targetAuthUser?.user) {
        return jsonResponse(404, {
          success: false,
          error: 'Linked login account could not be found.',
        });
      }

      const { error: updateErr } = await adminClient.auth.admin.updateUserById(
        residentRow.profile_id,
        { password: newPassword, email_confirm: true }
      );

      if (updateErr) {
        return jsonResponse(500, {
          success: false,
          error: updateErr.message || 'Could not reset resident password.',
        });
      }

      // Best-effort: revoke existing refresh tokens on compromised/old devices
      try {
        await adminClient.auth.admin.signOut(residentRow.profile_id, 'global');
      } catch {
        // Non-fatal if session revocation is unsupported
      }

      return jsonResponse(200, {
        success: true,
        target_name: residentRow.full_name,
        target_email: targetAuthUser.user.email ?? '',
        target_phone: residentRow.phone_number ?? null,
        pg_name: prop.name ?? 'PGwala',
      });
    }

    if (body.target_type === 'owner') {
      const allowedAdmins = getAllowedAdminEmails();
      if (!callerUser.email || !allowedAdmins.has(callerUser.email.trim().toLowerCase())) {
        return jsonResponse(403, {
          success: false,
          error: 'Forbidden: only PGwala administrators can reset PG owner passwords.',
        });
      }

      const ownerEmail = (body.owner_email ?? '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
        return jsonResponse(400, { success: false, error: 'Enter a valid PG owner email.' });
      }

      // Paginate through auth users safely (supports > 1,000 total accounts)
      let matched: { id: string; email?: string | null } | null = null;
      const perPage = 1000;
      for (let page = 1; page <= 20; page += 1) {
        const { data: listData, error: listErr } = await adminClient.auth.admin.listUsers({
          page,
          perPage,
        });
        if (listErr) {
          return jsonResponse(500, { success: false, error: 'Could not look up owner account.' });
        }
        const batch = listData?.users ?? [];
        const found = batch.find(
          (u) => (u.email ?? '').trim().toLowerCase() === ownerEmail
        );
        if (found) {
          matched = found;
          break;
        }
        if (batch.length < perPage) break;
      }

      if (!matched) {
        return jsonResponse(404, {
          success: false,
          error: `No PGwala account found for ${ownerEmail}.`,
        });
      }

      const { data: profileRow } = await adminClient
        .from('profiles')
        .select('full_name, phone_number, role')
        .eq('id', matched.id)
        .maybeSingle();

      if (profileRow?.role !== 'owner') {
        return jsonResponse(400, {
          success: false,
          error: 'This email does not belong to a PG Owner account.',
        });
      }

      const { error: updateErr } = await adminClient.auth.admin.updateUserById(matched.id, {
        password: newPassword,
        email_confirm: true,
      });
      if (updateErr) {
        return jsonResponse(500, {
          success: false,
          error: updateErr.message || 'Could not reset owner password.',
        });
      }

      // Best-effort: revoke existing sessions on old/compromised devices
      try {
        await adminClient.auth.admin.signOut(matched.id, 'global');
      } catch {
        // Non-fatal if session revocation is unsupported
      }

      return jsonResponse(200, {
        success: true,
        target_name: profileRow.full_name || 'PG Owner',
        target_email: ownerEmail,
        target_phone: profileRow.phone_number ?? null,
      });
    }

    return jsonResponse(400, { success: false, error: 'Invalid target_type.' });
  } catch (err) {
    return jsonResponse(500, {
      success: false,
      error: err instanceof Error ? err.message : 'Unexpected server error.',
    });
  }
});
