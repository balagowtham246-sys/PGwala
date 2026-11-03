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

export interface PropertyItem {
  id: string;
  name: string;
  address: string | null;
  owner_id: string;
  is_active: boolean;
}

interface PropertyContextType {
  properties: PropertyItem[];
  selectedProperty: PropertyItem | null;
  selectedPropertyId: string | null;
  selectProperty: (id: string) => Promise<void>;
  addProperty: (name: string, address?: string) => Promise<PropertyItem>;
  updateProperty: (id: string, name: string, address?: string) => Promise<void>;
  refreshProperties: () => Promise<void>;
  loadingProperties: boolean;
}

const STORAGE_ACTIVE_PROPERTY_KEY = '@pgwala_active_property_id';

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

export function PropertyProvider({ children }: { children: React.ReactNode }) {
  const { user, profile } = useAuth();
  const [properties, setProperties] = useState<PropertyItem[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [loadingProperties, setLoadingProperties] = useState(true);

  // Fetch all active properties owned by the user
  const fetchProperties = useCallback(async () => {
    if (!user?.id || profile?.role !== 'owner') {
      setProperties([]);
      setSelectedPropertyId(null);
      setLoadingProperties(false);
      return;
    }

    try {
      setLoadingProperties(true);
      const { data, error } = await supabase
        .from('properties')
        .select('id, name, address, owner_id, is_active')
        .eq('owner_id', user.id)
        .eq('is_active', true)
        .order('created_at', { ascending: true });

      if (error) {
        console.warn('[PropertyContext] Error fetching properties:', error.message);
        return;
      }

      const propList: PropertyItem[] = (data as PropertyItem[]) ?? [];
      setProperties(propList);

      if (propList.length > 0) {
        // Try restoring saved active property from local storage
        const savedId = await AsyncStorage.getItem(STORAGE_ACTIVE_PROPERTY_KEY);
        const match = propList.find((p) => p.id === savedId);
        if (match) {
          setSelectedPropertyId(match.id);
        } else {
          setSelectedPropertyId(propList[0].id);
          await AsyncStorage.setItem(STORAGE_ACTIVE_PROPERTY_KEY, propList[0].id);
        }
      } else {
        setSelectedPropertyId(null);
      }
    } catch (err) {
      console.error('[PropertyContext] Unexpected error:', err);
    } finally {
      setLoadingProperties(false);
    }
  }, [user?.id, profile?.role]);

  useEffect(() => {
    fetchProperties();
  }, [fetchProperties]);

  const selectProperty = async (id: string) => {
    setSelectedPropertyId(id);
    await AsyncStorage.setItem(STORAGE_ACTIVE_PROPERTY_KEY, id);
  };

  const addProperty = async (name: string, address?: string): Promise<PropertyItem> => {
    if (!user?.id) throw new Error('You must be signed in as an owner.');
    const trimmedName = name.trim();
    if (!trimmedName) throw new Error('Property name cannot be empty.');

    const { data, error } = await supabase
      .from('properties')
      .insert({
        owner_id: user.id,
        name: trimmedName,
        address: address?.trim() || null,
        is_active: true,
      })
      .select('id, name, address, owner_id, is_active')
      .single();

    if (error) throw error;
    if (!data) throw new Error('Failed to create new property.');

    const newProp = data as PropertyItem;
    setProperties((prev) => [...prev, newProp]);
    await selectProperty(newProp.id);
    return newProp;
  };

  const updateProperty = async (id: string, name: string, address?: string) => {
    if (!user?.id) throw new Error('You must be signed in as an owner.');
    const trimmedName = name.trim();
    if (!trimmedName) throw new Error('Property name cannot be empty.');

    const { error } = await supabase
      .from('properties')
      .update({
        name: trimmedName,
        address: address?.trim() || null,
      })
      .eq('id', id)
      .eq('owner_id', user.id);

    if (error) throw error;

    setProperties((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, name: trimmedName, address: address?.trim() || null } : p
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

