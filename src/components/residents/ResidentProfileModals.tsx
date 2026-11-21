import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Calendar, X } from 'lucide-react-native';

import { RoomBedPicker } from '@/components/residents/RoomBedPicker';
import { CalendarDatePickerModal } from '@/components/ui/calendar-date-picker-modal';
import {
  DestructiveButton,
  HIGH_CONTRAST_SWITCH_COLORS,
  OwnerSharedStyles,
  PrimaryButton,
  SecondaryButton,
  SWITCH_THUMB_COLOR,
} from '@/components/ui/owner';
import { OwnerTheme } from '@/constants/theme';
import { formatPaiseToRupees } from '@/lib/billing-utils';
import { triggerSelectionHaptic } from '@/lib/haptics';
import { formatIsoDateDisplay, toSentenceCaseStatus } from '@/lib/ux-utils';
import { PaymentMethod } from '@/services/billing.service';
import { ResidentProfileData } from '@/services/residents.service';

export function ResidentRoomChangeModal({
  visible,
  savingRoom,
  roomBedDisplay,
  profile,
  draftRoomNumber,
  draftBedLabel,
  roomPickerRefreshSignal,
  onSelectRoomBed,
  onSave,
  onClose,
}: {
  visible: boolean;
  savingRoom: boolean;
  roomBedDisplay: string;
  profile: ResidentProfileData;
  draftRoomNumber: string;
  draftBedLabel: string;
  roomPickerRefreshSignal: number;
  onSelectRoomBed: (room: string, bed: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={() => {
        if (!savingRoom) onClose();
      }}>
      <View style={OwnerSharedStyles.sheetOverlay}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {
            if (!savingRoom) onClose();
          }}
        />
        <View style={styles.sheetModalCard}>
          <View style={styles.modalHeaderRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalTitle}>Change Room & Bed</Text>
              <Text style={styles.modalSubtitle}>Current: {roomBedDisplay}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close room picker"
              hitSlop={10}
              disabled={savingRoom}
              onPress={onClose}
              style={styles.modalCloseBtn}>
              <X size={18} color={OwnerTheme.colors.textSecondary} />
            </Pressable>
          </View>

          <ScrollView style={styles.roomPickerScroll} showsVerticalScrollIndicator={false}>
            <RoomBedPicker
              propertyId={profile.propertyId}
              propertyGender={profile.propertyGender}
              residentGender={profile.gender ?? 'male'}
              selectedRoomNumber={draftRoomNumber}
              selectedBedLabel={draftBedLabel}
              excludeResidentId={profile.id}
              refreshSignal={roomPickerRefreshSignal}
              onSelect={onSelectRoomBed}
            />
          </ScrollView>

          <View style={styles.modalFooterRow}>
            <SecondaryButton
              label="Cancel"
              disabled={savingRoom}
              onPress={onClose}
              style={{ flex: 1 }}
            />
            <PrimaryButton
              label="Save Room"
              loading={savingRoom}
              disabled={!draftRoomNumber || !draftBedLabel}
              onPress={onSave}
              style={{ flex: 1.5 }}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function ResidentRecordPaymentModal({
  visible,
  confirmingPayment,
  firstUnpaidCharge,
  paymentMethod,
  onSelectMethod,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  confirmingPayment: boolean;
  firstUnpaidCharge: ResidentProfileData['recentCharges'][number] | null;
  paymentMethod: PaymentMethod;
  onSelectMethod: (method: PaymentMethod) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!confirmingPayment) onClose();
      }}>
      <View style={styles.centerModalOverlay}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {
            if (!confirmingPayment) onClose();
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
              onPress={onClose}
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
                      style={[styles.methodChip, active && styles.methodChipActive]}
                      onPress={() => {
                        triggerSelectionHaptic();
                        onSelectMethod(method);
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
                  onPress={onClose}
                  style={{ flex: 1 }}
                />
                <PrimaryButton
                  label="Confirm Paid"
                  loading={confirmingPayment}
                  onPress={onConfirm}
                  style={{ flex: 1.4 }}
                />
              </View>
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

export function ResidentCheckoutModal({
  checkoutModalMode,
  checkingOut,
  profile,
  leavingDateIso,
  generateFinalBill,
  proRataFinalBillPaise,
  onOpenDatePicker,
  onSelectLeavingDate,
  onToggleGenerateFinalBill,
  onConfirmCheckout,
  onBackToConfirm,
  onClose,
}: {
  checkoutModalMode: 'closed' | 'confirm' | 'date_picker';
  checkingOut: boolean;
  profile: ResidentProfileData;
  leavingDateIso: string;
  generateFinalBill: boolean;
  proRataFinalBillPaise: number;
  onOpenDatePicker: () => void;
  onSelectLeavingDate: (iso: string) => void;
  onToggleGenerateFinalBill: (val: boolean) => void;
  onConfirmCheckout: () => void;
  onBackToConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <Modal
        visible={checkoutModalMode === 'confirm'}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!checkingOut) onClose();
        }}>
        <View style={styles.centerModalOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              if (!checkingOut) onClose();
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
                onPress={onClose}
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
              onPress={onOpenDatePicker}>
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
                onValueChange={onToggleGenerateFinalBill}
                trackColor={HIGH_CONTRAST_SWITCH_COLORS}
                thumbColor={SWITCH_THUMB_COLOR}
              />
            </View>

            <View style={styles.modalFooterRow}>
              <SecondaryButton
                label="Cancel"
                disabled={checkingOut}
                onPress={onClose}
                style={{ flex: 1 }}
              />
              <DestructiveButton
                label="Confirm Check Out"
                loading={checkingOut}
                onPress={onConfirmCheckout}
                style={{ flex: 1.5 }}
              />
            </View>
          </View>
        </View>
      </Modal>

      <CalendarDatePickerModal
        visible={checkoutModalMode === 'date_picker'}
        value={leavingDateIso}
        title="Select Leaving Date"
        onSelect={onSelectLeavingDate}
        onClose={onBackToConfirm}
      />
    </>
  );
}

const styles = StyleSheet.create({
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
