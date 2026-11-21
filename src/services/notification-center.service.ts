import AsyncStorage from '@react-native-async-storage/async-storage';

import { endTrace, recordRoundTrip, startTrace } from '@/lib/perf-monitor';
import { getCachedEntry, invalidatePrefix, setCached } from '@/lib/query-cache';
import { fail, ok, ServiceResult } from '@/lib/service-result';
import { supabase } from '@/lib/supabase';
import { formatRoomLabel, toSentenceCaseStatus } from '@/lib/ux-utils';

export type InboxItemType = 'gate_exit' | 'gate_entry' | 'complaint';
export type InboxFilterTab = 'all' | 'gate' | 'complaints';

export interface InboxItem {
  id: string;
  type: InboxItemType;
  title: string;
  subtitle: string;
  timestamp: string;
  isRead: boolean;
  priority?: string;
  routeTarget: '/resident-profile' | '/student-in-out' | '/owner-complaints';
  residentId?: string;
  residentName?: string;
  roomNumber?: string;
}

export const INBOX_CACHE_PREFIX = 'inbox:';
const READ_IDS_PREFIX = '@pgwala_inbox_read_ids:';

function readIdsKey(ownerId: string, propertyId: string): string {
  return `${READ_IDS_PREFIX}${ownerId}:${propertyId}`;
}

async function getReadSet(ownerId: string, propertyId: string): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(readIdsKey(ownerId, propertyId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed as string[]) : new Set();
  } catch {
    return new Set();
  }
}

async function saveReadSet(
  ownerId: string,
  propertyId: string,
  ids: Set<string>
): Promise<void> {
  try {
    const capped = Array.from(ids).slice(-400);
    await AsyncStorage.setItem(readIdsKey(ownerId, propertyId), JSON.stringify(capped));
  } catch {
    // Non-fatal local persistence
  }
}

function unwrapResident(
  raw:
    | { id: string; full_name: string; room_number: string }
    | { id: string; full_name: string; room_number: string }[]
    | null
): { id: string; full_name: string; room_number: string } | null {
  if (!raw) return null;
  return Array.isArray(raw) ? raw[0] ?? null : raw;
}

export interface InboxPage {
  items: InboxItem[];
  hasMore: boolean;
}

const DEFAULT_INBOX_PAGE_SIZE = 30;

export async function fetchOwnerInboxPage(
  ownerId: string,
  propertyId: string,
  options?: { forceRefresh?: boolean; pageSize?: number; offset?: number }
): Promise<ServiceResult<InboxPage>> {
  if (!ownerId || !propertyId) {
    return ok({ items: [], hasMore: false });
  }

  const pageSize = Math.max(1, options?.pageSize ?? DEFAULT_INBOX_PAGE_SIZE);
  const offset = Math.max(0, options?.offset ?? 0);
  const isFirstPage = offset === 0 && pageSize === DEFAULT_INBOX_PAGE_SIZE;

  const cacheKey = `${INBOX_CACHE_PREFIX}${ownerId}:${propertyId}`;
  if (isFirstPage && !options?.forceRefresh) {
    const entry = await getCachedEntry<InboxItem[]>(cacheKey);
    if (entry && !entry.isStale) {
      return ok({
        items: entry.data,
        hasMore: entry.data.length >= pageSize,
      });
    }
  }

  const traceLabel = `inbox:fetch:${propertyId}:${offset}`;
  startTrace(traceLabel);
  try {
    const rangeEnd = offset + pageSize - 1;
    const [logsRes, complaintsRes, readSet] = await Promise.all([
      supabase
        .from('movement_logs')
        .select(
          'id, resident_id, direction, purpose, event_time, residents(id, full_name, room_number)'
        )
        .eq('property_id', propertyId)
        .order('event_time', { ascending: false })
        .range(offset, rangeEnd),
      supabase
        .from('complaints')
        .select(
          'id, resident_id, title, category, priority, status, created_at, residents(id, full_name, room_number)'
        )
        .eq('property_id', propertyId)
        .neq('status', 'resolved')
        .order('created_at', { ascending: false })
        .range(offset, rangeEnd),
      getReadSet(ownerId, propertyId),
    ]);
    recordRoundTrip(traceLabel, 2);

    if (logsRes.error && complaintsRes.error) {
      return fail(logsRes.error, 'Could not load notifications.');
    }

    const items: InboxItem[] = [];
    const logsCount = !logsRes.error && logsRes.data ? logsRes.data.length : 0;
    const complaintsCount =
      !complaintsRes.error && complaintsRes.data ? complaintsRes.data.length : 0;

    if (!logsRes.error && logsRes.data) {
      for (const row of logsRes.data as {
        id: string;
        resident_id: string | null;
        direction: 'IN' | 'OUT';
        purpose?: string | null;
        event_time: string;
        residents:
          | { id: string; full_name: string; room_number: string }
          | { id: string; full_name: string; room_number: string }[]
          | null;
      }[]) {
        const resInfo = unwrapResident(row.residents);
        const residentName = resInfo?.full_name || 'Resident';
        const roomNumber = resInfo?.room_number || '';
        const roomTag = roomNumber ? ` (${formatRoomLabel(roomNumber)})` : '';
        const isExit = row.direction === 'OUT';
        const id = `gate:${row.id}`;
        items.push({
          id,
          type: isExit ? 'gate_exit' : 'gate_entry',
          title: `${residentName}${roomTag} checked ${isExit ? 'out' : 'in'}`,
          subtitle: isExit
            ? row.purpose
              ? `Checked out · ${row.purpose}`
              : 'Left the PG premises'
            : 'Entered the PG premises',
          timestamp: row.event_time,
          isRead: readSet.has(id),
          routeTarget: row.resident_id ? '/resident-profile' : '/student-in-out',
          residentId: row.resident_id ?? undefined,
          residentName,
          roomNumber: roomNumber || undefined,
        });
      }
    }

    if (!complaintsRes.error && complaintsRes.data) {
      for (const row of complaintsRes.data as {
        id: string;
        resident_id: string | null;
        title: string;
        category: string;
        priority: string;
        status: string;
        created_at: string;
        residents:
          | { id: string; full_name: string; room_number: string }
          | { id: string; full_name: string; room_number: string }[]
          | null;
      }[]) {
        const resInfo = unwrapResident(row.residents);
        const residentName = resInfo?.full_name || 'Resident';
        const roomNumber = resInfo?.room_number || '';
        const roomTag = roomNumber ? ` (${formatRoomLabel(roomNumber)})` : '';
        const id = `complaint:${row.id}`;
        const statusLabel = toSentenceCaseStatus(row.status);
        const priorityLabel = toSentenceCaseStatus(row.priority);
        items.push({
          id,
          type: 'complaint',
          title: row.title,
          subtitle: `${residentName}${roomTag} · ${statusLabel}`,
          timestamp: row.created_at,
          isRead: readSet.has(id),
          priority: priorityLabel,
          routeTarget: '/owner-complaints',
          residentId: row.resident_id ?? undefined,
          residentName,
          roomNumber: roomNumber || undefined,
        });
      }
    }

    items.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    if (isFirstPage) {
      await setCached(cacheKey, items, 20_000);
    }
    return ok({
      items,
      hasMore: logsCount >= pageSize || complaintsCount >= pageSize,
    });
  } catch (err) {
    return fail(err, 'Failed to load notification center.');
  } finally {
    endTrace(traceLabel);
  }
}

export async function fetchOwnerInbox(
  ownerId: string,
  propertyId: string,
  options?: { forceRefresh?: boolean }
): Promise<ServiceResult<InboxItem[]>> {
  const pageRes = await fetchOwnerInboxPage(ownerId, propertyId, options);
  if (!pageRes.ok) {
    return fail(pageRes.error, pageRes.error.message);
  }
  return ok(pageRes.data.items);
}

export async function getUnreadInboxCount(
  ownerId: string,
  propertyId: string
): Promise<number> {
  const res = await fetchOwnerInbox(ownerId, propertyId);
  if (!res.ok) return 0;
  return res.data.filter((item) => !item.isRead).length;
}

export async function markInboxItemRead(
  ownerId: string,
  propertyId: string,
  itemId: string
): Promise<void> {
  const set = await getReadSet(ownerId, propertyId);
  if (!set.has(itemId)) {
    set.add(itemId);
    await saveReadSet(ownerId, propertyId, set);
  }
  await invalidatePrefix(INBOX_CACHE_PREFIX);
}

export async function markAllInboxRead(
  ownerId: string,
  propertyId: string,
  itemIds: string[]
): Promise<void> {
  const set = await getReadSet(ownerId, propertyId);
  for (const id of itemIds) {
    set.add(id);
  }
  await saveReadSet(ownerId, propertyId, set);
  await invalidatePrefix(INBOX_CACHE_PREFIX);
}
