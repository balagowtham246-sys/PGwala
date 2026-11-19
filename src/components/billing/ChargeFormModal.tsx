import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { X } from 'lucide-react-native';
import { OwnerTheme } from '@/constants/theme';
import {
  ResidentRentBillItem,
  RoomResidentInfo,
} from '@/services/billing.service';

export type ChargeFormModalProps =
  | {
      mode: 'generate-rent';
      visible: boolean;
      monthLabel: string;
      rentInputRupees: string;
      onChangeRentInputRupees: (value: string) => void;
      submitting: boolean;
      onClose: () => void;
      onConfirm: () => void;
    }
  | {
      mode: 'edit-rent';
      visible: boolean;
      monthLabel: string;
      resident: ResidentRentBillItem | null;
      rentInputRupees: string;
      onChangeRentInputRupees: (value: string) => void;
      submitting: boolean;
      onClose: () => void;
      onConfirm: () => void;
    }
  | {
      mode: 'split-eb';
      visible: boolean;
      availableRooms: string[];
      selectedRoom: string;
      onSelectRoom: (room: string) => void;
      ebTotalRupeesInput: string;
      onChangeEbTotalRupeesInput: (value: string) => void;
      allResidents: RoomResidentInfo[];
      submitting: boolean;
      onClose: () => void;
      onConfirm: () => void;
    };

export function ChargeFormModal(props: ChargeFormModalProps) {
  const { mode, visible, submitting, onClose, onConfirm } = props;

  const heading =
    mode === 'generate-rent'
      ? 'Update Monthly Rent'
      : mode === 'edit-rent'
      ? 'Edit Resident Rent'
      : 'Split Electricity Bill';

  const confirmLabel =
    mode === 'generate-rent'
      ? 'Apply & Save'
      : mode === 'edit-rent'
      ? 'Save'
      : 'Split & Send';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeaderRow}>
            <Text style={styles.modalHeading}>{heading}</Text>
            <Pressable hitSlop={8} onPress={onClose}>
              <X size={20} color={OwnerTheme.colors.textSecondary} />
            </Pressable>
          </View>

          {mode === 'generate-rent' && (
            <>
              <Text style={styles.modalExplanation}>
                Set default room rent for {props.monthLabel}. Existing unpaid
                rent bills for {props.monthLabel} will be updated automatically.
                Paid bills are preserved.
              </Text>

              <Text style={styles.inputFieldLabel}>
                Monthly Room Rent Amount (₹)
              </Text>
              <TextInput
                style={styles.inputBox}
                value={props.rentInputRupees}
                onChangeText={props.onChangeRentInputRupees}
                placeholder="e.g. 8000"
                placeholderTextColor={OwnerTheme.colors.textMuted}
                keyboardType="numeric"
              />
            </>
          )}

          {mode === 'edit-rent' && props.resident && (
            <>
              <Text style={styles.modalExplanation}>
                Adjust rent for {props.resident.full_name} (Room{' '}
                {props.resident.room_number}). Unpaid bill for{' '}
                {props.monthLabel} will update automatically.
              </Text>

              <Text style={styles.inputFieldLabel}>
                Monthly Rent Amount (₹)
              </Text>
              <TextInput
                style={styles.inputBox}
                value={props.rentInputRupees}
                onChangeText={props.onChangeRentInputRupees}
                placeholder="e.g. 9000"
                placeholderTextColor={OwnerTheme.colors.textMuted}
                keyboardType="numeric"
              />
            </>
          )}

          {mode === 'split-eb' && (
            <ScrollView
              style={{ maxHeight: 380 }}
              showsVerticalScrollIndicator={false}>
              <Text style={styles.inputFieldLabel}>Select Room Number</Text>
              <View style={styles.roomChipsWrap}>
                {props.availableRooms.map((rm) => (
                  <Pressable
                    key={rm}
                    style={[
                      styles.roomChip,
                      props.selectedRoom === rm && styles.roomChipSelected,
                    ]}
                    onPress={() => props.onSelectRoom(rm)}>
                    <Text
                      style={[
                        styles.roomChipText,
                        props.selectedRoom === rm &&
                          styles.roomChipTextSelected,
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
                value={props.ebTotalRupeesInput}
                onChangeText={props.onChangeEbTotalRupeesInput}
                placeholder="e.g. 1200"
                placeholderTextColor={OwnerTheme.colors.textMuted}
                keyboardType="numeric"
              />

              {props.selectedRoom ? (
                <View style={styles.ebSplitPreviewBox}>
                  <Text style={styles.ebPreviewTitle}>
                    Occupants in Room {props.selectedRoom}:
                  </Text>
                  {(() => {
                    const roomOccupants = props.allResidents.filter(
                      (r) => r.room_number === props.selectedRoom
                    );
                    if (roomOccupants.length === 0) {
                      return (
                        <Text style={styles.noOccupantsText}>
                          No active residents currently assigned to Room{' '}
                          {props.selectedRoom}.
                        </Text>
                      );
                    }
                    const totalRs =
                      parseFloat(props.ebTotalRupeesInput.trim()) || 0;
                    const perPerson =
                      totalRs > 0
                        ? (totalRs / roomOccupants.length).toFixed(0)
                        : '0';
                    return roomOccupants.map((r) => (
                      <View key={r.id} style={styles.ebPreviewRow}>
                        <Text style={styles.ebPreviewName}>
                          • {r.full_name}
                        </Text>
                        <Text style={styles.ebPreviewShare}>₹{perPerson}</Text>
                      </View>
                    ));
                  })()}
                </View>
              ) : null}
            </ScrollView>
          )}

          {(mode !== 'edit-rent' || props.resident) && (
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancelBtn} onPress={onClose}>
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.modalConfirmBtn,
                  mode === 'split-eb' && {
                    backgroundColor: OwnerTheme.colors.warning,
                  },
                  submitting && styles.btnDisabled,
                ]}
                disabled={submitting}
                onPress={onConfirm}>
                {submitting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalConfirmBtnText}>
                    {confirmLabel}
                  </Text>
                )}
              </Pressable>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
});
