import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/auth-context';
import { extractErrorMessage } from '@/lib/error-utils';
import { inferPropertyGender, PropertyGenderType } from '@/lib/ux-utils';

export interface PropertyItem {
  id: string;
  name: string;
  address: string | null;
  owner_id: string;
  is_active: boolean;
  gender_type?: PropertyGenderType | null;
  total_beds?: number | null;
  upi_id?: string | null;
  upi_payee_name?: string | null;
  wifi_ssid?: string | null;
  wifi_password?: string | null;
  curfew_time?: string | null;
  active_resident_count?: number;
}

export interface PropertyMetaInput {
  gender_type?: PropertyGenderType;
  total_beds?: number;
  explicit_gender?: boolean;
  prefer_local?: boolean;
  upi_id?: string | null;
  upi_payee_name?: string | null;
  wifi_ssid?: string | null;
  wifi_password?: string | null;
  curfew_time?: string | null;
}

interface PropertyContextType {
  properties: PropertyItem[];
  selectedProperty: PropertyItem | null;
  selectedPropertyId: string | null;
  selectProperty: (id: string) => Promise<void>;
  addProperty: (
    name: string,
    address?: string,
    meta?: PropertyMetaInput
  ) => Promise<PropertyItem>;
  updateProperty: (
    id: string,
    name: string,
    address?: string,
    meta?: PropertyMetaInput
  ) => Promise<void>;
  refreshProperties: () => Promise<void>;
  loadingProperties: boolean;
}

const STORAGE_ACTIVE_PROPERTY_KEY = '@pgwala_active_property_id';
const STORAGE_PROPERTY_META_PREFIX = '@pgwala_property_meta:';

const PropertyContext = createContext<PropertyContextType>({
  properties: [],
  selectedProperty: null,
  selectedPropertyId: null,
  selectProperty: async () => {},
  addProperty: async () => {
    throw new Error('PropertyContext not initialized');
  },
  updateProperty: async () => {},
  refreshProperties: async () => {},
  loadingProperties: true,
});

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

function normalizeOptionalText(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveHydratedMetaText(
  dbVal: string | null | undefined,
  localVal: string | null | undefined,
  preferLocal: boolean
): string | null {
  return preferLocal
    ? normalizeOptionalText(localVal)
    : normalizeOptionalText(dbVal) ?? normalizeOptionalText(localVal);
}

function resolveUpdatedMetaText(
  incoming: string | null | undefined,
  existingVal: string | null | undefined
): string | null {
  return incoming !== undefined
    ? normalizeOptionalText(incoming)
    : normalizeOptionalText(existingVal);
}

async function readLocalPropertyMeta(
  propertyId: string
): Promise<PropertyMetaInput | null> {
  try {
    const raw = await AsyncStorage.getItem(`${STORAGE_PROPERTY_META_PREFIX}${propertyId}`);
    if (!raw) return null;
    return JSON.parse(raw) as PropertyMetaInput;
  } catch {
    return null;
  }
}

async function writeLocalPropertyMeta(
  propertyId: string,
  meta: PropertyMetaInput
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      `${STORAGE_PROPERTY_META_PREFIX}${propertyId}`,
      JSON.stringify(meta)
    );
  } catch {
    // Non-fatal fallback persistence
  }
}

export function PropertyProvider({ children }: { children: React.ReactNode }) {
  const { user, profile } = useAuth();
  const ownerUserId = user?.id ?? null;
  const profileRole = profile?.role ?? null;
  const [properties, setProperties] = useState<PropertyItem[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [loadingProperties, setLoadingProperties] = useState(true);

  const fetchProperties = useCallback(async () => {
    if (!ownerUserId || profileRole !== 'owner') {
      setProperties([]);
      setSelectedPropertyId(null);
      setLoadingProperties(false);
      return;
    }

    try {
      setLoadingProperties(true);

      let rawRows: PropertyItem[] = [];
      const richRes = await supabase
        .from('properties')
        .select(
          'id, name, address, owner_id, is_active, gender_type, total_beds, upi_id, upi_payee_name, wifi_ssid, wifi_password, curfew_time'
        )
        .eq('owner_id', ownerUserId)
        .eq('is_active', true)
        .order('created_at', { ascending: true });

      if (richRes.error && isMissingColumnError(richRes.error)) {
        const basicRes = await supabase
          .from('properties')
          .select('id, name, address, owner_id, is_active')
          .eq('owner_id', ownerUserId)
          .eq('is_active', true)
          .order('created_at', { ascending: true });

        if (basicRes.error) {
          console.warn('[PropertyContext] Error fetching properties:', basicRes.error.message);
          return;
        }
        rawRows = (basicRes.data as PropertyItem[]) ?? [];
      } else if (richRes.error) {
        console.warn('[PropertyContext] Error fetching properties:', richRes.error.message);
        return;
      } else {
        rawRows = (richRes.data as PropertyItem[]) ?? [];
      }

      // Fetch active resident counts across all properties for occupancy badges
      const propIds = rawRows.map((p) => p.id);
      const occupancyMap = new Map<string, number>();
      if (propIds.length > 0) {
        const { data: resRows } = await supabase
          .from('residents')
          .select('property_id')
          .in('property_id', propIds)
          .eq('is_active', true);

        if (resRows) {
          for (const row of resRows) {
            const pid = row.property_id as string;
            occupancyMap.set(pid, (occupancyMap.get(pid) ?? 0) + 1);
          }
        }
      }

      const hydratedList: PropertyItem[] = await Promise.all(
        rawRows.map(async (p) => {
          const localMeta = await readLocalPropertyMeta(p.id);
          const preferLocal = Boolean(localMeta?.prefer_local);
          const dbGender = preferLocal
            ? null
            : p.gender_type === 'coed' && !localMeta?.explicit_gender
              ? null
              : p.gender_type;
          const resolvedGender = inferPropertyGender(
            p.name,
            dbGender ?? localMeta?.gender_type ?? null
          );
          const resolvedBeds = preferLocal
            ? localMeta?.total_beds ?? p.total_beds ?? 0
            : typeof p.total_beds === 'number' && p.total_beds > 0
              ? p.total_beds
              : localMeta?.total_beds ?? 0;

          return {
            ...p,
            gender_type: resolvedGender,
            total_beds: resolvedBeds,
            upi_id: resolveHydratedMetaText(p.upi_id, localMeta?.upi_id, preferLocal),
            upi_payee_name: resolveHydratedMetaText(
              p.upi_payee_name,
              localMeta?.upi_payee_name,
              preferLocal
            ),
            wifi_ssid: resolveHydratedMetaText(
              p.wifi_ssid,
              localMeta?.wifi_ssid,
              preferLocal
            ),
            wifi_password: resolveHydratedMetaText(
              p.wifi_password,
              localMeta?.wifi_password,
              preferLocal
            ),
            curfew_time: resolveHydratedMetaText(
              p.curfew_time,
              localMeta?.curfew_time,
              preferLocal
            ),
            active_resident_count: occupancyMap.get(p.id) ?? 0,
          };
        })
      );

      setProperties(hydratedList);

      if (hydratedList.length > 0) {
        const savedId = await AsyncStorage.getItem(STORAGE_ACTIVE_PROPERTY_KEY);
        const match = hydratedList.find((p) => p.id === savedId);
        if (match) {
          setSelectedPropertyId(match.id);
        } else {
          setSelectedPropertyId(hydratedList[0].id);
          await AsyncStorage.setItem(STORAGE_ACTIVE_PROPERTY_KEY, hydratedList[0].id);
        }
      } else {
        setSelectedPropertyId(null);
      }
    } catch (err) {
      console.error('[PropertyContext] Unexpected error:', err);
    } finally {
      setLoadingProperties(false);
    }
  }, [ownerUserId, profileRole]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) {
        void fetchProperties();
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fetchProperties]);

  const selectProperty = async (id: string) => {
    setSelectedPropertyId(id);
    await AsyncStorage.setItem(STORAGE_ACTIVE_PROPERTY_KEY, id);
  };

  const addProperty = async (
    name: string,
    address?: string,
    meta?: PropertyMetaInput
  ): Promise<PropertyItem> => {
    if (!user?.id) throw new Error('You must be signed in as an owner.');
    const trimmedName = name.trim();
    if (!trimmedName) throw new Error('Property name cannot be empty.');

    const genderType = inferPropertyGender(trimmedName, meta?.gender_type ?? null);
    const totalBeds =
      typeof meta?.total_beds === 'number' && Number.isFinite(meta.total_beds)
        ? Math.max(0, Math.round(meta.total_beds))
        : 0;
    const upiId = normalizeOptionalText(meta?.upi_id);
    const upiPayeeName = normalizeOptionalText(meta?.upi_payee_name);
    const wifiSsid = normalizeOptionalText(meta?.wifi_ssid);
    const wifiPassword = normalizeOptionalText(meta?.wifi_password);
    const curfewTime = normalizeOptionalText(meta?.curfew_time);

    let inserted: PropertyItem | null = null;

    const richInsert = await supabase
      .from('properties')
      .insert({
        owner_id: user.id,
        name: trimmedName,
        address: address?.trim() || null,
        is_active: true,
        gender_type: genderType,
        total_beds: totalBeds,
        upi_id: upiId,
        upi_payee_name: upiPayeeName,
        wifi_ssid: wifiSsid,
        wifi_password: wifiPassword,
        curfew_time: curfewTime,
      })
      .select(
        'id, name, address, owner_id, is_active, gender_type, total_beds, upi_id, upi_payee_name, wifi_ssid, wifi_password, curfew_time'
      )
      .single();

    if (richInsert.error) {
      // Fallback to core columns whenever rich schema columns/grants are not yet applied on DB.
      const basicInsert = await supabase
        .from('properties')
        .insert({
          owner_id: user.id,
          name: trimmedName,
          address: address?.trim() || null,
          is_active: true,
        })
        .select('id, name, address, owner_id, is_active')
        .single();

      if (basicInsert.error) {
        throw new Error(extractErrorMessage(basicInsert.error, 'Could not add property.'));
      }
      inserted = basicInsert.data as PropertyItem;
    } else {
      inserted = richInsert.data as PropertyItem;
    }

    if (!inserted) throw new Error('Failed to create new property.');

    await writeLocalPropertyMeta(inserted.id, {
      gender_type: genderType,
      total_beds: totalBeds,
      explicit_gender: Boolean(meta?.gender_type),
      prefer_local: Boolean(richInsert.error),
      upi_id: upiId,
      upi_payee_name: upiPayeeName,
      wifi_ssid: wifiSsid,
      wifi_password: wifiPassword,
      curfew_time: curfewTime,
    });

    const newProp: PropertyItem = {
      ...inserted,
      gender_type: genderType,
      total_beds: totalBeds,
      upi_id: upiId,
      upi_payee_name: upiPayeeName,
      wifi_ssid: wifiSsid,
      wifi_password: wifiPassword,
      curfew_time: curfewTime,
      active_resident_count: 0,
    };

    setProperties((prev) => [...prev, newProp]);
    await selectProperty(newProp.id);
    return newProp;
  };

  const updateProperty = async (
    id: string,
    name: string,
    address?: string,
    meta?: PropertyMetaInput
  ) => {
    if (!user?.id) throw new Error('You must be signed in as an owner.');
    const trimmedName = name.trim();
    if (!trimmedName) throw new Error('Property name cannot be empty.');

    const existing = properties.find((p) => p.id === id);
    const genderType =
      meta?.gender_type ??
      inferPropertyGender(trimmedName, existing?.gender_type ?? null);
    const totalBeds =
      typeof meta?.total_beds === 'number' && Number.isFinite(meta.total_beds)
        ? Math.max(0, Math.round(meta.total_beds))
        : existing?.total_beds ?? 0;
    const upiId = resolveUpdatedMetaText(meta?.upi_id, existing?.upi_id);
    const upiPayeeName = resolveUpdatedMetaText(
      meta?.upi_payee_name,
      existing?.upi_payee_name
    );
    const wifiSsid = resolveUpdatedMetaText(meta?.wifi_ssid, existing?.wifi_ssid);
    const wifiPassword = resolveUpdatedMetaText(
      meta?.wifi_password,
      existing?.wifi_password
    );
    const curfewTime = resolveUpdatedMetaText(
      meta?.curfew_time,
      existing?.curfew_time
    );

    const richUpdate = await supabase
      .from('properties')
      .update({
        name: trimmedName,
        address: address?.trim() || null,
        gender_type: genderType,
        total_beds: totalBeds,
        upi_id: upiId,
        upi_payee_name: upiPayeeName,
        wifi_ssid: wifiSsid,
        wifi_password: wifiPassword,
        curfew_time: curfewTime,
      })
      .eq('id', id)
      .eq('owner_id', user.id);

    if (richUpdate.error) {
      // Fallback to core columns (name, address) so edits succeed even before new column GRANT/ALTER runs.
      const basicUpdate = await supabase
        .from('properties')
        .update({
          name: trimmedName,
          address: address?.trim() || null,
        })
        .eq('id', id)
        .eq('owner_id', user.id);

      if (basicUpdate.error) {
        throw new Error(extractErrorMessage(basicUpdate.error, 'Failed to update property details.'));
      }
    }

    await writeLocalPropertyMeta(id, {
      gender_type: genderType,
      total_beds: totalBeds,
      explicit_gender: Boolean(meta?.gender_type),
      prefer_local: Boolean(richUpdate.error),
      upi_id: upiId,
      upi_payee_name: upiPayeeName,
      wifi_ssid: wifiSsid,
      wifi_password: wifiPassword,
      curfew_time: curfewTime,
    });

    setProperties((prev) =>
      prev.map((p) =>
        p.id === id
          ? {
              ...p,
              name: trimmedName,
              address: address?.trim() || null,
              gender_type: genderType,
              total_beds: totalBeds,
              upi_id: upiId,
              upi_payee_name: upiPayeeName,
              wifi_ssid: wifiSsid,
              wifi_password: wifiPassword,
              curfew_time: curfewTime,
            }
          : p
      )
    );
  };

  const selectedProperty =
    properties.find((p) => p.id === selectedPropertyId) ?? (properties[0] || null);

  return (
    <PropertyContext.Provider
      value={{
        properties,
        selectedProperty,
        selectedPropertyId: selectedProperty?.id || null,
        selectProperty,
        addProperty,
        updateProperty,
        refreshProperties: fetchProperties,
        loadingProperties,
      }}>
      {children}
    </PropertyContext.Provider>
  );
}

export function useProperty() {
  const context = useContext(PropertyContext);
  if (!context) {
    throw new Error('useProperty must be used within a PropertyProvider');
  }
  return context;
}
