import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { broadcastPropertySync } from '@/lib/realtime-sync';

import {
  addPropertyExpense,
  deletePropertyExpense,
  ExpenseCategory,
  fetchPropertyExpenses,
  PropertyExpenseItem,
} from '@/services/expenses.service';

export const expenseQueryKeys = {
  all: ['expenses'] as const,
  monthly: (propertyId: string | null, monthIsoStart: string) =>
    ['expenses', propertyId ?? 'none', monthIsoStart.slice(0, 7)] as const,
};

export function usePropertyExpensesQuery(params: {
  propertyId: string | null;
  monthIsoStart: string;
  monthIsoEnd: string;
  enabled?: boolean;
}) {
  const { propertyId, monthIsoStart, monthIsoEnd, enabled = true } = params;

  return useQuery<PropertyExpenseItem[], Error>({
    queryKey: expenseQueryKeys.monthly(propertyId, monthIsoStart),
    enabled: Boolean(propertyId) && enabled,
    queryFn: async () => {
      if (!propertyId) return [];
      const res = await fetchPropertyExpenses({
        propertyId,
        monthIsoStart,
        monthIsoEnd,
      });
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
  });
}

export function useAddPropertyExpenseMutation() {
  const qc = useQueryClient();

  return useMutation<
    PropertyExpenseItem,
    Error,
    {
      propertyId: string;
      category: ExpenseCategory;
      amountPaise: number;
      expenseDate: string;
      notes?: string | null;
      createdBy?: string | null;
    }
  >({
    mutationFn: async (vars) => {
      const res = await addPropertyExpense(vars);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    onSettled: (_data, err) => {
      if (!err) broadcastPropertySync('billing');
      void qc.invalidateQueries({ queryKey: expenseQueryKeys.all });
    },
  });
}

export function useDeletePropertyExpenseMutation() {
  const qc = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (expenseId) => {
      const res = await deletePropertyExpense(expenseId);
      if (!res.ok) throw new Error(res.error.message);
    },
    onSettled: (_data, err) => {
      if (!err) broadcastPropertySync('billing');
      void qc.invalidateQueries({ queryKey: expenseQueryKeys.all });
    },
  });
}
