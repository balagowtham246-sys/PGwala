import AsyncStorage from '@react-native-async-storage/async-storage';

import { buildWhatsAppReminderUrl } from '@/lib/billing-utils';
import { invokeEdgeFunction } from '@/lib/edge-functions';
import { endTrace, recordRoundTrip, startTrace } from '@/lib/perf-monitor';
import { getCachedEntry, invalidatePrefix, setCached } from '@/lib/query-cache';
import { fail, ok, ServiceResult } from '@/lib/service-result';
import { supabase } from '@/lib/supabase';
import { formatRoomLabel, normalizeRoomCode, sortRoomCodes } from '@/lib/ux-utils';

export type AnnouncementAudience = 'all' | 'room';
export type AnnouncementChannel = 'push' | 'whatsapp';

export interface AnnouncementItem {
  id: string;
  propertyId: string;
  title: string;
  message: string;
  audience: AnnouncementAudience;
  roomNumber: string | null;
  channel: AnnouncementChannel;
  recipientCount: number;
  createdAt: string;
}

export interface AnnouncementRecipient {
  id: string;
  fullName: string;
  roomNumber: string;
  phoneNumber: string | null;
  profileId: string | null;
}

export interface AnnouncementRoomOption {
  roomNumber: string;
  label: string;
  residentCount: number;
}

export interface WhatsAppRecipientLink {
  id: string;
  fullName: string;
  phoneNumber: string | null;
  url: string | null;
}

export interface SendAnnouncementInput {
  propertyId: string;
  propertyName: string;
  ownerId: string;
  title: string;
  message: string;
  audience: AnnouncementAudience;
  roomNumber?: string | null;
  channel: AnnouncementChannel;
}

export interface SendAnnouncementResult {
  item: AnnouncementItem;
  pushDeliveredVia: 'edge_function' | 'local_fallback' | 'not_applicable';
  whatsappMessage: string;
  whatsappRecipients: WhatsAppRecipientLink[];
}

export const ANNOUNCEMENTS_CACHE_PREFIX = 'announcements:';
const STORAGE_ANNOUNCEMENTS_PREFIX = '@pgwala_announcements:';

function isMissingAnnouncementsSchema(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  return (
    err.code === '42P01' ||
    err.code === '42703' ||
    err.code === '42501' ||
    err.code === 'PGRST204' ||
    err.code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('schema cache') ||
    msg.includes('could not find the table') ||
    msg.includes('permission denied')
  );
}

async function readLocalAnnouncements(propertyId: string): Promise<AnnouncementItem[]> {
  try {
    const raw = await AsyncStorage.getItem(`${STORAGE_ANNOUNCEMENTS_PREFIX}${propertyId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AnnouncementItem[]) : [];
  } catch {
    return [];
  }
}

async function writeLocalAnnouncements(
  propertyId: string,
  items: AnnouncementItem[]
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      `${STORAGE_ANNOUNCEMENTS_PREFIX}${propertyId}`,
      JSON.stringify(items.slice(0, 50))
    );
  } catch {
    // Non-fatal fallback
  }
}

export async function fetchAnnouncementTargets(propertyId: string): Promise<
  ServiceResult<{
    residents: AnnouncementRecipient[];
    rooms: AnnouncementRoomOption[];
  }>
> {
  const traceLabel = `announcements:targets:${propertyId}`;
  startTrace(traceLabel);
  try {
    const { data, error } = await supabase
      .from('residents')
      .select('id, full_name, room_number, phone_number, profile_id')
      .eq('property_id', propertyId)
      .eq('is_active', true)
      .order('room_number', { ascending: true });
    recordRoundTrip(traceLabel, 1);

    if (error) {
      return fail(error, 'Could not load residents for announcements.');
    }

    const rows = (data as {
      id: string;
      full_name: string;
      room_number: string;
      phone_number: string | null;
      profile_id?: string | null;
    }[]) ?? [];

    const residents: AnnouncementRecipient[] = rows.map((r) => ({
      id: r.id,
      fullName: r.full_name,
      roomNumber: normalizeRoomCode(r.room_number) || r.room_number.trim(),
      phoneNumber: r.phone_number ?? null,
      profileId: r.profile_id ?? null,
    }));

    const roomCounts = new Map<string, { code: string; count: number }>();
    for (const res of residents) {
      if (!res.roomNumber) continue;
      const key = res.roomNumber.toLowerCase();
      const existing = roomCounts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        roomCounts.set(key, { code: res.roomNumber, count: 1 });
      }
    }

    const rooms: AnnouncementRoomOption[] = Array.from(roomCounts.values())
      .sort((a, b) => sortRoomCodes(a.code, b.code))
      .map((entry) => ({
        roomNumber: entry.code,
        label: formatRoomLabel(entry.code),
        residentCount: entry.count,
      }));

    return ok({ residents, rooms });
  } catch (err) {
    return fail(err, 'Could not load residents.');
  } finally {
    endTrace(traceLabel);
  }
}

export async function fetchAnnouncements(
  propertyId: string,
  options?: { forceRefresh?: boolean }
): Promise<ServiceResult<AnnouncementItem[]>> {
  const cacheKey = `${ANNOUNCEMENTS_CACHE_PREFIX}list:${propertyId}`;
  if (!options?.forceRefresh) {
    const entry = await getCachedEntry<AnnouncementItem[]>(cacheKey);
    if (entry && !entry.isStale) {
      return ok(entry.data);
    }
  }

  const traceLabel = `announcements:list:${propertyId}`;
  startTrace(traceLabel);
  try {
    const localItems = await readLocalAnnouncements(propertyId);
    const { data, error } = await supabase
      .from('announcements')
      .select(
        'id, property_id, title, message, audience, room_number, channel, recipient_count, created_at'
      )
      .eq('property_id', propertyId)
      .order('created_at', { ascending: false })
      .limit(30);
    recordRoundTrip(traceLabel, 1);

    if (error) {
      if (isMissingAnnouncementsSchema(error)) {
        await setCached(cacheKey, localItems, 30_000);
        return ok(localItems);
      }
      return fail(error, 'Could not load announcement history.');
    }

    const dbItems: AnnouncementItem[] = ((data as {
      id: string;
      property_id: string;
      title: string;
      message: string;
      audience: AnnouncementAudience;
      room_number: string | null;
      channel: AnnouncementChannel;
      recipient_count: number;
      created_at: string;
    }[]) ?? []).map((row) => ({
      id: row.id,
      propertyId: row.property_id,
      title: row.title,
      message: row.message,
      audience: row.audience,
      roomNumber: row.room_number,
      channel: row.channel,
      recipientCount: row.recipient_count,
      createdAt: row.created_at,
    }));

    const seenIds = new Set(dbItems.map((i) => i.id));
    const combined = [...dbItems, ...localItems.filter((i) => !seenIds.has(i.id))].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    await setCached(cacheKey, combined, 30_000);
    return ok(combined);
  } catch (err) {
    return fail(err, 'Could not load announcements.');
  } finally {
    endTrace(traceLabel);
  }
}

export async function sendAnnouncement(
  input: SendAnnouncementInput
): Promise<ServiceResult<SendAnnouncementResult>> {
  const title = input.title.trim();
  const message = input.message.trim();
  if (!title) {
    return fail(new Error('Please enter an announcement title.'));
  }
  if (!message) {
    return fail(new Error('Please write the announcement message.'));
  }

  const normalizedRoom =
    input.audience === 'room' ? normalizeRoomCode(input.roomNumber) : null;
  if (input.audience === 'room' && !normalizedRoom) {
    return fail(new Error('Please select a room for this announcement.'));
  }

  const traceLabel = `announcements:send:${input.propertyId}`;
  startTrace(traceLabel);
  try {
    const targetsRes = await fetchAnnouncementTargets(input.propertyId);
    const allResidents = targetsRes.ok ? targetsRes.data.residents : [];
    const matchingRecipients =
      input.audience === 'all'
        ? allResidents
        : allResidents.filter(
            (r) =>
              normalizeRoomCode(r.roomNumber).toLowerCase() ===
              normalizedRoom!.toLowerCase()
          );

    let pushDeliveredVia: SendAnnouncementResult['pushDeliveredVia'] = 'not_applicable';
    if (input.channel === 'push') {
      try {
        await invokeEdgeFunction('send-announcement', {
          property_id: input.propertyId,
          property_name: input.propertyName,
          title,
          message,
          audience: input.audience,
          room_number: normalizedRoom,
          recipient_profile_ids: matchingRecipients
            .map((r) => r.profileId)
            .filter(Boolean),
        });
        pushDeliveredVia = 'edge_function';
      } catch {
        pushDeliveredVia = 'local_fallback';
      }
    }

    const nowIso = new Date().toISOString();
    const fallbackId = `local-${Date.now()}`;
    let savedItem: AnnouncementItem = {
      id: fallbackId,
      propertyId: input.propertyId,
      title,
      message,
      audience: input.audience,
      roomNumber: normalizedRoom,
      channel: input.channel,
      recipientCount: matchingRecipients.length,
      createdAt: nowIso,
    };

    const { data: inserted, error: insertErr } = await supabase
      .from('announcements')
      .insert({
        property_id: input.propertyId,
        owner_id: input.ownerId,
        title,
        message,
        audience: input.audience,
        room_number: normalizedRoom,
        channel: input.channel,
        recipient_count: matchingRecipients.length,
      })
      .select(
        'id, property_id, title, message, audience, room_number, channel, recipient_count, created_at'
      )
      .single();
    recordRoundTrip(traceLabel, 1);

    if (insertErr) {
      if (!isMissingAnnouncementsSchema(insertErr)) {
        return fail(insertErr, 'Could not save announcement.');
      }
      const existingLocal = await readLocalAnnouncements(input.propertyId);
      await writeLocalAnnouncements(input.propertyId, [savedItem, ...existingLocal]);
    } else if (inserted) {
      savedItem = {
        id: inserted.id,
        propertyId: inserted.property_id,
        title: inserted.title,
        message: inserted.message,
        audience: inserted.audience,
        roomNumber: inserted.room_number,
        channel: inserted.channel,
        recipientCount: inserted.recipient_count,
        createdAt: inserted.created_at,
      };
    }

    await invalidatePrefix(ANNOUNCEMENTS_CACHE_PREFIX);

    const audienceTag =
      input.audience === 'all'
        ? input.propertyName
        : `${input.propertyName} (${formatRoomLabel(normalizedRoom)})`;
    const whatsappMessage = `*${title}*\n${audienceTag}\n\n${message}`;
    const whatsappRecipients: WhatsAppRecipientLink[] = matchingRecipients.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      phoneNumber: r.phoneNumber,
      url: r.phoneNumber ? buildWhatsAppReminderUrl(r.phoneNumber, whatsappMessage) : null,
    }));

    return ok({
      item: savedItem,
      pushDeliveredVia,
      whatsappMessage,
      whatsappRecipients,
    });
  } catch (err) {
    return fail(err, 'Failed to send announcement.');
  } finally {
    endTrace(traceLabel);
  }
}
