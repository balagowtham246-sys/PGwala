import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query-keys';
import {
  getStudentBilling,
  PreResolvedStudentContext,
  StudentBillingSnapshot,
  SubmitStudentPaymentProofParams,
  submitStudentPaymentProof,
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
    onSettled: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.billing.all }),
        qc.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
      ]);
    },
  });
}
