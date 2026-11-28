import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { trackEvent } from '@/lib/analytics';
import { queryKeys } from '@/lib/query-keys';
import { broadcastPropertySync } from '@/lib/realtime-sync';
import {
  getStudentBilling,
  PreResolvedStudentContext,
  StudentBillingSnapshot,
  SubmitStudentPaymentProofParams,
  submitStudentPaymentProof,
  WithdrawStudentPaymentProofParams,
  withdrawStudentPaymentProof,
} from '@/services/billing.service';

export function useStudentBillingQuery(
  userId: string | undefined,
  residentContext: PreResolvedStudentContext | null
) {
  const queryKey = queryKeys.billing.student(userId ?? '');

  return useQuery<StudentBillingSnapshot, Error>({
    queryKey,
    enabled: Boolean(userId),
    queryFn: async () => {
      const result = await getStudentBilling(userId!, { residentContext });
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
  });
}

export function useSubmitPaymentProofMutation() {
  const qc = useQueryClient();

  return useMutation<null, Error, SubmitStudentPaymentProofParams>({
    mutationFn: async (params) => {
      const result = await submitStudentPaymentProof(params);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    onSuccess: (_data, variables) => {
      trackEvent('payment_proof_submitted', { method: variables.paymentMethod });
    },
    onSettled: (_data, err) => {
      if (!err) broadcastPropertySync('billing');
      void qc.invalidateQueries({ queryKey: queryKeys.billing.all });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    },
  });
}

export function useWithdrawPaymentProofMutation() {
  const qc = useQueryClient();

  return useMutation<{ message: string }, Error, WithdrawStudentPaymentProofParams>({
    mutationFn: async (params) => {
      const result = await withdrawStudentPaymentProof(params);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    onSuccess: () => {
      trackEvent('payment_proof_withdrawn');
    },
    onSettled: (_data, err) => {
      if (!err) broadcastPropertySync('billing');
      void qc.invalidateQueries({ queryKey: queryKeys.billing.all });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    },
  });
}
