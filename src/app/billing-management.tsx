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
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { useAuth } from '@/context/auth-context';
import { supabase } from '@/lib/supabase';

interface ResidentBillingItem {
  id: string;
  full_name: string;
  room_number: string;
  phone_number: string | null;
  is_active: boolean;
  profile_id: string | null;
  opt_in_wm: boolean;
  wm_opt_out_date?: string | null;
  total_outstanding_paise: number;
  total_overdue_paise: number;
}

interface ChargeItem {
  id: string;
  resident_id: string;
  category: 'rent' | 'electricity' | 'washing_machine' | 'opening_balance';
  description: string;
  billing_period_start: string;
  billing_period_end: string;
  due_date: string;
  amount_paise: number;
  status: 'outstanding' | 'settled' | 'cancelled';
  is_opening_balance: boolean;
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
  resident_id: string;
  amount_paise: number;
  claimed_method: 'cash' | 'upi';
  payment_date: string;
  reference_number: string | null;
  notes: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  resident?: {
    full_name: string;
    room_number: string;
  };
}

export default function BillingManagementScreen() {
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [propertyName, setPropertyName] = useState('My PG');

  // Overview stats
  const [totalOutstandingPaise, setTotalOutstandingPaise] = useState(0);
  const [totalOverduePaise, setTotalOverduePaise] = useState(0);

  // Lists
  const [residents, setResidents] = useState<ResidentBillingItem[]>([]);
  const [pendingReports, setPendingReports] = useState<StudentReportItem[]>([]);

  // Generation Modal
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [customRentRupees, setCustomRentRupees] = useState('9000');
  const [generating, setGenerating] = useState(false);

  // Resident Action Modal
  const [selectedResident, setSelectedResident] = useState<ResidentBillingItem | null>(null);
  const [residentCharges, setResidentCharges] = useState<ChargeItem[]>([]);
  const [residentPayments, setResidentPayments] = useState<PaymentItem[]>([]);
  const [residentCreditPaise, setResidentCreditPaise] = useState(0);
  const [applyingCredit, setApplyingCredit] = useState(false);
  const [loadingResidentDetail, setLoadingResidentDetail] = useState(false);

  // Record Payment Sub-Modal
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentAmountRupees, setPaymentAmountRupees] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'upi' | 'cash'>('upi');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [submittingPayment, setSubmittingPayment] = useState(false);

  // Opening Balance Sub-Modal
  const [showOpeningModal, setShowOpeningModal] = useState(false);
  const [openingCategory, setOpeningCategory] = useState<'rent' | 'electricity' | 'washing_machine'>('rent');
  const [openingAmountRupees, setOpeningAmountRupees] = useState('');
  const [openingReference, setOpeningReference] = useState('');
  const [submittingOpening, setSubmittingOpening] = useState(false);

  // Load all billing data
  const loadData = useCallback(async () => {
    try {
      setLoading(true);

      // 1. Fetch active property for owner
      const { data: properties, error: propError } = await supabase
        .from('properties')
        .select('id, name')
        .eq('is_active', true)
        .limit(1);

      if (propError) throw propError;
      if (!properties || properties.length === 0) {
        setLoading(false);
        return;
      }

      const activeProp = properties[0];
      setPropertyId(activeProp.id);
      setPropertyName(activeProp.name);

      // 2. Fetch residents for this property
      const { data: resData, error: resError } = await supabase
        .from('residents')
        .select(`
          id,
          full_name,
          room_number,
          phone_number,
          is_active,
          profile_id,
          resident_opt_ins (
            feature_name,
            is_enabled,
            opt_out_effective_date
          )
        `)
        .eq('property_id', activeProp.id)
        .order('room_number', { ascending: true });

      if (resError) throw resError;

      // 3. Fetch all outstanding charges for this property to aggregate balances
      const todayIso = new Date().toISOString().split('T')[0];
      const { data: chargesData, error: chargesError } = await supabase
        .from('charges')
        .select('id, resident_id, amount_paise, due_date, status')
        .eq('property_id', activeProp.id)
        .eq('status', 'outstanding');

      if (chargesError) throw chargesError;

      const outstandingMap: Record<string, { total: number; overdue: number }> = {};
      let propTotalOutstanding = 0;
      let propTotalOverdue = 0;

      for (const ch of chargesData || []) {
        if (!outstandingMap[ch.resident_id]) {
          outstandingMap[ch.resident_id] = { total: 0, overdue: 0 };
        }
        outstandingMap[ch.resident_id].total += ch.amount_paise;
        propTotalOutstanding += ch.amount_paise;

        if (ch.due_date < todayIso) {
          outstandingMap[ch.resident_id].overdue += ch.amount_paise;
          propTotalOverdue += ch.amount_paise;
        }
      }

      setTotalOutstandingPaise(propTotalOutstanding);
      setTotalOverduePaise(propTotalOverdue);

      const billingResidents: ResidentBillingItem[] = (resData || []).map((r: any) => {
        const wmOpt = r.resident_opt_ins?.find(
          (opt: any) => opt.feature_name === 'washing_machine'
        );
        const balances = outstandingMap[r.id] || { total: 0, overdue: 0 };

        return {
          id: r.id,
          full_name: r.full_name,
          room_number: r.room_number,
          phone_number: r.phone_number,
          is_active: r.is_active,
          profile_id: r.profile_id,
          opt_in_wm: wmOpt?.is_enabled ?? false,
          wm_opt_out_date: wmOpt?.opt_out_effective_date || null,
          total_outstanding_paise: balances.total,
          total_overdue_paise: balances.overdue,
        };
      });

      setResidents(billingResidents);

      // 4. Fetch pending student payment reports
      const { data: reportsData, error: reportsError } = await supabase
        .from('student_payment_reports')
        .select(`
          id,
          resident_id,
          amount_paise,
          claimed_method,
          payment_date,
          reference_number,
          notes,
          status,
          created_at,
          resident:residents (
            full_name,
            room_number
          )
        `)
        .eq('property_id', activeProp.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (reportsError) {
        console.warn('[BillingManagement] Error fetching reports:', reportsError.message);
      } else {
        setPendingReports((reportsData as any) || []);
      }
    } catch (err: any) {
      console.error('[BillingManagement] Load error:', err);
      Alert.alert('Load Failed', err.message || 'Could not load billing information.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Load specific resident details (charges & payments)
  const openResidentDetail = async (item: ResidentBillingItem) => {
    setSelectedResident(item);
    setLoadingResidentDetail(true);

    try {
      // Fetch charges
      const { data: chData } = await supabase
        .from('charges')
        .select('*')
        .eq('resident_id', item.id)
        .order('due_date', { ascending: false });

      setResidentCharges(chData || []);

      // Fetch payments
      const { data: payData } = await supabase
        .from('payments')
        .select('*')
        .eq('resident_id', item.id)
        .order('payment_date', { ascending: false });

      const loadedPayments: PaymentItem[] = payData || [];
      setResidentPayments(loadedPayments);

      const unalloc = loadedPayments
        .filter((p) => p.status === 'approved')
        .reduce((acc, p) => acc + (p.unallocated_amount_paise || 0), 0);
      setResidentCreditPaise(unalloc);
    } catch (err: any) {
      console.error('[BillingManagement] Resident detail error:', err);
    } finally {
      setLoadingResidentDetail(false);
    }
  };

  // Apply Unallocated Credit RPC
  const handleApplyCredit = async () => {
    if (!selectedResident) return;
    setApplyingCredit(true);
    try {
      const { data, error } = await supabase.rpc('apply_unallocated_credit', {
        p_resident_id: selectedResident.id,
      });

      if (error) throw error;
      if (!data?.success) {
        Alert.alert('Apply Credit Failed', data?.error || 'Could not apply credit.');
        return;
      }

      Alert.alert('Credit Applied', data.message || 'Credit applied to complete charges.');
      await openResidentDetail(selectedResident);
      await loadData();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to apply credit.');
    } finally {
      setApplyingCredit(false);
    }
  };

  // Generate Monthly Charges RPC
  const handleGenerateMonthly = async () => {
    if (!propertyId) return;

    const rentRupees = parseInt(customRentRupees, 10);
    if (isNaN(rentRupees) || rentRupees <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid monthly rent amount.');
      return;
    }

    setGenerating(true);
    try {
      const today = new Date();
      const billingMonthIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;

      const { data, error } = await supabase.rpc('generate_monthly_charges', {
        p_property_id: propertyId,
        p_billing_month: billingMonthIso,
        p_custom_rent_paise: rentRupees * 100,
      });

      if (error) throw error;

      if (!data?.success) {
        Alert.alert('Generation Failed', data?.error || 'Could not generate charges.');
        return;
      }

      Alert.alert('Success', data.message || 'Monthly charges generated.');
      setShowGenerateModal(false);
      await loadData();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not generate monthly charges.');
    } finally {
      setGenerating(false);
    }
  };

  // Toggle Washing Machine RPC
  const handleToggleWm = async (item: ResidentBillingItem, value: boolean) => {
    try {
      const { data, error } = await supabase.rpc('toggle_washing_machine', {
        p_resident_id: item.id,
        p_enabled: value,
      });

      if (error) throw error;
      if (!data?.success) {
        Alert.alert('Update Failed', data?.error || 'Could not update washing machine setting.');
        return;
      }

      setResidents((prev) =>
        prev.map((r) =>
          r.id === item.id
            ? {
                ...r,
                opt_in_wm: value,
                wm_opt_out_date: data?.opt_out_effective_date || null,
              }
            : r
        )
      );
      if (selectedResident?.id === item.id) {
        setSelectedResident((prev) =>
          prev
            ? {
                ...prev,
                opt_in_wm: value,
                wm_opt_out_date: data?.opt_out_effective_date || null,
              }
            : null
        );
      }
      if (data?.message) {
        Alert.alert('Washing Machine', data.message);
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to update washing machine opt-in.');
    }
  };

  // Record Payment RPC
  const handleRecordPayment = async () => {
    if (!selectedResident || !propertyId) return;

    const amountRupees = parseFloat(paymentAmountRupees);
    if (isNaN(amountRupees) || amountRupees <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid payment amount.');
      return;
    }

    setSubmittingPayment(true);
    try {
      const todayIso = new Date().toISOString().split('T')[0];
      const amountPaise = Math.round(amountRupees * 100);

      const { data, error } = await supabase.rpc('approve_payment_and_allocate', {
        p_property_id: propertyId,
        p_resident_id: selectedResident.id,
        p_amount_paise: amountPaise,
        p_method: paymentMethod,
        p_payment_date: todayIso,
        p_notes: paymentNotes.trim() || null,
        p_student_report_id: null,
      });

      if (error) throw error;
      if (!data?.success) {
        Alert.alert('Payment Failed', data?.error || 'Could not record payment.');
        return;
      }

      Alert.alert('Payment Recorded', data.message || 'Payment allocated successfully.', [
        {
          text: 'View Receipt',
          onPress: () => {
            setShowPaymentModal(false);
            setSelectedResident(null);
            router.push({
              pathname: '/receipt-detail',
              params: { id: data.payment_id },
            });
          },
        },
        {
          text: 'Done',
          onPress: () => {
            setShowPaymentModal(false);
            openResidentDetail(selectedResident);
            loadData();
          },
        },
      ]);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to record payment.');
    } finally {
      setSubmittingPayment(false);
    }
  };

  // Record Opening Balance RPC
  const handleRecordOpeningBalance = async () => {
    if (!selectedResident) return;

    const amountRupees = parseFloat(openingAmountRupees);
    if (isNaN(amountRupees) || amountRupees <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount.');
      return;
    }

    setSubmittingOpening(true);
    try {
      const todayIso = new Date().toISOString().split('T')[0];
      const amountPaise = Math.round(amountRupees * 100);

      const { data, error } = await supabase.rpc('record_opening_balance', {
        p_resident_id: selectedResident.id,
        p_category: openingCategory,
        p_amount_paise: amountPaise,
        p_due_date: todayIso,
        p_reference: openingReference.trim() || null,
      });

      if (error) throw error;
      if (!data?.success) {
        Alert.alert('Failed', data?.error || 'Could not record opening balance.');
        return;
      }

      Alert.alert('Success', data.message || 'Opening balance recorded.');
      setShowOpeningModal(false);
      setOpeningAmountRupees('');
      setOpeningReference('');
      openResidentDetail(selectedResident);
      loadData();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to record opening balance.');
    } finally {
      setSubmittingOpening(false);
    }
  };

  // Approve Student Report RPC
  const handleApproveReport = (report: StudentReportItem) => {
    Alert.alert(
      'Approve Payment Report',
      `Approve payment of ₹${report.amount_paise / 100} claimed via ${report.claimed_method.toUpperCase()} for ${report.resident?.full_name}?\n\nThis will record an authoritative payment and settle complete charges in oldest-first order.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve & Settle',
          onPress: async () => {
            if (!propertyId) return;
            try {
              const { data, error } = await supabase.rpc('approve_payment_and_allocate', {
                p_property_id: propertyId,
                p_resident_id: report.resident_id,
                p_amount_paise: report.amount_paise,
                p_method: report.claimed_method,
                p_payment_date: report.payment_date,
                p_notes: report.notes,
                p_student_report_id: report.id,
              });

              if (error) throw error;
              if (!data?.success) {
                Alert.alert('Approval Failed', data?.error || 'Could not approve report.');
                return;
              }

              Alert.alert('Report Approved', data.message);
              loadData();
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Failed to approve report.');
            }
          },
        },
      ]
    );
  };

  // Reject Student Report RPC
  const handleRejectReport = (report: StudentReportItem) => {
    Alert.prompt
      ? Alert.prompt(
          'Reject Payment Report',
          'Enter the reason for rejecting this payment report:',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Reject',
              style: 'destructive',
              onPress: async (reason?: string) => {
                if (!reason || !reason.trim()) {
                  Alert.alert('Required', 'A reason is required to reject a payment report.');
                  return;
                }
                executeReject(report.id, reason.trim());
              },
            },
          ]
        )
      : executeReject(report.id, 'Payment not received / unverified transaction.');
  };

  const executeReject = async (reportId: string, reason: string) => {
    try {
      const { data, error } = await supabase.rpc('reject_student_payment_report', {
        p_report_id: reportId,
        p_rejection_reason: reason,
      });

      if (error) throw error;
      if (!data?.success) {
        Alert.alert('Failed', data?.error || 'Could not reject report.');
        return;
      }

      Alert.alert('Report Rejected', data.message);
      loadData();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to reject report.');
    }
  };

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
            <Text style={styles.screenTitle}>Billing & Dues</Text>
            <Text style={styles.screenSubtitle}>{propertyName}</Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color="#0284C7" />
            <Text style={styles.loadingText}>Loading property ledger...</Text>
          </View>
        ) : (
          <>
            {/* Overview Cards */}
            <View style={styles.statsGrid}>
              <View style={[styles.statCard, { borderLeftColor: '#0284C7' }]}>
                <Text style={styles.statLabel}>Total Outstanding</Text>
                <Text style={[styles.statValue, { color: '#0284C7' }]}>
                  ₹{(totalOutstandingPaise / 100).toLocaleString('en-IN')}
                </Text>
                <Text style={styles.statSub}>All active dues</Text>
              </View>

              <View style={[styles.statCard, { borderLeftColor: '#DC2626' }]}>
                <Text style={styles.statLabel}>Overdue Amount</Text>
                <Text style={[styles.statValue, { color: '#DC2626' }]}>
                  ₹{(totalOverduePaise / 100).toLocaleString('en-IN')}
                </Text>
                <Text style={styles.statSub}>Past due date</Text>
              </View>
            </View>

            {/* Quick Action Buttons */}
            <View style={styles.actionRow}>
              <Pressable
                style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
                onPress={() => setShowGenerateModal(true)}>
                <Text style={styles.actionButtonIcon}>⚡</Text>
                <View style={styles.actionButtonTextWrap}>
                  <Text style={styles.actionButtonTitle}>Generate Monthly</Text>
                  <Text style={styles.actionButtonSub}>Rent & Washing Machine</Text>
                </View>
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
                onPress={() => router.push('/eb-billing')}>
                <Text style={styles.actionButtonIcon}>💡</Text>
                <View style={styles.actionButtonTextWrap}>
                  <Text style={styles.actionButtonTitle}>EB Room Bill</Text>
                  <Text style={styles.actionButtonSub}>Equal room split</Text>
                </View>
              </Pressable>
            </View>

            {/* Pending Payment Reports Section */}
            {pendingReports.length > 0 && (
              <View style={styles.sectionWrap}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>
                    Pending Student Reports ({pendingReports.length})
                  </Text>
                  <View style={styles.alertBadge}>
                    <Text style={styles.alertBadgeText}>Review Required</Text>
                  </View>
                </View>

                {pendingReports.map((report) => (
                  <View key={report.id} style={styles.reportCard}>
                    <View style={styles.reportHeader}>
                      <View>
                        <Text style={styles.reportResidentName}>
                          {report.resident?.full_name} (Room {report.resident?.room_number})
                        </Text>
                        <Text style={styles.reportMeta}>
                          Claimed {report.claimed_method.toUpperCase()} • Paid on {report.payment_date}
                        </Text>
                      </View>
                      <Text style={styles.reportAmount}>
                        ₹{(report.amount_paise / 100).toLocaleString('en-IN')}
                      </Text>
                    </View>

                    {report.reference_number && (
                      <Text style={styles.reportRef}>Ref: {report.reference_number}</Text>
                    )}
                    {report.notes && (
                      <Text style={styles.reportNotes}>Note: {report.notes}</Text>
                    )}

                    <View style={styles.reportActionsRow}>
                      <Pressable
                        style={styles.rejectBtn}
                        onPress={() => handleRejectReport(report)}>
                        <Text style={styles.rejectBtnText}>Reject</Text>
                      </Pressable>
                      <Pressable
                        style={styles.approveBtn}
                        onPress={() => handleApproveReport(report)}>
                        <Text style={styles.approveBtnText}>Approve & Settle</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Resident Directory & Ledger */}
            <View style={styles.sectionWrap}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Resident Dues Ledger</Text>
                <Text style={styles.sectionCount}>{residents.length} residents</Text>
              </View>

              {residents.map((res) => {
                const isPaid = res.total_outstanding_paise === 0;
                const isOverdue = res.total_overdue_paise > 0;

                return (
                  <Pressable
                    key={res.id}
                    style={({ pressed }) => [styles.residentCard, pressed && styles.residentCardPressed]}
                    onPress={() => openResidentDetail(res)}>
                    <View style={styles.resCardLeft}>
                      <View style={styles.resNameRow}>
                        <Text style={styles.resName}>{res.full_name}</Text>
                        <Text style={styles.roomBadge}>Room {res.room_number}</Text>
                      </View>
                      <Text style={styles.resSub}>
                        Washing Machine: {res.opt_in_wm ? 'Enabled (₹500/mo)' : 'Disabled'}
                      </Text>
                    </View>

                    <View style={styles.resCardRight}>
                      <Text
                        style={[
                          styles.resAmount,
                          isPaid ? styles.resAmountPaid : isOverdue ? styles.resAmountOverdue : styles.resAmountDue,
                        ]}>
                        {isPaid ? 'All Paid' : `₹${(res.total_outstanding_paise / 100).toLocaleString('en-IN')}`}
                      </Text>
                      <View
                        style={[
                          styles.statusPill,
                          isPaid ? styles.statusPillPaid : isOverdue ? styles.statusPillOverdue : styles.statusPillDue,
                        ]}>
                        <Text
                          style={[
                            styles.statusPillText,
                            isPaid ? styles.statusPillTextPaid : isOverdue ? styles.statusPillTextOverdue : styles.statusPillTextDue,
                          ]}>
                          {isPaid ? 'Settled' : isOverdue ? 'Overdue' : 'Due'}
                        </Text>
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>

      {/* MODAL 1: Generate Monthly Charges */}
      <Modal
        visible={showGenerateModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowGenerateModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Generate Monthly Charges</Text>
            <Text style={styles.modalSub}>
              Creates rent charges (due on 5th) and washing machine fees (₹500 for opted-in residents) for all active residents. Duplicate charges are automatically prevented.
            </Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Monthly Rent Amount (₹)</Text>
              <TextInput
                style={styles.modalInput}
                keyboardType="numeric"
                value={customRentRupees}
                onChangeText={setCustomRentRupees}
                placeholder="9000"
              />
            </View>

            <View style={styles.modalBtnRow}>
              <Pressable
                style={styles.modalCancelBtn}
                onPress={() => setShowGenerateModal(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                disabled={generating}
                style={[styles.modalConfirmBtn, generating && styles.btnDisabled]}
                onPress={handleGenerateMonthly}>
                {generating ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.modalConfirmText}>Generate Charges</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL 2: Resident Detailed Ledger */}
      <Modal
        visible={!!selectedResident}
        animationType="slide"
        onRequestClose={() => setSelectedResident(null)}>
        <SafeAreaView style={styles.residentDetailModal}>
          <View style={styles.modalHeader}>
            <Pressable hitSlop={8} onPress={() => setSelectedResident(null)}>
              <Text style={styles.modalCloseText}>✕ Close</Text>
            </Pressable>
            <Text style={styles.modalHeaderTitle}>{selectedResident?.full_name}</Text>
            <Text style={styles.modalHeaderSub}>Room {selectedResident?.room_number}</Text>
          </View>

          <ScrollView contentContainerStyle={styles.detailScrollContent}>
            {loadingResidentDetail ? (
              <ActivityIndicator size="small" color="#0284C7" style={{ marginTop: 40 }} />
            ) : (
              <>
                {/* Summary Banner */}
                <View style={styles.ledgerSummaryCard}>
                  <View>
                    <Text style={styles.ledgerSummaryLabel}>Outstanding Dues</Text>
                    <Text style={styles.ledgerSummaryValue}>
                      ₹{((selectedResident?.total_outstanding_paise || 0) / 100).toLocaleString('en-IN')}
                    </Text>
                  </View>
                  <View style={styles.ledgerSummaryActions}>
                    <Pressable
                      style={styles.recordPayBtn}
                      onPress={() => {
                        setPaymentAmountRupees(
                          selectedResident?.total_outstanding_paise
                            ? String(selectedResident.total_outstanding_paise / 100)
                            : ''
                        );
                        setShowPaymentModal(true);
                      }}>
                      <Text style={styles.recordPayBtnText}>+ Record Payment</Text>
                    </Pressable>
                  </View>
                </View>

                {/* Advance Credit Card */}
                {residentCreditPaise > 0 && (
                  <View style={styles.creditCard}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.creditCardLabel}>Available Advance Credit</Text>
                      <Text style={styles.creditCardValue}>
                        ₹{(residentCreditPaise / 100).toLocaleString('en-IN')}
                      </Text>
                      <Text style={styles.creditCardSub}>
                        From unallocated amounts on approved payments.
                      </Text>
                    </View>
                    {selectedResident && selectedResident.total_outstanding_paise > 0 ? (
                      <Pressable
                        disabled={applyingCredit}
                        style={[styles.applyCreditBtn, applyingCredit && styles.btnDisabled]}
                        onPress={handleApplyCredit}>
                        <Text style={styles.applyCreditBtnText}>
                          {applyingCredit ? 'Applying...' : 'Apply Credit'}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                )}

                {/* Washing Machine Opt-in Setting */}
                <View style={styles.optInCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.optInTitle}>Washing Machine (₹500 / mo)</Text>
                    <Text style={styles.optInSub}>
                      Enable to automatically bill washing machine fees on monthly generation.
                    </Text>
                  </View>
                  <Switch
                    value={selectedResident?.opt_in_wm ?? false}
                    onValueChange={(val) => {
                      if (selectedResident) handleToggleWm(selectedResident, val);
                    }}
                    trackColor={{ false: '#CBD5E1', true: '#93C5FD' }}
                    thumbColor={selectedResident?.opt_in_wm ? '#0284C7' : '#F8FAFC'}
                  />
                </View>

                {/* Actions: Add Opening Balance */}
                <View style={styles.secondaryActionRow}>
                  <Pressable
                    style={styles.openingBalBtn}
                    onPress={() => setShowOpeningModal(true)}>
                    <Text style={styles.openingBalBtnText}>+ Set Opening Balance</Text>
                  </Pressable>
                </View>

                {/* Charges Section */}
                <Text style={styles.subSectionTitle}>Individual Charges</Text>
                {residentCharges.length === 0 ? (
                  <Text style={styles.emptyText}>No charges recorded yet.</Text>
                ) : (
                  residentCharges.map((ch) => (
                    <View key={ch.id} style={styles.chargeRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.chargeDesc}>{ch.description}</Text>
                        <Text style={styles.chargeDate}>
                          Due: {ch.due_date} • Category: {ch.category.toUpperCase()}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.chargeAmount}>
                          ₹{(ch.amount_paise / 100).toLocaleString('en-IN')}
                        </Text>
                        <Text
                          style={[
                            styles.chargeStatus,
                            ch.status === 'settled'
                              ? styles.chargeSettled
                              : ch.status === 'cancelled'
                              ? styles.chargeCancelled
                              : styles.chargeOutstanding,
                          ]}>
                          {ch.status.toUpperCase()}
                        </Text>
                      </View>
                    </View>
                  ))
                )}

                {/* Payments Section */}
                <Text style={[styles.subSectionTitle, { marginTop: 20 }]}>
                  Payment History & Receipts
                </Text>
                {residentPayments.length === 0 ? (
                  <Text style={styles.emptyText}>No payments recorded yet.</Text>
                ) : (
                  residentPayments.map((p) => (
                    <Pressable
                      key={p.id}
                      style={styles.paymentRow}
                      onPress={() =>
                        router.push({
                          pathname: '/receipt-detail',
                          params: { id: p.id },
                        })
                      }>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.paymentReceiptNo}>{p.receipt_number}</Text>
                        <Text style={styles.paymentMeta}>
                          {p.payment_date} • {p.method.toUpperCase()}
                        </Text>
                        {p.unallocated_amount_paise > 0 && (
                          <Text style={styles.unallocText}>
                            Unallocated: ₹{(p.unallocated_amount_paise / 100).toLocaleString('en-IN')}
                          </Text>
                        )}
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.paymentAmount}>
                          ₹{(p.amount_paise / 100).toLocaleString('en-IN')}
                        </Text>
                        <Text style={styles.viewReceiptLink}>View Receipt ›</Text>
                      </View>
                    </Pressable>
                  ))
                )}
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* SUB-MODAL: Record Payment */}
      <Modal
        visible={showPaymentModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPaymentModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Record Payment</Text>
            <Text style={styles.modalSub}>
              Approved payments settle complete outstanding charges in oldest-first order.
            </Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Amount Received (₹)</Text>
              <TextInput
                style={styles.modalInput}
                keyboardType="numeric"
                value={paymentAmountRupees}
                onChangeText={setPaymentAmountRupees}
                placeholder="e.g. 9000"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Payment Method</Text>
              <View style={styles.methodToggleRow}>
                <Pressable
                  style={[styles.methodBtn, paymentMethod === 'upi' && styles.methodBtnActive]}
                  onPress={() => setPaymentMethod('upi')}>
                  <Text style={[styles.methodBtnText, paymentMethod === 'upi' && styles.methodBtnTextActive]}>
                    UPI / GPay
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.methodBtn, paymentMethod === 'cash' && styles.methodBtnActive]}
                  onPress={() => setPaymentMethod('cash')}>
                  <Text style={[styles.methodBtnText, paymentMethod === 'cash' && styles.methodBtnTextActive]}>
                    Cash
                  </Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Notes / Reference (Optional)</Text>
              <TextInput
                style={styles.modalInput}
                value={paymentNotes}
                onChangeText={setPaymentNotes}
                placeholder="e.g. Cash received in person"
              />
            </View>

            <View style={styles.modalBtnRow}>
              <Pressable
                style={styles.modalCancelBtn}
                onPress={() => setShowPaymentModal(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                disabled={submittingPayment}
                style={[styles.modalConfirmBtn, submittingPayment && styles.btnDisabled]}
                onPress={handleRecordPayment}>
                {submittingPayment ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.modalConfirmText}>Confirm & Issue Receipt</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* SUB-MODAL: Opening Balance */}
      <Modal
        visible={showOpeningModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowOpeningModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Set Opening Balance</Text>
            <Text style={styles.modalSub}>
              Enter historical unpaid balances from prior systems.
            </Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Category</Text>
              <View style={styles.categoryPickerRow}>
                {(['rent', 'electricity', 'washing_machine'] as const).map((cat) => (
                  <Pressable
                    key={cat}
                    style={[styles.catBtn, openingCategory === cat && styles.catBtnActive]}
                    onPress={() => setOpeningCategory(cat)}>
                    <Text style={[styles.catBtnText, openingCategory === cat && styles.catBtnTextActive]}>
                      {cat === 'washing_machine' ? 'WM' : cat.toUpperCase()}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Amount (₹)</Text>
              <TextInput
                style={styles.modalInput}
                keyboardType="numeric"
                value={openingAmountRupees}
                onChangeText={setOpeningAmountRupees}
                placeholder="e.g. 4500"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Historical Reference</Text>
              <TextInput
                style={styles.modalInput}
                value={openingReference}
                onChangeText={setOpeningReference}
                placeholder="e.g. October legacy register"
              />
            </View>

            <View style={styles.modalBtnRow}>
              <Pressable
                style={styles.modalCancelBtn}
                onPress={() => setShowOpeningModal(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                disabled={submittingOpening}
                style={[styles.modalConfirmBtn, submittingOpening && styles.btnDisabled]}
                onPress={handleRecordOpeningBalance}>
                {submittingOpening ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.modalConfirmText}>Save Balance</Text>
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
    textTransform: 'uppercase',
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
  statsGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderLeftWidth: 4,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    textTransform: 'uppercase',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '800',
    marginTop: 4,
  },
  statSub: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 10,
  },
  actionButtonPressed: {
    backgroundColor: '#F1F5F9',
  },
  actionButtonIcon: {
    fontSize: 22,
  },
  actionButtonTextWrap: {
    flex: 1,
  },
  actionButtonTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  actionButtonSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  sectionWrap: {
    marginBottom: 20,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  sectionCount: {
    fontSize: 12,
    color: '#64748B',
  },
  alertBadge: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  alertBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#DC2626',
  },
  reportCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#FECACA',
    marginBottom: 10,
  },
  reportHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  reportResidentName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  reportMeta: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  reportAmount: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0284C7',
  },
  reportRef: {
    fontSize: 12,
    color: '#475569',
    marginTop: 6,
    fontWeight: '600',
  },
  reportNotes: {
    fontSize: 12,
    color: '#64748B',
    fontStyle: 'italic',
    marginTop: 2,
  },
  reportActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  rejectBtn: {
    flex: 1,
    paddingVertical: 8,
    backgroundColor: '#FEE2E2',
    borderRadius: 6,
    alignItems: 'center',
  },
  rejectBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#DC2626',
  },
  approveBtn: {
    flex: 2,
    paddingVertical: 8,
    backgroundColor: '#0284C7',
    borderRadius: 6,
    alignItems: 'center',
  },
  approveBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  residentCard: {
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
  residentCardPressed: {
    backgroundColor: '#F8FAFC',
  },
  resCardLeft: {
    flex: 1,
  },
  resNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  resName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  roomBadge: {
    fontSize: 11,
    color: '#64748B',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  resSub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 4,
  },
  resCardRight: {
    alignItems: 'flex-end',
  },
  resAmount: {
    fontSize: 15,
    fontWeight: '700',
  },
  resAmountPaid: {
    color: '#16A34A',
  },
  resAmountOverdue: {
    color: '#DC2626',
  },
  resAmountDue: {
    color: '#0284C7',
  },
  statusPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 4,
  },
  statusPillPaid: {
    backgroundColor: '#DCFCE7',
  },
  statusPillOverdue: {
    backgroundColor: '#FEE2E2',
  },
  statusPillDue: {
    backgroundColor: '#E0F2FE',
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: '700',
  },
  statusPillTextPaid: {
    color: '#15803D',
  },
  statusPillTextOverdue: {
    color: '#DC2626',
  },
  statusPillTextDue: {
    color: '#0369A1',
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
  residentDetailModal: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  modalHeader: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  modalCloseText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0284C7',
    marginBottom: 8,
  },
  modalHeaderTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalHeaderSub: {
    fontSize: 13,
    color: '#64748B',
  },
  detailScrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  ledgerSummaryCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 12,
  },
  ledgerSummaryLabel: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  ledgerSummaryValue: {
    fontSize: 24,
    fontWeight: '800',
    color: '#DC2626',
    marginTop: 2,
  },
  ledgerSummaryActions: {
    alignItems: 'flex-end',
  },
  recordPayBtn: {
    backgroundColor: '#0284C7',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  recordPayBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  optInCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 12,
  },
  optInTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  optInSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  secondaryActionRow: {
    marginBottom: 16,
  },
  openingBalBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  openingBalBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  subSectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 12,
    color: '#94A3B8',
    fontStyle: 'italic',
    paddingVertical: 10,
  },
  chargeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 6,
  },
  chargeDesc: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  chargeDate: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  chargeAmount: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  chargeStatus: {
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  chargeSettled: {
    color: '#16A34A',
  },
  chargeCancelled: {
    color: '#94A3B8',
  },
  chargeOutstanding: {
    color: '#DC2626',
  },
  paymentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 6,
  },
  paymentReceiptNo: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0284C7',
  },
  paymentMeta: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  unallocText: {
    fontSize: 11,
    color: '#D97706',
    fontWeight: '600',
    marginTop: 2,
  },
  paymentAmount: {
    fontSize: 14,
    fontWeight: '700',
    color: '#16A34A',
  },
  viewReceiptLink: {
    fontSize: 11,
    color: '#0284C7',
    fontWeight: '600',
    marginTop: 2,
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
  categoryPickerRow: {
    flexDirection: 'row',
    gap: 6,
  },
  catBtn: {
    flex: 1,
    paddingVertical: 8,
    backgroundColor: '#F1F5F9',
    borderRadius: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  catBtnActive: {
    backgroundColor: '#E0F2FE',
    borderColor: '#0284C7',
  },
  catBtnText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  catBtnTextActive: {
    color: '#0284C7',
    fontWeight: '700',
  },
  creditCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#FCD34D',
    marginBottom: 12,
  },
  creditCardLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#92400E',
  },
  creditCardValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#B45309',
    marginTop: 2,
  },
  creditCardSub: {
    fontSize: 10,
    color: '#78350F',
    marginTop: 2,
  },
  applyCreditBtn: {
    backgroundColor: '#D97706',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  applyCreditBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
});

