import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

/**
 * send-food-alert
 * Caller: warden of a property (property derived server-side) or the property's owner.
 *
 * Flow:
 *   1. Authenticate JWT, derive property from server-side assignment.
 *   2. Validate payload; resolve recipients from the DB (never trusts client lists).
 *   3. Idempotency: same (caller, idempotency_key) returns the stored result.
 *   4. Store alert + recipients FIRST, then dispatch Expo push in chunks of 100.
 *   5. Record per-recipient delivery, invalidate dead tokens, return summary.
 *
 * Optional server secret: EXPO_ACCESS_TOKEN (Expo enhanced push security).
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const MEALS = ['breakfast', 'lunch', 'dinner'] as const;
const STATUSES = ['ready', 'delayed', 'cancelled'] as const;
const AUDIENCES = ['all', 'rooms', 'residents'] as const;
const MEAL_LABEL: Record<string, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' };
const STATUS_LABEL: Record<string, string> = { ready: 'is ready', delayed: 'is delayed', cancelled: 'is cancelled' };
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

    const mealType = String(body.meal_type ?? '');
    const status = String(body.status ?? '');
    const audienceType = String(body.audience_type ?? 'all');
    const idempotencyKey = String(body.idempotency_key ?? '').trim();
    const message = String(body.message ?? '').trim();

    if (!(MEALS as readonly string[]).includes(mealType)) {
      return json(400, { success: false, code: 'BAD_REQUEST', error: 'Invalid meal type.' });
    }
    if (!(STATUSES as readonly string[]).includes(status)) {
      return json(400, { success: false, code: 'BAD_REQUEST', error: 'Invalid food status.' });
    }
    if (!(AUDIENCES as readonly string[]).includes(audienceType)) {
      return json(400, { success: false, code: 'BAD_REQUEST', error: 'Invalid audience.' });
    }
    if (idempotencyKey.length < 8 || idempotencyKey.length > 80) {
      return json(400, { success: false, code: 'BAD_REQUEST', error: 'Invalid request key.' });
    }
    if (message.length > 200) {
      return json(400, { success: false, code: 'BAD_REQUEST', error: 'Message must be 200 characters or fewer.' });
    }

    const rooms = Array.isArray(body.rooms)
      ? [...new Set((body.rooms as unknown[]).map((r) => String(r).trim()).filter(Boolean))].slice(0, 200)
      : [];
    const residentIds = Array.isArray(body.resident_ids)
      ? [...new Set((body.resident_ids as unknown[]).map((r) => String(r).trim()))].slice(0, 500)
      : [];

    if (audienceType === 'rooms' && rooms.length === 0) {
      return json(400, { success: false, code: 'BAD_REQUEST', error: 'Select at least one room.' });
    }
    if (audienceType === 'residents') {
      if (residentIds.length === 0) {
        return json(400, { success: false, code: 'BAD_REQUEST', error: 'Select at least one resident.' });
      }
      if (residentIds.some((id) => !UUID_RE.test(id))) {
        return json(400, { success: false, code: 'BAD_REQUEST', error: 'Invalid resident selection.' });
      }
    }

    // ---- Authorization: derive property from server-side data ----
    const { data: callerProfile } = await admin
      .from('profiles')
      .select('id, role')
      .eq('id', caller.id)
      .maybeSingle();
    if (!callerProfile) return json(403, { success: false, code: 'FORBIDDEN', error: 'Access denied.' });

    const requestedPropertyId = String(body.property_id ?? '').trim();
    let propertyId = '';

    if (callerProfile.role === 'warden') {
      const { data: assignment } = await admin
        .from('property_wardens')
        .select('property_id')
        .eq('warden_profile_id', caller.id)
        .eq('is_active', true)
        .maybeSingle();
      if (!assignment) {
        return json(403, { success: false, code: 'FORBIDDEN', error: 'You are not assigned to a property.' });
      }
      if (requestedPropertyId && requestedPropertyId !== assignment.property_id) {
        return json(403, { success: false, code: 'FORBIDDEN', error: 'Access denied for this property.' });
      }
      propertyId = assignment.property_id;
    } else if (callerProfile.role === 'owner') {
      if (!UUID_RE.test(requestedPropertyId)) {
        return json(400, { success: false, code: 'BAD_REQUEST', error: 'property_id is required.' });
      }
      const { data: owned } = await admin
        .from('properties')
        .select('id')
        .eq('id', requestedPropertyId)
        .eq('owner_id', caller.id)
        .maybeSingle();
      if (!owned) return json(403, { success: false, code: 'FORBIDDEN', error: 'You do not own this property.' });
      propertyId = owned.id;
    } else {
      return json(403, { success: false, code: 'FORBIDDEN', error: 'Only wardens and owners can send food alerts.' });
    }

    const { data: property } = await admin
      .from('properties')
      .select('id, name, is_active')
      .eq('id', propertyId)
      .maybeSingle();
    if (!property || !property.is_active) {
      return json(403, { success: false, code: 'FORBIDDEN', error: 'Property is not active.' });
    }

    const summarize = (a: Record<string, any>, duplicate: boolean) =>
      json(200, {
        success: true,
        duplicate,
        alert_id: a.id,
        targeted: a.recipients_count,
        push_sent: a.push_sent,
        push_failed: a.push_failed,
        in_app_only: a.no_token_count,
        dispatch_status: a.dispatch_status,
      });

    // ---- Idempotency ----
    const { data: existing } = await admin
      .from('food_alerts')
      .select('*')
      .eq('created_by', caller.id)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    if (existing) return summarize(existing, true);

    // ---- Resolve recipients from the DB (active + opted-in + linked login) ----
    let residentQuery = admin
      .from('residents')
      .select('id, profile_id, room_number')
      .eq('property_id', propertyId)
      .eq('is_active', true)
      .eq('meal_opt_in', true)
      .not('profile_id', 'is', null);

    if (audienceType === 'rooms') residentQuery = residentQuery.in('room_number', rooms);
    if (audienceType === 'residents') residentQuery = residentQuery.in('id', residentIds);

    const { data: residents, error: residentError } = await residentQuery;
    if (residentError) {
      return json(500, { success: false, code: 'DB_ERROR', error: 'Could not resolve recipients.' });
    }
    const allOptedIn = (residents ?? []) as { id: string; profile_id: string; room_number: string }[];
    if (allOptedIn.length === 0) {
      return json(400, {
        success: false,
        code: 'NO_RECIPIENTS',
        error: 'No eligible residents found (must be active, opted in for meals and have a login).',
      });
    }

    // ---- Exclude residents currently on multi-day Home / Vacation Leave ----
    const onLeaveIds = new Set<string>();
    try {
      const candidateIds = allOptedIn.map((r) => r.id);
      const { data: latestLogs } = await admin
        .from('movement_logs')
        .select('resident_id, direction, expected_return_date, event_time')
        .eq('property_id', propertyId)
        .in('resident_id', candidateIds)
        .order('event_time', { ascending: false })
        .limit(Math.max(candidateIds.length * 4, 200));

      const seenResident = new Set<string>();
      for (const row of (latestLogs ?? []) as {
        resident_id: string;
        direction: string;
        expected_return_date?: string | null;
      }[]) {
        if (seenResident.has(row.resident_id)) continue;
        seenResident.add(row.resident_id);
        if (row.direction === 'OUT' && row.expected_return_date) {
          onLeaveIds.add(row.resident_id);
        }
      }
    } catch {
      // Non-fatal fallback if expected_return_date migration is not yet applied
    }

    const recipients = allOptedIn.filter((r) => !onLeaveIds.has(r.id));
    if (recipients.length === 0) {
      return json(400, {
        success: false,
        code: 'NO_RECIPIENTS',
        error: 'All eligible residents are currently on multi-day leave.',
      });
    }

    // ---- Store announcement BEFORE dispatch ----
    const { data: alert, error: alertError } = await admin
      .from('food_alerts')
      .insert({
        property_id: propertyId,
        meal_type: mealType,
        status,
        message: message || null,
        audience_type: audienceType,
        target_rooms: audienceType === 'rooms' ? rooms : null,
        target_resident_ids: audienceType === 'residents' ? residentIds : null,
        created_by: caller.id,
        idempotency_key: idempotencyKey,
        recipients_count: recipients.length,
      })
      .select('*')
      .single();

    if (alertError || !alert) {
      if ((alertError as any)?.code === '23505') {
        // Concurrent duplicate submission
        const { data: dup } = await admin
          .from('food_alerts')
          .select('*')
          .eq('created_by', caller.id)
          .eq('idempotency_key', idempotencyKey)
          .maybeSingle();
        if (dup) return summarize(dup, true);
      }
      return json(500, { success: false, code: 'DB_ERROR', error: 'Could not save announcement.' });
    }

    const recipientRows = recipients.map((r) => ({
      alert_id: alert.id,
      resident_id: r.id,
      profile_id: r.profile_id,
      delivery_status: 'pending',
    }));
    const { error: recipientsError } = await admin.from('food_alert_recipients').insert(recipientRows);
    if (recipientsError) {
      await admin.from('food_alerts').delete().eq('id', alert.id);
      return json(500, { success: false, code: 'DB_ERROR', error: 'Could not save recipients.' });
    }

    // ---- Push tokens for recipients ----
    const profileIds = recipients.map((r) => r.profile_id);
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

    const title = `${property.name}: ${MEAL_LABEL[mealType]} ${STATUS_LABEL[status]}`;
    const bodyText =
      message ||
      (status === 'ready'
        ? `${MEAL_LABEL[mealType]} is ready. Please come to the dining area.`
        : status === 'delayed'
        ? `${MEAL_LABEL[mealType]} is delayed. We will update you soon.`
        : `${MEAL_LABEL[mealType]} has been cancelled today.`);

    type Msg = { to: string; profile_id: string };
    const messages: Msg[] = [];
    const noTokenResidents: string[] = [];
    for (const r of recipients) {
      const tokens = tokensByProfile.get(r.profile_id);
      if (!tokens || tokens.length === 0) noTokenResidents.push(r.id);
      else for (const to of tokens) messages.push({ to, profile_id: r.profile_id });
    }

    const okProfiles = new Set<string>();
    const failedProfiles = new Map<string, string>();
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
              title,
              body: bodyText,
              sound: 'default',
              priority: 'high',
              channelId: 'food-alerts',
              data: { type: 'food_alert', alert_id: alert.id, status, meal_type: mealType },
            }))
          ),
        });
        const payload = await res.json().catch(() => null);
        const tickets: any[] = Array.isArray(payload?.data) ? payload.data : [];
        if (!res.ok || tickets.length !== batch.length) {
          for (const m of batch) failedProfiles.set(m.profile_id, `Expo push error (${res.status})`);
          continue;
        }
        tickets.forEach((t, i) => {
          const m = batch[i];
          if (t?.status === 'ok') {
            okProfiles.add(m.profile_id);
          } else {
            const code = t?.details?.error ?? 'UnknownError';
            failedProfiles.set(m.profile_id, String(code));
            if (code === 'DeviceNotRegistered') deadTokens.push(m.to);
          }
        });
      } catch (e) {
        for (const m of batch) failedProfiles.set(m.profile_id, 'Network error contacting Expo');
        console.error('[send-food-alert] push batch failed:', e instanceof Error ? e.message : String(e));
      }
    }

    // ---- Persist delivery results ----
    if (deadTokens.length > 0) {
      for (const t of chunk(deadTokens, 100)) {
        await admin.from('push_tokens').update({ is_valid: false }).in('expo_token', t);
      }
    }

    const sentResidents = recipients.filter((r) => okProfiles.has(r.profile_id)).map((r) => r.id);
    const failedResidents = recipients.filter((r) => !okProfiles.has(r.profile_id) && failedProfiles.has(r.profile_id));

    for (const ids of chunk(sentResidents, 100)) {
      await admin
        .from('food_alert_recipients')
        .update({ delivery_status: 'sent' })
        .eq('alert_id', alert.id)
        .in('resident_id', ids);
    }
    for (const ids of chunk(noTokenResidents, 100)) {
      await admin
        .from('food_alert_recipients')
        .update({ delivery_status: 'no_token' })
        .eq('alert_id', alert.id)
        .in('resident_id', ids);
    }
    for (const r of failedResidents) {
      await admin
        .from('food_alert_recipients')
        .update({ delivery_status: 'failed', error: failedProfiles.get(r.profile_id)?.slice(0, 200) ?? null })
        .eq('alert_id', alert.id)
        .eq('resident_id', r.id);
    }

    const pushable = recipients.length - noTokenResidents.length;
    const sent = sentResidents.length;
    const failed = failedResidents.length;
    const dispatchStatus =
      pushable === 0 ? 'no_push' : sent === pushable ? 'sent' : sent > 0 ? 'partial' : 'failed';

    const { data: finalAlert } = await admin
      .from('food_alerts')
      .update({
        dispatch_status: dispatchStatus,
        push_sent: sent,
        push_failed: failed,
        no_token_count: noTokenResidents.length,
      })
      .eq('id', alert.id)
      .select('*')
      .single();

    return summarize(
      finalAlert ?? {
        ...alert,
        dispatch_status: dispatchStatus,
        push_sent: sent,
        push_failed: failed,
        no_token_count: noTokenResidents.length,
      },
      false
    );
  } catch (err: unknown) {
    console.error('[send-food-alert] unexpected error:', err instanceof Error ? err.message : String(err));
    return json(500, { success: false, code: 'INTERNAL_ERROR', error: 'Unexpected server error.' });
  }
});
