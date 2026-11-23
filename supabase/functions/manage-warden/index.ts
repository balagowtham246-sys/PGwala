import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

/**
 * manage-warden
 * Owner-only. Actions:
 *   - get:               current warden of a property (name, email, phone)
 *   - create_and_assign: create a warden login and assign to a property
 *                        (replaces any current warden = "change")
 *   - remove:            deactivate the property's current warden assignment
 *
 * Authorization is derived server-side from the caller's JWT. The property must be
 * owned by the caller. The service-role key never leaves this function.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return json(405, { success: false, code: 'METHOD_NOT_ALLOWED', error: 'Only POST is supported.' });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceKey) {
      return json(500, { success: false, code: 'CONFIG_ERROR', error: 'Server configuration error.' });
    }

    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!jwt) return json(401, { success: false, code: 'UNAUTHORIZED', error: 'Missing credentials.' });

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: userData, error: userError } = await admin.auth.getUser(jwt);
    const caller = userData?.user;
    if (userError || !caller) {
      return json(401, { success: false, code: 'UNAUTHORIZED', error: 'Invalid or expired session.' });
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json(400, { success: false, code: 'BAD_REQUEST', error: 'Invalid JSON body.' });
    }

    const action = String(body.action ?? '');
    const propertyId = String(body.property_id ?? '').trim();
    if (!propertyId) return json(400, { success: false, code: 'BAD_REQUEST', error: 'property_id is required.' });

    // Caller must be an owner who owns this active property
    const { data: callerProfile } = await admin
      .from('profiles')
      .select('id, role')
      .eq('id', caller.id)
      .maybeSingle();
    if (!callerProfile || callerProfile.role !== 'owner') {
      return json(403, { success: false, code: 'FORBIDDEN', error: 'Only PG owners can manage wardens.' });
    }

    const { data: property } = await admin
      .from('properties')
      .select('id, name')
      .eq('id', propertyId)
      .eq('owner_id', caller.id)
      .maybeSingle();
    if (!property) {
      return json(403, { success: false, code: 'FORBIDDEN', error: 'You do not own this property.' });
    }

    const { data: current } = await admin
      .from('property_wardens')
      .select('id, warden_profile_id')
      .eq('property_id', propertyId)
      .eq('is_active', true)
      .maybeSingle();

    if (action === 'get') {
      if (!current) return json(200, { success: true, warden: null });
      const { data: wp } = await admin
        .from('profiles')
        .select('full_name, phone_number')
        .eq('id', current.warden_profile_id)
        .maybeSingle();
      const { data: au } = await admin.auth.admin.getUserById(current.warden_profile_id);
      return json(200, {
        success: true,
        warden: {
          profile_id: current.warden_profile_id,
          full_name: wp?.full_name ?? '',
          phone_number: wp?.phone_number ?? null,
          email: au?.user?.email ?? null,
        },
      });
    }

    if (action === 'remove') {
      if (current) {
        const { error } = await admin.from('property_wardens').update({ is_active: false }).eq('id', current.id);
        if (error) return json(500, { success: false, code: 'DB_ERROR', error: 'Could not remove warden.' });
        // Invalidate removed warden's push tokens so they stop receiving property notifications
        await admin
          .from('push_tokens')
          .update({ is_valid: false })
          .eq('profile_id', current.warden_profile_id)
          .eq('is_valid', true);
      }
      return json(200, { success: true, message: 'Warden removed.' });
    }

    if (action === 'create_and_assign') {
      const fullName = String(body.full_name ?? '').trim();
      const email = String(body.email ?? '').trim().toLowerCase();
      const password = String(body.temporary_password ?? '');
      const phone = String(body.phone_number ?? '').trim() || null;

      if (fullName.length < 2) return json(400, { success: false, code: 'BAD_REQUEST', error: 'Enter the warden name.' });
      if (!EMAIL_RE.test(email)) return json(400, { success: false, code: 'BAD_REQUEST', error: 'Enter a valid email.' });
      if (password.length < 6) {
        return json(400, { success: false, code: 'BAD_REQUEST', error: 'Temporary password must be at least 6 characters.' });
      }

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName, role: 'warden', must_change_password: true },
      });
      if (createError || !created?.user) {
        const msg = (createError?.message ?? '').toLowerCase();
        if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
          return json(409, { success: false, code: 'DUPLICATE_EMAIL', error: `An account with ${email} already exists.` });
        }
        return json(400, { success: false, code: 'AUTH_CREATE_FAILED', error: 'Could not create warden account.' });
      }
      const wardenId = created.user.id;

      const rollback = async () => {
        try {
          await admin.auth.admin.deleteUser(wardenId);
        } catch (e) {
          console.error('[manage-warden] rollback failed:', e instanceof Error ? e.message : String(e));
        }
      };

      // handle_new_user created a 'student' profile; promote it to warden.
      const { error: promoteError } = await admin
        .from('profiles')
        .update({ role: 'warden', full_name: fullName, phone_number: phone, must_change_password: true })
        .eq('id', wardenId);
      if (promoteError) {
        await rollback();
        return json(500, { success: false, code: 'DB_ERROR', error: 'Could not set up warden profile.' });
      }

      // Replace any existing warden for this property
      if (current) {
        const { error: deactivateError } = await admin
          .from('property_wardens')
          .update({ is_active: false })
          .eq('id', current.id);
        if (deactivateError) {
          await rollback();
          return json(500, { success: false, code: 'DB_ERROR', error: 'Could not replace current warden.' });
        }
      }

      const { error: assignError } = await admin.from('property_wardens').insert({
        property_id: propertyId,
        warden_profile_id: wardenId,
        assigned_by: caller.id,
        is_active: true,
      });
      if (assignError) {
        // restore previous warden if we deactivated them
        if (current) await admin.from('property_wardens').update({ is_active: true }).eq('id', current.id);
        await rollback();
        return json(500, { success: false, code: 'DB_ERROR', error: 'Could not assign warden.' });
      }

      if (current) {
        await admin
          .from('push_tokens')
          .update({ is_valid: false })
          .eq('profile_id', current.warden_profile_id)
          .eq('is_valid', true);
      }

      return json(200, {
        success: true,
        message: `Warden ${fullName} assigned to ${property.name}.`,
        warden: { profile_id: wardenId, full_name: fullName, email, phone_number: phone },
      });
    }

    return json(400, { success: false, code: 'BAD_REQUEST', error: 'Unknown action.' });
  } catch (err: unknown) {
    console.error('[manage-warden] unexpected error:', err instanceof Error ? err.message : String(err));
    return json(500, { success: false, code: 'INTERNAL_ERROR', error: 'Unexpected server error.' });
  }
});
