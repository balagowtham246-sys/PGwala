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
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { useAuth } from '@/context/auth-context';
import { supabase } from '@/lib/supabase';

interface ResidentRentBillItem {
  resident_id: string;
  full_name: string;
  room_number: string;
  phone_number: string | null;
  opt_in_wm: boolean;
  monthly_rent_paise: number;
  charge_id: string | null;
  rent_paise: number;
  wm_paise: number;
  total_paise: number;
  status: 'paid' | 'unpaid' | 'not_generated';
  has_pending_report: boolean;
  pending_report?: {
    id: string;
    claimed_method: 'cash' | 'upi';
    amount_paise: number;
    payment_date: string;
    reference_number: string | null;
    screenshot_url: string | null;
    notes: string | null;
  } | null;
  receipt_number?: string | null;
  paid_date?: string | null;
  paid_method?: string | null;
}

interface ResidentEbBillItem {
  resident_id: string;
  full_name: string;
  room_number: string;
  phone_number: string | null;
  charge_id: string | null;
  amount_paise: number;
  status: 'paid' | 'unpaid' | 'not_generated';
  has_pending_report: boolean;
  pending_report?: {
    id: string;
    claimed_method: 'cash' | 'upi';
    amount_paise: number;
    payment_date: string;
    reference_number: string | null;
    screenshot_url: string | null;
    notes: string | null;
  } | null;
  receipt_number?: string | null;
  paid_date?: string | null;
  paid_method?: string | null;
}

interface RoomResidentInfo {
  id: string;
  full_name: string;
  room_number: string;
}

function formatPaiseToRupees(paise: number): string {
  const rs = Math.round(paise / 100);
  return `₹${rs.toLocaleString('en-IN')}`;
}

export default function SimplifiedBillingManagementScreen() {
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [propertyName, setPropertyName] = useState('My PG');

  // Top Section Mode: 'RENT' | 'EB'
  const [billingMode, setBillingMode] = useState<'RENT' | 'EB'>('RENT');

  // Month navigation: default to current month
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  // Rent Bills State
  const [rentBills, setRentBills] = useState<ResidentRentBillItem[]>([]);
  const [generateRentModalVisible, setGenerateRentModalVisible] = useState(false);
  const [rentInputRupees, setRentInputRupees] = useState('8000');
  const [generatingRent, setGeneratingRent] = useState(false);

  // Edit Individual Resident Rent State
  const [editRentModalVisible, setEditRentModalVisible] = useState(false);
  const [selectedResidentForEdit, setSelectedResidentForEdit] = useState<ResidentRentBillItem | null>(null);
  const [editRentInputRupees, setEditRentInputRupees] = useState('8000');
  const [updatingRent, setUpdatingRent] = useState(false);

  // EB Bills State
  const [ebBills, setEbBills] = useState<ResidentEbBillItem[]>([]);
  const [allResidents, setAllResidents] = useState<RoomResidentInfo[]>([]);
  const [availableRooms, setAvailableRooms] = useState<string[]>([]);
  const [splitEbModalVisible, setSplitEbModalVisible] = useState(false);
  const [selectedRoomForEb, setSelectedRoomForEb] = useState<string>('');
  const [ebTotalRupeesInput, setEbTotalRupeesInput] = useState('');
  const [generatingEb, setGeneratingEb] = useState(false);

  // Filter tabs: 'ALL' | 'REVIEW' | 'UNPAID' | 'PAID'
  const [filterTab, setFilterTab] = useState<'ALL' | 'REVIEW' | 'UNPAID' | 'PAID'>('ALL');

  // Review Report Modal
  const [selectedReviewItem, setSelectedReviewItem] = useState<{
    full_name: string;
    room_number: string;
    charge_id: string;
    bill_title: string;
    report: any;
  } | null>(null);
  const [reviewModalVisible, setReviewModalVisible] = useState(false);
  const [confirmingPayment, setConfirmingPayment] = useState(false);

  // Full Screen Image Viewer Modal
  const [fullImageUrl, setFullImageUrl] = useState<string | null>(null);

  // Month labels
  const monthLabel = selectedDate.toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  });

  const monthIsoStart = `${selectedDate.getFullYear()}-${String(
    selectedDate.getMonth() + 1
  ).padStart(2, '0')}-01`;

  const nextMonthDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0);
  const monthIsoEnd = `${nextMonthDate.getFullYear()}-${String(
    nextMonthDate.getMonth() + 1
  ).padStart(2, '0')}-${String(nextMonthDate.getDate()).padStart(2, '0')}`;

  const dueIsoDate = `${selectedDate.getFullYear()}-${String(
    selectedDate.getMonth() + 1
  ).padStart(2, '0')}-05`;

  // Navigate months
  const handlePrevMonth = () => {
    setSelectedDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setSelectedDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  // Load all billing data
  const loadBillingData = useCallback(async () => {
    if (!user?.id) return;

    try {
      // 1. Fetch active property owned by caller
      const { data: properties, error: propErr } = await supabase
        .from('properties')
        .select('id, name')
        .eq('owner_id', user.id)
        .eq('is_active', true)
        .limit(1);

      if (propErr) throw propErr;
      if (!properties || properties.length === 0) {
        setRentBills([]);
        setEbBills([]);
        setLoading(false);
        return;
      }

      const activeProp = properties[0];
      setPropertyId(activeProp.id);
      setPropertyName(activeProp.name);

      // 2. Fetch active residents of this property
      const { data: resData, error: resErr } = await supabase
        .from('residents')
        .select('id, full_name, room_number, phone_number, monthly_rent_paise, is_active')
        .eq('property_id', activeProp.id)
        .eq('is_active', true)
        .order('room_number', { ascending: true });

      if (resErr) throw resErr;
      const residents = resData ?? [];
      const residentIds = residents.map((r) => r.id);

      setAllResidents(residents);
      const rooms = Array.from(new Set(residents.map((r) => r.room_number))).sort();
      setAvailableRooms(rooms);
      if (rooms.length > 0 && !selectedRoomForEb) {
        setSelectedRoomForEb(rooms[0]);
      }

      if (residentIds.length === 0) {
        setRentBills([]);
        setEbBills([]);
        setLoading(false);
        return;
      }

      // 3. Fetch washing machine opt-ins
      const { data: optData } = await supabase
        .from('resident_opt_ins')
        .select('resident_id, is_enabled')
        .eq('feature_name', 'washing_machine')
        .in('resident_id', residentIds);

      const wmMap = new Map<string, boolean>();
      if (optData) {
        for (const o of optData) {
          wmMap.set(o.resident_id, o.is_enabled);
        }
      }

      // 4. Fetch all charges for this property and month (both rent & electricity)
      const { data: chargeData, error: chgErr } = await supabase
        .from('charges')
        .select('id, resident_id, category, amount_paise, rent_amount_paise, wm_amount_paise, status')
        .eq('property_id', activeProp.id)
        .eq('billing_period_start', monthIsoStart);

      if (chgErr) throw chgErr;

      const rentChargeMap = new Map<string, any>();
      const ebChargeMap = new Map<string, any>();
      const allChargeIds: string[] = [];

      if (chargeData) {
        for (const c of chargeData) {
          allChargeIds.push(c.id);
          if (c.category === 'rent') {
            rentChargeMap.set(c.resident_id, c);
          } else if (c.category === 'electricity') {
            ebChargeMap.set(c.resident_id, c);
          }
        }
      }

      // 5. Fetch pending student payment reports
      const { data: reportData } = await supabase
        .from('student_payment_reports')
        .select('id, resident_id, charge_id, amount_paise, claimed_method, payment_date, reference_number, screenshot_url, notes, status')
        .eq('property_id', activeProp.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      const reportByChargeMap = new Map<string, any>();
      if (reportData) {
        for (const rep of reportData) {
          if (rep.charge_id && !reportByChargeMap.has(rep.charge_id)) {
            reportByChargeMap.set(rep.charge_id, rep);
          }
        }
      }

      // 6. Fetch approved payment receipts for settled charges
      const settledChargeIds = (chargeData || [])
        .filter((c) => c.status === 'settled')
        .map((c) => c.id);

      const paymentMap = new Map<string, { receipt: string; date: string; method: string }>();
      if (settledChargeIds.length > 0) {
        const { data: allocData } = await supabase
          .from('payment_allocations')
          .select(`
            charge_id,
            payment:payments (
              receipt_number,
              payment_date,
              method
            )
          `)
          .in('charge_id', settledChargeIds)
          .eq('status', 'active');

        if (allocData) {
          for (const a of allocData) {
            const p: any = Array.isArray(a.payment) ? a.payment[0] : a.payment;
            if (p) {
              paymentMap.set(a.charge_id, {
                receipt: p.receipt_number,
                date: p.payment_date,
                method: p.method,
              });
            }
          }
        }
      }

      // 7. Assemble Rent Bills
      const rentItems: ResidentRentBillItem[] = residents.map((r) => {
        const optWm = wmMap.get(r.id) ?? false;
        const defaultRent = r.monthly_rent_paise || 800000;
        const chg = rentChargeMap.get(r.id);
        const rep = chg ? reportByChargeMap.get(chg.id) : null;

        if (chg) {
          const isSettled = chg.status === 'settled';
          const pInfo = paymentMap.get(chg.id);

          return {
            resident_id: r.id,
            full_name: r.full_name,
            room_number: r.room_number,
            phone_number: r.phone_number,
            opt_in_wm: optWm,
            monthly_rent_paise: defaultRent,
            charge_id: chg.id,
            rent_paise: chg.rent_amount_paise || defaultRent,
            wm_paise: chg.wm_amount_paise || (optWm ? 50000 : 0),
            total_paise: chg.amount_paise,
            status: isSettled ? 'paid' : 'unpaid',
            has_pending_report: Boolean(rep),
            pending_report: rep || null,
            receipt_number: pInfo?.receipt || null,
            paid_date: pInfo?.date || null,
            paid_method: pInfo?.method || null,
          };
        }

        return {
          resident_id: r.id,
          full_name: r.full_name,
          room_number: r.room_number,
          phone_number: r.phone_number,
          opt_in_wm: optWm,
          monthly_rent_paise: defaultRent,
          charge_id: null,
          rent_paise: defaultRent,
          wm_paise: optWm ? 50000 : 0,
          total_paise: defaultRent + (optWm ? 50000 : 0),
          status: 'not_generated',
          has_pending_report: false,
          pending_report: null,
          receipt_number: null,
          paid_date: null,
          paid_method: null,
        };
      });

      // 8. Assemble EB Bills
      const ebItems: ResidentEbBillItem[] = residents.map((r) => {
        const chg = ebChargeMap.get(r.id);
        const rep = chg ? reportByChargeMap.get(chg.id) : null;

        if (chg) {
          const isSettled = chg.status === 'settled';
          const pInfo = paymentMap.get(chg.id);

          return {
            resident_id: r.id,
            full_name: r.full_name,
            room_number: r.room_number,
            phone_number: r.phone_number,
            charge_id: chg.id,
            amount_paise: chg.amount_paise,
            status: isSettled ? 'paid' : 'unpaid',
            has_pending_report: Boolean(rep),
            pending_report: rep || null,
            receipt_number: pInfo?.receipt || null,
            paid_date: pInfo?.date || null,
            paid_method: pInfo?.method || null,
          };
        }

        return {
          resident_id: r.id,
          full_name: r.full_name,
          room_number: r.room_number,
          phone_number: r.phone_number,
          charge_id: null,
          amount_paise: 0,
          status: 'not_generated',
          has_pending_report: false,
          pending_report: null,
          receipt_number: null,
          paid_date: null,
          paid_method: null,
        };
      });

      setRentBills(rentItems);
      setEbBills(ebItems);
    } catch (err: any) {
      console.error('[BillingManagement] Load error:', err);
      Alert.alert('Load Error', err.message || 'Could not load billing information.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id, monthIsoStart]);

  useEffect(() => {
    loadBillingData();
  }, [loadBillingData]);

  const handleRefresh = () => {
    setRefreshing(true);
    loadBillingData();
  };

  // Generate or update monthly Rent bills with custom rent amount
  const handleConfirmGenerateRent = async () => {
    if (!propertyId || generatingRent) return;

    const parsedRupees = parseFloat(rentInputRupees.trim());
    if (isNaN(parsedRupees) || parsedRupees <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid rent amount in Rupees.');
      return;
    }

    const rentPaise = Math.round(parsedRupees * 100);

    try {
      setGeneratingRent(true);
      const { data, error } = await supabase.rpc('generate_monthly_bills', {
        p_property_id: propertyId,
        p_billing_month: monthIsoStart,
        p_default_rent_paise: rentPaise,
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to generate bills.');

      setGenerateRentModalVisible(false);
      const created = data.created_count || 0;
      const updated = data.updated_count || 0;
      const parts = [];
      if (created > 0) parts.push(`${created} new bill${created > 1 ? 's' : ''} created`);
      if (updated > 0) parts.push(`${updated} bill${updated > 1 ? 's' : ''} updated to ₹${parsedRupees.toLocaleString('en-IN')}`);

      Alert.alert(
        'Rent Bills Updated! 📄',
        `${parts.join(', ') || 'Bills ready'} for ${monthLabel}.${
          data.skipped_count > 0 ? ` (${data.skipped_count} paid bills preserved)` : ''
        }`
      );
      await loadBillingData();
    } catch (err: any) {
      Alert.alert('Generation Failed', err.message || 'Could not generate rent bills.');
    } finally {
      setGeneratingRent(false);
    }
  };

  // Open Edit Rent Modal for a single resident
  const handleOpenEditRent = (res: ResidentRentBillItem) => {
    setSelectedResidentForEdit(res);
    setEditRentInputRupees((res.rent_paise / 100).toString());
    setEditRentModalVisible(true);
  };

  // Confirm Individual Rent Update
  const handleConfirmEditRent = async () => {
    if (!propertyId || !selectedResidentForEdit || updatingRent) return;

    const parsedRupees = parseFloat(editRentInputRupees.trim());
    if (isNaN(parsedRupees) || parsedRupees <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid rent amount in Rupees.');
      return;
    }

    const rentPaise = Math.round(parsedRupees * 100);

    try {
      setUpdatingRent(true);
      const { data, error } = await supabase.rpc('update_resident_rent', {
        p_property_id: propertyId,
        p_resident_id: selectedResidentForEdit.resident_id,
        p_rent_paise: rentPaise,
        p_billing_month: monthIsoStart,
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to update rent.');

      setEditRentModalVisible(false);
      setSelectedResidentForEdit(null);
      Alert.alert(
        'Rent Updated! ✅',
        `Monthly rent for ${selectedResidentForEdit.full_name} set to ₹${parsedRupees.toLocaleString('en-IN')}.`
      );
      await loadBillingData();
    } catch (err: any) {
      Alert.alert('Update Failed', err.message || 'Could not update rent amount.');
    } finally {
      setUpdatingRent(false);
    }
  };

  // Split Room EB Bill
  const handleConfirmSplitEb = async () => {
    if (!propertyId || generatingEb || !selectedRoomForEb) return;

    const parsedRupees = parseFloat(ebTotalRupeesInput.trim());
    if (isNaN(parsedRupees) || parsedRupees <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid meter bill amount in Rupees.');
      return;
    }

    const roomResidents = allResidents.filter((r) => r.room_number === selectedRoomForEb);
    if (roomResidents.length === 0) {
      Alert.alert('No Residents', `No active residents found in Room ${selectedRoomForEb}.`);
      return;
    }

    const residentIds = roomResidents.map((r) => r.id);
    const totalPaise = Math.round(parsedRupees * 100);

    try {
      setGeneratingEb(true);
      const { data, error } = await supabase.rpc('allocate_eb_bill', {
        p_property_id: propertyId,
        p_room_number: selectedRoomForEb,
        p_period_start: monthIsoStart,
        p_period_end: monthIsoEnd,
        p_due_date: dueIsoDate,
        p_total_amount_paise: totalPaise,
        p_resident_ids: residentIds,
        p_notes: `${monthLabel} Room ${selectedRoomForEb} Electricity Bill`,
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to allocate EB bill.');

      setSplitEbModalVisible(false);
      setEbTotalRupeesInput('');
      Alert.alert(
        'EB Bill Split! ⚡',
        `Split ₹${parsedRupees.toLocaleString('en-IN')} equally across ${roomResidents.length} resident${
          roomResidents.length > 1 ? 's' : ''
        } in Room ${selectedRoomForEb}.`
      );
      await loadBillingData();
    } catch (err: any) {
      Alert.alert('EB Split Failed', err.message || 'Could not split EB bill.');
    } finally {
      setGeneratingEb(false);
    }
  };

  // Toggle Washing Machine opt-in (updates resident_opt_ins AND any unpaid current charge)
  const handleToggleWashingMachine = async (resident: ResidentRentBillItem) => {
    if (!propertyId) return;
    const nextVal = !resident.opt_in_wm;
    try {
      const { data, error } = await supabase.rpc('toggle_resident_wm_billing', {
        p_property_id: propertyId,
        p_resident_id: resident.resident_id,
        p_is_enabled: nextVal,
        p_billing_month: monthIsoStart,
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to toggle washing machine.');
      await loadBillingData();
    } catch (err: any) {
      Alert.alert('Update Error', err.message || 'Could not update washing machine setting.');
    }
  };

  // Confirm student payment or mark as paid in person
  const handleConfirmPayment = async (
    chargeId: string,
    reportId?: string | null,
    method: 'upi' | 'cash' = 'upi'
  ) => {
    if (confirmingPayment) return;

    try {
      setConfirmingPayment(true);
      const { data, error } = await supabase.rpc('confirm_monthly_payment', {
        p_charge_id: chargeId,
        p_report_id: reportId || undefined,
        p_method: method,
        p_notes: reportId
          ? 'Payment confirmed via student app proof'
          : 'Payment received directly in person',
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to confirm payment.');

      setReviewModalVisible(false);
      setSelectedReviewItem(null);
      Alert.alert('Payment Confirmed! ✅', `Receipt Number: ${data.receipt_number}`);
      await loadBillingData();
    } catch (err: any) {
      Alert.alert('Confirmation Failed', err.message || 'Could not confirm payment.');
    } finally {
      setConfirmingPayment(false);
    }
  };

  // RENT Metrics & Filtering
  const rentTotalCount = rentBills.length;
  const rentPaidCount = rentBills.filter((r) => r.status === 'paid').length;
  const rentReviewCount = rentBills.filter((r) => r.has_pending_report && r.status !== 'paid').length;
  const rentUnpaidCount = rentBills.filter((r) => r.status === 'unpaid').length;
  const rentUngeneratedCount = rentBills.filter((r) => r.status === 'not_generated').length;

  const rentTotalBilledPaise = rentBills.reduce((acc, r) => acc + (r.charge_id ? r.total_paise : 0), 0);
  const rentTotalCollectedPaise = rentBills.reduce(
    (acc, r) => acc + (r.status === 'paid' ? r.total_paise : 0),
    0
  );

  const filteredRentList = rentBills.filter((r) => {
    if (filterTab === 'REVIEW') return r.has_pending_report && r.status !== 'paid';
    if (filterTab === 'UNPAID') return r.status === 'unpaid' || r.status === 'not_generated';
    if (filterTab === 'PAID') return r.status === 'paid';
    return true;
  });

  // EB Metrics & Filtering
  const ebBilledResidents = ebBills.filter((r) => r.charge_id !== null);
  const ebTotalCount = ebBilledResidents.length;
  const ebPaidCount = ebBilledResidents.filter((r) => r.status === 'paid').length;
  const ebReviewCount = ebBilledResidents.filter((r) => r.has_pending_report && r.status !== 'paid').length;
  const ebUnpaidCount = ebBilledResidents.filter((r) => r.status === 'unpaid').length;

  const ebTotalBilledPaise = ebBilledResidents.reduce((acc, r) => acc + r.amount_paise, 0);
  const ebTotalCollectedPaise = ebBilledResidents.reduce(
    (acc, r) => acc + (r.status === 'paid' ? r.amount_paise : 0),
    0
  );

  const filteredEbList = ebBilledResidents.filter((r) => {
    if (filterTab === 'REVIEW') return r.has_pending_report && r.status !== 'paid';
    if (filterTab === 'UNPAID') return r.status === 'unpaid';
    if (filterTab === 'PAID') return r.status === 'paid';
    return true;
  });

  // Active counts for current mode
  const currentTotalBilled = billingMode === 'RENT' ? rentTotalBilledPaise : ebTotalBilledPaise;
  const currentTotalCollected = billingMode === 'RENT' ? rentTotalCollectedPaise : ebTotalCollectedPaise;
  const currentReviewCount = billingMode === 'RENT' ? rentReviewCount : ebReviewCount;
  const currentUnpaidCount = billingMode === 'RENT' ? rentUnpaidCount : ebUnpaidCount;
  const currentPaidCount = billingMode === 'RENT' ? rentPaidCount : ebPaidCount;
  const currentTotalCount = billingMode === 'RENT' ? rentTotalCount : ebTotalCount;

  return (
    <SafeAreaView style={styles.safeArea}>
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
            onPress={() => router.back()}>
            <Text style={styles.backBtnText}>‹ Back</Text>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.screenTitle}>Monthly Billing</Text>
            <Text style={styles.screenSubtitle}>{propertyName}</Text>
          </View>
        </View>

        {/* Top Mode Toggle: Rent vs EB */}
        <View style={styles.modeToggleBar}>
          <Pressable
            style={[styles.modeBtn, billingMode === 'RENT' && styles.modeBtnActive]}
            onPress={() => setBillingMode('RENT')}>
            <Text style={[styles.modeBtnText, billingMode === 'RENT' && styles.modeBtnTextActive]}>
              🏠 Room Rent Bills
            </Text>
          </Pressable>

          <Pressable
            style={[styles.modeBtn, billingMode === 'EB' && styles.modeBtnActive]}
            onPress={() => setBillingMode('EB')}>
            <Text style={[styles.modeBtnText, billingMode === 'EB' && styles.modeBtnTextActive]}>
              ⚡ Electricity (EB)
            </Text>
          </Pressable>
        </View>

        {/* Month Selector Bar */}
        <View style={styles.monthSelectorBar}>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.monthNavBtn, pressed && styles.pressed]}
            onPress={handlePrevMonth}>
            <Text style={styles.monthNavArrow}>‹</Text>
          </Pressable>
          <View style={styles.monthLabelWrap}>
            <Text style={styles.monthLabelText}>📅 {monthLabel}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.monthNavBtn, pressed && styles.pressed]}
            onPress={handleNextMonth}>
            <Text style={styles.monthNavArrow}>›</Text>
          </Pressable>
        </View>

        {/* Summary Metric Cards */}
        <View style={styles.summaryRow}>
          <View style={[styles.summaryCard, styles.cardBorderTotal]}>
            <Text style={styles.summaryNum} numberOfLines={1} adjustsFontSizeToFit>
              {formatPaiseToRupees(currentTotalBilled)}
            </Text>
            <Text style={styles.summaryLbl} numberOfLines={1}>Total Billed</Text>
            <Text style={styles.summarySubNote} numberOfLines={1}>
              Paid: {formatPaiseToRupees(currentTotalCollected)}
            </Text>
          </View>

          <View style={[styles.summaryCard, styles.cardBorderReview]}>
            <Text style={[styles.summaryNum, { color: '#D97706' }]} numberOfLines={1}>
              {currentReviewCount}
            </Text>
            <Text style={styles.summaryLbl} numberOfLines={1}>Needs Review</Text>
            <Text style={styles.summarySubNote} numberOfLines={1}>Proofs waiting</Text>
          </View>

          <View style={[styles.summaryCard, styles.cardBorderUnpaid]}>
            <Text style={[styles.summaryNum, { color: '#DC2626' }]} numberOfLines={1}>
              {currentUnpaidCount}
            </Text>
            <Text style={styles.summaryLbl} numberOfLines={1}>Unpaid</Text>
            <Text style={styles.summarySubNote} numberOfLines={1}>{currentPaidCount} Paid</Text>
          </View>
        </View>

        {/* Action Generator Box */}
        {billingMode === 'RENT' ? (
          rentUngeneratedCount > 0 ? (
            <View style={styles.generatorBanner}>
              <View style={{ flex: 1 }}>
                <Text style={styles.generatorTitle}>Generate {monthLabel} Rent Bills</Text>
                <Text style={styles.generatorSub}>
                  {rentUngeneratedCount} resident{rentUngeneratedCount > 1 ? 's' : ''} not yet billed for rent.
                </Text>
              </View>
              <Pressable
                style={styles.generatorActionBtn}
                onPress={() => setGenerateRentModalVisible(true)}>
                <Text style={styles.generatorActionBtnText}>⚡ Generate</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.allDoneBox}>
              <View style={{ flex: 1 }}>
                <Text style={styles.allDoneText}>
                  ✓ All {rentTotalCount} residents have rent bills for {monthLabel}.
                </Text>
                <Text style={styles.allDoneSub}>
                  Tap update to adjust rent amounts or re-apply settings.
                </Text>
              </View>
              <Pressable
                style={styles.updateRentActionBtn}
                onPress={() => setGenerateRentModalVisible(true)}>
                <Text style={styles.updateRentActionBtnText}>⚡ Update Rent</Text>
              </Pressable>
            </View>
          )
        ) : (
          <View style={styles.generatorBanner}>
            <View style={{ flex: 1 }}>
              <Text style={styles.generatorTitle}>Room Electricity (EB) Splitter</Text>
              <Text style={styles.generatorSub}>
                Enter total room meter bill and split equally among occupants.
              </Text>
            </View>
            <Pressable
              style={[styles.generatorActionBtn, { backgroundColor: '#D97706' }]}
              onPress={() => setSplitEbModalVisible(true)}>
              <Text style={styles.generatorActionBtnText}>⚡ Split Room EB</Text>
            </Pressable>
          </View>
        )}

        {/* Filter Tabs */}
        <View style={styles.filterTabsRow}>
          <Pressable
            style={[styles.filterTab, filterTab === 'ALL' && styles.filterTabActive]}
            onPress={() => setFilterTab('ALL')}>
            <Text style={[styles.filterTabText, filterTab === 'ALL' && styles.filterTabTextActive]}>
              All ({currentTotalCount})
            </Text>
          </Pressable>

          <Pressable
            style={[styles.filterTab, filterTab === 'REVIEW' && styles.filterTabActive]}
            onPress={() => setFilterTab('REVIEW')}>
            <Text style={[styles.filterTabText, filterTab === 'REVIEW' && styles.filterTabTextActive]}>
              Review ({currentReviewCount})
            </Text>
          </Pressable>

          <Pressable
            style={[styles.filterTab, filterTab === 'UNPAID' && styles.filterTabActive]}
            onPress={() => setFilterTab('UNPAID')}>
            <Text style={[styles.filterTabText, filterTab === 'UNPAID' && styles.filterTabTextActive]}>
              Unpaid ({billingMode === 'RENT' ? rentUnpaidCount + rentUngeneratedCount : ebUnpaidCount})
            </Text>
          </Pressable>

          <Pressable
            style={[styles.filterTab, filterTab === 'PAID' && styles.filterTabActive]}
            onPress={() => setFilterTab('PAID')}>
            <Text style={[styles.filterTabText, filterTab === 'PAID' && styles.filterTabTextActive]}>
              Paid ({currentPaidCount})
            </Text>
          </Pressable>
        </View>

        {/* Roster Display */}
        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color="#0284C7" />
            <Text style={styles.loadingText}>Loading bills...</Text>
          </View>
        ) : billingMode === 'RENT' ? (
          /* RENT BILLS ROSTER */
          filteredRentList.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No residents in this filter</Text>
              <Text style={styles.emptySubtitle}>
                {filterTab === 'REVIEW'
                  ? 'No rent payment proofs pending review.'
                  : filterTab === 'UNPAID'
                  ? 'All residents have paid their rent for this month!'
                  : 'No resident records found.'}
              </Text>
            </View>
          ) : (
            <View style={styles.rosterContainer}>
              {filteredRentList.map((res) => {
                const isPaid = res.status === 'paid';
                const isNotGen = res.status === 'not_generated';
                const hasReport = res.has_pending_report && !isPaid;

                return (
                  <View key={res.resident_id} style={styles.residentCard}>
                    <View style={styles.cardHeaderRow}>
                      <View style={styles.roomBadge}>
                        <Text style={styles.roomBadgeText}>Room {res.room_number}</Text>
                      </View>

                      {isPaid ? (
                        <View style={[styles.statusBadge, styles.badgePaid]}>
                          <Text style={styles.badgePaidText}>✓ PAID</Text>
                        </View>
                      ) : hasReport ? (
                        <View style={[styles.statusBadge, styles.badgeReview]}>
                          <Text style={styles.badgeReviewText}>🕒 PAYMENT SENT</Text>
                        </View>
                      ) : isNotGen ? (
                        <View style={[styles.statusBadge, styles.badgeNotGen]}>
                          <Text style={styles.badgeNotGenText}>NOT BILLED</Text>
                        </View>
                      ) : (
                        <View style={[styles.statusBadge, styles.badgeUnpaid]}>
                          <Text style={styles.badgeUnpaidText}>UNPAID</Text>
                        </View>
                      )}
                    </View>

                    <Text style={styles.resName}>{res.full_name}</Text>
                    {res.phone_number ? (
                      <Text style={styles.resPhone}>📞 {res.phone_number}</Text>
                    ) : null}

                    {/* Breakdown */}
                    <View style={styles.breakdownBox}>
                      <View style={styles.breakdownRow}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <Text style={styles.breakdownLabel}>Room Rent:</Text>
                          {res.status !== 'paid' && (
                            <Pressable
                              hitSlop={8}
                              style={styles.editRentBadge}
                              onPress={() => handleOpenEditRent(res)}>
                              <Text style={styles.editRentBadgeText}>✏️ Edit</Text>
                            </Pressable>
                          )}
                        </View>
                        <Text style={styles.breakdownVal}>
                          {formatPaiseToRupees(res.rent_paise)}
                        </Text>
                      </View>

                      <View style={styles.breakdownRow}>
                        <View style={styles.wmToggleRow}>
                          <Text style={styles.breakdownLabel}>Washing Machine:</Text>
                          <Switch
                            value={res.opt_in_wm}
                            onValueChange={() => handleToggleWashingMachine(res)}
                            trackColor={{ false: '#CBD5E1', true: '#BAE6FD' }}
                            thumbColor={res.opt_in_wm ? '#0284C7' : '#F8FAFC'}
                          />
                        </View>
                        <Text
                          style={[
                            styles.breakdownVal,
                            !res.opt_in_wm && { color: '#94A3B8' },
                          ]}>
                          {res.opt_in_wm ? '₹500' : '₹0'}
                        </Text>
                      </View>

                      <View style={[styles.breakdownRow, styles.totalRow]}>
                        <Text style={styles.totalLabel}>Total Rent Bill:</Text>
                        <Text style={styles.totalVal}>
                          {formatPaiseToRupees(res.total_paise)}
                        </Text>
                      </View>
                    </View>

                    {/* Footer Actions */}
                    {isPaid ? (
                      <View style={styles.paidInfoBox}>
                        <Text style={styles.paidInfoText}>
                          Receipt: <Text style={styles.boldText}>{res.receipt_number || 'Confirmed'}</Text>
                          {res.paid_method ? ` • Paid via ${res.paid_method.toUpperCase()}` : ''}
                        </Text>
                      </View>
                    ) : hasReport ? (
                      <View style={styles.reportPendingBox}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.reportAlertTitle}>Payment Proof Submitted</Text>
                          <Text style={styles.reportAlertSub}>
                            {res.pending_report?.claimed_method === 'upi'
                              ? `UPI • ${res.pending_report?.reference_number || 'Screenshot'}`
                              : 'Cash payment reported'}
                          </Text>
                        </View>
                        <Pressable
                          style={styles.reviewBtn}
                          onPress={() => {
                            setSelectedReviewItem({
                              full_name: res.full_name,
                              room_number: res.room_number,
                              charge_id: res.charge_id!,
                              bill_title: `${monthLabel} Rent Bill`,
                              report: res.pending_report,
                            });
                            setReviewModalVisible(true);
                          }}>
                          <Text style={styles.reviewBtnText}>Review Proof ›</Text>
                        </Pressable>
                      </View>
                    ) : (
                      <View style={styles.actionRow}>
                        <Pressable
                          style={styles.directCashBtn}
                          onPress={() => {
                            if (!res.charge_id) {
                              Alert.alert('Notice', 'Please generate monthly rent bills first.');
                              return;
                            }
                            Alert.alert(
                              'Confirm In-Person Payment',
                              `Mark ${res.full_name} as PAID for ${formatPaiseToRupees(
                                res.total_paise
                              )} (Cash)?`,
                              [
                                { text: 'Cancel', style: 'cancel' },
                                {
                                  text: 'Confirm Paid',
                                  onPress: () => handleConfirmPayment(res.charge_id!, null, 'cash'),
                                },
                              ]
                            );
                          }}>
                          <Text style={styles.directCashBtnText}>Mark as Paid (Cash)</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )
        ) : (
          /* EB BILLS ROSTER */
          filteredEbList.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No EB bills in this filter</Text>
              <Text style={styles.emptySubtitle}>
                {filterTab === 'ALL'
                  ? 'No electricity bills split for this month yet. Tap "Split Room EB" above to allocate meter bills.'
                  : 'No matching EB records found.'}
              </Text>
            </View>
          ) : (
            <View style={styles.rosterContainer}>
              {filteredEbList.map((res) => {
                const isPaid = res.status === 'paid';
                const hasReport = res.has_pending_report && !isPaid;

                return (
                  <View key={res.resident_id} style={styles.residentCard}>
                    <View style={styles.cardHeaderRow}>
                      <View style={styles.roomBadge}>
                        <Text style={styles.roomBadgeText}>Room {res.room_number}</Text>
                      </View>

                      {isPaid ? (
                        <View style={[styles.statusBadge, styles.badgePaid]}>
                          <Text style={styles.badgePaidText}>✓ PAID</Text>
                        </View>
                      ) : hasReport ? (
                        <View style={[styles.statusBadge, styles.badgeReview]}>
                          <Text style={styles.badgeReviewText}>🕒 PAYMENT SENT</Text>
                        </View>
                      ) : (
                        <View style={[styles.statusBadge, styles.badgeUnpaid]}>
                          <Text style={styles.badgeUnpaidText}>UNPAID</Text>
                        </View>
                      )}
                    </View>

                    <Text style={styles.resName}>{res.full_name}</Text>

                    <View style={styles.breakdownBox}>
                      <View style={[styles.breakdownRow, { paddingVertical: 2 }]}>
                        <Text style={styles.totalLabel}>EB Meter Share:</Text>
                        <Text style={[styles.totalVal, { color: '#D97706' }]}>
                          {formatPaiseToRupees(res.amount_paise)}
                        </Text>
                      </View>
                    </View>

                    {/* Footer Actions */}
                    {isPaid ? (
                      <View style={styles.paidInfoBox}>
                        <Text style={styles.paidInfoText}>
                          Receipt: <Text style={styles.boldText}>{res.receipt_number || 'Confirmed'}</Text>
                          {res.paid_method ? ` • Paid via ${res.paid_method.toUpperCase()}` : ''}
                        </Text>
                      </View>
                    ) : hasReport ? (
                      <View style={styles.reportPendingBox}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.reportAlertTitle}>EB Payment Proof Sent</Text>
                          <Text style={styles.reportAlertSub}>
                            {res.pending_report?.claimed_method === 'upi'
                              ? `UPI • ${res.pending_report?.reference_number || 'Screenshot'}`
                              : 'Cash payment reported'}
                          </Text>
                        </View>
                        <Pressable
                          style={styles.reviewBtn}
                          onPress={() => {
                            setSelectedReviewItem({
                              full_name: res.full_name,
                              room_number: res.room_number,
                              charge_id: res.charge_id!,
                              bill_title: `${monthLabel} Room ${res.room_number} EB Bill`,
                              report: res.pending_report,
                            });
                            setReviewModalVisible(true);
                          }}>
                          <Text style={styles.reviewBtnText}>Review Proof ›</Text>
                        </Pressable>
                      </View>
                    ) : (
                      <View style={styles.actionRow}>
                        <Pressable
                          style={styles.directCashBtn}
                          onPress={() => {
                            Alert.alert(
                              'Confirm In-Person EB Payment',
                              `Mark ${res.full_name} as PAID for ${formatPaiseToRupees(
                                res.amount_paise
                              )} (Cash)?`,
                              [
                                { text: 'Cancel', style: 'cancel' },
                                {
                                  text: 'Confirm Paid',
                                  onPress: () => handleConfirmPayment(res.charge_id!, null, 'cash'),
                                },
                              ]
                            );
                          }}>
                          <Text style={styles.directCashBtnText}>Mark as Paid (Cash)</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Modal 1: Prompt Rent Bill Amount & Generate */}
      <Modal
        visible={generateRentModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setGenerateRentModalVisible(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Generate Rent Bills</Text>
              <Pressable hitSlop={8} onPress={() => setGenerateRentModalVisible(false)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </Pressable>
            </View>

            <Text style={styles.modalSubHeader}>
              Set or update monthly room rent for {monthLabel}. Existing unpaid rent bills for {monthLabel} will be updated automatically.
            </Text>

            <Text style={styles.inputLabel}>Monthly Room Rent Amount (₹)</Text>
            <TextInput
              style={styles.amountInputBox}
              value={rentInputRupees}
              onChangeText={setRentInputRupees}
              placeholder="e.g. 8000"
              placeholderTextColor="#94A3B8"
              keyboardType="numeric"
            />

            <View style={styles.modalActionButtons}>
              <Pressable
                style={[styles.confirmPaidBtn, generatingRent && styles.disabledBtn]}
                disabled={generatingRent}
                onPress={handleConfirmGenerateRent}>
                {generatingRent ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.confirmPaidBtnText}>
                    Generate / Update Bills for {monthLabel}
                  </Text>
                )}
              </Pressable>

              <Pressable
                style={styles.cancelModalBtn}
                onPress={() => setGenerateRentModalVisible(false)}>
                <Text style={styles.cancelModalBtnText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal 1B: Edit Individual Resident Rent */}
      <Modal
        visible={editRentModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setEditRentModalVisible(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Monthly Rent</Text>
              <Pressable hitSlop={8} onPress={() => setEditRentModalVisible(false)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </Pressable>
            </View>

            {selectedResidentForEdit && (
              <>
                <Text style={styles.modalSubHeader}>
                  Update rent for {selectedResidentForEdit.full_name} (Room {selectedResidentForEdit.room_number}). The unpaid bill for {monthLabel} will be adjusted automatically.
                </Text>

                <Text style={styles.inputLabel}>Monthly Rent Amount (₹)</Text>
                <TextInput
                  style={styles.amountInputBox}
                  value={editRentInputRupees}
                  onChangeText={setEditRentInputRupees}
                  placeholder="e.g. 9000"
                  placeholderTextColor="#94A3B8"
                  keyboardType="numeric"
                />

                <View style={styles.modalActionButtons}>
                  <Pressable
                    style={[styles.confirmPaidBtn, updatingRent && styles.disabledBtn]}
                    disabled={updatingRent}
                    onPress={handleConfirmEditRent}>
                    {updatingRent ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={styles.confirmPaidBtnText}>Save Rent Changes</Text>
                    )}
                  </Pressable>

                  <Pressable
                    style={styles.cancelModalBtn}
                    onPress={() => setEditRentModalVisible(false)}>
                    <Text style={styles.cancelModalBtnText}>Cancel</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal 2: Split Room EB Bill */}
      <Modal
        visible={splitEbModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setSplitEbModalVisible(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Split Room Electricity Bill</Text>
              <Pressable hitSlop={8} onPress={() => setSplitEbModalVisible(false)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
              <Text style={styles.inputLabel}>Select Room Number</Text>
              <View style={styles.roomChipsWrap}>
                {availableRooms.map((rm) => (
                  <Pressable
                    key={rm}
                    style={[
                      styles.roomChip,
                      selectedRoomForEb === rm && styles.roomChipSelected,
                    ]}
                    onPress={() => setSelectedRoomForEb(rm)}>
                    <Text
                      style={[
                        styles.roomChipText,
                        selectedRoomForEb === rm && styles.roomChipTextSelected,
                      ]}>
                      Room {rm}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.inputLabel}>Total Meter Bill Amount (₹)</Text>
              <TextInput
                style={styles.amountInputBox}
                value={ebTotalRupeesInput}
                onChangeText={setEbTotalRupeesInput}
                placeholder="e.g. 1200"
                placeholderTextColor="#94A3B8"
                keyboardType="numeric"
              />

              {/* Live Preview of Occupants and Equal Share */}
              {selectedRoomForEb ? (
                <View style={styles.ebSplitPreviewBox}>
                  <Text style={styles.ebPreviewTitle}>
                    Occupants in Room {selectedRoomForEb}:
                  </Text>
                  {allResidents.filter((r) => r.room_number === selectedRoomForEb).length > 0 ? (
                    allResidents
                      .filter((r) => r.room_number === selectedRoomForEb)
                      .map((r, idx, arr) => {
                        const totalRs = parseFloat(ebTotalRupeesInput.trim()) || 0;
                        const perPerson = totalRs > 0 ? (totalRs / arr.length).toFixed(0) : '0';
                        return (
                          <View key={r.id} style={styles.ebPreviewRow}>
                            <Text style={styles.ebPreviewName}>• {r.full_name}</Text>
                            <Text style={styles.ebPreviewShare}>₹{perPerson}</Text>
                          </View>
                        );
                      })
                  ) : (
                    <Text style={styles.noOccupantsText}>
                      No active residents currently assigned to Room {selectedRoomForEb}.
                    </Text>
                  )}
                </View>
              ) : null}
            </ScrollView>

            <View style={styles.modalActionButtons}>
              <Pressable
                style={[
                  styles.confirmPaidBtn,
                  { backgroundColor: '#D97706' },
                  generatingEb && styles.disabledBtn,
                ]}
                disabled={generatingEb}
                onPress={handleConfirmSplitEb}>
                {generatingEb ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.confirmPaidBtnText}>Split & Send EB Bills</Text>
                )}
              </Pressable>

              <Pressable
                style={styles.cancelModalBtn}
                onPress={() => setSplitEbModalVisible(false)}>
                <Text style={styles.cancelModalBtnText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal 3: Review Payment Proof */}
      <Modal
        visible={reviewModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setReviewModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Review Payment Proof</Text>
              <Pressable hitSlop={8} onPress={() => setReviewModalVisible(false)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </Pressable>
            </View>

            {selectedReviewItem?.report && (
              <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
                <View style={styles.modalResidentInfo}>
                  <Text style={styles.modalResName}>
                    {selectedReviewItem.full_name} (Room {selectedReviewItem.room_number})
                  </Text>
                  <Text style={styles.modalBillPeriod}>
                    {selectedReviewItem.bill_title}
                  </Text>
                </View>

                <View style={styles.modalDetailRow}>
                  <Text style={styles.modalLabel}>Claimed Amount:</Text>
                  <Text style={styles.modalAmountHighlight}>
                    {formatPaiseToRupees(selectedReviewItem.report.amount_paise)}
                  </Text>
                </View>

                <View style={styles.modalDetailRow}>
                  <Text style={styles.modalLabel}>Payment Method:</Text>
                  <Text style={styles.modalValText}>
                    {selectedReviewItem.report.claimed_method === 'upi' ? '📱 UPI / Online' : '💵 Cash'}
                  </Text>
                </View>

                {selectedReviewItem.report.reference_number ? (
                  <View style={styles.modalDetailRow}>
                    <Text style={styles.modalLabel}>Transaction / Ref ID:</Text>
                    <Text style={styles.modalValText}>
                      {selectedReviewItem.report.reference_number}
                    </Text>
                  </View>
                ) : null}

                {selectedReviewItem.report.notes ? (
                  <View style={styles.modalNotesBox}>
                    <Text style={styles.modalLabel}>Student Note:</Text>
                    <Text style={styles.modalNoteText}>
                      {selectedReviewItem.report.notes}
                    </Text>
                  </View>
                ) : null}

                {selectedReviewItem.report.screenshot_url ? (
                  <View style={styles.screenshotSection}>
                    <Text style={styles.modalLabel}>Attached Screenshot Proof:</Text>
                    <Pressable
                      style={styles.screenshotWrap}
                      onPress={() => setFullImageUrl(selectedReviewItem.report.screenshot_url)}>
                      <Image
                        source={{ uri: selectedReviewItem.report.screenshot_url }}
                        style={styles.screenshotThumb}
                        resizeMode="cover"
                      />
                      <Text style={styles.tapToViewText}>🔍 Tap to view full size</Text>
                    </Pressable>
                  </View>
                ) : null}
              </ScrollView>
            )}

            <View style={styles.modalActionButtons}>
              <Pressable
                style={[
                  styles.confirmPaidBtn,
                  confirmingPayment && styles.disabledBtn,
                ]}
                disabled={confirmingPayment}
                onPress={() => {
                  if (selectedReviewItem?.charge_id && selectedReviewItem.report?.id) {
                    handleConfirmPayment(
                      selectedReviewItem.charge_id,
                      selectedReviewItem.report.id,
                      selectedReviewItem.report.claimed_method
                    );
                  }
                }}>
                {confirmingPayment ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.confirmPaidBtnText}>✓ Confirm & Mark as Paid</Text>
                )}
              </Pressable>

              <Pressable
                style={styles.cancelModalBtn}
                onPress={() => setReviewModalVisible(false)}>
                <Text style={styles.cancelModalBtnText}>Close</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Full Screen Image Modal */}
      <Modal
        visible={Boolean(fullImageUrl)}
        transparent
        animationType="fade"
        onRequestClose={() => setFullImageUrl(null)}>
        <View style={styles.fullImageOverlay}>
          <Pressable style={styles.fullImageCloseBtn} onPress={() => setFullImageUrl(null)}>
            <Text style={styles.fullImageCloseText}>✕ Close</Text>
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
    width: '100%',
    maxWidth: 1080,
    alignSelf: 'center',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
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
  modeToggleBar: {
    flexDirection: 'row',
    backgroundColor: '#E2E8F0',
    borderRadius: 10,
    padding: 3,
    marginBottom: 14,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  modeBtnActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  modeBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  modeBtnTextActive: {
    color: '#0284C7',
    fontWeight: '800',
  },
  monthSelectorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 14,
  },
  monthNavBtn: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
  },
  monthNavArrow: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
  },
  monthLabelWrap: {
    alignItems: 'center',
  },
  monthLabelText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0284C7',
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderLeftWidth: 4,
  },
  cardBorderTotal: {
    borderLeftColor: '#0284C7',
  },
  cardBorderReview: {
    borderLeftColor: '#D97706',
  },
  cardBorderUnpaid: {
    borderLeftColor: '#DC2626',
  },
  summaryNum: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  summaryLbl: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
    marginTop: 2,
  },
  summarySubNote: {
    fontSize: 9,
    color: '#94A3B8',
    marginTop: 2,
  },
  generatorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    gap: 10,
  },
  generatorTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E40AF',
  },
  generatorSub: {
    fontSize: 11,
    color: '#3B82F6',
    marginTop: 2,
  },
  generatorActionBtn: {
    backgroundColor: '#0284C7',
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  generatorActionBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  allDoneBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    gap: 10,
  },
  allDoneText: {
    fontSize: 13,
    color: '#15803D',
    fontWeight: '700',
  },
  allDoneSub: {
    fontSize: 11,
    color: '#16A34A',
    marginTop: 2,
  },
  updateRentActionBtn: {
    backgroundColor: '#0284C7',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  updateRentActionBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  editRentBadge: {
    backgroundColor: '#E0F2FE',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 6,
  },
  editRentBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0284C7',
  },
  filterTabsRow: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    padding: 3,
    marginBottom: 14,
  },
  filterTab: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    borderRadius: 7,
  },
  filterTabActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  filterTabText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  filterTabTextActive: {
    color: '#0284C7',
    fontWeight: '800',
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
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
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
  rosterContainer: {
    gap: 12,
  },
  residentCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  roomBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  roomBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
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
  badgeNotGen: {
    backgroundColor: '#F1F5F9',
  },
  badgeNotGenText: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '700',
  },
  resName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  resPhone: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  breakdownBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 10,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    gap: 6,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  wmToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  breakdownLabel: {
    fontSize: 12,
    color: '#64748B',
  },
  breakdownVal: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0F172A',
  },
  totalRow: {
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  totalLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  totalVal: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0284C7',
  },
  paidInfoBox: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  paidInfoText: {
    fontSize: 12,
    color: '#16A34A',
  },
  boldText: {
    fontWeight: '700',
  },
  reportPendingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#FDE68A',
    gap: 8,
  },
  reportAlertTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B45309',
  },
  reportAlertSub: {
    fontSize: 11,
    color: '#78350F',
    marginTop: 2,
  },
  reviewBtn: {
    backgroundColor: '#D97706',
    borderRadius: 6,
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  reviewBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  actionRow: {
    marginTop: 10,
  },
  directCashBtn: {
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  directCashBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: Platform.OS === 'web' ? 'center' : 'flex-end',
    alignItems: 'center',
    padding: Platform.OS === 'web' ? 20 : 0,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderRadius: Platform.OS === 'web' ? 20 : 0,
    padding: 20,
    paddingBottom: 36,
    width: '100%',
    maxWidth: 540,
    alignSelf: 'center',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
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
  modalSubHeader: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 18,
    marginBottom: 14,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
    marginTop: 8,
  },
  amountInputBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#0284C7',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 10,
  },
  roomChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  roomChip: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  roomChipSelected: {
    backgroundColor: '#E0F2FE',
    borderColor: '#0284C7',
  },
  roomChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  roomChipTextSelected: {
    color: '#0284C7',
    fontWeight: '800',
  },
  ebSplitPreviewBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginVertical: 10,
    gap: 6,
  },
  ebPreviewTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4,
  },
  ebPreviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2,
  },
  ebPreviewName: {
    fontSize: 12,
    color: '#334155',
  },
  ebPreviewShare: {
    fontSize: 13,
    fontWeight: '700',
    color: '#D97706',
  },
  noOccupantsText: {
    fontSize: 12,
    color: '#94A3B8',
    fontStyle: 'italic',
  },
  modalResidentInfo: {
    backgroundColor: '#F8FAFC',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  modalResName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  modalBillPeriod: {
    fontSize: 12,
    color: '#0284C7',
    fontWeight: '600',
    marginTop: 2,
  },
  modalDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  modalLabel: {
    fontSize: 13,
    color: '#64748B',
  },
  modalValText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0F172A',
  },
  modalAmountHighlight: {
    fontSize: 16,
    fontWeight: '800',
    color: '#16A34A',
  },
  modalNotesBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 10,
    marginVertical: 8,
  },
  modalNoteText: {
    fontSize: 12,
    color: '#334155',
    marginTop: 3,
  },
  screenshotSection: {
    marginTop: 10,
  },
  screenshotWrap: {
    marginTop: 6,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
  },
  screenshotThumb: {
    width: '100%',
    height: 140,
  },
  tapToViewText: {
    fontSize: 11,
    color: '#0284C7',
    fontWeight: '600',
    paddingVertical: 6,
  },
  modalActionButtons: {
    marginTop: 16,
    gap: 8,
  },
  confirmPaidBtn: {
    backgroundColor: '#16A34A',
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: 'center',
  },
  confirmPaidBtnText: {
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
