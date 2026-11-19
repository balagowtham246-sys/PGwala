import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { AppError, fail, normalizeAppError, ok, ServiceResult } from '@/lib/service-result';
import { getCached, getCachedEntry, invalidatePrefix, setCached } from '@/lib/query-cache';
import { endTrace, recordRoundTrip, startTrace } from '@/lib/perf-monitor';
import { normalizeDishName } from '@/lib/ux-utils';

export type MealType = 'breakfast' | 'lunch' | 'dinner';

export interface FoodMenuRecord {
  id: string;
  property_id: string;
  menu_date: string; // ISO date 'YYYY-MM-DD'
  meal_type: MealType;
  items: string;
  notes: string | null;
  is_published: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface PropertyInfo {
  id: string;
  name: string;
}

export type MealMenuMap = Record<MealType, FoodMenuRecord | null>;

export interface WeeklyTemplateEntry {
  meal_type: MealType;
  items: string;
  notes: string | null;
  is_published: boolean;
}

export interface FetchFoodMenusResult {
  menus: MealMenuMap;
  tableMissing: boolean;
  fromCache: boolean;
}

export interface SaveFoodMenuInput {
  propertyId: string;
  menuDate: string;
  mealType: MealType;
  items: string;
  notes: string | null;
  isPublished: boolean;
  existingId?: string;
}

export const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner'];

export const MEAL_CONFIG: Record<
  MealType,
  { title: string; defaultPlaceholder: string }
> = {
  breakfast: {
    title: 'Breakfast',
    defaultPlaceholder: 'e.g., Idli, Sambar, Coconut Chutney, Tea / Coffee',
  },
  lunch: {
    title: 'Lunch',
    defaultPlaceholder: 'e.g., Rice, Dal Tadka, Paneer Butter Masala, Roti, Curd',
  },
  dinner: {
    title: 'Dinner',
    defaultPlaceholder: 'e.g., Chapati, Mixed Veg Curry, Jeera Rice, Dal, Gulab Jamun',
  },
};

export const MEAL_CHIP_SUGGESTIONS: Record<MealType, string[]> = {
  breakfast: [
    'Idli',
    'Dosa',
    'Poha',
    'Upma',
    'Aloo Paratha',
    'Sambar',
    'Chutney',
    'Boiled Egg',
    'Tea / Coffee',
  ],
  lunch: [
    'Steamed Rice',
    'Dal Tadka',
    'Roti',
    'Sambar',
    'Curd',
    'Paneer Curry',
    'Mix Veg',
    'Salad',
    'Buttermilk',
  ],
  dinner: [
    'Chapati',
    'Jeera Rice',
    'Dal Fry',
    'Veg Kurma',
    'Paneer Butter Masala',
    'Egg Curry',
    'Chicken Curry',
    'Curd Rice',
    'Gulab Jamun',
  ],
};

export function createEmptyMealMenuMap(): MealMenuMap {
  return {
    breakfast: null,
    lunch: null,
    dinner: null,
  };
}

export function getFoodMenuCacheKey(propertyId: string, dateStr: string): string {
  return `food-menu:${propertyId}:${dateStr}`;
}

export function getFoodMenuPropertyPrefix(propertyId: string): string {
  return `food-menu:${propertyId}:`;
}

function getWeeklyTemplateStorageKey(propertyId: string): string {
  return `@pgwala_weekly_menu_template_${propertyId}`;
}

function isFoodMenusTableMissing(err: AppError): boolean {
  const msg = err.message.toLowerCase();
  return (
    err.code === '42P01' ||
    msg.includes('relation') ||
    msg.includes('does not exist')
  );
}

const inFlightMenuReads = new Map<string, Promise<ServiceResult<FetchFoodMenusResult>>>();

export async function getCachedFoodMenus(
  propertyId: string,
  dateStr: string
): Promise<MealMenuMap | null> {
  return getCached<MealMenuMap>(getFoodMenuCacheKey(propertyId, dateStr));
}

export async function fetchActiveOwnerProperty(
  ownerId?: string
): Promise<ServiceResult<PropertyInfo | null>> {
  const traceLabel = 'food-menu:property';
  startTrace(traceLabel);
  try {
    let query = supabase
      .from('properties')
      .select('id, name')
      .eq('is_active', true);

    if (ownerId) {
      query = query.eq('owner_id', ownerId);
    }

    const { data, error } = await query.limit(1);
    recordRoundTrip(traceLabel);

    if (error) {
      return fail(error, 'Failed to load property.');
    }

    if (!data || data.length === 0) {
      return ok(null);
    }

    return ok(data[0] as PropertyInfo);
  } catch (err: unknown) {
    return fail(err, 'Failed to load property.');
  } finally {
    endTrace(traceLabel);
  }
}

export async function fetchFoodMenusForDate(
  propertyId: string,
  dateStr: string,
  options?: { forceNetwork?: boolean }
): Promise<ServiceResult<FetchFoodMenusResult>> {
  const cacheKey = getFoodMenuCacheKey(propertyId, dateStr);
  const forceNetwork = Boolean(options?.forceNetwork);

  if (!forceNetwork) {
    const cachedEntry = await getCachedEntry<MealMenuMap>(cacheKey);
    if (cachedEntry && !cachedEntry.isStale) {
      return ok({
        menus: cachedEntry.data,
        tableMissing: false,
        fromCache: true,
      });
    }

    const existingPromise = inFlightMenuReads.get(cacheKey);
    if (existingPromise) {
      return existingPromise;
    }
  }

  const runFetch = async (): Promise<ServiceResult<FetchFoodMenusResult>> => {
    startTrace(cacheKey);
    try {
      const { data, error } = await supabase
        .from('food_menus')
        .select('id, property_id, menu_date, meal_type, items, notes, is_published, created_at, updated_at')
        .eq('property_id', propertyId)
        .eq('menu_date', dateStr);

      recordRoundTrip(cacheKey);

      if (error) {
        const appError = normalizeAppError(error, 'Failed to load menus.');
        if (isFoodMenusTableMissing(appError)) {
          return ok({
            menus: createEmptyMealMenuMap(),
            tableMissing: true,
            fromCache: false,
          });
        }
        return { ok: false, error: appError };
      }

      const menuMap = createEmptyMealMenuMap();
      if (data && data.length > 0) {
        for (const item of data as FoodMenuRecord[]) {
          if (MEAL_ORDER.includes(item.meal_type)) {
            menuMap[item.meal_type] = item;
          }
        }
      }

      await setCached(cacheKey, menuMap);

      return ok({
        menus: menuMap,
        tableMissing: false,
        fromCache: false,
      });
    } catch (err: unknown) {
      return fail(err, 'Failed to load menus.');
    } finally {
      endTrace(cacheKey);
      inFlightMenuReads.delete(cacheKey);
    }
  };

  const promise = runFetch();
  if (!forceNetwork) {
    inFlightMenuReads.set(cacheKey, promise);
  }
  return promise;
}

export async function fetchRawMenusForDate(
  propertyId: string,
  dateStr: string
): Promise<ServiceResult<WeeklyTemplateEntry[]>> {
  const traceLabel = `food-menu:raw:${propertyId}:${dateStr}`;
  startTrace(traceLabel);
  try {
    const { data, error } = await supabase
      .from('food_menus')
      .select('meal_type, items, notes, is_published')
      .eq('property_id', propertyId)
      .eq('menu_date', dateStr);

    recordRoundTrip(traceLabel);

    if (error) {
      return fail(error, 'Failed to fetch menus.');
    }

    const entries: WeeklyTemplateEntry[] = (data ?? []).map((m) => ({
      meal_type: m.meal_type as MealType,
      items: m.items,
      notes: m.notes,
      is_published: Boolean(m.is_published),
    }));

    return ok(entries);
  } catch (err: unknown) {
    return fail(err, 'Failed to fetch menus.');
  } finally {
    endTrace(traceLabel);
  }
}

export async function saveFoodMenu(
  input: SaveFoodMenuInput
): Promise<ServiceResult<{ menu: FoodMenuRecord; isUpdate: boolean }>> {
  const traceLabel = `food-menu:save:${input.propertyId}:${input.menuDate}`;
  startTrace(traceLabel);
  try {
    if (input.existingId) {
      const { data, error } = await supabase
        .from('food_menus')
        .update({
          items: input.items,
          notes: input.notes,
          is_published: input.isPublished,
        })
        .eq('id', input.existingId)
        .eq('property_id', input.propertyId)
        .select('id, property_id, menu_date, meal_type, items, notes, is_published')
        .single();

      recordRoundTrip(traceLabel);

      if (error) {
        return fail(error, 'Failed to update menu.');
      }
      if (!data || !data.id) {
        return fail(new Error('Database did not return updated menu row.'));
      }

      await invalidatePrefix(getFoodMenuPropertyPrefix(input.propertyId));
      return ok({ menu: data as FoodMenuRecord, isUpdate: true });
    }

    const { data, error } = await supabase
      .from('food_menus')
      .insert({
        property_id: input.propertyId,
        menu_date: input.menuDate,
        meal_type: input.mealType,
        items: input.items,
        notes: input.notes,
        is_published: input.isPublished,
      })
      .select('id, property_id, menu_date, meal_type, items, notes, is_published')
      .single();

    recordRoundTrip(traceLabel);

    if (error) {
      return fail(error, 'Failed to save menu.');
    }
    if (!data || !data.id) {
      return fail(new Error('Database did not return inserted menu row.'));
    }

    await invalidatePrefix(getFoodMenuPropertyPrefix(input.propertyId));
    return ok({ menu: data as FoodMenuRecord, isUpdate: false });
  } catch (err: unknown) {
    return fail(err, 'Failed to save menu.');
  } finally {
    endTrace(traceLabel);
  }
}

export async function toggleFoodMenuPublish(input: {
  id: string;
  propertyId: string;
  nextPublished: boolean;
}): Promise<ServiceResult<{ id: string; is_published: boolean }>> {
  const traceLabel = `food-menu:publish:${input.propertyId}`;
  startTrace(traceLabel);
  try {
    const { data, error } = await supabase
      .from('food_menus')
      .update({ is_published: input.nextPublished })
      .eq('id', input.id)
      .eq('property_id', input.propertyId)
      .select('id, is_published')
      .single();

    recordRoundTrip(traceLabel);

    if (error) {
      return fail(error, 'Status Update Failed');
    }
    if (!data) {
      return fail(new Error('No response from database.'));
    }

    await invalidatePrefix(getFoodMenuPropertyPrefix(input.propertyId));
    return ok(data as { id: string; is_published: boolean });
  } catch (err: unknown) {
    return fail(err, 'Status Update Failed');
  } finally {
    endTrace(traceLabel);
  }
}

export async function deleteFoodMenu(input: {
  id: string;
  propertyId: string;
}): Promise<ServiceResult<void>> {
  const traceLabel = `food-menu:delete:${input.propertyId}`;
  startTrace(traceLabel);
  try {
    const { error } = await supabase
      .from('food_menus')
      .delete()
      .eq('id', input.id)
      .eq('property_id', input.propertyId);

    recordRoundTrip(traceLabel);

    if (error) {
      return fail(error, 'Delete Failed');
    }

    await invalidatePrefix(getFoodMenuPropertyPrefix(input.propertyId));
    return ok(undefined);
  } catch (err: unknown) {
    return fail(err, 'Delete Failed');
  } finally {
    endTrace(traceLabel);
  }
}

export async function upsertMealsForDate(input: {
  propertyId: string;
  menuDate: string;
  existingMenus: MealMenuMap;
  entries: WeeklyTemplateEntry[];
}): Promise<ServiceResult<void>> {
  const traceLabel = `food-menu:bulk-upsert:${input.propertyId}:${input.menuDate}`;
  startTrace(traceLabel);
  let wroteAny = false;
  try {
    for (const entry of input.entries) {
      const existing = input.existingMenus[entry.meal_type];
      if (existing) {
        const { error } = await supabase
          .from('food_menus')
          .update({
            items: entry.items,
            notes: entry.notes,
            is_published: entry.is_published,
          })
          .eq('id', existing.id)
          .eq('property_id', input.propertyId);
        recordRoundTrip(traceLabel);
        if (error) {
          return fail(error, 'Failed to update meal menu.');
        }
        wroteAny = true;
      } else {
        const { error } = await supabase.from('food_menus').insert({
          property_id: input.propertyId,
          menu_date: input.menuDate,
          meal_type: entry.meal_type,
          items: entry.items,
          notes: entry.notes,
          is_published: entry.is_published,
        });
        recordRoundTrip(traceLabel);
        if (error) {
          return fail(error, 'Failed to insert meal menu.');
        }
        wroteAny = true;
      }
    }

    return ok(undefined);
  } catch (err: unknown) {
    return fail(err, 'Failed to save meals.');
  } finally {
    if (wroteAny) {
      await invalidatePrefix(getFoodMenuPropertyPrefix(input.propertyId));
    }
    endTrace(traceLabel);
  }
}

export async function saveWeeklyMenuTemplate(
  propertyId: string,
  weekday: string,
  entries: WeeklyTemplateEntry[]
): Promise<ServiceResult<void>> {
  try {
    const key = getWeeklyTemplateStorageKey(propertyId);
    const raw = await AsyncStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    parsed[weekday] = entries;
    await AsyncStorage.setItem(key, JSON.stringify(parsed));
    return ok(undefined);
  } catch (err: unknown) {
    return fail(err, 'Template Save Failed');
  }
}

export async function loadWeeklyMenuTemplate(
  propertyId: string,
  weekday: string
): Promise<ServiceResult<WeeklyTemplateEntry[] | null>> {
  try {
    const key = getWeeklyTemplateStorageKey(propertyId);
    const raw = await AsyncStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    const entries = parsed[weekday];
    if (!Array.isArray(entries) || entries.length === 0) {
      return ok(null);
    }
    return ok(entries as WeeklyTemplateEntry[]);
  } catch (err: unknown) {
    return fail(err, 'Apply Template Failed');
  }
}

export async function fetchActiveResidentCount(
  propertyId: string
): Promise<ServiceResult<number>> {
  const traceLabel = `food-menu:resident-count:${propertyId}`;
  startTrace(traceLabel);
  try {
    const { count, error } = await supabase
      .from('residents')
      .select('id', { count: 'exact', head: true })
      .eq('property_id', propertyId)
      .eq('is_active', true);

    recordRoundTrip(traceLabel);

    if (error) {
      return fail(error, 'Failed to load active resident count.');
    }

    return ok(count ?? 0);
  } catch (err: unknown) {
    return fail(err, 'Failed to load active resident count.');
  } finally {
    endTrace(traceLabel);
  }
}

function getCustomDishesStorageKey(propertyId: string, mealType: MealType): string {
  return `@pgwala_custom_dishes:${propertyId}:${mealType}`;
}

function normalizeUniqueDishes(rawList: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const entry of rawList) {
    if (typeof entry !== 'string') continue;
    const normalized = normalizeDishName(entry);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
  }
  return result;
}

async function readCustomDishesFromStorage(
  propertyId: string,
  mealType: MealType
): Promise<string[]> {
  const key = getCustomDishesStorageKey(propertyId, mealType);
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  return Array.isArray(parsed) ? normalizeUniqueDishes(parsed) : [];
}

export async function getCustomDishes(
  propertyId: string,
  mealType: MealType
): Promise<ServiceResult<string[]>> {
  try {
    const dishes = await readCustomDishesFromStorage(propertyId, mealType);
    return ok(dishes);
  } catch (err: unknown) {
    return fail(err, 'Failed to load custom dishes.');
  }
}

export async function addCustomDish(
  propertyId: string,
  mealType: MealType,
  dishName: string
): Promise<ServiceResult<string[]>> {
  try {
    const normalized = normalizeDishName(dishName);
    if (!normalized) {
      return fail(new Error('Dish name cannot be empty.'), 'Dish name cannot be empty.');
    }

    const existing = await readCustomDishesFromStorage(propertyId, mealType);
    const next = normalizeUniqueDishes([...existing, normalized]);
    await AsyncStorage.setItem(
      getCustomDishesStorageKey(propertyId, mealType),
      JSON.stringify(next)
    );
    return ok(next);
  } catch (err: unknown) {
    return fail(err, 'Failed to save custom dish.');
  }
}

export async function removeCustomDish(
  propertyId: string,
  mealType: MealType,
  dishName: string
): Promise<ServiceResult<string[]>> {
  try {
    const normalized = normalizeDishName(dishName);
    const targetKey = normalized.toLowerCase();
    const existing = await readCustomDishesFromStorage(propertyId, mealType);
    const next = targetKey
      ? existing.filter((d) => d.toLowerCase() !== targetKey)
      : existing;
    await AsyncStorage.setItem(
      getCustomDishesStorageKey(propertyId, mealType),
      JSON.stringify(next)
    );
    return ok(next);
  } catch (err: unknown) {
    return fail(err, 'Failed to remove custom dish.');
  }
}
