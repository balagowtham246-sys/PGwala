import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query-keys';
import {
  createEmptyMealMenuMap,
  deleteFoodMenu,
  fetchActiveOwnerProperty,
  fetchFoodMenusForDate,
  FetchFoodMenusResult,
  FoodMenuRecord,
  MealMenuMap,
  MealType,
  PropertyInfo,
  saveFoodMenu,
  SaveFoodMenuInput,
  saveWeeklyMenuTemplate,
  toggleFoodMenuPublish,
  upsertMealsForDate,
  WeeklyTemplateEntry,
} from '@/services/food-menu.service';
import {
  DayMenuMap,
  fetchResidentMultiDayMenus,
} from '@/services/resident-portal.service';

export function useOwnerActivePropertyQuery(
  ownerId: string | undefined,
  selectedProperty: PropertyInfo | null
) {
  return useQuery<PropertyInfo | null, Error>({
    queryKey: queryKeys.foodMenus.ownerProperty(ownerId ?? ''),
    enabled: Boolean(ownerId) && !selectedProperty,
    queryFn: async () => {
      const result = await fetchActiveOwnerProperty(ownerId!);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
  });
}

export function useOwnerFoodMenusQuery(
  propertyId: string | undefined,
  dateStr: string
) {
  return useQuery<FetchFoodMenusResult, Error>({
    queryKey: queryKeys.foodMenus.property(propertyId ?? '', dateStr),
    enabled: Boolean(propertyId),
    queryFn: async () => {
      const result = await fetchFoodMenusForDate(propertyId!, dateStr, {
        forceNetwork: true,
      });
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
  });
}

export function useStudentMultiDayMenusQuery(
  propertyId: string | null | undefined,
  anchorIso: string,
  datesIso: string[]
) {
  return useQuery<
    { byDate: Record<string, DayMenuMap>; publishedDates: string[] },
    Error
  >({
    queryKey: queryKeys.foodMenus.student(propertyId ?? '', anchorIso),
    enabled: Boolean(propertyId) && datesIso.length > 0,
    queryFn: async () => {
      const res = await fetchResidentMultiDayMenus(propertyId!, datesIso);
      if (!res.ok) {
        throw new Error(res.error.message || 'Could not load meal schedules.');
      }
      return res.data;
    },
  });
}

interface FoodMenuMutationContext {
  key: ReturnType<typeof queryKeys.foodMenus.property>;
  previous: FetchFoodMenusResult | undefined;
}

export function useSaveFoodMenuMutation() {
  const qc = useQueryClient();

  return useMutation<
    { menu: FoodMenuRecord; isUpdate: boolean },
    Error,
    SaveFoodMenuInput,
    FoodMenuMutationContext
  >({
    mutationFn: async (input) => {
      const result = await saveFoodMenu(input);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    onMutate: async (input) => {
      const key = queryKeys.foodMenus.property(input.propertyId, input.menuDate);
      await qc.cancelQueries({ queryKey: queryKeys.foodMenus.all });
      const previous = qc.getQueryData<FetchFoodMenusResult>(key);

      const baseMenus: MealMenuMap = previous?.menus ?? createEmptyMealMenuMap();
      const existing = baseMenus[input.mealType];
      const optimisticRecord: FoodMenuRecord = {
        id: existing?.id ?? input.existingId ?? `optimistic-menu-${input.mealType}`,
        property_id: input.propertyId,
        menu_date: input.menuDate,
        meal_type: input.mealType,
        items: input.items,
        notes: input.notes,
        is_published: input.isPublished,
        meal_time:
          input.meal_time !== undefined
            ? input.meal_time
            : existing?.meal_time ?? null,
      };

      qc.setQueryData<FetchFoodMenusResult>(key, {
        tableMissing: previous?.tableMissing ?? false,
        fromCache: false,
        menus: {
          ...baseMenus,
          [input.mealType]: optimisticRecord,
        },
      });

      return { key, previous };
    },
    onError: (_err, _vars, context) => {
      if (!context) return;
      qc.setQueryData(context.key, context.previous);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.foodMenus.all });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    },
  });
}

export interface ToggleFoodMenuPublishVariables {
  id: string;
  propertyId: string;
  menuDate: string;
  mealType: MealType;
  nextPublished: boolean;
}

export function useToggleFoodMenuPublishMutation() {
  const qc = useQueryClient();

  return useMutation<
    { id: string; is_published: boolean },
    Error,
    ToggleFoodMenuPublishVariables,
    FoodMenuMutationContext
  >({
    mutationFn: async (input) => {
      const result = await toggleFoodMenuPublish({
        id: input.id,
        propertyId: input.propertyId,
        nextPublished: input.nextPublished,
      });
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    onMutate: async (input) => {
      const key = queryKeys.foodMenus.property(input.propertyId, input.menuDate);
      await qc.cancelQueries({ queryKey: queryKeys.foodMenus.all });
      const previous = qc.getQueryData<FetchFoodMenusResult>(key);

      if (previous && previous.menus[input.mealType]) {
        qc.setQueryData<FetchFoodMenusResult>(key, {
          ...previous,
          menus: {
            ...previous.menus,
            [input.mealType]: {
              ...previous.menus[input.mealType]!,
              is_published: input.nextPublished,
            },
          },
        });
      }

      return { key, previous };
    },
    onError: (_err, _vars, context) => {
      if (!context) return;
      qc.setQueryData(context.key, context.previous);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.foodMenus.all });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    },
  });
}

export interface DeleteFoodMenuVariables {
  id: string;
  propertyId: string;
  menuDate: string;
  mealType: MealType;
}

export function useDeleteFoodMenuMutation() {
  const qc = useQueryClient();

  return useMutation<
    void,
    Error,
    DeleteFoodMenuVariables,
    FoodMenuMutationContext
  >({
    mutationFn: async (input) => {
      const result = await deleteFoodMenu(input);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
    },
    onMutate: async (input) => {
      const key = queryKeys.foodMenus.property(input.propertyId, input.menuDate);
      await qc.cancelQueries({ queryKey: queryKeys.foodMenus.all });
      const previous = qc.getQueryData<FetchFoodMenusResult>(key);

      if (previous) {
        qc.setQueryData<FetchFoodMenusResult>(key, {
          ...previous,
          menus: {
            ...previous.menus,
            [input.mealType]: null,
          },
        });
      }

      return { key, previous };
    },
    onError: (_err, _vars, context) => {
      if (!context) return;
      qc.setQueryData(context.key, context.previous);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.foodMenus.all });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    },
  });
}

export interface UpsertMealsForDateVariables {
  propertyId: string;
  menuDate: string;
  existingMenus: MealMenuMap;
  entries: WeeklyTemplateEntry[];
}

export function useUpsertMealsForDateMutation() {
  const qc = useQueryClient();

  return useMutation<
    void,
    Error,
    UpsertMealsForDateVariables,
    FoodMenuMutationContext
  >({
    mutationFn: async (input) => {
      const result = await upsertMealsForDate(input);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
    },
    onMutate: async (input) => {
      const key = queryKeys.foodMenus.property(input.propertyId, input.menuDate);
      await qc.cancelQueries({ queryKey: queryKeys.foodMenus.all });
      const previous = qc.getQueryData<FetchFoodMenusResult>(key);

      const nextMenus: MealMenuMap = {
        ...(previous?.menus ?? input.existingMenus),
      };
      for (const entry of input.entries) {
        const existing = nextMenus[entry.meal_type];
        nextMenus[entry.meal_type] = {
          id: existing?.id ?? `optimistic-template-${entry.meal_type}`,
          property_id: input.propertyId,
          menu_date: input.menuDate,
          meal_type: entry.meal_type,
          items: entry.items,
          notes: entry.notes,
          is_published: entry.is_published,
          meal_time: entry.meal_time ?? existing?.meal_time ?? null,
        };
      }

      qc.setQueryData<FetchFoodMenusResult>(key, {
        tableMissing: previous?.tableMissing ?? false,
        fromCache: false,
        menus: nextMenus,
      });

      return { key, previous };
    },
    onError: (_err, _vars, context) => {
      if (!context) return;
      qc.setQueryData(context.key, context.previous);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.foodMenus.all });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    },
  });
}

export function useSaveWeeklyTemplateMutation() {
  return useMutation<
    void,
    Error,
    { propertyId: string; weekday: string; entries: WeeklyTemplateEntry[] }
  >({
    mutationFn: async ({ propertyId, weekday, entries }) => {
      const result = await saveWeeklyMenuTemplate(propertyId, weekday, entries);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
    },
  });
}
