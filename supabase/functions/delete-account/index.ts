import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

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
      data: { user },
      error: authErr,
    } = await adminClient.auth.getUser(jwt);

    if (authErr || !user) {
      return jsonResponse(401, { success: false, error: 'Your session is invalid or expired.' });
    }

    const userId = user.id;

    // Fetch role to apply role-safe cleanup rules
    const { data: profile } = await adminClient
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();

    const role = profile?.role ?? 'student';

    if (role === 'owner') {
      // Safety guard: do not orphan active residents inside an owner's PG
      const { data: ownedProps } = await adminClient
        .from('properties')
        .select('id')
        .eq('owner_id', userId);

      const propIds = (ownedProps ?? []).map((p: { id: string }) => p.id);
      if (propIds.length > 0) {
        const { count: activeResidentCount } = await adminClient
          .from('residents')
          .select('id', { count: 'exact', head: true })
          .in('property_id', propIds)
          .eq('is_active', true);

        if ((activeResidentCount ?? 0) > 0) {
          return jsonResponse(400, {
            success: false,
            error: `You still have ${activeResidentCount} active resident${
              activeResidentCount === 1 ? '' : 's'
            }. Please check out or remove all active residents before deleting your owner account.`,
          });
        }
      }
    } else if (role === 'warden') {
      await adminClient
        .from('property_wardens')
        .update({ is_active: false })
        .eq('warden_profile_id', userId);
    } else {
      // Resident: detach auth profile_id so PG owner keeps accounting history intact
      await adminClient
        .from('residents')
        .update({ profile_id: null })
        .eq('profile_id', userId);
    }

    // Clear push tokens for this user
    await adminClient.from('push_tokens').delete().eq('user_id', userId);

    // Delete auth user (cascades profile row where configured)
    const { error: deleteErr } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteErr) {
      return jsonResponse(500, {
        success: false,
        error: deleteErr.message || 'Could not delete account.',
      });
    }

    return jsonResponse(200, {
      success: true,
      message: 'Your account has been permanently deleted.',
    });
  } catch (err) {
    return jsonResponse(500, {
      success: false,
      error: err instanceof Error ? err.message : 'Unexpected server error.',
    });
  }
});
