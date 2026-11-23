import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query-keys';
import {
  allocateEbBill,
  AllocateEbBillParams,
  confirmMonthlyPayment,
  ConfirmMonthlyPaymentParams,
  ConfirmMonthlyPaymentResult,
  generateMonthlyBills,
  GenerateMonthlyBillsParams,
  GenerateMonthlyBillsResult,
  getOwnerBilling,
  GetOwnerBillingParams,
  OwnerBillingSnapshot,
  rejectStudentPaymentReport,
  RejectPaymentReportParams,
  toggleResidentWmBilling,
  ToggleWmBillingParams,
  updateResidentRent,
  UpdateResidentRentParams,
} from '@/services/billing.service';

export function useOwnerBillingQuery(params: GetOwnerBillingParams) {
  const { userId, selectedPropertyId, monthIsoStart } = params;
  const queryKey = queryKeys.billing.owner(selectedPropertyId, monthIsoStart);

  return useQuery<OwnerBillingSnapshot, Error>({
    queryKey,
    enabled: Boolean(userId),
    queryFn: async () => {
      const result = await getOwnerBilling(params);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
  });
}

export function useGenerateMonthlyBillsMutation() {
  const qc = useQueryClient();

  return useMutation<GenerateMonthlyBillsResult, Error, GenerateMonthlyBillsParams>({
    mutationFn: async (params) => {
      const result = await generateMonthlyBills(params);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.billing.all });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    },
  });
}

export function useAllocateEbBillMutation() {
  const qc = useQueryClient();

  return useMutation<void, Error, AllocateEbBillParams>({
    mutationFn: async (params) => {
      const result = await allocateEbBill(params);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.billing.all });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    },
  });
}

interface OwnerBillingSnapshotContext {
  previousSnapshots: [readonly unknown[], OwnerBillingSnapshot | undefined][];
}

/**
 * Non-money resident rent edit with optimistic cache update, rollback on error,
 * and billing/dashboard invalidation on settle.
 */
export function useUpdateResidentRentMutation() {
  const qc = useQueryClient();

  return useMutation<void, Error, UpdateResidentRentParams, OwnerBillingSnapshotContext>({
    mutationFn: async (params) => {
      const result = await updateResidentRent(params);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
    },
    onMutate: async (variables) => {
      await qc.cancelQueries({ queryKey: queryKeys.billing.all });
      const previousSnapshots = qc.getQueriesData<OwnerBillingSnapshot>({
        queryKey: ['billing', 'owner'],
      });

      const monthKey = variables.monthIsoStart.slice(0, 7);
      for (const [key, data] of previousSnapshots) {
        if (!data) continue;
        const keyMonth = Array.isArray(key) ? key[3] : undefined;
        if (keyMonth && keyMonth !== monthKey) continue;
        if (data.propertyId && data.propertyId !== variables.propertyId) continue;

        qc.setQueryData<OwnerBillingSnapshot>(key, {
          ...data,
          rentBills: data.rentBills.map((item) => {
            if (item.resident_id !== variables.residentId) return item;
            const wmPaise = item.charge_id
              ? item.wm_paise
              : item.opt_in_wm
                ? 50000
                : 0;
            return {
              ...item,
              monthly_rent_paise: variables.rentPaise,
              rent_paise: variables.rentPaise,
              total_paise:
                item.status === 'paid'
                  ? item.total_paise
                  : variables.rentPaise + wmPaise,
            };
          }),
        });
      }

      return { previousSnapshots };
    },
    onError: (_err, _variables, context) => {
      if (!context) return;
      for (const [key, snapshot] of context.previousSnapshots) {
        qc.setQueryData(key, snapshot);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.billing.all });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    },
  });
}

/**
 * Non-money washing-machine opt-in toggle with optimistic cache update,
 * rollback on error, and billing/dashboard invalidation on settle.
 */
export function useToggleWmBillingMutation() {
  const qc = useQueryClient();

  return useMutation<void, Error, ToggleWmBillingParams, OwnerBillingSnapshotContext>({
    mutationFn: async (params) => {
      const result = await toggleResidentWmBilling(params);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
    },
    onMutate: async (variables) => {
      await qc.cancelQueries({ queryKey: queryKeys.billing.all });
      const previousSnapshots = qc.getQueriesData<OwnerBillingSnapshot>({
        queryKey: ['billing', 'owner'],
      });

      const monthKey = variables.monthIsoStart.slice(0, 7);
      for (const [key, data] of previousSnapshots) {
        if (!data) continue;
        const keyMonth = Array.isArray(key) ? key[3] : undefined;
        if (keyMonth && keyMonth !== monthKey) continue;
        if (data.propertyId && data.propertyId !== variables.propertyId) continue;

        qc.setQueryData<OwnerBillingSnapshot>(key, {
          ...data,
          rentBills: data.rentBills.map((item) => {
            if (item.resident_id !== variables.residentId) return item;
            const nextWm = variables.isEnabled ? 50000 : 0;
            const keepExistingCharge = item.status === 'paid';
            return {
              ...item,
              opt_in_wm: variables.isEnabled,
              wm_request_pending: false,
              wm_paise: keepExistingCharge ? item.wm_paise : nextWm,
              total_paise: keepExistingCharge
                ? item.total_paise
                : item.rent_paise + nextWm,
            };
          }),
        });
      }

      return { previousSnapshots };
    },
    onError: (_err, _variables, context) => {
      if (!context) return;
      for (const [key, snapshot] of context.previousSnapshots) {
        qc.setQueryData(key, snapshot);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.billing.all });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    },
  });
}

/**
 * Money-confirmation mutation: uses pending state (no optimistic Paid state)
 * and invalidates billing + dashboard queries on settle.
 */
export function useConfirmMonthlyPaymentMutation() {
  const qc = useQueryClient();

  return useMutation<ConfirmMonthlyPaymentResult, Error, ConfirmMonthlyPaymentParams>({
    mutationFn: async (params) => {
      const result = await confirmMonthlyPayment(params);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.billing.all });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    },
  });
}

/**
 * Payment-rejection mutation: uses pending state (no optimistic status flip)
 * and invalidates billing + dashboard queries on settle.
 */
export function useRejectPaymentReportMutation() {
  const qc = useQueryClient();

  return useMutation<void, Error, RejectPaymentReportParams>({
    mutationFn: async (params) => {
      const result = await rejectStudentPaymentReport(params);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.billing.all });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    },
  });
}
