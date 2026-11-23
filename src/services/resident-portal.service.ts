import AsyncStorage from '@react-native-async-storage/async-storage';

import { enqueueOfflineMutation } from '@/lib/offline-queue';
import { endTrace, recordRoundTrip, startTrace } from '@/lib/perf-monitor';
import { invalidatePrefix } from '@/lib/query-cache';
import { fail, isLikelyNetworkError, ok, ServiceResult } from '@/lib/service-result';
import { supabase } from '@/lib/supabase';
import type { MealType } from '@/services/dashboard.service';

export interface ResidentAccommodationDetails {
  residentId: string;
  propertyId: string;
  propertyName: string;
  propertyAddress: string | null;
  roomNumber: string;
  bedLabel: string | null;
  joiningDate: string | null;
  monthlyRentPaise: number;
  depositPaise: number;
  emergencyContact: string | null;
  ownerName: string | null;
  ownerPhone: string | null;
  wifiSsid: string | null;
  wifiPassword: string | null;
  curfewTime: string | null;
  wardenName: string | null;
  wardenPhone: string | null;
}

export interface ResidentMenuSlot {
  id: string;
  menu_date: string;
  meal_type: MealType;
  items: string;
  notes: string | null;
  meal_time?: string | null;
}

export type DayMenuMap = Record<MealType, ResidentMenuSlot | null>;

const STORAGE_RESIDENT_META_PREFIX = '@pgwala_resident_meta:';
const STORAGE_EMERGENCY_CONTACT_PREFIX = '@pgwala_resident_emergency_contact:';
const STORAGE_PROPERTY_META_PREFIX = '@pgwala_property_meta:';
const STORAGE_MEAL_TIME_PREFIX = '@pgwala_meal_time:';

function cleanText(val: string | null | undefined): string | null {
  const trimmed = (val || '').trim();
  return trimmed || null;
}

function isMissingSchemaOrRpc(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  return (
    err.code === '42703' ||
    err.code === '42P01' ||
    err.code === '42883' ||
    err.code === '42501' ||
    err.code === 'PGRST202' ||
    err.code === 'PGRST204' ||
    err.code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('schema cache') ||
    msg.includes('column') ||
    msg.includes('could not find the function') ||
    msg.includes('permission denied')
  );
}

async function readLocalResidentMeta(residentId: string): Promise<{
  bed_label?: string | null;
  joining_date?: string | null;
  deposit_paise?: number | null;
  emergency_contact?: string | null;
} | null> {
  try {
    const raw = await AsyncStorage.getItem(`${STORAGE_RESIDENT_META_PREFIX}${residentId}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readLocalEmergencyContact(residentId: string): Promise<{
  value: string | null;
  pendingLocalFallback?: boolean;
} | null> {
  try {
    const raw = await AsyncStorage.getItem(
      `${STORAGE_EMERGENCY_CONTACT_PREFIX}${residentId}`
    );
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readLocalPropertyMeta(propertyId: string): Promise<{
  wifi_ssid?: string | null;
  wifi_password?: string | null;
  curfew_time?: string | null;
  prefer_local?: boolean;
} | null> {
  try {
    const raw = await AsyncStorage.getItem(
      `${STORAGE_PROPERTY_META_PREFIX}${propertyId}`
    );
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseLocalMealTime(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{') || trimmed.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === 'string') return cleanText(parsed);
      if (parsed && typeof parsed === 'object') {
        const obj = parsed as {
          meal_time?: unknown;
          mealTime?: unknown;
          value?: unknown;
        };
        const val = obj.meal_time ?? obj.mealTime ?? obj.value;
        return typeof val === 'string' ? cleanText(val) : null;
      }
    } catch {
      // Fall back to raw trimmed string
    }
  }
  return trimmed;
}

interface PropertyJoinRow {
  name?: string | null;
  address?: string | null;
  owner_id?: string | null;
  wifi_ssid?: string | null;
  wifi_password?: string | null;
  curfew_time?: string | null;
}

interface AccommodationRow {
  id: string;
  property_id: string;
  room_number: string;
  bed_label?: string | null;
  joining_date?: string | null;
  monthly_rent_paise?: number | null;
  deposit_paise?: number | null;
  emergency_contact?: string | null;
  property: PropertyJoinRow | PropertyJoinRow[] | null;
}

export async function fetchResidentAccommodation(
  userId: string
): Promise<ServiceResult<ResidentAccommodationDetails | null>> {
  if (!userId) return ok(null);

  const traceLabel = `resident-portal:accommodation:${userId}`;
  startTrace(traceLabel);
  try {
    let row: AccommodationRow | null = null;

    const richRes = await supabase
      .from('residents')
      .select(
        'id, property_id, room_number, bed_label, joining_date, monthly_rent_paise, deposit_paise, emergency_contact, property:properties(name, address, owner_id, wifi_ssid, wifi_password, curfew_time)'
      )
      .eq('profile_id', userId)
      .eq('is_active', true)
      .maybeSingle();
    recordRoundTrip(traceLabel, 1);

    if (richRes.error) {
      if (!isMissingSchemaOrRpc(richRes.error)) {
        return fail(richRes.error, 'Could not load accommodation details.');
      }
      const basicRes = await supabase
        .from('residents')
        .select(
          'id, property_id, room_number, monthly_rent_paise, property:properties(name, address, owner_id)'
        )
        .eq('profile_id', userId)
        .eq('is_active', true)
        .maybeSingle();
      recordRoundTrip(traceLabel, 1);
      if (basicRes.error) {
        return fail(basicRes.error, 'Could not load accommodation details.');
      }
      row = (basicRes.data as unknown as AccommodationRow | null) ?? null;
    } else {
      row = (richRes.data as unknown as AccommodationRow | null) ?? null;
    }

    if (!row) {
      return ok(null);
    }

    const activeRow: AccommodationRow = row;
    const prop = Array.isArray(activeRow.property)
      ? activeRow.property[0]
      : activeRow.property;
    const [
      localMeta,
      localEmergency,
      localPropertyMeta,
      ownerRes,
      wardenAssignRes,
    ] = await Promise.all([
      readLocalResidentMeta(activeRow.id),
      readLocalEmergencyContact(activeRow.id),
      readLocalPropertyMeta(activeRow.property_id),
      prop?.owner_id
        ? supabase
            .from('profiles')
            .select('full_name, phone_number')
            .eq('id', prop.owner_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      (async () => {
        try {
          return await supabase
            .from('property_wardens')
            .select('warden_profile_id')
            .eq('property_id', activeRow.property_id)
            .eq('is_active', true)
            .maybeSingle();
        } catch {
          return { data: null, error: null };
        }
      })(),
    ]);

    recordRoundTrip(traceLabel, prop?.owner_id ? 2 : 1);

    const ownerData = ownerRes.data as {
      full_name?: string | null;
      phone_number?: string | null;
    } | null;

    let wardenName: string | null = null;
    let wardenPhone: string | null = null;
    const wardenProfileId = !wardenAssignRes.error
      ? (wardenAssignRes.data as { warden_profile_id?: string | null } | null)
          ?.warden_profile_id
      : null;

    if (wardenProfileId) {
      try {
        const wardenProfileRes = await supabase
          .from('profiles')
          .select('full_name, phone_number')
          .eq('id', wardenProfileId)
          .maybeSingle();
        recordRoundTrip(traceLabel, 1);
        if (!wardenProfileRes.error && wardenProfileRes.data) {
          const wData = wardenProfileRes.data as {
            full_name?: string | null;
            phone_number?: string | null;
          };
          wardenName = cleanText(wData.full_name);
          wardenPhone = cleanText(wData.phone_number);
        }
      } catch {
        // Ignore warden profile lookup failure gracefully
      }
    }

    const preferLocalPropMeta = Boolean(localPropertyMeta?.prefer_local);
    const wifiSsid = preferLocalPropMeta
      ? cleanText(localPropertyMeta?.wifi_ssid) ?? cleanText(prop?.wifi_ssid)
      : cleanText(prop?.wifi_ssid) ?? cleanText(localPropertyMeta?.wifi_ssid);
    const wifiPassword = preferLocalPropMeta
      ? cleanText(localPropertyMeta?.wifi_password) ?? cleanText(prop?.wifi_password)
      : cleanText(prop?.wifi_password) ?? cleanText(localPropertyMeta?.wifi_password);
    const curfewTime = preferLocalPropMeta
      ? cleanText(localPropertyMeta?.curfew_time) ?? cleanText(prop?.curfew_time)
      : cleanText(prop?.curfew_time) ?? cleanText(localPropertyMeta?.curfew_time);

    const resolvedEmergencyContact =
      localEmergency?.pendingLocalFallback
        ? localEmergency.value
        : activeRow.emergency_contact ?? localMeta?.emergency_contact ?? null;

    return ok({
      residentId: activeRow.id,
      propertyId: activeRow.property_id,
      propertyName: prop?.name || 'Assigned PG',
      propertyAddress: prop?.address || null,
      roomNumber: activeRow.room_number,
      bedLabel: activeRow.bed_label ?? localMeta?.bed_label ?? null,
      joiningDate: activeRow.joining_date ?? localMeta?.joining_date ?? null,
      monthlyRentPaise: activeRow.monthly_rent_paise ?? 0,
      depositPaise: activeRow.deposit_paise ?? localMeta?.deposit_paise ?? 0,
      emergencyContact: resolvedEmergencyContact,
      ownerName: ownerData?.full_name ?? null,
      ownerPhone: ownerData?.phone_number ?? null,
      wifiSsid,
      wifiPassword,
      curfewTime,
      wardenName,
      wardenPhone,
    });
  } catch (err) {
    return fail(err, 'Failed to load stay and room details.');
  } finally {
    endTrace(traceLabel);
  }
}

export async function updateResidentEmergencyContact(
  residentId: string,
  rawValue: string
): Promise<
  ServiceResult<{
    emergencyContact: string | null;
    savedLocally: boolean;
    queued?: boolean;
  }>
> {
  const clean = rawValue.trim() || null;
  const traceLabel = `resident-portal:emergency:${residentId}`;
  startTrace(traceLabel);
  try {
    const { error } = await supabase.rpc('set_my_emergency_contact', {
      p_value: clean ?? '',
    });
    recordRoundTrip(traceLabel, 1);

    if (error) {
      if (isMissingSchemaOrRpc(error)) {
        await AsyncStorage.setItem(
          `${STORAGE_EMERGENCY_CONTACT_PREFIX}${residentId}`,
          JSON.stringify({ value: clean, pendingLocalFallback: true })
        );
        return ok({ emergencyContact: clean, savedLocally: true });
      }
      if (isLikelyNetworkError(error)) {
        await enqueueOfflineMutation(
          'set_my_emergency_contact',
          { residentId, value: clean ?? '' },
          `emergency-contact:${residentId}`
        );
        await AsyncStorage.setItem(
          `${STORAGE_EMERGENCY_CONTACT_PREFIX}${residentId}`,
          JSON.stringify({ value: clean, pendingLocalFallback: true })
        );
        return ok({ emergencyContact: clean, savedLocally: true, queued: true });
      }
      return fail(error, 'Could not save emergency contact.');
    }

    await AsyncStorage.setItem(
      `${STORAGE_EMERGENCY_CONTACT_PREFIX}${residentId}`,
      JSON.stringify({ value: clean, pendingLocalFallback: false })
    );
    await Promise.all([
      invalidatePrefix('residents:'),
      invalidatePrefix('dashboard:'),
    ]);
    return ok({ emergencyContact: clean, savedLocally: false });
  } catch (err) {
    if (isLikelyNetworkError(err)) {
      try {
        await enqueueOfflineMutation(
          'set_my_emergency_contact',
          { residentId, value: clean ?? '' },
          `emergency-contact:${residentId}`
        );
        await AsyncStorage.setItem(
          `${STORAGE_EMERGENCY_CONTACT_PREFIX}${residentId}`,
          JSON.stringify({ value: clean, pendingLocalFallback: true })
        );
        return ok({ emergencyContact: clean, savedLocally: true, queued: true });
      } catch (queueErr) {
        return fail(queueErr, 'Failed to queue emergency contact update.');
      }
    }
    return fail(err, 'Failed to save emergency contact.');
  } finally {
    endTrace(traceLabel);
  }
}

export async function fetchResidentMultiDayMenus(
  propertyId: string,
  datesIso: string[]
): Promise<
  ServiceResult<{
    byDate: Record<string, DayMenuMap>;
    publishedDates: string[];
  }>
> {
  if (!propertyId || datesIso.length === 0) {
    return ok({ byDate: {}, publishedDates: [] });
  }

  const traceLabel = `resident-portal:menus:${propertyId}`;
  startTrace(traceLabel);
  try {
    let rows: ResidentMenuSlot[] = [];

    const richRes = await supabase
      .from('food_menus')
      .select('id, menu_date, meal_type, items, notes, meal_time')
      .eq('property_id', propertyId)
      .eq('is_published', true)
      .in('menu_date', datesIso);
    recordRoundTrip(traceLabel, 1);

    if (richRes.error) {
      if (!isMissingSchemaOrRpc(richRes.error)) {
        return fail(richRes.error, 'Could not load meal schedules.');
      }
      const basicRes = await supabase
        .from('food_menus')
        .select('id, menu_date, meal_type, items, notes')
        .eq('property_id', propertyId)
        .eq('is_published', true)
        .in('menu_date', datesIso);
      recordRoundTrip(traceLabel, 1);
      if (basicRes.error) {
        return fail(basicRes.error, 'Could not load meal schedules.');
      }
      rows = (basicRes.data as ResidentMenuSlot[]) ?? [];
    } else {
      rows = (richRes.data as ResidentMenuSlot[]) ?? [];
    }

    const missingTimeKeys: string[] = [];
    for (const item of rows) {
      if (
        !cleanText(item.meal_time) &&
        (item.meal_type === 'breakfast' ||
          item.meal_type === 'lunch' ||
          item.meal_type === 'dinner')
      ) {
        missingTimeKeys.push(
          `${STORAGE_MEAL_TIME_PREFIX}${propertyId}:${item.menu_date}:${item.meal_type}`
        );
      }
    }

    const localTimeMap = new Map<string, string | null>();
    if (missingTimeKeys.length > 0) {
      try {
        const entries = await AsyncStorage.multiGet(missingTimeKeys);
        for (const [key, raw] of entries) {
          localTimeMap.set(key, parseLocalMealTime(raw));
        }
      } catch {
        // Non-fatal fallback read
      }
    }

    const hydratedRows = rows.map((item) => {
      const dbMealTime = cleanText(item.meal_time);
      if (dbMealTime) {
        return { ...item, meal_time: dbMealTime };
      }
      if (
        item.meal_type === 'breakfast' ||
        item.meal_type === 'lunch' ||
        item.meal_type === 'dinner'
      ) {
        const key = `${STORAGE_MEAL_TIME_PREFIX}${propertyId}:${item.menu_date}:${item.meal_type}`;
        return { ...item, meal_time: localTimeMap.get(key) ?? null };
      }
      return { ...item, meal_time: null };
    });

    const byDate: Record<string, DayMenuMap> = {};
    for (const dateIso of datesIso) {
      byDate[dateIso] = { breakfast: null, lunch: null, dinner: null };
    }

    const publishedSet = new Set<string>();
    for (const item of hydratedRows) {
      if (!byDate[item.menu_date]) {
        byDate[item.menu_date] = { breakfast: null, lunch: null, dinner: null };
      }
      if (
        item.meal_type === 'breakfast' ||
        item.meal_type === 'lunch' ||
        item.meal_type === 'dinner'
      ) {
        byDate[item.menu_date][item.meal_type] = item;
        publishedSet.add(item.menu_date);
      }
    }

    return ok({
      byDate,
      publishedDates: Array.from(publishedSet),
    });
  } catch (err) {
    return fail(err, 'Failed to load meal schedules.');
  } finally {
    endTrace(traceLabel);
  }
}
