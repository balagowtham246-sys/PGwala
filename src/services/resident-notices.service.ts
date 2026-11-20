import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  alertHeadline,
  FoodAlertStatus,
  FoodMealType,
  formatFoodAlertBody,
  isFoodAlertExpired,
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
const LOCAL_MEAL_TIME_PREFIX = '@pgwala_meal_time:';
const MEAL_TYPES: readonly FoodMealType[] = ['breakfast', 'lunch', 'dinner'];

function toLocalIsoDate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function readLocalMealTime(
  propertyId: string,
  dateIso: string,
  mealType: FoodMealType
): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(
      `${LOCAL_MEAL_TIME_PREFIX}${propertyId}:${dateIso}:${mealType}`
    );
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('{') || trimmed.startsWith('"')) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (typeof parsed === 'string') return parsed.trim() || null;
        if (parsed && typeof parsed === 'object') {
          const obj = parsed as {
            meal_time?: unknown;
            mealTime?: unknown;
            value?: unknown;
          };
          const val = obj.meal_time ?? obj.mealTime ?? obj.value;
          return typeof val === 'string' && val.trim() ? val.trim() : null;
        }
      } catch {
        // Fall back to plain string value
      }
    }
    return trimmed;
  } catch {
    return null;
  }
}

async function fetchTodayMealTimes(
  propertyId: string,
  todayIso: string
): Promise<Partial<Record<FoodMealType, string>>> {
  const merged: Partial<Record<FoodMealType, string>> = {};
  try {
    const res = await supabase
      .from('food_menus')
      .select('meal_type, meal_time')
      .eq('property_id', propertyId)
      .eq('menu_date', todayIso);
    if (!res.error && Array.isArray(res.data)) {
      for (const row of res.data as {
        meal_type?: string | null;
        meal_time?: string | null;
      }[]) {
        const mt = row.meal_type;
        const time = typeof row.meal_time === 'string' ? row.meal_time.trim() : '';
        if ((mt === 'breakfast' || mt === 'lunch' || mt === 'dinner') && time) {
          merged[mt] = time;
        }
      }
    }
  } catch {
    // Ignore missing columns / unmigrated DBs / mock rejections gracefully
  }

  const localFallbacks = await Promise.all(
    MEAL_TYPES.map(async (mealType) => {
      if (merged[mealType]) return [mealType, merged[mealType]] as const;
      const local = await readLocalMealTime(propertyId, todayIso, mealType);
      return [mealType, local] as const;
    })
  );
  for (const [mealType, val] of localFallbacks) {
    if (val && !merged[mealType]) {
      merged[mealType] = val;
    }
  }
  return merged;
}

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
    const todayIso = toLocalIsoDate();
    const [announcementsRes, localAnnouncements, foodRes, mealTimes, readSet] =
      await Promise.all([
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
        fetchTodayMealTimes(propertyId, todayIso),
        getReadSet(userId, propertyId),
      ]);
    recordRoundTrip(traceLabel, 3);

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
        const mealTime = mealTimes[row.meal_type] ?? null;
        const expired = isFoodAlertExpired(row.meal_type, row.created_at);
        items.push({
          id: noticeId,
          type: 'food_alert',
          title: alertHeadline(row.meal_type, row.status),
          message: formatFoodAlertBody(
            row.meal_type,
            row.status,
            row.message,
            mealTime
          ),
          timestamp: row.created_at,
          isRead: expired || readSet.has(noticeId),
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
