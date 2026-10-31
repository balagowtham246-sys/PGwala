import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { useAuth } from '@/context/auth-context';
import { supabase } from '@/lib/supabase';

interface StudentResident {
  id: string;
  property_id: string;
  full_name: string;
  room_number: string;
  property?: {
    name: string;
  };
}

interface ChargeItem {
  id: string;
  category: 'rent' | 'electricity' | 'washing_machine' | 'opening_balance';
  description: string;
  billing_period_start: string;
  billing_period_end: string;
  due_date: string;
  amount_paise: number;
  status: 'outstanding' | 'settled' | 'cancelled';
}

interface PaymentItem {
  id: string;
  receipt_number: string;
  amount_paise: number;
  unallocated_amount_paise: number;
  method: 'cash' | 'upi';
  payment_date: string;
  status: 'approved' | 'reversed';
  notes: string | null;
}

interface StudentReportItem {
  id: string;
  amount_paise: number;
  claimed_method: 'cash' | 'upi';
  payment_date: string;
  reference_number: string | null;
  notes: string | null;
  status: 'pending' | 'approved' | 'rejected';
  rejection_reason: string | null;
  created_at: string;
}

export default function StudentBillingScreen() {
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [resident, setResident] = useState<StudentResident | null>(null);

  // Balances
  const [outstandingPaise, setOutstandingPaise] = useState(0);
  const [overduePaise, setOverduePaise] = useState(0);
  const [unallocatedPaise, setUnallocatedPaise] = useState(0);

  // Lists
  const [charges, setCharges] = useState<ChargeItem[]>([]);
  const [payments, setPayments] = useState<PaymentItem[]>([]);
  const [reports, setReports] = useState<StudentReportItem[]>([]);

  // Payment reporting modal
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportAmountRupees, setReportAmountRupees] = useState('');
  const [reportMethod, setReportMethod] = useState<'upi' | 'cash'>('upi');
  const [reportReference, setReportReference] = useState('');
  const [reportNotes, setReportNotes] = useState('');
  const [submittingReport, setSubmittingReport] = useState(false);

  // Active Tab: 'dues' | 'reports' | 'receipts'
  const [activeTab, setActiveTab] = useState<'dues' | 'reports' | 'receipts'>('dues');

  const loadData = useCallback(async () => {
    if (!user?.id) return;
    try {
      setLoading(true);

      // 1. Fetch authenticated student's resident record
      const { data: resData, error: resError } = await supabase
        .from('residents')
        .select(`
          id,
          property_id,
          full_name,
          room_number,
          property:properties (
            name
          )
        `)
        .eq('profile_id', user.id)
        .eq('is_active', true)
        .maybeSingle();

      if (resError) throw resError;
      if (!resData) {
        setResident(null);
        setLoading(false);
        return;
      }

      const resObj: StudentResident = {
        id: resData.id,
        property_id: resData.property_id,
        full_name: resData.full_name,
        room_number: resData.room_number,
        property: Array.isArray(resData.property) ? resData.property[0] : resData.property,
      };
      setResident(resObj);

      // 2. Fetch charges for this resident
      const todayIso = new Date().toISOString().split('T')[0];
      const { data: chData, error: chError } = await supabase
        .from('charges')
        .select('*')
        .eq('resident_id', resObj.id)
        .order('due_date', { ascending: false });

      if (chError) throw chError;
      const loadedCharges: ChargeItem[] = chData || [];
      setCharges(loadedCharges);

      let totalOut = 0;
      let totalOver = 0;
      for (const ch of loadedCharges) {
        if (ch.status === 'outstanding') {
          totalOut += ch.amount_paise;
          if (ch.due_date < todayIso) {
            totalOver += ch.amount_paise;
          }
        }
      }
      setOutstandingPaise(totalOut);
      setOverduePaise(totalOver);

      // 3. Fetch approved payments
      const { data: payData, error: payError } = await supabase
        .from('payments')
        .select('*')
        .eq('resident_id', resObj.id)
        .order('payment_date', { ascending: false });

      if (payError) throw payError;
      const loadedPayments: PaymentItem[] = payData || [];
      setPayments(loadedPayments);

      const activeCredit = loadedPayments
        .filter((p) => p.status === 'approved')
        .reduce((acc, p) => acc + (p.unallocated_amount_paise || 0), 0);
      setUnallocatedPaise(activeCredit);

      // 4. Fetch student payment reports
      const { data: repData, error: repError } = await supabase
        .from('student_payment_reports')
        .select('*')
        .eq('resident_id', resObj.id)
        .order('created_at', { ascending: false });

      if (repError) throw repError;
      setReports(repData || []);
    } catch (err: any) {
      console.error('[StudentBilling] Load error:', err);
      Alert.alert('Load Failed', err.message || 'Could not load billing details.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Submit payment report
  const handleSubmitReport = async () => {
    if (!resident) return;

    const amountRupees = parseFloat(reportAmountRupees);
    if (isNaN(amountRupees) || amountRupees <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid payment amount.');
      return;
    }

    setSubmittingReport(true);
    try {
      const todayIso = new Date().toISOString().split('T')[0];
      const amountPaise = Math.round(amountRupees * 100);

      const { data, error } = await supabase
        .from('student_payment_reports')
        .insert({
          property_id: resident.property_id,
          resident_id: resident.id,
          amount_paise: amountPaise,
          claimed_method: reportMethod,
          payment_date: todayIso,
          reference_number: reportReference.trim() || null,
          notes: reportNotes.trim() || null,
          status: 'pending',
        })
        .select()
        .single();

      if (error) throw error;

      Alert.alert(
        'Payment Reported',
        'Your payment report has been submitted to your PG owner. Your balance will be updated once verified and approved.'
      );

      setShowReportModal(false);
      setReportAmountRupees('');
      setReportReference('');
      setReportNotes('');
      setActiveTab('reports');
      loadData();
    } catch (err: any) {
      Alert.alert('Submission Failed', err.message || 'Could not submit payment report.');
    } finally {
      setSubmittingReport(false);
    }
  };

  const hasOutstanding = outstandingPaise > 0;
  const isOverdue = overduePaise > 0;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              loadData();
            }}
            colors={['#0284C7']}
          />
        }>
        {/* Header */}
        <View style={styles.topBar}>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
            onPress={() => router.back()}>
            <Text style={styles.backButtonText}>‹ Back</Text>
          </Pressable>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.screenTitle}>My Bills & Rent</Text>
            <Text style={styles.screenSubtitle}>
              {resident?.property?.name || 'PG Accommodation'} • Room {resident?.room_number}
            </Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color="#0284C7" />
            <Text style={styles.loadingText}>Loading your dues & invoices...</Text>
          </View>
        ) : !resident ? (
          <View style={styles.unlinkedCard}>
            <Text style={styles.unlinkedTitle}>Room Not Linked</Text>
            <Text style={styles.unlinkedSub}>
              Your account has not yet been allocated to an active room by your PG owner. Please contact your owner to link your account.
            </Text>
          </View>
        ) : (
          <>
            {/* Total Balance Card */}
            <View style={[styles.balanceCard, isOverdue ? styles.balanceCardOverdue : styles.balanceCardNormal]}>
              <View>
                <Text style={styles.balanceLabel}>Current Outstanding Dues</Text>
                <Text style={[styles.balanceAmount, isOverdue && styles.balanceAmountOverdue]}>
                  ₹{(outstandingPaise / 100).toLocaleString('en-IN')}
                </Text>
                {isOverdue && (
                  <View style={styles.overdueBadge}>
                    <Text style={styles.overdueBadgeText}>
                      Overdue: ₹{(overduePaise / 100).toLocaleString('en-IN')}
                    </Text>
                  </View>
                )}
              </View>

              <Pressable
                style={styles.reportPayBtn}
                onPress={() => {
                  setReportAmountRupees(
                    outstandingPaise > 0 ? String(outstandingPaise / 100) : ''
                  );
                  setShowReportModal(true);
                }}>
                <Text style={styles.reportPayBtnText}>Report Payment</Text>
              </Pressable>
            </View>

            {/* Advance Credit Notice */}
            {unallocatedPaise > 0 && (
              <View style={styles.creditBanner}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.creditBannerTitle}>Advance Credit Available</Text>
                  <Text style={styles.creditBannerSub}>
                    You have ₹{(unallocatedPaise / 100).toLocaleString('en-IN')} advance credit recorded from previous payments. Your PG owner can apply this towards future dues.
                  </Text>
                </View>
                <Text style={styles.creditBannerAmount}>
                  ₹{(unallocatedPaise / 100).toLocaleString('en-IN')}
                </Text>
              </View>
            )}

            {/* Navigation Tabs */}
            <View style={styles.tabsRow}>
              <Pressable
                style={[styles.tabBtn, activeTab === 'dues' && styles.tabBtnActive]}
                onPress={() => setActiveTab('dues')}>
                <Text style={[styles.tabBtnText, activeTab === 'dues' && styles.tabBtnTextActive]}>
                  Dues Breakdown
                </Text>
              </Pressable>
              <Pressable
                style={[styles.tabBtn, activeTab === 'reports' && styles.tabBtnActive]}
                onPress={() => setActiveTab('reports')}>
                <Text style={[styles.tabBtnText, activeTab === 'reports' && styles.tabBtnTextActive]}>
                  My Reports ({reports.length})
                </Text>
              </Pressable>
              <Pressable
                style={[styles.tabBtn, activeTab === 'receipts' && styles.tabBtnActive]}
                onPress={() => setActiveTab('receipts')}>
                <Text style={[styles.tabBtnText, activeTab === 'receipts' && styles.tabBtnTextActive]}>
                  Receipts ({payments.length})
                </Text>
              </Pressable>
            </View>

            {/* TAB 1: Dues Breakdown */}
            {activeTab === 'dues' && (
              <View style={styles.tabContent}>
                {charges.length === 0 ? (
                  <View style={styles.emptyCard}>
                    <Text style={styles.emptyTitle}>No Dues Recorded</Text>
                    <Text style={styles.emptySub}>You have no pending or past charges.</Text>
                  </View>
                ) : (
                  charges.map((ch) => {
                    const isSettled = ch.status === 'settled';
                    const isOver = ch.status === 'outstanding' && ch.due_date < new Date().toISOString().split('T')[0];

                    return (
                      <View key={ch.id} style={styles.chargeCard}>
                        <View style={{ flex: 1 }}>
                          <View style={styles.categoryPill}>
                            <Text style={styles.categoryPillText}>{ch.category.toUpperCase()}</Text>
                          </View>
                          <Text style={styles.chargeTitle}>{ch.description}</Text>
                          <Text style={styles.chargePeriod}>
                            Period: {ch.billing_period_start} to {ch.billing_period_end}
                          </Text>
                          <Text style={styles.chargeDue}>Due by: {ch.due_date}</Text>
                        </View>

                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={styles.chargeAmount}>
                            ₹{(ch.amount_paise / 100).toLocaleString('en-IN')}
                          </Text>
                          <View
                            style={[
                              styles.statusTag,
                              isSettled ? styles.statusTagSettled : isOver ? styles.statusTagOverdue : styles.statusTagDue,
                            ]}>
                            <Text
                              style={[
                                styles.statusTagText,
                                isSettled ? styles.statusTagTextSettled : isOver ? styles.statusTagTextOverdue : styles.statusTagTextDue,
                              ]}>
                              {isSettled ? 'PAID' : isOver ? 'OVERDUE' : 'DUE'}
                            </Text>
                          </View>
                        </View>
                      </View>
                    );
                  })
                )}
              </View>
            )}

            {/* TAB 2: Payment Reports */}
            {activeTab === 'reports' && (
              <View style={styles.tabContent}>
                {reports.length === 0 ? (
                  <View style={styles.emptyCard}>
                    <Text style={styles.emptyTitle}>No Payment Reports</Text>
                    <Text style={styles.emptySub}>
                      When you pay via UPI or Cash, tap 'Report Payment' above to notify your PG owner.
                    </Text>
                  </View>
                ) : (
                  reports.map((rep) => (
                    <View key={rep.id} style={styles.reportItemCard}>
                      <View style={styles.reportItemHeader}>
                        <View>
                          <Text style={styles.reportItemAmount}>
                            ₹{(rep.amount_paise / 100).toLocaleString('en-IN')}
                          </Text>
                          <Text style={styles.reportItemMeta}>
                            Method: {rep.claimed_method.toUpperCase()} • Paid on {rep.payment_date}
                          </Text>
                        </View>

                        <View
                          style={[
                            styles.reportStatusBadge,
                            rep.status === 'approved'
                              ? styles.badgeApproved
                              : rep.status === 'rejected'
                              ? styles.badgeRejected
                              : styles.badgePending,
                          ]}>
                          <Text
                            style={[
                              styles.reportStatusBadgeText,
                              rep.status === 'approved'
                                ? styles.textApproved
                                : rep.status === 'rejected'
                                ? styles.textRejected
                                : styles.textPending,
                            ]}>
                            {rep.status.toUpperCase()}
                          </Text>
                        </View>
                      </View>

                      {rep.reference_number && (
                        <Text style={styles.reportItemRef}>Ref: {rep.reference_number}</Text>
                      )}
                      {rep.notes && <Text style={styles.reportItemNotes}>Note: {rep.notes}</Text>}
                      {rep.rejection_reason && (
                        <View style={styles.rejectionBox}>
                          <Text style={styles.rejectionTitle}>Owner Note / Rejection Reason:</Text>
                          <Text style={styles.rejectionText}>{rep.rejection_reason}</Text>
                        </View>
                      )}
                    </View>
                  ))
                )}
              </View>
            )}

            {/* TAB 3: Receipts */}
            {activeTab === 'receipts' && (
              <View style={styles.tabContent}>
                {payments.length === 0 ? (
                  <View style={styles.emptyCard}>
                    <Text style={styles.emptyTitle}>No Receipts Yet</Text>
                    <Text style={styles.emptySub}>
                      Official receipts will be available here once the PG owner approves your payments.
                    </Text>
                  </View>
                ) : (
                  payments.map((p) => (
                    <Pressable
                      key={p.id}
                      style={styles.receiptItemCard}
                      onPress={() =>
                        router.push({
                          pathname: '/receipt-detail',
                          params: { id: p.id },
                        })
                      }>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.receiptItemNo}>{p.receipt_number}</Text>
                        <Text style={styles.receiptItemMeta}>
                          {p.payment_date} • {p.method.toUpperCase()}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.receiptItemAmount}>
                          ₹{(p.amount_paise / 100).toLocaleString('en-IN')}
                        </Text>
                        <Text style={styles.receiptViewLink}>View Receipt ›</Text>
                      </View>
                    </Pressable>
                  ))
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* MODAL: Report Payment */}
      <Modal
        visible={showReportModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowReportModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Report Payment</Text>
            <Text style={styles.modalSub}>
              Let your PG owner know you've made a payment. Once verified, official receipts will be issued.
            </Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Amount Paid (₹)</Text>
              <TextInput
                style={styles.modalInput}
                keyboardType="numeric"
                value={reportAmountRupees}
                onChangeText={setReportAmountRupees}
                placeholder="e.g. 9000"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Payment Method</Text>
              <View style={styles.methodToggleRow}>
                <Pressable
                  style={[styles.methodBtn, reportMethod === 'upi' && styles.methodBtnActive]}
                  onPress={() => setReportMethod('upi')}>
                  <Text style={[styles.methodBtnText, reportMethod === 'upi' && styles.methodBtnTextActive]}>
                    UPI / GPay / PhonePe
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.methodBtn, reportMethod === 'cash' && styles.methodBtnActive]}
                  onPress={() => setReportMethod('cash')}>
                  <Text style={[styles.methodBtnText, reportMethod === 'cash' && styles.methodBtnTextActive]}>
                    Cash
                  </Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>UPI UTR / Reference ID (Optional)</Text>
              <TextInput
                style={styles.modalInput}
                value={reportReference}
                onChangeText={setReportReference}
                placeholder="e.g. 429381749281"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Additional Notes (Optional)</Text>
              <TextInput
                style={styles.modalInput}
                value={reportNotes}
                onChangeText={setReportNotes}
                placeholder="e.g. Paid rent + EB for October"
              />
            </View>

            <View style={styles.modalBtnRow}>
              <Pressable
                style={styles.modalCancelBtn}
                onPress={() => setShowReportModal(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                disabled={submittingReport}
                style={[styles.modalConfirmBtn, submittingReport && styles.btnDisabled]}
                onPress={handleSubmitReport}>
                {submittingReport ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.modalConfirmText}>Submit Report</Text>
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
  unlinkedCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: '#FED7AA',
    alignItems: 'center',
  },
  unlinkedTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#C2410C',
  },
  unlinkedSub: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 6,
  },
  balanceCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  balanceCardNormal: {
    borderLeftWidth: 4,
    borderLeftColor: '#0284C7',
  },
  balanceCardOverdue: {
    borderLeftWidth: 4,
    borderLeftColor: '#DC2626',
    backgroundColor: '#FEF2F2',
  },
  balanceLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
    textTransform: 'uppercase',
  },
  balanceAmount: {
    fontSize: 26,
    fontWeight: '900',
    color: '#0F172A',
    marginTop: 2,
  },
  balanceAmountOverdue: {
    color: '#DC2626',
  },
  overdueBadge: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 4,
    alignSelf: 'flex-start',
  },
  overdueBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#DC2626',
  },
  reportPayBtn: {
    backgroundColor: '#0284C7',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  reportPayBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  tabsRow: {
    flexDirection: 'row',
    backgroundColor: '#E2E8F0',
    borderRadius: 10,
    padding: 3,
    marginBottom: 16,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  tabBtnActive: {
    backgroundColor: '#FFFFFF',
  },
  tabBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  tabBtnTextActive: {
    color: '#0F172A',
    fontWeight: '700',
  },
  tabContent: {
    marginBottom: 20,
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#475569',
  },
  emptySub: {
    fontSize: 12,
    color: '#94A3B8',
    textAlign: 'center',
    marginTop: 4,
  },
  chargeCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 10,
  },
  categoryPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginBottom: 4,
  },
  categoryPillText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#475569',
  },
  chargeTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  chargePeriod: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  chargeDue: {
    fontSize: 11,
    color: '#0284C7',
    fontWeight: '600',
    marginTop: 2,
  },
  chargeAmount: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  statusTag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 6,
  },
  statusTagSettled: {
    backgroundColor: '#DCFCE7',
  },
  statusTagOverdue: {
    backgroundColor: '#FEE2E2',
  },
  statusTagDue: {
    backgroundColor: '#E0F2FE',
  },
  statusTagText: {
    fontSize: 10,
    fontWeight: '800',
  },
  statusTagTextSettled: {
    color: '#15803D',
  },
  statusTagTextOverdue: {
    color: '#DC2626',
  },
  statusTagTextDue: {
    color: '#0369A1',
  },
  reportItemCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 10,
  },
  reportItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  reportItemAmount: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  reportItemMeta: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  reportStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeApproved: {
    backgroundColor: '#DCFCE7',
  },
  badgeRejected: {
    backgroundColor: '#FEE2E2',
  },
  badgePending: {
    backgroundColor: '#FEF3C7',
  },
  reportStatusBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  textApproved: {
    color: '#15803D',
  },
  textRejected: {
    color: '#DC2626',
  },
  textPending: {
    color: '#B45309',
  },
  reportItemRef: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
    marginTop: 6,
  },
  reportItemNotes: {
    fontSize: 12,
    color: '#64748B',
    fontStyle: 'italic',
    marginTop: 2,
  },
  rejectionBox: {
    backgroundColor: '#FEF2F2',
    padding: 8,
    borderRadius: 6,
    marginTop: 8,
  },
  rejectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#DC2626',
  },
  rejectionText: {
    fontSize: 12,
    color: '#991B1B',
    marginTop: 2,
  },
  receiptItemCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 8,
  },
  receiptItemNo: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0284C7',
  },
  receiptItemMeta: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  receiptItemAmount: {
    fontSize: 15,
    fontWeight: '800',
    color: '#16A34A',
  },
  receiptViewLink: {
    fontSize: 11,
    color: '#0284C7',
    fontWeight: '600',
    marginTop: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalSub: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 18,
    marginTop: 6,
    marginBottom: 16,
  },
  inputGroup: {
    marginBottom: 14,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
  },
  modalInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0F172A',
  },
  methodToggleRow: {
    flexDirection: 'row',
    gap: 8,
  },
  methodBtn: {
    flex: 1,
    paddingVertical: 8,
    backgroundColor: '#F1F5F9',
    borderRadius: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  methodBtnActive: {
    backgroundColor: '#E0F2FE',
    borderColor: '#0284C7',
  },
  methodBtnText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  methodBtnTextActive: {
    color: '#0284C7',
    fontWeight: '700',
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
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
  modalConfirmBtn: {
    flex: 1,
    paddingVertical: 12,
    backgroundColor: '#0284C7',
    borderRadius: 8,
    alignItems: 'center',
  },
  modalConfirmText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  btnDisabled: {
    opacity: 0.6,
  },
  creditBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FCD34D',
    marginBottom: 16,
    gap: 12,
  },
  creditBannerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400E',
  },
  creditBannerSub: {
    fontSize: 11,
    color: '#78350F',
    marginTop: 2,
    lineHeight: 16,
  },
  creditBannerAmount: {
    fontSize: 18,
    fontWeight: '800',
    color: '#B45309',
  },
});

