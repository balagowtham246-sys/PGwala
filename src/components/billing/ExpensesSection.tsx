import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Trash2, TrendingDown, TrendingUp } from 'lucide-react-native';

import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { EmptyState } from '@/components/ui/owner';
import { OwnerTheme } from '@/constants/theme';
import { formatPaiseToRupees, rupeesToPaise } from '@/lib/billing-utils';
import {
  EXPENSE_CATEGORIES,
  ExpenseCategory,
  PropertyExpenseItem,
} from '@/services/expenses.service';

export function ExpensesSection({
  monthLabel,
  totalCollectedPaise,
  expenses,
  loading,
  saving,
  addModalVisible,
  onOpenAddModal,
  onCloseAddModal,
  onAddExpense,
  onDeleteExpense,
}: {
  monthLabel: string;
  totalCollectedPaise: number;
  expenses: PropertyExpenseItem[];
  loading: boolean;
  saving: boolean;
  addModalVisible: boolean;
  onOpenAddModal: () => void;
  onCloseAddModal: () => void;
  onAddExpense: (payload: {
    category: ExpenseCategory;
    amountPaise: number;
    notes: string;
  }) => Promise<void>;
  onDeleteExpense: (expenseId: string) => void;
}) {
  const [category, setCategory] = useState<ExpenseCategory>('salary');
  const [amountInput, setAmountInput] = useState('');
  const [notes, setNotes] = useState('');

  const totalExpensesPaise = useMemo(
    () => expenses.reduce((sum, item) => sum + (item.amount_paise || 0), 0),
    [expenses]
  );
  const netProfitPaise = totalCollectedPaise - totalExpensesPaise;
  const isPositive = netProfitPaise >= 0;

  const categoryLabelMap = useMemo(() => {
    const map = new Map<ExpenseCategory, string>();
    for (const c of EXPENSE_CATEGORIES) map.set(c.key, c.label);
    return map;
  }, []);

  const handleSubmit = async () => {
    const parsed = parseFloat(amountInput.trim());
    if (!Number.isFinite(parsed) || parsed <= 0) {
      Alert.alert('Invalid Amount', 'Enter a valid expense amount in ₹.');
      return;
    }
    await onAddExpense({
      category,
      amountPaise: rupeesToPaise(parsed),
      notes: notes.trim(),
    });
    setAmountInput('');
    setNotes('');
    onCloseAddModal();
  };

  return (
    <View style={styles.root}>
      {/* Dark-Slate Net Profit Hero Card */}
      <View style={styles.heroCard}>
        <View style={styles.heroTopRow}>
          <Text style={styles.heroEyebrow}>NET PROFIT · {monthLabel.toUpperCase()}</Text>
          <View
            style={[
              styles.profitPill,
              isPositive ? styles.profitPillOk : styles.profitPillLoss,
            ]}>
            {isPositive ? (
              <TrendingUp size={12} color="#34D399" />
            ) : (
              <TrendingDown size={12} color="#FCA5A5" />
            )}
            <Text
              style={[
                styles.profitPillText,
                { color: isPositive ? '#34D399' : '#FCA5A5' },
              ]}>
              {isPositive ? 'Surplus' : 'Deficit'}
            </Text>
          </View>
        </View>

        <Text style={styles.heroAmount}>
          {netProfitPaise < 0 ? '-' : ''}
          {formatPaiseToRupees(Math.abs(netProfitPaise))}
        </Text>

        <View style={styles.heroSplitRow}>
          <View style={styles.heroStatBox}>
            <Text style={styles.heroStatLabel}>Collected</Text>
            <Text style={[styles.heroStatVal, { color: '#34D399' }]}>
              {formatPaiseToRupees(totalCollectedPaise)}
            </Text>
          </View>
          <View style={styles.heroStatBox}>
            <Text style={styles.heroStatLabel}>Expenses</Text>
            <Text style={[styles.heroStatVal, { color: '#FCA5A5' }]}>
              {formatPaiseToRupees(totalExpensesPaise)}
            </Text>
          </View>
        </View>
      </View>

      {/* List Header */}
      <View style={styles.listHeaderRow}>
        <Text style={styles.listTitle}>
          Monthly Expenses ({expenses.length})
        </Text>
      </View>

      {loading ? (
        <View style={{ padding: 24, alignItems: 'center' }}>
          <ActivityIndicator size="small" color={OwnerTheme.colors.primary} />
        </View>
      ) : expenses.length === 0 ? (
        <EmptyState
          title="No expenses logged"
          description={`Track cook salary, EB, water, or groceries for ${monthLabel}.`}
          actionLabel="+ Add Expense"
          onAction={onOpenAddModal}
        />
      ) : (
        <View style={{ gap: 8 }}>
          {expenses.map((item) => (
            <View key={item.id} style={styles.expenseRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.expenseCat}>
                  {categoryLabelMap.get(item.category) ?? item.category}
                </Text>
                <Text style={styles.expenseMeta} numberOfLines={1}>
                  {item.expense_date}
                  {item.notes ? ` · ${item.notes}` : ''}
                </Text>
              </View>
              <Text style={styles.expenseAmt}>
                {formatPaiseToRupees(item.amount_paise)}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Delete expense"
                hitSlop={8}
                onPress={() =>
                  Alert.alert(
                    'Delete Expense?',
                    `Remove ${formatPaiseToRupees(item.amount_paise)} (${
                      categoryLabelMap.get(item.category) ?? item.category
                    })?`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete',
                        style: 'destructive',
                        onPress: () => onDeleteExpense(item.id),
                      },
                    ]
                  )
                }>
                <Trash2 size={15} color="#DC2626" />
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {/* Compact 3-Field Add Expense Bottom Sheet */}
      <BottomSheetModal
        visible={addModalVisible}
        onClose={onCloseAddModal}
        title="Add Expense"
        subtitle={monthLabel}
        disabled={saving}>
        <Text style={styles.label}>Category</Text>
        <View style={styles.chipWrap}>
          {EXPENSE_CATEGORIES.map((c) => (
            <Pressable
              key={c.key}
              style={[
                styles.catChip,
                category === c.key && styles.catChipActive,
              ]}
              onPress={() => setCategory(c.key)}>
              <Text
                style={[
                  styles.catChipText,
                  category === c.key && styles.catChipTextActive,
                ]}>
                {c.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Amount (₹)</Text>
        <TextInput
          style={styles.input}
          value={amountInput}
          onChangeText={setAmountInput}
          placeholder="e.g. 8500"
          placeholderTextColor="#94A3B8"
          keyboardType="numeric"
          editable={!saving}
        />

        <Text style={styles.label}>Note (Optional)</Text>
        <TextInput
          style={styles.input}
          value={notes}
          onChangeText={setNotes}
          placeholder="e.g. Cook salary or water tanker"
          placeholderTextColor="#94A3B8"
          editable={!saving}
        />

        <Pressable
          disabled={saving}
          style={[styles.saveBtn, saving && { opacity: 0.6 }]}
          onPress={() => void handleSubmit()}>
          {saving ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.saveBtnText}>Save Expense</Text>
          )}
        </Pressable>
      </BottomSheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12 },
  heroCard: {
    backgroundColor: '#0F172A',
    borderRadius: 18,
    padding: 16,
    gap: 10,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.6,
  },
  profitPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
  },
  profitPillOk: { backgroundColor: 'rgba(16, 185, 129, 0.16)' },
  profitPillLoss: { backgroundColor: 'rgba(239, 68, 68, 0.16)' },
  profitPillText: { fontSize: 11, fontWeight: '700' },
  heroAmount: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  heroSplitRow: { flexDirection: 'row', gap: 10 },
  heroStatBox: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 12,
    padding: 10,
  },
  heroStatLabel: { fontSize: 11, fontWeight: '600', color: '#94A3B8' },
  heroStatVal: { fontSize: 15, fontWeight: '800', marginTop: 2 },
  listHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  listTitle: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: OwnerTheme.colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  addBtnText: { fontSize: 12, fontWeight: '700', color: '#FFFFFF' },
  expenseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 12,
  },
  expenseCat: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  expenseMeta: { fontSize: 12, color: '#64748B', marginTop: 2 },
  expenseAmt: { fontSize: 14, fontWeight: '800', color: '#DC2626' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 18,
    gap: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  label: { fontSize: 12, fontWeight: '600', color: '#475569' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  catChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
  },
  catChipActive: {
    backgroundColor: OwnerTheme.colors.primary,
    borderColor: OwnerTheme.colors.primary,
  },
  catChipText: { fontSize: 12, fontWeight: '600', color: '#475569' },
  catChipTextActive: { color: '#FFFFFF' },
  input: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0F172A',
    backgroundColor: '#F8FAFC',
  },
  saveBtn: {
    marginTop: 4,
    backgroundColor: OwnerTheme.colors.primary,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  saveBtnText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
});
