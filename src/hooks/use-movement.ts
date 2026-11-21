import {
  InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { sortLogsDescending } from '@/lib/movement-utils';
import { queryKeys } from '@/lib/query-keys';
import { supabase } from '@/lib/supabase';
import {
  recordStudentMovement,
  RecordMovementOutcome,
  RecordStudentMovementInput,
  StudentDashboardData,
} from '@/services/dashboard.service';

export interface MovementResidentRecord {
  id: string;
  property_id: string;
  profile_id: string | null;
  full_name: string;
  phone_number: string | null;
  room_number: string;
  is_active: boolean;
}

export interface MovementLogItem {
  id: string;
  resident_id: string;
  property_id?: string;
  direction: 'IN' | 'OUT';
  event_time: string;
  note: string | null;
  purpose?: string | null;
  expected_return_time?: string | null;
  food_required?: boolean;
  recorded_by: string;
}

export interface OwnerMovementSnapshot {
  propertyId: string | null;
  propertyName: string;
  allResidents: MovementResidentRecord[];
  activeResidents: MovementResidentRecord[];
  logs: MovementLogItem[];
  fetchedAtMs: number;
}

export function useOwnerMovementQuery(params: {
  userId?: string;
  selectedPropertyId: string | null;
  selectedPropertyName?: string;
}) {
  const { userId, selectedPropertyId, selectedPropertyName } = params;
  const queryKey = queryKeys.movement.property(selectedPropertyId ?? 'auto');

  return useQuery<OwnerMovementSnapshot, Error>({
    queryKey,
    enabled: Boolean(userId || selectedPropertyId),
    queryFn: async () => {
      let activePropId = selectedPropertyId;
      let activePropName = selectedPropertyName;

      if (!activePropId) {
        let query = supabase
          .from('properties')
          .select('id, name')
          .eq('is_active', true);

        if (userId) {
          query = query.eq('owner_id', userId);
        }

        const { data: properties, error: propError } = await query.limit(1);
        if (propError) throw propError;

        if (!properties || properties.length === 0) {
          return {
            propertyId: null,
            propertyName: activePropName || 'Shalom Residency',
            allResidents: [],
            activeResidents: [],
            logs: [],
            fetchedAtMs: Date.now(),
          };
        }

        activePropId = properties[0].id;
        activePropName = properties[0].name;
      }

      const { data: residentsData, error: resError } = await supabase
        .from('residents')
        .select(
          'id, property_id, profile_id, full_name, phone_number, room_number, is_active'
        )
        .eq('property_id', activePropId)
        .order('room_number', { ascending: true });

      if (resError) throw resError;

      const allResidents = (residentsData as MovementResidentRecord[]) ?? [];
      const activeResidents = allResidents.filter((r) => r.is_active);
      const allResidentIds = allResidents.map((r) => r.id);

      if (allResidentIds.length === 0) {
        return {
          propertyId: activePropId,
          propertyName: activePropName || 'Shalom Residency',
          allResidents,
          activeResidents,
          logs: [],
          fetchedAtMs: Date.now(),
        };
      }

      let { data: logsData, error: logsError } = await supabase
        .from('movement_logs')
        .select(
          'id, resident_id, property_id, direction, event_time, note, purpose, expected_return_time, food_required, recorded_by'
        )
        .eq('property_id', activePropId)
        .order('event_time', { ascending: false })
        .limit(100);

      if (
        !logsError &&
        (!logsData || logsData.length === 0) &&
        allResidentIds.length > 0
      ) {
        const { data: fallbackData } = await supabase
          .from('movement_logs')
          .select(
            'id, resident_id, property_id, direction, event_time, note, purpose, expected_return_time, food_required, recorded_by'
          )
          .in('resident_id', allResidentIds)
          .order('event_time', { ascending: false })
          .limit(100);

        if (fallbackData && fallbackData.length > 0) {
          logsData = fallbackData;
        }
      }

      if (logsError) throw logsError;

      return {
        propertyId: activePropId,
        propertyName: activePropName || 'Shalom Residency',
        allResidents,
        activeResidents,
        logs: sortLogsDescending((logsData as MovementLogItem[]) ?? []),
        fetchedAtMs: Date.now(),
      };
    },
  });
}

export const GATE_HISTORY_PAGE_SIZE = 30;

export interface StudentGateHistoryPage {
  logs: MovementLogItem[];
  hasMore: boolean;
  fetchedAtMs: number;
}

export function useStudentGateHistoryQuery(residentId: string | undefined) {
  const queryKey = queryKeys.movement.resident(residentId ?? '');

  return useInfiniteQuery<
    StudentGateHistoryPage,
    Error,
    InfiniteData<StudentGateHistoryPage>,
    typeof queryKey,
    number
  >({
    queryKey,
    enabled: Boolean(residentId),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage.hasMore) return undefined;
      return allPages.reduce((sum, p) => sum + p.logs.length, 0);
    },
    queryFn: async ({ pageParam }) => {
      const rangeEnd = pageParam + GATE_HISTORY_PAGE_SIZE - 1;
      const { data, error } = await supabase
        .from('movement_logs')
        .select('*')
        .eq('resident_id', residentId!)
        .order('event_time', { ascending: false })
        .range(pageParam, rangeEnd);

      if (error) throw error;
      const page = (data as MovementLogItem[]) || [];
      return {
        logs: page,
        hasMore: page.length >= GATE_HISTORY_PAGE_SIZE,
        fetchedAtMs: Date.now(),
      };
    },
  });
}

export interface RecordStudentMovementVariables {
  input: RecordStudentMovementInput;
  residentId?: string;
}

interface MovementMutationContext {
  previousHistoryQueries: [
    readonly unknown[],
    InfiniteData<StudentGateHistoryPage> | undefined,
  ][];
  previousDashboardQueries: [
    readonly unknown[],
    StudentDashboardData | undefined,
  ][];
}

export function useRecordStudentMovementMutation() {
  const qc = useQueryClient();

  return useMutation<
    RecordMovementOutcome,
    Error,
    RecordStudentMovementVariables,
    MovementMutationContext
  >({
    mutationFn: async ({ input }) => {
      const result = await recordStudentMovement(input);
      if (!result.ok) {
        throw new Error(result.error.message || 'Could not update gate status.');
      }
      return result.data;
    },
    onMutate: async ({ input, residentId }) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: queryKeys.movement.all }),
        qc.cancelQueries({ queryKey: queryKeys.dashboard.all }),
      ]);

      const previousHistoryQueries = qc.getQueriesData<
        InfiniteData<StudentGateHistoryPage>
      >({
        queryKey: ['movement', 'resident'],
      });
      const previousDashboardQueries = qc.getQueriesData<StudentDashboardData>({
        queryKey: ['dashboard', 'student'],
      });

      const nowIso = new Date().toISOString();
      const optimisticLog: MovementLogItem = {
        id: `optimistic-gate-${Date.now()}`,
        resident_id: residentId ?? '',
        direction: input.direction,
        event_time: nowIso,
        purpose: input.purpose ?? null,
        expected_return_time: input.expectedReturnTime ?? null,
        food_required: input.foodRequired ?? true,
        note: input.note ?? null,
        recorded_by: input.userId ?? '',
      };

      if (residentId) {
        const key = queryKeys.movement.resident(residentId);
        const existing =
          qc.getQueryData<InfiniteData<StudentGateHistoryPage>>(key);
        if (existing && existing.pages.length > 0) {
          qc.setQueryData<InfiniteData<StudentGateHistoryPage>>(key, {
            ...existing,
            pages: existing.pages.map((page, idx) =>
              idx === 0
                ? { ...page, logs: [optimisticLog, ...page.logs] }
                : page
            ),
          });
        }
      }

      for (const [key, dash] of previousDashboardQueries) {
        if (!dash) continue;
        qc.setQueryData<StudentDashboardData>(key, {
          ...dash,
          latestMovement: {
            id: optimisticLog.id,
            direction: input.direction,
            event_time: nowIso,
            purpose: input.purpose ?? null,
            expected_return_time: input.expectedReturnTime ?? null,
            food_required: input.foodRequired ?? true,
            note: input.note ?? null,
          },
        });
      }

      return { previousHistoryQueries, previousDashboardQueries };
    },
    onError: (_err, _vars, context) => {
      if (!context) return;
      for (const [key, snapshot] of context.previousHistoryQueries) {
        qc.setQueryData(key, snapshot);
      }
      for (const [key, snapshot] of context.previousDashboardQueries) {
        qc.setQueryData(key, snapshot);
      }
    },
    onSettled: async (data) => {
      if (data?.queued) {
        // Offline queue holds the authoritative pending state until sync completes
        return;
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.movement.all }),
        qc.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
        qc.invalidateQueries({ queryKey: queryKeys.residents.all }),
      ]);
    },
  });
}
