import AsyncStorage from '@react-native-async-storage/async-storage';

import { resetPerfMonitor } from '@/lib/perf-monitor';
import { clearQueryCache } from '@/lib/query-cache';
import { supabase } from '@/lib/supabase';
import {
  fetchResidentNotices,
  getUnreadResidentNoticesSummary,
  markAllResidentNoticesRead,
  markResidentNoticeRead,
} from '../resident-notices.service';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

const mockedFrom = supabase.from as jest.Mock;

interface MockAnnouncementRow {
  id: string;
  property_id?: string;
  title: string;
  message: string;
  audience: 'all' | 'room';
  room_number: string | null;
  created_at: string;
}

interface MockFoodAlertRow {
  id: string;
  meal_type: 'breakfast' | 'lunch' | 'dinner';
  status: 'ready' | 'delayed' | 'cancelled';
  message: string | null;
  created_at: string;
}

interface MockFoodMenuRow {
  meal_type: 'breakfast' | 'lunch' | 'dinner';
  meal_time: string | null;
}

function setupNoticesSupabaseMock(options: {
  announcements?: {
    data: MockAnnouncementRow[] | null;
    error: { code?: string; message: string } | null;
  };
  foodAlerts?: {
    data: MockFoodAlertRow[] | null;
    error: { code?: string; message: string } | null;
  };
  foodMenus?: {
    data: MockFoodMenuRow[] | null;
    error: { code?: string; message: string } | null;
  };
}) {
  mockedFrom.mockImplementation((table: string) => {
    if (table === 'announcements') {
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: jest.fn().mockResolvedValue(
                options.announcements ?? { data: [], error: null }
              ),
            }),
          }),
        }),
      };
    }

    if (table === 'food_alerts') {
      return {
        select: () => ({
          order: () => ({
            limit: jest.fn().mockResolvedValue(
              options.foodAlerts ?? { data: [], error: null }
            ),
          }),
        }),
      };
    }

    if (table === 'food_menus') {
      return {
        select: () => ({
          eq: () => ({
            eq: jest.fn().mockResolvedValue(
              options.foodMenus ?? { data: [], error: null }
            ),
          }),
        }),
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  });
}

describe('resident-notices.service', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    resetPerfMonitor();
    await clearQueryCache();
    await AsyncStorage.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('filters room-targeted announcements so "Room D" matches resident in "D" and excludes "Room A"', async () => {
    setupNoticesSupabaseMock({
      announcements: {
        data: [
          {
            id: 'ann-all',
            property_id: 'prop-1',
            title: 'Water Tank Maintenance',
            message: 'Supply will pause between 2 PM and 3 PM.',
            audience: 'all',
            room_number: null,
            created_at: '2026-11-20T08:00:00.000Z',
          },
          {
            id: 'ann-room-d',
            property_id: 'prop-1',
            title: 'AC Filter Cleaning',
            message: 'Technician visiting Room D at 4 PM.',
            audience: 'room',
            room_number: 'Room D',
            created_at: '2026-11-20T09:00:00.000Z',
          },
          {
            id: 'ann-room-a',
            property_id: 'prop-1',
            title: 'Window Lock Repair',
            message: 'Carpenter visiting Room A at 5 PM.',
            audience: 'room',
            room_number: 'Room A',
            created_at: '2026-11-20T10:00:00.000Z',
          },
        ],
        error: null,
      },
      foodAlerts: { data: [], error: null },
    });

    const res = await fetchResidentNotices('user-1', 'prop-1', 'D', {
      forceRefresh: true,
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.map((i) => i.id)).toEqual([
        'announcement:ann-room-d',
        'announcement:ann-all',
      ]);
      expect(res.data[0].audienceLabel).toBe('Room D');
      expect(res.data[1].audienceLabel).toBe('All residents');
    }
  });

  it('falls back to @pgwala_announcements:<propertyId> in AsyncStorage when announcements returns 42P01', async () => {
    await AsyncStorage.setItem(
      '@pgwala_announcements:prop-1',
      JSON.stringify([
        {
          id: 'local-1',
          propertyId: 'prop-1',
          title: 'Gate Closing Time',
          message: 'Main gate closes at 10:30 PM.',
          audience: 'all',
          roomNumber: null,
          createdAt: '2026-11-20T07:30:00.000Z',
        },
        {
          id: 'local-2',
          propertyId: 'prop-1',
          title: 'Room D Parcel',
          message: 'Courier kept at warden desk.',
          audience: 'room',
          roomNumber: 'Room D',
          createdAt: '2026-11-20T11:00:00.000Z',
        },
        {
          id: 'local-3',
          propertyId: 'prop-1',
          title: 'Room A Key',
          message: 'Collect spare key.',
          audience: 'room',
          roomNumber: 'Room A',
          createdAt: '2026-11-20T11:30:00.000Z',
        },
      ])
    );

    setupNoticesSupabaseMock({
      announcements: {
        data: null,
        error: {
          code: '42P01',
          message: 'relation "public.announcements" does not exist',
        },
      },
      foodAlerts: { data: [], error: null },
    });

    const res = await fetchResidentNotices('user-1', 'prop-1', 'D', {
      forceRefresh: true,
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.map((i) => i.id)).toEqual([
        'announcement:local-2',
        'announcement:local-1',
      ]);
      expect(res.data[0].audienceLabel).toBe('Room D');
      expect(res.data[1].audienceLabel).toBe('All residents');
    }
  });

  it('merges announcements and food_alerts chronologically newest-first', async () => {
    setupNoticesSupabaseMock({
      announcements: {
        data: [
          {
            id: 'ann-1',
            property_id: 'prop-1',
            title: 'Rent Due Reminder',
            message: 'Please clear November rent by 5th.',
            audience: 'all',
            room_number: null,
            created_at: '2026-11-20T10:00:00.000Z',
          },
        ],
        error: null,
      },
      foodAlerts: {
        data: [
          {
            id: 'food-1',
            meal_type: 'breakfast',
            status: 'ready',
            message: 'Hot idli and sambar served.',
            created_at: '2026-11-20T08:00:00.000Z',
          },
          {
            id: 'food-2',
            meal_type: 'dinner',
            status: 'delayed',
            message: null,
            created_at: '2026-11-20T12:00:00.000Z',
          },
        ],
        error: null,
      },
    });

    const res = await fetchResidentNotices('user-1', 'prop-1', '101', {
      forceRefresh: true,
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.map((i) => i.id)).toEqual([
        'food:food-2',
        'announcement:ann-1',
        'food:food-1',
      ]);
      expect(res.data[0]).toMatchObject({
        type: 'food_alert',
        title: 'Dinner is delayed',
        message: '',
        mealStatus: 'delayed',
      });
      expect(res.data[1]).toMatchObject({
        type: 'announcement',
        title: 'Rent Due Reminder',
        audienceLabel: 'All residents',
      });
      expect(res.data[2]).toMatchObject({
        type: 'food_alert',
        title: 'Breakfast is ready',
        message: 'Hot idli and sambar served.',
        mealStatus: 'ready',
      });
    }
  });

  it('tracks unreadCount, latestUnreadAnnouncement, and persists markResidentNoticeRead & markAllResidentNoticesRead', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 10, 20, 13, 0, 0));

    setupNoticesSupabaseMock({
      announcements: {
        data: [
          {
            id: 'ann-older',
            property_id: 'prop-1',
            title: 'Wi-Fi Password Updated',
            message: 'New password posted near lobby.',
            audience: 'all',
            room_number: null,
            created_at: '2026-11-20T07:00:00.000Z',
          },
          {
            id: 'ann-newer',
            property_id: 'prop-1',
            title: 'Power Backup Test',
            message: 'Generator test at 3 PM.',
            audience: 'all',
            room_number: null,
            created_at: '2026-11-20T09:00:00.000Z',
          },
        ],
        error: null,
      },
      foodAlerts: {
        data: [
          {
            id: 'food-latest',
            meal_type: 'lunch',
            status: 'ready',
            message: 'Lunch is served.',
            created_at: new Date(2026, 10, 20, 12, 30, 0).toISOString(),
          },
        ],
        error: null,
      },
    });

    const initialSummary = await getUnreadResidentNoticesSummary(
      'user-1',
      'prop-1',
      '101'
    );
    expect(initialSummary.unreadCount).toBe(3);
    expect(initialSummary.latestUnreadAnnouncement?.id).toBe(
      'announcement:ann-newer'
    );

    await markResidentNoticeRead('user-1', 'prop-1', 'announcement:ann-newer');
    await clearQueryCache();

    const afterOneRead = await getUnreadResidentNoticesSummary(
      'user-1',
      'prop-1',
      '101'
    );
    expect(afterOneRead.unreadCount).toBe(2);
    expect(afterOneRead.latestUnreadAnnouncement?.id).toBe(
      'announcement:ann-older'
    );

    await markAllResidentNoticesRead('user-1', 'prop-1', [
      'food:food-latest',
      'announcement:ann-newer',
      'announcement:ann-older',
    ]);
    await clearQueryCache();

    const afterAllRead = await getUnreadResidentNoticesSummary(
      'user-1',
      'prop-1',
      '101'
    );
    expect(afterAllRead.unreadCount).toBe(0);
    expect(afterAllRead.latestUnreadAnnouncement).toBeNull();

    const persistedRaw = await AsyncStorage.getItem(
      '@pgwala_resident_notices_read:user-1:prop-1'
    );
    expect(persistedRaw).not.toBeNull();
    expect(JSON.parse(persistedRaw!)).toEqual(
      expect.arrayContaining([
        'announcement:ann-newer',
        'announcement:ann-older',
        'food:food-latest',
      ])
    );
  });

  it('fails only when both announcements and food_alerts fail with non-schema errors', async () => {
    setupNoticesSupabaseMock({
      announcements: {
        data: null,
        error: { code: '500', message: 'announcements unavailable' },
      },
      foodAlerts: {
        data: null,
        error: { code: '500', message: 'food_alerts unavailable' },
      },
    });

    const res = await fetchResidentNotices('user-1', 'prop-1', '101', {
      forceRefresh: true,
    });
    expect(res.ok).toBe(false);
  });

  it('marks stale prior-day and past-meal food alerts as read automatically with unreadCount 0', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 10, 20, 19, 0, 0));

    setupNoticesSupabaseMock({
      announcements: { data: [], error: null },
      foodAlerts: {
        data: [
          {
            id: 'food-stale-nov15',
            meal_type: 'dinner',
            status: 'ready',
            message: null,
            created_at: new Date(2026, 10, 15, 20, 0, 0).toISOString(),
          },
          {
            id: 'food-morning-expired',
            meal_type: 'breakfast',
            status: 'ready',
            message: 'Idli served.',
            created_at: new Date(2026, 10, 20, 8, 0, 0).toISOString(),
          },
        ],
        error: null,
      },
    });

    const noticesRes = await fetchResidentNotices('user-1', 'prop-1', '101', {
      forceRefresh: true,
    });
    expect(noticesRes.ok).toBe(true);
    if (noticesRes.ok) {
      expect(noticesRes.data).toHaveLength(2);
      expect(noticesRes.data[0].isRead).toBe(true);
      expect(noticesRes.data[1]).toMatchObject({
        title: 'Dinner is ready',
        message: '',
        isRead: true,
      });
    }

    const summary = await getUnreadResidentNoticesSummary(
      'user-1',
      'prop-1',
      '101'
    );
    expect(summary.unreadCount).toBe(0);
  });

  it('hydrates timed food alerts from food_menus.meal_time and @pgwala_meal_time fallback', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 10, 20, 20, 15, 0));

    setupNoticesSupabaseMock({
      announcements: { data: [], error: null },
      foodAlerts: {
        data: [
          {
            id: 'food-dinner-db',
            meal_type: 'dinner',
            status: 'ready',
            message: null,
            created_at: new Date(2026, 10, 20, 20, 0, 0).toISOString(),
          },
        ],
        error: null,
      },
      foodMenus: {
        data: [{ meal_type: 'dinner', meal_time: '20:00' }],
        error: null,
      },
    });

    const dbTimedRes = await fetchResidentNotices('user-1', 'prop-1', '101', {
      forceRefresh: true,
    });
    expect(dbTimedRes.ok).toBe(true);
    if (dbTimedRes.ok) {
      expect(dbTimedRes.data[0]).toMatchObject({
        title: 'Dinner is ready',
        message: 'Dinner is served at 8:00 pm.',
        isRead: false,
      });
    }

    // Now simulate unmigrated DB (42703) + AsyncStorage @pgwala_meal_time fallback
    await AsyncStorage.setItem(
      '@pgwala_meal_time:prop-1:2026-11-20:dinner',
      '20:00'
    );
    setupNoticesSupabaseMock({
      announcements: { data: [], error: null },
      foodAlerts: {
        data: [
          {
            id: 'food-dinner-local',
            meal_type: 'dinner',
            status: 'ready',
            message: '   ',
            created_at: new Date(2026, 10, 20, 20, 5, 0).toISOString(),
          },
        ],
        error: null,
      },
      foodMenus: {
        data: null,
        error: { code: '42703', message: 'column food_menus.meal_time does not exist' },
      },
    });

    const localTimedRes = await fetchResidentNotices(
      'user-1',
      'prop-1',
      '101',
      { forceRefresh: true }
    );
    expect(localTimedRes.ok).toBe(true);
    if (localTimedRes.ok) {
      expect(localTimedRes.data[0]).toMatchObject({
        title: 'Dinner is ready',
        message: 'Dinner is served at 8:00 pm.',
        isRead: false,
      });
    }
  });

  it('emits empty message (no generic placeholder) for timeless alerts without custom message', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 10, 20, 20, 15, 0));

    setupNoticesSupabaseMock({
      announcements: { data: [], error: null },
      foodAlerts: {
        data: [
          {
            id: 'food-timeless',
            meal_type: 'dinner',
            status: 'ready',
            message: null,
            created_at: new Date(2026, 10, 20, 20, 0, 0).toISOString(),
          },
        ],
        error: null,
      },
      foodMenus: {
        data: [{ meal_type: 'dinner', meal_time: null }],
        error: null,
      },
    });

    const res = await fetchResidentNotices('user-1', 'prop-1', '101', {
      forceRefresh: true,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data[0]).toMatchObject({
        title: 'Dinner is ready',
        message: '',
        isRead: false,
      });
      expect(res.data[0].message).not.toContain('Meal schedule update');
    }
  });
});
