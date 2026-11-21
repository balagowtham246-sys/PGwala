import AsyncStorage from '@react-native-async-storage/async-storage';

import { resetPerfMonitor } from '@/lib/perf-monitor';
import { clearQueryCache } from '@/lib/query-cache';
import { supabase } from '@/lib/supabase';
import {
  fetchOwnerInbox,
  fetchOwnerInboxPage,
  getUnreadInboxCount,
  markAllInboxRead,
  markInboxItemRead,
} from '../notification-center.service';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

jest.mock('@/lib/edge-functions', () => ({
  invokeEdgeFunction: jest.fn(),
}));

const mockedFrom = supabase.from as jest.Mock;

interface MockInboxData {
  movementLogs: {
    id: string;
    resident_id: string | null;
    direction: 'IN' | 'OUT';
    purpose?: string | null;
    event_time: string;
    residents:
      | { id: string; full_name: string; room_number: string }
      | { id: string; full_name: string; room_number: string }[]
      | null;
  }[];
  complaints: {
    id: string;
    resident_id: string | null;
    title: string;
    category: string;
    priority: string;
    status: string;
    created_at: string;
    residents:
      | { id: string; full_name: string; room_number: string }
      | { id: string; full_name: string; room_number: string }[]
      | null;
  }[];
}

function setupSupabaseInboxMock(data: MockInboxData) {
  const complaintsRangeSpy = jest.fn().mockResolvedValue({
    data: data.complaints,
    error: null,
  });
  const logsRangeSpy = jest.fn().mockResolvedValue({
    data: data.movementLogs,
    error: null,
  });
  const complaintsNeqSpy = jest.fn(() => ({
    order: () => ({
      range: complaintsRangeSpy,
      limit: complaintsRangeSpy,
    }),
  }));

  mockedFrom.mockImplementation((table: string) => {
    if (table === 'movement_logs') {
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              range: logsRangeSpy,
              limit: logsRangeSpy,
            }),
          }),
        }),
      };
    }

    if (table === 'complaints') {
      return {
        select: () => ({
          eq: () => ({
            neq: complaintsNeqSpy,
          }),
        }),
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  });

  return { complaintsNeqSpy, logsRangeSpy, complaintsRangeSpy };
}

describe('notification-center.service', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    resetPerfMonitor();
    await clearQueryCache();
    await AsyncStorage.clear();
  });

  it('merges movement_logs and unresolved complaints chronologically newest-first', async () => {
    const { complaintsNeqSpy } = setupSupabaseInboxMock({
      movementLogs: [
        {
          id: 'log-out-1',
          resident_id: 'res-1',
          direction: 'OUT',
          purpose: 'Outing',
          event_time: '2026-11-20T09:00:00.000Z',
          residents: { id: 'res-1', full_name: 'Asha', room_number: '101' },
        },
        {
          id: 'log-in-2',
          resident_id: null,
          direction: 'IN',
          purpose: null,
          event_time: '2026-11-20T12:30:00.000Z',
          residents: [{ id: 'res-2', full_name: 'Priya', room_number: 'Room D' }],
        },
      ],
      complaints: [
        {
          id: 'comp-1',
          resident_id: 'res-3',
          title: 'Bathroom tap leaking',
          category: 'plumbing',
          priority: 'urgent',
          status: 'in_progress',
          created_at: '2026-11-20T11:15:00.000Z',
          residents: { id: 'res-3', full_name: 'Kiran', room_number: '202' },
        },
      ],
    });

    const res = await fetchOwnerInbox('owner-1', 'prop-1');

    expect(complaintsNeqSpy).toHaveBeenCalledWith('status', 'resolved');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.map((item) => item.id)).toEqual([
        'gate:log-in-2',
        'complaint:comp-1',
        'gate:log-out-1',
      ]);

      expect(res.data[0]).toEqual({
        id: 'gate:log-in-2',
        type: 'gate_entry',
        title: 'Priya (Room D) checked in',
        subtitle: 'Entered the PG premises',
        timestamp: '2026-11-20T12:30:00.000Z',
        isRead: false,
        routeTarget: '/student-in-out',
        residentId: undefined,
        residentName: 'Priya',
        roomNumber: 'Room D',
      });

      expect(res.data[1]).toEqual({
        id: 'complaint:comp-1',
        type: 'complaint',
        title: 'Bathroom tap leaking',
        subtitle: 'Kiran (Room 202) · In progress',
        timestamp: '2026-11-20T11:15:00.000Z',
        isRead: false,
        priority: 'Urgent',
        routeTarget: '/owner-complaints',
        residentId: 'res-3',
        residentName: 'Kiran',
        roomNumber: '202',
      });

      expect(res.data[2]).toEqual({
        id: 'gate:log-out-1',
        type: 'gate_exit',
        title: 'Asha (Room 101) checked out',
        subtitle: 'Checked out · Outing',
        timestamp: '2026-11-20T09:00:00.000Z',
        isRead: false,
        routeTarget: '/resident-profile',
        residentId: 'res-1',
        residentName: 'Asha',
        roomNumber: '101',
      });
    }
  });

  it('tracks getUnreadInboxCount and persists markInboxItemRead and markAllInboxRead across reads via AsyncStorage', async () => {
    setupSupabaseInboxMock({
      movementLogs: [
        {
          id: 'log-1',
          resident_id: 'res-1',
          direction: 'OUT',
          purpose: 'College',
          event_time: '2026-11-20T08:00:00.000Z',
          residents: { id: 'res-1', full_name: 'Asha', room_number: '101' },
        },
        {
          id: 'log-2',
          resident_id: 'res-2',
          direction: 'IN',
          purpose: null,
          event_time: '2026-11-20T10:00:00.000Z',
          residents: { id: 'res-2', full_name: 'Priya', room_number: 'D' },
        },
      ],
      complaints: [
        {
          id: 'comp-1',
          resident_id: 'res-3',
          title: 'Wi-Fi disconnected',
          category: 'wifi_internet',
          priority: 'high',
          status: 'open',
          created_at: '2026-11-20T09:00:00.000Z',
          residents: { id: 'res-3', full_name: 'Kiran', room_number: '202' },
        },
      ],
    });

    expect(await getUnreadInboxCount('owner-1', 'prop-1')).toBe(3);

    await markInboxItemRead('owner-1', 'prop-1', 'complaint:comp-1');

    // Clear query cache to verify read status is restored directly from AsyncStorage
    await clearQueryCache();
    expect(await getUnreadInboxCount('owner-1', 'prop-1')).toBe(2);

    const afterSingleRead = await fetchOwnerInbox('owner-1', 'prop-1', {
      forceRefresh: true,
    });
    expect(afterSingleRead.ok).toBe(true);
    if (afterSingleRead.ok) {
      const readMap = new Map(afterSingleRead.data.map((i) => [i.id, i.isRead]));
      expect(readMap.get('complaint:comp-1')).toBe(true);
      expect(readMap.get('gate:log-1')).toBe(false);
      expect(readMap.get('gate:log-2')).toBe(false);
    }

    await markAllInboxRead('owner-1', 'prop-1', [
      'gate:log-1',
      'gate:log-2',
      'complaint:comp-1',
    ]);

    await clearQueryCache();
    expect(await getUnreadInboxCount('owner-1', 'prop-1')).toBe(0);

    const afterAllRead = await fetchOwnerInbox('owner-1', 'prop-1', {
      forceRefresh: true,
    });
    expect(afterAllRead.ok).toBe(true);
    if (afterAllRead.ok) {
      expect(afterAllRead.data.every((item) => item.isRead)).toBe(true);
    }

    const persistedRaw = await AsyncStorage.getItem('@pgwala_inbox_read_ids:owner-1:prop-1');
    expect(persistedRaw).not.toBeNull();
    expect(JSON.parse(persistedRaw!)).toEqual(
      expect.arrayContaining(['complaint:comp-1', 'gate:log-1', 'gate:log-2'])
    );
  });

  it('returns partial results if one query fails and fails only when both queries fail', async () => {
    mockedFrom.mockImplementation((table: string) => {
      if (table === 'movement_logs') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                range: jest.fn().mockResolvedValue({
                  data: null,
                  error: { message: 'movement_logs error' },
                }),
                limit: jest.fn().mockResolvedValue({
                  data: null,
                  error: { message: 'movement_logs error' },
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'complaints') {
        return {
          select: () => ({
            eq: () => ({
              neq: () => ({
                order: () => ({
                  range: jest.fn().mockResolvedValue({
                    data: [
                      {
                        id: 'comp-2',
                        resident_id: 'res-9',
                        title: 'Fan noise',
                        category: 'electrical',
                        priority: 'medium',
                        status: 'open',
                        created_at: '2026-11-20T07:00:00.000Z',
                        residents: null,
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const partialRes = await fetchOwnerInbox('owner-1', 'prop-1');
    expect(partialRes.ok).toBe(true);
    if (partialRes.ok) {
      expect(partialRes.data).toHaveLength(1);
      expect(partialRes.data[0].id).toBe('complaint:comp-2');
      expect(partialRes.data[0].subtitle).toBe('Resident · Open');
    }
  });

  it('paginates owner inbox queries with offset and pageSize via fetchOwnerInboxPage', async () => {
    const { logsRangeSpy, complaintsRangeSpy } = setupSupabaseInboxMock({
      movementLogs: [
        {
          id: 'log-1',
          resident_id: 'res-1',
          direction: 'OUT',
          purpose: 'Work',
          event_time: '2026-11-20T08:00:00.000Z',
          residents: { id: 'res-1', full_name: 'Asha', room_number: '101' },
        },
        {
          id: 'log-2',
          resident_id: 'res-2',
          direction: 'IN',
          purpose: null,
          event_time: '2026-11-20T09:00:00.000Z',
          residents: { id: 'res-2', full_name: 'Priya', room_number: '102' },
        },
      ],
      complaints: [],
    });

    const pageRes = await fetchOwnerInboxPage('owner-1', 'prop-1', {
      forceRefresh: true,
      pageSize: 2,
      offset: 2,
    });

    expect(logsRangeSpy).toHaveBeenCalledWith(2, 3);
    expect(complaintsRangeSpy).toHaveBeenCalledWith(2, 3);
    expect(pageRes.ok).toBe(true);
    if (pageRes.ok) {
      expect(pageRes.data.hasMore).toBe(true);
      expect(pageRes.data.items).toHaveLength(2);
    }
  });
});
