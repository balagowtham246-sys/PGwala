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
import {
  ChevronLeft,
  ChevronRight,
  Zap,
  Check,
  Receipt,
  Eye,
  X,
  CreditCard,
  Edit3,
} from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useProperty } from '@/context/property-context';
import { supabase } from '@/lib/supabase';
import {
  OwnerHeader,
  StatisticCard,
  StatusBadge,
  SegmentedFilter,
  EmptyState,
  ErrorState,
} from '@/components/ui/owner';

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
  const { selectedProperty, selectedPropertyId } = useProperty();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [propertyName, setPropertyName] = useState('Shalom Residency');

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
  const [selectedResidentForEdit, setSelectedResidentForEdit] =
    useState<ResidentRentBillItem | null>(null);
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

  const nextMonthDate = new Date(
    selectedDate.getFullYear(),
    selectedDate.getMonth() + 1,
    0
  );
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
      // 1. Resolve active property ID and name
      let activePropId = selectedPropertyId;
      let activePropName = selectedProperty?.name;

      if (!activePropId) {
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

        activePropId = properties[0].id;
        activePropName = properties[0].name;
      }

      setPropertyId(activePropId);
      setPropertyName(activePropName || 'Shalom Residency');

      // 2. Fetch active residents of this property
      const { data: resData, error: resErr } = await supabase
        .from('residents')
        .select('id, full_name, room_number, phone_number, monthly_rent_paise, is_active')
        .eq('property_id', activePropId)
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

      // 4. Fetch all charges for this property and month
      const { data: chargeData, error: chgErr } = await supabase
        .from('charges')
        .select(
          'id, resident_id, category, amount_paise, rent_amount_paise, wm_amount_paise, status'
        )
        .eq('property_id', activePropId)
        .eq('billing_period_start', monthIsoStart);

      if (chgErr) throw chgErr;

      const rentChargeMap = new Map<string, any>();
      const ebChargeMap = new Map<string, any>();

      if (chargeData) {
        for (const c of chargeData) {
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
        .select(
          'id, resident_id, charge_id, amount_paise, claimed_method, payment_date, reference_number, screenshot_url, notes, status'
        )
        .eq('property_id', activePropId)
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

      const paymentMap = new Map<
        string,
        { receipt: string; date: string; method: string }
      >();
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
      Alert.alert(
        'Load Error',
        err.message || 'Could not load billing information.'
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id, monthIsoStart, selectedPropertyId, selectedProperty?.name]);

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
      if (!data?.success)
        throw new Error(data?.error || 'Failed to generate bills.');

      setGenerateRentModalVisible(false);
      const created = data.created_count || 0;
      const updated = data.updated_count || 0;
      const parts = [];
      if (created > 0)
        parts.push(`${created} new bill${created > 1 ? 's' : ''} created`);
      if (updated > 0)
        parts.push(
          `${updated} bill${
            updated > 1 ? 's' : ''
          } updated to ₹${parsedRupees.toLocaleString('en-IN')}`
        );

      Alert.alert(
        'Rent Bills Updated',
        `${parts.join(', ') || 'Bills ready'} for ${monthLabel}.${
          data.skipped_count > 0
            ? ` (${data.skipped_count} paid bills preserved)`
            : ''
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
      if (!data?.success)
        throw new Error(data?.error || 'Failed to update rent.');

      setEditRentModalVisible(false);
      setSelectedResidentForEdit(null);
      Alert.alert(
        'Rent Updated',
        `Monthly rent for ${
          selectedResidentForEdit.full_name
        } set to ₹${parsedRupees.toLocaleString('en-IN')}.`
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
      Alert.alert(
        'Invalid Amount',
        'Please enter a valid meter bill amount in Rupees.'
      );
      return;
    }

    const roomResidents = allResidents.filter(
      (r) => r.room_number === selectedRoomForEb
    );
    if (roomResidents.length === 0) {
      Alert.alert(
        'No Residents',
        `No active residents found in Room ${selectedRoomForEb}.`
      );
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
      if (!data?.success)
        throw new Error(data?.error || 'Failed to allocate EB bill.');

      setSplitEbModalVisible(false);
      setEbTotalRupeesInput('');
      Alert.alert(
        'EB Bill Split',
        `Split ₹${parsedRupees.toLocaleString('en-IN')} equally across ${
          roomResidents.length
        } resident${
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

  // Toggle Washing Machine opt-in
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
      if (!data?.success)
        throw new Error(data?.error || 'Failed to toggle washing machine.');
      await loadBillingData();
    } catch (err: any) {
      Alert.alert(
        'Update Error',
        err.message || 'Could not update washing machine setting.'
      );
    }
  };

  // Confirm payment
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
          : 'Payment received directly in person (Cash)',
      });

      if (error) throw error;
      if (!data?.success)
        throw new Error(data?.error || 'Failed to confirm payment.');

      setReviewModalVisible(false);
      setSelectedReviewItem(null);
      Alert.alert('Payment Confirmed', `Receipt Number: ${data.receipt_number}`);
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
  const rentReviewCount = rentBills.filter(
    (r) => r.has_pending_report && r.status !== 'paid'
  ).length;
  const rentUnpaidCount = rentBills.filter((r) => r.status === 'unpaid').length;
  const rentUngeneratedCount = rentBills.filter(
    (r) => r.status === 'not_generated'
  ).length;

  const rentTotalBilledPaise = rentBills.reduce(
    (acc, r) => acc + (r.charge_id ? r.total_paise : 0),
    0
  );
  const rentTotalCollectedPaise = rentBills.reduce(
    (acc, r) => acc + (r.status === 'paid' ? r.total_paise : 0),
    0
  );
  const rentUnpaidPaise = Math.max(0, rentTotalBilledPaise - rentTotalCollectedPaise);

  const filteredRentList = rentBills.filter((r) => {
    if (filterTab === 'REVIEW')
      return r.has_pending_report && r.status !== 'paid';
    if (filterTab === 'UNPAID')
      return r.status === 'unpaid' || r.status === 'not_generated';
    if (filterTab === 'PAID') return r.status === 'paid';
    return true;
  });

  // EB Metrics & Filtering
  const ebBilledResidents = ebBills.filter((r) => r.charge_id !== null);
  const ebTotalCount = ebBilledResidents.length;
  const ebPaidCount = ebBilledResidents.filter((r) => r.status === 'paid').length;
  const ebReviewCount = ebBilledResidents.filter(
    (r) => r.has_pending_report && r.status !== 'paid'
  ).length;
  const ebUnpaidCount = ebBilledResidents.filter(
    (r) => r.status === 'unpaid'
  ).length;

  const ebTotalBilledPaise = ebBilledResidents.reduce(
    (acc, r) => acc + r.amount_paise,
    0
  );
  const ebTotalCollectedPaise = ebBilledResidents.reduce(
    (acc, r) => acc + (r.status === 'paid' ? r.amount_paise : 0),
    0
  );
  const ebUnpaidPaise = Math.max(0, ebTotalBilledPaise - ebTotalCollectedPaise);

  const filteredEbList = ebBilledResidents.filter((r) => {
    if (filterTab === 'REVIEW')
      return r.has_pending_report && r.status !== 'paid';
    if (filterTab === 'UNPAID') return r.status === 'unpaid';
    if (filterTab === 'PAID') return r.status === 'paid';
    return true;
  });

  // Active counts for current mode
  const currentTotalBilled =
    billingMode === 'RENT' ? rentTotalBilledPaise : ebTotalBilledPaise;
  const currentTotalCollected =
    billingMode === 'RENT' ? rentTotalCollectedPaise : ebTotalCollectedPaise;
  const currentUnpaidAmount =
    billingMode === 'RENT' ? rentUnpaidPaise : ebUnpaidPaise;
  const currentReviewCount =
    billingMode === 'RENT' ? rentReviewCount : ebReviewCount;
  const currentUnpaidCount =
    billingMode === 'RENT'
      ? rentUnpaidCount + rentUngeneratedCount
      : ebUnpaidCount;
  const currentPaidCount = billingMode === 'RENT' ? rentPaidCount : ebPaidCount;
  const currentTotalCount =
    billingMode === 'RENT' ? rentTotalCount : ebTotalCount;

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Standardized Header */}
      <OwnerHeader
        title="Billing"
        subtitle={propertyName}
        showBack
        rightAction={
          billingMode === 'RENT' ? (
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.headerActionBtn,
                pressed && styles.cardPressed,
              ]}
              onPress={() => setGenerateRentModalVisible(true)}>
              <Edit3 size={15} color={OwnerTheme.colors.primary} />
              <Text style={styles.headerActionBtnText}>Update Rent</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.headerActionBtn,
                pressed && styles.cardPressed,
              ]}
              onPress={() => setSplitEbModalVisible(true)}>
              <Zap size={15} color={OwnerTheme.colors.warning} />
              <Text
                style={[
                  styles.headerActionBtnText,
                  { color: OwnerTheme.colors.warning },
                ]}>
                Split EB
              </Text>
            </Pressable>
          )
        }
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={[OwnerTheme.colors.primary]}
          />
        }>
        {/* Compact Segmented Control: Rent vs Electricity */}
        <SegmentedFilter
          options={[
            { key: 'RENT', label: 'Rent' },
            { key: 'EB', label: 'Electricity' },
          ]}
          activeKey={billingMode}
          onSelect={(key) => setBillingMode(key)}
          style={{ marginBottom: 12 }}
        />

        {/* Compact Month Selector Bar */}
        <View style={styles.monthSelectorBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous month"
            hitSlop={8}
            style={({ pressed }) => [
              styles.monthNavBtn,
              pressed && styles.monthNavBtnPressed,
            ]}
            onPress={handlePrevMonth}>
            <ChevronLeft size={20} color={OwnerTheme.colors.textPrimary} />
          </Pressable>
          <View style={styles.monthLabelWrap}>
            <Text style={styles.monthLabelText}>{monthLabel}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next month"
            hitSlop={8}
            style={({ pressed }) => [
              styles.monthNavBtn,
              pressed && styles.monthNavBtnPressed,
            ]}
            onPress={handleNextMonth}>
            <ChevronRight size={20} color={OwnerTheme.colors.textPrimary} />
          </Pressable>
        </View>

        {/* Billing Summary: 3 Compact Cards */}
        <View style={styles.summaryGrid}>
          <StatisticCard
            label="Total Billed"
            value={formatPaiseToRupees(currentTotalBilled)}
            accentColor={OwnerTheme.colors.primary}
            sublabel={`${currentTotalCount} resident${
              currentTotalCount === 1 ? '' : 's'
            }`}
          />
          <StatisticCard
            label="Paid"
            value={formatPaiseToRupees(currentTotalCollected)}
            accentColor={OwnerTheme.colors.success}
            sublabel={`${currentPaidCount} collected`}
          />
          <StatisticCard
            label="Unpaid"
            value={formatPaiseToRupees(currentUnpaidAmount)}
            accentColor={
              currentUnpaidAmount > 0
                ? OwnerTheme.colors.danger
                : OwnerTheme.colors.textSecondary
            }
            sublabel={`${currentUnpaidCount} pending`}
          />
        </View>

        {/* Needs Review indicator if applicable */}
        {currentReviewCount > 0 && (
          <Pressable
            style={styles.reviewBanner}
            onPress={() => setFilterTab('REVIEW')}>
            <View style={styles.reviewBannerIcon}>
              <CreditCard size={16} color={OwnerTheme.colors.warning} />
            </View>
            <Text style={styles.reviewBannerText}>
              {currentReviewCount} payment proof
              {currentReviewCount > 1 ? 's' : ''} awaiting review
            </Text>
            <Text style={styles.reviewBannerAction}>View ›</Text>
          </Pressable>
        )}

        {/* Small Inline Generator / Success Indicator */}
        {billingMode === 'RENT' ? (
          rentUngeneratedCount > 0 ? (
            <View style={styles.inlineWarningBanner}>
              <Text style={styles.inlineWarningText}>
                {rentUngeneratedCount} resident
                {rentUngeneratedCount > 1 ? 's' : ''} not yet billed for{' '}
                {monthLabel}.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setGenerateRentModalVisible(true)}>
                <Text style={styles.inlineActionLink}>Generate Bills ›</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.inlineSuccessBanner}>
              <Check size={14} color={OwnerTheme.colors.success} />
              <Text style={styles.inlineSuccessText}>
                Bills generated for all active residents.
              </Text>
            </View>
          )
        ) : (
          <View style={styles.ebSplitterBanner}>
            <View style={{ flex: 1 }}>
              <Text style={styles.ebSplitterTitle}>Room EB Splitter</Text>
              <Text style={styles.ebSplitterSub}>
                Split room electricity bill equally among occupants.
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              style={styles.ebSplitterBtn}
              onPress={() => setSplitEbModalVisible(true)}>
              <Text style={styles.ebSplitterBtnText}>Split Room EB</Text>
            </Pressable>
          </View>
        )}

        {/* Compact Billing Filter Tabs */}
        <SegmentedFilter
          options={[
            { key: 'ALL', label: 'All', count: currentTotalCount },
            { key: 'REVIEW', label: 'Review', count: currentReviewCount },
            { key: 'UNPAID', label: 'Unpaid', count: currentUnpaidCount },
            { key: 'PAID', label: 'Paid', count: currentPaidCount },
          ]}
          activeKey={filterTab}
          onSelect={(key) => setFilterTab(key)}
          style={{ marginVertical: 12 }}
        />

        {/* Bills Roster Display */}
        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color={OwnerTheme.colors.primary} />
            <Text style={styles.loadingText}>Loading bills...</Text>
          </View>
        ) : billingMode === 'RENT' ? (
          filteredRentList.length === 0 ? (
            <EmptyState
              title="No bills in this filter"
              description={
                filterTab === 'REVIEW'
                  ? 'No rent payment proofs pending review.'
                  : filterTab === 'UNPAID'
                  ? 'All residents have paid their rent for this month!'
                  : 'No resident rent records found for this period.'
              }
            />
          ) : (
            <View style={styles.cardsList}>
              {filteredRentList.map((res) => {
                const isPaid = res.status === 'paid';
                const isNotGen = res.status === 'not_generated';
                const hasReport = res.has_pending_report && !isPaid;

                return (
                  <View key={res.resident_id} style={styles.billCard}>
                    {/* Card Header: Resident Name, Room, Status Badge */}
                    <View style={styles.cardHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.resName}>{res.full_name}</Text>
                        <Text style={styles.resRoom}>
                          Room {res.room_number}
                          {res.phone_number ? ` • ${res.phone_number}` : ''}
                        </Text>
                      </View>
                      <StatusBadge
                        label={
                          isPaid
                            ? 'PAID'
                            : hasReport
                            ? 'REVIEW'
                            : isNotGen
                            ? 'NOT BILLED'
                            : 'UNPAID'
                        }
                        variant={
                          isPaid
                            ? 'success'
                            : hasReport
                            ? 'warning'
                            : isNotGen
                            ? 'neutral'
                            : 'danger'
                        }
                        size="sm"
                      />
                    </View>

                    {/* Breakdown */}
                    <View style={styles.breakdownBox}>
                      <View style={styles.breakdownRow}>
                        <View style={styles.breakdownLabelGroup}>
                          <Text style={styles.breakdownLabel}>Room Rent</Text>
                          {!isPaid && (
                            <Pressable
                              hitSlop={6}
                              onPress={() => handleOpenEditRent(res)}>
                              <Text style={styles.editLink}>Edit</Text>
                            </Pressable>
                          )}
                        </View>
                        <Text style={styles.breakdownValue}>
                          {formatPaiseToRupees(res.rent_paise)}
                        </Text>
                      </View>

                      <View style={styles.breakdownRow}>
                        <View style={styles.wmRow}>
                          <Text style={styles.breakdownLabel}>
                            Washing Machine
                          </Text>
                          <Switch
                            value={res.opt_in_wm}
                            onValueChange={() =>
                              handleToggleWashingMachine(res)
                            }
                            trackColor={{
                              false: '#E2E8F0',
                              true: OwnerTheme.colors.primaryLight,
                            }}
                            thumbColor={
                              res.opt_in_wm
                                ? OwnerTheme.colors.primary
                                : '#FFFFFF'
                            }
                            style={{
                              transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }],
                            }}
                          />
                        </View>
                        <Text
                          style={[
                            styles.breakdownValue,
                            !res.opt_in_wm && { color: OwnerTheme.colors.textMuted },
                          ]}>
                          {res.opt_in_wm ? '₹500' : '₹0'}
                        </Text>
                      </View>

                      <View style={styles.totalRow}>
                        <Text style={styles.totalLabel}>Total</Text>
                        <Text style={styles.totalValue}>
                          {formatPaiseToRupees(res.total_paise)}
                        </Text>
                      </View>
                    </View>

                    {/* Footer Actions */}
                    {isPaid ? (
                      <View style={styles.paidInfoBox}>
                        <Receipt size={14} color={OwnerTheme.colors.success} />
                        <Text style={styles.paidInfoText}>
                          Receipt #{res.receipt_number || 'Confirmed'}
                          {res.paid_method
                            ? ` • ${res.paid_method.toUpperCase()}`
                            : ''}
                          {res.paid_date ? ` • ${res.paid_date}` : ''}
                        </Text>
                      </View>
                    ) : hasReport ? (
                      <View style={styles.actionRow}>
                        <Pressable
                          style={styles.reviewActionBtn}
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
                          <Eye size={14} color={OwnerTheme.colors.primary} />
                          <Text style={styles.reviewActionBtnText}>
                            Review Payment Proof ›
                          </Text>
                        </Pressable>
                      </View>
                    ) : (
                      <View style={styles.actionRow}>
                        <Pressable
                          style={styles.cashActionBtn}
                          onPress={() => {
                            if (!res.charge_id) {
                              Alert.alert(
                                'Notice',
                                'Please generate monthly rent bills first.'
                              );
                              return;
                            }
                            Alert.alert(
                              'Confirm In-Person Cash Payment',
                              `Confirm cash payment of ${formatPaiseToRupees(
                                res.total_paise
                              )} received from ${res.full_name} for Room ${
                                res.room_number
                              }?`,
                              [
                                { text: 'Cancel', style: 'cancel' },
                                {
                                  text: 'Confirm Cash Payment',
                                  style: 'default',
                                  onPress: () =>
                                    handleConfirmPayment(
                                      res.charge_id!,
                                      null,
                                      'cash'
                                    ),
                                },
                              ]
                            );
                          }}>
                          <Text style={styles.cashActionBtnText}>
                            Mark as Paid (Cash)
                          </Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )
        ) : (
          filteredEbList.length === 0 ? (
            <EmptyState
              title="No electricity bills"
              description={
                filterTab === 'ALL'
                  ? 'No electricity bills split for this month yet. Tap "Split Room EB" above to allocate meter bills.'
                  : 'No matching electricity bill records found.'
              }
            />
          ) : (
            <View style={styles.cardsList}>
              {filteredEbList.map((res) => {
                const isPaid = res.status === 'paid';
                const hasReport = res.has_pending_report && !isPaid;

                return (
                  <View key={res.resident_id} style={styles.billCard}>
                    <View style={styles.cardHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.resName}>{res.full_name}</Text>
                        <Text style={styles.resRoom}>
                          Room {res.room_number}
                        </Text>
                      </View>
                      <StatusBadge
                        label={
                          isPaid ? 'PAID' : hasReport ? 'REVIEW' : 'UNPAID'
                        }
                        variant={
                          isPaid ? 'success' : hasReport ? 'warning' : 'danger'
                        }
                        size="sm"
                      />
                    </View>

                    <View style={styles.breakdownBox}>
                      <View style={styles.totalRow}>
                        <Text style={styles.totalLabel}>EB Meter Share</Text>
                        <Text
                          style={[
                            styles.totalValue,
                            { color: OwnerTheme.colors.warning },
                          ]}>
                          {formatPaiseToRupees(res.amount_paise)}
                        </Text>
                      </View>
                    </View>

                    {/* Footer Actions */}
                    {isPaid ? (
                      <View style={styles.paidInfoBox}>
                        <Receipt size={14} color={OwnerTheme.colors.success} />
                        <Text style={styles.paidInfoText}>
                          Receipt #{res.receipt_number || 'Confirmed'}
                          {res.paid_method
                            ? ` • ${res.paid_method.toUpperCase()}`
                            : ''}
                        </Text>
                      </View>
                    ) : hasReport ? (
                      <View style={styles.actionRow}>
                        <Pressable
                          style={styles.reviewActionBtn}
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
                          <Eye size={14} color={OwnerTheme.colors.primary} />
                          <Text style={styles.reviewActionBtnText}>
                            Review EB Proof ›
                          </Text>
                        </Pressable>
                      </View>
                    ) : (
                      <View style={styles.actionRow}>
                        <Pressable
                          style={styles.cashActionBtn}
                          onPress={() => {
                            Alert.alert(
                              'Confirm In-Person Cash Payment',
                              `Confirm cash payment of ${formatPaiseToRupees(
                                res.amount_paise
                              )} received from ${res.full_name} for electricity?`,
                              [
                                { text: 'Cancel', style: 'cancel' },
                                {
                                  text: 'Confirm Cash Payment',
                                  onPress: () =>
                                    handleConfirmPayment(
                                      res.charge_id!,
                                      null,
                                      'cash'
                                    ),
                                },
                              ]
                            );
                          }}>
                          <Text style={styles.cashActionBtnText}>
                            Mark as Paid (Cash)
                          </Text>
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

      {/* Modal 1: Generate / Update Rent Amount */}
      <Modal
        visible={generateRentModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setGenerateRentModalVisible(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalHeading}>Update Monthly Rent</Text>
              <Pressable
                hitSlop={8}
                onPress={() => setGenerateRentModalVisible(false)}>
                <X size={20} color={OwnerTheme.colors.textSecondary} />
              </Pressable>
            </View>

            <Text style={styles.modalExplanation}>
              Set default room rent for {monthLabel}. Existing unpaid rent bills
              for {monthLabel} will be updated automatically. Paid bills are
              preserved.
            </Text>

            <Text style={styles.inputFieldLabel}>
              Monthly Room Rent Amount (₹)
            </Text>
            <TextInput
              style={styles.inputBox}
              value={rentInputRupees}
              onChangeText={setRentInputRupees}
              placeholder="e.g. 8000"
              placeholderTextColor={OwnerTheme.colors.textMuted}
              keyboardType="numeric"
            />

            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalCancelBtn}
                onPress={() => setGenerateRentModalVisible(false)}>
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.modalConfirmBtn,
                  generatingRent && styles.btnDisabled,
                ]}
                disabled={generatingRent}
                onPress={handleConfirmGenerateRent}>
                {generatingRent ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalConfirmBtnText}>Apply & Save</Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal 1B: Edit Individual Resident Rent */}
      <Modal
        visible={editRentModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setEditRentModalVisible(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalHeading}>Edit Resident Rent</Text>
              <Pressable
                hitSlop={8}
                onPress={() => setEditRentModalVisible(false)}>
                <X size={20} color={OwnerTheme.colors.textSecondary} />
              </Pressable>
            </View>

            {selectedResidentForEdit && (
              <>
                <Text style={styles.modalExplanation}>
                  Adjust rent for {selectedResidentForEdit.full_name} (Room{' '}
                  {selectedResidentForEdit.room_number}). Unpaid bill for{' '}
                  {monthLabel} will update automatically.
                </Text>

                <Text style={styles.inputFieldLabel}>
                  Monthly Rent Amount (₹)
                </Text>
                <TextInput
                  style={styles.inputBox}
                  value={editRentInputRupees}
                  onChangeText={setEditRentInputRupees}
                  placeholder="e.g. 9000"
                  placeholderTextColor={OwnerTheme.colors.textMuted}
                  keyboardType="numeric"
                />

                <View style={styles.modalActions}>
                  <Pressable
                    style={styles.modalCancelBtn}
                    onPress={() => setEditRentModalVisible(false)}>
                    <Text style={styles.modalCancelBtnText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.modalConfirmBtn,
                      updatingRent && styles.btnDisabled,
                    ]}
                    disabled={updatingRent}
                    onPress={handleConfirmEditRent}>
                    {updatingRent ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={styles.modalConfirmBtnText}>Save</Text>
                    )}
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
        animationType="fade"
        onRequestClose={() => setSplitEbModalVisible(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalHeading}>Split Electricity Bill</Text>
              <Pressable
                hitSlop={8}
                onPress={() => setSplitEbModalVisible(false)}>
                <X size={20} color={OwnerTheme.colors.textSecondary} />
              </Pressable>
            </View>

            <ScrollView
              style={{ maxHeight: 380 }}
              showsVerticalScrollIndicator={false}>
              <Text style={styles.inputFieldLabel}>Select Room Number</Text>
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

              <Text style={styles.inputFieldLabel}>
                Total Meter Bill Amount (₹)
              </Text>
              <TextInput
                style={styles.inputBox}
                value={ebTotalRupeesInput}
                onChangeText={setEbTotalRupeesInput}
                placeholder="e.g. 1200"
                placeholderTextColor={OwnerTheme.colors.textMuted}
                keyboardType="numeric"
              />

              {selectedRoomForEb ? (
                <View style={styles.ebSplitPreviewBox}>
                  <Text style={styles.ebPreviewTitle}>
                    Occupants in Room {selectedRoomForEb}:
                  </Text>
                  {allResidents.filter((r) => r.room_number === selectedRoomForEb)
                    .length > 0 ? (
                    allResidents
                      .filter((r) => r.room_number === selectedRoomForEb)
                      .map((r, idx, arr) => {
                        const totalRs =
                          parseFloat(ebTotalRupeesInput.trim()) || 0;
                        const perPerson =
                          totalRs > 0 ? (totalRs / arr.length).toFixed(0) : '0';
                        return (
                          <View key={r.id} style={styles.ebPreviewRow}>
                            <Text style={styles.ebPreviewName}>
                              • {r.full_name}
                            </Text>
                            <Text style={styles.ebPreviewShare}>
                              ₹{perPerson}
                            </Text>
                          </View>
                        );
                      })
                  ) : (
                    <Text style={styles.noOccupantsText}>
                      No active residents currently assigned to Room{' '}
                      {selectedRoomForEb}.
                    </Text>
                  )}
                </View>
              ) : null}
            </ScrollView>

            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalCancelBtn}
                onPress={() => setSplitEbModalVisible(false)}>
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.modalConfirmBtn,
                  { backgroundColor: OwnerTheme.colors.warning },
                  generatingEb && styles.btnDisabled,
                ]}
                disabled={generatingEb}
                onPress={handleConfirmSplitEb}>
                {generatingEb ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalConfirmBtnText}>Split & Send</Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal 3: Review Payment Proof */}
      <Modal
        visible={reviewModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setReviewModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalHeading}>Review Payment Proof</Text>
              <Pressable hitSlop={8} onPress={() => setReviewModalVisible(false)}>
                <X size={20} color={OwnerTheme.colors.textSecondary} />
              </Pressable>
            </View>

            {selectedReviewItem?.report && (
              <ScrollView
                style={{ maxHeight: 420 }}
                showsVerticalScrollIndicator={false}>
                <View style={styles.reviewSummaryBox}>
                  <Text style={styles.modalResName}>
                    {selectedReviewItem.full_name} (Room{' '}
                    {selectedReviewItem.room_number})
                  </Text>
                  <Text style={styles.modalBillPeriod}>
                    {selectedReviewItem.bill_title}
                  </Text>
                </View>

                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Claimed Amount</Text>
                  <Text style={styles.detailValueBold}>
                    {formatPaiseToRupees(
                      selectedReviewItem.report.amount_paise
                    )}
                  </Text>
                </View>

                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Method</Text>
                  <Text style={styles.detailValue}>
                    {selectedReviewItem.report.claimed_method === 'upi'
                      ? 'UPI / Online'
                      : 'Cash'}
                  </Text>
                </View>

                {selectedReviewItem.report.reference_number ? (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Transaction Ref</Text>
                    <Text style={styles.detailValue}>
                      {selectedReviewItem.report.reference_number}
                    </Text>
                  </View>
                ) : null}

                {selectedReviewItem.report.screenshot_url ? (
                  <View style={styles.screenshotSection}>
                    <Text style={styles.detailLabel}>Attached Screenshot</Text>
                    <Pressable
                      style={styles.screenshotWrap}
                      onPress={() =>
                        setFullImageUrl(
                          selectedReviewItem.report.screenshot_url
                        )
                      }>
                      <Image
                        source={{
                          uri: selectedReviewItem.report.screenshot_url,
                        }}
                        style={styles.screenshotThumb}
                        resizeMode="cover"
                      />
                      <Text style={styles.tapToViewText}>
                        Tap to view full image
                      </Text>
                    </Pressable>
                  </View>
                ) : null}
              </ScrollView>
            )}

            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalCancelBtn}
                onPress={() => setReviewModalVisible(false)}>
                <Text style={styles.modalCancelBtnText}>Close</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.modalConfirmBtn,
                  confirmingPayment && styles.btnDisabled,
                ]}
                disabled={confirmingPayment}
                onPress={() => {
                  if (
                    selectedReviewItem?.charge_id &&
                    selectedReviewItem.report?.id
                  ) {
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
                  <Text style={styles.modalConfirmBtnText}>
                    Confirm & Mark Paid
                  </Text>
                )}
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
          <Pressable
            style={styles.fullImageCloseBtn}
            onPress={() => setFullImageUrl(null)}>
            <Text style={styles.fullImageCloseText}>Close ✕</Text>
          </Pressable>
          {fullImageUrl && (
            <Image
              source={{ uri: fullImageUrl }}
              style={{ width: '92%', height: '80%' }}
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
    backgroundColor: OwnerTheme.colors.background,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    maxWidth: 960,
    width: '100%',
    alignSelf: 'center',
  },
  headerActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: OwnerTheme.radius.full,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
  },
  headerActionBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.primary,
  },
  monthSelectorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.md,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  monthNavBtn: {
    width: 34,
    height: 34,
    borderRadius: OwnerTheme.radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  monthNavBtnPressed: {
    backgroundColor: '#F1F5F9',
  },
  monthLabelWrap: {
    alignItems: 'center',
  },
  monthLabelText: {
    fontSize: 15,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  summaryGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  reviewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: OwnerTheme.radius.md,
    paddingVertical: 9,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  reviewBannerIcon: {
    marginRight: 8,
  },
  reviewBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#92400E',
  },
  reviewBannerAction: {
    fontSize: 13,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  inlineSuccessBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: OwnerTheme.colors.successLight,
    borderRadius: OwnerTheme.radius.sm,
    marginBottom: 8,
  },
  inlineSuccessText: {
    fontSize: 12,
    fontWeight: '500',
    color: OwnerTheme.colors.success,
  },
  inlineWarningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#FEF3C7',
    borderRadius: OwnerTheme.radius.sm,
    marginBottom: 8,
  },
  inlineWarningText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#92400E',
  },
  inlineActionLink: {
    fontSize: 12,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  ebSplitterBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    borderRadius: OwnerTheme.radius.md,
    padding: 12,
    marginBottom: 8,
  },
  ebSplitterTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  ebSplitterSub: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 2,
  },
  ebSplitterBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: OwnerTheme.colors.primaryLight,
    borderRadius: OwnerTheme.radius.sm,
    marginLeft: 10,
  },
  ebSplitterBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: OwnerTheme.colors.primary,
  },
  cardsList: {
    gap: 12,
  },
  billCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 14,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  resName: {
    fontSize: 16,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  resRoom: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 2,
  },
  breakdownBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: OwnerTheme.radius.sm,
    padding: 10,
    gap: 8,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  breakdownLabelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  breakdownLabel: {
    fontSize: 13,
    color: OwnerTheme.colors.textSecondary,
  },
  editLink: {
    fontSize: 12,
    color: OwnerTheme.colors.primary,
    fontWeight: '600',
  },
  breakdownValue: {
    fontSize: 13,
    fontWeight: '500',
    color: OwnerTheme.colors.textPrimary,
  },
  wmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: OwnerTheme.colors.border,
    paddingTop: 8,
    marginTop: 2,
  },
  totalLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  totalValue: {
    fontSize: 15,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  paidInfoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: OwnerTheme.colors.successLight,
    borderRadius: OwnerTheme.radius.sm,
  },
  paidInfoText: {
    fontSize: 12,
    color: OwnerTheme.colors.success,
    fontWeight: '500',
  },
  actionRow: {
    marginTop: 10,
  },
  cashActionBtn: {
    height: 42,
    borderRadius: OwnerTheme.radius.md,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cashActionBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  reviewActionBtn: {
    height: 42,
    flexDirection: 'row',
    gap: 6,
    borderRadius: OwnerTheme.radius.md,
    backgroundColor: OwnerTheme.colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reviewActionBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.primary,
  },
  loadingBox: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 8,
    fontSize: 13,
    color: OwnerTheme.colors.textSecondary,
  },
  cardPressed: {
    opacity: 0.85,
  },
  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    padding: 20,
    ...OwnerTheme.shadow,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  modalHeading: {
    fontSize: 18,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  modalExplanation: {
    fontSize: 13,
    color: OwnerTheme.colors.textSecondary,
    marginBottom: 14,
    lineHeight: 18,
  },
  inputFieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
    marginBottom: 6,
  },
  inputBox: {
    height: 48,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    borderRadius: OwnerTheme.radius.md,
    paddingHorizontal: 12,
    fontSize: 15,
    color: OwnerTheme.colors.textPrimary,
    backgroundColor: '#F8FAFC',
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  modalCancelBtn: {
    height: 44,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  modalConfirmBtn: {
    height: 44,
    paddingHorizontal: 18,
    borderRadius: OwnerTheme.radius.md,
    backgroundColor: OwnerTheme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalConfirmBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  btnDisabled: {
    opacity: 0.6,
  },
  roomChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  roomChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: OwnerTheme.radius.full,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    backgroundColor: '#FFFFFF',
  },
  roomChipSelected: {
    backgroundColor: OwnerTheme.colors.primary,
    borderColor: OwnerTheme.colors.primary,
  },
  roomChipText: {
    fontSize: 13,
    color: OwnerTheme.colors.textPrimary,
  },
  roomChipTextSelected: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  ebSplitPreviewBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: OwnerTheme.radius.md,
    padding: 12,
    marginBottom: 14,
  },
  ebPreviewTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
    marginBottom: 6,
  },
  ebPreviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  ebPreviewName: {
    fontSize: 13,
    color: OwnerTheme.colors.textSecondary,
  },
  ebPreviewShare: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.warning,
  },
  noOccupantsText: {
    fontSize: 12,
    color: OwnerTheme.colors.textMuted,
  },
  reviewSummaryBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: OwnerTheme.radius.md,
    padding: 12,
    marginBottom: 12,
  },
  modalResName: {
    fontSize: 15,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  modalBillPeriod: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 2,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: OwnerTheme.colors.borderLight,
  },
  detailLabel: {
    fontSize: 13,
    color: OwnerTheme.colors.textSecondary,
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '500',
    color: OwnerTheme.colors.textPrimary,
  },
  detailValueBold: {
    fontSize: 14,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  screenshotSection: {
    marginTop: 10,
  },
  screenshotWrap: {
    marginTop: 6,
    alignItems: 'center',
  },
  screenshotThumb: {
    width: 140,
    height: 140,
    borderRadius: OwnerTheme.radius.md,
    backgroundColor: '#E2E8F0',
  },
  tapToViewText: {
    fontSize: 11,
    color: OwnerTheme.colors.primary,
    marginTop: 4,
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
});
