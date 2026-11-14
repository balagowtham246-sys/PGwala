import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
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
import { Camera, Check, X } from 'lucide-react-native';
import { RoleBottomNav } from '@/components/ui/bottom-nav';
import { formatPaiseToRupees } from '@/lib/billing-utils';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';

import { useAuth } from '@/context/auth-context';
import { supabase, decodeBase64ToBytes, getSignedPaymentProofUrl } from '@/lib/supabase';

interface StudentBillCardItem {
  charge_id: string;
  category: 'rent' | 'electricity';
  title: string;
  month_label: string;
  billing_month: string;
  due_date: string;
  rent_paise?: number;
  wm_paise?: number;
  total_paise: number;
  status: 'paid' | 'unpaid';
  receipt_number?: string | null;
  paid_date?: string | null;
  paid_method?: string | null;
  payment_id?: string | null;
  pending_report?: {
    id: string;
    claimed_method: 'cash' | 'upi';
    amount_paise: number;
    reference_number: string | null;
    screenshot_url: string | null;
    notes: string | null;
    created_at: string;
    status: 'pending' | 'rejected' | 'approved';
    rejection_reason?: string | null;
  } | null;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    }
  } catch {}
  return iso;
}

export default function SimplifiedStudentBillingScreen() {
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [residentId, setResidentId] = useState<string | null>(null);
  const [residentName, setResidentName] = useState('Resident');
  const [roomNumber, setRoomNumber] = useState('');
  const [propertyName, setPropertyName] = useState('My PG');

  // Current Month Bills
  const [currentRentBill, setCurrentRentBill] = useState<StudentBillCardItem | null>(null);
  const [currentEbBill, setCurrentEbBill] = useState<StudentBillCardItem | null>(null);

  // Past Bills History
  const [pastBills, setPastBills] = useState<StudentBillCardItem[]>([]);
  const [breakdownExpanded, setBreakdownExpanded] = useState(false);

  // Payment Proof Modal
  const [selectedBillForPayment, setSelectedBillForPayment] = useState<StudentBillCardItem | null>(null);
  const [paymentModalVisible, setPaymentModalVisible] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'upi' | 'cash'>('upi');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [studentNotes, setStudentNotes] = useState('');
  const [selectedScreenshot, setSelectedScreenshot] = useState<{ uri: string; base64?: string | null } | null>(null);
  const [submittingProof, setSubmittingProof] = useState(false);

  // Full Screen Image Preview
  const [fullImageUrl, setFullImageUrl] = useState<string | null>(null);

  // Load student bills
  const loadStudentBills = useCallback(async () => {
    if (!user?.id) return;

    try {
      // 1. Fetch resident record for caller
      const { data: resData, error: resErr } = await supabase
        .from('residents')
        .select(`
          id,
          full_name,
          room_number,
          property:properties (
            name
          )
        `)
        .eq('profile_id', user.id)
        .eq('is_active', true)
        .maybeSingle();

      if (resErr) throw resErr;
      if (!resData) {
        setLoading(false);
        return;
      }

      setResidentId(resData.id);
      setResidentName(resData.full_name);
      setRoomNumber(resData.room_number);
      const propObj: any = Array.isArray(resData.property) ? resData.property[0] : resData.property;
      if (propObj?.name) {
        setPropertyName(propObj.name);
      }

      // 2. Fetch all monthly charges (rent & electricity) for this resident, sorted by month DESC
      const { data: charges, error: chgErr } = await supabase
        .from('charges')
        .select('id, category, amount_paise, rent_amount_paise, wm_amount_paise, status, billing_period_start, due_date')
        .eq('resident_id', resData.id)
        .in('category', ['rent', 'electricity'])
        .order('billing_period_start', { ascending: false });

      if (chgErr) throw chgErr;

      // 3. Fetch all active/recent payment reports for this resident (both pending and rejected)
      const { data: reports } = await supabase
        .from('student_payment_reports')
        .select(
          'id, charge_id, amount_paise, claimed_method, reference_number, screenshot_url, notes, status, rejection_reason, created_at'
        )
        .eq('resident_id', resData.id)
        .in('status', ['pending', 'rejected'])
        .order('created_at', { ascending: false });

      const pendingReportMap = new Map<string, any>();
      if (reports) {
        for (const rep of reports) {
          if (rep.charge_id && !pendingReportMap.has(rep.charge_id)) {
            pendingReportMap.set(rep.charge_id, rep);
          }
        }
      }

      // 4. Fetch receipt info for settled charges
      const settledIds = (charges || []).filter((c) => c.status === 'settled').map((c) => c.id);
      const paymentMap = new Map<string, { id: string; receipt: string; date: string; method: string }>();

      if (settledIds.length > 0) {
        const { data: allocData } = await supabase
          .from('payment_allocations')
          .select(`
            charge_id,
            payment:payments (
              id,
              receipt_number,
              payment_date,
              method
            )
          `)
          .in('charge_id', settledIds)
          .eq('status', 'active');

        if (allocData) {
          for (const a of allocData) {
            const p: any = Array.isArray(a.payment) ? a.payment[0] : a.payment;
            if (p) {
              paymentMap.set(a.charge_id, {
                id: p.id,
                receipt: p.receipt_number,
                date: p.payment_date,
                method: p.method,
              });
            }
          }
        }
      }

      // Assemble all bills
      const allBills: StudentBillCardItem[] = (charges || []).map((c) => {
        const d = new Date(c.billing_period_start);
        const monthLabel = !isNaN(d.getTime())
          ? d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
          : c.billing_period_start;

        const isSettled = c.status === 'settled';
        const pInfo = paymentMap.get(c.id);
        const pRep = pendingReportMap.get(c.id);

        const isRent = c.category === 'rent';

        return {
          charge_id: c.id,
          category: c.category as 'rent' | 'electricity',
          title: isRent ? 'Room Rent Bill' : 'Electricity (EB) Bill',
          month_label: monthLabel,
          billing_month: c.billing_period_start,
          due_date: c.due_date,
          rent_paise: isRent ? (c.rent_amount_paise || c.amount_paise) : undefined,
          wm_paise: isRent ? (c.wm_amount_paise || 0) : undefined,
          total_paise: c.amount_paise,
          status: isSettled ? 'paid' : 'unpaid',
          receipt_number: pInfo?.receipt || null,
          paid_date: pInfo?.date || null,
          paid_method: pInfo?.method || null,
          payment_id: pInfo?.id || null,
          pending_report: pRep || null,
        };
      });

      // Split into current vs past
      // Current Rent is newest rent charge; Current EB is newest EB charge
      const rentCharges = allBills.filter((b) => b.category === 'rent');
      const ebCharges = allBills.filter((b) => b.category === 'electricity');

      const latestRent = rentCharges.length > 0 ? rentCharges[0] : null;
      const latestEb = ebCharges.length > 0 ? ebCharges[0] : null;

      setCurrentRentBill(latestRent);
      setCurrentEbBill(latestEb);

      // Past history: all other charges
      const pastList = allBills.filter(
        (b) => b.charge_id !== latestRent?.charge_id && b.charge_id !== latestEb?.charge_id
      );
      setPastBills(pastList);
    } catch (err: any) {
      console.error('[StudentBilling] Load error:', err);
      Alert.alert('Load Error', err.message || 'Could not load your billing details.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadStudentBills();
  }, [loadStudentBills]);

  const handleRefresh = () => {
    setRefreshing(true);
    loadStudentBills();
  };

  // Launch Image Picker to choose screenshot proof
  const handlePickScreenshot = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          'Permission Needed',
          'Please allow photo gallery access to upload payment screenshot.'
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.7,
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setSelectedScreenshot({
          uri: result.assets[0].uri,
          base64: result.assets[0].base64,
        });
      }
    } catch (err: any) {
      Alert.alert('Notice', 'Photo gallery not available on this device. You can enter the Transaction ID manually.');
    }
  };

  // Open Payment Proof Modal for a specific bill
  const handleOpenPaymentModal = (bill: StudentBillCardItem) => {
    setSelectedBillForPayment(bill);
    setPaymentMethod('upi');
    setReferenceNumber('');
    setStudentNotes('');
    setSelectedScreenshot(null);
    setPaymentModalVisible(true);
  };

  // Securely resolve and view uploaded screenshot with time-limited signed URL
  const handleViewUploadedScreenshot = async (rawUrlOrPath: string) => {
    try {
      const signed = await getSignedPaymentProofUrl(rawUrlOrPath);
      setFullImageUrl(signed || rawUrlOrPath);
    } catch {
      setFullImageUrl(rawUrlOrPath);
    }
  };

  // Submit payment proof
  const handleSubmitPaymentProof = async () => {
    if (!selectedBillForPayment || submittingProof || !residentId) return;

    try {
      setSubmittingProof(true);
      let uploadedScreenshotPath: string | null = null;

      // 1. Upload screenshot to Supabase Storage if an image was picked
      if (selectedScreenshot?.base64) {
        try {
          const fileExt =
            selectedScreenshot.uri.split('.').pop()?.toLowerCase() || 'jpg';
          const fileName = `${residentId}/${Date.now()}_${selectedBillForPayment.charge_id}.${fileExt}`;
          const bytes = decodeBase64ToBytes(selectedScreenshot.base64);

          const { error: uploadErr } = await supabase.storage
            .from('payment-proofs')
            .upload(fileName, bytes, {
              contentType: `image/${fileExt === 'png' ? 'png' : 'jpeg'}`,
              upsert: true,
            });

          if (uploadErr) {
            throw new Error(`Storage upload failed: ${uploadErr.message}`);
          }

          // Store the relative private storage path
          uploadedScreenshotPath = fileName;
        } catch (uploadException: any) {
          throw new Error(
            uploadException?.message ||
              'Failed to upload payment screenshot. Please try again.'
          );
        }
      } else if (selectedScreenshot && !selectedScreenshot.base64) {
        throw new Error(
          'Image data could not be processed. Please select the screenshot again.'
        );
      }

      // 2. Submit payment proof via atomic RPC
      const { data, error } = await supabase.rpc('submit_student_payment_proof', {
        p_charge_id: selectedBillForPayment.charge_id,
        p_claimed_method: paymentMethod,
        p_screenshot_url: uploadedScreenshotPath || undefined,
        p_reference_number: referenceNumber.trim() || undefined,
        p_notes: studentNotes.trim() || undefined,
      });

      if (error) throw error;
      if (!data?.success)
        throw new Error(data?.error || 'Failed to submit payment proof.');

      setPaymentModalVisible(false);
      setSelectedScreenshot(null);
      setReferenceNumber('');
      setStudentNotes('');
      Alert.alert(
        'Payment Sent',
        `Your ${selectedBillForPayment.title} payment report has been sent to the owner for review.`
      );
      await loadStudentBills();
    } catch (err: any) {
      Alert.alert('Submission Error', err.message || 'Could not send payment report.');
    } finally {
      setSubmittingProof(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={['#0284C7']}
          />
        }>

        {/* Top Header */}
        <View style={styles.topBar}>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace('/student-dashboard');
              }
            }}>
            <Text style={styles.backBtnText}>‹ Back</Text>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.screenTitle}>My Monthly Bills</Text>
            <Text style={styles.screenSubtitle}>
              {propertyName} • Room {roomNumber}
            </Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color="#0284C7" />
            <Text style={styles.loadingText}>Loading your bills...</Text>
          </View>
        ) : (
          (() => {
            const unpaidBills = [currentRentBill, currentEbBill].filter(
              (b): b is StudentBillCardItem => Boolean(b && b.status !== 'paid')
            );
            const totalDuePaise = unpaidBills.reduce((s, b) => s + b.total_paise, 0);
            const totalBilledPaise =
              (currentRentBill?.total_paise || 0) + (currentEbBill?.total_paise || 0);
            const hasAnyCurrentBill = Boolean(currentRentBill || currentEbBill);
            const allCurrentPaid = hasAnyCurrentBill && unpaidBills.length === 0;
            const anyPendingReview = unpaidBills.some(
              (b) => b.pending_report?.status === 'pending'
            );
            const anyRejected = unpaidBills.some(
              (b) => b.pending_report?.status === 'rejected'
            );
            const earliestDueDate = unpaidBills[0]?.due_date || null;
            const primaryPaymentId =
              currentRentBill?.payment_id || currentEbBill?.payment_id || null;
            const primaryReceiptNum =
              currentRentBill?.receipt_number || currentEbBill?.receipt_number || null;
            const currentMonthLabel =
              currentRentBill?.month_label || currentEbBill?.month_label || 'This Month';

            return (
              <>
                {/* HERO STATUS FIRST */}
                <View
                  style={[
                    styles.heroStatusCard,
                    totalDuePaise === 0
                      ? styles.heroStatusClear
                      : styles.heroStatusDue,
                  ]}>
                  <Text
                    style={[
                      styles.heroStatusAmount,
                      totalDuePaise === 0
                        ? styles.heroStatusAmountClear
                        : styles.heroStatusAmountDue,
                    ]}>
                    {totalDuePaise === 0
                      ? 'All clear'
                      : `${formatPaiseToRupees(totalDuePaise)} due`}
                  </Text>
                  <Text style={styles.heroStatusSub}>
                    {totalDuePaise === 0
                      ? 'No pending dues for this month'
                      : anyPendingReview
                      ? 'Payment proof submitted • Awaiting owner review'
                      : earliestDueDate
                      ? `Pay before ${formatDate(earliestDueDate)}`
                      : 'Pending payment for this month'}
                  </Text>
                  {unpaidBills.length > 0 && (
                    <Pressable
                      style={({ pressed }) => [
                        styles.heroPayBtn,
                        pressed && styles.pressed,
                      ]}
                      onPress={() => handleOpenPaymentModal(unpaidBills[0])}>
                      <Text style={styles.heroPayBtnText}>
                        Pay via UPI & Upload Proof
                      </Text>
                    </Pressable>
                  )}
                </View>

                {/* MERGED MONTHLY TOTAL CARD */}
                {hasAnyCurrentBill ? (
                  <View style={styles.billCard}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setBreakdownExpanded((prev) => !prev)}
                      style={styles.billCardTop}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.billCardHeaderTitle}>
                          {currentMonthLabel} Total
                        </Text>
                        <Text style={styles.mergedTotalAmount}>
                          {formatPaiseToRupees(totalBilledPaise)}
                        </Text>
                        {!allCurrentPaid && earliestDueDate && (
                          <Text style={styles.dueText}>
                            Pay before:{' '}
                            <Text style={styles.boldText}>
                              {formatDate(earliestDueDate)}
                            </Text>
                          </Text>
                        )}
                      </View>

                      <View style={{ alignItems: 'flex-end', gap: 6 }}>
                        {allCurrentPaid ? (
                          <View style={[styles.statusBadge, styles.badgePaid]}>
                            <Text style={styles.badgePaidText}>PAID</Text>
                          </View>
                        ) : anyPendingReview ? (
                          <View style={[styles.statusBadge, styles.badgeReview]}>
                            <Text style={styles.badgeReviewText}>UNDER REVIEW</Text>
                          </View>
                        ) : anyRejected ? (
                          <View style={[styles.statusBadge, styles.badgeRejected]}>
                            <Text style={styles.badgeRejectedText}>REJECTED</Text>
                          </View>
                        ) : (
                          <View style={[styles.statusBadge, styles.badgeUnpaid]}>
                            <Text style={styles.badgeUnpaidText}>UNPAID</Text>
                          </View>
                        )}
                        <Text style={styles.expandToggleText}>
                          {breakdownExpanded ? 'Hide breakdown ▴' : 'Tap for breakdown ▾'}
                        </Text>
                      </View>
                    </Pressable>

                    {breakdownExpanded && (
                      <View style={styles.breakdownBox}>
                        {currentRentBill && (
                          <>
                            <View style={styles.breakdownRow}>
                              <Text style={styles.breakdownLabel}>Room Rent</Text>
                              <Text style={styles.breakdownVal}>
                                {formatPaiseToRupees(currentRentBill.rent_paise || 0)}
                              </Text>
                            </View>
                            {(currentRentBill.wm_paise || 0) > 0 && (
                              <View style={styles.breakdownRow}>
                                <Text style={styles.breakdownLabel}>
                                  Washing Machine
                                </Text>
                                <Text style={styles.breakdownVal}>
                                  {formatPaiseToRupees(currentRentBill.wm_paise || 0)}
                                </Text>
                              </View>
                            )}
                            {currentRentBill.status !== 'paid' && (
                              <View style={styles.itemActionInline}>
                                <Text style={styles.itemStatusMini}>
                                  {currentRentBill.pending_report?.status === 'pending'
                                    ? 'Rent proof under review'
                                    : currentRentBill.pending_report?.status === 'rejected'
                                    ? 'Rent proof rejected'
                                    : 'Rent unpaid'}
                                </Text>
                                <Pressable
                                  onPress={() => handleOpenPaymentModal(currentRentBill)}>
                                  <Text style={styles.itemPayMiniLink}>
                                    {currentRentBill.pending_report?.status === 'rejected'
                                      ? 'Resubmit ›'
                                      : 'Pay Rent ›'}
                                  </Text>
                                </Pressable>
                              </View>
                            )}
                          </>
                        )}

                        {currentEbBill && (
                          <>
                            <View style={styles.breakdownRow}>
                              <Text style={styles.breakdownLabel}>
                                Electricity (EB) Share
                              </Text>
                              <Text style={styles.breakdownVal}>
                                {formatPaiseToRupees(currentEbBill.total_paise)}
                              </Text>
                            </View>
                            {currentEbBill.status !== 'paid' && (
                              <View style={styles.itemActionInline}>
                                <Text style={styles.itemStatusMini}>
                                  {currentEbBill.pending_report?.status === 'pending'
                                    ? 'EB proof under review'
                                    : currentEbBill.pending_report?.status === 'rejected'
                                    ? 'EB proof rejected'
                                    : 'EB unpaid'}
                                </Text>
                                <Pressable
                                  onPress={() => handleOpenPaymentModal(currentEbBill)}>
                                  <Text style={styles.itemPayMiniLink}>
                                    {currentEbBill.pending_report?.status === 'rejected'
                                      ? 'Resubmit ›'
                                      : 'Pay EB ›'}
                                  </Text>
                                </Pressable>
                              </View>
                            )}
                          </>
                        )}

                        <View style={[styles.breakdownRow, styles.totalRow]}>
                          <Text style={styles.totalLabel}>Monthly Total</Text>
                          <Text style={styles.totalVal}>
                            {formatPaiseToRupees(totalBilledPaise)}
                          </Text>
                        </View>
                      </View>
                    )}

                    {/* Collapsed Single Receipt Link when Paid */}
                    {allCurrentPaid && primaryPaymentId && (
                      <Pressable
                        style={styles.singleReceiptLink}
                        onPress={() =>
                          router.push({
                            pathname: '/receipt-detail',
                            params: { id: primaryPaymentId },
                          })
                        }>
                        <Text style={styles.singleReceiptLinkText}>
                          Receipt{primaryReceiptNum ? ` (${primaryReceiptNum})` : ''} ›
                        </Text>
                      </Pressable>
                    )}
                  </View>
                ) : (
                  <View style={styles.emptyCard}>
                    <Text style={styles.emptyTitle}>No Active Bills</Text>
                    <Text style={styles.emptySubtitle}>
                      Your owner has not generated any bills for this month yet. Check back soon!
                    </Text>
                  </View>
                )}

                {/* SECTION: PAST MONTHS HISTORY (Hidden when empty) */}
                {pastBills.length > 0 && (
                  <>
                    <View style={[styles.sectionHeader, { marginTop: 24 }]}>
                      <Text style={styles.sectionTitle}>Past Months History</Text>
                    </View>
                    <View style={styles.historyList}>
                      {pastBills.map((bill) => (
                        <View key={bill.charge_id} style={styles.historyCard}>
                          <View style={styles.historyCardLeft}>
                            <Text style={styles.historyMonth}>
                              {bill.month_label} ({bill.title})
                            </Text>
                            <Text style={styles.historyAmount}>
                              {formatPaiseToRupees(bill.total_paise)}
                            </Text>
                            {bill.category === 'rent' && (
                              <Text style={styles.historyMeta}>
                                Rent: {formatPaiseToRupees(bill.rent_paise || 0)}
                                {(bill.wm_paise || 0) > 0 ? ` + WM: ₹500` : ''}
                              </Text>
                            )}
                          </View>

                          <View style={styles.historyCardRight}>
                            {bill.status === 'paid' ? (
                              <View style={[styles.statusBadge, styles.badgePaid]}>
                                <Text style={styles.badgePaidText}>PAID</Text>
                              </View>
                            ) : bill.pending_report?.status === 'pending' ? (
                              <View style={[styles.statusBadge, styles.badgeReview]}>
                                <Text style={styles.badgeReviewText}>REVIEW</Text>
                              </View>
                            ) : bill.pending_report?.status === 'rejected' ? (
                              <View style={[styles.statusBadge, styles.badgeRejected]}>
                                <Text style={styles.badgeRejectedText}>REJECTED</Text>
                              </View>
                            ) : (
                              <View style={[styles.statusBadge, styles.badgeUnpaid]}>
                                <Text style={styles.badgeUnpaidText}>UNPAID</Text>
                              </View>
                            )}

                            {bill.receipt_number && (
                              <Text style={styles.historyReceiptNum}>{bill.receipt_number}</Text>
                            )}
                          </View>
                        </View>
                      ))}
                    </View>
                  </>
                )}
              </>
            );
          })()
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Pay / Submit Proof Modal */}
      <Modal
        visible={paymentModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPaymentModalVisible(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Send Payment Proof</Text>
              <Pressable hitSlop={8} onPress={() => setPaymentModalVisible(false)}>
                <X size={20} color="#64748B" />
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 440 }} showsVerticalScrollIndicator={false}>
              {/* Switch between unpaid Rent & EB when both are pending */}
              {currentRentBill &&
                currentEbBill &&
                currentRentBill.status !== 'paid' &&
                currentEbBill.status !== 'paid' && (
                  <View style={[styles.methodToggleRow, { marginBottom: 12 }]}>
                    {[currentRentBill, currentEbBill].map((billOpt) => {
                      const active =
                        selectedBillForPayment?.charge_id === billOpt.charge_id;
                      return (
                        <Pressable
                          key={billOpt.charge_id}
                          style={[styles.methodBtn, active && styles.methodBtnActive]}
                          onPress={() => setSelectedBillForPayment(billOpt)}>
                          <Text
                            style={[
                              styles.methodBtnText,
                              active && styles.methodBtnTextActive,
                            ]}>
                            {billOpt.category === 'rent' ? 'Rent' : 'EB'} (
                            {formatPaiseToRupees(billOpt.total_paise)})
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}

              {/* Bill Details */}
              <View style={styles.modalBillBanner}>
                <Text style={styles.modalBillBannerTitle}>
                  {selectedBillForPayment?.title} • {selectedBillForPayment?.month_label}
                </Text>
                <Text style={styles.modalBillBannerAmount}>
                  Amount to Pay: {formatPaiseToRupees(selectedBillForPayment?.total_paise || 0)}
                </Text>
              </View>

              {/* Previous Rejection Alert (if resubmitting) */}
              {selectedBillForPayment?.pending_report?.status === 'rejected' && (
                <View style={[styles.rejectedReportBox, { marginBottom: 14 }]}>
                  <Text style={styles.rejectedReportTitle}>
                    Previous Submission Rejected
                  </Text>
                  <Text style={styles.rejectedReasonText}>
                    Feedback: {selectedBillForPayment.pending_report.rejection_reason || 'Verification failed.'}
                  </Text>
                  <Text style={styles.rejectedHelpText}>
                    Please upload an updated screenshot or enter a valid reference number below.
                  </Text>
                </View>
              )}

              {/* Method Selector: UPI vs Cash */}
              <Text style={styles.inputLabel}>How did you pay?</Text>
              <View style={styles.methodToggleRow}>
                <Pressable
                  style={[
                    styles.methodBtn,
                    paymentMethod === 'upi' && styles.methodBtnActive,
                  ]}
                  onPress={() => setPaymentMethod('upi')}>
                  <Text
                    style={[
                      styles.methodBtnText,
                      paymentMethod === 'upi' && styles.methodBtnTextActive,
                    ]}>
                    UPI / Online
                  </Text>
                </Pressable>

                <Pressable
                  style={[
                    styles.methodBtn,
                    paymentMethod === 'cash' && styles.methodBtnActive,
                  ]}
                  onPress={() => setPaymentMethod('cash')}>
                  <Text
                    style={[
                      styles.methodBtnText,
                      paymentMethod === 'cash' && styles.methodBtnTextActive,
                    ]}>
                    Paid by Cash
                  </Text>
                </Pressable>
              </View>

              {paymentMethod === 'upi' ? (
                <>
                  {/* Screenshot Picker */}
                  <Text style={styles.inputLabel}>Payment Screenshot Proof</Text>
                  {selectedScreenshot ? (
                    <View style={styles.pickedImageCard}>
                      <Image
                        source={{ uri: selectedScreenshot.uri }}
                        style={styles.pickedThumb}
                        resizeMode="cover"
                      />
                      <Pressable style={styles.changePicBtn} onPress={handlePickScreenshot}>
                        <Text style={styles.changePicBtnText}>Change Screenshot</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable style={styles.uploadPhotoBtn} onPress={handlePickScreenshot}>
                      <Camera size={24} color="#0284C7" style={{ marginBottom: 6 }} />
                      <Text style={styles.uploadPhotoText}>Upload Payment Screenshot</Text>
                      <Text style={styles.uploadPhotoSub}>From photo gallery or camera</Text>
                    </Pressable>
                  )}

                  {/* Transaction / Reference ID */}
                  <Text style={styles.inputLabel}>UPI Transaction ID / Ref No. (Optional)</Text>
                  <TextInput
                    style={styles.inputBox}
                    placeholder="e.g. 123456789012"
                    placeholderTextColor="#94A3B8"
                    value={referenceNumber}
                    onChangeText={setReferenceNumber}
                  />
                </>
              ) : (
                <View style={styles.cashNoticeBox}>
                  <Text style={styles.cashNoticeText}>
                    Select this option if you handed cash directly to the PG owner or caretaker in person.
                  </Text>
                </View>
              )}

              {/* Notes */}
              <Text style={styles.inputLabel}>Note to Owner (Optional)</Text>
              <TextInput
                style={[styles.inputBox, styles.textArea]}
                placeholder={
                  paymentMethod === 'cash'
                    ? 'e.g. Handed cash to warden in the evening'
                    : 'e.g. Paid via Google Pay'
                }
                placeholderTextColor="#94A3B8"
                value={studentNotes}
                onChangeText={setStudentNotes}
                multiline
                numberOfLines={2}
              />
            </ScrollView>

            {/* Modal Actions */}
            <View style={styles.modalActionButtons}>
              <Pressable
                style={[styles.submitProofBtn, submittingProof && styles.disabledBtn]}
                disabled={submittingProof}
                onPress={handleSubmitPaymentProof}>
                {submittingProof ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.submitProofBtnText}>Submit Payment Proof</Text>
                )}
              </Pressable>

              <Pressable
                style={styles.cancelModalBtn}
                onPress={() => setPaymentModalVisible(false)}>
                <Text style={styles.cancelModalBtnText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Full Screen Image Modal */}
      <Modal
        visible={Boolean(fullImageUrl)}
        transparent
        animationType="fade"
        onRequestClose={() => setFullImageUrl(null)}>
        <View style={styles.fullImageOverlay}>
          <Pressable style={styles.fullImageCloseBtn} onPress={() => setFullImageUrl(null)}>
            <Text style={styles.fullImageCloseText}>Close</Text>
          </Pressable>
          {fullImageUrl && (
            <Image
              source={{ uri: fullImageUrl }}
              style={styles.fullImage}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>

      <RoleBottomNav activeTab="bill" roleOverride="student" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  heroStatusCard: {
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    marginBottom: 14,
  },
  heroStatusClear: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  heroStatusDue: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  heroStatusAmount: {
    fontSize: 28,
    fontWeight: '800',
  },
  heroStatusAmountClear: {
    color: '#15803D',
  },
  heroStatusAmountDue: {
    color: '#B45309',
  },
  heroStatusSub: {
    fontSize: 13,
    color: '#475569',
    marginTop: 4,
  },
  heroPayBtn: {
    marginTop: 14,
    backgroundColor: '#0284C7',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  heroPayBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  mergedTotalAmount: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
  },
  expandToggleText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0284C7',
  },
  itemActionInline: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    paddingLeft: 8,
  },
  itemStatusMini: {
    fontSize: 11,
    color: '#64748B',
  },
  itemPayMiniLink: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0284C7',
  },
  singleReceiptLink: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    alignItems: 'flex-end',
  },
  singleReceiptLinkText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0284C7',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  backBtn: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  backBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  screenTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
  },
  screenSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
  },
  loadingBox: {
    padding: 40,
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    fontSize: 13,
    color: '#64748B',
  },
  sectionHeader: {
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  billCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  billCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  billCardHeaderTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0284C7',
    marginBottom: 2,
  },
  monthBadgeText: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  dueText: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  boldText: {
    fontWeight: '700',
    color: '#0F172A',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgePaid: {
    backgroundColor: '#DCFCE7',
  },
  badgePaidText: {
    color: '#15803D',
    fontSize: 11,
    fontWeight: '800',
  },
  badgeReview: {
    backgroundColor: '#FEF3C7',
  },
  badgeReviewText: {
    color: '#B45309',
    fontSize: 11,
    fontWeight: '800',
  },
  badgeUnpaid: {
    backgroundColor: '#FEE2E2',
  },
  badgeUnpaidText: {
    color: '#DC2626',
    fontSize: 11,
    fontWeight: '800',
  },
  badgeRejected: {
    backgroundColor: '#FEE2E2',
  },
  badgeRejectedText: {
    color: '#B91C1C',
    fontSize: 11,
    fontWeight: '800',
  },
  rejectedReportBox: {
    marginTop: 14,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  rejectedHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rejectedReportTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#B91C1C',
  },
  rejectedReasonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#991B1B',
    lineHeight: 18,
  },
  rejectedHelpText: {
    fontSize: 12,
    color: '#7F1D1D',
    lineHeight: 16,
  },
  resubmitBtn: {
    backgroundColor: '#DC2626',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  resubmitBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  breakdownBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    gap: 8,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  breakdownLabel: {
    fontSize: 13,
    color: '#64748B',
  },
  breakdownVal: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0F172A',
  },
  totalRow: {
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  totalLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  totalVal: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0284C7',
  },
  payNowBtn: {
    backgroundColor: '#0284C7',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 14,
  },
  payNowBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  paidConfirmedBox: {
    marginTop: 14,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
  },
  paidConfirmedTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#15803D',
  },
  paidConfirmedSub: {
    fontSize: 12,
    color: '#166534',
    marginTop: 3,
  },
  viewReceiptLink: {
    marginTop: 8,
  },
  viewReceiptLinkText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0284C7',
  },
  pendingReportBox: {
    marginTop: 14,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 10,
    padding: 12,
  },
  pendingReportTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#B45309',
  },
  pendingReportSub: {
    fontSize: 12,
    color: '#78350F',
    marginTop: 3,
  },
  previewScreenshotBtn: {
    marginTop: 8,
  },
  previewScreenshotText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0284C7',
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 24,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  emptySubtitle: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 4,
  },
  historyList: {
    gap: 10,
  },
  historyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  historyCardLeft: {
    gap: 2,
    flex: 1,
  },
  historyMonth: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  historyAmount: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0284C7',
  },
  historyMeta: {
    fontSize: 11,
    color: '#64748B',
  },
  historyCardRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  historyReceiptNum: {
    fontSize: 10,
    color: '#94A3B8',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 36,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalCloseText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#64748B',
    padding: 4,
  },
  modalBillBanner: {
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },
  modalBillBannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E40AF',
  },
  modalBillBannerAmount: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0284C7',
    marginTop: 2,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
    marginTop: 8,
  },
  methodToggleRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  methodBtn: {
    flex: 1,
    paddingVertical: 10,
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  methodBtnActive: {
    backgroundColor: '#E0F2FE',
    borderColor: '#0284C7',
  },
  methodBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  methodBtnTextActive: {
    color: '#0284C7',
    fontWeight: '700',
  },
  uploadPhotoBtn: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    borderStyle: 'dashed',
    padding: 16,
    alignItems: 'center',
    marginVertical: 6,
  },
  uploadPhotoIcon: {
    fontSize: 28,
  },
  uploadPhotoText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0284C7',
    marginTop: 4,
  },
  uploadPhotoSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  pickedImageCard: {
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginVertical: 6,
  },
  pickedThumb: {
    width: '100%',
    height: 120,
  },
  changePicBtn: {
    backgroundColor: '#F1F5F9',
    paddingVertical: 8,
    alignItems: 'center',
  },
  changePicBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0284C7',
  },
  inputBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: '#0F172A',
  },
  textArea: {
    minHeight: 56,
    textAlignVertical: 'top',
  },
  cashNoticeBox: {
    backgroundColor: '#FFFBEB',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#FDE68A',
    marginVertical: 6,
  },
  cashNoticeText: {
    fontSize: 12,
    color: '#B45309',
    lineHeight: 16,
  },
  modalActionButtons: {
    marginTop: 16,
    gap: 8,
  },
  submitProofBtn: {
    backgroundColor: '#0284C7',
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: 'center',
  },
  submitProofBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  cancelModalBtn: {
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
  },
  cancelModalBtnText: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '600',
  },
  fullImageOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullImageCloseBtn: {
    position: 'absolute',
    top: 50,
    right: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    zIndex: 10,
  },
  fullImageCloseText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  fullImage: {
    width: '90%',
    height: '80%',
  },
  pressed: {
    opacity: 0.8,
  },
  disabledBtn: {
    opacity: 0.6,
  },
});
