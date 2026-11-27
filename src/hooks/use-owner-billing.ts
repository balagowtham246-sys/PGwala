import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query-keys';
import { broadcastPropertySync } from '@/lib/realtime-sync';
import {
  allocateEbBill,
  AllocateEbBillParams,
  cancelUnpaidCharge,
  CancelUnpaidChargeParams,
  confirmMonthlyPayment,
  ConfirmMonthlyPaymentParams,
  ConfirmMonthlyPaymentResult,
  generateMonthlyBills,
  GenerateMonthlyBillsParams,
  GenerateMonthlyBillsResult,
  getOwnerBilling,
  GetOwnerBillingParams,
  OwnerBillingSnapshot,
  recordPartialPayment,
  RecordPartialPaymentParams,
  RecordPartialPaymentResult,
  rejectStudentPaymentReport,
  RejectPaymentReportParams,
  reverseChargePayments,
  ReverseChargePaymentsParams,
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
    onSettled: (_data, err) => {
      if (!err) broadcastPropertySync('billing');
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
    onSettled: (_data, err) => {
      if (!err) broadcastPropertySync('billing');
      void qc.invalidateQueries({ queryKey: queryKeys.billing.all });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    },
  });
}

interface OwnerBillingSnapshotContext {
  previousSnapshots: [readonly unknown[], OwnerBillingSnapshot | undefined][];
}

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
            const acPaise = item.ac_paise ?? (item.is_ac ? 50000 : 0);
            return {
              ...item,
              monthly_rent_paise: variables.rentPaise,
              rent_paise: variables.rentPaise,
              total_paise:
                item.status === 'paid'
                  ? item.total_paise
                  : variables.rentPaise + wmPaise + acPaise,
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
    onSettled: (_data, err) => {
      if (!err) broadcastPropertySync('billing');
      void qc.invalidateQueries({ queryKey: queryKeys.billing.all });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    },
  });
}

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
            const acPaise = item.ac_paise ?? (item.is_ac ? 50000 : 0);
            const keepExistingCharge = item.status === 'paid';
            return {
              ...item,
              opt_in_wm: variables.isEnabled,
              wm_request_pending: false,
              wm_paise: keepExistingCharge ? item.wm_paise : nextWm,
              total_paise: keepExistingCharge
                ? item.total_paise
                : item.rent_paise + nextWm + acPaise,
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
    onSettled: (_data, err) => {
      if (!err) broadcastPropertySync('billing');
      void qc.invalidateQueries({ queryKey: queryKeys.billing.all });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    },
  });
}

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
    onSettled: (_data, err) => {
      if (!err) broadcastPropertySync('billing');
      void qc.invalidateQueries({ queryKey: queryKeys.billing.all });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
      void qc.invalidateQueries({ queryKey: queryKeys.residents.all });
    },
  });
}

export function useRecordPartialPaymentMutation() {
  const qc = useQueryClient();

  return useMutation<RecordPartialPaymentResult, Error, RecordPartialPaymentParams>({
    mutationFn: async (params) => {
      const result = await recordPartialPayment(params);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    onSettled: (_data, err) => {
      if (!err) broadcastPropertySync('billing');
      void qc.invalidateQueries({ queryKey: queryKeys.billing.all });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
      void qc.invalidateQueries({ queryKey: queryKeys.residents.all });
    },
  });
}

export function useRejectPaymentReportMutation() {
  const qc = useQueryClient();

  return useMutation<void, Error, RejectPaymentReportParams>({
    mutationFn: async (params) => {
      const result = await rejectStudentPaymentReport(params);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
    },
    onSettled: (_data, err) => {
      if (!err) broadcastPropertySync('billing');
      void qc.invalidateQueries({ queryKey: queryKeys.billing.all });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    },
  });
}

export function useReverseChargePaymentsMutation() {
  const qc = useQueryClient();

  return useMutation<{ message: string }, Error, ReverseChargePaymentsParams>({
    mutationFn: async (params) => {
      const result = await reverseChargePayments(params);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    onSettled: (_data, err) => {
      if (!err) broadcastPropertySync('billing');
      void qc.invalidateQueries({ queryKey: queryKeys.billing.all });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
      void qc.invalidateQueries({ queryKey: queryKeys.residents.all });
    },
  });
}

export function useCancelUnpaidChargeMutation() {
  const qc = useQueryClient();

  return useMutation<{ message: string }, Error, CancelUnpaidChargeParams>({
    mutationFn: async (params) => {
      const result = await cancelUnpaidCharge(params);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    onSettled: (_data, err) => {
      if (!err) broadcastPropertySync('billing');
      void qc.invalidateQueries({ queryKey: queryKeys.billing.all });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
      void qc.invalidateQueries({ queryKey: queryKeys.residents.all });
    },
  });
}
