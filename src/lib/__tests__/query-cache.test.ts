jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getPerfSnapshot, resetPerfMonitor } from '../perf-monitor';
import {
  clearQueryCache,
  getCached,
  getCachedEntry,
  invalidateKey,
  invalidatePrefix,
  setCached,
  subscribeCache,
} from '../query-cache';

describe('query-cache', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    resetPerfMonitor();
    await clearQueryCache();
    await AsyncStorage.clear();
  });

  it('stores, reads, and reports fresh vs stale TTL state', async () => {
    await setCached('billing:owner:prop1:2026-11', { total: 12000 }, 5_000);

    const fresh = await getCachedEntry<{ total: number }>('billing:owner:prop1:2026-11');
    expect(fresh).not.toBeNull();
    expect(fresh?.data).toEqual({ total: 12000 });
    expect(fresh?.isStale).toBe(false);

    // Expire via short TTL
    await setCached('billing:owner:prop1:stale', { total: 500 }, 0);
    await new Promise((r) => setTimeout(r, 15));
    const stale = await getCachedEntry<{ total: number }>('billing:owner:prop1:stale');
    expect(stale?.isStale).toBe(true);
    expect(stale?.data).toEqual({ total: 500 });
  });

  it('falls back to AsyncStorage when memory cache is cleared', async () => {
    await setCached('dashboard:student:u1', { room: '204' }, 60_000);
    // Simulate cold memory state while AsyncStorage persists
    const raw = await AsyncStorage.getItem('@pgwala_cache:dashboard:student:u1');
    expect(raw).toBeTruthy();

    await invalidateKey('dashboard:student:u1');
    expect(await getCached('dashboard:student:u1')).toBeNull();

    // Put directly into AsyncStorage to verify hydration path
    await AsyncStorage.setItem(
      '@pgwala_cache:dashboard:student:hydrated',
      JSON.stringify({ data: { room: '301' }, updatedAt: Date.now(), expiresAt: Date.now() + 60_000 })
    );
    const hydrated = await getCached<{ room: string }>('dashboard:student:hydrated');
    expect(hydrated).toEqual({ room: '301' });
  });

  it('invalidates matching prefixes and notifies subscribers', async () => {
    const listener = jest.fn();
    const unsub = subscribeCache('billing:owner:p1', listener);

    await setCached('billing:owner:p1', { ok: 1 });
    await setCached('billing:owner:p2', { ok: 2 });
    await setCached('food-menu:p1', { ok: 3 });

    expect(listener).toHaveBeenCalledTimes(1);

    await invalidatePrefix('billing:');
    expect(await getCached('billing:owner:p1')).toBeNull();
    expect(await getCached('billing:owner:p2')).toBeNull();
    expect(await getCached('food-menu:p1')).toEqual({ ok: 3 });
    expect(listener).toHaveBeenCalledTimes(2);

    unsub();
  });

  it('records cache read and write timing samples in perf-monitor', async () => {
    await setCached('perf:key', { v: 1 });
    await getCached('perf:key');
    await getCached('perf:missing');

    const snapshot = getPerfSnapshot();
    expect(snapshot.totals.cacheWrites).toBeGreaterThanOrEqual(1);
    expect(snapshot.totals.cacheReads).toBeGreaterThanOrEqual(2);
    expect(snapshot.totals.avgCacheWriteMs).toBeGreaterThanOrEqual(0);
    expect(snapshot.totals.avgCacheReadMs).toBeGreaterThanOrEqual(0);
  });
});
