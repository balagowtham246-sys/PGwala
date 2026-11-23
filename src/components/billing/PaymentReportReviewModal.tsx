import React, { useState } from 'react';
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
import { Image } from 'expo-image';
import { X } from 'lucide-react-native';
import { OwnerTheme } from '@/constants/theme';
import {
  formatPaiseToRupees,
  PRESET_REJECTION_REASONS,
} from '@/lib/billing-utils';
import {
  PaymentMethod,
  ReviewPaymentItem,
} from '@/services/billing.service';

export interface PaymentReportReviewModalProps {
  visible: boolean;
  item: ReviewPaymentItem | null;
  signedUrl: string | null;
  loadingSignedUrl: boolean;
  showRejectForm: boolean;
  rejectionReason: string;
  confirmingPayment: boolean;
  rejectingPayment: boolean;
  onClose: () => void;
  onToggleRejectForm: (show: boolean) => void;
  onChangeRejectionReason: (reason: string) => void;
  onConfirmPayment: (
    chargeId: string,
    reportId: string,
    method: PaymentMethod
  ) => void;
  onRejectPayment: () => void;
}

export function PaymentReportReviewModal({
  visible,
  item,
  signedUrl,
  loadingSignedUrl,
  showRejectForm,
  rejectionReason,
  confirmingPayment,
  rejectingPayment,
  onClose,
  onToggleRejectForm,
  onChangeRejectionReason,
  onConfirmPayment,
  onRejectPayment,
}: PaymentReportReviewModalProps) {
  const [fullImageUrl, setFullImageUrl] = useState<string | null>(null);

  const handleClose = () => {
    setFullImageUrl(null);
    onClose();
  };

  return (
    <>
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={handleClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalHeading}>Review Payment Proof</Text>
              <Pressable hitSlop={8} onPress={handleClose}>
                <X size={20} color={OwnerTheme.colors.textSecondary} />
              </Pressable>
            </View>

            {item?.report && (
              <ScrollView
                style={{ maxHeight: 440 }}
                showsVerticalScrollIndicator={false}>
                <View style={styles.reviewSummaryBox}>
                  <Text style={styles.modalResName}>
                    {item.full_name} (Room {item.room_number})
                  </Text>
                  <Text style={styles.modalBillPeriod}>{item.bill_title}</Text>
                </View>

                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Claimed Amount</Text>
                  <Text style={styles.detailValueBold}>
                    {formatPaiseToRupees(item.report.amount_paise)}
                  </Text>
                </View>

                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Method</Text>
                  <Text style={styles.detailValue}>
                    {item.report.claimed_method === 'upi'
                      ? 'UPI / Online'
                      : 'Cash'}
                  </Text>
                </View>

                {item.report.reference_number ? (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Transaction Ref</Text>
                    <Text style={styles.detailValue}>
                      {item.report.reference_number}
                    </Text>
                  </View>
                ) : null}

                {item.report.notes ? (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Resident Note</Text>
                    <Text style={styles.detailValue}>{item.report.notes}</Text>
                  </View>
                ) : null}

                {item.report.screenshot_url ? (
                  <View style={styles.screenshotSection}>
                    <Text style={styles.detailLabel}>Attached Screenshot</Text>
                    <Pressable
                      style={styles.screenshotWrap}
                      onPress={() =>
                        setFullImageUrl(signedUrl || item.report.screenshot_url)
                      }>
                      {loadingSignedUrl ? (
                        <View
                          style={[
                            styles.screenshotThumb,
                            {
                              justifyContent: 'center',
                              alignItems: 'center',
                              backgroundColor: '#F1F5F9',
                            },
                          ]}>
                          <ActivityIndicator
                            size="small"
                            color={OwnerTheme.colors.primary}
                          />
                        </View>
                      ) : (
                        <Image
                          source={{
                            uri:
                              signedUrl ||
                              item.report.screenshot_url ||
                              undefined,
                          }}
                          style={styles.screenshotThumb}
                          contentFit="cover"
                          cachePolicy="memory-disk"
                          transition={150}
                        />
                      )}
                      <Text style={styles.tapToViewText}>
                        Tap to view full image
                      </Text>
                    </Pressable>
                  </View>
                ) : null}

                {/* Rejection Form Box */}
                {showRejectForm && (
                  <View style={styles.rejectionCard}>
                    <View style={styles.rejectionHeaderRow}>
                      <Text style={styles.rejectionHeaderTitle}>
                        Specify Rejection Reason
                      </Text>
                      <Pressable
                        hitSlop={8}
                        onPress={() => onToggleRejectForm(false)}>
                        <Text style={styles.rejectionCancelText}>Cancel</Text>
                      </Pressable>
                    </View>
                    <Text style={styles.rejectionHint}>
                      Select a reason or type feedback for the resident:
                    </Text>
                    <View style={styles.presetChipsWrap}>
                      {PRESET_REJECTION_REASONS.map((preset) => {
                        const isSelected = rejectionReason === preset;
                        return (
                          <Pressable
                            key={preset}
                            style={[
                              styles.presetChip,
                              isSelected && styles.presetChipSelected,
                            ]}
                            onPress={() => onChangeRejectionReason(preset)}>
                            <Text
                              style={[
                                styles.presetChipText,
                                isSelected && styles.presetChipTextSelected,
                              ]}>
                              {preset}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <TextInput
                      style={styles.rejectionInput}
                      value={rejectionReason}
                      onChangeText={onChangeRejectionReason}
                      placeholder="Type custom rejection reason..."
                      placeholderTextColor="#94A3B8"
                      multiline
                      numberOfLines={3}
                    />
                    <Pressable
                      style={[
                        styles.confirmRejectBtn,
                        (!rejectionReason.trim() || rejectingPayment) &&
                          styles.btnDisabled,
                      ]}
                      disabled={!rejectionReason.trim() || rejectingPayment}
                      onPress={onRejectPayment}>
                      {rejectingPayment ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Text style={styles.confirmRejectBtnText}>
                          Confirm Rejection
                        </Text>
                      )}
                    </Pressable>
                  </View>
                )}
              </ScrollView>
            )}

            {!showRejectForm && (
              <View style={styles.modalActions}>
                <Pressable style={styles.modalCancelBtn} onPress={handleClose}>
                  <Text style={styles.modalCancelBtnText}>Close</Text>
                </Pressable>
                <Pressable
                  style={styles.modalRejectBtn}
                  onPress={() => onToggleRejectForm(true)}>
                  <Text style={styles.modalRejectBtnText}>Reject Proof</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.modalConfirmBtn,
                    confirmingPayment && styles.btnDisabled,
                  ]}
                  disabled={confirmingPayment}
                  onPress={() => {
                    if (item?.charge_id && item.report?.id) {
                      onConfirmPayment(
                        item.charge_id,
                        item.report.id,
                        item.report.claimed_method
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
            )}
          </View>
        </KeyboardAvoidingView>
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
            <Text style={styles.fullImageCloseText}>Close</Text>
          </Pressable>
          {fullImageUrl && (
            <Image
              source={{ uri: fullImageUrl }}
              style={{ width: '92%', height: '80%' }}
              contentFit="contain"
              cachePolicy="memory-disk"
              transition={150}
            />
          )}
        </View>
      </Modal>
    </>
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
  modalActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 12,
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
  modalRejectBtn: {
    height: 44,
    paddingHorizontal: 14,
    borderRadius: OwnerTheme.radius.md,
    borderWidth: 1,
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalRejectBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#DC2626',
  },
  rejectionCard: {
    marginTop: 14,
    padding: 12,
    backgroundColor: '#FEF2F2',
    borderRadius: OwnerTheme.radius.md,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  rejectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  rejectionHeaderTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#991B1B',
  },
  rejectionCancelText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  rejectionHint: {
    fontSize: 12,
    color: '#7F1D1D',
    marginBottom: 10,
    lineHeight: 16,
  },
  presetChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  presetChip: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: OwnerTheme.radius.full,
    borderWidth: 1,
    borderColor: '#FCA5A5',
    backgroundColor: '#FFFFFF',
  },
  presetChipSelected: {
    backgroundColor: '#DC2626',
    borderColor: '#DC2626',
  },
  presetChipText: {
    fontSize: 12,
    color: '#991B1B',
    fontWeight: '500',
  },
  presetChipTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  rejectionInput: {
    minHeight: 64,
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: OwnerTheme.radius.md,
    padding: 10,
    fontSize: 13,
    color: '#0F172A',
    backgroundColor: '#FFFFFF',
    marginBottom: 12,
    textAlignVertical: 'top',
  },
  confirmRejectBtn: {
    height: 40,
    borderRadius: OwnerTheme.radius.md,
    backgroundColor: '#DC2626',
    justifyContent: 'center',
    alignItems: 'center',
  },
  confirmRejectBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
