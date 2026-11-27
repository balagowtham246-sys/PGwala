import { QueryClient } from '@tanstack/react-query';
import type { RealtimeChannel } from '@supabase/supabase-js';

import {
  broadcastPropertySync,
  getLiveConnectionStatus,
  getRealtimeSenderId,
  invalidateDomainCaches,
  registerActiveRealtimeChannel,
  setLiveConnectionStatus,
  shouldSkipPostgresAfterBroadcast,
  subscribeLiveConnectionStatus,
} from '@/lib/realtime-sync';
import * as queryCache from '@/lib/query-cache';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
  multiRemove: jest.fn().mockResolvedValue(undefined),
  getAllKeys: jest.fn().mockResolvedValue([]),
}));

describe('realtime-sync', () => {
  afterEach(() => {
    registerActiveRealtimeChannel(null, null);
    setLiveConnectionStatus('connected');
    jest.restoreAllMocks();
  });

  test('broadcastPropertySync sends domain_sync payload on registered channel', () => {
    const sendMock = jest.fn().mockResolvedValue('ok');
    const fakeChannel = { send: sendMock } as unknown as RealtimeChannel;

    registerActiveRealtimeChannel(fakeChannel, 'prop-1');
    broadcastPropertySync('movement', 'prop-1');

    expect(sendMock).toHaveBeenCalledTimes(1);
    const arg = sendMock.mock.calls[0][0];
    expect(arg.type).toBe('broadcast');
    expect(arg.event).toBe('domain_sync');
    expect(arg.payload.domain).toBe('movement');
    expect(arg.payload.senderId).toBe(getRealtimeSenderId());
    expect(typeof arg.payload.ts).toBe('number');
  });

  test('broadcastPropertySync skips when propertyId mismatches or channel is null', () => {
    const sendMock = jest.fn();
    registerActiveRealtimeChannel({ send: sendMock } as unknown as RealtimeChannel, 'prop-1');
    broadcastPropertySync('billing', 'prop-other');
    expect(sendMock).not.toHaveBeenCalled();

    registerActiveRealtimeChannel(null, null);
    broadcastPropertySync('billing', 'prop-1');
    expect(sendMock).not.toHaveBeenCalled();
  });

  test('invalidateDomainCaches awaits invalidatePrefix before qc.invalidateQueries and refreshes contexts', async () => {
    const order: string[] = [];
    jest.spyOn(queryCache, 'invalidatePrefix').mockImplementation(async (prefix) => {
      order.push(`prefix:${prefix}`);
    });

    const qc = new QueryClient();
    jest.spyOn(qc, 'invalidateQueries').mockImplementation(async (filters) => {
      order.push(`rq:${JSON.stringify(filters?.queryKey)}`);
    });

    const refreshResident = jest.fn(() => order.push('ctx:resident'));
    const refreshProperties = jest.fn(() => order.push('ctx:properties'));
    const refreshProfile = jest.fn(() => order.push('ctx:profile'));

    await invalidateDomainCaches(qc, 'settings', {
      refreshResident,
      refreshProperties,
      refreshProfile,
    });

    const firstRqIdx = order.findIndex((x) => x.startsWith('rq:'));
    const lastPrefixIdx = order.reduce(
      (last, x, i) => (x.startsWith('prefix:') ? i : last),
      -1
    );
    expect(lastPrefixIdx).toBeGreaterThanOrEqual(0);
    expect(firstRqIdx).toBeGreaterThan(lastPrefixIdx);
    expect(refreshResident).toHaveBeenCalledTimes(1);
    expect(refreshProperties).toHaveBeenCalledTimes(1);
    expect(refreshProfile).toHaveBeenCalledTimes(1);
  });

  test('shouldSkipPostgresAfterBroadcast deduplicates within window', () => {
    expect(shouldSkipPostgresAfterBroadcast(undefined, 5000)).toBe(false);
    expect(shouldSkipPostgresAfterBroadcast(4500, 5000, 1500)).toBe(true);
    expect(shouldSkipPostgresAfterBroadcast(3000, 5000, 1500)).toBe(false);
  });

  test('live connection status notifies subscribers on state transitions', () => {
    const listener = jest.fn();
    const unsub = subscribeLiveConnectionStatus(listener);
    expect(getLiveConnectionStatus()).toBe('connected');

    setLiveConnectionStatus('reconnecting');
    setLiveConnectionStatus('reconnecting'); // no-op duplicate
    setLiveConnectionStatus('connected');

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenNthCalledWith(1, 'reconnecting');
    expect(listener).toHaveBeenNthCalledWith(2, 'connected');
    unsub();
  });
});
