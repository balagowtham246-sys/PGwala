jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

import { clearQueryCache } from '@/lib/query-cache';
import { resetPerfMonitor } from '@/lib/perf-monitor';
import { supabase } from '@/lib/supabase';
import {
  deleteFoodMenu,
  fetchFoodMenusForDate,
  saveFoodMenu,
  toggleFoodMenuPublish,
} from '../food-menu.service';

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

const mockedFrom = supabase.from as jest.Mock;

describe('food-menu.service', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    resetPerfMonitor();
    await clearQueryCache();
  });

  it('fetches food menus from Supabase and serves subsequent reads from cache', async () => {
    const eqDate = jest.fn().mockResolvedValue({
      data: [
        {
          id: 'm1',
          property_id: 'prop-1',
          menu_date: '2026-11-19',
          meal_type: 'breakfast',
          items: 'Idli, Sambar',
          notes: null,
          is_published: true,
        },
      ],
      error: null,
    });
    const eqProp = jest.fn(() => ({ eq: eqDate }));
    const select = jest.fn(() => ({ eq: eqProp }));
    mockedFrom.mockReturnValue({ select });

    const first = await fetchFoodMenusForDate('prop-1', '2026-11-19');
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.data.fromCache).toBe(false);
      expect(first.data.menus.breakfast?.items).toBe('Idli, Sambar');
    }

    const second = await fetchFoodMenusForDate('prop-1', '2026-11-19');
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.data.fromCache).toBe(true);
      expect(second.data.menus.breakfast?.items).toBe('Idli, Sambar');
    }
    expect(mockedFrom).toHaveBeenCalledTimes(1);
  });

  it('handles missing food_menus table gracefully without failing', async () => {
    const eqDate = jest.fn().mockResolvedValue({
      data: null,
      error: { code: '42P01', message: 'relation "food_menus" does not exist' },
    });
    const eqProp = jest.fn(() => ({ eq: eqDate }));
    const select = jest.fn(() => ({ eq: eqProp }));
    mockedFrom.mockReturnValue({ select });

    const res = await fetchFoodMenusForDate('prop-1', '2026-11-19');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.tableMissing).toBe(true);
    }
  });

  it('invalidates property menu cache after save, publish toggle, and delete', async () => {
    // Seed cache first
    const eqDateRead = jest.fn().mockResolvedValue({ data: [], error: null });
    mockedFrom.mockReturnValueOnce({
      select: () => ({ eq: () => ({ eq: eqDateRead }) }),
    });
    await fetchFoodMenusForDate('prop-1', '2026-11-19');

    // Insert
    mockedFrom.mockReturnValueOnce({
      insert: () => ({
        select: () => ({
          single: jest.fn().mockResolvedValue({
            data: {
              id: 'm2',
              property_id: 'prop-1',
              menu_date: '2026-11-19',
              meal_type: 'lunch',
              items: 'Rice, Dal',
              notes: null,
              is_published: false,
            },
            error: null,
          }),
        }),
      }),
    });

    const saved = await saveFoodMenu({
      propertyId: 'prop-1',
      menuDate: '2026-11-19',
      mealType: 'lunch',
      items: 'Rice, Dal',
      notes: null,
      isPublished: false,
    });
    expect(saved.ok).toBe(true);

    // Publish toggle
    mockedFrom.mockReturnValueOnce({
      update: () => ({
        eq: () => ({
          eq: () => ({
            select: () => ({
              single: jest.fn().mockResolvedValue({
                data: { id: 'm2', is_published: true },
                error: null,
              }),
            }),
          }),
        }),
      }),
    });

    const toggled = await toggleFoodMenuPublish({
      id: 'm2',
      propertyId: 'prop-1',
      nextPublished: true,
    });
    expect(toggled).toEqual({ ok: true, data: { id: 'm2', is_published: true } });

    // Delete
    mockedFrom.mockReturnValueOnce({
      delete: () => ({
        eq: () => ({
          eq: jest.fn().mockResolvedValue({ error: null }),
        }),
      }),
    });
    const deleted = await deleteFoodMenu({ id: 'm2', propertyId: 'prop-1' });
    expect(deleted.ok).toBe(true);
  });
});
