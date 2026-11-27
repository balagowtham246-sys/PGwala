import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { invokeEdgeFunction } from '@/lib/edge-functions';
import {
  AlertSendSummary,
  AudienceResident,
  FoodAlertRecord,
  FoodAlertStatus,
  FoodAudienceType,
  FoodMealType,
} from '@/lib/food-alert-utils';
import { trackEvent } from '@/lib/analytics';
import { queryKeys } from '@/lib/query-keys';
import { broadcastPropertySync } from '@/lib/realtime-sync';
import { supabase } from '@/lib/supabase';
import {
  DashboardWmUnit,
  fetchOwnerDashboard,
  fetchStudentDashboard,
  OwnerDashboardData,
  OwnerWmSummary,
  releaseWashingMachineUnit,
  setWashingMachineOutOfOrder,
  StudentDashboardData,
  toLocalIsoDate,
} from '@/services/dashboard.service';
import { getUnreadInboxCount } from '@/services/notification-center.service';
import {
  getUnreadResidentNoticesSummary,
  ResidentNoticeItem,
} from '@/services/resident-notices.service';

export function useOwnerDashboardQuery(
  propertyId: string | null | undefined,
  enabled: boolean
) {
  const todayIsoDate = toLocalIsoDate();
  const currentMonthStartIso = `${todayIsoDate.slice(0, 7)}-01`;

  return useQuery<OwnerDashboardData, Error>({
    queryKey: queryKeys.dashboard.owner(propertyId ?? '', todayIsoDate),
    enabled: Boolean(propertyId) && enabled,
    queryFn: async () => {
      const result = await fetchOwnerDashboard(propertyId!, {
        dateIso: todayIsoDate,
        monthStartIso: currentMonthStartIso,
      });
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
  });
}

export function useOwnerUnreadInboxQuery(
  userId: string | undefined,
  propertyId: string | null | undefined,
  enabled: boolean
) {
  return useQuery<number, Error>({
    queryKey: queryKeys.dashboard.ownerInbox(userId ?? '', propertyId ?? ''),
    enabled: Boolean(userId && propertyId && enabled),
    queryFn: async () => getUnreadInboxCount(userId!, propertyId!),
  });
}

function summarizeWmUnits(units: DashboardWmUnit[]): OwnerWmSummary {
  let inUseCount = 0;
  let freeCount = 0;
  let outOfOrderCount = 0;
  for (const unit of units) {
    if (unit.status === 'in_use') inUseCount += 1;
    else if (unit.status === 'out_of_order') outOfOrderCount += 1;
    else freeCount += 1;
  }
  return {
    totalCount: units.length,
    inUseCount,
    freeCount,
    outOfOrderCount,
  };
}

interface OwnerDashWmMutationContext {
  previousQueries: [readonly unknown[], OwnerDashboardData | undefined][];
}

export function useOwnerReleaseWmMutation() {
  const qc = useQueryClient();

  return useMutation<
    void,
    Error,
    { propertyId: string; machineId: string },
    OwnerDashWmMutationContext
  >({
    mutationFn: async ({ propertyId, machineId }) => {
      const result = await releaseWashingMachineUnit(propertyId, machineId);
      if (!result.ok) {
        throw new Error(
          result.error.message || 'Failed to release washing machine.'
        );
      }
    },
    onMutate: async ({ propertyId, machineId }) => {
      await qc.cancelQueries({ queryKey: ['dashboard', 'owner', propertyId] });
      const previousQueries = qc.getQueriesData<OwnerDashboardData>({
        queryKey: ['dashboard', 'owner', propertyId],
      });

      for (const [key, dash] of previousQueries) {
        if (!dash) continue;
        const nextUnits = dash.wmUnits.map((unit) =>
          unit.id === machineId
            ? {
                ...unit,
                status: 'free' as const,
                current_resident_id: null,
                current_resident_name: null,
                current_resident_room: null,
                started_at: null,
              }
            : unit
        );
        qc.setQueryData<OwnerDashboardData>(key, {
          ...dash,
          wmUnits: nextUnits,
          wmSummary: summarizeWmUnits(nextUnits),
        });
      }

      return { previousQueries };
    },
    onError: (_err, _vars, context) => {
      if (!context) return;
      for (const [key, snapshot] of context.previousQueries) {
        qc.setQueryData(key, snapshot);
      }
    },
    onSettled: (_data, err, variables) => {
      if (!err) {
        broadcastPropertySync('washingMachine', variables.propertyId);
      }
      void qc.invalidateQueries({
        queryKey: ['dashboard', 'owner', variables.propertyId],
      });
      void qc.invalidateQueries({
        queryKey: queryKeys.washingMachine.property(variables.propertyId),
      });
    },
  });
}

export function useOwnerSetWmOutOfOrderMutation() {
  const qc = useQueryClient();

  return useMutation<
    void,
    Error,
    { propertyId: string; machineId: string; outOfOrder: boolean },
    OwnerDashWmMutationContext
  >({
    mutationFn: async ({ propertyId, machineId, outOfOrder }) => {
      const result = await setWashingMachineOutOfOrder(
        propertyId,
        machineId,
        outOfOrder
      );
      if (!result.ok) {
        throw new Error(
          result.error.message || 'Failed to update washing machine status.'
        );
      }
    },
    onMutate: async ({ propertyId, machineId, outOfOrder }) => {
      await qc.cancelQueries({ queryKey: ['dashboard', 'owner', propertyId] });
      const previousQueries = qc.getQueriesData<OwnerDashboardData>({
        queryKey: ['dashboard', 'owner', propertyId],
      });

      for (const [key, dash] of previousQueries) {
        if (!dash) continue;
        const nextUnits = dash.wmUnits.map((unit) =>
          unit.id === machineId
            ? {
                ...unit,
                status: outOfOrder ? ('out_of_order' as const) : ('free' as const),
                current_resident_id: null,
                current_resident_name: null,
                current_resident_room: null,
                started_at: null,
              }
            : unit
        );
        qc.setQueryData<OwnerDashboardData>(key, {
          ...dash,
          wmUnits: nextUnits,
          wmSummary: summarizeWmUnits(nextUnits),
        });
      }

      return { previousQueries };
    },
    onError: (_err, _vars, context) => {
      if (!context) return;
      for (const [key, snapshot] of context.previousQueries) {
        qc.setQueryData(key, snapshot);
      }
    },
    onSettled: (_data, err, variables) => {
      if (!err) {
        broadcastPropertySync('washingMachine', variables.propertyId);
      }
      void qc.invalidateQueries({
        queryKey: ['dashboard', 'owner', variables.propertyId],
      });
      void qc.invalidateQueries({
        queryKey: queryKeys.washingMachine.property(variables.propertyId),
      });
    },
  });
}

export function useStudentDashboardQuery(userId: string | undefined) {
  const todayIso = toLocalIsoDate();

  return useQuery<StudentDashboardData, Error>({
    queryKey: queryKeys.dashboard.student(userId ?? '', todayIso),
    enabled: Boolean(userId),
    queryFn: async () => {
      const result = await fetchStudentDashboard(userId!);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
  });
}

export function useStudentUnreadNoticesQuery(
  userId: string | undefined,
  propertyId: string | null | undefined,
  roomNumber: string
) {
  return useQuery<
    { unreadCount: number; latestUnreadAnnouncement: ResidentNoticeItem | null },
    Error
  >({
    queryKey: queryKeys.dashboard.studentNotices(
      userId ?? '',
      propertyId ?? '',
      roomNumber
    ),
    enabled: Boolean(userId && propertyId),
    queryFn: async () =>
      getUnreadResidentNoticesSummary(userId!, propertyId!, roomNumber),
  });
}

export interface WardenDashboardData {
  property: { id: string; name: string } | null;
  audienceList: AudienceResident[];
  recent: FoodAlertRecord[];
}

export function useWardenDashboardQuery(userId: string | undefined) {
  return useQuery<WardenDashboardData, Error>({
    queryKey: queryKeys.dashboard.warden(userId ?? ''),
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data: assignment, error: assignmentError } = await supabase
        .from('property_wardens')
        .select('property_id, properties(name)')
        .eq('warden_profile_id', userId!)
        .eq('is_active', true)
        .maybeSingle();
      if (assignmentError) throw assignmentError;

      if (!assignment) {
        return {
          property: null,
          audienceList: [],
          recent: [],
        };
      }

      const typedAssignment = assignment as {
        property_id: string;
        properties: { name?: string } | { name?: string }[] | null;
      };
      const propertyRel = typedAssignment.properties;
      const propertyName =
        (Array.isArray(propertyRel)
          ? propertyRel[0]?.name
          : propertyRel?.name) ?? 'Your PG';
      const propertyId = typedAssignment.property_id;

      const [audienceRes, recentRes] = await Promise.all([
        supabase.rpc('get_alert_audience', { p_property_id: propertyId }),
        supabase
          .from('food_alerts')
          .select(
            'id, property_id, meal_type, status, message, audience_type, dispatch_status, recipients_count, push_sent, push_failed, no_token_count, alert_date, created_at'
          )
          .eq('property_id', propertyId)
          .order('created_at', { ascending: false })
          .limit(8),
      ]);
      if (audienceRes.error) throw audienceRes.error;
      if (recentRes.error) throw recentRes.error;

      return {
        property: { id: propertyId, name: propertyName },
        audienceList: (audienceRes.data ?? []) as AudienceResident[],
        recent: (recentRes.data ?? []) as FoodAlertRecord[],
      };
    },
  });
}

export interface SendWardenFoodAlertInput {
  userId: string | undefined;
  meal_type: FoodMealType;
  status: FoodAlertStatus;
  audience_type: FoodAudienceType;
  rooms?: string[];
  resident_ids?: string[];
  message?: string;
  idempotency_key: string;
}

export function useSendWardenFoodAlertMutation() {
  const qc = useQueryClient();

  return useMutation<
    AlertSendSummary & { success: boolean },
    Error,
    SendWardenFoodAlertInput
  >({
    mutationFn: async (input) => {
      const {
        meal_type,
        status,
        audience_type,
        rooms,
        resident_ids,
        message,
        idempotency_key,
      } = input;
      return invokeEdgeFunction<AlertSendSummary & { success: boolean }>(
        'send-food-alert',
        {
          meal_type,
          status,
          audience_type,
          rooms,
          resident_ids,
          message,
          idempotency_key,
        }
      );
    },
    onSuccess: (_data, variables) => {
      broadcastPropertySync('food');
      trackEvent('food_alert_sent', {
        meal_type: variables.meal_type,
        status: variables.status,
      });
      void qc.invalidateQueries({
        queryKey: variables.userId
          ? queryKeys.dashboard.warden(variables.userId)
          : queryKeys.dashboard.all,
      });
    },
  });
}
