import AsyncStorage from '@react-native-async-storage/async-storage';

import { endTrace, recordRoundTrip, startTrace } from '@/lib/perf-monitor';
import { getCached, invalidatePrefix, setCached } from '@/lib/query-cache';
import { fail, ok, ServiceResult } from '@/lib/service-result';
import { supabase } from '@/lib/supabase';
import {
  getIstMonthStartIso,
  isPropertyCompatibleWithGender,
  normalizeRoomCode,
  PropertyGenderType,
  ResidentGender,
  sortRoomCodes,
} from '@/lib/ux-utils';

export const RESIDENTS_CACHE_PREFIX = 'residents:';
const STORAGE_ROOMS_PREFIX = '@pgwala_rooms:';
const STORAGE_RESIDENT_BED_PREFIX = '@pgwala_resident_meta:';

export interface RoomDefinition {
  id?: string;
  property_id: string;
  room_number: string;
  total_beds: number;
  gender_type: PropertyGenderType;
  is_ac?: boolean;
}

export interface BedSlot {
  bedLabel: string;
  isFree: boolean;
  occupiedBy?: {
    id: string;
    fullName: string;
  } | null;
}

export interface RoomWithOccupancy {
  roomNumber: string;
  totalBeds: number;
  freeBeds: number;
  occupiedBeds: number;
  genderType: PropertyGenderType;
  isGenderAllowed: boolean;
  isAc: boolean;
  beds: BedSlot[];
}

export interface ResidentDirectoryItem {
  id: string;
  propertyId: string;
  fullName: string;
  roomNumber: string;
  bedLabel: string | null;
  phoneNumber: string | null;
  gender: ResidentGender | null;
  joiningDate: string | null;
  monthlyRentPaise: number;
  depositPaise: number;
  isActive: boolean;
  updatedAt: string | null;
  gateStatus: 'IN' | 'OUT';
  lastGateEventTime: string | null;
  pendingDuesPaise: number;
}

export interface ResidentChargeSummary {
  id: string;
  category: string;
  amount_paise: number;
  status: string;
  billing_period_start: string;
  due_date: string | null;
}

export interface ResidentMovementItem {
  id: string;
  direction: 'IN' | 'OUT';
  event_time: string;
  purpose: string | null;
  expected_return_time: string | null;
  expected_return_date?: string | null;
  food_required: boolean | null;
  note: string | null;
}

export interface ResidentComplaintItem {
  id: string;
  category: string;
  priority: string;
  status: string;
  title: string;
  description: string;
  created_at: string;
  resolution_notes: string | null;
}

export interface ResidentProfileData {
  id: string;
  propertyId: string;
  propertyName: string;
  propertyGender: PropertyGenderType;
  profileId: string | null;
  fullName: string;
  roomNumber: string;
  bedLabel: string | null;
  phoneNumber: string | null;
  gender: ResidentGender | null;
  joiningDate: string | null;
  leftAt: string | null;
  monthlyRentPaise: number;
  depositPaise: number;
  emergencyContact: string | null;
  notes: string | null;
  isActive: boolean;
  updatedAt: string | null;
  // Computed sections
  currentMonthDuesStatus: 'paid' | 'unpaid' | 'not_generated';
  pendingDuesPaise: number;
  recentCharges: ResidentChargeSummary[];
  gateStatus: 'IN' | 'OUT';
  lastGateEventTime: string | null;
  lastSevenDaysLogs: ResidentMovementItem[];
  openComplaintsCount: number;
  resolvedComplaintsCount: number;
  recentComplaints: ResidentComplaintItem[];
  dinnerRegisteredToday: boolean;
  dinnerStatusLabel: string;
}

export interface ResidentUpdatePatch {
  full_name?: string;
  room_number?: string;
  bed_label?: string | null;
  phone_number?: string | null;
  gender?: ResidentGender | null;
  joining_date?: string | null;
  monthly_rent_paise?: number;
  deposit_paise?: number;
  emergency_contact?: string | null;
  notes?: string | null;
}

export type UpdateResidentLockResult =
  | { status: 'saved'; updatedAt: string | null }
  | { status: 'stale'; message: string }
  | { status: 'bed_taken'; message: string }
  | { status: 'gender_mismatch'; message: string };

interface LocalResidentMeta {
  bed_label?: string | null;
  gender?: ResidentGender | null;
  joining_date?: string | null;
  deposit_paise?: number;
  emergency_contact?: string | null;
  notes?: string | null;
}

function isMissingSchemaError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  return (
    err.code === '42P01' ||
    err.code === '42703' ||
    err.code === '42501' ||
    err.code === 'PGRST204' ||
    err.code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('column') ||
    msg.includes('permission denied') ||
    msg.includes('schema cache') ||
    msg.includes('could not find the table')
  );
}

function isUniqueViolation(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  return err.code === '23505' || msg.includes('duplicate key') || msg.includes('unique constraint');
}

function directoryCacheKey(propertyId: string): string {
  return `residents:directory:${propertyId}`;
}

export async function getCachedResidentsDirectory(
  propertyId: string
): Promise<ResidentDirectoryItem[] | null> {
  return getCached<ResidentDirectoryItem[]>(directoryCacheKey(propertyId));
}

async function readLocalRooms(propertyId: string): Promise<RoomDefinition[]> {
  try {
    const raw = await AsyncStorage.getItem(`${STORAGE_ROOMS_PREFIX}${propertyId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RoomDefinition[]) : [];
  } catch {
    return [];
  }
}

async function writeLocalRooms(propertyId: string, rooms: RoomDefinition[]): Promise<void> {
  try {
    await AsyncStorage.setItem(`${STORAGE_ROOMS_PREFIX}${propertyId}`, JSON.stringify(rooms));
  } catch {
    // Non-fatal
  }
}

async function readLocalResidentMeta(residentId: string): Promise<LocalResidentMeta | null> {
  try {
    const raw = await AsyncStorage.getItem(`${STORAGE_RESIDENT_BED_PREFIX}${residentId}`);
    if (!raw) return null;
    return JSON.parse(raw) as LocalResidentMeta;
  } catch {
    return null;
  }
}

async function readLocalResidentMetaBatch(
  residentIds: string[]
): Promise<Map<string, LocalResidentMeta>> {
  const result = new Map<string, LocalResidentMeta>();
  if (residentIds.length === 0) return result;
  try {
    const keys = residentIds.map((id) => `${STORAGE_RESIDENT_BED_PREFIX}${id}`);
    const entries = await AsyncStorage.multiGet(keys);
    for (let i = 0; i < entries.length; i += 1) {
      const raw = entries[i]?.[1];
      if (!raw) continue;
      try {
        result.set(residentIds[i], JSON.parse(raw) as LocalResidentMeta);
      } catch {
        // Ignore corrupt entry
      }
    }
  } catch {
    // Non-fatal fallback read
  }
  return result;
}

export async function writeLocalResidentMeta(
  residentId: string,
  meta: LocalResidentMeta
): Promise<void> {
  try {
    const prev = (await readLocalResidentMeta(residentId)) ?? {};
    await AsyncStorage.setItem(
      `${STORAGE_RESIDENT_BED_PREFIX}${residentId}`,
      JSON.stringify({ ...prev, ...meta })
    );
  } catch {
    // Non-fatal
  }
}

interface RawResidentRow {
  id: string;
  property_id: string;
  profile_id?: string | null;
  full_name: string;
  room_number: string;
  bed_label?: string | null;
  phone_number: string | null;
  gender?: ResidentGender | null;
  joining_date?: string | null;
  left_at?: string | null;
  monthly_rent_paise?: number | null;
  deposit_paise?: number | null;
  emergency_contact?: string | null;
  notes?: string | null;
  is_active: boolean;
  updated_at?: string | null;
  created_at?: string | null;
  meal_opt_in?: boolean | null;
}

async function fetchActiveResidentsRaw(
  propertyId: string,
  traceLabel: string
): Promise<RawResidentRow[]> {
  const richRes = await supabase
    .from('residents')
    .select(
      'id, property_id, profile_id, full_name, room_number, bed_label, phone_number, gender, joining_date, monthly_rent_paise, deposit_paise, emergency_contact, notes, is_active, updated_at, created_at'
    )
    .eq('property_id', propertyId)
    .eq('is_active', true)
    .order('room_number', { ascending: true });
  recordRoundTrip(traceLabel, 1);

  if (!richRes.error) {
    return (richRes.data as RawResidentRow[]) ?? [];
  }

  if (!isMissingSchemaError(richRes.error)) {
    throw richRes.error;
  }

  const basicRes = await supabase
    .from('residents')
    .select('id, property_id, profile_id, full_name, room_number, phone_number, monthly_rent_paise, is_active, created_at')
    .eq('property_id', propertyId)
    .eq('is_active', true)
    .order('room_number', { ascending: true });
  recordRoundTrip(traceLabel, 1);

  if (basicRes.error) throw basicRes.error;
  return (basicRes.data as RawResidentRow[]) ?? [];
}

async function fetchRoomsTableRaw(
  propertyId: string,
  traceLabel: string
): Promise<RoomDefinition[]> {
  const localRooms = await readLocalRooms(propertyId);
  let { data, error } = await supabase
    .from('rooms')
    .select('id, property_id, room_number, total_beds, gender_type, is_ac')
    .eq('property_id', propertyId);
  recordRoundTrip(traceLabel, 1);

  if (error && isMissingSchemaError(error)) {
    const fallback = await supabase
      .from('rooms')
      .select('id, property_id, room_number, total_beds, gender_type')
      .eq('property_id', propertyId);
    data = fallback.data as typeof data;
    error = fallback.error;
  }

  if (error) {
    if (isMissingSchemaError(error)) {
      return localRooms;
    }
    throw error;
  }

  const dbRooms = (data as RoomDefinition[]) ?? [];
  const merged = new Map<string, RoomDefinition>();
  const absorbRoom = (r: RoomDefinition) => {
    const cleanCode = normalizeRoomCode(r.room_number) || r.room_number.trim();
    const key = cleanCode.toLowerCase();
    const prev = merged.get(key);
    merged.set(key, {
      ...r,
      room_number: cleanCode,
      total_beds: prev
        ? Math.max(prev.total_beds || 1, r.total_beds || 1)
        : r.total_beds,
    });
  };
  for (const r of localRooms) absorbRoom(r);
  for (const r of dbRooms) absorbRoom(r);
  return Array.from(merged.values());
}

export async function fetchRoomsWithOccupancy(
  propertyId: string,
  options?: {
    residentGender?: ResidentGender;
    propertyGender?: PropertyGenderType;
    excludeResidentId?: string;
  }
): Promise<ServiceResult<RoomWithOccupancy[]>> {
  const traceLabel = `residents:rooms:${propertyId}`;
  startTrace(traceLabel);
  try {
    const [dbRooms, rawResidents] = await Promise.all([
      fetchRoomsTableRaw(propertyId, traceLabel),
      fetchActiveResidentsRaw(propertyId, traceLabel),
    ]);

    const localMetaMap = await readLocalResidentMetaBatch(rawResidents.map((r) => r.id));
    const residents = rawResidents.map((r) => {
      const meta = localMetaMap.get(r.id);
      return {
        ...r,
        bed_label: r.bed_label ?? meta?.bed_label ?? null,
        gender: (r.gender ?? meta?.gender ?? null) as ResidentGender | null,
      };
    });

    const roomsMap = new Map<string, RoomDefinition>();
    const canonicalCodeMap = new Map<string, string>();
    for (const room of dbRooms) {
      const norm = normalizeRoomCode(room.room_number) || room.room_number.trim();
      const key = norm.toLowerCase();
      canonicalCodeMap.set(key, norm);
      roomsMap.set(key, { ...room, room_number: norm });
    }

    const occupantsByRoom = new Map<string, typeof residents>();
    for (const res of residents) {
      const norm = normalizeRoomCode(res.room_number) || res.room_number.trim();
      const key = norm.toLowerCase();
      if (!canonicalCodeMap.has(key)) {
        canonicalCodeMap.set(key, norm);
      }
      const list = occupantsByRoom.get(key) ?? [];
      list.push(res);
      occupantsByRoom.set(key, list);

      if (!roomsMap.has(key)) {
        roomsMap.set(key, {
          property_id: propertyId,
          room_number: canonicalCodeMap.get(key)!,
          total_beds: Math.max(2, list.length),
          gender_type: options?.propertyGender ?? 'coed',
        });
      }
    }

    const sortedKeys = Array.from(roomsMap.keys()).sort((aKey, bKey) =>
      sortRoomCodes(canonicalCodeMap.get(aKey)!, canonicalCodeMap.get(bKey)!)
    );
    const result: RoomWithOccupancy[] = sortedKeys.map((key) => {
      const roomNumber = canonicalCodeMap.get(key)!;
      const def = roomsMap.get(key)!;
      const roomOccupants = occupantsByRoom.get(key) ?? [];
      const otherOccupants = roomOccupants.filter(
        (r) => r.id !== options?.excludeResidentId
      );

      // Determine gender compatibility
      let effectiveGender: PropertyGenderType = def.gender_type ?? 'coed';
      if (effectiveGender === 'coed' && options?.propertyGender && options.propertyGender !== 'coed') {
        effectiveGender = options.propertyGender;
      }

      const isGenderAllowed = options?.residentGender
        ? isPropertyCompatibleWithGender(effectiveGender, options.residentGender)
        : true;

      const totalBeds = Math.max(def.total_beds || 1, roomOccupants.length);
      const bedLabels = Array.from({ length: totalBeds }, (_, idx) => `Bed ${idx + 1}`);
      const bedOccupantMap = new Map<string, { id: string; fullName: string }>();

      const unslottedOccupants: typeof otherOccupants = [];
      for (const occ of otherOccupants) {
        if (occ.bed_label && bedLabels.includes(occ.bed_label) && !bedOccupantMap.has(occ.bed_label)) {
          bedOccupantMap.set(occ.bed_label, { id: occ.id, fullName: occ.full_name });
        } else if (occ.bed_label && !bedLabels.includes(occ.bed_label)) {
          bedLabels.push(occ.bed_label);
          bedOccupantMap.set(occ.bed_label, { id: occ.id, fullName: occ.full_name });
        } else {
          unslottedOccupants.push(occ);
        }
      }

      for (const occ of unslottedOccupants) {
        const nextFree = bedLabels.find((b) => !bedOccupantMap.has(b));
        if (nextFree) {
          bedOccupantMap.set(nextFree, { id: occ.id, fullName: occ.full_name });
        }
      }

      const beds: BedSlot[] = bedLabels.map((label) => {
        const occupiedBy = bedOccupantMap.get(label) ?? null;
        return {
          bedLabel: label,
          isFree: !occupiedBy,
          occupiedBy,
        };
      });

      const occupiedBeds = beds.filter((b) => !b.isFree).length;
      const freeBeds = Math.max(0, beds.length - occupiedBeds);

      return {
        roomNumber,
        totalBeds: beds.length,
        freeBeds,
        occupiedBeds,
        genderType: effectiveGender,
        isGenderAllowed,
        isAc: Boolean(def.is_ac),
        beds,
      };
    });

    return ok(result);
  } catch (err) {
    return fail(err, 'Could not load rooms and beds.');
  } finally {
    endTrace(traceLabel);
  }
}

export async function createRoom(
  propertyId: string,
  input: {
    roomNumber: string;
    totalBeds: number;
    genderType: PropertyGenderType;
    isAc?: boolean;
  }
): Promise<ServiceResult<RoomDefinition>> {
  const cleanRoom = normalizeRoomCode(input.roomNumber);
  if (!cleanRoom) {
    return fail(new Error('Room number is required.'));
  }
  const cleanBeds = Math.max(1, Math.min(20, Math.round(input.totalBeds || 2)));
  const isAc = Boolean(input.isAc);
  const traceLabel = `residents:create-room:${propertyId}`;
  startTrace(traceLabel);

  try {
    const payload: RoomDefinition = {
      property_id: propertyId,
      room_number: cleanRoom,
      total_beds: cleanBeds,
      gender_type: input.genderType,
      is_ac: isAc,
    };

    let { data, error } = await supabase
      .from('rooms')
      .upsert(payload, { onConflict: 'property_id,room_number' })
      .select('id, property_id, room_number, total_beds, gender_type, is_ac')
      .single();
    recordRoundTrip(traceLabel, 1);

    if (error && isMissingSchemaError(error)) {
      const legacyPayload = {
        property_id: propertyId,
        room_number: cleanRoom,
        total_beds: cleanBeds,
        gender_type: input.genderType,
      };
      const fallback = await supabase
        .from('rooms')
        .upsert(legacyPayload, { onConflict: 'property_id,room_number' })
        .select('id, property_id, room_number, total_beds, gender_type')
        .single();
      data = fallback.data ? { ...fallback.data, is_ac: isAc } : null;
      error = fallback.error;
    }

    if (error && !isMissingSchemaError(error)) {
      return fail(error, 'Could not save room.');
    }

    const saved = (data as RoomDefinition) ?? payload;
    const existingLocal = await readLocalRooms(propertyId);
    const nextLocal = existingLocal.filter(
      (r) => normalizeRoomCode(r.room_number).toLowerCase() !== cleanRoom.toLowerCase()
    );
    nextLocal.push({ ...saved, room_number: cleanRoom, total_beds: cleanBeds, is_ac: isAc });
    await writeLocalRooms(propertyId, nextLocal);

    return ok({ ...saved, room_number: cleanRoom, total_beds: cleanBeds, is_ac: isAc });
  } catch (err) {
    return fail(err, 'Could not create room.');
  } finally {
    endTrace(traceLabel);
  }
}

export async function renameRoom(
  propertyId: string,
  oldRoomNumber: string,
  input: {
    roomNumber: string;
    totalBeds: number;
    genderType: PropertyGenderType;
    isAc?: boolean;
  }
): Promise<ServiceResult<RoomDefinition>> {
  const cleanOld = normalizeRoomCode(oldRoomNumber);
  const cleanNext = normalizeRoomCode(input.roomNumber);
  if (!cleanNext) {
    return fail(new Error('Room number is required.'));
  }
  if (cleanOld.toLowerCase() === cleanNext.toLowerCase()) {
    return createRoom(propertyId, input);
  }

  const cleanBeds = Math.max(1, Math.min(20, Math.round(input.totalBeds || 2)));
  const traceLabel = `residents:rename-room:${propertyId}`;
  startTrace(traceLabel);

  try {
    // Check if target room code already exists in this property
    const { data: existingTarget, error: checkErr } = await supabase
      .from('rooms')
      .select('id')
      .eq('property_id', propertyId)
      .eq('room_number', cleanNext)
      .maybeSingle();

    if (checkErr && !isMissingSchemaError(checkErr)) {
      return fail(checkErr, 'Could not check target room name.');
    }
    if (existingTarget) {
      return fail(new Error(`Room "${cleanNext}" already exists in this PG.`));
    }

    // Update rooms table row (or insert if it only existed implicitly via residents)
    const isAc = Boolean(input.isAc);
    const { data: updatedRoom, error: roomErr } = await supabase
      .from('rooms')
      .update({
        room_number: cleanNext,
        total_beds: cleanBeds,
        gender_type: input.genderType,
        is_ac: isAc,
      })
      .eq('property_id', propertyId)
      .eq('room_number', cleanOld)
      .select('id, property_id, room_number, total_beds, gender_type, is_ac')
      .maybeSingle();

    if (roomErr && !isMissingSchemaError(roomErr)) {
      return fail(roomErr, 'Could not rename room.');
    }

    let saved: RoomDefinition = (updatedRoom as RoomDefinition | null) ?? {
      property_id: propertyId,
      room_number: cleanNext,
      total_beds: cleanBeds,
      gender_type: input.genderType,
      is_ac: isAc,
    };

    if (!updatedRoom && !isMissingSchemaError(roomErr)) {
      const { data: inserted } = await supabase
        .from('rooms')
        .upsert(saved, { onConflict: 'property_id,room_number' })
        .select('id, property_id, room_number, total_beds, gender_type, is_ac')
        .maybeSingle();
      if (inserted) saved = inserted as RoomDefinition;
    }

    // Cascade room rename to residents assigned to the old room name
    const { error: resUpdateErr } = await supabase
      .from('residents')
      .update({ room_number: cleanNext })
      .eq('property_id', propertyId)
      .eq('room_number', cleanOld);

    if (resUpdateErr) {
      return fail(resUpdateErr, 'Room renamed, but failed to update resident room labels.');
    }

    const existingLocal = await readLocalRooms(propertyId);
    const nextLocal = existingLocal.filter(
      (r) =>
        normalizeRoomCode(r.room_number).toLowerCase() !== cleanOld.toLowerCase() &&
        normalizeRoomCode(r.room_number).toLowerCase() !== cleanNext.toLowerCase()
    );
    nextLocal.push({ ...saved, room_number: cleanNext, total_beds: cleanBeds });
    await writeLocalRooms(propertyId, nextLocal);

    return ok({ ...saved, room_number: cleanNext, total_beds: cleanBeds });
  } catch (err) {
    return fail(err, 'Could not rename room.');
  } finally {
    endTrace(traceLabel);
  }
}

export async function fetchResidentsDirectory(
  propertyId: string
): Promise<ServiceResult<ResidentDirectoryItem[]>> {
  const traceLabel = directoryCacheKey(propertyId);
  startTrace(traceLabel);

  try {
    // Fast Path: Single-query Postgres RPC (exact latest gate status + unpaid dues in 1 round-trip)
    try {
      const rpcRes = await supabase.rpc('get_residents_directory_summary', {
        p_property_id: propertyId,
      });
      if (!rpcRes.error && Array.isArray(rpcRes.data)) {
        recordRoundTrip(traceLabel, 1);
        const rows = rpcRes.data as {
          id: string;
          property_id: string;
          full_name: string;
          room_number: string;
          bed_label?: string | null;
          phone_number: string | null;
          gender?: ResidentGender | null;
          joining_date?: string | null;
          monthly_rent_paise?: number | null;
          deposit_paise?: number | null;
          is_active: boolean;
          updated_at?: string | null;
          created_at?: string | null;
          gate_status?: 'IN' | 'OUT' | null;
          last_gate_event_time?: string | null;
          pending_dues_paise?: number | null;
        }[];
        const residentIds = rows.map((r) => r.id);
        const localMetaMap = await readLocalResidentMetaBatch(residentIds);
        const items: ResidentDirectoryItem[] = rows.map((r) => {
          const meta = localMetaMap.get(r.id);
          return {
            id: r.id,
            propertyId: r.property_id,
            fullName: r.full_name,
            roomNumber: r.room_number,
            bedLabel: r.bed_label ?? meta?.bed_label ?? null,
            phoneNumber: r.phone_number,
            gender: (r.gender ?? meta?.gender ?? null) as ResidentGender | null,
            joiningDate:
              r.joining_date ??
              meta?.joining_date ??
              (r.created_at ? r.created_at.slice(0, 10) : null),
            monthlyRentPaise: Number(r.monthly_rent_paise ?? 0),
            depositPaise: Number(r.deposit_paise ?? meta?.deposit_paise ?? 0),
            isActive: r.is_active,
            updatedAt: r.updated_at ?? null,
            gateStatus: r.gate_status === 'OUT' ? 'OUT' : 'IN',
            lastGateEventTime: r.last_gate_event_time ?? null,
            pendingDuesPaise: Number(r.pending_dues_paise ?? 0),
          };
        });
        items.sort((a, b) => {
          const roomCmp = sortRoomCodes(a.roomNumber, b.roomNumber);
          if (roomCmp !== 0) return roomCmp;
          return a.fullName.localeCompare(b.fullName);
        });
        await setCached(directoryCacheKey(propertyId), items);
        return ok(items);
      }
    } catch {
      // Fallback to multi-query path if RPC is not deployed or unmocked in tests
    }

    const rawResidents = await fetchActiveResidentsRaw(propertyId, traceLabel);
    if (rawResidents.length === 0) {
      await setCached(directoryCacheKey(propertyId), []);
      return ok([]);
    }

    const residentIds = rawResidents.map((r) => r.id);
    const currentMonthStart = getIstMonthStartIso();

    const [logsRes, chargesRes] = await Promise.all([
      supabase
        .from('movement_logs')
        .select('resident_id, direction, event_time')
        .eq('property_id', propertyId)
        .order('event_time', { ascending: false })
        .limit(200),
      supabase
        .from('charges')
        .select('resident_id, amount_paise, status, billing_period_start')
        .eq('property_id', propertyId)
        .in('resident_id', residentIds)
        .neq('status', 'settled'),
    ]);
    recordRoundTrip(traceLabel, 2);

    const latestGateMap = new Map<string, { direction: 'IN' | 'OUT'; event_time: string }>();
    if (!logsRes.error && logsRes.data) {
      for (const log of logsRes.data as {
        resident_id: string;
        direction: 'IN' | 'OUT';
        event_time: string;
      }[]) {
        if (!latestGateMap.has(log.resident_id)) {
          latestGateMap.set(log.resident_id, {
            direction: log.direction,
            event_time: log.event_time,
          });
        }
      }
    }

    const duesMap = new Map<string, number>();
    if (!chargesRes.error && chargesRes.data) {
      for (const chg of chargesRes.data as {
        resident_id: string;
        amount_paise: number;
        status: string;
        billing_period_start: string;
      }[]) {
        if (chg.status !== 'settled' && chg.status !== 'paid' && chg.status !== 'cancelled') {
          duesMap.set(
            chg.resident_id,
            (duesMap.get(chg.resident_id) ?? 0) + (chg.amount_paise || 0)
          );
        } else if (chg.billing_period_start === currentMonthStart) {
          // Ensure entry exists
          if (!duesMap.has(chg.resident_id)) duesMap.set(chg.resident_id, 0);
        }
      }
    }

    const localMetaMap = await readLocalResidentMetaBatch(residentIds);
    const items: ResidentDirectoryItem[] = rawResidents.map((r) => {
      const meta = localMetaMap.get(r.id);
      const latestGate = latestGateMap.get(r.id);
      return {
        id: r.id,
        propertyId: r.property_id,
        fullName: r.full_name,
        roomNumber: r.room_number,
        bedLabel: r.bed_label ?? meta?.bed_label ?? null,
        phoneNumber: r.phone_number,
        gender: (r.gender ?? meta?.gender ?? null) as ResidentGender | null,
        joiningDate:
          r.joining_date ??
          meta?.joining_date ??
          (r.created_at ? r.created_at.slice(0, 10) : null),
        monthlyRentPaise: r.monthly_rent_paise ?? 0,
        depositPaise: r.deposit_paise ?? meta?.deposit_paise ?? 0,
        isActive: r.is_active,
        updatedAt: r.updated_at ?? null,
        gateStatus: latestGate?.direction ?? 'IN',
        lastGateEventTime: latestGate?.event_time ?? null,
        pendingDuesPaise: duesMap.get(r.id) ?? 0,
      };
    });

    items.sort((a, b) => {
      const roomCmp = sortRoomCodes(a.roomNumber, b.roomNumber);
      if (roomCmp !== 0) return roomCmp;
      return a.fullName.localeCompare(b.fullName);
    });

    await setCached(directoryCacheKey(propertyId), items);
    return ok(items);
  } catch (err) {
    return fail(err, 'Could not load residents directory.');
  } finally {
    endTrace(traceLabel);
  }
}

type RawResidentWithProperty = RawResidentRow & {
  property?:
    | { id: string; name: string; gender_type?: string | null }
    | { id: string; name: string; gender_type?: string | null }[]
    | null;
};

async function loadRawResidentProfileRow(
  residentId: string,
  traceLabel: string
): Promise<RawResidentWithProperty | null> {
  const richRes = await supabase
    .from('residents')
    .select(
      `
        id,
        property_id,
        profile_id,
        full_name,
        room_number,
        bed_label,
        phone_number,
        gender,
        joining_date,
        left_at,
        monthly_rent_paise,
        deposit_paise,
        emergency_contact,
        notes,
        is_active,
        updated_at,
        created_at,
        meal_opt_in,
        property:properties (
          id,
          name,
          gender_type
        )
      `
    )
    .eq('id', residentId)
    .maybeSingle();
  recordRoundTrip(traceLabel, 1);

  if (!richRes.error) {
    return (richRes.data as RawResidentWithProperty | null) ?? null;
  }

  if (!isMissingSchemaError(richRes.error)) {
    throw richRes.error;
  }

  const basicRes = await supabase
    .from('residents')
    .select(
      `
        id,
        property_id,
        profile_id,
        full_name,
        room_number,
        phone_number,
        monthly_rent_paise,
        is_active,
        created_at,
        meal_opt_in,
        property:properties (
          id,
          name
        )
      `
    )
    .eq('id', residentId)
    .maybeSingle();
  recordRoundTrip(traceLabel, 1);

  if (basicRes.error) throw basicRes.error;
  return (basicRes.data as RawResidentWithProperty | null) ?? null;
}

export async function fetchResidentProfile(
  residentId: string
): Promise<ServiceResult<ResidentProfileData>> {
  const traceLabel = `residents:profile:${residentId}`;
  startTrace(traceLabel);

  try {
    const rawRes = await loadRawResidentProfileRow(residentId, traceLabel);
    if (!rawRes) {
      return fail(new Error('Resident not found.'));
    }

    const localMeta = await readLocalResidentMeta(rawRes.id);
    const propObj = Array.isArray(rawRes.property)
      ? rawRes.property[0]
      : rawRes.property;

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [chargesRes, logsRes, complaintsRes] = await Promise.all([
      supabase
        .from('charges')
        .select('id, category, amount_paise, status, billing_period_start, due_date')
        .eq('resident_id', rawRes.id)
        .order('billing_period_start', { ascending: false })
        .limit(12),
      supabase
        .from('movement_logs')
        .select('id, direction, event_time, purpose, expected_return_time, expected_return_date, food_required, note')
        .eq('resident_id', rawRes.id)
        .gte('event_time', sevenDaysAgo)
        .order('event_time', { ascending: false })
        .limit(30),
      supabase
        .from('complaints')
        .select('id, category, priority, status, title, description, created_at, resolution_notes')
        .eq('resident_id', rawRes.id)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);
    recordRoundTrip(traceLabel, 3);

    const recentCharges = ((chargesRes.data ?? []) as ResidentChargeSummary[]).filter(
      (c) => c.status !== 'cancelled'
    );
    const currentMonthStart = getIstMonthStartIso();
    const currentMonthRent = recentCharges.find(
      (c) => c.category === 'rent' && c.billing_period_start === currentMonthStart
    );

    const pendingDuesPaise = recentCharges
      .filter((c) => c.status !== 'settled' && c.status !== 'paid')
      .reduce((sum, c) => sum + (c.amount_paise || 0), 0);

    const currentMonthDuesStatus: ResidentProfileData['currentMonthDuesStatus'] =
      !currentMonthRent
        ? 'not_generated'
        : currentMonthRent.status === 'settled' || currentMonthRent.status === 'paid'
        ? 'paid'
        : 'unpaid';

    const lastSevenDaysLogs = (logsRes.data ?? []) as ResidentMovementItem[];
    const latestLog = lastSevenDaysLogs[0] ?? null;
    const gateStatus: 'IN' | 'OUT' = latestLog?.direction ?? 'IN';

    const recentComplaints = (complaintsRes.data ?? []) as ResidentComplaintItem[];
    const openComplaintsCount = recentComplaints.filter(
      (c) => c.status === 'open' || c.status === 'in_progress'
    ).length;
    const resolvedComplaintsCount = recentComplaints.filter(
      (c) => c.status === 'resolved'
    ).length;

    const onLeave =
      gateStatus === 'OUT' && Boolean(latestLog?.expected_return_date);
    const mealOptIn = rawRes.meal_opt_in !== false;
    const dinnerIncludedByGate =
      gateStatus === 'IN' || (!onLeave && Boolean(latestLog?.food_required));
    const dinnerRegisteredToday = mealOptIn && dinnerIncludedByGate;
    const dinnerStatusLabel = !mealOptIn
      ? 'Opted out of daily meals'
      : onLeave
      ? `Meals paused (On leave until ${latestLog?.expected_return_date})`
      : gateStatus === 'IN'
      ? 'Registered (Inside PG)'
      : latestLog?.food_required
      ? 'Registered (Returning for dinner)'
      : 'Not required today (Outside PG)';

    return ok({
      id: rawRes.id,
      propertyId: rawRes.property_id,
      propertyName: propObj?.name || 'PG Property',
      propertyGender:
        (propObj?.gender_type as PropertyGenderType) || 'coed',
      profileId: rawRes.profile_id ?? null,
      fullName: rawRes.full_name,
      roomNumber: rawRes.room_number,
      bedLabel: rawRes.bed_label ?? localMeta?.bed_label ?? null,
      phoneNumber: rawRes.phone_number,
      gender: (rawRes.gender ?? localMeta?.gender ?? null) as ResidentGender | null,
      joiningDate:
        rawRes.joining_date ??
        localMeta?.joining_date ??
        (rawRes.created_at ? rawRes.created_at.slice(0, 10) : null),
      leftAt: rawRes.left_at ?? null,
      monthlyRentPaise: rawRes.monthly_rent_paise ?? 0,
      depositPaise: rawRes.deposit_paise ?? localMeta?.deposit_paise ?? 0,
      emergencyContact:
        rawRes.emergency_contact ?? localMeta?.emergency_contact ?? null,
      notes: rawRes.notes ?? localMeta?.notes ?? null,
      isActive: rawRes.is_active,
      updatedAt: rawRes.updated_at ?? null,
      currentMonthDuesStatus,
      pendingDuesPaise,
      recentCharges,
      gateStatus,
      lastGateEventTime: latestLog?.event_time ?? null,
      lastSevenDaysLogs,
      openComplaintsCount,
      resolvedComplaintsCount,
      recentComplaints,
      dinnerRegisteredToday,
      dinnerStatusLabel,
    });
  } catch (err) {
    return fail(err, 'Could not load resident profile.');
  } finally {
    endTrace(traceLabel);
  }
}

export async function updateResidentWithLock(
  residentId: string,
  propertyId: string,
  loadedUpdatedAt: string | null,
  patch: ResidentUpdatePatch
): Promise<ServiceResult<UpdateResidentLockResult>> {
  const traceLabel = `residents:update:${residentId}`;
  startTrace(traceLabel);

  try {
    // 1. Check optimistic concurrency if updated_at is available
    if (loadedUpdatedAt) {
      const checkRes = await supabase
        .from('residents')
        .select('id, updated_at')
        .eq('id', residentId)
        .maybeSingle();
      recordRoundTrip(traceLabel, 1);

      if (!checkRes.error && checkRes.data?.updated_at && checkRes.data.updated_at !== loadedUpdatedAt) {
        return ok({
          status: 'stale',
          message:
            'This resident was updated on another device. Reload the latest details before saving.',
        });
      }
    }

    // 2. If room/bed/gender changed, enforce bed uniqueness & room gender policy
    if (patch.room_number !== undefined && patch.bed_label !== undefined) {
      const roomsRes = await fetchRoomsWithOccupancy(propertyId, {
        residentGender: patch.gender ?? undefined,
        excludeResidentId: residentId,
      });

      if (roomsRes.ok) {
        const targetRoom = roomsRes.data.find(
          (r) => r.roomNumber.trim().toLowerCase() === patch.room_number!.trim().toLowerCase()
        );
        if (targetRoom) {
          if (!targetRoom.isGenderAllowed) {
            return ok({
              status: 'gender_mismatch',
              message: `Room ${targetRoom.roomNumber} is reserved for another gender.`,
            });
          }
          if (patch.bed_label) {
            const targetBed = targetRoom.beds.find(
              (b) => b.bedLabel.toLowerCase() === patch.bed_label!.toLowerCase()
            );
            if (targetBed && !targetBed.isFree) {
              return ok({
                status: 'bed_taken',
                message: `${patch.bed_label} in Room ${targetRoom.roomNumber} was just assigned to ${targetBed.occupiedBy?.fullName || 'another resident'}. Please pick a free bed.`,
              });
            }
          }
        }
      }
    }

    // 3. Apply update with conditional updated_at match when present
    const fullPayload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) fullPayload[k] = v;
    }

    let query = supabase.from('residents').update(fullPayload).eq('id', residentId);
    if (loadedUpdatedAt) {
      query = query.eq('updated_at', loadedUpdatedAt);
    }

    const richUpdate = await query.select('id, updated_at').maybeSingle();
    recordRoundTrip(traceLabel, 1);

    if (richUpdate.error) {
      if (isUniqueViolation(richUpdate.error)) {
        return ok({
          status: 'bed_taken',
          message: 'That bed was taken by another resident just now. Please choose another bed.',
        });
      }

      if (isMissingSchemaError(richUpdate.error)) {
        // Fallback: core columns guaranteed in base schema + local metadata for extended fields
        const corePayload: Record<string, unknown> = {};
        if (patch.full_name !== undefined) corePayload.full_name = patch.full_name;
        if (patch.room_number !== undefined) corePayload.room_number = patch.room_number;
        if (patch.phone_number !== undefined) corePayload.phone_number = patch.phone_number;
        if (patch.monthly_rent_paise !== undefined) {
          corePayload.monthly_rent_paise = patch.monthly_rent_paise;
        }

        const { error: coreErr } = await supabase
          .from('residents')
          .update(corePayload)
          .eq('id', residentId);
        recordRoundTrip(traceLabel, 1);
        if (coreErr) return fail(coreErr, 'Could not update resident.');

        // Try each optional column individually in case partial migration ran
        for (const key of [
          'bed_label',
          'gender',
          'joining_date',
          'deposit_paise',
          'emergency_contact',
          'notes',
        ] as const) {
          if (patch[key] !== undefined) {
            await supabase
              .from('residents')
              .update({ [key]: patch[key] })
              .eq('id', residentId)
              .then(() => undefined, () => undefined);
          }
        }

        await writeLocalResidentMeta(residentId, {
          bed_label: patch.bed_label,
          gender: patch.gender,
          joining_date: patch.joining_date,
          deposit_paise: patch.deposit_paise,
          emergency_contact: patch.emergency_contact,
          notes: patch.notes,
        });

        await Promise.all([
          invalidatePrefix(RESIDENTS_CACHE_PREFIX),
          invalidatePrefix('dashboard:'),
          invalidatePrefix('billing:'),
        ]);
        return ok({ status: 'saved', updatedAt: null });
      }

      return fail(richUpdate.error, 'Could not update resident.');
    }

    if (loadedUpdatedAt && !richUpdate.data) {
      return ok({
        status: 'stale',
        message:
          'Another device updated this resident while you were editing. Reload before saving.',
      });
    }

    await writeLocalResidentMeta(residentId, {
      bed_label: patch.bed_label,
      gender: patch.gender,
      joining_date: patch.joining_date,
      deposit_paise: patch.deposit_paise,
      emergency_contact: patch.emergency_contact,
      notes: patch.notes,
    });

    await Promise.all([
      invalidatePrefix(RESIDENTS_CACHE_PREFIX),
      invalidatePrefix('dashboard:'),
      invalidatePrefix('billing:'),
      invalidatePrefix('announcements:'),
      invalidatePrefix('resident-ctx:'),
    ]);

    return ok({
      status: 'saved',
      updatedAt: (richUpdate.data?.updated_at as string | undefined) ?? null,
    });
  } catch (err) {
    return fail(err, 'Failed to save resident changes.');
  } finally {
    endTrace(traceLabel);
  }
}

export async function checkoutResident(input: {
  residentId: string;
  propertyId: string;
  leavingDateIso: string;
  generateFinalBill: boolean;
  finalBillPaise: number;
}): Promise<ServiceResult<{ finalBillCreated: boolean; releasedMachinesCount: number }>> {
  const traceLabel = `residents:checkout:${input.residentId}`;
  startTrace(traceLabel);

  try {
    let finalBillCreated = false;
    let releasedMachinesCount = 0;

    if (input.generateFinalBill && input.finalBillPaise > 0) {
      const periodStart = `${input.leavingDateIso.slice(0, 7)}-01`;
      const { error: chargeErr } = await supabase.from('charges').insert({
        property_id: input.propertyId,
        resident_id: input.residentId,
        category: 'rent',
        amount_paise: input.finalBillPaise,
        rent_amount_paise: input.finalBillPaise,
        wm_amount_paise: 0,
        status: 'outstanding',
        billing_period_start: periodStart,
        due_date: input.leavingDateIso,
      });
      recordRoundTrip(traceLabel, 1);

      if (!chargeErr) {
        finalBillCreated = true;
      }
    }

    // Best-effort cleanup of any active washing machine session or pending access request
    // held by this resident so machines are never left locked by an inactive resident.
    try {
      const wmRes = await supabase
        .from('washing_machines')
        .update({
          status: 'free',
          current_resident_id: null,
          started_at: null,
        })
        .eq('property_id', input.propertyId)
        .eq('current_resident_id', input.residentId)
        .eq('status', 'in_use')
        .select('id');
      if (!wmRes.error && Array.isArray(wmRes.data)) {
        releasedMachinesCount = wmRes.data.length;
      }
    } catch {
      // Non-fatal if washing_machines schema differs or unit not running
    }

    try {
      await supabase
        .from('washing_machine_requests')
        .update({ status: 'rejected' })
        .eq('property_id', input.propertyId)
        .eq('resident_id', input.residentId)
        .eq('status', 'pending');
    } catch {
      // Non-fatal
    }

    const richRes = await supabase
      .from('residents')
      .update({
        is_active: false,
        left_at: input.leavingDateIso,
      })
      .eq('id', input.residentId);
    recordRoundTrip(traceLabel, 1);

    if (richRes.error && isMissingSchemaError(richRes.error)) {
      const basicRes = await supabase
        .from('residents')
        .update({ is_active: false })
        .eq('id', input.residentId);
      recordRoundTrip(traceLabel, 1);
      if (basicRes.error) return fail(basicRes.error, 'Could not check out resident.');
    } else if (richRes.error) {
      return fail(richRes.error, 'Could not check out resident.');
    }

    // Best-effort push token invalidation so checked-out residents stop receiving PG alerts.
    try {
      await supabase.rpc('invalidate_resident_push_tokens', {
        p_property_id: input.propertyId,
        p_resident_id: input.residentId,
      });
    } catch {
      // Non-fatal if migration 29 not yet applied
    }

    await Promise.all([
      invalidatePrefix(RESIDENTS_CACHE_PREFIX),
      invalidatePrefix('dashboard:'),
      invalidatePrefix('billing:'),
      invalidatePrefix('announcements:'),
      invalidatePrefix('resident-ctx:'),
    ]);

    return ok({ finalBillCreated, releasedMachinesCount });
  } catch (err) {
    return fail(err, 'Failed to check out resident.');
  } finally {
    endTrace(traceLabel);
  }
}

export async function ownerRecordMovement(
  propertyId: string,
  residentId: string,
  direction: 'IN' | 'OUT',
  recordedByUserId?: string
): Promise<ServiceResult<void>> {
  const traceLabel = `residents:gate:${residentId}`;
  startTrace(traceLabel);
  try {
    const { error } = await supabase.from('movement_logs').insert({
      property_id: propertyId,
      resident_id: residentId,
      direction,
      food_required: direction === 'IN',
      recorded_by: recordedByUserId ?? null,
      note: 'Recorded by owner',
    });
    recordRoundTrip(traceLabel, 1);

    if (error) {
      return fail(error, 'Could not update gate status.');
    }

    await Promise.all([
      invalidatePrefix(RESIDENTS_CACHE_PREFIX),
      invalidatePrefix('dashboard:'),
    ]);
    return ok(undefined);
  } catch (err) {
    return fail(err, 'Could not update gate status.');
  } finally {
    endTrace(traceLabel);
  }
}

export async function ownerCreateComplaint(
  propertyId: string,
  residentId: string,
  input: {
    category: string;
    priority: string;
    title: string;
    description: string;
  }
): Promise<ServiceResult<void>> {
  const traceLabel = `residents:complaint:${propertyId}`;
  startTrace(traceLabel);
  try {
    const { error } = await supabase.from('complaints').insert({
      property_id: propertyId,
      resident_id: residentId,
      category: input.category,
      priority: input.priority,
      title: input.title.trim(),
      description: input.description.trim(),
      status: 'open',
    });
    recordRoundTrip(traceLabel, 1);

    if (error) {
      return fail(error, 'Could not log complaint.');
    }

    await Promise.all([
      invalidatePrefix(RESIDENTS_CACHE_PREFIX),
      invalidatePrefix('dashboard:'),
    ]);
    return ok(undefined);
  } catch (err) {
    return fail(err, 'Could not log complaint.');
  } finally {
    endTrace(traceLabel);
  }
}

let realtimeChannelSeq = 0;

export function subscribePropertyResidentsRealtime(
  propertyId: string,
  onChange: () => void
): () => void {
  realtimeChannelSeq += 1;
  const channel = supabase
    .channel(`residents-dir-${propertyId}-${realtimeChannelSeq}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'residents',
        filter: `property_id=eq.${propertyId}`,
      },
      onChange
    )
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'movement_logs',
        filter: `property_id=eq.${propertyId}`,
      },
      onChange
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
