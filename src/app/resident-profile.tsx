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
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { Href, router, useLocalSearchParams } from 'expo-router';
import {
  Eye,
  EyeOff,
  KeyRound,
  MessageCircle,
  Phone,
  RefreshCw,
  Share2,
  Trash2,
  X,
} from 'lucide-react-native';

import { invokeEdgeFunction } from '@/lib/edge-functions';
import { extractErrorMessage } from '@/lib/error-utils';
import { supabase } from '@/lib/supabase';

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
  const [resetPwdModalVisible, setResetPwdModalVisible] = useState(false);
  const [resetPwdDraft, setResetPwdDraft] = useState('');
  const [resettingPwd, setResettingPwd] = useState(false);
  const [resetPwdResult, setResetPwdResult] = useState<{
    email: string;
    password: string;
  } | null>(null);

  const generateResidentTempPassword = useCallback(() => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    let out = 'PG@';
    for (let i = 0; i < 6; i += 1) {
      out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
  }, []);

  const handleOpenResetPassword = useCallback(() => {
    setResetPwdDraft(generateResidentTempPassword());
    setResetPwdResult(null);
    setResetPwdModalVisible(true);
  }, [generateResidentTempPassword]);

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

  const handleConfirmResetPassword = useCallback(async () => {
    if (!profile || resettingPwd) return;
    const cleanPass = resetPwdDraft.trim();
    if (cleanPass.length < 6) {
      Alert.alert('Weak Password', 'Password must be at least 6 characters.');
      return;
    }
    setResettingPwd(true);
    try {
      const res = await invokeEdgeFunction<{
        success?: boolean;
        error?: string;
        target_email?: string;
      }>('reset-user-password', {
        target_type: 'resident',
        resident_id: profile.id,
        new_password: cleanPass,
      });
      if (!res?.success) {
        throw new Error(res?.error || 'Could not reset password.');
      }
      setResetPwdResult({
        email: res.target_email || '',
        password: cleanPass,
      });
      triggerSuccessHaptic();
      showToast(`Password reset for ${profile.fullName}`);
    } catch (err: unknown) {
      Alert.alert(
        'Reset Failed',
        extractErrorMessage(err, 'Could not reset resident password.')
      );
    } finally {
      setResettingPwd(false);
    }
  }, [profile, resettingPwd, resetPwdDraft, showToast]);
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

  const refetchProfile = profileQuery.refetch;
  const mutateUpdateResident = updateResidentMutation.mutateAsync;
  const isUpdatingResident = updateResidentMutation.isPending;
  const mutateConfirmPayment = confirmPaymentMutation.mutateAsync;
  const isConfirmingPayment = confirmPaymentMutation.isPending;

  const handleRefresh = useCallback(() => {
    if (!residentId) return;
    setManualRefreshing(true);
    void refetchProfile().finally(() => {
      setManualRefreshing(false);
    });
  }, [residentId, refetchProfile]);

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
    if (!profile || isUpdatingResident) return;
    const trimmed = notesDraft.trim();
    try {
      const outcome = await mutateUpdateResident({
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
              void refetchProfile();
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
  }, [profile, notesDraft, isUpdatingResident, mutateUpdateResident, refetchProfile]);

  const handleOpenRoomModal = useCallback(() => {
    if (!profile) return;
    setDraftRoomNumber(profile.roomNumber);
    setDraftBedLabel(profile.bedLabel ?? '');
    setRoomPickerRefreshSignal((n) => n + 1);
    setRoomModalVisible(true);
  }, [profile]);

  const handleSaveRoomChange = useCallback(async () => {
    if (!profile || isUpdatingResident) return;
    if (!draftRoomNumber.trim() || !draftBedLabel.trim()) {
      Alert.alert('Select Room & Bed', 'Please choose a room and an available bed.');
      return;
    }

    try {
      const outcome = await mutateUpdateResident({
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
        void refetchProfile();
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
  }, [profile, draftRoomNumber, draftBedLabel, isUpdatingResident, mutateUpdateResident, refetchProfile]);

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
    if (!profile || !firstUnpaidCharge || isConfirmingPayment) return;
    try {
      const data = await mutateConfirmPayment({
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
  }, [profile, firstUnpaidCharge, paymentMethod, isConfirmingPayment, mutateConfirmPayment, showToast]);

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
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
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

          {/* Fintech-Modern Dark-Slate Resident Hero Card */}
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

            {/* Quick Financial Snapshot Pills */}
            <View style={styles.heroFinanceRow}>
              <View style={styles.heroFinancePill}>
                <Text style={styles.heroFinanceLabel}>Monthly Rent</Text>
                <Text style={styles.heroFinanceValue}>
                  {formatPaiseToRupees(profile.monthlyRentPaise)}
                </Text>
              </View>
              <View style={styles.heroFinancePill}>
                <Text style={styles.heroFinanceLabel}>Pending Dues</Text>
                <Text
                  style={[
                    styles.heroFinanceValue,
                    {
                      color:
                        profile.pendingDuesPaise > 0 ? '#FCA5A5' : '#34D399',
                    },
                  ]}>
                  {profile.pendingDuesPaise > 0
                    ? formatPaiseToRupees(profile.pendingDuesPaise)
                    : 'Settled'}
                </Text>
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
                <Phone size={15} color="#94A3B8" />
                <Text style={styles.phoneText}>
                  {showFullPhone ? fullFormattedPhone : maskedPhone}
                </Text>
              </View>
              {hasPhone ? (
                <View style={styles.phoneTogglePill}>
                  {showFullPhone ? (
                    <EyeOff size={13} color="#38BDF8" />
                  ) : (
                    <Eye size={13} color="#38BDF8" />
                  )}
                  <Text style={styles.phoneToggleText}>
                    {showFullPhone ? 'Hide' : 'Reveal'}
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
                <Phone size={16} color="#38BDF8" />
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
                <MessageCircle size={16} color="#34D399" />
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

          {profile.profileId ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Reset app password for ${profile.fullName}`}
              style={({ pressed }) => [
                {
                  marginTop: 4,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  paddingVertical: 12,
                  borderRadius: 12,
                  backgroundColor: '#E0F2FE',
                  borderWidth: 1,
                  borderColor: '#BAE6FD',
                },
                pressed && { opacity: 0.78 },
              ]}
              onPress={handleOpenResetPassword}>
              <KeyRound size={15} color={OwnerTheme.colors.primary} />
              <Text style={{ fontSize: 13, fontWeight: '700', color: OwnerTheme.colors.primary }}>
                Reset App Password
              </Text>
            </Pressable>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Delete ${profile.fullName} permanently`}
            style={({ pressed }) => [
              {
                marginTop: 4,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                paddingVertical: 12,
                borderRadius: 12,
                backgroundColor: '#FEF2F2',
                borderWidth: 1,
                borderColor: '#FECACA',
              },
              pressed && { opacity: 0.78 },
            ]}
            onPress={() => {
              Alert.alert(
                'Delete Resident Permanently?',
                `This will permanently delete ${profile.fullName} (Room ${profile.roomNumber}) and cannot be undone. Use Check Out if you want to preserve stay history.`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete Permanently',
                    style: 'destructive',
                    onPress: async () => {
                      try {
                        const { error } = await supabase
                          .from('residents')
                          .delete()
                          .eq('id', profile.id);
                        if (error) throw error;
                        void qc.invalidateQueries({ queryKey: queryKeys.residents.all });
                        void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
                        showToast(`Deleted ${profile.fullName}`);
                        if (router.canGoBack()) router.back();
                        else router.replace('/residents-directory');
                      } catch (err: unknown) {
                        Alert.alert(
                          'Delete Failed',
                          err instanceof Error
                            ? err.message
                            : 'Could not delete resident.'
                        );
                      }
                    },
                  },
                ]
              );
            }}>
            <Trash2 size={15} color="#DC2626" />
            <Text style={{ fontSize: 13, fontWeight: '700', color: '#DC2626' }}>
              Delete Resident Permanently
            </Text>
          </Pressable>
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

      {/* Reset Resident App Password Modal */}
      <Modal
        visible={resetPwdModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!resettingPwd) setResetPwdModalVisible(false);
        }}>
        <KeyboardAvoidingView
          style={{
            flex: 1,
            backgroundColor: 'rgba(15, 23, 42, 0.55)',
            justifyContent: 'center',
            padding: 20,
          }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View
            style={{
              backgroundColor: '#FFFFFF',
              borderRadius: 18,
              padding: 18,
              gap: 12,
            }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 17, fontWeight: '800', color: '#0F172A' }}>
                Reset Password
              </Text>
              <Pressable
                hitSlop={8}
                disabled={resettingPwd}
                onPress={() => setResetPwdModalVisible(false)}>
                <X size={20} color="#64748B" />
              </Pressable>
            </View>

            <Text style={{ fontSize: 12, color: '#64748B' }}>
              {profile.fullName} · Room {profile.roomNumber}
            </Text>

            {resetPwdResult ? (
              <>
                <View
                  style={{
                    backgroundColor: '#F8FAFC',
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: '#E2E8F0',
                    padding: 12,
                    gap: 4,
                  }}>
                  {resetPwdResult.email ? (
                    <Text style={{ fontSize: 12, color: '#475569' }} selectable>
                      Email: {resetPwdResult.email}
                    </Text>
                  ) : null}
                  <Text style={{ fontSize: 15, fontWeight: '800', color: '#0F172A' }} selectable>
                    New Password: {resetPwdResult.password}
                  </Text>
                </View>

                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {hasPhone ? (
                    <Pressable
                      style={{
                        flex: 1,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                        paddingVertical: 11,
                        borderRadius: 10,
                        backgroundColor: '#16A34A',
                      }}
                      onPress={() => {
                        const msg = `Hi ${profile.fullName}, your PGwala password has been reset.\n${
                          resetPwdResult.email ? `Email: ${resetPwdResult.email}\n` : ''
                        }New Password: ${resetPwdResult.password}`;
                        const url = buildWhatsAppReminderUrl(profile.phoneNumber, msg);
                        if (url) void Linking.openURL(url).catch(() => {});
                      }}>
                      <MessageCircle size={15} color="#FFFFFF" />
                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#FFFFFF' }}>
                        WhatsApp
                      </Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    style={{
                      flex: 1,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      paddingVertical: 11,
                      borderRadius: 10,
                      backgroundColor: OwnerTheme.colors.primary,
                    }}
                    onPress={() =>
                      void Share.share({
                        title: 'PGwala Password Reset',
                        message: `Hi ${profile.fullName}, your PGwala password has been reset.\n${
                          resetPwdResult.email ? `Email: ${resetPwdResult.email}\n` : ''
                        }New Password: ${resetPwdResult.password}`,
                      })
                    }>
                    <Share2 size={15} color="#FFFFFF" />
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#FFFFFF' }}>
                      Share
                    </Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  <TextInput
                    style={{
                      flex: 1,
                      borderWidth: 1,
                      borderColor: '#CBD5E1',
                      borderRadius: 10,
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      fontSize: 15,
                      fontWeight: '700',
                      color: '#0F172A',
                      backgroundColor: '#F8FAFC',
                    }}
                    value={resetPwdDraft}
                    onChangeText={setResetPwdDraft}
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!resettingPwd}
                  />
                  <Pressable
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 10,
                      backgroundColor: '#E0F2FE',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    onPress={() => setResetPwdDraft(generateResidentTempPassword())}>
                    <RefreshCw size={16} color={OwnerTheme.colors.primary} />
                  </Pressable>
                </View>

                <Pressable
                  disabled={resettingPwd}
                  style={{
                    backgroundColor: OwnerTheme.colors.primary,
                    borderRadius: 10,
                    paddingVertical: 12,
                    alignItems: 'center',
                    opacity: resettingPwd ? 0.6 : 1,
                  }}
                  onPress={() => void handleConfirmResetPassword()}>
                  {resettingPwd ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFFFFF' }}>
                      Set New Password
                    </Text>
                  )}
                </Pressable>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
    backgroundColor: '#0F172A',
    borderRadius: 18,
    padding: 16,
    gap: 12,
  },
  summaryTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  residentName: {
    fontSize: 21,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  roomBedSub: {
    fontSize: 13,
    fontWeight: '600',
    color: '#94A3B8',
    marginTop: 2,
  },
  summaryBadgeCol: {
    alignItems: 'flex-end',
    gap: 6,
  },
  heroFinanceRow: {
    flexDirection: 'row',
    gap: 8,
  },
  heroFinancePill: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  heroFinanceLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94A3B8',
  },
  heroFinanceValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
    marginTop: 2,
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
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
    color: '#F1F5F9',
  },
  phoneTogglePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  phoneToggleText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#38BDF8',
  },
  contactButtonsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  contactBtn: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  callBtn: {
    backgroundColor: 'rgba(56,189,248,0.14)',
    borderColor: 'rgba(56,189,248,0.3)',
  },
  callBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#38BDF8',
  },
  whatsappBtn: {
    backgroundColor: 'rgba(16,185,129,0.14)',
    borderColor: 'rgba(16,185,129,0.32)',
  },
  whatsappBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#34D399',
  },
  contactBtnDisabled: {
    opacity: 0.45,
  },
  pressedFade: {
    opacity: 0.78,
  },
  pressedSoft: {
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
});
