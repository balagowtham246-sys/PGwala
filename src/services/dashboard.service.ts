import AsyncStorage from '@react-native-async-storage/async-storage';

import { endTrace, recordRoundTrip, startTrace } from '@/lib/perf-monitor';
import { enqueueOfflineMutation } from '@/lib/offline-queue';
import { getCached, invalidatePrefix, setCached } from '@/lib/query-cache';
import { getChatLastSeenStorageKey, hasUnreadChatMessage } from '@/lib/resident-home-utils';
import { fail, isLikelyNetworkError, ok, ServiceResult } from '@/lib/service-result';
import { supabase } from '@/lib/supabase';
import { formatGateEventTimestamp } from '@/lib/ux-utils';
import { GateMovementOfflinePayload } from '@/services/offline-executors';

export type MealType = 'breakfast' | 'lunch' | 'dinner';

// --- Owner Dashboard Types ---
interface ResidentRecord {
  id: string;
  full_name: string;
  room_number: string;
  property_id: string;
  is_active: boolean;
}

interface MovementLogRecord {
  id: string;
  resident_id: string;
  property_id?: string;
  direction: 'IN' | 'OUT';
  event_time: string;
  note: string | null;
  purpose?: string | null;
  expected_return_time?: string | null;
  food_required?: boolean;
}

export interface OwnerActivityItem {
  id: string;
  residentId?: string;
  residentName: string;
  roomNumber: string;
  direction: 'IN' | 'OUT';
  purpose: string | null;
  time: string;
}

type RawRpcActivity = OwnerActivityItem & {
  resident_id?: string;
  eventTime?: string;
  event_time?: string;
};

async function fetchRecentMovementMapSafe(
  propertyId: string,
  limitCount: number
): Promise<
  Map<
    string,
    {
      resident_id: string;
      direction: 'IN' | 'OUT';
      purpose: string | null;
      event_time: string;
    }
  >
> {
  const byId = new Map<
    string,
    {
      resident_id: string;
      direction: 'IN' | 'OUT';
      purpose: string | null;
      event_time: string;
    }
  >();
  try {
    const res = await supabase
      .from('movement_logs')
      .select('id, resident_id, direction, purpose, event_time')
      .eq('property_id', propertyId)
      .order('event_time', { ascending: false })
      .limit(limitCount);

    if (res && !res.error && Array.isArray(res.data)) {
      for (const row of res.data as {
        id: string;
        resident_id: string;
        direction: 'IN' | 'OUT';
        purpose: string | null;
        event_time: string;
      }[]) {
        byId.set(row.id, {
          resident_id: row.resident_id,
          direction: row.direction,
          purpose: row.purpose ?? null,
          event_time: row.event_time,
        });
      }
    }
  } catch {
    // Non-fatal: e.g. when movement_logs is not mocked in unit tests
  }
  return byId;
}

export interface OwnerFoodMenuRecord {
  id: string;
  meal_type: MealType;
  items: string;
  notes: string | null;
  is_published: boolean;
}

export interface DashboardWmUnit {
  id: string;
  property_id: string;
  machine_number: number;
  machine_name: string;
  is_active: boolean;
  status: 'free' | 'in_use' | 'out_of_order';
  current_resident_id: string | null;
  current_resident_name: string | null;
  current_resident_room: string | null;
  started_at: string | null;
  updated_at: string;
}

export interface OwnerDashboardStats {
  totalResidents: number;
  studentsInside: number;
  studentsOutside: number;
  openComplaintsCount: number;
  rentCollectedPaise: number;
  rentTotalPaise: number;
  pendingProofsCount: number;
  unpaidResidentsCount?: number;
}

export interface OwnerWmSummary {
  totalCount: number;
  inUseCount: number;
  freeCount: number;
  outOfOrderCount?: number;
}

export interface OwnerDashboardData {
  stats: OwnerDashboardStats;
  todayMenus: Record<MealType, OwnerFoodMenuRecord | null>;
  recentActivities: OwnerActivityItem[];
  wmSummary: OwnerWmSummary;
  wmUnits: DashboardWmUnit[];
}

// --- Student Dashboard Types ---
export interface ResidentAccommodationInfo {
  id: string;
  property_id: string;
  profile_id: string;
  full_name: string;
  room_number: string;
  phone_number: string | null;
  is_active: boolean;
  property?: {
    id: string;
    name: string;
    address: string | null;
  } | null;
}

export interface ResidentFoodMenu {
  id: string;
  meal_type: MealType;
  items: string;
  notes: string | null;
  is_published: boolean;
}

export interface ResidentMovementRecord {
  id: string;
  direction: 'IN' | 'OUT';
  event_time: string;
  purpose: string | null;
  expected_return_time: string | null;
  food_required: boolean;
  note: string | null;
}

export interface StudentDashboardData {
  resident: ResidentAccommodationInfo | null;
  menus: Record<MealType, ResidentFoodMenu | null>;
  pendingDuesPaise: number | null;
  latestMovement: ResidentMovementRecord | null;
  hasUnreadChat: boolean;
}

export interface RecordStudentMovementInput {
  direction: 'IN' | 'OUT';
  purpose?: string;
  expectedReturnTime?: string;
  foodRequired?: boolean;
  note?: string;
  userId?: string;
  idempotencyKey?: string;
}

export type RecordMovementOutcome = { queued: false } | { queued: true };

// --- Helpers & Cache Keys ---
export function toLocalIsoDate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function createEmptyOwnerMenus(): Record<MealType, OwnerFoodMenuRecord | null> {
  return {
    breakfast: null,
    lunch: null,
    dinner: null,
  };
}

export function createEmptyResidentMenus(): Record<MealType, ResidentFoodMenu | null> {
  return {
    breakfast: null,
    lunch: null,
    dinner: null,
  };
}

export function ownerDashboardCacheKey(propertyId: string): string {
  return `dashboard:owner:${propertyId}`;
}

export function studentDashboardCacheKey(userId: string): string {
  return `dashboard:student:${userId}`;
}

export async function getCachedOwnerDashboard(
  propertyId: string
): Promise<OwnerDashboardData | null> {
  return getCached<OwnerDashboardData>(ownerDashboardCacheKey(propertyId));
}

export async function getCachedStudentDashboard(
  userId: string
): Promise<StudentDashboardData | null> {
  return getCached<StudentDashboardData>(studentDashboardCacheKey(userId));
}

export function wmOutOfOrderStorageKey(propertyId: string): string {
  return `@pgwala_wm_out_of_order:${propertyId}`;
}

export function wmNamesStorageKey(propertyId: string): string {
  return `@pgwala_wm_names:${propertyId}`;
}

async function readStorageRecord<T>(key: string): Promise<Record<string, T>> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, T>) : {};
  } catch {
    return {};
  }
}

async function writeWmOutOfOrderOverride(
  propertyId: string,
  machineId: string,
  outOfOrder: boolean
): Promise<void> {
  const key = wmOutOfOrderStorageKey(propertyId);
  try {
    const current = await readStorageRecord<boolean>(key);
    if (outOfOrder) {
      current[machineId] = true;
    } else {
      delete current[machineId];
    }
    if (Object.keys(current).length === 0) {
      await AsyncStorage.removeItem(key);
    } else {
      await AsyncStorage.setItem(key, JSON.stringify(current));
    }
  } catch {
    // Non-fatal fallback persistence
  }
}

function isWmConstraintOrEnumError(
  err: { code?: string; message?: string } | null
): boolean {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  return (
    err.code === '22P02' ||
    err.code === '23514' ||
    err.code === '42804' ||
    msg.includes('enum') ||
    msg.includes('constraint') ||
    msg.includes('out_of_order') ||
    msg.includes('invalid input')
  );
}

async function applyWmLocalOverrides(
  propertyId: string,
  units: DashboardWmUnit[],
  fallbackSummary: OwnerWmSummary
): Promise<{ wmUnits: DashboardWmUnit[]; wmSummary: OwnerWmSummary }> {
  if (units.length === 0) {
    return {
      wmUnits: [],
      wmSummary: {
        totalCount: fallbackSummary.totalCount,
        inUseCount: fallbackSummary.inUseCount,
        freeCount: fallbackSummary.freeCount,
        outOfOrderCount: fallbackSummary.outOfOrderCount ?? 0,
      },
    };
  }

  const [outOfOrderMap, namesMap] = await Promise.all([
    readStorageRecord<boolean>(wmOutOfOrderStorageKey(propertyId)),
    readStorageRecord<string>(wmNamesStorageKey(propertyId)),
  ]);

  const mergedUnits: DashboardWmUnit[] = units.map((unit) => {
    const customName = namesMap[unit.id] ?? namesMap[String(unit.machine_number)];
    const resolvedName =
      typeof customName === 'string' && customName.trim().length > 0
        ? customName.trim()
        : unit.machine_name;

    const isOutOfOrder =
      unit.status === 'out_of_order' ||
      Boolean(outOfOrderMap[unit.id] ?? outOfOrderMap[String(unit.machine_number)]);

    if (isOutOfOrder) {
      return {
        ...unit,
        machine_name: resolvedName,
        status: 'out_of_order',
        current_resident_id: null,
        current_resident_name: null,
        current_resident_room: null,
        started_at: null,
      };
    }

    return {
      ...unit,
      machine_name: resolvedName,
    };
  });

  return {
    wmUnits: mergedUnits,
    wmSummary: {
      totalCount: mergedUnits.length,
      inUseCount: mergedUnits.filter((u) => u.status === 'in_use').length,
      freeCount: mergedUnits.filter((u) => u.status === 'free').length,
      outOfOrderCount: mergedUnits.filter((u) => u.status === 'out_of_order').length,
    },
  };
}

// --- Owner Dashboard Service Functions ---
export async function fetchOwnerDashboard(
  propertyId: string,
  options?: { dateIso?: string; monthStartIso?: string }
): Promise<ServiceResult<OwnerDashboardData>> {
  const todayIsoDate = options?.dateIso ?? toLocalIsoDate();
  const currentMonthStartIso = options?.monthStartIso ?? `${todayIsoDate.slice(0, 7)}-01`;
  const traceLabel = ownerDashboardCacheKey(propertyId);

  startTrace(traceLabel);
  try {
    // Fast Path: Single-roundtrip composite SQL RPC + current month rent collections in parallel
    const [summaryResult, chargesResult, pendingReportsResult] = await Promise.all([
      supabase.rpc('get_owner_dashboard_summary', {
        p_property_id: propertyId,
        p_date: todayIsoDate,
      }),
      supabase
        .from('charges')
        .select('amount_paise, status')
        .eq('property_id', propertyId)
        .eq('billing_period_start', currentMonthStartIso)
        .eq('category', 'rent'),
      supabase
        .from('student_payment_reports')
        .select('id', { count: 'exact', head: true })
        .eq('property_id', propertyId)
        .eq('status', 'pending'),
    ]);
    recordRoundTrip(traceLabel, 3);

    let rentCollectedPaise = 0;
    let rentTotalPaise = 0;
    let unpaidResidentsCount = 0;
    if (!chargesResult.error && chargesResult.data) {
      for (const ch of chargesResult.data) {
        const amt = ch.amount_paise || 0;
        rentTotalPaise += amt;
        if (ch.status === 'paid') {
          rentCollectedPaise += amt;
        }
        if (ch.status !== 'paid' && ch.status !== 'settled') {
          unpaidResidentsCount += 1;
        }
      }
    }
    const pendingProofsCount = pendingReportsResult.count ?? 0;

    const { data: summaryRpc, error: rpcError } = summaryResult;

    if (!rpcError && summaryRpc?.success) {
      const stats: OwnerDashboardStats = {
        totalResidents: summaryRpc.stats?.totalResidents ?? 0,
        studentsInside: summaryRpc.stats?.studentsInside ?? 0,
        studentsOutside: summaryRpc.stats?.studentsOutside ?? 0,
        openComplaintsCount: summaryRpc.stats?.openComplaintsCount ?? 0,
        rentCollectedPaise,
        rentTotalPaise,
        pendingProofsCount,
        unpaidResidentsCount,
      };

      const menuMap = createEmptyOwnerMenus();
      if (summaryRpc.todayMenus) {
        for (const m of summaryRpc.todayMenus as OwnerFoodMenuRecord[]) {
          if (['breakfast', 'lunch', 'dinner'].includes(m.meal_type)) {
            menuMap[m.meal_type] = m;
          }
        }
      }

      const rpcWmSummary: OwnerWmSummary = summaryRpc.washingMachines
        ? {
            totalCount: summaryRpc.washingMachines.totalCount || 0,
            inUseCount: summaryRpc.washingMachines.inUseCount || 0,
            freeCount: summaryRpc.washingMachines.freeCount || 0,
            outOfOrderCount: summaryRpc.washingMachines.outOfOrderCount || 0,
          }
        : { totalCount: 0, inUseCount: 0, freeCount: 0, outOfOrderCount: 0 };

      const rawWmUnits: DashboardWmUnit[] = summaryRpc.washingMachines?.units || [];
      const { wmUnits, wmSummary } = await applyWmLocalOverrides(
        propertyId,
        rawWmUnits,
        rpcWmSummary
      );
      const rawActivities = (summaryRpc.recentActivities || []) as RawRpcActivity[];
      const needsMovementEnrichment =
        rawActivities.length > 0 &&
        rawActivities.some((item) => !(item.eventTime || item.event_time));

      const recentMovementMap = needsMovementEnrichment
        ? await fetchRecentMovementMapSafe(propertyId, Math.max(5, rawActivities.length))
        : null;

      const recentActivities: OwnerActivityItem[] = rawActivities.map((item) => {
        const matched = recentMovementMap?.get(item.id);
        const isoTime = item.eventTime ?? item.event_time ?? matched?.event_time;
        const formattedTime = isoTime ? formatGateEventTimestamp(isoTime) : '';
        const resolvedResidentId = item.residentId ?? item.resident_id ?? matched?.resident_id;

        return {
          id: item.id,
          ...(resolvedResidentId ? { residentId: resolvedResidentId } : {}),
          residentName: item.residentName,
          roomNumber: item.roomNumber,
          direction: matched?.direction ?? item.direction,
          purpose: item.purpose ?? matched?.purpose ?? null,
          time: formattedTime || item.time,
        };
      });

      const dashboardData: OwnerDashboardData = {
        stats,
        todayMenus: menuMap,
        recentActivities,
        wmSummary,
        wmUnits,
      };

      await setCached(ownerDashboardCacheKey(propertyId), dashboardData);
      return ok(dashboardData);
    }

    // Fallback: Individual queries if RPC not yet deployed
    const { data: residentsData, error: resError } = await supabase
      .from('residents')
      .select('id, full_name, room_number, property_id, is_active')
      .eq('property_id', propertyId);
    recordRoundTrip(traceLabel, 1);

    if (resError) throw resError;

    const allResidents: ResidentRecord[] = residentsData ?? [];
    const activeResidents = allResidents.filter((r) => r.is_active);
    const allResidentIds = allResidents.map((r) => r.id);

    if (allResidentIds.length === 0) {
      const emptyData: OwnerDashboardData = {
        stats: {
          totalResidents: 0,
          studentsInside: 0,
          studentsOutside: 0,
          openComplaintsCount: 0,
          rentCollectedPaise,
          rentTotalPaise,
          pendingProofsCount,
          unpaidResidentsCount: 0,
        },
        todayMenus: createEmptyOwnerMenus(),
        recentActivities: [],
        wmSummary: { totalCount: 0, inUseCount: 0, freeCount: 0, outOfOrderCount: 0 },
        wmUnits: [],
      };
      return ok(emptyData);
    }

    // 2. Fetch recent movement logs, menus, complaints, and washing machines in parallel
    const [logsRes, menuRes, compRes, wmRes] = await Promise.all([
      supabase
        .from('movement_logs')
        .select(
          'id, resident_id, property_id, direction, event_time, note, purpose, expected_return_time, food_required'
        )
        .eq('property_id', propertyId)
        .order('event_time', { ascending: false })
        .limit(60),
      supabase
        .from('food_menus')
        .select('id, meal_type, items, notes, is_published')
        .eq('property_id', propertyId)
        .eq('menu_date', todayIsoDate),
      supabase
        .from('complaints')
        .select('id')
        .eq('property_id', propertyId)
        .eq('status', 'open'),
      supabase
        .from('washing_machines')
        .select(
          'id, property_id, machine_number, machine_name, is_active, status, current_resident_id, started_at, updated_at'
        )
        .eq('property_id', propertyId)
        .eq('is_active', true)
        .order('machine_number', { ascending: true }),
    ]);
    recordRoundTrip(traceLabel, 4);

    let logsData = logsRes.data;
    const logsError = logsRes.error;

    // Backwards-compatibility fallback if property_id was not yet backfilled
    if (!logsError && (!logsData || logsData.length === 0) && allResidentIds.length > 0) {
      const { data: fallbackData } = await supabase
        .from('movement_logs')
        .select(
          'id, resident_id, property_id, direction, event_time, note, purpose, expected_return_time, food_required'
        )
        .in('resident_id', allResidentIds)
        .order('event_time', { ascending: false })
        .limit(60);
      recordRoundTrip(traceLabel, 1);

      if (fallbackData && fallbackData.length > 0) {
        logsData = fallbackData;
      }
    }

    if (logsError) throw logsError;
    const logs: MovementLogRecord[] = logsData ?? [];

    const latestStatusMap = new Map<string, MovementLogRecord>();
    for (const log of logs) {
      if (!latestStatusMap.has(log.resident_id)) {
        latestStatusMap.set(log.resident_id, log);
      }
    }

    let insideCount = 0;
    let outsideCount = 0;
    for (const res of activeResidents) {
      const latest = latestStatusMap.get(res.id);
      const direction = latest?.direction || 'IN';
      if (direction === 'IN') {
        insideCount += 1;
      } else {
        outsideCount += 1;
      }
    }

    const menuMap = createEmptyOwnerMenus();
    if (menuRes.error) {
      console.warn('[OwnerDashboard] Could not fetch food menu:', menuRes.error.message);
    } else if (menuRes.data) {
      for (const m of menuRes.data as OwnerFoodMenuRecord[]) {
        if (['breakfast', 'lunch', 'dinner'].includes(m.meal_type)) {
          menuMap[m.meal_type] = m;
        }
      }
    }

    const openComplaintsCount = compRes.data?.length ?? 0;
    if (compRes.error) {
      console.warn('[OwnerDashboard] Could not fetch complaints count:', compRes.error.message);
    }

    const residentMap = new Map<string, ResidentRecord>();
    for (const r of allResidents) {
      residentMap.set(r.id, r);
    }

    const activities: OwnerActivityItem[] = logs.slice(0, 2).map((log) => {
      const resident = residentMap.get(log.resident_id);
      const residentName = resident ? resident.full_name : 'Resident';
      const roomNumber = resident?.room_number || '';

      return {
        id: log.id,
        residentId: log.resident_id,
        residentName,
        roomNumber,
        direction: log.direction,
        purpose: log.purpose || null,
        time: formatGateEventTimestamp(log.event_time),
      };
    });

    let mappedUnits: DashboardWmUnit[] = [];
    let wmSummary: OwnerWmSummary = {
      totalCount: 0,
      inUseCount: 0,
      freeCount: 0,
      outOfOrderCount: 0,
    };

    if (wmRes.error) {
      console.warn('[OwnerDashboard] Could not fetch washing machines:', wmRes.error.message);
    } else if (wmRes.data && wmRes.data.length > 0) {
      const rawMappedUnits: DashboardWmUnit[] = wmRes.data.map((w) => {
        const res = w.current_resident_id ? residentMap.get(w.current_resident_id) : null;
        return {
          id: w.id,
          property_id: w.property_id,
          machine_number: w.machine_number,
          machine_name: w.machine_name,
          is_active: w.is_active,
          status: w.status,
          current_resident_id: w.current_resident_id,
          current_resident_name: res?.full_name || null,
          current_resident_room: res?.room_number || null,
          started_at: w.started_at,
          updated_at: w.updated_at,
        };
      });
      const merged = await applyWmLocalOverrides(propertyId, rawMappedUnits, wmSummary);
      mappedUnits = merged.wmUnits;
      wmSummary = merged.wmSummary;
    }

    const fallbackResult: OwnerDashboardData = {
      stats: {
        totalResidents: activeResidents.length,
        studentsInside: insideCount,
        studentsOutside: outsideCount,
        openComplaintsCount,
        rentCollectedPaise,
        rentTotalPaise,
        pendingProofsCount,
        unpaidResidentsCount,
      },
      todayMenus: menuMap,
      recentActivities: activities,
      wmSummary,
      wmUnits: mappedUnits,
    };

    await setCached(ownerDashboardCacheKey(propertyId), fallbackResult);
    return ok(fallbackResult);
  } catch (err: unknown) {
    return fail(err, 'Failed to load dashboard.');
  } finally {
    endTrace(traceLabel);
  }
}

export async function releaseWashingMachineUnit(
  propertyId: string,
  machineId: string
): Promise<ServiceResult<void>> {
  const traceLabel = `mutation:release-wm:${propertyId}`;
  startTrace(traceLabel);
  try {
    const { error } = await supabase.rpc('release_washing_machine_unit', {
      p_property_id: propertyId,
      p_machine_id: machineId,
    });
    recordRoundTrip(traceLabel, 1);
    if (error) {
      return fail(error, 'Failed to release washing machine.');
    }
    await invalidatePrefix(ownerDashboardCacheKey(propertyId));
    return ok(undefined);
  } catch (err: unknown) {
    return fail(err, 'Failed to release washing machine.');
  } finally {
    endTrace(traceLabel);
  }
}

export async function setWashingMachineOutOfOrder(
  propertyId: string,
  machineId: string,
  outOfOrder: boolean
): Promise<ServiceResult<void>> {
  const traceLabel = `mutation:wm-out-of-order:${propertyId}`;
  startTrace(traceLabel);
  try {
    const targetStatus = outOfOrder ? 'out_of_order' : 'free';
    const nowIso = new Date().toISOString();
    const { error } = await supabase
      .from('washing_machines')
      .update({
        status: targetStatus,
        current_resident_id: null,
        started_at: null,
        updated_at: nowIso,
      })
      .eq('id', machineId)
      .eq('property_id', propertyId);
    recordRoundTrip(traceLabel, 1);

    if (error) {
      if (outOfOrder && isWmConstraintOrEnumError(error)) {
        // DB enum/check constraint not migrated yet: clear any active wash in DB, persist local override
        const { error: resetErr } = await supabase
          .from('washing_machines')
          .update({
            status: 'free',
            current_resident_id: null,
            started_at: null,
            updated_at: nowIso,
          })
          .eq('id', machineId)
          .eq('property_id', propertyId);
        recordRoundTrip(traceLabel, 1);

        if (resetErr && isLikelyNetworkError(resetErr)) {
          return fail(resetErr, 'Failed to update washing machine status.');
        }

        await writeWmOutOfOrderOverride(propertyId, machineId, true);
        await invalidatePrefix(ownerDashboardCacheKey(propertyId));
        return ok(undefined);
      }
      return fail(error, 'Failed to update washing machine status.');
    }

    await writeWmOutOfOrderOverride(propertyId, machineId, outOfOrder);
    await invalidatePrefix(ownerDashboardCacheKey(propertyId));
    return ok(undefined);
  } catch (err: unknown) {
    return fail(err, 'Failed to update washing machine status.');
  } finally {
    endTrace(traceLabel);
  }
}

export async function fetchMovementAlertResident(
  residentId: string,
  propertyId: string
): Promise<{ id: string; full_name: string; room_number: string; property_id: string } | null> {
  const { data: res } = await supabase
    .from('residents')
    .select('id, full_name, room_number, property_id')
    .eq('id', residentId)
    .single();

  if (!res || res.property_id !== propertyId) {
    return null;
  }
  return res;
}

// --- Student Dashboard Service Functions ---
export async function fetchStudentDashboard(
  userId: string,
  options?: { dateIso?: string }
): Promise<ServiceResult<StudentDashboardData>> {
  const todayIso = options?.dateIso ?? toLocalIsoDate();
  const traceLabel = studentDashboardCacheKey(userId);
  startTrace(traceLabel);

  try {
    // 1. Fetch resident allocation record (required for property_id & resident_id)
    const { data: resData, error: resError } = await supabase
      .from('residents')
      .select(`
        id,
        property_id,
        profile_id,
        full_name,
        room_number,
        phone_number,
        is_active,
        property:properties (
          id,
          name,
          address
        )
      `)
      .eq('profile_id', userId)
      .eq('is_active', true)
      .maybeSingle();
    recordRoundTrip(traceLabel, 1);

    if (resError) throw resError;

    if (!resData) {
      return ok({
        resident: null,
        menus: createEmptyResidentMenus(),
        pendingDuesPaise: null,
        latestMovement: null,
        hasUnreadChat: false,
      });
    }

    const propertyObj = Array.isArray(resData.property)
      ? resData.property[0]
      : resData.property;

    const residentInfo: ResidentAccommodationInfo = {
      id: resData.id,
      property_id: resData.property_id,
      profile_id: resData.profile_id,
      full_name: resData.full_name,
      room_number: resData.room_number,
      phone_number: resData.phone_number,
      is_active: resData.is_active,
      property: propertyObj || null,
    };

    const resolvedMenus = createEmptyResidentMenus();

    // 2. Fast Path: Composite summary RPC + outstanding dues + unread chat check in parallel
    const [summaryRes, chargesRes, latestChatRes, lastSeenIso] = await Promise.all([
      supabase.rpc('get_student_dashboard_summary', {
        p_property_id: residentInfo.property_id,
        p_resident_id: residentInfo.id,
        p_date: todayIso,
      }),
      supabase
        .from('charges')
        .select('amount_paise')
        .eq('resident_id', residentInfo.id)
        .eq('status', 'outstanding'),
      supabase
        .from('property_chat_messages')
        .select('created_at, resident_id')
        .eq('property_id', residentInfo.property_id)
        .neq('resident_id', residentInfo.id)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      AsyncStorage.getItem(getChatLastSeenStorageKey(residentInfo.property_id)),
    ]);
    recordRoundTrip(traceLabel, 3);

    let pendingDuesPaise: number | null = null;
    if (!chargesRes.error && chargesRes.data) {
      let totalOut = 0;
      for (const ch of chargesRes.data) {
        totalOut += ch.amount_paise || 0;
      }
      pendingDuesPaise = totalOut;
    } else if (chargesRes.error) {
      console.warn('[ResidentDashboard] Dues fetch error:', chargesRes.error.message);
    }

    const hasUnreadChat = hasUnreadChatMessage(latestChatRes.data?.created_at, lastSeenIso);

    let latestGateRecord: ResidentMovementRecord | null = null;

    if (!summaryRes.error && summaryRes.data?.success) {
      const publishedMenus = (summaryRes.data.publishedMenus ?? []) as ResidentFoodMenu[];
      for (const item of publishedMenus) {
        if (['breakfast', 'lunch', 'dinner'].includes(item.meal_type)) {
          resolvedMenus[item.meal_type] = item;
        }
      }

      const gateStatus = summaryRes.data.gateStatus;
      if (gateStatus?.eventTime) {
        latestGateRecord = {
          id: 'summary-latest',
          direction: gateStatus.direction,
          event_time: gateStatus.eventTime,
          purpose: gateStatus.purpose ?? null,
          expected_return_time: gateStatus.expectedReturnTime ?? null,
          food_required: Boolean(gateStatus.foodRequired ?? true),
          note: null,
        };
      }
    } else {
      // Fallback: Parallel queries if composite RPC is unavailable or returns an error
      const [menuRes, movementRes] = await Promise.all([
        supabase
          .from('food_menus')
          .select('id, meal_type, items, notes, is_published')
          .eq('property_id', residentInfo.property_id)
          .eq('menu_date', todayIso)
          .eq('is_published', true),
        supabase
          .from('movement_logs')
          .select('id, direction, event_time, purpose, expected_return_time, food_required, note')
          .eq('resident_id', residentInfo.id)
          .order('event_time', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      recordRoundTrip(traceLabel, 2);

      if (menuRes.error) {
        console.warn('[ResidentDashboard] Could not fetch food menus:', menuRes.error.message);
      } else if (menuRes.data) {
        for (const item of menuRes.data as ResidentFoodMenu[]) {
          if (['breakfast', 'lunch', 'dinner'].includes(item.meal_type)) {
            resolvedMenus[item.meal_type] = item;
          }
        }
      }

      if (movementRes.error) {
        console.warn('[ResidentDashboard] Error fetching movement log:', movementRes.error.message);
      } else {
        latestGateRecord = (movementRes.data as ResidentMovementRecord) || null;
      }
    }

    const dashboardData: StudentDashboardData = {
      resident: residentInfo,
      menus: resolvedMenus,
      pendingDuesPaise,
      latestMovement: latestGateRecord,
      hasUnreadChat,
    };

    await setCached(studentDashboardCacheKey(userId), dashboardData);
    return ok(dashboardData);
  } catch (err: unknown) {
    return fail(err, 'Failed to load resident data.');
  } finally {
    endTrace(traceLabel);
  }
}

export async function recordStudentMovement(
  input: RecordStudentMovementInput
): Promise<ServiceResult<RecordMovementOutcome>> {
  const traceLabel = `mutation:gate_movement:${input.direction}`;
  startTrace(traceLabel);

  try {
    const { data, error } = await supabase.rpc('record_student_movement', {
      p_direction: input.direction,
      ...(input.purpose !== undefined ? { p_purpose: input.purpose } : {}),
      ...(input.expectedReturnTime !== undefined
        ? { p_expected_return_time: input.expectedReturnTime }
        : {}),
      ...(input.foodRequired !== undefined ? { p_food_required: input.foodRequired } : {}),
      ...(input.note !== undefined ? { p_note: input.note } : {}),
    });
    recordRoundTrip(traceLabel, 1);

    if (error) throw error;
    if (!data?.success) {
      throw new Error(data?.error || 'Failed to update attendance.');
    }

    await invalidatePrefix(
      input.userId ? studentDashboardCacheKey(input.userId) : 'dashboard:student:'
    );
    return ok({ queued: false });
  } catch (err: unknown) {
    if (isLikelyNetworkError(err)) {
      const payload: GateMovementOfflinePayload & Record<string, unknown> = {
        p_direction: input.direction,
        ...(input.purpose !== undefined ? { p_purpose: input.purpose } : {}),
        ...(input.expectedReturnTime !== undefined
          ? { p_expected_return_time: input.expectedReturnTime }
          : {}),
        ...(input.foodRequired !== undefined ? { p_food_required: input.foodRequired } : {}),
        ...(input.note !== undefined ? { p_note: input.note } : {}),
      };
      const key =
        input.idempotencyKey?.trim() ||
        `gate-${input.direction}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await enqueueOfflineMutation('gate_movement_log', payload, key);
      return ok({ queued: true });
    }
    return fail(err, 'Failed to update attendance.');
  } finally {
    endTrace(traceLabel);
  }
}
