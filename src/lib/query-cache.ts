import { recordCacheRead, recordCacheWrite } from '@/lib/perf-monitor';
import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_STORAGE_PREFIX = '@pgwala_cache:';
export const DEFAULT_CACHE_TTL_MS = 60_000;

export interface CacheEntry<T> {
  data: T;
  updatedAt: number;
  expiresAt: number;
}

export interface CachedReadResult<T> {
  data: T;
  isStale: boolean;
  updatedAt: number;
}

type CacheListener = () => void;

const memoryCache = new Map<string, CacheEntry<unknown>>();
const listeners = new Map<string, Set<CacheListener>>();

const nowMs = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

function storageKeyFor(key: string): string {
  return `${CACHE_STORAGE_PREFIX}${key}`;
}

function notifyKey(key: string): void {
  const subs = listeners.get(key);
  if (!subs) return;
  for (const listener of subs) {
    listener();
  }
}

function notifyPrefix(prefix: string): void {
  for (const [key, subs] of listeners.entries()) {
    if (key.startsWith(prefix)) {
      for (const listener of subs) {
        listener();
      }
    }
  }
}

export async function getCachedEntry<T>(key: string): Promise<CachedReadResult<T> | null> {
  const start = nowMs();

  const memEntry = memoryCache.get(key) as CacheEntry<T> | undefined;
  if (memEntry) {
    recordCacheRead(key, nowMs() - start, true);
    return {
      data: memEntry.data,
      isStale: Date.now() > memEntry.expiresAt,
      updatedAt: memEntry.updatedAt,
    };
  }

  try {
    const raw = await AsyncStorage.getItem(storageKeyFor(key));
    if (!raw) {
      recordCacheRead(key, nowMs() - start, false);
      return null;
    }
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    if (
      !parsed ||
      typeof parsed.updatedAt !== 'number' ||
      typeof parsed.expiresAt !== 'number' ||
      !('data' in parsed)
    ) {
      recordCacheRead(key, nowMs() - start, false);
      return null;
    }

    memoryCache.set(key, parsed as CacheEntry<unknown>);
    recordCacheRead(key, nowMs() - start, true);
    return {
      data: parsed.data,
      isStale: Date.now() > parsed.expiresAt,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    recordCacheRead(key, nowMs() - start, false);
    return null;
  }
}

/**
 * Convenience helper returning cached data if present (fresh or stale for SWR), or null on miss.
 */
export async function getCached<T>(key: string): Promise<T | null> {
  const entry = await getCachedEntry<T>(key);
  return entry ? entry.data : null;
}

export async function setCached<T>(
  key: string,
  data: T,
  ttlMs: number = DEFAULT_CACHE_TTL_MS
): Promise<void> {
  const start = nowMs();
  const now = Date.now();
  const entry: CacheEntry<T> = {
    data,
    updatedAt: now,
    expiresAt: now + Math.max(0, ttlMs),
  };
  memoryCache.set(key, entry as CacheEntry<unknown>);

  try {
    await AsyncStorage.setItem(storageKeyFor(key), JSON.stringify(entry));
  } catch {
    // Non-fatal: memory cache still holds the entry
  } finally {
    recordCacheWrite(key, nowMs() - start);
    notifyKey(key);
  }
}

export async function invalidateKey(key: string): Promise<void> {
  memoryCache.delete(key);
  try {
    await AsyncStorage.removeItem(storageKeyFor(key));
  } catch {
    // Ignore storage removal errors
  } finally {
    notifyKey(key);
  }
}

export async function invalidatePrefix(prefix: string): Promise<void> {
  for (const key of Array.from(memoryCache.keys())) {
    if (key.startsWith(prefix)) {
      memoryCache.delete(key);
    }
  }

  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const matchingStorageKeys = allKeys.filter((k) =>
      k.startsWith(storageKeyFor(prefix))
    );
    if (matchingStorageKeys.length > 0) {
      await AsyncStorage.multiRemove(matchingStorageKeys);
    }
  } catch {
    // Ignore storage removal errors
  } finally {
    notifyPrefix(prefix);
  }
}

export function subscribeCache(key: string, listener: CacheListener): () => void {
  let subs = listeners.get(key);
  if (!subs) {
    subs = new Set();
    listeners.set(key, subs);
  }
  subs.add(listener);

  return () => {
    const existing = listeners.get(key);
    if (!existing) return;
    existing.delete(listener);
    if (existing.size === 0) {
      listeners.delete(key);
    }
  };
}

export async function clearQueryCache(): Promise<void> {
  memoryCache.clear();
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const cacheKeys = allKeys.filter((k) => k.startsWith(CACHE_STORAGE_PREFIX));
    if (cacheKeys.length > 0) {
      await AsyncStorage.multiRemove(cacheKeys);
    }
  } catch {
    // Ignore
  }
}

