import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Check } from 'lucide-react-native';

import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { OwnerTheme } from '@/constants/theme';
import { formatPaiseToRupees, rupeesToPaise } from '@/lib/billing-utils';
import { PaymentMethod } from '@/services/billing.service';

export interface PartialPaymentTarget {
  chargeId: string;
  residentName: string;
  roomNumber: string;
  billLabel: string;
  totalPaise: number;
  alreadyPaidPaise: number;
  remainingPaise: number;
}

export function PartialPaymentModal({
  target,
  submitting,
  onClose,
  onConfirm,
}: {
  target: PartialPaymentTarget | null;
  submitting: boolean;
  onClose: () => void;
  onConfirm: (payload: {
    chargeId: string;
    amountPaise: number;
    method: PaymentMethod;
    notes: string;
  }) => void;
}) {
  const [payMode, setPayMode] = useState<'full' | 'partial'>('full');
  const [amountInput, setAmountInput] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!target) return;
    const timer = setTimeout(() => {
      setPayMode('full');
      setAmountInput(String(Math.round(target.remainingPaise / 100)));
      setMethod('cash');
      setNotes('');
    }, 0);
    return () => clearTimeout(timer);
  }, [target]);

  if (!target) return null;

  const parsedRupees = parseFloat(amountInput.trim());
  const amountPaise =
    payMode === 'full'
      ? target.remainingPaise
      : Number.isFinite(parsedRupees) && parsedRupees > 0
        ? rupeesToPaise(parsedRupees)
        : 0;
  const isInvalid = submitting || amountPaise <= 0;
  const remainingAfter = Math.max(0, target.remainingPaise - amountPaise);
  const advanceCredit = Math.max(0, amountPaise - target.remainingPaise);

  return (
    <BottomSheetModal
      visible={Boolean(target)}
      onClose={onClose}
      title="Record Payment"
      subtitle={`${target.residentName} · Room ${target.roomNumber} · ${target.billLabel}`}
      disabled={submitting}>
      <View style={styles.sheetBody}>

          {target.alreadyPaidPaise > 0 ? (
            <View style={styles.paidStrip}>
              <Text style={styles.paidStripText}>
                Paid {formatPaiseToRupees(target.alreadyPaidPaise)} of{' '}
                {formatPaiseToRupees(target.totalPaise)} · Due{' '}
                {formatPaiseToRupees(target.remainingPaise)}
              </Text>
            </View>
          ) : null}

          {/* Full vs Partial Switcher */}
          <View style={styles.segmentRow}>
            <Pressable
              style={[styles.segmentBtn, payMode === 'full' && styles.segmentBtnActive]}
              onPress={() => {
                setPayMode('full');
                setAmountInput(String(Math.round(target.remainingPaise / 100)));
              }}>
              <Text
                style={[
                  styles.segmentText,
                  payMode === 'full' && styles.segmentTextActive,
                ]}>
                Full ({formatPaiseToRupees(target.remainingPaise)})
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.segmentBtn,
                payMode === 'partial' && styles.segmentBtnActive,
              ]}
              onPress={() => {
                setPayMode('partial');
                setAmountInput('');
              }}>
              <Text
                style={[
                  styles.segmentText,
                  payMode === 'partial' && styles.segmentTextActive,
                ]}>
                Partial / Advance
              </Text>
            </Pressable>
          </View>

          {payMode === 'partial' ? (
            <View style={{ gap: 6 }}>
              <Text style={styles.label}>Amount Received (₹)</Text>
              <TextInput
                style={styles.input}
                value={amountInput}
                onChangeText={setAmountInput}
                placeholder={`e.g. ${Math.max(500, Math.round(target.remainingPaise / 200))}`}
                placeholderTextColor={OwnerTheme.colors.textMuted}
                keyboardType="numeric"
                autoFocus
                editable={!submitting}
              />
              {amountPaise > 0 ? (
                <Text style={styles.previewHint}>
                  {advanceCredit > 0
                    ? `Bill settles in full + ${formatPaiseToRupees(advanceCredit)} advance credit`
                    : remainingAfter > 0
                      ? `Remaining balance after payment: ${formatPaiseToRupees(remainingAfter)}`
                      : 'Settles this bill in full'}
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* Payment Method */}
          <View style={{ gap: 6 }}>
            <Text style={styles.label}>Method</Text>
            <View style={styles.methodRow}>
              {(['cash', 'upi'] as const).map((m) => (
                <Pressable
                  key={m}
                  style={[styles.methodPill, method === m && styles.methodPillActive]}
                  onPress={() => setMethod(m)}>
                  <Text
                    style={[
                      styles.methodPillText,
                      method === m && styles.methodPillTextActive,
                    ]}>
                    {m.toUpperCase()}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <TextInput
            style={styles.noteInput}
            value={notes}
            onChangeText={setNotes}
            placeholder="Optional note (e.g. paid part 1)"
            placeholderTextColor={OwnerTheme.colors.textMuted}
            editable={!submitting}
          />

          <Pressable
            disabled={isInvalid}
            style={[styles.confirmBtn, isInvalid && { opacity: 0.55 }]}
            onPress={() =>
              onConfirm({
                chargeId: target.chargeId,
                amountPaise,
                method,
                notes: notes.trim(),
              })
            }>
            {submitting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Check size={16} color="#FFFFFF" />
                <Text style={styles.confirmBtnText}>
                  Confirm {amountPaise > 0 ? formatPaiseToRupees(amountPaise) : ''}
                </Text>
              </>
            )}
          </Pressable>
      </View>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  sheetBody: {
    gap: 12,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 18,
    gap: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  title: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  subtitle: { fontSize: 12, color: '#64748B', marginTop: 2 },
  paidStrip: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  paidStripText: { fontSize: 12, fontWeight: '700', color: '#92400E' },
  segmentRow: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    padding: 3,
    gap: 4,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
  },
  segmentBtnActive: { backgroundColor: '#FFFFFF' },
  segmentText: { fontSize: 12, fontWeight: '600', color: '#64748B' },
  segmentTextActive: { color: OwnerTheme.colors.primary, fontWeight: '700' },
  label: { fontSize: 12, fontWeight: '600', color: '#475569' },
  input: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    backgroundColor: '#F8FAFC',
  },
  previewHint: { fontSize: 11, fontWeight: '600', color: OwnerTheme.colors.primary },
  methodRow: { flexDirection: 'row', gap: 8 },
  methodPill: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
  },
  methodPillActive: {
    backgroundColor: OwnerTheme.colors.primaryLight,
    borderColor: OwnerTheme.colors.primary,
  },
  methodPillText: { fontSize: 13, fontWeight: '600', color: '#475569' },
  methodPillTextActive: { color: OwnerTheme.colors.primary, fontWeight: '700' },
  noteInput: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
    color: '#0F172A',
    backgroundColor: '#F8FAFC',
  },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: OwnerTheme.colors.primary,
    borderRadius: 12,
    paddingVertical: 13,
  },
  confirmBtnText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
});
