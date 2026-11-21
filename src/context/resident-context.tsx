import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAuth } from '@/context/auth-context';
import { extractErrorMessage } from '@/lib/error-utils';
import { endTrace, recordRoundTrip, startTrace } from '@/lib/perf-monitor';
import { getCachedEntry, invalidatePrefix, setCached } from '@/lib/query-cache';
import { supabase } from '@/lib/supabase';
import { isValidUpiId } from '@/lib/upi';

export interface ResidentContextData {
  residentId: string;
  propertyId: string;
  propertyName: string;
  propertyAddress: string | null;
  fullName: string;
  roomNumber: string;
  bedLabel: string | null;
  joiningDate: string | null;
  monthlyRentPaise: number;
  depositPaise: number;
  emergencyContact: string | null;
  mealOptIn: boolean;
  curfewTime: string | null;
  ownerName: string | null;
  ownerPhone: string | null;
  ownerUpiId: string | null;
  ownerUpiPayeeName: string | null;
  wifiSsid: string | null;
  wifiPassword: string | null;
  wardenName: string | null;
  wardenPhone: string | null;
}

interface ResidentContextType {
  resident: ResidentContextData | null;
  residentId: string | null;
  propertyId: string | null;
  propertyName: string;
  roomNumber: string;
  bedLabel: string | null;
  curfewTime: string | null;
  ownerPhone: string | null;
  ownerUpiId: string | null;
  loadingResident: boolean;
  residentError: string | null;
  refreshResident: (force?: boolean) => Promise<ResidentContextData | null>;
  patchResident: (patch: Partial<ResidentContextData>) => void;
}

export const RESIDENT_CONTEXT_CACHE_PREFIX = 'resident-ctx:';
const RESIDENT_CONTEXT_TTL_MS = 60_000;
const STORAGE_RESIDENT_META_PREFIX = '@pgwala_resident_meta:';
const STORAGE_EMERGENCY_CONTACT_PREFIX = '@pgwala_resident_emergency_contact:';
const STORAGE_PROPERTY_META_PREFIX = '@pgwala_property_meta:';

const ResidentContext = createContext<ResidentContextType>({
  resident: null,
  residentId: null,
  propertyId: null,
  propertyName: 'My PG',
  roomNumber: '',
  bedLabel: null,
  curfewTime: null,
  ownerPhone: null,
  ownerUpiId: null,
  loadingResident: false,
  residentError: null,
  refreshResident: async () => null,
  patchResident: () => {},
});

function cleanText(val: string | null | undefined): string | null {
  const trimmed = (val ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isMissingSchemaOrPermission(
  err: { code?: string; message?: string } | null
): boolean {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  return (
    err.code === '42703' ||
    err.code === '42P01' ||
    err.code === '42883' ||
    err.code === '42501' ||
    err.code === 'PGRST204' ||
    err.code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('schema cache') ||
    msg.includes('column') ||
    msg.includes('permission denied')
  );
}

interface RawPropertyJoin {
  name?: string | null;
  address?: string | null;
  owner_id?: string | null;
  upi_id?: string | null;
  upi_payee_name?: string | null;
  wifi_ssid?: string | null;
  wifi_password?: string | null;
  curfew_time?: string | null;
}

interface RawResidentJoin {
  id: string;
  property_id: string;
  full_name?: string | null;
  room_number: string;
  bed_label?: string | null;
  joining_date?: string | null;
  monthly_rent_paise?: number | null;
  deposit_paise?: number | null;
  emergency_contact?: string | null;
  meal_opt_in?: boolean | null;
  property: RawPropertyJoin | RawPropertyJoin[] | null;
}

async function readLocalJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function fetchResidentContextFromNetwork(
  userId: string
): Promise<ResidentContextData | null> {
  const traceLabel = `resident-context:${userId}`;
  startTrace(traceLabel);
  try {
    let row: RawResidentJoin | null = null;

    const richRes = await supabase
      .from('residents')
      .select(
        'id, property_id, full_name, room_number, bed_label, joining_date, monthly_rent_paise, deposit_paise, emergency_contact, meal_opt_in, property:properties(name, address, owner_id, upi_id, upi_payee_name, wifi_ssid, wifi_password, curfew_time)'
      )
      .eq('profile_id', userId)
      .eq('is_active', true)
      .maybeSingle();
    recordRoundTrip(traceLabel, 1);

    if (richRes.error) {
      if (!isMissingSchemaOrPermission(richRes.error)) {
        throw richRes.error;
      }
      const basicRes = await supabase
        .from('residents')
        .select(
          'id, property_id, full_name, room_number, monthly_rent_paise, property:properties(name, address, owner_id)'
        )
        .eq('profile_id', userId)
        .eq('is_active', true)
        .maybeSingle();
      recordRoundTrip(traceLabel, 1);
      if (basicRes.error) {
        throw basicRes.error;
      }
      row = (basicRes.data as unknown as RawResidentJoin | null) ?? null;
    } else {
      row = (richRes.data as unknown as RawResidentJoin | null) ?? null;
    }

    if (!row) {
      return null;
    }

    const prop = Array.isArray(row.property) ? row.property[0] : row.property;

    const [localResMeta, localEmergency, localPropMeta, ownerRes, wardenAssignRes] =
      await Promise.all([
        readLocalJson<{
          bed_label?: string | null;
          joining_date?: string | null;
          deposit_paise?: number | null;
          emergency_contact?: string | null;
        }>(`${STORAGE_RESIDENT_META_PREFIX}${row.id}`),
        readLocalJson<{ value?: string | null; pendingLocalFallback?: boolean }>(
          `${STORAGE_EMERGENCY_CONTACT_PREFIX}${row.id}`
        ),
        readLocalJson<{
          upi_id?: string | null;
          upi_payee_name?: string | null;
          wifi_ssid?: string | null;
          wifi_password?: string | null;
          curfew_time?: string | null;
          prefer_local?: boolean;
        }>(`${STORAGE_PROPERTY_META_PREFIX}${row.property_id}`),
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
              .eq('property_id', row.property_id)
              .eq('is_active', true)
              .maybeSingle();
          } catch {
            return { data: null, error: null };
          }
        })(),
      ]);
    recordRoundTrip(traceLabel, prop?.owner_id ? 2 : 1);

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
          const w = wardenProfileRes.data as {
            full_name?: string | null;
            phone_number?: string | null;
          };
          wardenName = cleanText(w.full_name);
          wardenPhone = cleanText(w.phone_number);
        }
      } catch {
        // Non-fatal
      }
    }

    const preferLocal = Boolean(localPropMeta?.prefer_local);
    const resolvePropField = (
      dbVal: string | null | undefined,
      localVal: string | null | undefined
    ) =>
      preferLocal
        ? cleanText(localVal) ?? cleanText(dbVal)
        : cleanText(dbVal) ?? cleanText(localVal);

    const rawUpi = resolvePropField(prop?.upi_id, localPropMeta?.upi_id);
    const ownerData = ownerRes.data as {
      full_name?: string | null;
      phone_number?: string | null;
    } | null;

    return {
      residentId: row.id,
      propertyId: row.property_id,
      propertyName: cleanText(prop?.name) || 'My PG',
      propertyAddress: cleanText(prop?.address),
      fullName: cleanText(row.full_name) || 'Resident',
      roomNumber: row.room_number || '',
      bedLabel: row.bed_label ?? localResMeta?.bed_label ?? null,
      joiningDate: row.joining_date ?? localResMeta?.joining_date ?? null,
      monthlyRentPaise: row.monthly_rent_paise ?? 0,
      depositPaise: row.deposit_paise ?? localResMeta?.deposit_paise ?? 0,
      emergencyContact: localEmergency?.pendingLocalFallback
        ? localEmergency.value ?? null
        : row.emergency_contact ?? localResMeta?.emergency_contact ?? null,
      mealOptIn: typeof row.meal_opt_in === 'boolean' ? row.meal_opt_in : true,
      curfewTime: resolvePropField(prop?.curfew_time, localPropMeta?.curfew_time),
      ownerName: cleanText(ownerData?.full_name),
      ownerPhone: cleanText(ownerData?.phone_number),
      ownerUpiId: rawUpi && isValidUpiId(rawUpi) ? rawUpi : null,
      ownerUpiPayeeName: resolvePropField(
        prop?.upi_payee_name,
        localPropMeta?.upi_payee_name
      ),
      wifiSsid: resolvePropField(prop?.wifi_ssid, localPropMeta?.wifi_ssid),
      wifiPassword: resolvePropField(
        prop?.wifi_password,
        localPropMeta?.wifi_password
      ),
      wardenName,
      wardenPhone,
    };
  } finally {
    endTrace(traceLabel);
  }
}

export function ResidentProvider({ children }: { children: React.ReactNode }) {
  const { user, profile } = useAuth();
  const userId = user?.id ?? null;
  const isStudent = profile?.role === 'student';

  const [resident, setResident] = useState<ResidentContextData | null>(null);
  const [loadingResident, setLoadingResident] = useState<boolean>(false);
  const [residentError, setResidentError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const inFlightRef = useRef<{
    userId: string;
    promise: Promise<ResidentContextData | null>;
  } | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshResident = useCallback(
    async (force = false): Promise<ResidentContextData | null> => {
      if (!userId || !isStudent) {
        if (mountedRef.current) {
          setResident(null);
          setResidentError(null);
          setLoadingResident(false);
        }
        return null;
      }

      const cacheKey = `${RESIDENT_CONTEXT_CACHE_PREFIX}${userId}`;

      if (!force) {
        const entry = await getCachedEntry<ResidentContextData | null>(cacheKey);
        if (entry) {
          if (mountedRef.current) {
            setResident(entry.data);
            setResidentError(null);
            setLoadingResident(false);
          }
          if (!entry.isStale) {
            return entry.data;
          }
        }
      }

      if (inFlightRef.current?.userId === userId) {
        return inFlightRef.current.promise;
      }

      if (mountedRef.current) {
        setResident((prev) => {
          if (!prev) setLoadingResident(true);
          return prev;
        });
      }

      const run = (async () => {
        try {
          if (force) {
            await invalidatePrefix(cacheKey);
          }
          const fresh = await fetchResidentContextFromNetwork(userId);
          await setCached(cacheKey, fresh, RESIDENT_CONTEXT_TTL_MS);
          if (mountedRef.current) {
            setResident(fresh);
            setResidentError(null);
          }
          return fresh;
        } catch (err: unknown) {
          const msg = extractErrorMessage(err, 'Could not load your PG profile.');
          if (mountedRef.current) {
            setResidentError(msg);
          }
          return null;
        } finally {
          if (inFlightRef.current?.userId === userId) {
            inFlightRef.current = null;
          }
          if (mountedRef.current) {
            setLoadingResident(false);
          }
        }
      })();

      inFlightRef.current = { userId, promise: run };
      return run;
    },
    [userId, isStudent]
  );

  const patchResident = useCallback(
    (patch: Partial<ResidentContextData>) => {
      setResident((prev) => {
        if (!prev) return prev;
        const next = { ...prev, ...patch };
        if (userId) {
          void setCached(
            `${RESIDENT_CONTEXT_CACHE_PREFIX}${userId}`,
            next,
            RESIDENT_CONTEXT_TTL_MS
          );
        }
        return next;
      });
    },
    [userId]
  );

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      if (!userId || !isStudent) {
        setResident(null);
        setResidentError(null);
        setLoadingResident(false);
        return;
      }
      void refreshResident(false);
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [userId, isStudent, refreshResident]);

  useEffect(() => {
    if (!userId || !isStudent) return;
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void refreshResident(false);
      }
    });
    return () => sub.remove();
  }, [userId, isStudent, refreshResident]);

  const value = useMemo<ResidentContextType>(
    () => ({
      resident,
      residentId: resident?.residentId ?? null,
      propertyId: resident?.propertyId ?? null,
      propertyName: resident?.propertyName ?? 'My PG',
      roomNumber: resident?.roomNumber ?? '',
      bedLabel: resident?.bedLabel ?? null,
      curfewTime: resident?.curfewTime ?? null,
      ownerPhone: resident?.ownerPhone ?? null,
      ownerUpiId: resident?.ownerUpiId ?? null,
      loadingResident,
      residentError,
      refreshResident,
      patchResident,
    }),
    [resident, loadingResident, residentError, refreshResident, patchResident]
  );

  return (
    <ResidentContext.Provider value={value}>{children}</ResidentContext.Provider>
  );
}

export function useResident() {
  return useContext(ResidentContext);
}
