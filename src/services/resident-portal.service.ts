import AsyncStorage from '@react-native-async-storage/async-storage';

import { endTrace, recordRoundTrip, startTrace } from '@/lib/perf-monitor';
import { invalidatePrefix } from '@/lib/query-cache';
import { fail, ok, ServiceResult } from '@/lib/service-result';
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
}

export interface ResidentMenuSlot {
  id: string;
  menu_date: string;
  meal_type: MealType;
  items: string;
  notes: string | null;
}

export type DayMenuMap = Record<MealType, ResidentMenuSlot | null>;

const STORAGE_RESIDENT_META_PREFIX = '@pgwala_resident_meta:';
const STORAGE_EMERGENCY_CONTACT_PREFIX = '@pgwala_resident_emergency_contact:';

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
    msg.includes('does not exist') ||
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

interface AccommodationRow {
  id: string;
  property_id: string;
  room_number: string;
  bed_label?: string | null;
  joining_date?: string | null;
  monthly_rent_paise?: number | null;
  deposit_paise?: number | null;
  emergency_contact?: string | null;
  property:
    | { name?: string | null; address?: string | null; owner_id?: string | null }
    | { name?: string | null; address?: string | null; owner_id?: string | null }[]
    | null;
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
        'id, property_id, room_number, bed_label, joining_date, monthly_rent_paise, deposit_paise, emergency_contact, property:properties(name, address, owner_id)'
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
    const [localMeta, localEmergency, ownerRes] = await Promise.all([
      readLocalResidentMeta(activeRow.id),
      readLocalEmergencyContact(activeRow.id),
      prop?.owner_id
        ? supabase
            .from('profiles')
            .select('full_name, phone_number')
            .eq('id', prop.owner_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    if (prop?.owner_id) {
      recordRoundTrip(traceLabel, 1);
    }

    const ownerData = ownerRes.data as {
      full_name?: string | null;
      phone_number?: string | null;
    } | null;

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
): Promise<ServiceResult<{ emergencyContact: string | null; savedLocally: boolean }>> {
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
    const { data, error } = await supabase
      .from('food_menus')
      .select('id, menu_date, meal_type, items, notes')
      .eq('property_id', propertyId)
      .eq('is_published', true)
      .in('menu_date', datesIso);
    recordRoundTrip(traceLabel, 1);

    if (error) {
      return fail(error, 'Could not load meal schedules.');
    }

    const byDate: Record<string, DayMenuMap> = {};
    for (const dateIso of datesIso) {
      byDate[dateIso] = { breakfast: null, lunch: null, dinner: null };
    }

    const publishedSet = new Set<string>();
    for (const item of (data as ResidentMenuSlot[]) ?? []) {
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
