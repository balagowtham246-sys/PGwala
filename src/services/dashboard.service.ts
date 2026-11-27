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
  expected_return_date?: string | null;
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
  curfew_time?: string | null;
  owner_phone?: string | null;
  owner_name?: string | null;
  property?: {
    id: string;
    name: string;
    address: string | null;
    owner_id?: string | null;
    curfew_time?: string | null;
  } | null;
}

export interface ResidentFoodMenu {
  id: string;
  meal_type: MealType;
  items: string;
  notes: string | null;
  is_published: boolean;
  meal_time?: string | null;
}

export interface ResidentMovementRecord {
  id: string;
  direction: 'IN' | 'OUT';
  event_time: string;
  purpose: string | null;
  expected_return_time: string | null;
  expected_return_date?: string | null;
  food_required: boolean;
  note: string | null;
}

export interface StudentDashboardData {
  resident: ResidentAccommodationInfo | null;
  menus: Record<MealType, ResidentFoodMenu | null>;
  pendingDuesPaise: number | null;
  pendingRentPaise?: number | null;
  pendingEbPaise?: number | null;
  pendingReviewPaise?: number | null;
  currentMonthBillGenerated?: boolean;
  latestMovement: ResidentMovementRecord | null;
  hasUnreadChat: boolean;
}

export interface RecordStudentMovementInput {
  direction: 'IN' | 'OUT';
  purpose?: string;
  expectedReturnTime?: string;
  expectedReturnDate?: string | null;
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
    // Fast Path: Single-roundtrip composite SQL RPC (includes rent totals + pending proofs when migration 28 is deployed)
    const summaryResult = await supabase.rpc('get_owner_dashboard_summary', {
      p_property_id: propertyId,
      p_date: todayIsoDate,
    });
    recordRoundTrip(traceLabel, 1);

    const { data: summaryRpc, error: rpcError } = summaryResult;
    const rpcHasBillingStats =
      !rpcError &&
      summaryRpc?.success &&
      typeof summaryRpc.stats?.rentTotalPaise === 'number' &&
      typeof summaryRpc.stats?.pendingProofsCount === 'number';

    let rentCollectedPaise = rpcHasBillingStats
      ? (summaryRpc.stats.rentCollectedPaise ?? 0)
      : 0;
    let rentTotalPaise = rpcHasBillingStats
      ? (summaryRpc.stats.rentTotalPaise ?? 0)
      : 0;
    let unpaidResidentsCount = rpcHasBillingStats
      ? (summaryRpc.stats.unpaidResidentsCount ?? 0)
      : 0;
    let pendingProofsCount = rpcHasBillingStats
      ? (summaryRpc.stats.pendingProofsCount ?? 0)
      : 0;

    if (!rpcHasBillingStats) {
      const [chargesResult, pendingReportsResult] = await Promise.all([
        supabase
          .from('charges')
          .select('resident_id, amount_paise, status')
          .eq('property_id', propertyId)
          .eq('billing_period_start', currentMonthStartIso)
          .eq('category', 'rent'),
        supabase
          .from('student_payment_reports')
          .select(
            'id, charge_id, resident:residents!inner(is_active), charge:charges!inner(status, billing_period_start)',
            { count: 'exact' }
          )
          .eq('property_id', propertyId)
          .eq('status', 'pending'),
      ]);
      recordRoundTrip(traceLabel, 2);

      if (!chargesResult.error && chargesResult.data) {
        const unpaidResidentIds = new Set<string>();
        let fallbackUnpaidCount = 0;
        for (const ch of chargesResult.data as {
          resident_id?: string | null;
          amount_paise: number | null;
          status: string;
        }[]) {
          const amt = ch.amount_paise || 0;
          rentTotalPaise += amt;
          if (ch.status === 'paid' || ch.status === 'settled') {
            rentCollectedPaise += amt;
          } else if (ch.resident_id) {
            unpaidResidentIds.add(ch.resident_id);
          } else {
            fallbackUnpaidCount += 1;
          }
        }
        unpaidResidentsCount = unpaidResidentIds.size + fallbackUnpaidCount;
      }

      if (!pendingReportsResult.error && Array.isArray(pendingReportsResult.data)) {
        pendingProofsCount = (
          pendingReportsResult.data as {
            charge_id?: string | null;
            resident?: { is_active?: boolean } | { is_active?: boolean }[] | null;
            charge?:
              | { status?: string; billing_period_start?: string }
              | { status?: string; billing_period_start?: string }[]
              | null;
          }[]
        ).filter((row) => {
          const res = Array.isArray(row.resident) ? row.resident[0] : row.resident;
          const chg = Array.isArray(row.charge) ? row.charge[0] : row.charge;
          return (
            Boolean(row.charge_id) &&
            res?.is_active === true &&
            chg?.status === 'outstanding' &&
            chg?.billing_period_start === currentMonthStartIso
          );
        }).length;
      } else if (!pendingReportsResult.error) {
        pendingProofsCount = pendingReportsResult.count ?? 0;
      }
    }

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

function isMissingColumnError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  return (
    err.code === '42703' ||
    err.code === 'PGRST204' ||
    err.code === '42501' ||
    msg.includes('does not exist') ||
    msg.includes('column') ||
    msg.includes('permission denied')
  );
}

/**
 * Safely resolves PG curfew time (with `@pgwala_property_meta:<propertyId>` fallback)
 * and owner contact details without breaking if schema columns or RLS restrict reads.
 */
export async function fetchPropertyCurfewAndOwner(
  propertyId: string,
  initialOwnerId?: string | null,
  initialCurfew?: string | null
): Promise<{
  curfew_time: string | null;
  owner_phone: string | null;
  owner_name: string | null;
}> {
  let dbCurfew: string | null =
    typeof initialCurfew === 'string' && initialCurfew.trim() ? initialCurfew.trim() : null;
  let ownerId: string | null = initialOwnerId ?? null;
  let ownerName: string | null = null;
  let ownerPhone: string | null = null;
  let localMeta: { curfew_time?: string | null; prefer_local?: boolean } | null = null;

  try {
    const rawMeta = await AsyncStorage.getItem(`@pgwala_property_meta:${propertyId}`);
    if (rawMeta) {
      const parsed = JSON.parse(rawMeta);
      if (parsed && typeof parsed === 'object') {
        localMeta = parsed as { curfew_time?: string | null; prefer_local?: boolean };
      }
    }
  } catch {
    // Non-fatal local meta fallback
  }

  try {
    const propRes = await supabase
      .from('properties')
      .select('owner_id, curfew_time')
      .eq('id', propertyId)
      .maybeSingle();

    if (propRes && !propRes.error && propRes.data) {
      const row = propRes.data as { owner_id?: string | null; curfew_time?: string | null };
      if (row.owner_id) ownerId = row.owner_id;
      if (typeof row.curfew_time === 'string' && row.curfew_time.trim()) {
        dbCurfew = row.curfew_time.trim();
      }
    } else if (propRes?.error && !ownerId) {
      const basicPropRes = await supabase
        .from('properties')
        .select('owner_id')
        .eq('id', propertyId)
        .maybeSingle();
      if (basicPropRes && !basicPropRes.error && basicPropRes.data) {
        const row = basicPropRes.data as { owner_id?: string | null };
        if (row.owner_id) ownerId = row.owner_id;
      }
    }
  } catch {
    // Non-fatal: e.g. when properties table is mocked or restricted
  }

  if (ownerId) {
    try {
      const ownerRes = await supabase
        .from('profiles')
        .select('full_name, phone_number')
        .eq('id', ownerId)
        .maybeSingle();
      if (ownerRes && !ownerRes.error && ownerRes.data) {
        const ownerRow = ownerRes.data as {
          full_name?: string | null;
          phone_number?: string | null;
        };
        ownerName = ownerRow.full_name ?? null;
        ownerPhone = ownerRow.phone_number ?? null;
      }
    } catch {
      // Non-fatal: e.g. when profiles table is mocked or restricted
    }
  }

  const localCurfew =
    typeof localMeta?.curfew_time === 'string' && localMeta.curfew_time.trim()
      ? localMeta.curfew_time.trim()
      : null;

  const resolvedCurfew = localMeta?.prefer_local
    ? localCurfew
    : (dbCurfew ?? localCurfew);

  return {
    curfew_time: resolvedCurfew,
    owner_phone: ownerPhone,
    owner_name: ownerName,
  };
}

const MEAL_TIME_STORAGE_PREFIX = '@pgwala_meal_time:';
const MEAL_SLOTS: MealType[] = ['breakfast', 'lunch', 'dinner'];

async function readLocalMealTimeSafe(
  propertyId: string,
  dateIso: string,
  mealType: MealType
): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(
      `${MEAL_TIME_STORAGE_PREFIX}${propertyId}:${dateIso}:${mealType}`
    );
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('{') || trimmed.startsWith('"')) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (typeof parsed === 'string') return parsed.trim() || null;
        if (parsed && typeof parsed === 'object') {
          const obj = parsed as { meal_time?: unknown; mealTime?: unknown; value?: unknown };
          const val = obj.meal_time ?? obj.mealTime ?? obj.value;
          return typeof val === 'string' && val.trim() ? val.trim() : null;
        }
      } catch {
        // Fallback to plain trimmed string
      }
    }
    return trimmed;
  } catch {
    return null;
  }
}

async function fetchTodayMealTimesSafe(
  propertyId: string,
  dateIso: string
): Promise<Partial<Record<MealType, string>>> {
  const merged: Partial<Record<MealType, string>> = {};
  try {
    const res = await supabase
      .from('food_menus')
      .select('meal_type, meal_time')
      .eq('property_id', propertyId)
      .eq('menu_date', dateIso)
      .eq('is_published', true);
    if (res && !res.error && Array.isArray(res.data)) {
      for (const row of res.data as { meal_type?: string | null; meal_time?: string | null }[]) {
        const mt = row.meal_type;
        const time = typeof row.meal_time === 'string' ? row.meal_time.trim() : '';
        if ((mt === 'breakfast' || mt === 'lunch' || mt === 'dinner') && time) {
          merged[mt] = time;
        }
      }
    }
  } catch {
    // Non-fatal: e.g. when food_menus is mocked or meal_time column not yet migrated
  }

  const localResults = await Promise.all(
    MEAL_SLOTS.map(async (slot) => {
      if (merged[slot]) return [slot, merged[slot]] as const;
      const local = await readLocalMealTimeSafe(propertyId, dateIso, slot);
      return [slot, local] as const;
    })
  );
  for (const [slot, val] of localResults) {
    if (val && !merged[slot]) {
      merged[slot] = val;
    }
  }
  return merged;
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

    const rawProperty = Array.isArray(resData.property)
      ? resData.property[0]
      : resData.property;
    const propertyObj = (rawProperty ?? null) as ResidentAccommodationInfo['property'];

    const residentInfo: ResidentAccommodationInfo = {
      id: resData.id,
      property_id: resData.property_id,
      profile_id: resData.profile_id,
      full_name: resData.full_name,
      room_number: resData.room_number,
      phone_number: resData.phone_number,
      is_active: resData.is_active,
      property: propertyObj,
    };

    const resolvedMenus = createEmptyResidentMenus();

    // 2. Fast Path: Composite summary RPC + outstanding dues + unread chat check + safe property/owner/meal metadata in parallel
    const fetchPendingReportsSafe = async () => {
      try {
        return await supabase
          .from('student_payment_reports')
          .select('charge_id')
          .eq('resident_id', residentInfo.id)
          .eq('status', 'pending');
      } catch {
        return { data: null, error: null };
      }
    };

    const [summaryRes, chargesRes, pendingReportsRes, latestChatRes, lastSeenIso, propertyMeta, todayMealTimes] =
      await Promise.all([
        supabase.rpc('get_student_dashboard_summary', {
          p_property_id: residentInfo.property_id,
          p_resident_id: residentInfo.id,
          p_date: todayIso,
        }),
        supabase
          .from('charges')
          .select('id, category, amount_paise')
          .eq('resident_id', residentInfo.id)
          .eq('status', 'outstanding'),
        fetchPendingReportsSafe(),
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
        fetchPropertyCurfewAndOwner(
          residentInfo.property_id,
          propertyObj?.owner_id ?? null,
          propertyObj?.curfew_time ?? null
        ),
        fetchTodayMealTimesSafe(residentInfo.property_id, todayIso),
      ]);
    recordRoundTrip(traceLabel, 3);

    residentInfo.curfew_time = propertyMeta.curfew_time;
    residentInfo.owner_phone = propertyMeta.owner_phone;
    residentInfo.owner_name = propertyMeta.owner_name;

    const pendingChargeIds = new Set<string>(
      (!pendingReportsRes.error && pendingReportsRes.data
        ? (pendingReportsRes.data as { charge_id?: string | null }[])
        : []
      )
        .map((r) => r.charge_id)
        .filter((id): id is string => Boolean(id))
    );

    let pendingDuesPaise: number | null = null;
    let pendingRentPaise: number | null = null;
    let pendingEbPaise: number | null = null;
    let pendingReviewPaise: number | null = null;
    if (!chargesRes.error && chargesRes.data) {
      let totalDue = 0;
      let totalRentDue = 0;
      let totalEbDue = 0;
      let totalReview = 0;
      for (const ch of chargesRes.data as {
        id?: string;
        category?: string | null;
        amount_paise?: number;
      }[]) {
        const amt = ch.amount_paise || 0;
        if (ch.id && pendingChargeIds.has(ch.id)) {
          totalReview += amt;
        } else {
          totalDue += amt;
          if (ch.category === 'electricity') {
            totalEbDue += amt;
          } else if (ch.category === 'rent') {
            totalRentDue += amt;
          }
        }
      }
      pendingDuesPaise = totalDue;
      pendingRentPaise = totalRentDue;
      pendingEbPaise = totalEbDue;
      pendingReviewPaise = totalReview;
    } else if (chargesRes.error) {
      console.warn('[ResidentDashboard] Dues fetch error:', chargesRes.error.message);
    }

    const hasUnreadChat = hasUnreadChatMessage(latestChatRes.data?.created_at, lastSeenIso);

    let latestGateRecord: ResidentMovementRecord | null = null;
    let currentMonthBillGenerated: boolean | undefined =
      (pendingDuesPaise !== null && pendingDuesPaise > 0) ||
      (pendingReviewPaise !== null && pendingReviewPaise > 0)
        ? true
        : undefined;

    if (!summaryRes.error && summaryRes.data?.success) {
      if (typeof summaryRes.data.currentMonthBillGenerated === 'boolean') {
        currentMonthBillGenerated = summaryRes.data.currentMonthBillGenerated;
      }
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
          expected_return_date: gateStatus.expectedReturnDate ?? null,
          food_required: Boolean(gateStatus.foodRequired ?? true),
          note: null,
        };
      }
    } else {
      // Fallback: Parallel queries if composite RPC is unavailable or returns an error
      const fetchMenusFallback = async () => {
        const richMenuRes = await supabase
          .from('food_menus')
          .select('id, meal_type, items, notes, is_published, meal_time')
          .eq('property_id', residentInfo.property_id)
          .eq('menu_date', todayIso)
          .eq('is_published', true);
        if (richMenuRes.error && isMissingColumnError(richMenuRes.error)) {
          return supabase
            .from('food_menus')
            .select('id, meal_type, items, notes, is_published')
            .eq('property_id', residentInfo.property_id)
            .eq('menu_date', todayIso)
            .eq('is_published', true);
        }
        return richMenuRes;
      };

      const [menuRes, movementRes] = await Promise.all([
        fetchMenusFallback(),
        supabase
          .from('movement_logs')
          .select('id, direction, event_time, purpose, expected_return_time, expected_return_date, food_required, note')
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

    for (const slot of MEAL_SLOTS) {
      const menuItem = resolvedMenus[slot];
      if (menuItem && !menuItem.meal_time && todayMealTimes[slot]) {
        resolvedMenus[slot] = { ...menuItem, meal_time: todayMealTimes[slot] };
      }
    }

    if (currentMonthBillGenerated === undefined) {
      try {
        const currentMonthStartIso = `${todayIso.slice(0, 7)}-01`;
        const monthBillCheck = await supabase
          .from('charges')
          .select('id')
          .eq('resident_id', residentInfo.id)
          .eq('billing_period_start', currentMonthStartIso)
          .limit(1);
        if (!monthBillCheck.error && Array.isArray(monthBillCheck.data)) {
          currentMonthBillGenerated = monthBillCheck.data.length > 0;
        }
      } catch {
        // Non-fatal fallback when query is not mocked or schema differs
      }
    }

    const dashboardData: StudentDashboardData = {
      resident: residentInfo,
      menus: resolvedMenus,
      pendingDuesPaise,
      pendingRentPaise,
      pendingEbPaise,
      pendingReviewPaise,
      currentMonthBillGenerated,
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

const inFlightGateMovements = new Map<string, Promise<ServiceResult<RecordMovementOutcome>>>();

export async function recordStudentMovement(
  input: RecordStudentMovementInput
): Promise<ServiceResult<RecordMovementOutcome>> {
  const flightKey = `${input.userId || 'anon'}:${input.direction}`;
  const existingFlight = inFlightGateMovements.get(flightKey);
  if (existingFlight) {
    return existingFlight;
  }

  const run = (async (): Promise<ServiceResult<RecordMovementOutcome>> => {
    const traceLabel = `mutation:gate_movement:${input.direction}`;
    startTrace(traceLabel);

    try {
      const isMultiDayLeave =
        input.direction === 'OUT' && Boolean(input.expectedReturnDate?.trim());
      const effectiveFoodRequired = isMultiDayLeave
        ? false
        : input.foodRequired;

      const { data, error } = await supabase.rpc('record_student_movement', {
        p_direction: input.direction,
        ...(input.purpose !== undefined ? { p_purpose: input.purpose } : {}),
        ...(input.expectedReturnTime !== undefined
          ? { p_expected_return_time: input.expectedReturnTime }
          : {}),
        ...(effectiveFoodRequired !== undefined ? { p_food_required: effectiveFoodRequired } : {}),
        ...(input.note !== undefined ? { p_note: input.note } : {}),
        ...(input.expectedReturnDate !== undefined
          ? { p_expected_return_date: input.expectedReturnDate }
          : {}),
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
        const isMultiDayLeave =
          input.direction === 'OUT' && Boolean(input.expectedReturnDate?.trim());
        const effectiveFoodRequired = isMultiDayLeave
          ? false
          : input.foodRequired;
        const payload: GateMovementOfflinePayload & Record<string, unknown> = {
          p_direction: input.direction,
          ...(input.purpose !== undefined ? { p_purpose: input.purpose } : {}),
          ...(input.expectedReturnTime !== undefined
            ? { p_expected_return_time: input.expectedReturnTime }
            : {}),
          ...(effectiveFoodRequired !== undefined ? { p_food_required: effectiveFoodRequired } : {}),
          ...(input.note !== undefined ? { p_note: input.note } : {}),
          ...(input.expectedReturnDate !== undefined
            ? { p_expected_return_date: input.expectedReturnDate }
            : {}),
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
  })();

  inFlightGateMovements.set(flightKey, run);
  try {
    return await run;
  } finally {
    inFlightGateMovements.delete(flightKey);
  }
}
