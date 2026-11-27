import { Href, router, useLocalSearchParams } from 'expo-router';
import {
  Edit3,
  Info,
  MessageCircle,
  Plus,
  Share2,
  X,
  Zap,
} from 'lucide-react-native';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BillingSummaryHeader } from '@/components/billing/BillingSummaryHeader';
import { BulkReminderModal } from '@/components/billing/BulkReminderModal';
import { ChargeFormModal } from '@/components/billing/ChargeFormModal';
import { ExpensesSection } from '@/components/billing/ExpensesSection';
import {
  PartialPaymentModal,
  PartialPaymentTarget,
} from '@/components/billing/PartialPaymentModal';
import {
  ReverseBillModal,
  ReverseBillTarget,
} from '@/components/billing/ReverseBillModal';
import { PaymentReportReviewModal } from '@/components/billing/PaymentReportReviewModal';
import { ResidentLedgerCard } from '@/components/billing/ResidentLedgerCard';
import { RoleBottomNav } from '@/components/ui/bottom-nav';
import { BillingSkeleton, EmptyState, OwnerHeader } from '@/components/ui/owner';
import { FloatingActionPill } from '@/components/ui/floating-action-pill';
import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useProperty } from '@/context/property-context';
import { useToast } from '@/context/toast-context';
import {
  useAddPropertyExpenseMutation,
  useDeletePropertyExpenseMutation,
  usePropertyExpensesQuery,
} from '@/hooks/use-expenses';
import {
  useAllocateEbBillMutation,
  useCancelUnpaidChargeMutation,
  useConfirmMonthlyPaymentMutation,
  useGenerateMonthlyBillsMutation,
  useOwnerBillingQuery,
  useRecordPartialPaymentMutation,
  useRejectPaymentReportMutation,
  useReverseChargePaymentsMutation,
  useToggleWmBillingMutation,
  useUpdateResidentRentMutation,
} from '@/hooks/use-owner-billing';
import {
  consumePendingBillingMode,
  subscribeBillingModeRequests,
} from '@/lib/billing-nav';
import {
  buildMonthlyRentCsv,
  buildMonthlyRentSummaryText,
  buildWhatsAppReminderUrl,
  formatDueStatus,
  formatPaiseToRupees,
} from '@/lib/billing-utils';
import { isValidUpiId } from '@/lib/upi';
import { findDuplicatePhones } from '@/lib/ux-utils';
import {
  BillingFilterTab,
  BillingMode,
  CombinedBillItem,
  PaymentMethod,
  ResidentEbBillItem,
  ResidentRentBillItem,
  resolvePaymentProofUrl,
  ReviewPaymentItem,
} from '@/services/billing.service';

export default function SimplifiedBillingManagementScreen() {
  const { user } = useAuth();
  const { selectedProperty, selectedPropertyId } = useProperty();
  const { showToast } = useToast();
  const params = useLocalSearchParams<{
    residentId?: string | string[];
    mode?: string | string[];
  }>();
  const rawParamMode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const paramMode: BillingMode | null =
    rawParamMode === 'RENT' ||
    rawParamMode === 'EB' ||
    rawParamMode === 'COMBINED' ||
    rawParamMode === 'EXPENSES'
      ? rawParamMode
      : null;
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

  const [manualRefreshing, setManualRefreshing] = useState(false);

  // Top Section Mode: 'RENT' | 'EB' | 'COMBINED' | 'EXPENSES'
  const [billingMode, setBillingMode] = useState<BillingMode>(
    () => paramMode ?? consumePendingBillingMode() ?? 'RENT'
  );

  useEffect(() => {
    const unsubscribe = subscribeBillingModeRequests((nextMode) => {
      consumePendingBillingMode();
      setBillingMode(nextMode);
    });
    return unsubscribe;
  }, []);

  // Month navigation: default to current month
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  // Rent Bills Modals State
  const [generateRentModalVisible, setGenerateRentModalVisible] =
    useState(false);
  const [rentInputRupees, setRentInputRupees] = useState('6000');
  const [onlyFillMissingRent, setOnlyFillMissingRent] = useState(true);

  // Edit Individual Resident Rent State
  const [editRentModalVisible, setEditRentModalVisible] = useState(false);
  const [selectedResidentForEdit, setSelectedResidentForEdit] =
    useState<ResidentRentBillItem | null>(null);
  const [editRentInputRupees, setEditRentInputRupees] = useState('8000');

  // EB Bills Modals State
  const [splitEbModalVisible, setSplitEbModalVisible] = useState(false);
  const [expenseModalVisible, setExpenseModalVisible] = useState(false);
  const [selectedRoomForEbState, setSelectedRoomForEb] = useState<string>('');
  const [ebTotalRupeesInput, setEbTotalRupeesInput] = useState('');

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
  const [reviewSignedUrl, setReviewSignedUrl] = useState<string | null>(null);
  const [loadingReviewUrl, setLoadingReviewUrl] = useState(false);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');

  const [partialPaymentTarget, setPartialPaymentTarget] =
    useState<PartialPaymentTarget | null>(null);

  const mountedRef = useRef(true);
  const lastErrorAtRef = useRef(0);

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

  const billingQuery = useOwnerBillingQuery({
    userId: userId ?? '',
    selectedPropertyId: activeSelectedPropertyId,
    selectedPropertyName: activeSelectedPropertyName,
    monthIsoStart,
  });

  const generateBillsMutation = useGenerateMonthlyBillsMutation();
  const updateRentMutation = useUpdateResidentRentMutation();
  const allocateEbMutation = useAllocateEbBillMutation();
  const reversePaymentsMutation = useReverseChargePaymentsMutation();
  const cancelChargeMutation = useCancelUnpaidChargeMutation();
  const [reverseBillTarget, setReverseBillTarget] =
    useState<ReverseBillTarget | null>(null);
  const toggleWmMutation = useToggleWmBillingMutation();
  const confirmPaymentMutation = useConfirmMonthlyPaymentMutation();
  const recordPartialMutation = useRecordPartialPaymentMutation();
  const rejectPaymentMutation = useRejectPaymentReportMutation();

  const snapshot = billingQuery.data;
  const loading = billingQuery.isPending && !snapshot;
  const refreshing = manualRefreshing;
  const propertyId = snapshot?.propertyId ?? activeSelectedPropertyId ?? null;

  const expensesQuery = usePropertyExpensesQuery({
    propertyId,
    monthIsoStart,
    monthIsoEnd,
    enabled: billingMode === 'EXPENSES',
  });
  const addExpenseMutation = useAddPropertyExpenseMutation();
  const deleteExpenseMutation = useDeletePropertyExpenseMutation();
  const propertyName =
    snapshot?.propertyName ?? activeSelectedPropertyName ?? 'My PG';
  const rentBills = useMemo(
    () => snapshot?.rentBills ?? [],
    [snapshot?.rentBills]
  );
  const ebBills = useMemo(() => snapshot?.ebBills ?? [], [snapshot?.ebBills]);
  const allResidents = useMemo(
    () => snapshot?.allResidents ?? [],
    [snapshot?.allResidents]
  );
  const availableRooms = useMemo(
    () => snapshot?.availableRooms ?? [],
    [snapshot?.availableRooms]
  );
  const selectedRoomForEb =
    selectedRoomForEbState && availableRooms.includes(selectedRoomForEbState)
      ? selectedRoomForEbState
      : (availableRooms[0] ?? '');

  const generatingRent = generateBillsMutation.isPending;
  const updatingRent = updateRentMutation.isPending;
  const generatingEb = allocateEbMutation.isPending;
  const confirmingPayment = confirmPaymentMutation.isPending;
  const rejectingPayment = rejectPaymentMutation.isPending;

  useEffect(() => {
    if (
      billingQuery.isError &&
      billingQuery.errorUpdatedAt > lastErrorAtRef.current &&
      (!snapshot || manualRefreshing)
    ) {
      lastErrorAtRef.current = billingQuery.errorUpdatedAt;
      Alert.alert('Load Error', billingQuery.error.message);
    }
  }, [
    billingQuery.isError,
    billingQuery.error,
    billingQuery.errorUpdatedAt,
    snapshot,
    manualRefreshing,
  ]);

  const handleRefresh = async () => {
    setManualRefreshing(true);
    try {
      await billingQuery.refetch();
    } finally {
      setManualRefreshing(false);
    }
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

  // Derived safe-billing helpers
  const defaultRentRupees = useMemo(() => {
    const counts = new Map<number, number>();
    for (const r of rentBills) {
      const paise = r.rent_paise > 0 ? r.rent_paise : r.monthly_rent_paise;
      if (paise > 0) {
        counts.set(paise, (counts.get(paise) || 0) + 1);
      }
    }
    let bestPaise = 0;
    let bestCount = 0;
    for (const [paise, count] of counts.entries()) {
      if (count > bestCount) {
        bestPaise = paise;
        bestCount = count;
      }
    }
    return bestPaise > 0 ? String(Math.round(bestPaise / 100)) : '6000';
  }, [rentBills]);

  const missingRentResidents = useMemo(
    () =>
      rentBills.filter(
        (r) =>
          r.status === 'not_generated' ||
          (r.status === 'unpaid' && r.rent_paise <= 0)
      ),
    [rentBills]
  );

  const unpaidExistingRentCount = useMemo(
    () =>
      rentBills.filter((r) => r.status === 'unpaid' && r.rent_paise > 0).length,
    [rentBills]
  );

  const existingEbRooms = useMemo(
    () =>
      Array.from(
        new Set(
          ebBills
            .filter((e) => e.status !== 'not_generated' && e.amount_paise > 0)
            .map((e) => e.room_number)
        )
      ),
    [ebBills]
  );

  const handleOpenGenerateRent = () => {
    setRentInputRupees(defaultRentRupees);
    setOnlyFillMissingRent(true);
    setGenerateRentModalVisible(true);
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
    try {
      // Safe mode: when preserving existing custom unpaid rents, only update ₹0/unbilled residents
      if (onlyFillMissingRent && unpaidExistingRentCount > 0) {
        if (missingRentResidents.length === 0) {
          setGenerateRentModalVisible(false);
          return;
        }
        for (const res of missingRentResidents) {
          await updateRentMutation.mutateAsync({
            propertyId,
            residentId: res.resident_id,
            rentPaise,
            monthIsoStart,
          });
        }
        setGenerateRentModalVisible(false);
        showToast(
          `Set rent to ₹${parsedRupees.toLocaleString('en-IN')} for ${
            missingRentResidents.length
          } resident${missingRentResidents.length > 1 ? 's' : ''}. Existing custom rents preserved.`
        );
        if (mountedRef.current) {
          setShowBillsGeneratedBanner(true);
        }
        return;
      }

      const data = await generateBillsMutation.mutateAsync({
        propertyId,
        monthIsoStart,
        rentPaise,
      });

      setGenerateRentModalVisible(false);
      const { created_count: created, updated_count: updated, skipped_count: skipped } =
        data;
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
      if (mountedRef.current) {
        setShowBillsGeneratedBanner(true);
      }
    } catch (err) {
      Alert.alert(
        'Generation Failed',
        err instanceof Error ? err.message : 'Could not generate bills.'
      );
    }
  };

  // Open Edit Rent Modal for a single resident
  const handleOpenEditRent = (res: ResidentRentBillItem) => {
    setSelectedResidentForEdit(res);
    setEditRentInputRupees((res.rent_paise / 100).toString());
    setEditRentModalVisible(true);
  };

  // Confirm Individual Rent Update (optimistic + rollback on error)
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
    const residentName = selectedResidentForEdit.full_name;
    const residentId = selectedResidentForEdit.resident_id;
    setEditRentModalVisible(false);
    setSelectedResidentForEdit(null);

    try {
      await updateRentMutation.mutateAsync({
        propertyId,
        residentId,
        rentPaise,
        monthIsoStart,
      });

      showToast(
        `Monthly rent for ${residentName} set to ₹${parsedRupees.toLocaleString(
          'en-IN'
        )}.`
      );
    } catch (err) {
      Alert.alert(
        'Update Failed',
        err instanceof Error ? err.message : 'Could not update rent.'
      );
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
    const targetRoom = selectedRoomForEb;

    try {
      await allocateEbMutation.mutateAsync({
        propertyId,
        roomNumber: targetRoom,
        monthIsoStart,
        monthIsoEnd,
        dueIsoDate,
        totalPaise,
        residentIds,
        notes: `${monthLabel} Room ${targetRoom} Electricity Bill`,
      });

      setSplitEbModalVisible(false);
      setEbTotalRupeesInput('');
      showToast(
        `Split ₹${parsedRupees.toLocaleString('en-IN')} EB across ${roomResidents.length
        } resident${roomResidents.length > 1 ? 's' : ''} in Room ${targetRoom}.`
      );
    } catch (err) {
      Alert.alert(
        'EB Split Failed',
        err instanceof Error ? err.message : 'Could not allocate EB bill.'
      );
    }
  };

  // Toggle Washing Machine opt-in (optimistic + rollback on error)
  const handleToggleWashingMachine = async (resident: ResidentRentBillItem) => {
    if (!propertyId) return;
    const nextVal = !resident.opt_in_wm;
    try {
      await toggleWmMutation.mutateAsync({
        propertyId,
        residentId: resident.resident_id,
        isEnabled: nextVal,
        monthIsoStart,
      });
    } catch (err) {
      Alert.alert(
        'Update Error',
        err instanceof Error ? err.message : 'Could not update washing machine billing.'
      );
    }
  };

  // Confirm payment (pending state, no optimistic Paid)
  const handleConfirmPayment = async (
    chargeId: string,
    reportId?: string | null,
    method: PaymentMethod = 'upi'
  ) => {
    if (confirmingPayment) return;

    try {
      const data = await confirmPaymentMutation.mutateAsync({
        chargeId,
        reportId,
        method,
      });

      setReviewModalVisible(false);
      setSelectedReviewItem(null);
      showToast(`Payment confirmed · Receipt ${data.receipt_number}`);
    } catch (err) {
      Alert.alert(
        'Confirmation Failed',
        err instanceof Error ? err.message : 'Could not confirm payment.'
      );
    }
  };

  // Reject payment proof with reason (pending state)
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

    try {
      await rejectPaymentMutation.mutateAsync({
        reportId: selectedReviewItem.report.id,
        rejectionReason: trimmedReason,
      });

      setReviewModalVisible(false);
      setSelectedReviewItem(null);
      setShowRejectForm(false);
      setRejectionReason('');
      showToast('Payment proof rejected · Resident can resubmit.');
    } catch (err) {
      Alert.alert(
        'Rejection Failed',
        err instanceof Error ? err.message : 'Could not reject payment proof.'
      );
    }
  };

  // RENT Metrics & Filtering
  const rentTotalCount = rentBills.length;
  // Rent Metrics & Filtering (memoized so modal toggles / keystrokes don't re-scan)
  const {
    rentPaidCount,
    rentReviewCount,
    rentUnpaidCount,
    rentUngeneratedCount,
    rentTotalBilledPaise,
    rentTotalCollectedPaise,
    rentUnpaidPaise,
  } = useMemo(() => {
    let paid = 0;
    let review = 0;
    let unpaid = 0;
    let ungenerated = 0;
    let billedPaise = 0;
    let collectedPaise = 0;

    for (const r of rentBills) {
      if (r.status === 'paid') paid += 1;
      else if (r.status === 'unpaid') unpaid += 1;
      else if (r.status === 'not_generated') ungenerated += 1;
      if (r.has_pending_report && r.status !== 'paid') review += 1;
      if (r.charge_id) billedPaise += r.total_paise;
      collectedPaise += r.paid_paise ?? (r.status === 'paid' ? r.total_paise : 0);
    }

    return {
      rentPaidCount: paid,
      rentReviewCount: review,
      rentUnpaidCount: unpaid,
      rentUngeneratedCount: ungenerated,
      rentTotalBilledPaise: billedPaise,
      rentTotalCollectedPaise: collectedPaise,
      rentUnpaidPaise: Math.max(0, billedPaise - collectedPaise),
    };
  }, [rentBills]);

  const filteredRentList = useMemo(
    () =>
      rentBills.filter((r) => {
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
      }),
    [rentBills, activeResidentFilterId, filterTab]
  );

  // EB Metrics & Filtering (memoized)
  const {
    ebBilledResidents,
    ebTotalCount,
    ebPaidCount,
    ebReviewCount,
    ebUnpaidCount,
    ebTotalBilledPaise,
    ebTotalCollectedPaise,
    ebUnpaidPaise,
  } = useMemo(() => {
    const billed: ResidentEbBillItem[] = [];
    let paid = 0;
    let review = 0;
    let unpaid = 0;
    let billedPaise = 0;
    let collectedPaise = 0;

    for (const r of ebBills) {
      if (r.charge_id === null) continue;
      billed.push(r);
      if (r.status === 'paid') paid += 1;
      else if (r.status === 'unpaid') unpaid += 1;
      if (r.has_pending_report && r.status !== 'paid') review += 1;
      billedPaise += r.amount_paise;
      collectedPaise += r.paid_paise ?? (r.status === 'paid' ? r.amount_paise : 0);
    }

    return {
      ebBilledResidents: billed,
      ebTotalCount: billed.length,
      ebPaidCount: paid,
      ebReviewCount: review,
      ebUnpaidCount: unpaid,
      ebTotalBilledPaise: billedPaise,
      ebTotalCollectedPaise: collectedPaise,
      ebUnpaidPaise: Math.max(0, billedPaise - collectedPaise),
    };
  }, [ebBills]);

  const filteredEbList = useMemo(
    () =>
      ebBilledResidents.filter((r) => {
        if (activeResidentFilterId && r.resident_id !== activeResidentFilterId) {
          return false;
        }
        if (filterTab === 'REVIEW') {
          return r.has_pending_report && r.status !== 'paid';
        }
        if (filterTab === 'UNPAID') return r.status === 'unpaid';
        if (filterTab === 'PAID') return r.status === 'paid';
        return true;
      }),
    [ebBilledResidents, activeResidentFilterId, filterTab]
  );

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

    const receipts: string[] = [];
    for (const chargeId of chargeIds) {
      try {
        const data = await confirmPaymentMutation.mutateAsync({
          chargeId,
          reportId: null,
          method: 'cash',
        });
        receipts.push(data.receipt_number);
      } catch (err) {
        Alert.alert(
          'Confirmation Failed',
          err instanceof Error ? err.message : 'Could not confirm payment.'
        );
        return;
      }
    }

    showToast(
      `Payment confirmed · Receipt${receipts.length > 1 ? 's' : ''}: ${receipts.join(', ')}`
    );
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

  const BILLING_PAGE_SIZE = 30;
  const [visibleCount, setVisibleCount] = useState(BILLING_PAGE_SIZE);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisibleCount(BILLING_PAGE_SIZE);
    }, 0);
    return () => clearTimeout(timer);
  }, [billingMode, filterTab, selectedDate, activeResidentFilterId]);

  const activeBillingRows: ActiveBillingRow[] =
    loading || billingMode === 'EXPENSES'
      ? []
      : billingMode === 'RENT'
        ? filteredRentList.map((item) => ({ mode: 'RENT', item }))
        : billingMode === 'EB'
          ? filteredEbList.map((item) => ({ mode: 'EB', item }))
          : filteredCombinedList.map((item) => ({ mode: 'COMBINED', item }));

  const pagedBillingRows = activeBillingRows.slice(0, visibleCount);
  const hasMoreBillingRows = pagedBillingRows.length < activeBillingRows.length;

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
        onOpenGenerateRent={handleOpenGenerateRent}
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
        billingMode !== 'EXPENSES' &&
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
    if (billingMode === 'EXPENSES') {
      return (
        <ExpensesSection
          monthLabel={monthLabel}
          totalCollectedPaise={rentTotalCollectedPaise + ebTotalCollectedPaise}
          expenses={expensesQuery.data ?? []}
          loading={expensesQuery.isPending && !expensesQuery.data}
          saving={addExpenseMutation.isPending}
          addModalVisible={expenseModalVisible}
          onOpenAddModal={() => setExpenseModalVisible(true)}
          onCloseAddModal={() => setExpenseModalVisible(false)}
          onAddExpense={async ({ category, amountPaise, notes }) => {
            if (!propertyId) return;
            const todayIso = new Date().toISOString().slice(0, 10);
            const expenseDate =
              todayIso >= monthIsoStart && todayIso <= monthIsoEnd
                ? todayIso
                : monthIsoStart;
            try {
              await addExpenseMutation.mutateAsync({
                propertyId,
                category,
                amountPaise,
                expenseDate,
                notes,
                createdBy: userId ?? null,
              });
              showToast(`Saved ${formatPaiseToRupees(amountPaise)} expense`);
            } catch (err) {
              Alert.alert(
                'Save Failed',
                err instanceof Error ? err.message : 'Could not save expense.'
              );
            }
          }}
          onDeleteExpense={(expenseId) => {
            void deleteExpenseMutation
              .mutateAsync(expenseId)
              .then(() => showToast('Expense deleted'))
              .catch((err) =>
                Alert.alert(
                  'Delete Failed',
                  err instanceof Error ? err.message : 'Could not delete expense.'
                )
              );
          }}
        />
      );
    }
    if (loading) {
      return <BillingSkeleton />;
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

  const handleExportMonthlyReport = () => {
    if (rentBills.length === 0) {
      Alert.alert(
        'Nothing to Export',
        `No rent bills found for ${monthLabel}.`
      );
      return;
    }

    const shareText = async (content: string, title: string) => {
      try {
        await Share.share({ message: content, title });
      } catch {
        Alert.alert('Share Unavailable', 'Could not open share sheet on this device.');
      }
    };

    Alert.alert(
      `Export Rent Report (${monthLabel})`,
      `Choose a format to share for ${propertyName}:`,
      [
        {
          text: 'WhatsApp Summary',
          onPress: () =>
            void shareText(
              buildMonthlyRentSummaryText({ propertyName, monthLabel, rentBills }),
              `${propertyName} Rent Report (${monthLabel})`
            ),
        },
        {
          text: 'CSV Spreadsheet',
          onPress: () =>
            void shareText(
              buildMonthlyRentCsv({ propertyName, monthLabel, rentBills }),
              `${propertyName} Rent CSV (${monthLabel})`
            ),
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const billingKeyExtractor = useCallback(
    (row: { mode: string; item: { resident_id: string } }) =>
      `${row.mode}:${row.item.resident_id}`,
    []
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      {/* Standardized Header */}
      <OwnerHeader
        title="Billing"
        subtitle={propertyName}
        showBack
        rightAction={
          rentBills.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Export monthly rent report"
              style={({ pressed }) => [
                styles.headerActionBtn,
                pressed && styles.cardPressed,
              ]}
              onPress={handleExportMonthlyReport}>
              <Share2 size={14} color={OwnerTheme.colors.primary} />
              <Text style={styles.headerActionBtnText}>Export</Text>
            </Pressable>
          ) : undefined
        }
      />

      <FlatList
        data={pagedBillingRows}
        keyExtractor={billingKeyExtractor}
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
                onOpenPartialPayment={setPartialPaymentTarget}
                onOpenReverseBill={setReverseBillTarget}
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
                onOpenPartialPayment={setPartialPaymentTarget}
                onOpenReverseBill={setReverseBillTarget}
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
        ListFooterComponent={
          hasMoreBillingRows ? (
            <View style={{ paddingVertical: 16, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={OwnerTheme.colors.primary} />
            </View>
          ) : (
            <View style={{ height: 40 }} />
          )
        }
        onEndReached={() => {
          if (hasMoreBillingRows) {
            setVisibleCount((prev) => prev + BILLING_PAGE_SIZE);
          }
        }}
        onEndReachedThreshold={0.4}
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
      <PartialPaymentModal
        target={partialPaymentTarget}
        submitting={recordPartialMutation.isPending}
        onClose={() => setPartialPaymentTarget(null)}
        onConfirm={async ({ chargeId, amountPaise, method, notes }) => {
          try {
            const res = await recordPartialMutation.mutateAsync({
              chargeId,
              amountPaise,
              method,
              notes: notes || null,
            });
            setPartialPaymentTarget(null);
            showToast(
              res.is_fully_settled
                ? `Settled in full · Receipt #${res.receipt_number}`
                : `Recorded ${formatPaiseToRupees(res.allocated_paise)} · ${formatPaiseToRupees(
                    res.remaining_paise
                  )} due`
            );
          } catch (err) {
            Alert.alert(
              'Payment Failed',
              err instanceof Error ? err.message : 'Could not record payment.'
            );
          }
        }}
      />

      <ReverseBillModal
        visible={Boolean(reverseBillTarget)}
        target={reverseBillTarget}
        submitting={
          reversePaymentsMutation.isPending || cancelChargeMutation.isPending
        }
        onClose={() => setReverseBillTarget(null)}
        onConfirm={async (target, reason) => {
          try {
            const res =
              target.mode === 'reverse_payment'
                ? await reversePaymentsMutation.mutateAsync({
                    chargeId: target.chargeId,
                    reason,
                  })
                : await cancelChargeMutation.mutateAsync({
                    chargeId: target.chargeId,
                    reason,
                  });
            setReverseBillTarget(null);
            showToast(res.message);
          } catch (err) {
            Alert.alert(
              target.mode === 'reverse_payment'
                ? 'Reverse Failed'
                : 'Cancel Failed',
              err instanceof Error ? err.message : 'Operation failed.'
            );
          }
        }}
      />

      <ChargeFormModal
        mode="generate-rent"
        visible={generateRentModalVisible}
        monthLabel={monthLabel}
        rentInputRupees={rentInputRupees}
        onChangeRentInputRupees={setRentInputRupees}
        onlyFillMissingRent={onlyFillMissingRent}
        onToggleOnlyFillMissingRent={setOnlyFillMissingRent}
        missingRentCount={missingRentResidents.length}
        unpaidExistingCount={unpaidExistingRentCount}
        submitting={generatingRent || updatingRent}
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
        monthLabel={monthLabel}
        availableRooms={availableRooms}
        existingEbRooms={existingEbRooms}
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
      <BulkReminderModal
        visible={bulkReminderModalVisible}
        monthLabel={monthLabel}
        targets={unpaidReminderTargets}
        duplicatePhoneResidentIds={duplicatePhoneResidentIds}
        sentReminderIds={sentReminderIds}
        bulkContactIssueCount={bulkContactIssueCount}
        onClose={() => setBulkReminderModalVisible(false)}
        onSendOne={(target) => {
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
        }}
        onCopyAll={() => void handleCopyAllReminders()}
      />

      {/* Thumb-Friendly Floating Action Pill */}
      {billingMode === 'RENT' && (
        <FloatingActionPill
          label="Set Rent"
          icon={Edit3}
          hasBottomNav
          accessibilityLabel="Set Monthly Rent"
          onPress={handleOpenGenerateRent}
        />
      )}
      {billingMode === 'EB' && (
        <FloatingActionPill
          label="Split EB"
          icon={Zap}
          hasBottomNav
          color={OwnerTheme.colors.warning}
          accessibilityLabel="Split EB Bill"
          onPress={() => setSplitEbModalVisible(true)}
        />
      )}
      {billingMode === 'EXPENSES' && (
        <FloatingActionPill
          label="Add Expense"
          icon={Plus}
          hasBottomNav
          accessibilityLabel="Add Expense"
          onPress={() => setExpenseModalVisible(true)}
        />
      )}

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
    paddingBottom: 96,
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
});
