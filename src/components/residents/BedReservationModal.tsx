import React, { useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  BookmarkPlus,
  Calendar,
  MessageCircle,
  Phone,
  Trash2,
  UserPlus,
} from 'lucide-react-native';

import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { CalendarDatePickerModal } from '@/components/ui/calendar-date-picker-modal';
import { OwnerSharedStyles, PrimaryButton } from '@/components/ui/owner';
import { OwnerTheme } from '@/constants/theme';
import {
  buildWhatsAppReminderUrl,
  formatPaiseToRupees,
} from '@/lib/billing-utils';
import {
  formatLocalIsoDate,
  isValidIsoDate,
  validateIndianPhone,
} from '@/lib/ux-utils';
import { BedReservation } from '@/services/bed-reservations.service';

export interface FreeBedTarget {
  roomNumber: string;
  bedLabel: string;
}

interface FreeBedActionModalProps {
  visible: boolean;
  target: FreeBedTarget | null;
  saving: boolean;
  onClose: () => void;
  onAddResident: (roomNumber: string, bedLabel: string) => void;
  onReserveBed: (input: {
    roomNumber: string;
    bedLabel: string;
    prospectName: string;
    phoneNumber: string;
    expectedJoinDate: string;
    tokenAdvancePaise: number;
  }) => Promise<void>;
}

export function FreeBedActionModal({
  visible,
  target,
  saving,
  onClose,
  onAddResident,
  onReserveBed,
}: FreeBedActionModalProps) {
  const [showReserveForm, setShowReserveForm] = useState(false);
  const [prospectName, setProspectName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [expectedJoinDate, setExpectedJoinDate] = useState(() =>
    formatLocalIsoDate()
  );
  const [tokenAdvance, setTokenAdvance] = useState('');
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const resetAndClose = () => {
    setShowReserveForm(false);
    setProspectName('');
    setPhoneNumber('');
    setExpectedJoinDate(formatLocalIsoDate());
    setTokenAdvance('');
    setFormError(null);
    onClose();
  };

  if (!target) return null;

  const handleConfirmReserve = async () => {
    const trimmedName = prospectName.trim();
    const phoneCheck = validateIndianPhone(phoneNumber);
    const trimmedDate = expectedJoinDate.trim();
    const rawAdv = tokenAdvance.trim();
    const advNum = rawAdv ? Number(rawAdv) : 0;

    if (!trimmedName) {
      setFormError('Enter prospect name.');
      return;
    }
    if (!phoneCheck.valid) {
      setFormError(phoneCheck.error || 'Enter a valid 10-digit mobile number.');
      return;
    }
    if (!isValidIsoDate(trimmedDate)) {
      setFormError('Select a valid joining date.');
      return;
    }
    if (!Number.isFinite(advNum) || advNum < 0) {
      setFormError('Enter a valid token advance amount.');
      return;
    }

    setFormError(null);
    try {
      await onReserveBed({
        roomNumber: target.roomNumber,
        bedLabel: target.bedLabel,
        prospectName: trimmedName,
        phoneNumber: phoneCheck.normalized10,
        expectedJoinDate: trimmedDate,
        tokenAdvancePaise: Math.round(advNum * 100),
      });
      setShowReserveForm(false);
      setProspectName('');
      setPhoneNumber('');
      setExpectedJoinDate(formatLocalIsoDate());
      setTokenAdvance('');
      setFormError(null);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Could not reserve this bed.';
      setFormError(msg);
    }
  };

  return (
    <>
      <BottomSheetModal
        visible={visible}
        onClose={resetAndClose}
        title={`Room ${target.roomNumber} · ${target.bedLabel}`}
        headerBadge={
          <View style={styles.freePill}>
            <Text style={styles.freePillText}>Free</Text>
          </View>
        }
        disabled={saving}
        maxHeight="85%">
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled">
            {!showReserveForm ? (
              <View style={styles.actionStack}>
                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.choiceCard,
                    styles.choiceCardPrimary,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => {
                    const { roomNumber: rn, bedLabel: bl } = target;
                    resetAndClose();
                    onAddResident(rn, bl);
                  }}>
                  <View style={[styles.choiceIcon, { backgroundColor: '#DBEAFE' }]}>
                    <UserPlus size={18} color="#1D4ED8" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.choiceTitle}>Add Resident</Text>
                    <Text style={styles.choiceSub}>
                      Pre-filled for Room {target.roomNumber}, {target.bedLabel}
                    </Text>
                  </View>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.choiceCard,
                    styles.choiceCardPurple,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => setShowReserveForm(true)}>
                  <View style={[styles.choiceIcon, { backgroundColor: '#EDE9FE' }]}>
                    <BookmarkPlus size={18} color="#6D28D9" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.choiceTitle}>Reserve Bed</Text>
                    <Text style={styles.choiceSub}>
                      Hold bed with join date & optional token advance
                    </Text>
                  </View>
                </Pressable>
              </View>
            ) : (
              <View style={styles.formWrap}>
                {formError ? (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorText}>{formError}</Text>
                  </View>
                ) : null}

                <View style={styles.fieldGroup}>
                  <Text style={OwnerSharedStyles.inputLabel}>Name *</Text>
                  <TextInput
                    style={OwnerSharedStyles.textInput}
                    value={prospectName}
                    onChangeText={setProspectName}
                    placeholder="e.g. Karthik S"
                    placeholderTextColor={OwnerTheme.colors.textMuted}
                    autoCapitalize="words"
                  />
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={OwnerSharedStyles.inputLabel}>Phone *</Text>
                  <TextInput
                    style={OwnerSharedStyles.textInput}
                    value={phoneNumber}
                    onChangeText={setPhoneNumber}
                    placeholder="10-digit mobile number"
                    placeholderTextColor={OwnerTheme.colors.textMuted}
                    keyboardType="phone-pad"
                    maxLength={14}
                  />
                </View>

                <View style={styles.twoColRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={OwnerSharedStyles.inputLabel}>Join Date *</Text>
                    <Pressable
                      accessibilityRole="button"
                      style={styles.dateBtn}
                      onPress={() => setDatePickerVisible(true)}>
                      <Calendar size={15} color={OwnerTheme.colors.textSecondary} />
                      <Text style={styles.dateBtnText}>{expectedJoinDate}</Text>
                    </Pressable>
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={OwnerSharedStyles.inputLabel}>Token Advance (₹)</Text>
                    <TextInput
                      style={OwnerSharedStyles.textInput}
                      value={tokenAdvance}
                      onChangeText={setTokenAdvance}
                      placeholder="0"
                      placeholderTextColor={OwnerTheme.colors.textMuted}
                      keyboardType="numeric"
                    />
                  </View>
                </View>

                <View style={styles.formBtnRow}>
                  <Pressable
                    accessibilityRole="button"
                    style={styles.backTextBtn}
                    onPress={() => setShowReserveForm(false)}>
                    <Text style={styles.backTextBtnLabel}>Back</Text>
                  </Pressable>
                  <View style={{ flex: 1 }}>
                    <PrimaryButton
                      label={saving ? 'Reserving...' : 'Reserve Bed'}
                      loading={saving}
                      disabled={saving}
                      onPress={() => void handleConfirmReserve()}
                    />
                  </View>
                </View>
              </View>
            )}
          </ScrollView>
      </BottomSheetModal>

      <CalendarDatePickerModal
        visible={datePickerVisible}
        value={expectedJoinDate}
        title="Expected Join Date"
        onSelect={(iso) => {
          setExpectedJoinDate(iso);
          setDatePickerVisible(false);
        }}
        onClose={() => setDatePickerVisible(false)}
      />
    </>
  );
}

interface ReservedBedDetailModalProps {
  visible: boolean;
  reservation: BedReservation | null;
  cancelling: boolean;
  onClose: () => void;
  onConvertToResident: (reservation: BedReservation) => void;
  onCancelReservation: (reservation: BedReservation) => Promise<void>;
}

export function ReservedBedDetailModal({
  visible,
  reservation,
  cancelling,
  onClose,
  onConvertToResident,
  onCancelReservation,
}: ReservedBedDetailModalProps) {
  if (!reservation) return null;

  const phoneDigits = reservation.phone_number.replace(/\D/g, '');

  const handleCancelPress = () => {
    Alert.alert(
      'Cancel Reservation?',
      `Free up Room ${reservation.room_number}, ${reservation.bed_label} currently held for ${reservation.prospect_name}?`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Cancel Reservation',
          style: 'destructive',
          onPress: () => {
            void onCancelReservation(reservation);
          },
        },
      ]
    );
  };

  return (
    <BottomSheetModal
      visible={visible}
      onClose={onClose}
      title={`Room ${reservation.room_number} · ${reservation.bed_label}`}
      headerBadge={
        <View style={styles.reservedPill}>
          <Text style={styles.reservedPillText}>Reserved</Text>
        </View>
      }
      disabled={cancelling}
      maxHeight="85%">
      <View style={styles.summaryCard}>
            <View style={styles.summaryTopRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.prospectName}>{reservation.prospect_name}</Text>
                <Text style={styles.prospectPhone}>{reservation.phone_number}</Text>
              </View>
              {phoneDigits.length >= 10 && (
                <View style={styles.contactRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`WhatsApp ${reservation.prospect_name}`}
                    style={[styles.iconCircle, { backgroundColor: '#DCFCE7' }]}
                    onPress={() => {
                      const url = buildWhatsAppReminderUrl(
                        reservation.phone_number,
                        `Hi ${reservation.prospect_name}, your bed (Room ${reservation.room_number}, ${reservation.bed_label}) is reserved for ${reservation.expected_join_date}.`
                      );
                      if (url) {
                        Linking.openURL(url).catch(() => {
                          Alert.alert('WhatsApp Unavailable', 'Could not open WhatsApp.');
                        });
                      }
                    }}>
                    <MessageCircle size={15} color="#15803D" />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Call ${reservation.prospect_name}`}
                    style={[
                      styles.iconCircle,
                      { backgroundColor: OwnerTheme.colors.primaryLight },
                    ]}
                    onPress={() => {
                      Linking.openURL(`tel:${phoneDigits}`).catch(() => {
                        Alert.alert('Unable to Call', 'Could not open the phone dialer.');
                      });
                    }}>
                    <Phone size={15} color={OwnerTheme.colors.primary} />
                  </Pressable>
                </View>
              )}
            </View>

            <View style={styles.metaGrid}>
              <View style={styles.metaCell}>
                <Text style={styles.metaLabel}>Join Date</Text>
                <Text style={styles.metaValue}>{reservation.expected_join_date}</Text>
              </View>
              <View style={styles.metaCell}>
                <Text style={styles.metaLabel}>Token Advance</Text>
                <Text style={styles.metaValue}>
                  {reservation.token_advance_paise > 0
                    ? formatPaiseToRupees(reservation.token_advance_paise)
                    : '₹0'}
                </Text>
              </View>
            </View>
          </View>

          <PrimaryButton
            label="Convert to Resident"
            onPress={() => {
              onClose();
              onConvertToResident(reservation);
            }}
          />

          <Pressable
            accessibilityRole="button"
            disabled={cancelling}
            style={({ pressed }) => [
              styles.cancelBtn,
              pressed && styles.pressed,
              cancelling && { opacity: 0.6 },
            ]}
            onPress={handleCancelPress}>
            <Trash2 size={15} color={OwnerTheme.colors.danger} />
            <Text style={styles.cancelBtnText}>
              {cancelling ? 'Cancelling...' : 'Cancel Reservation'}
            </Text>
          </Pressable>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  backdrop: {
    flex: 1,
  },
  sheet: {
    backgroundColor: OwnerTheme.colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 28,
    maxHeight: '85%',
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: OwnerTheme.colors.border,
    alignSelf: 'center',
    marginBottom: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: OwnerTheme.colors.textPrimary,
  },
  freePill: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  freePillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#15803D',
  },
  reservedPill: {
    backgroundColor: '#EDE9FE',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  reservedPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6D28D9',
  },
  actionStack: {
    gap: 10,
  },
  choiceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
  },
  choiceCardPrimary: {
    backgroundColor: '#F8FAFC',
    borderColor: '#BFDBFE',
  },
  choiceCardPurple: {
    backgroundColor: '#FAF5FF',
    borderColor: '#DDD6FE',
  },
  choiceIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  choiceSub: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 2,
  },
  pressed: {
    opacity: 0.78,
  },
  formWrap: {
    gap: 12,
  },
  errorBox: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  errorText: {
    fontSize: 12,
    fontWeight: '600',
    color: OwnerTheme.colors.danger,
  },
  fieldGroup: {
    gap: 4,
  },
  twoColRow: {
    flexDirection: 'row',
    gap: 10,
  },
  dateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    backgroundColor: OwnerTheme.colors.background,
    paddingHorizontal: 12,
  },
  dateBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  formBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  backTextBtn: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
  },
  backTextBtnLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: OwnerTheme.colors.textSecondary,
  },
  summaryCard: {
    backgroundColor: OwnerTheme.colors.background,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.borderLight,
    padding: 14,
    marginBottom: 16,
  },
  summaryTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  prospectName: {
    fontSize: 16,
    fontWeight: '800',
    color: OwnerTheme.colors.textPrimary,
  },
  prospectPhone: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
    marginTop: 2,
  },
  contactRow: {
    flexDirection: 'row',
    gap: 8,
  },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaGrid: {
    flexDirection: 'row',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: OwnerTheme.colors.borderLight,
    paddingTop: 10,
  },
  metaCell: {
    flex: 1,
  },
  metaLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: OwnerTheme.colors.textMuted,
  },
  metaValue: {
    fontSize: 14,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
    marginTop: 2,
  },
  cancelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: OwnerTheme.colors.danger,
  },
});
