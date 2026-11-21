import React from 'react';
import {
  ActivityIndicator,
  Image,
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
import { Camera, X } from 'lucide-react-native';
import { useModalBackHandler } from '@/hooks/use-modal-back-handler';
import { formatPaiseToRupees } from '@/lib/billing-utils';
import {
  PaymentMethod,
  StudentBillCardItem,
} from '@/services/billing.service';

export interface SelectedScreenshotAsset {
  uri: string;
  base64?: string | null;
}

export interface PaymentProofModalProps {
  visible: boolean;
  selectedBill: StudentBillCardItem | null;
  currentRentBill: StudentBillCardItem | null;
  currentEbBill: StudentBillCardItem | null;
  paymentMethod: PaymentMethod;
  referenceNumber: string;
  studentNotes: string;
  selectedScreenshot: SelectedScreenshotAsset | null;
  submitting: boolean;
  onClose: () => void;
  onSelectBill: (bill: StudentBillCardItem) => void;
  onChangePaymentMethod: (method: PaymentMethod) => void;
  onChangeReferenceNumber: (value: string) => void;
  onChangeStudentNotes: (value: string) => void;
  onPickScreenshot: () => void;
  onSubmit: () => void;
}

export function PaymentProofModal({
  visible,
  selectedBill,
  currentRentBill,
  currentEbBill,
  paymentMethod,
  referenceNumber,
  studentNotes,
  selectedScreenshot,
  submitting,
  onClose,
  onSelectBill,
  onChangePaymentMethod,
  onChangeReferenceNumber,
  onChangeStudentNotes,
  onPickScreenshot,
  onSubmit,
}: PaymentProofModalProps) {
  useModalBackHandler(visible, onClose, submitting);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={() => {
        if (!submitting) onClose();
      }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Send Payment Proof</Text>
            <Pressable hitSlop={8} onPress={onClose}>
              <X size={20} color="#64748B" />
            </Pressable>
          </View>

          <ScrollView
            style={{ maxHeight: 440 }}
            showsVerticalScrollIndicator={false}>
            {/* Switch between unpaid Rent & EB when both are pending */}
            {currentRentBill &&
              currentEbBill &&
              currentRentBill.status !== 'paid' &&
              currentEbBill.status !== 'paid' && (
                <View style={[styles.methodToggleRow, { marginBottom: 12 }]}>
                  {[currentRentBill, currentEbBill].map((billOpt) => {
                    const active =
                      selectedBill?.charge_id === billOpt.charge_id;
                    return (
                      <Pressable
                        key={billOpt.charge_id}
                        style={[
                          styles.methodBtn,
                          active && styles.methodBtnActive,
                        ]}
                        onPress={() => onSelectBill(billOpt)}>
                        <Text
                          style={[
                            styles.methodBtnText,
                            active && styles.methodBtnTextActive,
                          ]}>
                          {billOpt.category === 'rent' ? 'Rent' : 'EB'} (
                          {formatPaiseToRupees(billOpt.total_paise)})
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}

            {/* Bill Details */}
            <View style={styles.modalBillBanner}>
              <Text style={styles.modalBillBannerTitle}>
                {selectedBill?.title} • {selectedBill?.month_label}
              </Text>
              <Text style={styles.modalBillBannerAmount}>
                Amount to Pay:{' '}
                {formatPaiseToRupees(selectedBill?.total_paise || 0)}
              </Text>
            </View>

            {/* Previous Rejection Alert (if resubmitting) */}
            {selectedBill?.pending_report?.status === 'rejected' && (
              <View style={[styles.rejectedReportBox, { marginBottom: 14 }]}>
                <Text style={styles.rejectedReportTitle}>
                  Previous Submission Rejected
                </Text>
                <Text style={styles.rejectedReasonText}>
                  Feedback:{' '}
                  {selectedBill.pending_report.rejection_reason ||
                    'Verification failed.'}
                </Text>
                <Text style={styles.rejectedHelpText}>
                  Please upload an updated screenshot or enter a valid reference
                  number below.
                </Text>
              </View>
            )}

            {/* Method Selector: UPI vs Cash */}
            <Text style={styles.inputLabel}>How did you pay?</Text>
            <View style={styles.methodToggleRow}>
              <Pressable
                style={[
                  styles.methodBtn,
                  paymentMethod === 'upi' && styles.methodBtnActive,
                ]}
                onPress={() => onChangePaymentMethod('upi')}>
                <Text
                  style={[
                    styles.methodBtnText,
                    paymentMethod === 'upi' && styles.methodBtnTextActive,
                  ]}>
                  UPI / Online
                </Text>
              </Pressable>

              <Pressable
                style={[
                  styles.methodBtn,
                  paymentMethod === 'cash' && styles.methodBtnActive,
                ]}
                onPress={() => onChangePaymentMethod('cash')}>
                <Text
                  style={[
                    styles.methodBtnText,
                    paymentMethod === 'cash' && styles.methodBtnTextActive,
                  ]}>
                  Paid by Cash
                </Text>
              </Pressable>
            </View>

            {paymentMethod === 'upi' ? (
              <>
                {/* Screenshot Picker */}
                <Text style={styles.inputLabel}>Payment Screenshot Proof</Text>
                {selectedScreenshot ? (
                  <View style={styles.pickedImageCard}>
                    <Image
                      source={{ uri: selectedScreenshot.uri }}
                      style={styles.pickedThumb}
                      resizeMode="cover"
                    />
                    <Pressable
                      style={styles.changePicBtn}
                      onPress={onPickScreenshot}>
                      <Text style={styles.changePicBtnText}>
                        Change Screenshot
                      </Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    style={styles.uploadPhotoBtn}
                    onPress={onPickScreenshot}>
                    <Camera
                      size={24}
                      color="#0284C7"
                      style={{ marginBottom: 6 }}
                    />
                    <Text style={styles.uploadPhotoText}>
                      Upload Payment Screenshot
                    </Text>
                    <Text style={styles.uploadPhotoSub}>
                      From photo gallery or camera
                    </Text>
                  </Pressable>
                )}

                {/* Transaction / Reference ID */}
                <Text style={styles.inputLabel}>
                  UPI Transaction ID / Ref No. (Optional)
                </Text>
                <TextInput
                  style={styles.inputBox}
                  placeholder="e.g. 123456789012"
                  placeholderTextColor="#94A3B8"
                  value={referenceNumber}
                  onChangeText={onChangeReferenceNumber}
                />
              </>
            ) : (
              <View style={styles.cashNoticeBox}>
                <Text style={styles.cashNoticeText}>
                  Select this option if you handed cash directly to the PG owner
                  or caretaker in person.
                </Text>
              </View>
            )}

            {/* Notes */}
            <Text style={styles.inputLabel}>Note to Owner (Optional)</Text>
            <TextInput
              style={[styles.inputBox, styles.textArea]}
              placeholder={
                paymentMethod === 'cash'
                  ? 'e.g. Handed cash to warden in the evening'
                  : 'e.g. Paid via Google Pay'
              }
              placeholderTextColor="#94A3B8"
              value={studentNotes}
              onChangeText={onChangeStudentNotes}
              multiline
              numberOfLines={2}
            />
          </ScrollView>

          {/* Modal Actions */}
          <View style={styles.modalActionButtons}>
            <Pressable
              style={[styles.submitProofBtn, submitting && styles.disabledBtn]}
              disabled={submitting}
              onPress={onSubmit}>
              {submitting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.submitProofBtnText}>
                  Submit Payment Proof
                </Text>
              )}
            </Pressable>

            <Pressable style={styles.cancelModalBtn} onPress={onClose}>
              <Text style={styles.cancelModalBtnText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 36,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalBillBanner: {
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },
  modalBillBannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E40AF',
  },
  modalBillBannerAmount: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0284C7',
    marginTop: 2,
  },
  rejectedReportBox: {
    marginTop: 14,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  rejectedReportTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#B91C1C',
  },
  rejectedReasonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#991B1B',
    lineHeight: 18,
  },
  rejectedHelpText: {
    fontSize: 12,
    color: '#7F1D1D',
    lineHeight: 16,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
    marginTop: 8,
  },
  methodToggleRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  methodBtn: {
    flex: 1,
    paddingVertical: 10,
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  methodBtnActive: {
    backgroundColor: '#E0F2FE',
    borderColor: '#0284C7',
  },
  methodBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  methodBtnTextActive: {
    color: '#0284C7',
    fontWeight: '700',
  },
  uploadPhotoBtn: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    borderStyle: 'dashed',
    padding: 16,
    alignItems: 'center',
    marginVertical: 6,
  },
  uploadPhotoText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0284C7',
    marginTop: 4,
  },
  uploadPhotoSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  pickedImageCard: {
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginVertical: 6,
  },
  pickedThumb: {
    width: '100%',
    height: 120,
  },
  changePicBtn: {
    backgroundColor: '#F1F5F9',
    paddingVertical: 8,
    alignItems: 'center',
  },
  changePicBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0284C7',
  },
  inputBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: '#0F172A',
  },
  textArea: {
    minHeight: 56,
    textAlignVertical: 'top',
  },
  cashNoticeBox: {
    backgroundColor: '#FFFBEB',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#FDE68A',
    marginVertical: 6,
  },
  cashNoticeText: {
    fontSize: 12,
    color: '#B45309',
    lineHeight: 16,
  },
  modalActionButtons: {
    marginTop: 16,
    gap: 8,
  },
  submitProofBtn: {
    backgroundColor: '#0284C7',
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: 'center',
  },
  submitProofBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  cancelModalBtn: {
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
  },
  cancelModalBtnText: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '600',
  },
  disabledBtn: {
    opacity: 0.6,
  },
});
