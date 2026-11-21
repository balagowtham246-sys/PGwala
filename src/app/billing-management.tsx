import { Href, router, useLocalSearchParams } from 'expo-router';
import {
  AlertTriangle,
  Check,
  Copy,
  Edit3,
  Info,
  MessageCircle,
  X,
  Zap,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BillingSummaryHeader } from '@/components/billing/BillingSummaryHeader';
import { ChargeFormModal } from '@/components/billing/ChargeFormModal';
import { PaymentReportReviewModal } from '@/components/billing/PaymentReportReviewModal';
import { ResidentLedgerCard } from '@/components/billing/ResidentLedgerCard';
import { RoleBottomNav } from '@/components/ui/bottom-nav';
import { EmptyState, OwnerHeader } from '@/components/ui/owner';
import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useProperty } from '@/context/property-context';
import { useToast } from '@/context/toast-context';
import {
  buildWhatsAppReminderUrl,
  formatDueStatus,
  formatPaiseToRupees,
} from '@/lib/billing-utils';
import { isValidUpiId } from '@/lib/upi';
import { findDuplicatePhones } from '@/lib/ux-utils';
import {
  allocateEbBill,
  BillingFilterTab,
  BillingMode,
  CombinedBillItem,
  confirmMonthlyPayment,
  generateMonthlyBills,
  getOwnerBilling,
  OwnerBillingSnapshot,
  PaymentMethod,
  rejectStudentPaymentReport,
  ResidentEbBillItem,
  ResidentRentBillItem,
  resolvePaymentProofUrl,
  ReviewPaymentItem,
  RoomResidentInfo,
  toggleResidentWmBilling,
  updateResidentRent,
} from '@/services/billing.service';

export default function SimplifiedBillingManagementScreen() {
  const { user } = useAuth();
  const { selectedProperty, selectedPropertyId } = useProperty();
  const { showToast } = useToast();
  const params = useLocalSearchParams<{ residentId?: string | string[] }>();
  const rawParamResidentId = Array.isArray(params.residentId)
    ? params.residentId[0]
    : params.residentId;
  const paramResidentId = rawParamResidentId?.trim() || null;

  const userId = user?.id;
  const activeSelectedPropertyId = selectedPropertyId;
  const activeSelectedPropertyName = selectedProperty?.name;

  const [clearedResidentId, setClearedResidentId] = useState<string | null>(
    null
  );

  useEffect(() => {
    if (paramResidentId) return;
    const timer = setTimeout(() => {
      setClearedResidentId(null);
    }, 0);
    return () => clearTimeout(timer);
  }, [paramResidentId]);

  const activeResidentFilterId =
    paramResidentId && paramResidentId !== clearedResidentId
      ? paramResidentId
      : null;

  const handleClearResidentFilter = () => {
    setClearedResidentId(paramResidentId);
    try {
      router.setParams({ residentId: undefined });
    } catch {
      // Non-fatal in pager context
    }
  };

  const handleOpenResidentProfile = (residentId: string) => {
    router.push({
      pathname: '/resident-profile',
      params: { id: residentId },
    } as Href);
  };

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [propertyName, setPropertyName] = useState('Shalom Residency');

  // Top Section Mode: 'RENT' | 'EB' | 'COMBINED'
  const [billingMode, setBillingMode] = useState<BillingMode>('RENT');

  // Month navigation: default to current month
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  // Rent Bills State
  const [rentBills, setRentBills] = useState<ResidentRentBillItem[]>([]);
  const [generateRentModalVisible, setGenerateRentModalVisible] =
    useState(false);
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
  const [filterTab, setFilterTab] = useState<BillingFilterTab>('ALL');

  // Transient post-generation banner & Bulk Reminder Modal
  const [showBillsGeneratedBanner, setShowBillsGeneratedBanner] =
    useState(false);
  const [dismissedUpiBannerPropertyId, setDismissedUpiBannerPropertyId] =
    useState<string | null>(null);
  const [bulkReminderModalVisible, setBulkReminderModalVisible] =
    useState(false);
  const [sentReminderIds, setSentReminderIds] = useState<string[]>([]);

  // Review Report Modal
  const [selectedReviewItem, setSelectedReviewItem] =
    useState<ReviewPaymentItem | null>(null);
  const [reviewModalVisible, setReviewModalVisible] = useState(false);
  const [confirmingPayment, setConfirmingPayment] = useState(false);
  const [reviewSignedUrl, setReviewSignedUrl] = useState<string | null>(null);
  const [loadingReviewUrl, setLoadingReviewUrl] = useState(false);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [rejectingPayment, setRejectingPayment] = useState(false);

  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!showBillsGeneratedBanner) return;
    const timer = setTimeout(() => {
      setShowBillsGeneratedBanner(false);
    }, 4000);
    return () => clearTimeout(timer);
  }, [showBillsGeneratedBanner]);

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
    setShowBillsGeneratedBanner(false);
    setSelectedDate(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1)
    );
  };

  const handleNextMonth = () => {
    setShowBillsGeneratedBanner(false);
    setSelectedDate(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1)
    );
  };

  const applySnapshot = useCallback((snapshot: OwnerBillingSnapshot) => {
    setPropertyId(snapshot.propertyId);
    setPropertyName(snapshot.propertyName);
    setRentBills(snapshot.rentBills);
    setEbBills(snapshot.ebBills);
    setAllResidents(snapshot.allResidents);
    setAvailableRooms(snapshot.availableRooms);
    if (snapshot.availableRooms.length > 0) {
      setSelectedRoomForEb((prev) =>
        prev && snapshot.availableRooms.includes(prev)
          ? prev
          : snapshot.availableRooms[0]
      );
    }
  }, []);

  // Load all billing data via SWR service
  const loadBillingData = useCallback(
    async (options?: { forceNetwork?: boolean }) => {
      if (!userId) return;

      const reqId = ++requestIdRef.current;
      let hadCacheHit = false;

      const result = await getOwnerBilling(
        {
          userId,
          selectedPropertyId: activeSelectedPropertyId,
          selectedPropertyName: activeSelectedPropertyName,
          monthIsoStart,
        },
        {
          forceNetwork: options?.forceNetwork,
          onCachedData: (cached) => {
            if (!mountedRef.current || requestIdRef.current !== reqId) return;
            hadCacheHit = true;
            applySnapshot(cached);
            setLoading(false);
          },
        }
      );

      if (!mountedRef.current || requestIdRef.current !== reqId) return;

      if (result.ok) {
        applySnapshot(result.data);
      } else if (!hadCacheHit || options?.forceNetwork) {
        Alert.alert('Load Error', result.error.message);
      }

      setLoading(false);
      setRefreshing(false);
    },
    [
      userId,
      activeSelectedPropertyId,
      activeSelectedPropertyName,
      monthIsoStart,
      applySnapshot,
    ]
  );

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) {
        void loadBillingData();
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [loadBillingData]);

  const handleRefresh = () => {
    setRefreshing(true);
    void loadBillingData({ forceNetwork: true });
  };

  // Helper to open review modal and securely resolve signed screenshot URL
  const openReviewModal = async (item: ReviewPaymentItem) => {
    setSelectedReviewItem(item);
    setReviewSignedUrl(null);
    setShowRejectForm(false);
    setRejectionReason('');
    setReviewModalVisible(true);

    if (item.report?.screenshot_url) {
      setLoadingReviewUrl(true);
      try {
        const signed = await resolvePaymentProofUrl(item.report.screenshot_url);
        if (mountedRef.current) {
          setReviewSignedUrl(signed);
        }
      } finally {
        if (mountedRef.current) {
          setLoadingReviewUrl(false);
        }
      }
    }
  };

  // Generate or update monthly Rent bills with custom rent amount
  const handleConfirmGenerateRent = async () => {
    if (!propertyId || generatingRent) return;

    const parsedRupees = parseFloat(rentInputRupees.trim());
    if (isNaN(parsedRupees) || parsedRupees <= 0) {
      Alert.alert(
        'Invalid Amount',
        'Please enter a valid rent amount in Rupees.'
      );
      return;
    }

    const rentPaise = Math.round(parsedRupees * 100);
    setGeneratingRent(true);
    const result = await generateMonthlyBills({
      propertyId,
      monthIsoStart,
      rentPaise,
    });
    setGeneratingRent(false);

    if (!result.ok) {
      Alert.alert('Generation Failed', result.error.message);
      return;
    }

    setGenerateRentModalVisible(false);
    const { created_count: created, updated_count: updated, skipped_count: skipped } =
      result.data;
    const parts: string[] = [];
    if (created > 0) {
      parts.push(`${created} new bill${created > 1 ? 's' : ''} created`);
    }
    if (updated > 0) {
      parts.push(
        `${updated} bill${updated > 1 ? 's' : ''
        } updated to ₹${parsedRupees.toLocaleString('en-IN')}`
      );
    }

    showToast(
      `${parts.join(', ') || 'Bills ready'} for ${monthLabel}.${
        skipped > 0 ? ` (${skipped} paid bills preserved)` : ''
      }`
    );
    await loadBillingData({ forceNetwork: true });
    if (mountedRef.current) {
      setShowBillsGeneratedBanner(true);
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
      Alert.alert(
        'Invalid Amount',
        'Please enter a valid rent amount in Rupees.'
      );
      return;
    }

    const rentPaise = Math.round(parsedRupees * 100);
    setUpdatingRent(true);
    const result = await updateResidentRent({
      propertyId,
      residentId: selectedResidentForEdit.resident_id,
      rentPaise,
      monthIsoStart,
    });
    setUpdatingRent(false);

    if (!result.ok) {
      Alert.alert('Update Failed', result.error.message);
      return;
    }

    const residentName = selectedResidentForEdit.full_name;
    setEditRentModalVisible(false);
    setSelectedResidentForEdit(null);
    showToast(
      `Monthly rent for ${residentName} set to ₹${parsedRupees.toLocaleString(
        'en-IN'
      )}.`
    );
    await loadBillingData({ forceNetwork: true });
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

    setGeneratingEb(true);
    const result = await allocateEbBill({
      propertyId,
      roomNumber: selectedRoomForEb,
      monthIsoStart,
      monthIsoEnd,
      dueIsoDate,
      totalPaise,
      residentIds,
      notes: `${monthLabel} Room ${selectedRoomForEb} Electricity Bill`,
    });
    setGeneratingEb(false);

    if (!result.ok) {
      Alert.alert('EB Split Failed', result.error.message);
      return;
    }

    const targetRoom = selectedRoomForEb;
    setSplitEbModalVisible(false);
    setEbTotalRupeesInput('');
    showToast(
      `Split ₹${parsedRupees.toLocaleString('en-IN')} EB across ${roomResidents.length
      } resident${roomResidents.length > 1 ? 's' : ''} in Room ${targetRoom}.`
    );
    await loadBillingData({ forceNetwork: true });
  };

  // Toggle Washing Machine opt-in
  const handleToggleWashingMachine = async (resident: ResidentRentBillItem) => {
    if (!propertyId) return;
    const nextVal = !resident.opt_in_wm;
    const result = await toggleResidentWmBilling({
      propertyId,
      residentId: resident.resident_id,
      isEnabled: nextVal,
      monthIsoStart,
    });

    if (!result.ok) {
      Alert.alert('Update Error', result.error.message);
      return;
    }
    await loadBillingData({ forceNetwork: true });
  };

  // Confirm payment
  const handleConfirmPayment = async (
    chargeId: string,
    reportId?: string | null,
    method: PaymentMethod = 'upi'
  ) => {
    if (confirmingPayment) return;

    setConfirmingPayment(true);
    const result = await confirmMonthlyPayment({
      chargeId,
      reportId,
      method,
    });
    setConfirmingPayment(false);

    if (!result.ok) {
      Alert.alert('Confirmation Failed', result.error.message);
      return;
    }

    setReviewModalVisible(false);
    setSelectedReviewItem(null);
    showToast(`Payment confirmed · Receipt ${result.data.receipt_number}`);
    await loadBillingData({ forceNetwork: true });
  };

  // Reject payment proof with reason
  const handleRejectPayment = async () => {
    if (!selectedReviewItem?.report?.id || rejectingPayment) return;
    const trimmedReason = rejectionReason.trim();
    if (!trimmedReason) {
      Alert.alert(
        'Reason Required',
        'Please select a quick reason or provide details for rejecting this payment proof.'
      );
      return;
    }

    setRejectingPayment(true);
    const result = await rejectStudentPaymentReport({
      reportId: selectedReviewItem.report.id,
      rejectionReason: trimmedReason,
    });
    setRejectingPayment(false);

    if (!result.ok) {
      Alert.alert('Rejection Failed', result.error.message);
      return;
    }

    setReviewModalVisible(false);
    setSelectedReviewItem(null);
    setShowRejectForm(false);
    setRejectionReason('');
    showToast('Payment proof rejected · Resident can resubmit.');
    await loadBillingData({ forceNetwork: true });
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
  const rentUnpaidPaise = Math.max(
    0,
    rentTotalBilledPaise - rentTotalCollectedPaise
  );

  const filteredRentList = rentBills.filter((r) => {
    if (activeResidentFilterId && r.resident_id !== activeResidentFilterId) {
      return false;
    }
    if (filterTab === 'REVIEW') {
      return r.has_pending_report && r.status !== 'paid';
    }
    if (filterTab === 'UNPAID') {
      return r.status === 'unpaid' || r.status === 'not_generated';
    }
    if (filterTab === 'PAID') return r.status === 'paid';
    return true;
  });

  // EB Metrics & Filtering
  const ebBilledResidents = ebBills.filter((r) => r.charge_id !== null);
  const ebTotalCount = ebBilledResidents.length;
  const ebPaidCount = ebBilledResidents.filter(
    (r) => r.status === 'paid'
  ).length;
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
    if (activeResidentFilterId && r.resident_id !== activeResidentFilterId) {
      return false;
    }
    if (filterTab === 'REVIEW') {
      return r.has_pending_report && r.status !== 'paid';
    }
    if (filterTab === 'UNPAID') return r.status === 'unpaid';
    if (filterTab === 'PAID') return r.status === 'paid';
    return true;
  });

  const filteredResidentName = useMemo(() => {
    if (!activeResidentFilterId) return '';
    const fromRent = rentBills.find(
      (r) => r.resident_id === activeResidentFilterId
    );
    if (fromRent) return fromRent.full_name;
    const fromEb = ebBills.find((e) => e.resident_id === activeResidentFilterId);
    if (fromEb) return fromEb.full_name;
    const fromAll = allResidents.find((r) => r.id === activeResidentFilterId);
    if (fromAll) return fromAll.full_name;
    return 'Resident';
  }, [activeResidentFilterId, rentBills, ebBills, allResidents]);

  const duplicatePhoneResidentIds = useMemo(() => {
    const byId = new Map<string, { id: string; phone_number?: string | null }>();
    for (const r of rentBills) {
      byId.set(r.resident_id, {
        id: r.resident_id,
        phone_number: r.phone_number,
      });
    }
    for (const e of ebBills) {
      if (!byId.has(e.resident_id)) {
        byId.set(e.resident_id, {
          id: e.resident_id,
          phone_number: e.phone_number,
        });
      }
    }
    return findDuplicatePhones(Array.from(byId.values()));
  }, [rentBills, ebBills]);

  const formatReminderMessage = (
    residentName: string,
    amountPaise: number,
    billLabel: string,
    dueDateIso?: string | null
  ) => {
    const dueInfo = formatDueStatus(dueDateIso);
    const amountText = formatPaiseToRupees(amountPaise);
    return `Hi ${residentName}, reminder from ${propertyName}: your ${billLabel} of ${amountText} is pending${
      dueInfo ? ` (${dueInfo.label})` : ''
    }. Please pay and upload proof in the PGwala app.`;
  };

  const handleSendReminder = async (
    residentName: string,
    phoneNumber: string | null | undefined,
    amountPaise: number,
    billLabel: string,
    dueDateIso?: string | null
  ): Promise<boolean> => {
    const message = formatReminderMessage(
      residentName,
      amountPaise,
      billLabel,
      dueDateIso
    );
    const url = buildWhatsAppReminderUrl(phoneNumber, message);
    if (!url) {
      Alert.alert(
        'Phone Number Missing',
        `${residentName} does not have a valid 10-digit phone number saved. Add it in Edit Resident to send WhatsApp reminders.`
      );
      return false;
    }
    try {
      await Linking.openURL(url);
      return true;
    } catch {
      Alert.alert(
        'WhatsApp Unavailable',
        'Could not open WhatsApp on this device.'
      );
      return false;
    }
  };

  const handleConfirmCombinedCashPayment = async (chargeIds: string[]) => {
    if (confirmingPayment || chargeIds.length === 0) return;

    setConfirmingPayment(true);
    const receipts: string[] = [];
    for (const chargeId of chargeIds) {
      const result = await confirmMonthlyPayment({
        chargeId,
        reportId: null,
        method: 'cash',
      });
      if (!result.ok) {
        setConfirmingPayment(false);
        Alert.alert('Confirmation Failed', result.error.message);
        await loadBillingData({ forceNetwork: true });
        return;
      }
      receipts.push(result.data.receipt_number);
    }
    setConfirmingPayment(false);

    showToast(
      `Payment confirmed · Receipt${receipts.length > 1 ? 's' : ''}: ${receipts.join(', ')}`
    );
    await loadBillingData({ forceNetwork: true });
  };

  // Active counts for current mode
  const combinedBills: CombinedBillItem[] = rentBills.map((rent) => {
    const eb = ebBills.find((e) => e.resident_id === rent.resident_id);
    const ebAmount = eb?.charge_id ? eb.amount_paise : 0;
    const rentAmount = rent.charge_id ? rent.total_paise : 0;
    const totalCombined = rentAmount + ebAmount;
    const paidCombined =
      (rent.status === 'paid' ? rentAmount : 0) +
      (eb?.status === 'paid' ? ebAmount : 0);
    const remainingCombined = Math.max(0, totalCombined - paidCombined);
    const hasPending =
      (rent.has_pending_report && rent.status !== 'paid') ||
      Boolean(eb?.has_pending_report && eb?.status !== 'paid');
    const isAllPaid = totalCombined > 0 && remainingCombined === 0;
    const earliestDue = rent.due_date || eb?.due_date || null;
    return {
      resident_id: rent.resident_id,
      full_name: rent.full_name,
      room_number: rent.room_number,
      phone_number: rent.phone_number,
      rent_paise: rent.charge_id ? rent.rent_paise : 0,
      wm_paise: rent.charge_id ? rent.wm_paise : 0,
      eb_paise: ebAmount,
      total_paise: totalCombined,
      paid_paise: paidCombined,
      remaining_paise: remainingCombined,
      has_pending_report: hasPending,
      is_all_paid: isAllPaid,
      due_date: earliestDue,
    };
  });

  const filteredCombinedList = combinedBills.filter((c) => {
    if (activeResidentFilterId && c.resident_id !== activeResidentFilterId) {
      return false;
    }
    if (filterTab === 'REVIEW') return c.has_pending_report && !c.is_all_paid;
    if (filterTab === 'UNPAID') return c.remaining_paise > 0;
    if (filterTab === 'PAID') return c.is_all_paid;
    return true;
  });

  const unpaidReminderTargets =
    billingMode === 'RENT'
      ? rentBills
          .filter(
            (r) =>
              r.status === 'unpaid' && !r.has_pending_report && r.total_paise > 0
          )
          .map((r) => ({
            residentId: r.resident_id,
            fullName: r.full_name,
            roomNumber: r.room_number,
            phoneNumber: r.phone_number,
            amountPaise: r.total_paise,
            billLabel: 'monthly rent',
            dueDateIso: r.due_date,
          }))
      : billingMode === 'EB'
        ? ebBilledResidents
            .filter(
              (r) =>
                r.status === 'unpaid' &&
                !r.has_pending_report &&
                r.amount_paise > 0
            )
            .map((r) => ({
              residentId: r.resident_id,
              fullName: r.full_name,
              roomNumber: r.room_number,
              phoneNumber: r.phone_number,
              amountPaise: r.amount_paise,
              billLabel: 'electricity share',
              dueDateIso: r.due_date,
            }))
        : combinedBills
            .filter((c) => c.remaining_paise > 0 && !c.has_pending_report)
            .map((c) => ({
              residentId: c.resident_id,
              fullName: c.full_name,
              roomNumber: c.room_number,
              phoneNumber: c.phone_number,
              amountPaise: c.remaining_paise,
              billLabel: 'combined PG bill (Rent + EB)',
              dueDateIso: c.due_date,
            }));

  const bulkContactIssueCount = unpaidReminderTargets.filter(
    (t) =>
      !buildWhatsAppReminderUrl(t.phoneNumber, 'x') ||
      duplicatePhoneResidentIds.has(t.residentId)
  ).length;

  const handleCopyAllReminders = async () => {
    if (unpaidReminderTargets.length === 0) return;
    const summaryText = unpaidReminderTargets
      .map((t, idx) => {
        const flags: string[] = [];
        if (!buildWhatsAppReminderUrl(t.phoneNumber, 'x')) {
          flags.push('Missing phone');
        }
        if (duplicatePhoneResidentIds.has(t.residentId)) {
          flags.push('Duplicate phone');
        }
        const flagSuffix = flags.length > 0 ? ` [${flags.join(', ')}]` : '';
        const msg = formatReminderMessage(
          t.fullName,
          t.amountPaise,
          t.billLabel,
          t.dueDateIso
        );
        return `${idx + 1}. ${t.fullName} (Room ${t.roomNumber})${flagSuffix}\n${msg}`;
      })
      .join('\n\n');

    const fullText = `${propertyName} — ${monthLabel} Payment Reminders\n\n${summaryText}`;

    if (
      Platform.OS === 'web' &&
      typeof navigator !== 'undefined' &&
      navigator.clipboard?.writeText
    ) {
      try {
        await navigator.clipboard.writeText(fullText);
        showToast('All unpaid payment reminders copied to clipboard.');
        return;
      } catch {
        // Fall through to Share
      }
    }

    try {
      await Share.share({
        title: `${propertyName} — ${monthLabel} Reminders`,
        message: fullText,
      });
    } catch {
      Alert.alert(
        'Copy Failed',
        'Could not share or copy reminder messages on this device.'
      );
    }
  };

  const currentTotalBilled =
    billingMode === 'RENT'
      ? rentTotalBilledPaise
      : billingMode === 'EB'
        ? ebTotalBilledPaise
        : rentTotalBilledPaise + ebTotalBilledPaise;
  const currentTotalCollected =
    billingMode === 'RENT'
      ? rentTotalCollectedPaise
      : billingMode === 'EB'
        ? ebTotalCollectedPaise
        : rentTotalCollectedPaise + ebTotalCollectedPaise;
  const currentUnpaidAmount =
    billingMode === 'RENT'
      ? rentUnpaidPaise
      : billingMode === 'EB'
        ? ebUnpaidPaise
        : rentUnpaidPaise + ebUnpaidPaise;
  const currentReviewCount =
    billingMode === 'RENT'
      ? rentReviewCount
      : billingMode === 'EB'
        ? ebReviewCount
        : combinedBills.filter((c) => c.has_pending_report && !c.is_all_paid)
          .length;
  const currentUnpaidCount =
    billingMode === 'RENT'
      ? rentUnpaidCount + rentUngeneratedCount
      : billingMode === 'EB'
        ? ebUnpaidCount
        : combinedBills.filter((c) => c.remaining_paise > 0).length;
  const currentPaidCount =
    billingMode === 'RENT'
      ? rentPaidCount
      : billingMode === 'EB'
        ? ebPaidCount
        : combinedBills.filter((c) => c.is_all_paid).length;
  const currentTotalCount =
    billingMode === 'RENT'
      ? rentTotalCount
      : billingMode === 'EB'
        ? ebTotalCount
        : combinedBills.length;

  const showMissingUpiBanner =
    Boolean(selectedProperty) &&
    !isValidUpiId(selectedProperty?.upi_id) &&
    dismissedUpiBannerPropertyId !== selectedProperty?.id;

  const rentByResidentId = useMemo(
    () => new Map(rentBills.map((r) => [r.resident_id, r])),
    [rentBills]
  );

  const ebByResidentId = useMemo(
    () => new Map(ebBills.map((e) => [e.resident_id, e])),
    [ebBills]
  );

  type ActiveBillingRow =
    | { mode: 'RENT'; item: ResidentRentBillItem }
    | { mode: 'EB'; item: ResidentEbBillItem }
    | { mode: 'COMBINED'; item: CombinedBillItem };

  const activeBillingRows: ActiveBillingRow[] = loading
    ? []
    : billingMode === 'RENT'
      ? filteredRentList.map((item) => ({ mode: 'RENT', item }))
      : billingMode === 'EB'
        ? filteredEbList.map((item) => ({ mode: 'EB', item }))
        : filteredCombinedList.map((item) => ({ mode: 'COMBINED', item }));

  const renderBillingHeader = () => (
    <>
      {showMissingUpiBanner && selectedProperty && (
        <View style={styles.upiPromptBanner}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add your UPI ID so residents can pay in one tap"
            style={({ pressed }) => [
              styles.upiPromptMain,
              pressed && styles.cardPressed,
            ]}
            onPress={() => router.push('/owner-properties')}>
            <View style={styles.upiPromptIconCircle}>
              <Info size={15} color={OwnerTheme.colors.primary} />
            </View>
            <Text style={styles.upiPromptText}>
              Add your UPI ID so residents can pay in one tap.{' '}
              <Text style={styles.upiPromptAction}>Set up ›</Text>
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss UPI setup banner"
            hitSlop={8}
            style={styles.upiPromptDismissBtn}
            onPress={() => setDismissedUpiBannerPropertyId(selectedProperty.id)}>
            <X size={15} color={OwnerTheme.colors.textSecondary} />
          </Pressable>
        </View>
      )}

      <BillingSummaryHeader
        billingMode={billingMode}
        onSelectBillingMode={setBillingMode}
        monthLabel={monthLabel}
        onPrevMonth={handlePrevMonth}
        onNextMonth={handleNextMonth}
        totalBilledPaise={currentTotalBilled}
        totalCollectedPaise={currentTotalCollected}
        unpaidAmountPaise={currentUnpaidAmount}
        totalCount={currentTotalCount}
        paidCount={currentPaidCount}
        unpaidCount={currentUnpaidCount}
        reviewCount={currentReviewCount}
        rentUngeneratedCount={rentUngeneratedCount}
        filterTab={filterTab}
        onSelectFilterTab={setFilterTab}
        onOpenGenerateRent={() => setGenerateRentModalVisible(true)}
        showGeneratedBanner={showBillsGeneratedBanner}
        onDismissGeneratedBanner={() => setShowBillsGeneratedBanner(false)}
      />

      {/* Resident Filter Banner */}
      {activeResidentFilterId && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Filtered to ${filteredResidentName}. Show all`}
          style={({ pressed }) => [
            styles.residentFilterBanner,
            pressed && styles.cardPressed,
          ]}
          onPress={handleClearResidentFilter}>
          <Text style={styles.residentFilterBannerText} numberOfLines={1}>
            Filtered to {filteredResidentName} ·{' '}
            <Text style={styles.residentFilterBannerAction}>Show all</Text>
          </Text>
          <X size={15} color={OwnerTheme.colors.primary} />
        </Pressable>
      )}

      {/* Bulk Remind All Unpaid Button */}
      {!loading &&
        unpaidReminderTargets.length > 0 &&
        (filterTab === 'ALL' || filterTab === 'UNPAID') && (
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.bulkRemindBar,
              pressed && styles.cardPressed,
            ]}
            onPress={() => {
              setSentReminderIds([]);
              setBulkReminderModalVisible(true);
            }}>
            <View style={styles.bulkRemindLeft}>
              <View style={styles.bulkRemindIconCircle}>
                <MessageCircle size={16} color={OwnerTheme.colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.bulkRemindTitle}>
                  Remind all unpaid ({unpaidReminderTargets.length})
                </Text>
                <Text style={styles.bulkRemindSub}>
                  {bulkContactIssueCount > 0
                    ? `${bulkContactIssueCount} contact issue${
                        bulkContactIssueCount > 1 ? 's' : ''
                      } flagged · tap to review & send`
                    : 'Send WhatsApp reminders or copy summary'}
                </Text>
              </View>
            </View>
            <Text style={styles.bulkRemindAction}>Open ›</Text>
          </Pressable>
        )}
    </>
  );

  const renderBillingEmpty = () => {
    if (loading) {
      return (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="small" color={OwnerTheme.colors.primary} />
          <Text style={styles.loadingText}>Loading bills...</Text>
        </View>
      );
    }
    if (billingMode === 'RENT') {
      return (
        <EmptyState
          title="No bills in this filter"
          description={
            filterTab === 'REVIEW'
              ? 'No rent payment proofs pending review.'
              : filterTab === 'UNPAID'
                ? 'All residents have paid their rent for this month!'
                : 'No resident rent records found for this period.'
          }
          actionLabel={activeResidentFilterId ? 'Show all' : undefined}
          onAction={
            activeResidentFilterId ? handleClearResidentFilter : undefined
          }
        />
      );
    }
    if (billingMode === 'EB') {
      return (
        <EmptyState
          title="No electricity bills"
          description={
            filterTab === 'ALL'
              ? 'No electricity bills split for this month yet. Tap "Split Room EB" above to allocate meter bills.'
              : 'No matching electricity bill records found.'
          }
          actionLabel={activeResidentFilterId ? 'Show all' : undefined}
          onAction={
            activeResidentFilterId ? handleClearResidentFilter : undefined
          }
        />
      );
    }
    return (
      <EmptyState
        title="No combined bills"
        description="No matching resident billing records found for this filter."
        actionLabel={activeResidentFilterId ? 'Show all' : undefined}
        onAction={
          activeResidentFilterId ? handleClearResidentFilter : undefined
        }
      />
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      {/* Standardized Header */}
      <OwnerHeader
        title="Billing"
        subtitle={propertyName}
        showBack
        rightAction={
          billingMode === 'EB' ? (
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
          ) : (
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.headerActionBtn,
                pressed && styles.cardPressed,
              ]}
              onPress={() => setGenerateRentModalVisible(true)}>
              <Edit3 size={15} color={OwnerTheme.colors.primary} />
              <Text style={styles.headerActionBtnText}>Set Rent</Text>
            </Pressable>
          )
        }
      />

      <FlatList
        data={activeBillingRows}
        keyExtractor={(row) => `${row.mode}:${row.item.resident_id}`}
        renderItem={({ item: row }) => {
          if (row.mode === 'RENT') {
            return (
              <ResidentLedgerCard
                mode="RENT"
                item={row.item}
                monthLabel={monthLabel}
                isDuplicatePhone={duplicatePhoneResidentIds.has(
                  row.item.resident_id
                )}
                onOpenProfile={handleOpenResidentProfile}
                onEditRent={handleOpenEditRent}
                onToggleWashingMachine={(item) =>
                  void handleToggleWashingMachine(item)
                }
                onReviewProof={(item) => void openReviewModal(item)}
                onConfirmCashPayment={(chargeId) =>
                  void handleConfirmPayment(chargeId, null, 'cash')
                }
                onSendReminder={(name, phone, amount, label, due) =>
                  void handleSendReminder(name, phone, amount, label, due)
                }
              />
            );
          }
          if (row.mode === 'EB') {
            return (
              <ResidentLedgerCard
                mode="EB"
                item={row.item}
                monthLabel={monthLabel}
                isDuplicatePhone={duplicatePhoneResidentIds.has(
                  row.item.resident_id
                )}
                onOpenProfile={handleOpenResidentProfile}
                onReviewProof={(item) => void openReviewModal(item)}
                onConfirmCashPayment={(chargeId) =>
                  void handleConfirmPayment(chargeId, null, 'cash')
                }
                onSendReminder={(name, phone, amount, label, due) =>
                  void handleSendReminder(name, phone, amount, label, due)
                }
              />
            );
          }
          const rentMatch = rentByResidentId.get(row.item.resident_id);
          const ebMatch = ebByResidentId.get(row.item.resident_id);
          const unpaidChargeIds: string[] = [];
          if (rentMatch?.charge_id && rentMatch.status === 'unpaid') {
            unpaidChargeIds.push(rentMatch.charge_id);
          }
          if (ebMatch?.charge_id && ebMatch.status === 'unpaid') {
            unpaidChargeIds.push(ebMatch.charge_id);
          }
          return (
            <ResidentLedgerCard
              mode="COMBINED"
              item={row.item}
              isDuplicatePhone={duplicatePhoneResidentIds.has(
                row.item.resident_id
              )}
              unpaidChargeIds={unpaidChargeIds}
              onOpenProfile={handleOpenResidentProfile}
              onConfirmCashPayment={(chargeIds) =>
                void handleConfirmCombinedCashPayment(chargeIds)
              }
              onSendReminder={(name, phone, amount, label, due) =>
                void handleSendReminder(name, phone, amount, label, due)
              }
            />
          );
        }}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListHeaderComponent={renderBillingHeader}
        ListEmptyComponent={renderBillingEmpty}
        ListFooterComponent={<View style={{ height: 40 }} />}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        removeClippedSubviews={Platform.OS === 'android'}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={[OwnerTheme.colors.primary]}
          />
        }
      />

      {/* Modal 1: Generate / Update Rent Amount */}
      <ChargeFormModal
        mode="generate-rent"
        visible={generateRentModalVisible}
        monthLabel={monthLabel}
        rentInputRupees={rentInputRupees}
        onChangeRentInputRupees={setRentInputRupees}
        submitting={generatingRent}
        onClose={() => setGenerateRentModalVisible(false)}
        onConfirm={() => void handleConfirmGenerateRent()}
      />

      {/* Modal 1B: Edit Individual Resident Rent */}
      <ChargeFormModal
        mode="edit-rent"
        visible={editRentModalVisible}
        monthLabel={monthLabel}
        resident={selectedResidentForEdit}
        rentInputRupees={editRentInputRupees}
        onChangeRentInputRupees={setEditRentInputRupees}
        submitting={updatingRent}
        onClose={() => setEditRentModalVisible(false)}
        onConfirm={() => void handleConfirmEditRent()}
      />

      {/* Modal 2: Split Room EB Bill */}
      <ChargeFormModal
        mode="split-eb"
        visible={splitEbModalVisible}
        availableRooms={availableRooms}
        selectedRoom={selectedRoomForEb}
        onSelectRoom={setSelectedRoomForEb}
        ebTotalRupeesInput={ebTotalRupeesInput}
        onChangeEbTotalRupeesInput={setEbTotalRupeesInput}
        allResidents={allResidents}
        submitting={generatingEb}
        onClose={() => setSplitEbModalVisible(false)}
        onConfirm={() => void handleConfirmSplitEb()}
      />

      {/* Modal 3: Review Payment Proof & Full-Screen Viewer */}
      <PaymentReportReviewModal
        visible={reviewModalVisible}
        item={selectedReviewItem}
        signedUrl={reviewSignedUrl}
        loadingSignedUrl={loadingReviewUrl}
        showRejectForm={showRejectForm}
        rejectionReason={rejectionReason}
        confirmingPayment={confirmingPayment}
        rejectingPayment={rejectingPayment}
        onClose={() => {
          setReviewModalVisible(false);
          setShowRejectForm(false);
          setRejectionReason('');
        }}
        onToggleRejectForm={setShowRejectForm}
        onChangeRejectionReason={setRejectionReason}
        onConfirmPayment={(chargeId, reportId, method) =>
          void handleConfirmPayment(chargeId, reportId, method)
        }
        onRejectPayment={() => void handleRejectPayment()}
      />

      {/* Modal 4: Bulk Reminder Modal */}
      <Modal
        visible={bulkReminderModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setBulkReminderModalVisible(false)}>
        <View style={styles.bulkModalOverlay}>
          <Pressable
            style={styles.bulkModalBackdrop}
            onPress={() => setBulkReminderModalVisible(false)}
          />
          <View style={styles.bulkModalCard}>
            <View style={styles.bulkModalHandle} />
            <View style={styles.bulkModalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.bulkModalTitle}>Bulk Payment Reminders</Text>
                <Text style={styles.bulkModalSub}>
                  {unpaidReminderTargets.length} unpaid resident
                  {unpaidReminderTargets.length === 1 ? '' : 's'} · {monthLabel}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close reminders modal"
                hitSlop={8}
                onPress={() => setBulkReminderModalVisible(false)}>
                <X size={20} color={OwnerTheme.colors.textSecondary} />
              </Pressable>
            </View>

            {bulkContactIssueCount > 0 && (
              <View style={styles.bulkWarningBanner}>
                <AlertTriangle size={15} color="#B45309" />
                <Text style={styles.bulkWarningText}>
                  {bulkContactIssueCount} resident
                  {bulkContactIssueCount > 1 ? 's have' : ' has'} a missing or
                  duplicate phone number. Review before sending.
                </Text>
              </View>
            )}

            <ScrollView
              style={styles.bulkListScroll}
              showsVerticalScrollIndicator={false}>
              {unpaidReminderTargets.map((target) => {
                const isMissingPhone = !buildWhatsAppReminderUrl(
                  target.phoneNumber,
                  'x'
                );
                const isDuplicatePhone = duplicatePhoneResidentIds.has(
                  target.residentId
                );
                const isSent = sentReminderIds.includes(target.residentId);

                return (
                  <View key={target.residentId} style={styles.bulkRow}>
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <Text style={styles.bulkRowName}>
                        {target.fullName}{' '}
                        <Text style={styles.bulkRowRoom}>
                          · Room {target.roomNumber}
                        </Text>
                      </Text>
                      <Text style={styles.bulkRowMeta}>
                        {formatPaiseToRupees(target.amountPaise)}
                        {target.phoneNumber
                          ? ` · ${target.phoneNumber}`
                          : ' · No phone saved'}
                      </Text>
                      {(isMissingPhone || isDuplicatePhone) && (
                        <View style={styles.bulkFlagsRow}>
                          {isMissingPhone && (
                            <View style={styles.missingPhoneFlag}>
                              <Text style={styles.missingPhoneFlagText}>
                                Missing phone
                              </Text>
                            </View>
                          )}
                          {isDuplicatePhone && (
                            <View style={styles.duplicatePhoneFlag}>
                              <AlertTriangle size={10} color="#92400E" />
                              <Text style={styles.duplicatePhoneFlagText}>
                                Duplicate phone
                              </Text>
                            </View>
                          )}
                        </View>
                      )}
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      disabled={isMissingPhone}
                      style={[
                        styles.bulkSendBtn,
                        isMissingPhone && styles.bulkSendBtnDisabled,
                        isSent && !isMissingPhone && styles.bulkSendBtnSent,
                      ]}
                      onPress={() => {
                        void handleSendReminder(
                          target.fullName,
                          target.phoneNumber,
                          target.amountPaise,
                          target.billLabel,
                          target.dueDateIso
                        ).then((opened) => {
                          if (opened && mountedRef.current) {
                            setSentReminderIds((prev) =>
                              prev.includes(target.residentId)
                                ? prev
                                : [...prev, target.residentId]
                            );
                          }
                        });
                      }}>
                      {isSent && !isMissingPhone ? (
                        <Check size={13} color={OwnerTheme.colors.success} />
                      ) : (
                        <MessageCircle
                          size={13}
                          color={
                            isMissingPhone
                              ? OwnerTheme.colors.textMuted
                              : OwnerTheme.colors.primary
                          }
                        />
                      )}
                      <Text
                        style={[
                          styles.bulkSendBtnText,
                          isMissingPhone && styles.bulkSendBtnTextDisabled,
                          isSent && !isMissingPhone && styles.bulkSendBtnTextSent,
                        ]}>
                        {isMissingPhone
                          ? 'No phone'
                          : isSent
                            ? 'Sent'
                            : 'Send'}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </ScrollView>

            <View style={styles.bulkModalFooter}>
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.copyAllBtn,
                  pressed && styles.cardPressed,
                ]}
                onPress={() => void handleCopyAllReminders()}>
                <Copy size={16} color="#FFFFFF" />
                <Text style={styles.copyAllBtnText}>Copy all reminders</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <RoleBottomNav activeTab="bill" roleOverride="owner" />
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
  upiPromptBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: OwnerTheme.colors.primaryLight,
    borderWidth: 1,
    borderColor: '#BAE6FD',
    borderRadius: OwnerTheme.radius.sm,
    paddingLeft: 10,
    paddingRight: 6,
    paddingVertical: 7,
    marginBottom: 8,
    gap: 6,
  },
  upiPromptMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  upiPromptIconCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  upiPromptText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '500',
    color: OwnerTheme.colors.textPrimary,
    lineHeight: 16,
  },
  upiPromptAction: {
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  upiPromptDismissBtn: {
    padding: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  residentFilterBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    backgroundColor: OwnerTheme.colors.primaryLight,
    borderWidth: 1,
    borderColor: '#BAE6FD',
    borderRadius: OwnerTheme.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 12,
  },
  residentFilterBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: OwnerTheme.colors.textPrimary,
  },
  residentFilterBannerAction: {
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  bulkRemindBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.md,
    borderWidth: 1,
    borderColor: '#BAE6FD',
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  bulkRemindLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    paddingRight: 8,
  },
  bulkRemindIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: OwnerTheme.colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bulkRemindTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  bulkRemindSub: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 1,
  },
  bulkRemindAction: {
    fontSize: 13,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  cardsList: {
    gap: 12,
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
  // Bulk Reminder Modal
  bulkModalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  bulkModalBackdrop: {
    flex: 1,
  },
  bulkModalCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 24,
    maxHeight: '82%',
    ...OwnerTheme.shadowElevated,
  },
  bulkModalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
    marginBottom: 12,
  },
  bulkModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  bulkModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  bulkModalSub: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 2,
  },
  bulkWarningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: OwnerTheme.radius.sm,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 10,
  },
  bulkWarningText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '500',
    color: '#92400E',
    lineHeight: 16,
  },
  bulkListScroll: {
    maxHeight: 340,
  },
  bulkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: OwnerTheme.colors.borderLight,
  },
  bulkRowName: {
    fontSize: 14,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  bulkRowRoom: {
    fontSize: 12,
    fontWeight: '500',
    color: OwnerTheme.colors.textSecondary,
  },
  bulkRowMeta: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 2,
  },
  bulkFlagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 5,
  },
  missingPhoneFlag: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: OwnerTheme.radius.full,
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  missingPhoneFlagText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#B91C1C',
  },
  duplicatePhoneFlag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: OwnerTheme.radius.full,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  duplicatePhoneFlagText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#92400E',
  },
  bulkSendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: OwnerTheme.radius.md,
    backgroundColor: OwnerTheme.colors.primaryLight,
  },
  bulkSendBtnDisabled: {
    backgroundColor: '#F1F5F9',
  },
  bulkSendBtnSent: {
    backgroundColor: OwnerTheme.colors.successLight,
  },
  bulkSendBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  bulkSendBtnTextDisabled: {
    color: OwnerTheme.colors.textMuted,
  },
  bulkSendBtnTextSent: {
    color: OwnerTheme.colors.success,
  },
  bulkModalFooter: {
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: OwnerTheme.colors.borderLight,
  },
  copyAllBtn: {
    height: 46,
    borderRadius: OwnerTheme.radius.md,
    backgroundColor: OwnerTheme.colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  copyAllBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
