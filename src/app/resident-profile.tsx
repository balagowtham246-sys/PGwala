import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Href, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  Eye,
  EyeOff,
  MessageCircle,
  Phone,
} from 'lucide-react-native';

import {
  ResidentCheckoutModal,
  ResidentRecordPaymentModal,
  ResidentRoomChangeModal,
} from '@/components/residents/ResidentProfileModals';
import { ResidentProfileSections } from '@/components/residents/ResidentProfileSections';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  OwnerHeader,
  StatusBadge,
  StatusBadgeVariant,
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
  formatLocalIsoDate,
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
  const [leavingDateIso, setLeavingDateIso] = useState<string>(() =>
    formatLocalIsoDate()
  );
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
    setLeavingDateIso(formatLocalIsoDate());
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

          <ResidentProfileSections
            profile={profile}
            roomBedDisplay={roomBedDisplay}
            gateStatusLabel={gateStatusLabel}
            gateStatusVariant={gateStatusVariant}
            editingNotes={editingNotes}
            notesDraft={notesDraft}
            savingNotes={savingNotes}
            onChangeNotesDraft={setNotesDraft}
            onStartEditNotes={handleStartEditNotes}
            onCancelEditNotes={() => setEditingNotes(false)}
            onSaveNotes={handleSaveNotes}
            onOpenRoomModal={handleOpenRoomModal}
            onRecordPaymentPress={handleRecordPaymentPress}
            onOpenCheckoutModal={handleOpenCheckoutModal}
          />
        </ScrollView>
      </KeyboardAvoidingView>

      <ResidentRoomChangeModal
        visible={roomModalVisible}
        savingRoom={savingRoom}
        roomBedDisplay={roomBedDisplay}
        profile={profile}
        draftRoomNumber={draftRoomNumber}
        draftBedLabel={draftBedLabel}
        roomPickerRefreshSignal={roomPickerRefreshSignal}
        onSelectRoomBed={(room, bed) => {
          setDraftRoomNumber(room);
          setDraftBedLabel(bed);
        }}
        onSave={handleSaveRoomChange}
        onClose={() => setRoomModalVisible(false)}
      />

      <ResidentRecordPaymentModal
        visible={paymentModalVisible}
        confirmingPayment={confirmingPayment}
        firstUnpaidCharge={firstUnpaidCharge}
        paymentMethod={paymentMethod}
        onSelectMethod={setPaymentMethod}
        onConfirm={handleConfirmPayment}
        onClose={() => setPaymentModalVisible(false)}
      />

      <ResidentCheckoutModal
        checkoutModalMode={checkoutModalMode}
        checkingOut={checkingOut}
        profile={profile}
        leavingDateIso={leavingDateIso}
        generateFinalBill={generateFinalBill}
        proRataFinalBillPaise={proRataFinalBillPaise}
        onOpenDatePicker={() => setCheckoutModalMode('date_picker')}
        onSelectLeavingDate={(iso) => setLeavingDateIso(iso)}
        onToggleGenerateFinalBill={setGenerateFinalBill}
        onConfirmCheckout={handleConfirmCheckout}
        onBackToConfirm={() => setCheckoutModalMode('confirm')}
        onClose={() => setCheckoutModalMode('closed')}
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
});
