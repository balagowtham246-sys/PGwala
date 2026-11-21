import { Platform } from 'react-native';
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';
import type { MMKV } from 'react-native-mmkv';

const MMKV_INSTANCE_ID = 'pgwala-query-cache';
export const QUERY_CACHE_STORAGE_KEY = 'pgwala.tanstack.query.cache.v1';
export const QUERY_CACHE_BUSTER = 'v1';
export const QUERY_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

let mmkvInstance: MMKV | null | undefined;

function getMmkvInstance(): MMKV | null {
  if (mmkvInstance !== undefined) {
    return mmkvInstance;
  }
  if (Platform.OS === 'web') {
    mmkvInstance = null;
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createMMKV } = require('react-native-mmkv') as typeof import('react-native-mmkv');
    mmkvInstance = createMMKV({ id: MMKV_INSTANCE_ID });
  } catch {
    // Expo Go or unsupported runtimes without Nitro/MMKV native module fall back gracefully.
    mmkvInstance = null;
  }
  return mmkvInstance;
}

/**
 * Resets the cached MMKV handle (for unit tests only).
 */
export function resetMmkvPersisterForTests(): void {
  mmkvInstance = undefined;
}

/**
 * Synchronous MMKV-backed TanStack Query persister for instant cold-start hydration
 * in EAS development and production builds.
 */
export const mmkvQueryPersister: Persister = {
  persistClient: (client: PersistedClient) => {
    const storage = getMmkvInstance();
    if (!storage) return;
    try {
      storage.set(QUERY_CACHE_STORAGE_KEY, JSON.stringify(client));
    } catch {
      // Non-fatal persistence write failure
    }
  },
  restoreClient: (): PersistedClient | undefined => {
    const storage = getMmkvInstance();
    if (!storage) return undefined;
    try {
      const raw = storage.getString(QUERY_CACHE_STORAGE_KEY);
      if (!raw) return undefined;
      return JSON.parse(raw) as PersistedClient;
    } catch {
      try {
        storage.remove(QUERY_CACHE_STORAGE_KEY);
      } catch {
        // Ignore cleanup failure
      }
      return undefined;
    }
  },
  removeClient: () => {
    const storage = getMmkvInstance();
    if (!storage) return;
    try {
      storage.remove(QUERY_CACHE_STORAGE_KEY);
    } catch {
      // Non-fatal cleanup failure
    }
  },
};
