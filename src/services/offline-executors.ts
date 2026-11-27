import AsyncStorage from '@react-native-async-storage/async-storage';

import { OfflineExecutorMap } from '@/lib/offline-queue';
import { invalidatePrefix } from '@/lib/query-cache';
import { supabase } from '@/lib/supabase';

const STORAGE_EMERGENCY_CONTACT_PREFIX = '@pgwala_resident_emergency_contact:';

export interface GateMovementOfflinePayload {
  p_direction: 'IN' | 'OUT';
  p_purpose?: string;
  p_expected_return_time?: string;
  p_expected_return_date?: string | null;
  p_food_required?: boolean;
  p_note?: string;
}

export interface FoodOptInOfflinePayload {
  value: boolean;
}

export interface ComplaintOfflinePayload {
  property_id: string;
  resident_id: string;
  category: string;
  priority: string;
  title: string;
  description: string;
  photo_url?: null;
}

export interface EmergencyContactOfflinePayload {
  residentId: string;
  value: string;
}

const LOCAL_URI_PREFIXES = ['file://', 'ph://', 'content://', 'assets-library://'];

export const defaultOfflineExecutors: OfflineExecutorMap = {
  gate_movement_log: async (payload) => {
    const typed = payload as unknown as GateMovementOfflinePayload;
    const { data, error } = await supabase.rpc('record_student_movement', {
      p_direction: typed.p_direction,
      p_purpose: typed.p_purpose,
      p_expected_return_time: typed.p_expected_return_time,
      ...(typed.p_expected_return_date !== undefined
        ? { p_expected_return_date: typed.p_expected_return_date }
        : {}),
      p_food_required: typed.p_food_required,
      p_note: typed.p_note,
    });
    if (error) throw error;
    if (data && data.success === false) {
      throw new Error(data.error || 'Failed to record movement.');
    }
  },

  food_opt_in: async (payload) => {
    const typed = payload as unknown as FoodOptInOfflinePayload;
    const { error } = await supabase.rpc('set_my_meal_opt_in', {
      p_value: Boolean(typed.value),
    });
    if (error) throw error;
  },

  complaint_submit: async (payload) => {
    const typed = payload as unknown as Omit<ComplaintOfflinePayload, 'photo_url'> & {
      photo_url?: string | null;
    };
    const photoUrl = typeof typed.photo_url === 'string' ? typed.photo_url : null;
    if (
      photoUrl &&
      LOCAL_URI_PREFIXES.some((prefix) => photoUrl.startsWith(prefix))
    ) {
      throw new Error('Complaints with local photo attachments require a live connection.');
    }
    const { error } = await supabase.from('complaints').insert({
      property_id: typed.property_id,
      resident_id: typed.resident_id,
      category: typed.category,
      priority: typed.priority,
      title: typed.title,
      description: typed.description,
      photo_url: null,
    });
    if (error) throw error;
  },

  set_my_emergency_contact: async (payload) => {
    const typed = payload as unknown as EmergencyContactOfflinePayload;
    const clean = typeof typed.value === 'string' ? typed.value.trim() || null : null;
    const { error } = await supabase.rpc('set_my_emergency_contact', {
      p_value: clean ?? '',
    });
    if (error) throw error;

    if (typed.residentId) {
      await AsyncStorage.setItem(
        `${STORAGE_EMERGENCY_CONTACT_PREFIX}${typed.residentId}`,
        JSON.stringify({ value: clean, pendingLocalFallback: false })
      );
    }
    await Promise.all([
      invalidatePrefix('residents:'),
      invalidatePrefix('dashboard:'),
    ]);
  },
};
