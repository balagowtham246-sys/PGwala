import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform, TurboModuleRegistry } from 'react-native';
import type { MMKV } from 'react-native-mmkv';

const MMKV_INSTANCE_ID = 'pgwala-query-cache';
export const QUERY_CACHE_STORAGE_KEY = 'pgwala.tanstack.query.cache.v1';
export const QUERY_CACHE_BUSTER = 'v1';
export const QUERY_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PERSIST_DEBOUNCE_MS = 1500;

let mmkvInstance: MMKV | null | undefined;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingClient: PersistedClient | null = null;

function cancelPendingPersist(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  pendingClient = null;
}

function writeClientToStorage(client: PersistedClient): void {
  const storage = getMmkvInstance();
  if (!storage) return;
  try {
    storage.set(QUERY_CACHE_STORAGE_KEY, JSON.stringify(client));
  } catch {
    // Non-fatal persistence write failure
  }
}

function getMmkvInstance(): MMKV | null {
  if (mmkvInstance !== undefined) {
    return mmkvInstance;
  }
  if (
    Platform.OS === 'web' ||
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient ||
    (process.env.NODE_ENV !== 'test' && !TurboModuleRegistry.get('NitroModules'))
  ) {
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
  cancelPendingPersist();
  mmkvInstance = undefined;
}

/**
 * MMKV-backed TanStack Query persister.
 * - Restores synchronously on cold start for instant hydration.
 * - Debounces & defers writes past active UI interactions in runtime builds
 *   so JSON.stringify never blocks button taps, scrolls, or animations.
 */
export const mmkvQueryPersister: Persister = {
  persistClient: (client: PersistedClient) => {
    if (process.env.NODE_ENV === 'test') {
      writeClientToStorage(client);
      return;
    }
    pendingClient = client;
    if (persistTimer) {
      clearTimeout(persistTimer);
    }
    persistTimer = setTimeout(() => {
      persistTimer = null;
      const toWrite = pendingClient;
      pendingClient = null;
      if (!toWrite) return;
      writeClientToStorage(toWrite);
    }, PERSIST_DEBOUNCE_MS);
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
    cancelPendingPersist();
    const storage = getMmkvInstance();
    if (!storage) return;
    try {
      storage.remove(QUERY_CACHE_STORAGE_KEY);
    } catch {
      // Non-fatal cleanup failure
    }
  },
};
