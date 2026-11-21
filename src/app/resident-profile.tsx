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
import { useQueryClient } from '@tanstack/react-query';
import { Href, router, useLocalSearchParams } from 'expo-router';
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
import { useConfirmMonthlyPaymentMutation } from '@/hooks/use-owner-billing';
import {
  useCheckoutResidentMutation,
  useResidentProfileQuery,
  useUpdateResidentWithLockMutation,
} from '@/hooks/use-residents';
import {
  buildWhatsAppReminderUrl,
  formatPaiseToRupees,
} from '@/lib/billing-utils';
import { triggerSelectionHaptic, triggerSuccessHaptic } from '@/lib/haptics';
import { queryKeys } from '@/lib/query-keys';
import {
  calculateProRataFinalBillPaise,
  formatLocalIsoDate,
  maskIndianPhone,
  toSentenceCaseStatus,
  validateIndianPhone,
} from '@/lib/ux-utils';
import { PaymentMethod } from '@/services/billing.service';
import { subscribePropertyResidentsRealtime } from '@/services/residents.service';

export default function ResidentProfileScreen() {
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const residentId = typeof id === 'string' ? id : Array.isArray(id) ? id[0] : '';
  const { showToast } = useToast();

  const [manualRefreshing, setManualRefreshing] = useState(false);

  // Privacy toggle for phone number
  const [showFullPhone, setShowFullPhone] = useState(false);

  // Inline Owner Notes editor
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');

  // Change Room modal state
  const [roomModalVisible, setRoomModalVisible] = useState(false);
  const [draftRoomNumber, setDraftRoomNumber] = useState('');
  const [draftBedLabel, setDraftBedLabel] = useState('');
  const [roomPickerRefreshSignal, setRoomPickerRefreshSignal] = useState(0);

  // Record Payment modal state
  const [paymentModalVisible, setPaymentModalVisible] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');

  // Checkout modal & single-modal state machine (prevents nested Modal issues on iOS)
  const [checkoutModalMode, setCheckoutModalMode] = useState<
    'closed' | 'confirm' | 'date_picker'
  >('closed');
  const [leavingDateIso, setLeavingDateIso] = useState<string>(() =>
    formatLocalIsoDate()
  );
  const [generateFinalBill, setGenerateFinalBill] = useState(true);
  const checkingOutRef = useRef(false);

  const profileQuery = useResidentProfileQuery(residentId || undefined);
  const updateResidentMutation = useUpdateResidentWithLockMutation();
  const confirmPaymentMutation = useConfirmMonthlyPaymentMutation();
  const checkoutMutation = useCheckoutResidentMutation();

  const profile = residentId ? profileQuery.data ?? null : null;
  const loading = Boolean(residentId) && profileQuery.isPending && !profile;
  const refreshing = manualRefreshing;
  const errorMessage = !residentId
    ? 'No resident ID provided.'
    : profileQuery.isError
      ? profileQuery.error.message
      : null;

  const savingNotes = updateResidentMutation.isPending && editingNotes;
  const savingRoom = updateResidentMutation.isPending && roomModalVisible;
  const confirmingPayment = confirmPaymentMutation.isPending;
  const checkingOut = checkoutMutation.isPending;

  const propertyId = profile?.propertyId ?? null;

  useEffect(() => {
    if (!propertyId || !residentId) return;
    return subscribePropertyResidentsRealtime(propertyId, () => {
      void qc.invalidateQueries({
        queryKey: queryKeys.residents.detail(residentId),
      });
    });
  }, [propertyId, residentId, qc]);

  const handleRefresh = useCallback(() => {
    if (!residentId) return;
    setManualRefreshing(true);
    void profileQuery.refetch().finally(() => {
      setManualRefreshing(false);
    });
  }, [residentId, profileQuery]);

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
    if (!profile || updateResidentMutation.isPending) return;
    const trimmed = notesDraft.trim();
    try {
      const outcome = await updateResidentMutation.mutateAsync({
        residentId: profile.id,
        propertyId: profile.propertyId,
        loadedUpdatedAt: profile.updatedAt,
        patch: { notes: trimmed || null },
      });

      if (outcome.status === 'stale') {
        Alert.alert('Update Conflict', outcome.message, [
          {
            text: 'Reload Latest',
            onPress: () => {
              setEditingNotes(false);
              void profileQuery.refetch();
            },
          },
        ]);
        return;
      }

      if (outcome.status !== 'saved') {
        Alert.alert('Could Not Save Notes', outcome.message);
        return;
      }

      triggerSuccessHaptic();
      setEditingNotes(false);
    } catch (err) {
      Alert.alert(
        'Could Not Save Notes',
        err instanceof Error ? err.message : 'Failed to save notes.'
      );
    }
  }, [profile, notesDraft, updateResidentMutation, profileQuery]);

  const handleOpenRoomModal = useCallback(() => {
    if (!profile) return;
    setDraftRoomNumber(profile.roomNumber);
    setDraftBedLabel(profile.bedLabel ?? '');
    setRoomPickerRefreshSignal((n) => n + 1);
    setRoomModalVisible(true);
  }, [profile]);

  const handleSaveRoomChange = useCallback(async () => {
    if (!profile || updateResidentMutation.isPending) return;
    if (!draftRoomNumber.trim() || !draftBedLabel.trim()) {
      Alert.alert('Select Room & Bed', 'Please choose a room and an available bed.');
      return;
    }

    try {
      const outcome = await updateResidentMutation.mutateAsync({
        residentId: profile.id,
        propertyId: profile.propertyId,
        loadedUpdatedAt: profile.updatedAt,
        patch: {
          room_number: draftRoomNumber.trim(),
          bed_label: draftBedLabel.trim(),
          gender: profile.gender ?? undefined,
        },
      });

      if (
        outcome.status === 'bed_taken' ||
        outcome.status === 'stale' ||
        outcome.status === 'gender_mismatch'
      ) {
        Alert.alert('Unable to Move Resident', outcome.message);
        setRoomPickerRefreshSignal((n) => n + 1);
        void profileQuery.refetch();
        return;
      }

      triggerSuccessHaptic();
      setRoomModalVisible(false);
    } catch (err) {
      Alert.alert(
        'Room Update Failed',
        err instanceof Error ? err.message : 'Could not update room.'
      );
    }
  }, [profile, draftRoomNumber, draftBedLabel, updateResidentMutation, profileQuery]);

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
    if (!profile || !firstUnpaidCharge || confirmPaymentMutation.isPending) return;
    try {
      const data = await confirmPaymentMutation.mutateAsync({
        chargeId: firstUnpaidCharge.id,
        method: paymentMethod,
      });

      triggerSuccessHaptic();
      setPaymentModalVisible(false);
      showToast(
        `Marked ${formatPaiseToRupees(firstUnpaidCharge.amount_paise)} paid via ${paymentMethod.toUpperCase()} (Receipt #${data.receipt_number}).`
      );
    } catch (err) {
      Alert.alert(
        'Payment Confirmation Failed',
        err instanceof Error ? err.message : 'Could not confirm payment.'
      );
    }
  }, [profile, firstUnpaidCharge, paymentMethod, confirmPaymentMutation, showToast]);

  const handleOpenCheckoutModal = useCallback(() => {
    if (!profile) return;
    setLeavingDateIso(formatLocalIsoDate());
    setGenerateFinalBill(profile.monthlyRentPaise > 0);
    setCheckoutModalMode('confirm');
  }, [profile]);

  const handleConfirmCheckout = useCallback(async () => {
    if (!profile || checkoutMutation.isPending || checkingOutRef.current) return;
    checkingOutRef.current = true;
    try {
      const outcome = await checkoutMutation.mutateAsync({
        residentId: profile.id,
        propertyId: profile.propertyId,
        leavingDateIso,
        generateFinalBill,
        finalBillPaise: generateFinalBill ? proRataFinalBillPaise : 0,
      });

      triggerSuccessHaptic();
      setCheckoutModalMode('closed');

      const wmSuffix =
        outcome.releasedMachinesCount > 0 ? ' · Active wash released' : '';
      const summaryNote = outcome.finalBillCreated
        ? `${profile.fullName} checked out · Final bill ${formatPaiseToRupees(proRataFinalBillPaise)} added${wmSuffix}.`
        : `${profile.fullName} checked out · ${profile.bedLabel || 'Bed'} in Room ${profile.roomNumber} is free${wmSuffix}.`;

      showToast(summaryNote);
      if (router.canGoBack()) {
        router.back();
      }
    } catch (err) {
      Alert.alert(
        'Check-out Failed',
        err instanceof Error ? err.message : 'Could not check out resident.'
      );
    } finally {
      checkingOutRef.current = false;
    }
  }, [
    profile,
    checkoutMutation,
    leavingDateIso,
    generateFinalBill,
    proRataFinalBillPaise,
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
              onRetry={() => void profileQuery.refetch()}
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
              onRetry={() => void profileQuery.refetch()}
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
