jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  APPROVED_OFFLINE_OPERATIONS,
  clearOfflineQueue,
  enqueueOfflineMutation,
  flushOfflineQueue,
  getOfflineQueue,
  getPendingCount,
  isApprovedOfflineOperation,
} from '../offline-queue';

describe('offline-queue', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    await clearOfflineQueue();
  });

  it('only approves gate_movement_log, food_opt_in, and complaint_submit', () => {
    expect(APPROVED_OFFLINE_OPERATIONS).toEqual([
      'gate_movement_log',
      'food_opt_in',
      'complaint_submit',
    ]);
    expect(isApprovedOfflineOperation('gate_movement_log')).toBe(true);
    expect(isApprovedOfflineOperation('food_opt_in')).toBe(true);
    expect(isApprovedOfflineOperation('complaint_submit')).toBe(true);

    expect(isApprovedOfflineOperation('confirm_monthly_payment')).toBe(false);
    expect(isApprovedOfflineOperation('generate_monthly_bills')).toBe(false);
    expect(isApprovedOfflineOperation('submit_student_payment_proof')).toBe(false);
    expect(isApprovedOfflineOperation('create_resident')).toBe(false);
  });

  it('explicitly rejects unapproved financial and admin operations', async () => {
    await expect(
      enqueueOfflineMutation('confirm_monthly_payment', { charge_id: 'c1' }, 'pay-1')
    ).rejects.toThrow('not approved for offline queuing');

    await expect(
      enqueueOfflineMutation('generate_monthly_bills', { property_id: 'p1' }, 'bill-1')
    ).rejects.toThrow('not approved for offline queuing');

    await expect(
      enqueueOfflineMutation('create_resident', { email: 'a@b.com' }, 'res-1')
    ).rejects.toThrow('not approved for offline queuing');

    expect(await getPendingCount()).toBe(0);
  });

  it('deduplicates approved operations by operation + idempotencyKey', async () => {
    await enqueueOfflineMutation(
      'gate_movement_log',
      { p_direction: 'OUT', p_purpose: 'College' },
      'gate-1'
    );
    await enqueueOfflineMutation(
      'gate_movement_log',
      { p_direction: 'OUT', p_purpose: 'College' },
      'gate-1'
    );
    await enqueueOfflineMutation('food_opt_in', { value: false }, 'food-1');

    expect(await getPendingCount()).toBe(2);
    const items = await getOfflineQueue();
    expect(items.map((i) => i.operation)).toEqual(['gate_movement_log', 'food_opt_in']);
  });

  it('flushes succeeded items, retains transient network errors up to maxAttempts, and drops permanent errors', async () => {
    await enqueueOfflineMutation('gate_movement_log', { p_direction: 'IN' }, 'k-ok');
    await enqueueOfflineMutation('food_opt_in', { value: true }, 'k-net', 2);
    await enqueueOfflineMutation(
      'complaint_submit',
      { title: 'Broken tap' },
      'k-bad',
      3
    );

    const firstFlush = await flushOfflineQueue({
      gate_movement_log: async () => undefined,
      food_opt_in: async () => {
        throw new Error('Network request failed');
      },
      complaint_submit: async () => {
        const err = new Error('RLS policy rejected insert');
        (err as any).status = 403;
        throw err;
      },
    });

    expect(firstFlush).toEqual({
      succeeded: 1,
      failedPermanent: 1,
      retainedForRetry: 1,
      remainingCount: 1,
    });

    // Second network failure reaches maxAttempts=2 and drops
    const secondFlush = await flushOfflineQueue({
      food_opt_in: async () => {
        throw new Error('Failed to fetch');
      },
    });

    expect(secondFlush).toEqual({
      succeeded: 0,
      failedPermanent: 1,
      retainedForRetry: 0,
      remainingCount: 0,
    });
  });
});
