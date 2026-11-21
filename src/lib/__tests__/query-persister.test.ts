import type { PersistedClient } from '@tanstack/react-query-persist-client';

import {
  mmkvQueryPersister,
  QUERY_CACHE_STORAGE_KEY,
  resetMmkvPersisterForTests,
} from '@/lib/query-persister';

const mockStore = new Map<string, string>();
let mockShouldThrowOnCreate = false;

jest.mock('react-native-mmkv', () => ({
  createMMKV: () => {
    if (mockShouldThrowOnCreate) {
      throw new Error('Nitro/MMKV not available in Expo Go');
    }
    return {
      set: (key: string, value: string) => {
        mockStore.set(key, value);
      },
      getString: (key: string) => mockStore.get(key),
      remove: (key: string) => mockStore.delete(key),
    };
  },
}));

describe('mmkvQueryPersister', () => {
  beforeEach(() => {
    mockStore.clear();
    mockShouldThrowOnCreate = false;
    resetMmkvPersisterForTests();
  });

  it('persists, restores, and removes dehydrated TanStack Query client synchronously', () => {
    const sampleClient: PersistedClient = {
      timestamp: 1700000000000,
      buster: 'v1',
      clientState: {
        mutations: [],
        queries: [
          {
            dehydratedAt: 1700000000000,
            queryKey: ['billing', 'student', 'user-1'],
            queryHash: '["billing","student","user-1"]',
            state: {
              data: { balance: 800000 },
              dataUpdateCount: 1,
              dataUpdatedAt: 1700000000000,
              error: null,
              errorUpdateCount: 0,
              errorUpdatedAt: 0,
              fetchFailureCount: 0,
              fetchFailureReason: null,
              fetchMeta: null,
              isInvalidated: false,
              status: 'success',
              fetchStatus: 'idle',
            },
          },
        ],
      },
    };

    mmkvQueryPersister.persistClient(sampleClient);
    expect(mockStore.has(QUERY_CACHE_STORAGE_KEY)).toBe(true);

    const restored = mmkvQueryPersister.restoreClient();
    expect(restored).toEqual(sampleClient);

    mmkvQueryPersister.removeClient();
    expect(mmkvQueryPersister.restoreClient()).toBeUndefined();
  });

  it('clears corrupt JSON payloads and returns undefined safely', () => {
    mockStore.set(QUERY_CACHE_STORAGE_KEY, '{not-valid-json');
    expect(mmkvQueryPersister.restoreClient()).toBeUndefined();
    expect(mockStore.has(QUERY_CACHE_STORAGE_KEY)).toBe(false);
  });

  it('falls back safely when MMKV native module is unavailable (e.g. Expo Go)', () => {
    mockShouldThrowOnCreate = true;
    const sampleClient: PersistedClient = {
      timestamp: 1700000000000,
      buster: 'v1',
      clientState: { mutations: [], queries: [] },
    };

    expect(() => mmkvQueryPersister.persistClient(sampleClient)).not.toThrow();
    expect(mmkvQueryPersister.restoreClient()).toBeUndefined();
    expect(() => mmkvQueryPersister.removeClient()).not.toThrow();
  });
});
