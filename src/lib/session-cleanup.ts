import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearOfflineQueue } from '@/lib/offline-queue';
import { clearQueryCache } from '@/lib/query-cache';
import { queryClient } from '@/lib/query-client';
import { mmkvQueryPersister } from '@/lib/query-persister';

const USER_SCOPED_STORAGE_PREFIXES = [
  '@pgwala_resident_meta:',
  '@pgwala_resident_emergency_contact:',
  '@pgwala_property_meta:',
  '@pgwala_chat_last_seen:',
  '@pgwala_notif_prefs:',
  '@pgwala_inbox_read_ids:',
  '@pgwala_notice_read_ids:',
  '@pgwala_rooms:',
  '@pgwala_announcements:',
  '@pgwala_wm_queue:',
] as const;

const USER_SCOPED_EXACT_KEYS = new Set<string>([
  '@pgwala_return_reminder_id',
]);

/**
 * Clears all in-memory & AsyncStorage query caches, any queued offline mutations,
 * and user/property-scoped local storage keys on sign-out or account switch.
 */
export async function clearUserSessionState(): Promise<void> {
  queryClient.clear();
  try {
    await mmkvQueryPersister.removeClient();
  } catch {
    // Non-fatal MMKV cleanup error
  }

  await Promise.all([
    clearQueryCache().catch(() => {}),
    clearOfflineQueue().catch(() => {}),
    (async () => {
      try {
        const allKeys = await AsyncStorage.getAllKeys();
        const keysToRemove = allKeys.filter(
          (key) =>
            USER_SCOPED_EXACT_KEYS.has(key) ||
            USER_SCOPED_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))
        );
        if (keysToRemove.length > 0) {
          await AsyncStorage.multiRemove(keysToRemove);
        }
      } catch {
        // Non-fatal storage cleanup error
      }
    })(),
  ]);
}
