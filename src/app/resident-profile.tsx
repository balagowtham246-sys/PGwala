import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
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
import { Href, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  BedDouble,
  Calendar,
  CreditCard,
  DoorOpen,
  Edit3,
  Eye,
  EyeOff,
  Lock,
  LogOut,
  MessageCircle,
  Phone,
  Receipt,
  Utensils,
  Wrench,
  X,
} from 'lucide-react-native';

import { RoomBedPicker } from '@/components/residents/RoomBedPicker';
import { CalendarDatePickerModal } from '@/components/ui/calendar-date-picker-modal';
import {
  DestructiveButton,
  EmptyState,
  ErrorState,
  HIGH_CONTRAST_SWITCH_COLORS,
  LoadingState,
  OwnerHeader,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  StatusBadgeVariant,
  SWITCH_THUMB_COLOR,
} from '@/components/ui/owner';
import { OwnerTheme } from '@/constants/theme';
import { useToast } from '@/context/toast-context';
import {
  buildWhatsAppReminderUrl,
  formatPaiseToRupees,
} from '@/lib/billing-utils';
import { triggerSelectionHaptic, triggerSuccessHaptic } from '@/lib/haptics';
import {
  calculateProRataFinalBillPaise,
  formatGateEventTimestamp,
  formatIsoDateDisplay,
  maskIndianPhone,
  toSentenceCaseStatus,
  validateIndianPhone,
} from '@/lib/ux-utils';
import {
  confirmMonthlyPayment,
  PaymentMethod,
} from '@/services/billing.service';
import {
  checkoutResident,
  fetchResidentProfile,
  ResidentProfileData,
  subscribePropertyResidentsRealtime,
  updateResidentWithLock,
} from '@/services/residents.service';

function getTodayLocalIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getDuesBadgeVariant(
  status: ResidentProfileData['currentMonthDuesStatus']
): StatusBadgeVariant {
  if (status === 'paid') return 'success';
  if (status === 'unpaid') return 'danger';
  return 'neutral';
}

function getComplaintBadgeVariant(status: string): StatusBadgeVariant {
  const normalized = status.toLowerCase();
  if (normalized === 'resolved') return 'success';
  if (normalized === 'in_progress') return 'warning';
  if (normalized === 'rejected') return 'danger';
  return 'info';
}

export default function ResidentProfileScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const residentId = typeof id === 'string' ? id : Array.isArray(id) ? id[0] : '';
  const { showToast } = useToast();

  const [profile, setProfile] = useState<ResidentProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Privacy toggle for phone number
  const [showFullPhone, setShowFullPhone] = useState(false);

  // Inline Owner Notes editor
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  // Change Room modal state
  const [roomModalVisible, setRoomModalVisible] = useState(false);
  const [draftRoomNumber, setDraftRoomNumber] = useState('');
  const [draftBedLabel, setDraftBedLabel] = useState('');
  const [savingRoom, setSavingRoom] = useState(false);
  const [roomPickerRefreshSignal, setRoomPickerRefreshSignal] = useState(0);

  // Record Payment modal state
  const [paymentModalVisible, setPaymentModalVisible] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [confirmingPayment, setConfirmingPayment] = useState(false);

  // Checkout modal & single-modal state machine (prevents nested Modal issues on iOS)
  const [checkoutModalMode, setCheckoutModalMode] = useState<
    'closed' | 'confirm' | 'date_picker'
  >('closed');
  const [leavingDateIso, setLeavingDateIso] = useState<string>(getTodayLocalIso);
  const [generateFinalBill, setGenerateFinalBill] = useState(true);
  const [checkingOut, setCheckingOut] = useState(false);

  const requestSeqRef = useRef(0);
  const loadedResidentIdRef = useRef<string>('');

  const loadProfile = useCallback(
    async (forceSpinner = false) => {
      if (!residentId) {
        loadedResidentIdRef.current = '';
        setProfile(null);
        setErrorMessage('No resident ID provided.');
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const seq = ++requestSeqRef.current;
      const isInitialForId = loadedResidentIdRef.current !== residentId;
      if (forceSpinner || isInitialForId) {
        setLoading(true);
      }

      const res = await fetchResidentProfile(residentId);
      if (seq !== requestSeqRef.current) return;

      if (res.ok) {
        loadedResidentIdRef.current = residentId;
        setProfile(res.data);
        setErrorMessage(null);
      } else {
        setErrorMessage(res.error.message);
      }
      setLoading(false);
      setRefreshing(false);
    },
    [residentId]
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const timer = setTimeout(() => {
        if (active) {
          void loadProfile(false);
        }
      }, 0);
      return () => {
        active = false;
        clearTimeout(timer);
      };
    }, [loadProfile])
  );

  const propertyId = profile?.propertyId ?? null;

  useEffect(() => {
    if (!propertyId) return;
    return subscribePropertyResidentsRealtime(propertyId, () => {
      void loadProfile(false);
    });
  }, [propertyId, loadProfile]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void loadProfile(false);
  }, [loadProfile]);

  const phoneNumber = profile?.phoneNumber;

  const phoneValidation = useMemo(
    () => validateIndianPhone(phoneNumber),
    [phoneNumber]
  );

  const maskedPhone = useMemo(
    () => maskIndianPhone(phoneNumber),
    [phoneNumber]
  );

  const fullFormattedPhone = useMemo(() => {
    if (!phoneNumber) return 'Not set';
    return phoneValidation.valid
      ? phoneValidation.formatted
      : phoneNumber.trim() || 'Not set';
  }, [phoneNumber, phoneValidation]);

  const firstUnpaidCharge = useMemo(() => {
    if (!profile) return null;
    return (
      profile.recentCharges.find(
        (c) => c.status !== 'settled' && c.status !== 'paid'
      ) ?? null
    );
  }, [profile]);

  const proRataFinalBillPaise = useMemo(() => {
    if (!profile) return 0;
    return calculateProRataFinalBillPaise(
      profile.monthlyRentPaise,
      leavingDateIso
    );
  }, [profile, leavingDateIso]);

  const handleCallResident = useCallback(() => {
    if (!profile) return;
    const digits = phoneValidation.normalized10;
    if (!digits || digits.length < 10) {
      Alert.alert(
        'Phone Not Available',
        'No valid 10-digit phone number is saved for this resident.'
      );
      return;
    }
    Linking.openURL(`tel:${digits}`).catch(() => {
      Alert.alert('Unable to Call', 'Could not open the phone dialer on this device.');
    });
  }, [profile, phoneValidation.normalized10]);

  const handleWhatsAppResident = useCallback(() => {
    if (!profile) return;
    const message =
      profile.pendingDuesPaise > 0
        ? `Hi ${profile.fullName}, friendly reminder regarding your pending PG dues of ${formatPaiseToRupees(profile.pendingDuesPaise)} at ${profile.propertyName}.`
        : `Hi ${profile.fullName}, reaching out from ${profile.propertyName} regarding your stay (Room ${profile.roomNumber}).`;
    const url = buildWhatsAppReminderUrl(profile.phoneNumber, message);
    if (!url) {
      Alert.alert(
        'Phone Not Available',
        'No valid 10-digit mobile number is saved for WhatsApp.'
      );
      return;
    }
    Linking.openURL(url).catch(() => {
      Alert.alert(
        'WhatsApp Unavailable',
        'Could not open WhatsApp on this device.'
      );
    });
  }, [profile]);

  const handleStartEditNotes = useCallback(() => {
    if (!profile) return;
    setNotesDraft(profile.notes ?? '');
    setEditingNotes(true);
  }, [profile]);

  const handleSaveNotes = useCallback(async () => {
    if (!profile || savingNotes) return;
    setSavingNotes(true);
    const trimmed = notesDraft.trim();
    const res = await updateResidentWithLock(
      profile.id,
      profile.propertyId,
      profile.updatedAt,
      { notes: trimmed || null }
    );
    setSavingNotes(false);

    if (!res.ok) {
      Alert.alert('Could Not Save Notes', res.error.message);
      return;
    }

    if (res.data.status === 'stale') {
      Alert.alert('Update Conflict', res.data.message, [
        {
          text: 'Reload Latest',
          onPress: () => {
            setEditingNotes(false);
            void loadProfile(true);
          },
        },
      ]);
      return;
    }

    if (res.data.status !== 'saved') {
      Alert.alert('Could Not Save Notes', res.data.message);
      return;
    }

    triggerSuccessHaptic();
    setEditingNotes(false);
    await loadProfile(false);
  }, [profile, savingNotes, notesDraft, loadProfile]);

  const handleOpenRoomModal = useCallback(() => {
    if (!profile) return;
    setDraftRoomNumber(profile.roomNumber);
    setDraftBedLabel(profile.bedLabel ?? '');
    setRoomPickerRefreshSignal((n) => n + 1);
    setRoomModalVisible(true);
  }, [profile]);

  const handleSaveRoomChange = useCallback(async () => {
    if (!profile || savingRoom) return;
    if (!draftRoomNumber.trim() || !draftBedLabel.trim()) {
      Alert.alert('Select Room & Bed', 'Please choose a room and an available bed.');
      return;
    }

    setSavingRoom(true);
    const res = await updateResidentWithLock(
      profile.id,
      profile.propertyId,
      profile.updatedAt,
      {
        room_number: draftRoomNumber.trim(),
        bed_label: draftBedLabel.trim(),
        gender: profile.gender ?? undefined,
      }
    );
    setSavingRoom(false);

    if (!res.ok) {
      Alert.alert('Room Update Failed', res.error.message);
      return;
    }

    if (
      res.data.status === 'bed_taken' ||
      res.data.status === 'stale' ||
      res.data.status === 'gender_mismatch'
    ) {
      Alert.alert('Unable to Move Resident', res.data.message);
      setRoomPickerRefreshSignal((n) => n + 1);
      await loadProfile(false);
      return;
    }

    triggerSuccessHaptic();
    setRoomModalVisible(false);
    await loadProfile(false);
  }, [profile, savingRoom, draftRoomNumber, draftBedLabel, loadProfile]);

  const handleRecordPaymentPress = useCallback(() => {
    if (!profile) return;
    if (!firstUnpaidCharge) {
      router.push({
        pathname: '/billing-management',
        params: { residentId: profile.id },
      } as Href);
      return;
    }
    setPaymentMethod('cash');
    setPaymentModalVisible(true);
  }, [profile, firstUnpaidCharge]);

  const handleConfirmPayment = useCallback(async () => {
    if (!profile || !firstUnpaidCharge || confirmingPayment) return;
    setConfirmingPayment(true);
    const res = await confirmMonthlyPayment({
      chargeId: firstUnpaidCharge.id,
      method: paymentMethod,
    });
    setConfirmingPayment(false);

    if (!res.ok) {
      Alert.alert('Payment Confirmation Failed', res.error.message);
      return;
    }

    triggerSuccessHaptic();
    setPaymentModalVisible(false);
    showToast(
      `Marked ${formatPaiseToRupees(firstUnpaidCharge.amount_paise)} paid via ${paymentMethod.toUpperCase()} (Receipt #${res.data.receipt_number}).`
    );
    await loadProfile(false);
  }, [profile, firstUnpaidCharge, confirmingPayment, paymentMethod, loadProfile, showToast]);

  const handleOpenCheckoutModal = useCallback(() => {
    if (!profile) return;
    setLeavingDateIso(getTodayLocalIso());
    setGenerateFinalBill(profile.monthlyRentPaise > 0);
    setCheckoutModalMode('confirm');
  }, [profile]);

  const handleConfirmCheckout = useCallback(async () => {
    if (!profile || checkingOut) return;
    setCheckingOut(true);
    const res = await checkoutResident({
      residentId: profile.id,
      propertyId: profile.propertyId,
      leavingDateIso,
      generateFinalBill,
      finalBillPaise: generateFinalBill ? proRataFinalBillPaise : 0,
    });
    setCheckingOut(false);

    if (!res.ok) {
      Alert.alert('Check-out Failed', res.error.message);
      return;
    }

    triggerSuccessHaptic();
    setCheckoutModalMode('closed');
    await loadProfile(false);

    const summaryNote = res.data.finalBillCreated
      ? `${profile.fullName} checked out · Final bill ${formatPaiseToRupees(proRataFinalBillPaise)} added.`
      : `${profile.fullName} checked out · ${profile.bedLabel || 'Bed'} in Room ${profile.roomNumber} is free.`;

    showToast(summaryNote);
    if (router.canGoBack()) {
      router.back();
    }
  }, [
    profile,
    checkingOut,
    leavingDateIso,
    generateFinalBill,
    proRataFinalBillPaise,
    loadProfile,
    showToast,
  ]);

  if (loading && !profile) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <OwnerHeader title="Resident Profile" showBack />
        <LoadingState message="Loading resident profile..." />
      </SafeAreaView>
    );
  }

  if (!profile) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <OwnerHeader title="Resident Profile" showBack />
        <View style={styles.statePad}>
          {errorMessage ? (
            <ErrorState
              message={errorMessage}
              onRetry={() => void loadProfile(true)}
            />
          ) : (
            <EmptyState
              title="Resident not found"
              description="This resident profile could not be loaded."
              actionLabel="Go back"
              onAction={() => router.back()}
            />
          )}
        </View>
      </SafeAreaView>
    );
  }

  const roomBedDisplay = profile.bedLabel
    ? `Room ${profile.roomNumber} · ${profile.bedLabel}`
    : `Room ${profile.roomNumber}`;
  const gateStatusLabel = toSentenceCaseStatus(profile.gateStatus);
  const gateStatusVariant: StatusBadgeVariant =
    profile.gateStatus === 'IN' ? 'success' : 'warning';
  const hasPhone = Boolean(profile.phoneNumber && profile.phoneNumber.trim());

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <OwnerHeader title="Resident Profile" subtitle={profile.propertyName} showBack />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={[OwnerTheme.colors.primary]}
            />
          }>
          {errorMessage ? (
            <ErrorState
              message={errorMessage}
              onRetry={() => void loadProfile(false)}
              style={{ marginBottom: 12 }}
            />
          ) : null}

          {/* Summary Card */}
          <View style={styles.summaryCard}>
            <View style={styles.summaryTopRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.residentName}>{profile.fullName}</Text>
                <Text style={styles.roomBedSub}>{roomBedDisplay}</Text>
              </View>
              <View style={styles.summaryBadgeCol}>
                <StatusBadge label={gateStatusLabel} variant={gateStatusVariant} />
                {!profile.isActive && (
                  <StatusBadge label="Checked out" variant="neutral" size="sm" />
                )}
              </View>
            </View>

            {/* Masked Phone Privacy Row */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                showFullPhone ? 'Hide full phone number' : 'Reveal full phone number'
              }
              disabled={!hasPhone}
              onPress={() => {
                triggerSelectionHaptic();
                setShowFullPhone((prev) => !prev);
              }}
              style={({ pressed }) => [
                styles.phoneRow,
                pressed && hasPhone && styles.pressedSoft,
              ]}>
              <View style={styles.phoneLeft}>
                <Phone size={15} color={OwnerTheme.colors.textSecondary} />
                <Text style={styles.phoneText}>
                  {showFullPhone ? fullFormattedPhone : maskedPhone}
                </Text>
              </View>
              {hasPhone ? (
                <View style={styles.phoneTogglePill}>
                  {showFullPhone ? (
                    <EyeOff size={13} color={OwnerTheme.colors.primary} />
                  ) : (
                    <Eye size={13} color={OwnerTheme.colors.primary} />
                  )}
                  <Text style={styles.phoneToggleText}>
                    {showFullPhone ? 'Hide' : 'Tap to reveal'}
                  </Text>
                </View>
              ) : null}
            </Pressable>

            {/* Call & WhatsApp Quick Buttons */}
            <View style={styles.contactButtonsRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Call resident"
                style={({ pressed }) => [
                  styles.contactBtn,
                  styles.callBtn,
                  !hasPhone && styles.contactBtnDisabled,
                  pressed && hasPhone && styles.pressedFade,
                ]}
                onPress={handleCallResident}>
                <Phone size={16} color={OwnerTheme.colors.primary} />
                <Text style={styles.callBtnText}>Call</Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Message resident on WhatsApp"
                style={({ pressed }) => [
                  styles.contactBtn,
                  styles.whatsappBtn,
                  !hasPhone && styles.contactBtnDisabled,
                  pressed && hasPhone && styles.pressedFade,
                ]}
                onPress={handleWhatsAppResident}>
                <MessageCircle size={16} color={OwnerTheme.colors.success} />
                <Text style={styles.whatsappBtnText}>WhatsApp</Text>
              </Pressable>
            </View>
          </View>

          {/* 1. Stay Section */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <BedDouble size={16} color={OwnerTheme.colors.primary} />
                <Text style={styles.sectionTitle}>Stay</Text>
              </View>
            </View>

            <View style={styles.kvRow}>
              <Text style={styles.kvLabel}>Joining date</Text>
              <Text style={styles.kvValue}>
                {formatIsoDateDisplay(profile.joiningDate)}
              </Text>
            </View>
            <View style={styles.kvRow}>
              <Text style={styles.kvLabel}>Room & Bed</Text>
              <Text style={styles.kvValue}>{roomBedDisplay}</Text>
            </View>
            <View style={styles.kvRow}>
              <Text style={styles.kvLabel}>Monthly rent</Text>
              <Text style={styles.kvValue}>
                {formatPaiseToRupees(profile.monthlyRentPaise)}
              </Text>
            </View>
            <View style={styles.kvRow}>
              <Text style={styles.kvLabel}>Security deposit</Text>
              <Text style={styles.kvValue}>
                {formatPaiseToRupees(profile.depositPaise)}
              </Text>
            </View>
            <View style={[styles.kvRow, styles.kvRowLast]}>
              <Text style={styles.kvLabel}>Emergency contact</Text>
              <Text style={styles.kvValue} numberOfLines={2}>
                {profile.emergencyContact?.trim() || 'Not set'}
              </Text>
            </View>
          </View>

          {/* 2. Dues Section */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <Receipt size={16} color={OwnerTheme.colors.primary} />
                <Text style={styles.sectionTitle}>Dues</Text>
              </View>
              <StatusBadge
                label={toSentenceCaseStatus(profile.currentMonthDuesStatus)}
                variant={getDuesBadgeVariant(profile.currentMonthDuesStatus)}
                size="sm"
              />
            </View>

            <View style={styles.kvRow}>
              <Text style={styles.kvLabel}>This month</Text>
              <Text style={styles.kvValue}>
                {toSentenceCaseStatus(profile.currentMonthDuesStatus)}
              </Text>
            </View>
            <View style={[styles.kvRow, styles.kvRowLast]}>
              <Text style={styles.kvLabel}>Outstanding total</Text>
              <Text
                style={[
                  styles.kvValue,
                  profile.pendingDuesPaise > 0 && { color: OwnerTheme.colors.danger },
                ]}>
                {formatPaiseToRupees(profile.pendingDuesPaise)}
              </Text>
            </View>

            <Pressable
              accessibilityRole="button"
              style={styles.sectionFooterLink}
              onPress={() =>
                router.push({
                  pathname: '/billing-management',
                  params: { residentId: profile.id },
                } as Href)
              }>
              <Text style={styles.sectionFooterLinkText}>View in Billing ›</Text>
            </Pressable>
          </View>

          {/* 3. Gate Section */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <DoorOpen size={16} color={OwnerTheme.colors.primary} />
                <Text style={styles.sectionTitle}>Gate</Text>
              </View>
              <StatusBadge
                label={gateStatusLabel}
                variant={gateStatusVariant}
                size="sm"
              />
            </View>

            <Text style={styles.subLabel}>Last 7 days movements</Text>
            {profile.lastSevenDaysLogs.length === 0 ? (
              <Text style={styles.emptySectionText}>
                No gate movements recorded in the last 7 days.
              </Text>
            ) : (
              <View style={styles.listStack}>
                {profile.lastSevenDaysLogs.slice(0, 6).map((log, index, arr) => (
                  <View
                    key={log.id}
                    style={[
                      styles.timelineRow,
                      index === arr.length - 1 && styles.kvRowLast,
                    ]}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.timelineTitle}>
                        {log.direction === 'IN' ? 'Checked in' : 'Checked out'}
                        {log.purpose ? ` · ${log.purpose}` : ''}
                      </Text>
                      <Text style={styles.timelineSub}>
                        {formatGateEventTimestamp(log.event_time)}
                      </Text>
                    </View>
                    <StatusBadge
                      label={toSentenceCaseStatus(log.direction)}
                      variant={log.direction === 'IN' ? 'success' : 'warning'}
                      size="sm"
                    />
                  </View>
                ))}
              </View>
            )}

            <Pressable
              accessibilityRole="button"
              style={styles.sectionFooterLink}
              onPress={() =>
                router.push({
                  pathname: '/student-in-out',
                  params: { residentId: profile.id },
                } as Href)
              }>
              <Text style={styles.sectionFooterLinkText}>View in Gate ›</Text>
            </Pressable>
          </View>

          {/* 4. Complaints Section */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <Wrench size={16} color={OwnerTheme.colors.primary} />
                <Text style={styles.sectionTitle}>Complaints</Text>
              </View>
              <Text style={styles.sectionMeta}>
                {profile.openComplaintsCount} open · {profile.resolvedComplaintsCount}{' '}
                resolved
              </Text>
            </View>

            {profile.recentComplaints.length === 0 ? (
              <Text style={styles.emptySectionText}>
                No complaints logged for this resident.
              </Text>
            ) : (
              <View style={styles.listStack}>
                {profile.recentComplaints.slice(0, 3).map((complaint, idx, arr) => (
                  <View
                    key={complaint.id}
                    style={[
                      styles.timelineRow,
                      idx === arr.length - 1 && styles.kvRowLast,
                    ]}>
                    <View style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                      <Text style={styles.timelineTitle} numberOfLines={1}>
                        {complaint.title}
                      </Text>
                      <Text style={styles.timelineSub}>
                        {formatIsoDateDisplay(complaint.created_at)} ·{' '}
                        {toSentenceCaseStatus(complaint.priority)}
                      </Text>
                    </View>
                    <StatusBadge
                      label={toSentenceCaseStatus(complaint.status)}
                      variant={getComplaintBadgeVariant(complaint.status)}
                      size="sm"
                    />
                  </View>
                ))}
              </View>
            )}

            <Pressable
              accessibilityRole="button"
              style={styles.sectionFooterLink}
              onPress={() =>
                router.push({
                  pathname: '/owner-complaints',
                  params: { residentId: profile.id },
                } as Href)
              }>
              <Text style={styles.sectionFooterLinkText}>
                View in Maintenance ›
              </Text>
            </Pressable>
          </View>

          {/* 5. Meals Section */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <Utensils size={16} color={OwnerTheme.colors.primary} />
                <Text style={styles.sectionTitle}>Meals</Text>
              </View>
              <StatusBadge
                label={profile.dinnerRegisteredToday ? 'Registered' : 'Not needed'}
                variant={profile.dinnerRegisteredToday ? 'success' : 'neutral'}
                size="sm"
              />
            </View>
            <Text style={styles.mealStatusText}>{profile.dinnerStatusLabel}</Text>
          </View>

          {/* 6. Notes Section (Owner-only) */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <Lock size={15} color={OwnerTheme.colors.textSecondary} />
                <Text style={styles.sectionTitle}>Notes</Text>
                <View style={styles.privatePill}>
                  <Text style={styles.privatePillText}>Only visible to you</Text>
                </View>
              </View>
              {!editingNotes && (
                <Pressable
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={handleStartEditNotes}>
                  <Text style={styles.editNoteLink}>Edit</Text>
                </Pressable>
              )}
            </View>

            {editingNotes ? (
              <View style={styles.noteEditBox}>
                <TextInput
                  style={styles.noteInput}
                  value={notesDraft}
                  onChangeText={setNotesDraft}
                  placeholder="Add private owner notes (ID verification, preferences, remarks)..."
                  placeholderTextColor={OwnerTheme.colors.textMuted}
                  multiline
                  numberOfLines={3}
                />
                <View style={styles.noteBtnRow}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={savingNotes}
                    style={styles.noteCancelBtn}
                    onPress={() => setEditingNotes(false)}>
                    <Text style={styles.noteCancelText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={savingNotes}
                    style={[styles.noteSaveBtn, savingNotes && { opacity: 0.6 }]}
                    onPress={handleSaveNotes}>
                    {savingNotes ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={styles.noteSaveText}>Save Note</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            ) : (
              <Text style={styles.noteBodyText}>
                {profile.notes?.trim() || 'No owner notes added yet.'}
              </Text>
            )}
          </View>

          {/* Action Bar */}
          <View style={styles.actionBarCard}>
            <Text style={styles.actionBarHeading}>Actions</Text>
            <View style={styles.actionGrid}>
              <SecondaryButton
                label="Edit details"
                icon={Edit3}
                onPress={() =>
                  router.push({
                    pathname: '/edit-resident',
                    params: { id: profile.id },
                  } as Href)
                }
                style={styles.actionGridBtn}
              />
              <SecondaryButton
                label="Change room"
                icon={BedDouble}
                disabled={!profile.isActive}
                onPress={handleOpenRoomModal}
                style={styles.actionGridBtn}
              />
              <PrimaryButton
                label="Record payment"
                icon={CreditCard}
                onPress={handleRecordPaymentPress}
                style={styles.actionGridBtn}
              />
              <DestructiveButton
                label={profile.isActive ? 'Check out' : 'Checked out'}
                icon={LogOut}
                disabled={!profile.isActive}
                onPress={handleOpenCheckoutModal}
                style={styles.actionGridBtn}
              />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Change Room & Bed Modal */}
      <Modal
        visible={roomModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!savingRoom) setRoomModalVisible(false);
        }}>
        <View style={styles.modalOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              if (!savingRoom) setRoomModalVisible(false);
            }}
          />
          <View style={styles.sheetModalCard}>
            <View style={styles.modalHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Change Room & Bed</Text>
                <Text style={styles.modalSubtitle}>
                  Current: {roomBedDisplay}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close room picker"
                hitSlop={10}
                disabled={savingRoom}
                onPress={() => setRoomModalVisible(false)}
                style={styles.modalCloseBtn}>
                <X size={18} color={OwnerTheme.colors.textSecondary} />
              </Pressable>
            </View>

            <ScrollView
              style={styles.roomPickerScroll}
              showsVerticalScrollIndicator={false}>
              <RoomBedPicker
                propertyId={profile.propertyId}
                propertyGender={profile.propertyGender}
                residentGender={profile.gender ?? 'male'}
                selectedRoomNumber={draftRoomNumber}
                selectedBedLabel={draftBedLabel}
                excludeResidentId={profile.id}
                refreshSignal={roomPickerRefreshSignal}
                onSelect={(room, bed) => {
                  setDraftRoomNumber(room);
                  setDraftBedLabel(bed);
                }}
              />
            </ScrollView>

            <View style={styles.modalFooterRow}>
              <SecondaryButton
                label="Cancel"
                disabled={savingRoom}
                onPress={() => setRoomModalVisible(false)}
                style={{ flex: 1 }}
              />
              <PrimaryButton
                label="Save Room"
                loading={savingRoom}
                disabled={!draftRoomNumber || !draftBedLabel}
                onPress={handleSaveRoomChange}
                style={{ flex: 1.5 }}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* Record Payment Confirmation Modal */}
      <Modal
        visible={paymentModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!confirmingPayment) setPaymentModalVisible(false);
        }}>
        <View style={styles.centerModalOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              if (!confirmingPayment) setPaymentModalVisible(false);
            }}
          />
          <View style={styles.centerModalCard}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Record Payment</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close payment dialog"
                hitSlop={10}
                disabled={confirmingPayment}
                onPress={() => setPaymentModalVisible(false)}
                style={styles.modalCloseBtn}>
                <X size={18} color={OwnerTheme.colors.textSecondary} />
              </Pressable>
            </View>

            {firstUnpaidCharge ? (
              <>
                <View style={styles.chargeSummaryBox}>
                  <Text style={styles.chargeCategoryText}>
                    {toSentenceCaseStatus(firstUnpaidCharge.category)} ·{' '}
                    {formatIsoDateDisplay(firstUnpaidCharge.billing_period_start)}
                  </Text>
                  <Text style={styles.chargeAmountText}>
                    {formatPaiseToRupees(firstUnpaidCharge.amount_paise)}
                  </Text>
                </View>

                <Text style={styles.modalFieldLabel}>Payment Method</Text>
                <View style={styles.methodRow}>
                  {(['cash', 'upi'] as PaymentMethod[]).map((method) => {
                    const active = paymentMethod === method;
                    return (
                      <Pressable
                        key={method}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        style={[
                          styles.methodChip,
                          active && styles.methodChipActive,
                        ]}
                        onPress={() => {
                          triggerSelectionHaptic();
                          setPaymentMethod(method);
                        }}>
                        <Text
                          style={[
                            styles.methodChipText,
                            active && styles.methodChipTextActive,
                          ]}>
                          {method === 'cash' ? 'Cash' : 'UPI'}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <View style={styles.modalFooterRow}>
                  <SecondaryButton
                    label="Cancel"
                    disabled={confirmingPayment}
                    onPress={() => setPaymentModalVisible(false)}
                    style={{ flex: 1 }}
                  />
                  <PrimaryButton
                    label="Confirm Paid"
                    loading={confirmingPayment}
                    onPress={handleConfirmPayment}
                    style={{ flex: 1.4 }}
                  />
                </View>
              </>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Check-out Confirmation Modal */}
      <Modal
        visible={checkoutModalMode === 'confirm'}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!checkingOut) setCheckoutModalMode('closed');
        }}>
        <View style={styles.centerModalOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              if (!checkingOut) setCheckoutModalMode('closed');
            }}
          />
          <View style={styles.centerModalCard}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Check Out Resident</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close checkout dialog"
                hitSlop={10}
                disabled={checkingOut}
                onPress={() => setCheckoutModalMode('closed')}
                style={styles.modalCloseBtn}>
                <X size={18} color={OwnerTheme.colors.textSecondary} />
              </Pressable>
            </View>

            <View style={styles.checkoutNoticeBox}>
              <Text style={styles.checkoutNoticeText}>
                Bills, gate history, and complaints are preserved for your records,
                while {profile.bedLabel || 'the bed'} in Room {profile.roomNumber} is
                freed immediately for new admissions.
              </Text>
            </View>

            <Text style={styles.modalFieldLabel}>Leaving Date</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Pick leaving date"
              disabled={checkingOut}
              style={styles.datePickerTrigger}
              onPress={() => setCheckoutModalMode('date_picker')}>
              <Calendar size={16} color={OwnerTheme.colors.primary} />
              <Text style={styles.datePickerText}>
                {formatIsoDateDisplay(leavingDateIso)}
              </Text>
              <Text style={styles.datePickerChange}>Change</Text>
            </Pressable>

            <View style={styles.finalBillRow}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.finalBillTitle}>Generate final bill</Text>
                <Text style={styles.finalBillSub}>
                  Pro-rata rent for leaving month:{' '}
                  <Text style={styles.finalBillAmount}>
                    {formatPaiseToRupees(proRataFinalBillPaise)}
                  </Text>
                </Text>
              </View>
              <Switch
                value={generateFinalBill}
                disabled={checkingOut}
                onValueChange={setGenerateFinalBill}
                trackColor={HIGH_CONTRAST_SWITCH_COLORS}
                thumbColor={SWITCH_THUMB_COLOR}
              />
            </View>

            <View style={styles.modalFooterRow}>
              <SecondaryButton
                label="Cancel"
                disabled={checkingOut}
                onPress={() => setCheckoutModalMode('closed')}
                style={{ flex: 1 }}
              />
              <DestructiveButton
                label="Confirm Check Out"
                loading={checkingOut}
                onPress={handleConfirmCheckout}
                style={{ flex: 1.5 }}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* Leaving Date Calendar Picker Modal */}
      <CalendarDatePickerModal
        visible={checkoutModalMode === 'date_picker'}
        value={leavingDateIso}
        title="Select Leaving Date"
        onSelect={(iso) => setLeavingDateIso(iso)}
        onClose={() => setCheckoutModalMode('confirm')}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: OwnerTheme.colors.background,
  },
  statePad: {
    flex: 1,
    padding: OwnerTheme.spacing.lg,
    justifyContent: 'center',
  },
  scrollContent: {
    paddingHorizontal: OwnerTheme.spacing.lg,
    paddingTop: OwnerTheme.spacing.md,
    paddingBottom: OwnerTheme.spacing.xxxl,
    gap: 12,
  },
  summaryCard: {
    backgroundColor: OwnerTheme.colors.card,
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 16,
    gap: 12,
    ...OwnerTheme.shadow,
  },
  summaryTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  residentName: {
    fontSize: 20,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
    letterSpacing: -0.3,
  },
  roomBedSub: {
    fontSize: 14,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
    marginTop: 2,
  },
  summaryBadgeCol: {
    alignItems: 'flex-end',
    gap: 6,
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: OwnerTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.borderLight,
    borderRadius: OwnerTheme.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  phoneLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  phoneText: {
    fontSize: 14,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  phoneTogglePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  phoneToggleText: {
    fontSize: 12,
    fontWeight: '600',
    color: OwnerTheme.colors.primary,
  },
  contactButtonsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  contactBtn: {
    flex: 1,
    height: 42,
    borderRadius: OwnerTheme.radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  callBtn: {
    backgroundColor: OwnerTheme.colors.primaryLight,
    borderColor: '#BAE6FD',
  },
  callBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  whatsappBtn: {
    backgroundColor: OwnerTheme.colors.successLight,
    borderColor: '#BBF7D0',
  },
  whatsappBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: OwnerTheme.colors.success,
  },
  contactBtnDisabled: {
    opacity: 0.5,
  },
  pressedFade: {
    opacity: 0.78,
  },
  pressedSoft: {
    backgroundColor: '#F1F5F9',
  },
  sectionCard: {
    backgroundColor: OwnerTheme.colors.card,
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 15,
    ...OwnerTheme.shadow,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 8,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flex: 1,
    flexWrap: 'wrap',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  sectionMeta: {
    fontSize: 12,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  kvRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: OwnerTheme.colors.borderLight,
    gap: 12,
  },
  kvRowLast: {
    borderBottomWidth: 0,
    paddingBottom: 2,
  },
  kvLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: OwnerTheme.colors.textSecondary,
  },
  kvValue: {
    fontSize: 13,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
    textAlign: 'right',
    flexShrink: 1,
  },
  sectionFooterLink: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: OwnerTheme.colors.borderLight,
    alignItems: 'flex-end',
  },
  sectionFooterLinkText: {
    fontSize: 13,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  subLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
    marginBottom: 6,
  },
  emptySectionText: {
    fontSize: 13,
    color: OwnerTheme.colors.textMuted,
    paddingVertical: 4,
  },
  listStack: {
    gap: 2,
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: OwnerTheme.colors.borderLight,
    gap: 8,
  },
  timelineTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  timelineSub: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 1,
  },
  mealStatusText: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  privatePill: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: OwnerTheme.radius.full,
  },
  privatePillText: {
    fontSize: 11,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  editNoteLink: {
    fontSize: 13,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  noteBodyText: {
    fontSize: 13,
    lineHeight: 19,
    color: OwnerTheme.colors.textSecondary,
  },
  noteEditBox: {
    gap: 10,
  },
  noteInput: {
    backgroundColor: OwnerTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    borderRadius: OwnerTheme.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: OwnerTheme.colors.textPrimary,
    minHeight: 78,
    textAlignVertical: 'top',
  },
  noteBtnRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  noteCancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: OwnerTheme.radius.sm,
    backgroundColor: '#F1F5F9',
  },
  noteCancelText: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  noteSaveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: OwnerTheme.radius.sm,
    backgroundColor: OwnerTheme.colors.primary,
  },
  noteSaveText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  actionBarCard: {
    backgroundColor: OwnerTheme.colors.card,
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 15,
    gap: 10,
    ...OwnerTheme.shadow,
  },
  actionBarHeading: {
    fontSize: 14,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  actionGridBtn: {
    width: '48%',
    flexGrow: 1,
    height: 46,
    paddingHorizontal: 12,
  },
  // Modals
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  sheetModalCard: {
    backgroundColor: OwnerTheme.colors.surface,
    borderTopLeftRadius: OwnerTheme.radius.lg,
    borderTopRightRadius: OwnerTheme.radius.lg,
    padding: 18,
    maxHeight: '85%',
  },
  centerModalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  centerModalCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: OwnerTheme.colors.surface,
    borderRadius: OwnerTheme.radius.lg,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 18,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 10,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  modalSubtitle: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 2,
  },
  modalCloseBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  roomPickerScroll: {
    maxHeight: 420,
  },
  modalFooterRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  chargeSummaryBox: {
    backgroundColor: OwnerTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    borderRadius: OwnerTheme.radius.md,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  chargeCategoryText: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  chargeAmountText: {
    fontSize: 17,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  modalFieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
    marginBottom: 8,
  },
  methodRow: {
    flexDirection: 'row',
    gap: 10,
  },
  methodChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: OwnerTheme.radius.md,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    backgroundColor: OwnerTheme.colors.surfaceElevated,
    alignItems: 'center',
  },
  methodChipActive: {
    borderColor: OwnerTheme.colors.primary,
    backgroundColor: OwnerTheme.colors.primaryLight,
  },
  methodChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  methodChipTextActive: {
    color: OwnerTheme.colors.primary,
    fontWeight: '700',
  },
  checkoutNoticeBox: {
    backgroundColor: OwnerTheme.colors.warningLight,
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: OwnerTheme.radius.md,
    padding: 12,
    marginBottom: 14,
  },
  checkoutNoticeText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#92400E',
    fontWeight: '500',
  },
  datePickerTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    borderRadius: OwnerTheme.radius.md,
    backgroundColor: OwnerTheme.colors.surfaceElevated,
    paddingHorizontal: 12,
    height: 46,
    marginBottom: 14,
  },
  datePickerText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  datePickerChange: {
    fontSize: 13,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  finalBillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: OwnerTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.borderLight,
    borderRadius: OwnerTheme.radius.md,
    padding: 12,
  },
  finalBillTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  finalBillSub: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 2,
  },
  finalBillAmount: {
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
});
