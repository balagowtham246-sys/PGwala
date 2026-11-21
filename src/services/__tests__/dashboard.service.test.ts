import { clearOfflineQueue, getPendingCount } from '@/lib/offline-queue';
import { resetPerfMonitor } from '@/lib/perf-monitor';
import { clearQueryCache } from '@/lib/query-cache';
import { supabase } from '@/lib/supabase';
import {
  fetchOwnerDashboard,
  fetchStudentDashboard,
  getCachedOwnerDashboard,
  getCachedStudentDashboard,
  recordStudentMovement,
} from '../dashboard.service';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(),
  },
}));

const mockedRpc = supabase.rpc as jest.Mock;
const mockedFrom = supabase.from as jest.Mock;

describe('dashboard.service', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    resetPerfMonitor();
    await clearQueryCache();
    await clearOfflineQueue();
  });

  it('fetches owner dashboard via fast-path RPC + parallel billing counts and caches result', async () => {
    mockedRpc.mockResolvedValueOnce({
      data: {
        success: true,
        stats: {
          totalResidents: 12,
          studentsInside: 9,
          studentsOutside: 3,
          openComplaintsCount: 2,
        },
        todayMenus: [
          {
            id: 'menu-1',
            meal_type: 'breakfast',
            items: 'Idli, Chutney',
            notes: null,
            is_published: true,
          },
        ],
        recentActivities: [],
        washingMachines: {
          totalCount: 2,
          inUseCount: 1,
          freeCount: 1,
          units: [],
        },
      },
      error: null,
    });

    mockedFrom.mockImplementation((table: string) => {
      if (table === 'charges') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: jest.fn().mockResolvedValue({
                  data: [
                    { amount_paise: 800000, status: 'paid' },
                    { amount_paise: 850000, status: 'outstanding' },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'student_payment_reports') {
        return {
          select: () => ({
            eq: () => ({
              eq: jest.fn().mockResolvedValue({ count: 3, error: null }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const res = await fetchOwnerDashboard('prop-1', {
      dateIso: '2026-11-19',
      monthStartIso: '2026-11-01',
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.stats.totalResidents).toBe(12);
      expect(res.data.stats.rentCollectedPaise).toBe(800000);
      expect(res.data.stats.rentTotalPaise).toBe(1650000);
      expect(res.data.stats.pendingProofsCount).toBe(3);
      expect(res.data.todayMenus.breakfast?.items).toBe('Idli, Chutney');
    }

    const cached = await getCachedOwnerDashboard('prop-1');
    expect(cached?.stats.pendingProofsCount).toBe(3);
  });

  it('fetches student dashboard via fast-path RPC and caches result', async () => {
    mockedRpc.mockResolvedValueOnce({
      data: {
        success: true,
        publishedMenus: [
          {
            id: 'm1',
            meal_type: 'dinner',
            items: 'Chapati, Dal',
            notes: null,
            is_published: true,
          },
        ],
        gateStatus: {
          direction: 'IN',
          eventTime: '2026-11-19T12:00:00Z',
          purpose: null,
          expectedReturnTime: null,
          foodRequired: true,
        },
      },
      error: null,
    });

    mockedFrom.mockImplementation((table: string) => {
      if (table === 'residents') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: jest.fn().mockResolvedValue({
                  data: {
                    id: 'res-1',
                    property_id: 'prop-1',
                    profile_id: 'user-1',
                    full_name: 'Asha',
                    room_number: '101',
                    phone_number: '9999999999',
                    is_active: true,
                    property: { id: 'prop-1', name: 'Alpha PG', address: 'Main Rd' },
                  },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'charges') {
        return {
          select: () => ({
            eq: () => ({
              eq: jest.fn().mockResolvedValue({
                data: [{ amount_paise: 500000 }],
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'property_chat_messages') {
        return {
          select: () => ({
            eq: () => ({
              neq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: jest.fn().mockResolvedValue({
                        data: { created_at: '2026-11-19T13:00:00Z', resident_id: 'res-2' },
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const res = await fetchStudentDashboard('user-1', { dateIso: '2026-11-19' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.resident?.full_name).toBe('Asha');
      expect(res.data.pendingDuesPaise).toBe(500000);
      expect(res.data.menus.dinner?.items).toBe('Chapati, Dal');
      expect(res.data.latestMovement?.direction).toBe('IN');
      expect(res.data.hasUnreadChat).toBe(true);
    }

    const cached = await getCachedStudentDashboard('user-1');
    expect(cached?.pendingDuesPaise).toBe(500000);
  });

  it('queues gate_movement_log offline on network errors, but surfaces non-network errors without queuing', async () => {
    mockedRpc.mockRejectedValueOnce(new Error('Network request failed'));

    const queued = await recordStudentMovement({
      direction: 'OUT',
      purpose: 'College',
      foodRequired: true,
      userId: 'user-1',
      idempotencyKey: 'gate-test-1',
    });

    expect(queued).toEqual({ ok: true, data: { queued: true } });
    expect(await getPendingCount()).toBe(1);

    mockedRpc.mockResolvedValueOnce({
      data: { success: false, error: 'Resident not active' },
      error: null,
    });

    const failed = await recordStudentMovement({
      direction: 'IN',
      userId: 'user-1',
    });

    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error.message).toBe('Resident not active');
    }
    expect(await getPendingCount()).toBe(1);
  });
});
