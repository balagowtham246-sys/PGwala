import { fail, ok, ServiceResult } from '@/lib/service-result';
import { supabase } from '@/lib/supabase';

export type ExpenseCategory =
  | 'salary'
  | 'electricity'
  | 'water'
  | 'grocery'
  | 'maintenance'
  | 'wifi'
  | 'other';

export const EXPENSE_CATEGORIES: { key: ExpenseCategory; label: string }[] = [
  { key: 'salary', label: 'Staff Salary' },
  { key: 'electricity', label: 'EB Bill' },
  { key: 'water', label: 'Water' },
  { key: 'grocery', label: 'Groceries' },
  { key: 'maintenance', label: 'Maintenance' },
  { key: 'wifi', label: 'Wi-Fi' },
  { key: 'other', label: 'Other' },
];

export interface PropertyExpenseItem {
  id: string;
  property_id: string;
  category: ExpenseCategory;
  amount_paise: number;
  expense_date: string;
  notes: string | null;
  created_at: string;
}

export async function fetchPropertyExpenses(params: {
  propertyId: string;
  monthIsoStart: string;
  monthIsoEnd: string;
}): Promise<ServiceResult<PropertyExpenseItem[]>> {
  try {
    const { data, error } = await supabase
      .from('property_expenses')
      .select('id, property_id, category, amount_paise, expense_date, notes, created_at')
      .eq('property_id', params.propertyId)
      .gte('expense_date', params.monthIsoStart)
      .lte('expense_date', params.monthIsoEnd)
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      return fail(error, 'Could not load property expenses.');
    }

    return ok((data ?? []) as PropertyExpenseItem[]);
  } catch (err) {
    return fail(err, 'Could not load property expenses.');
  }
}

export async function addPropertyExpense(params: {
  propertyId: string;
  category: ExpenseCategory;
  amountPaise: number;
  expenseDate: string;
  notes?: string | null;
  createdBy?: string | null;
}): Promise<ServiceResult<PropertyExpenseItem>> {
  try {
    const { data, error } = await supabase
      .from('property_expenses')
      .insert({
        property_id: params.propertyId,
        category: params.category,
        amount_paise: Math.round(params.amountPaise),
        expense_date: params.expenseDate,
        notes: params.notes?.trim() || null,
        created_by: params.createdBy ?? null,
      })
      .select('id, property_id, category, amount_paise, expense_date, notes, created_at')
      .single();

    if (error) {
      return fail(error, 'Could not save expense.');
    }

    return ok(data as PropertyExpenseItem);
  } catch (err) {
    return fail(err, 'Could not save expense.');
  }
}

export async function deletePropertyExpense(
  expenseId: string
): Promise<ServiceResult<void>> {
  try {
    const { error } = await supabase
      .from('property_expenses')
      .delete()
      .eq('id', expenseId);

    if (error) {
      return fail(error, 'Could not delete expense.');
    }

    return ok(undefined);
  } catch (err) {
    return fail(err, 'Could not delete expense.');
  }
}
