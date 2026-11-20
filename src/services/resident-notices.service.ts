import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  alertHeadline,
  FoodAlertStatus,
  FoodMealType,
} from '@/lib/food-alert-utils';
import { endTrace, recordRoundTrip, startTrace } from '@/lib/perf-monitor';
import { getCachedEntry, invalidatePrefix, setCached } from '@/lib/query-cache';
import { fail, ok, ServiceResult } from '@/lib/service-result';
import { supabase } from '@/lib/supabase';
import { formatRoomLabel, normalizeRoomCode } from '@/lib/ux-utils';

export type ResidentNoticeType = 'announcement' | 'food_alert';
export type ResidentNoticesFilter = 'all' | 'notices' | 'food';

export interface ResidentNoticeItem {
  id: string;
  type: ResidentNoticeType;
  title: string;
  message: string;
  timestamp: string;
  isRead: boolean;
  audienceLabel?: string;
  mealStatus?: FoodAlertStatus;
}

export interface ResidentUnreadNoticesSummary {
  unreadCount: number;
  latestUnreadAnnouncement: ResidentNoticeItem | null;
}

export const RESIDENT_NOTICES_CACHE_PREFIX = 'resident-notices:';
const READ_IDS_PREFIX = '@pgwala_resident_notices_read:';
const LOCAL_ANNOUNCEMENTS_PREFIX = '@pgwala_announcements:';

function readIdsKey(userId: string, propertyId: string): string {
  return `${READ_IDS_PREFIX}${userId}:${propertyId}`;
}

function isMissingNoticeSchema(err: { code?: string; message?: string } | null): boolean {
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

async function getReadSet(userId: string, propertyId: string): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(readIdsKey(userId, propertyId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed as string[]) : new Set();
  } catch {
    return new Set();
  }
}

async function saveReadSet(
  userId: string,
  propertyId: string,
  ids: Set<string>
): Promise<void> {
  try {
    const capped = Array.from(ids).slice(-400);
    await AsyncStorage.setItem(readIdsKey(userId, propertyId), JSON.stringify(capped));
  } catch {
    // Non-fatal local storage write
  }
}

interface StoredLocalAnnouncement {
  id: string;
  propertyId: string;
  title: string;
  message: string;
  audience: 'all' | 'room';
  roomNumber: string | null;
  createdAt: string;
}

async function readLocalAnnouncements(propertyId: string): Promise<StoredLocalAnnouncement[]> {
  try {
    const raw = await AsyncStorage.getItem(`${LOCAL_ANNOUNCEMENTS_PREFIX}${propertyId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredLocalAnnouncement[]) : [];
  } catch {
    return [];
  }
}

function matchesResidentRoom(
  audience: string,
  targetRoom: string | null | undefined,
  residentRoomCode: string
): boolean {
  if (audience !== 'room') return true;
  const cleanTarget = normalizeRoomCode(targetRoom).toLowerCase();
  const cleanResident = normalizeRoomCode(residentRoomCode).toLowerCase();
  if (!cleanTarget || !cleanResident) return false;
  return cleanTarget === cleanResident;
}

export async function fetchResidentNotices(
  userId: string,
  propertyId: string,
  roomNumber: string,
  options?: { forceRefresh?: boolean }
): Promise<ServiceResult<ResidentNoticeItem[]>> {
  if (!userId || !propertyId) {
    return ok([]);
  }

  const cacheKey = `${RESIDENT_NOTICES_CACHE_PREFIX}${userId}:${propertyId}`;
  if (!options?.forceRefresh) {
    const entry = await getCachedEntry<ResidentNoticeItem[]>(cacheKey);
    if (entry && !entry.isStale) {
      return ok(entry.data);
    }
  }

  const traceLabel = `resident-notices:fetch:${propertyId}`;
  startTrace(traceLabel);
  try {
    const [announcementsRes, localAnnouncements, foodRes, readSet] = await Promise.all([
      supabase
        .from('announcements')
        .select('id, property_id, title, message, audience, room_number, created_at')
        .eq('property_id', propertyId)
        .order('created_at', { ascending: false })
        .limit(30),
      readLocalAnnouncements(propertyId),
      supabase
        .from('food_alerts')
        .select('id, meal_type, status, message, created_at')
        .order('created_at', { ascending: false })
        .limit(30),
      getReadSet(userId, propertyId),
    ]);
    recordRoundTrip(traceLabel, 2);

    const annFailed = announcementsRes.error && !isMissingNoticeSchema(announcementsRes.error);
    const foodFailed = foodRes.error && !isMissingNoticeSchema(foodRes.error);
    if (annFailed && foodFailed) {
      return fail(announcementsRes.error, 'Could not load notices.');
    }

    const items: ResidentNoticeItem[] = [];
    const seenAnnIds = new Set<string>();

    if (!announcementsRes.error && announcementsRes.data) {
      for (const row of announcementsRes.data as {
        id: string;
        title: string;
        message: string;
        audience: 'all' | 'room';
        room_number: string | null;
        created_at: string;
      }[]) {
        if (!matchesResidentRoom(row.audience, row.room_number, roomNumber)) continue;
        const noticeId = `announcement:${row.id}`;
        seenAnnIds.add(row.id);
        items.push({
          id: noticeId,
          type: 'announcement',
          title: row.title,
          message: row.message,
          timestamp: row.created_at,
          isRead: readSet.has(noticeId),
          audienceLabel:
            row.audience === 'room' && row.room_number
              ? formatRoomLabel(row.room_number)
              : 'All residents',
        });
      }
    }

    for (const row of localAnnouncements) {
      if (seenAnnIds.has(row.id)) continue;
      if (!matchesResidentRoom(row.audience, row.roomNumber, roomNumber)) continue;
      const noticeId = `announcement:${row.id}`;
      items.push({
        id: noticeId,
        type: 'announcement',
        title: row.title,
        message: row.message,
        timestamp: row.createdAt,
        isRead: readSet.has(noticeId),
        audienceLabel:
          row.audience === 'room' && row.roomNumber
            ? formatRoomLabel(row.roomNumber)
            : 'All residents',
      });
    }

    if (!foodRes.error && foodRes.data) {
      for (const row of foodRes.data as {
        id: string;
        meal_type: FoodMealType;
        status: FoodAlertStatus;
        message: string | null;
        created_at: string;
      }[]) {
        const noticeId = `food:${row.id}`;
        items.push({
          id: noticeId,
          type: 'food_alert',
          title: alertHeadline(row.meal_type, row.status),
          message: row.message?.trim() || 'Meal schedule update from PG management.',
          timestamp: row.created_at,
          isRead: readSet.has(noticeId),
          mealStatus: row.status,
        });
      }
    }

    items.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    await setCached(cacheKey, items, 20_000);
    return ok(items);
  } catch (err) {
    return fail(err, 'Failed to load resident notices.');
  } finally {
    endTrace(traceLabel);
  }
}

export async function getUnreadResidentNoticesSummary(
  userId: string,
  propertyId: string,
  roomNumber: string
): Promise<ResidentUnreadNoticesSummary> {
  const res = await fetchResidentNotices(userId, propertyId, roomNumber);
  if (!res.ok) {
    return { unreadCount: 0, latestUnreadAnnouncement: null };
  }
  const unread = res.data.filter((item) => !item.isRead);
  const latestUnreadAnnouncement =
    unread.find((item) => item.type === 'announcement') ?? null;
  return {
    unreadCount: unread.length,
    latestUnreadAnnouncement,
  };
}

export async function markResidentNoticeRead(
  userId: string,
  propertyId: string,
  noticeId: string
): Promise<void> {
  const set = await getReadSet(userId, propertyId);
  if (!set.has(noticeId)) {
    set.add(noticeId);
    await saveReadSet(userId, propertyId, set);
  }
  await invalidatePrefix(RESIDENT_NOTICES_CACHE_PREFIX);
}

export async function markAllResidentNoticesRead(
  userId: string,
  propertyId: string,
  noticeIds: string[]
): Promise<void> {
  const set = await getReadSet(userId, propertyId);
  for (const id of noticeIds) {
    set.add(id);
  }
  await saveReadSet(userId, propertyId, set);
  await invalidatePrefix(RESIDENT_NOTICES_CACHE_PREFIX);
}
