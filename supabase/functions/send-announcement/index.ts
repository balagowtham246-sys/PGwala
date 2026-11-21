import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

/**
 * send-announcement
 * Caller: owner of the property (or its active warden).
 *
 * Flow:
 *   1. Authenticate JWT and authorize caller against property_id on the server.
 *   2. Validate title, message, audience ('all' | 'room'), and room_number.
 *   3. Resolve eligible active residents with linked logins from the DB
 *      (never trusts client-provided profile ID lists).
 *   4. Query valid Expo push tokens for those profiles, batch in chunks of 100,
 *      dispatch via Expo Push API, and mark dead tokens invalid.
 *
 * Optional server secret: EXPO_ACCESS_TOKEN (Expo enhanced push security).
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const AUDIENCES = ['all', 'room'] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function normalizeRoomCode(raw: string | null | undefined): string {
  let clean = (raw ?? '').trim().replace(/\s+/g, ' ');
  while (/^(?:room|rm)\s+/i.test(clean)) {
    clean = clean.replace(/^(?:room|rm)\s+/i, '').trim();
  }
  return clean;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return json(405, { success: false, code: 'METHOD_NOT_ALLOWED', error: 'Only POST is supported.' });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const expoAccessToken = Deno.env.get('EXPO_ACCESS_TOKEN') ?? '';
    if (!supabaseUrl || !serviceKey) {
      return json(500, { success: false, code: 'CONFIG_ERROR', error: 'Server configuration error.' });
    }

    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!jwt) return json(401, { success: false, code: 'UNAUTHORIZED', error: 'Missing credentials.' });

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: userData, error: userError } = await admin.auth.getUser(jwt);
    const caller = userData?.user;
    if (userError || !caller) {
      return json(401, { success: false, code: 'UNAUTHORIZED', error: 'Invalid or expired session.' });
    }

    // ---- Parse + validate payload ----
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json(400, { success: false, code: 'BAD_REQUEST', error: 'Invalid JSON body.' });
    }

    const requestedPropertyId = String(body.property_id ?? '').trim();
    const title = String(body.title ?? '').trim();
    const message = String(body.message ?? '').trim();
    const audience = String(body.audience ?? 'all').trim();
    const rawRoom = body.room_number != null ? String(body.room_number) : '';
    const normalizedRoom = audience === 'room' ? normalizeRoomCode(rawRoom) : null;

    if (!UUID_RE.test(requestedPropertyId)) {
      return json(400, { success: false, code: 'BAD_REQUEST', error: 'property_id is required.' });
    }
    if (!title || title.length > 200) {
      return json(400, {
        success: false,
        code: 'BAD_REQUEST',
        error: 'Title must be between 1 and 200 characters.',
      });
    }
    if (!message || message.length > 4000) {
      return json(400, {
        success: false,
        code: 'BAD_REQUEST',
        error: 'Message must be between 1 and 4000 characters.',
      });
    }
    if (!(AUDIENCES as readonly string[]).includes(audience)) {
      return json(400, { success: false, code: 'BAD_REQUEST', error: 'Invalid audience.' });
    }
    if (audience === 'room' && !normalizedRoom) {
      return json(400, { success: false, code: 'BAD_REQUEST', error: 'Room number is required for room notices.' });
    }

    // ---- Authorization: verify caller owns or wardens this property ----
    const { data: callerProfile } = await admin
      .from('profiles')
      .select('id, role')
      .eq('id', caller.id)
      .maybeSingle();

    if (!callerProfile) {
      return json(403, { success: false, code: 'FORBIDDEN', error: 'Access denied.' });
    }

    if (callerProfile.role === 'owner') {
      const { data: owned } = await admin
        .from('properties')
        .select('id')
        .eq('id', requestedPropertyId)
        .eq('owner_id', caller.id)
        .maybeSingle();
      if (!owned) {
        return json(403, { success: false, code: 'FORBIDDEN', error: 'You do not own this property.' });
      }
    } else if (callerProfile.role === 'warden') {
      const { data: assignment } = await admin
        .from('property_wardens')
        .select('property_id')
        .eq('warden_profile_id', caller.id)
        .eq('property_id', requestedPropertyId)
        .eq('is_active', true)
        .maybeSingle();
      if (!assignment) {
        return json(403, { success: false, code: 'FORBIDDEN', error: 'You are not assigned to this property.' });
      }
    } else {
      return json(403, {
        success: false,
        code: 'FORBIDDEN',
        error: 'Only property owners and wardens can send announcements.',
      });
    }

    const { data: property } = await admin
      .from('properties')
      .select('id, name, is_active')
      .eq('id', requestedPropertyId)
      .maybeSingle();

    if (!property || !property.is_active) {
      return json(403, { success: false, code: 'FORBIDDEN', error: 'Property is not active.' });
    }

    // ---- Resolve eligible recipients from DB (never trusts client lists) ----
    const { data: residents, error: residentError } = await admin
      .from('residents')
      .select('id, profile_id, room_number')
      .eq('property_id', property.id)
      .eq('is_active', true)
      .not('profile_id', 'is', null);

    if (residentError) {
      return json(500, { success: false, code: 'DB_ERROR', error: 'Could not resolve recipients.' });
    }

    const allLinked = (residents ?? []) as {
      id: string;
      profile_id: string;
      room_number: string;
    }[];

    const matchingResidents =
      audience === 'all'
        ? allLinked
        : allLinked.filter(
            (r) => normalizeRoomCode(r.room_number).toLowerCase() === normalizedRoom!.toLowerCase()
          );

    const profileIds = [...new Set(matchingResidents.map((r) => r.profile_id).filter(Boolean))];
    if (profileIds.length === 0) {
      return json(200, {
        success: true,
        targeted: 0,
        push_sent: 0,
        push_failed: 0,
        in_app_only: 0,
        dispatch_status: 'no_push',
      });
    }

    // ---- Fetch active Expo push tokens ----
    const tokensByProfile = new Map<string, string[]>();
    for (const ids of chunk(profileIds, 200)) {
      const { data: tokens } = await admin
        .from('push_tokens')
        .select('profile_id, expo_token')
        .in('profile_id', ids)
        .eq('is_valid', true);

      for (const t of tokens ?? []) {
        const list = tokensByProfile.get(t.profile_id) ?? [];
        list.push(t.expo_token);
        tokensByProfile.set(t.profile_id, list);
      }
    }

    const pushTitle = property.name ? `${property.name}: ${title}` : title;
    const pushBody = message.length > 240 ? `${message.slice(0, 237)}...` : message;

    type Msg = { to: string; profile_id: string };
    const messages: Msg[] = [];
    let noTokenCount = 0;

    for (const profileId of profileIds) {
      const tokens = tokensByProfile.get(profileId);
      if (!tokens || tokens.length === 0) {
        noTokenCount += 1;
      } else {
        for (const to of tokens) {
          messages.push({ to, profile_id: profileId });
        }
      }
    }

    const okProfiles = new Set<string>();
    const failedProfiles = new Set<string>();
    const deadTokens: string[] = [];

    for (const batch of chunk(messages, 100)) {
      try {
        const res = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...(expoAccessToken ? { Authorization: `Bearer ${expoAccessToken}` } : {}),
          },
          body: JSON.stringify(
            batch.map((m) => ({
              to: m.to,
              title: pushTitle,
              body: pushBody,
              sound: 'default',
              priority: 'high',
              channelId: 'resident-alerts',
              data: {
                type: 'announcement',
                property_id: property.id,
                audience,
                room_number: normalizedRoom,
              },
            }))
          ),
        });

        const payload = await res.json().catch(() => null);
        const tickets: any[] = Array.isArray(payload?.data) ? payload.data : [];

        if (!res.ok || tickets.length !== batch.length) {
          for (const m of batch) failedProfiles.add(m.profile_id);
          continue;
        }

        tickets.forEach((t, i) => {
          const m = batch[i];
          if (t?.status === 'ok') {
            okProfiles.add(m.profile_id);
          } else {
            failedProfiles.add(m.profile_id);
            if (t?.details?.error === 'DeviceNotRegistered') {
              deadTokens.push(m.to);
            }
          }
        });
      } catch (e) {
        for (const m of batch) failedProfiles.add(m.profile_id);
        console.error(
          '[send-announcement] push batch failed:',
          e instanceof Error ? e.message : String(e)
        );
      }
    }

    if (deadTokens.length > 0) {
      for (const t of chunk(deadTokens, 100)) {
        await admin.from('push_tokens').update({ is_valid: false }).in('expo_token', t);
      }
    }

    const pushable = profileIds.length - noTokenCount;
    const sent = okProfiles.size;
    const failed = [...failedProfiles].filter((p) => !okProfiles.has(p)).length;
    const dispatchStatus =
      pushable === 0 ? 'no_push' : sent === pushable ? 'sent' : sent > 0 ? 'partial' : 'failed';

    return json(200, {
      success: true,
      targeted: profileIds.length,
      push_sent: sent,
      push_failed: failed,
      in_app_only: noTokenCount,
      dispatch_status: dispatchStatus,
    });
  } catch (err: unknown) {
    console.error(
      '[send-announcement] unexpected error:',
      err instanceof Error ? err.message : String(err)
    );
    return json(500, { success: false, code: 'INTERNAL_ERROR', error: 'Unexpected server error.' });
  }
});
