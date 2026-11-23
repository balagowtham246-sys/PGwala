import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { AlertTriangle, CheckCircle2, Share2 } from 'lucide-react-native';

import { useAuth } from '@/context/auth-context';
import { buildPaymentReceiptShareText } from '@/lib/billing-utils';
import { extractErrorMessage } from '@/lib/error-utils';
import { invalidatePrefix } from '@/lib/query-cache';
import { queryKeys } from '@/lib/query-keys';
import { supabase } from '@/lib/supabase';
import { BILLING_CACHE_PREFIX } from '@/services/billing.service';
import { OwnerHeader } from '@/components/ui/owner';

interface PaymentDetail {
  id: string;
  property_id: string;
  resident_id: string;
  receipt_number: string;
  amount_paise: number;
  unallocated_amount_paise: number;
  method: 'cash' | 'upi';
  payment_date: string;
  status: 'approved' | 'reversed';
  notes: string | null;
  reversal_reason: string | null;
  reversed_at: string | null;
  created_at: string;
  resident?: {
    full_name: string;
    room_number: string;
  };
  property?: {
    name: string;
    address: string | null;
  };
  allocations?: {
    id: string;
    settled_amount_paise: number;
    status?: 'active' | 'reversed';
    charge: {
      category: string;
      description: string;
      billing_period_start: string;
      due_date: string;
      amount_paise: number;
    };
  }[];
}

export default function ReceiptDetailScreen() {
  const qc = useQueryClient();
  const { user, profile } = useAuth();
  const userId = user?.id;
  const { id } = useLocalSearchParams<{ id?: string }>();

  const [loading, setLoading] = useState(true);
  const [payment, setPayment] = useState<PaymentDetail | null>(null);
  const [reversing, setReversing] = useState(false);
  const [showReverseModal, setShowReverseModal] = useState(false);
  const [reversalReason, setReversalReason] = useState('');

  const fetchReceiptDetail = useCallback(async () => {
    if (!id || !userId) return null;
    const { data, error } = await supabase
      .from('payments')
      .select(`
        id,
        property_id,
        resident_id,
        receipt_number,
        amount_paise,
        unallocated_amount_paise,
        method,
        payment_date,
        status,
        notes,
        reversal_reason,
        reversed_at,
        created_at,
        resident:residents (
          full_name,
          room_number
        ),
        property:properties (
          name,
          address
        ),
        allocations:payment_allocations (
          id,
          status,
          settled_amount_paise,
          charge:charges (
            category,
            description,
            billing_period_start,
            due_date,
            amount_paise
          )
        )
      `)
      .eq('id', id)
      .single();

    if (error) throw error;
    return (data as any) || null;
  }, [id, userId]);

  const loadReceipt = useCallback(async () => {
    if (!id || !userId) return;
    try {
      setLoading(true);
      const detail = await fetchReceiptDetail();
      setPayment(detail);
    } catch (err: unknown) {
      console.error('[ReceiptDetail] Error loading receipt:', err);
      Alert.alert(
        'Load Failed',
        extractErrorMessage(err, 'Could not load receipt details.')
      );
    } finally {
      setLoading(false);
    }
  }, [id, userId, fetchReceiptDetail]);

  useEffect(() => {
    if (!id || !userId) return;
    let cancelled = false;
    void fetchReceiptDetail()
      .then((detail) => {
        if (!cancelled) {
          setPayment(detail);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error('[ReceiptDetail] Error loading receipt:', err);
        Alert.alert(
          'Load Failed',
          extractErrorMessage(err, 'Could not load receipt details.')
        );
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id, userId, fetchReceiptDetail]);

  const handleOpenReverseModal = () => {
    setReversalReason('');
    setShowReverseModal(true);
  };

  const handleConfirmReversal = async () => {
    if (!payment || reversing) return;
    const trimmed = reversalReason.trim();
    if (!trimmed) {
      Alert.alert('Reason Required', 'Please provide a valid reversal reason.');
      return;
    }

    setReversing(true);
    try {
      const { data, error } = await supabase.rpc('reverse_payment', {
        p_payment_id: payment.id,
        p_reversal_reason: trimmed,
      });

      if (error) throw error;
      if (!data?.success) {
        Alert.alert('Reversal Failed', data?.error || 'Could not reverse payment.');
        return;
      }

      setShowReverseModal(false);
      setReversalReason('');
      void invalidatePrefix(BILLING_CACHE_PREFIX);
      void qc.invalidateQueries({ queryKey: queryKeys.billing.all });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
      Alert.alert('Payment Reversed', data.message || 'Receipt marked as reversed.');
      await loadReceipt();
    } catch (err: unknown) {
      Alert.alert(
        'Error',
        extractErrorMessage(err, 'Failed to reverse payment.')
      );
    } finally {
      setReversing(false);
    }
  };

  const isOwner = profile?.role === 'owner';
  const isReversed = payment?.status === 'reversed';

  const handleShareReceipt = useCallback(async () => {
    if (!payment) return;
    try {
      const message = buildPaymentReceiptShareText({
        receiptNumber: payment.receipt_number,
        propertyName: payment.property?.name || 'PG Accommodation',
        propertyAddress: payment.property?.address,
        residentName: payment.resident?.full_name || 'Resident',
        roomNumber: payment.resident?.room_number,
        amountPaise: payment.amount_paise,
        method: payment.method,
        paymentDate: payment.payment_date,
        status: payment.status,
        notes: payment.notes,
        allocations: (payment.allocations ?? []).map((alloc) => ({
          description: alloc.charge?.description || 'Monthly Bill',
          amountPaise: alloc.settled_amount_paise,
          status: alloc.status,
        })),
      });
      await Share.share({
        title: `Rent Receipt ${payment.receipt_number}`,
        message,
      });
    } catch (err: unknown) {
      Alert.alert(
        'Share Failed',
        extractErrorMessage(err, 'Could not open the share sheet.')
      );
    }
  }, [payment]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <OwnerHeader
        title="Payment Summary"
        subtitle={payment?.payment_date || 'Loading...'}
        showBack
        rightAction={
          payment ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Share payment receipt"
              style={({ pressed }) => [
                styles.headerShareBtn,
                pressed && styles.btnDisabled,
              ]}
              onPress={handleShareReceipt}>
              <Share2 size={15} color="#0284C7" />
              <Text style={styles.headerShareText}>Share</Text>
            </Pressable>
          ) : undefined
        }
      />
      <ScrollView contentContainerStyle={styles.scrollContent}>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color="#0284C7" />
            <Text style={styles.loadingText}>Fetching payment receipt...</Text>
          </View>
        ) : !payment ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>Receipt record not found.</Text>
          </View>
        ) : (
          <>
            {/* Reversed Banner */}
            {isReversed && (
              <View style={styles.reversedBanner}>
                <AlertTriangle size={20} color="#DC2626" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.reversedTitle}>PAYMENT REVERSED</Text>
                  <Text style={styles.reversedSub}>
                    Reason: {payment.reversal_reason || 'Reversed by owner'}
                  </Text>
                  {payment.reversed_at && (
                    <Text style={styles.reversedDate}>
                      On {new Date(payment.reversed_at).toLocaleString('en-IN')}
                    </Text>
                  )}
                </View>
              </View>
            )}

            {/* Fintech-Modern Digital Payment Receipt Card */}
            <View style={styles.receiptPaper}>
              <View
                style={[
                  styles.receiptHeader,
                  {
                    backgroundColor: '#0F172A',
                    marginHorizontal: -20,
                    marginTop: -20,
                    paddingHorizontal: 20,
                    paddingTop: 22,
                    paddingBottom: 20,
                    borderTopLeftRadius: 16,
                    borderTopRightRadius: 16,
                    marginBottom: 18,
                  },
                ]}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    backgroundColor: isReversed
                      ? 'rgba(239,68,68,0.18)'
                      : 'rgba(16,185,129,0.18)',
                    paddingHorizontal: 12,
                    paddingVertical: 5,
                    borderRadius: 999,
                    marginBottom: 10,
                  }}>
                  {isReversed ? (
                    <AlertTriangle size={14} color="#FCA5A5" />
                  ) : (
                    <CheckCircle2 size={14} color="#34D399" />
                  )}
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: '800',
                      color: isReversed ? '#FCA5A5' : '#34D399',
                      letterSpacing: 0.8,
                    }}>
                    {isReversed ? 'REVERSED' : 'PAYMENT VERIFIED'}
                  </Text>
                </View>
                <Text style={[styles.totalAmount, { color: '#FFFFFF' }]}>
                  ₹{(payment.amount_paise / 100).toLocaleString('en-IN')}
                </Text>
                <Text style={[styles.propertyName, { color: '#CBD5E1' }]}>
                  {payment.property?.name || 'PG Accommodation'}
                </Text>
                {payment.receipt_number ? (
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: '600',
                      color: '#94A3B8',
                      marginTop: 6,
                    }}>
                    Receipt #{payment.receipt_number}
                  </Text>
                ) : null}
              </View>

              <View style={styles.metaRow}>
                <View>
                  <Text style={styles.metaLabel}>Resident</Text>
                  <Text style={styles.metaVal}>
                    {payment.resident?.full_name} (Room {payment.resident?.room_number})
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.metaLabel}>Payment Date</Text>
                  <Text style={styles.metaVal}>{payment.payment_date}</Text>
                </View>
              </View>

              <View style={styles.metaRow}>
                <View>
                  <Text style={styles.metaLabel}>Payment Method</Text>
                  <Text style={styles.metaVal}>{payment.method.toUpperCase()}</Text>
                </View>
              </View>

              <View style={styles.dashedDivider} />

              <Text style={styles.sectionHeader}>Bill Details</Text>
              {payment.allocations && payment.allocations.length > 0 ? (
                payment.allocations.map((alloc, idx) => (
                  <View key={alloc.id || idx} style={styles.chargeItemRow}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Text style={styles.chargeItemDesc}>
                        {alloc.charge?.description || 'Monthly Bill'}
                        {alloc.status === 'reversed' ? ' (Reversed)' : ''}
                      </Text>
                    </View>
                    <Text style={styles.chargeItemAmount}>
                      ₹{(alloc.settled_amount_paise / 100).toLocaleString('en-IN')}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={styles.emptyNote}>
                  Payment recorded for your account.
                </Text>
              )}

              {payment.notes && (
                <View style={styles.notesBox}>
                  <Text style={styles.notesLabel}>Reference / Note:</Text>
                  <Text style={styles.notesContent}>{payment.notes}</Text>
                </View>
              )}
            </View>

            {/* 1-Tap Share Receipt Action */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Share payment receipt"
              style={({ pressed }) => [
                styles.shareReceiptBtn,
                pressed && styles.shareReceiptBtnPressed,
              ]}
              onPress={handleShareReceipt}>
              <Share2 size={16} color="#FFFFFF" />
              <Text style={styles.shareReceiptBtnText}>Share Receipt</Text>
            </Pressable>

            {/* Owner Reversal Button */}
            {isOwner && !isReversed && (
              <View style={styles.reversalWrap}>
                <Pressable
                  disabled={reversing}
                  style={({ pressed }) => [
                    styles.reverseBtn,
                    reversing && styles.btnDisabled,
                    pressed && styles.reverseBtnPressed,
                  ]}
                  onPress={handleOpenReverseModal}>
                  {reversing ? (
                    <ActivityIndicator color="#DC2626" size="small" />
                  ) : (
                    <Text style={styles.reverseBtnText}>Reverse This Payment</Text>
                  )}
                </Pressable>
                <Text style={styles.reversalHint}>
                  Reversing will re-open all settled charges as outstanding and preserve this receipt marked as reversed.
                </Text>
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Cross-Platform Payment Reversal Modal */}
      <Modal
        visible={showReverseModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!reversing) setShowReverseModal(false);
        }}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Reverse Payment Receipt</Text>
            <Text style={styles.modalSubtitle}>
              Receipt {payment?.receipt_number} • ₹
              {((payment?.amount_paise || 0) / 100).toLocaleString('en-IN')}
            </Text>

            <View style={styles.warningBox}>
              <AlertTriangle size={18} color="#D97706" />
              <Text style={styles.warningText}>
                Reversing will immediately reopen all settled charges as outstanding and cancel any advance credit from this payment.
              </Text>
            </View>

            <Text style={styles.inputLabel}>Preset Reasons</Text>
            <View style={styles.presetChipsRow}>
              {[
                'Cheque / UPI bounced or recalled',
                'Entered duplicate payment in error',
                'Incorrect resident or room credited',
                'Resident requested payment refund',
              ].map((chip) => (
                <Pressable
                  key={chip}
                  style={[
                    styles.presetChip,
                    reversalReason === chip && styles.presetChipActive,
                  ]}
                  onPress={() => setReversalReason(chip)}>
                  <Text
                    style={[
                      styles.presetChipText,
                      reversalReason === chip && styles.presetChipTextActive,
                    ]}>
                    {chip}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.inputLabel}>Reversal Reason *</Text>
            <TextInput
              style={[styles.input, { height: 75, textAlignVertical: 'top' }]}
              multiline
              placeholder="Provide reason for reversing this payment..."
              placeholderTextColor="#94A3B8"
              value={reversalReason}
              onChangeText={setReversalReason}
            />

            <View style={styles.modalBtnRow}>
              <Pressable
                disabled={reversing}
                style={styles.modalCancelBtn}
                onPress={() => setShowReverseModal(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                disabled={reversing || !reversalReason.trim()}
                style={[
                  styles.modalDangerBtn,
                  (reversing || !reversalReason.trim()) && styles.btnDisabled,
                ]}
                onPress={handleConfirmReversal}>
                {reversing ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.modalDangerText}>Confirm Reversal</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 40,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  backButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginRight: 12,
  },
  backButtonPressed: {
    backgroundColor: '#F1F5F9',
  },
  backButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  headerTitleWrap: {
    flex: 1,
  },
  screenTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  screenSubtitle: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  loadingBox: {
    padding: 30,
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    fontSize: 13,
    color: '#64748B',
  },
  errorBox: {
    backgroundColor: '#FEF2F2',
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
  },
  errorText: {
    fontSize: 14,
    color: '#DC2626',
    fontWeight: '600',
  },
  reversedBanner: {
    flexDirection: 'row',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    gap: 10,
  },
  reversedIcon: {
    fontSize: 20,
  },
  reversedTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#DC2626',
  },
  reversedSub: {
    fontSize: 12,
    color: '#7F1D1D',
    marginTop: 2,
  },
  reversedDate: {
    fontSize: 11,
    color: '#991B1B',
    marginTop: 2,
  },
  receiptPaper: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  receiptHeader: {
    alignItems: 'center',
    marginBottom: 16,
  },
  receiptBrandBadge: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#0284C7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  receiptBrandText: {
    fontSize: 18,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  propertyName: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  propertyAddress: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    width: '100%',
    marginTop: 14,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  metaLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  metaVal: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 2,
  },
  metaValHighlight: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0284C7',
    marginTop: 2,
  },
  dashedDivider: {
    height: 1,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderStyle: 'dashed',
    marginVertical: 14,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  chargeItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  chargeItemDesc: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1E293B',
  },
  chargeItemMeta: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  chargeItemAmount: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  emptyNote: {
    fontSize: 12,
    color: '#94A3B8',
    fontStyle: 'italic',
    paddingVertical: 6,
  },
  unallocRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginTop: 8,
    alignItems: 'center',
  },
  unallocRowCredit: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  unallocRowZero: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  unallocLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  unallocLabelCredit: {
    color: '#B45309',
  },
  unallocLabelZero: {
    color: '#64748B',
  },
  unallocVal: {
    fontSize: 13,
    fontWeight: '700',
  },
  unallocValCredit: {
    color: '#B45309',
  },
  unallocValZero: {
    color: '#16A34A',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  totalAmount: {
    fontSize: 22,
    fontWeight: '900',
    color: '#16A34A',
  },
  notesBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 10,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  notesLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  notesContent: {
    fontSize: 13,
    color: '#334155',
    marginTop: 2,
  },
  footerStamp: {
    alignItems: 'center',
    marginTop: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  footerStampText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: '#94A3B8',
  },
  reversalWrap: {
    marginTop: 14,
    alignItems: 'center',
  },
  headerShareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#E0F2FE',
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  headerShareText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0284C7',
  },
  shareReceiptBtn: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#0284C7',
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 20,
  },
  shareReceiptBtnPressed: {
    opacity: 0.86,
  },
  shareReceiptBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  reverseBtn: {
    borderWidth: 1,
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
    width: '100%',
  },
  reverseBtnPressed: {
    backgroundColor: '#FEE2E2',
  },
  reverseBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#DC2626',
  },
  reversalHint: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 6,
    paddingHorizontal: 12,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 14,
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FECACA',
    marginBottom: 14,
    gap: 10,
  },
  warningIcon: {
    fontSize: 18,
  },
  warningText: {
    flex: 1,
    fontSize: 12,
    color: '#991B1B',
    lineHeight: 16,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0F172A',
    marginBottom: 16,
  },
  presetChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  presetChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  presetChipActive: {
    backgroundColor: '#FEE2E2',
    borderColor: '#EF4444',
  },
  presetChipText: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '600',
  },
  presetChipTextActive: {
    color: '#DC2626',
    fontWeight: '700',
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    alignItems: 'center',
  },
  modalCancelText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#475569',
  },
  modalDangerBtn: {
    flex: 1,
    paddingVertical: 12,
    backgroundColor: '#DC2626',
    borderRadius: 8,
    alignItems: 'center',
  },
  modalDangerText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});

