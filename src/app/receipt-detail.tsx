import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';

import { useAuth } from '@/context/auth-context';
import { supabase } from '@/lib/supabase';

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
  const { user, profile } = useAuth();
  const { id } = useLocalSearchParams<{ id?: string }>();

  const [loading, setLoading] = useState(true);
  const [payment, setPayment] = useState<PaymentDetail | null>(null);
  const [reversing, setReversing] = useState(false);

  const loadReceipt = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);

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
      setPayment((data as any) || null);
    } catch (err: any) {
      console.error('[ReceiptDetail] Error loading receipt:', err);
      Alert.alert('Load Failed', err.message || 'Could not load receipt details.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadReceipt();
  }, [loadReceipt]);

  const handleReversePayment = () => {
    if (!payment) return;

    const executeReversal = async (reason: string) => {
      setReversing(true);
      try {
        const { data, error } = await supabase.rpc('reverse_payment', {
          p_payment_id: payment.id,
          p_reversal_reason: reason,
        });

        if (error) throw error;
        if (!data?.success) {
          Alert.alert('Reversal Failed', data?.error || 'Could not reverse payment.');
          return;
        }

        Alert.alert('Payment Reversed', data.message || 'Receipt marked as reversed.');
        loadReceipt();
      } catch (err: any) {
        Alert.alert('Error', err.message || 'Failed to reverse payment.');
      } finally {
        setReversing(false);
      }
    };

    Alert.prompt
      ? Alert.prompt(
          'Reverse Payment',
          'Enter the reason for reversing this payment. All settled charges will be reopened as outstanding.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Reverse Payment',
              style: 'destructive',
              onPress: (reason?: string) => {
                if (!reason || !reason.trim()) {
                  Alert.alert('Reason Required', 'Please provide a valid reversal reason.');
                  return;
                }
                executeReversal(reason.trim());
              },
            },
          ]
        )
      : Alert.alert(
          'Reverse Payment?',
          'Are you sure you want to reverse this payment? All settled charges will be reopened as outstanding.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Confirm Reversal',
              style: 'destructive',
              onPress: () => executeReversal('Manual correction by PG owner'),
            },
          ]
        );
  };

  const isOwner = profile?.role === 'owner';
  const isReversed = payment?.status === 'reversed';

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Top Bar */}
        <View style={styles.topBar}>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
            onPress={() => router.back()}>
            <Text style={styles.backButtonText}>‹ Back</Text>
          </Pressable>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.screenTitle}>Official Receipt</Text>
            <Text style={styles.screenSubtitle}>{payment?.receipt_number || 'Loading...'}</Text>
          </View>
        </View>

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
                <Text style={styles.reversedIcon}>⚠️</Text>
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

            {/* Receipt Paper Card */}
            <View style={styles.receiptPaper}>
              {/* Receipt Header */}
              <View style={styles.receiptHeader}>
                <View style={styles.receiptBrandBadge}>
                  <Text style={styles.receiptBrandText}>PG</Text>
                </View>
                <Text style={styles.propertyName}>{payment.property?.name || 'PG Accommodation'}</Text>
                {payment.property?.address && (
                  <Text style={styles.propertyAddress}>{payment.property.address}</Text>
                )}
                <View style={styles.divider} />
              </View>

              {/* Receipt Number & Status */}
              <View style={styles.metaRow}>
                <View>
                  <Text style={styles.metaLabel}>Receipt Number</Text>
                  <Text style={styles.metaValHighlight}>{payment.receipt_number}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.metaLabel}>Payment Date</Text>
                  <Text style={styles.metaVal}>{payment.payment_date}</Text>
                </View>
              </View>

              <View style={styles.metaRow}>
                <View>
                  <Text style={styles.metaLabel}>Resident</Text>
                  <Text style={styles.metaVal}>
                    {payment.resident?.full_name} (Room {payment.resident?.room_number})
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.metaLabel}>Payment Method</Text>
                  <Text style={styles.metaVal}>{payment.method.toUpperCase()}</Text>
                </View>
              </View>

              <View style={styles.dashedDivider} />

              {/* Settled Charges Breakdown */}
              <Text style={styles.sectionHeader}>Settled Charges</Text>
              {payment.allocations && payment.allocations.length > 0 ? (
                payment.allocations.map((alloc, idx) => (
                  <View key={alloc.id || idx} style={styles.chargeItemRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.chargeItemDesc}>
                        {alloc.charge?.description || 'Charge'}
                        {alloc.status === 'reversed' ? ' (Reversed)' : ''}
                      </Text>
                      <Text style={styles.chargeItemMeta}>
                        Category: {alloc.charge?.category?.toUpperCase()}
                      </Text>
                    </View>
                    <Text style={styles.chargeItemAmount}>
                      ₹{(alloc.settled_amount_paise / 100).toLocaleString('en-IN')}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={styles.emptyNote}>No complete charges were settled by this payment.</Text>
              )}

              {/* Unallocated Amount Row */}
              {payment.unallocated_amount_paise > 0 && (
                <View style={styles.unallocRow}>
                  <Text style={styles.unallocLabel}>Unallocated Credit</Text>
                  <Text style={styles.unallocVal}>
                    ₹{(payment.unallocated_amount_paise / 100).toLocaleString('en-IN')}
                  </Text>
                </View>
              )}

              <View style={styles.dashedDivider} />

              {/* Total Paid Row */}
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Total Received</Text>
                <Text style={styles.totalAmount}>
                  ₹{(payment.amount_paise / 100).toLocaleString('en-IN')}
                </Text>
              </View>

              {payment.notes && (
                <View style={styles.notesBox}>
                  <Text style={styles.notesLabel}>Notes / Reference:</Text>
                  <Text style={styles.notesContent}>{payment.notes}</Text>
                </View>
              )}

              {/* Footer Stamp */}
              <View style={styles.footerStamp}>
                <Text style={styles.footerStampText}>
                  {isReversed ? 'CANCELLED / REVERSED' : 'VERIFIED & APPROVED'}
                </Text>
              </View>
            </View>

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
                  onPress={handleReversePayment}>
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
    paddingVertical: 6,
    backgroundColor: '#FFFBEB',
    paddingHorizontal: 8,
    borderRadius: 6,
    marginTop: 6,
  },
  unallocLabel: {
    fontSize: 13,
    color: '#B45309',
    fontWeight: '600',
  },
  unallocVal: {
    fontSize: 13,
    color: '#B45309',
    fontWeight: '700',
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
    marginTop: 20,
    alignItems: 'center',
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
});

