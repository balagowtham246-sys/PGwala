import AsyncStorage from '@react-native-async-storage/async-storage';

import { enqueueOfflineMutation, getPendingCount } from '@/lib/offline-queue';
import { getCached, setCached } from '@/lib/query-cache';
import { clearUserSessionState } from '@/lib/session-cleanup';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

describe('session-cleanup', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('clears query cache, offline queue, and user-scoped storage keys while keeping unrelated keys', async () => {
    await setCached('billing:student:user-1', { due: 8000 }, 60_000);
    await enqueueOfflineMutation(
      'food_opt_in',
      { value: false },
      'food-user-1-123'
    );
    await AsyncStorage.setItem('@pgwala_resident_meta:res-1', '{"room":"101"}');
    await AsyncStorage.setItem('@pgwala_inbox_read_ids:owner-1:prop-1', '["id-1"]');
    await AsyncStorage.setItem('@pgwala_return_reminder_id', 'notif-1');
    await AsyncStorage.setItem('unrelated_device_flag', 'keep-me');

    expect(await getCached('billing:student:user-1')).toEqual({ due: 8000 });
    expect(await getPendingCount()).toBe(1);

    await clearUserSessionState();

    expect(await getCached('billing:student:user-1')).toBeNull();
    expect(await getPendingCount()).toBe(0);
    expect(await AsyncStorage.getItem('@pgwala_resident_meta:res-1')).toBeNull();
    expect(await AsyncStorage.getItem('@pgwala_inbox_read_ids:owner-1:prop-1')).toBeNull();
    expect(await AsyncStorage.getItem('@pgwala_return_reminder_id')).toBeNull();
    expect(await AsyncStorage.getItem('unrelated_device_flag')).toBe('keep-me');
  });
});
