import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  AlertTriangle,
  Check,
  Copy,
  MessageCircle,
} from 'lucide-react-native';

import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { OwnerTheme } from '@/constants/theme';
import {
  buildWhatsAppReminderUrl,
  formatPaiseToRupees,
} from '@/lib/billing-utils';

export interface BulkReminderTarget {
  residentId: string;
  fullName: string;
  roomNumber: string;
  phoneNumber: string | null | undefined;
  amountPaise: number;
  billLabel: string;
  dueDateIso?: string | null;
}

interface BulkReminderModalProps {
  visible: boolean;
  monthLabel: string;
  targets: BulkReminderTarget[];
  duplicatePhoneResidentIds: Set<string>;
  sentReminderIds: string[];
  bulkContactIssueCount: number;
  onClose: () => void;
  onSendOne: (target: BulkReminderTarget) => void;
  onCopyAll: () => void;
}

export function BulkReminderModal({
  visible,
  monthLabel,
  targets,
  duplicatePhoneResidentIds,
  sentReminderIds,
  bulkContactIssueCount,
  onClose,
  onSendOne,
  onCopyAll,
}: BulkReminderModalProps) {
  return (
    <BottomSheetModal
      visible={visible}
      onClose={onClose}
      title="Bulk Payment Reminders"
      subtitle={`${targets.length} unpaid resident${targets.length === 1 ? '' : 's'} · ${monthLabel}`}
      maxHeight="85%">
          {bulkContactIssueCount > 0 && (
            <View style={styles.bulkWarningBanner}>
              <AlertTriangle size={15} color="#B45309" />
              <Text style={styles.bulkWarningText}>
                {bulkContactIssueCount} resident
                {bulkContactIssueCount > 1 ? 's have' : ' has'} a missing or
                duplicate phone number. Review before sending.
              </Text>
            </View>
          )}

          <ScrollView
            style={styles.bulkListScroll}
            showsVerticalScrollIndicator={false}>
            {targets.map((target) => {
              const isMissingPhone = !buildWhatsAppReminderUrl(
                target.phoneNumber,
                'x'
              );
              const isDuplicatePhone = duplicatePhoneResidentIds.has(
                target.residentId
              );
              const isSent = sentReminderIds.includes(target.residentId);

              return (
                <View key={target.residentId} style={styles.bulkRow}>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <Text style={styles.bulkRowName}>
                      {target.fullName}{' '}
                      <Text style={styles.bulkRowRoom}>
                        · Room {target.roomNumber}
                      </Text>
                    </Text>
                    <Text style={styles.bulkRowMeta}>
                      {formatPaiseToRupees(target.amountPaise)}
                      {target.phoneNumber
                        ? ` · ${target.phoneNumber}`
                        : ' · No phone saved'}
                    </Text>
                    {(isMissingPhone || isDuplicatePhone) && (
                      <View style={styles.bulkFlagsRow}>
                        {isMissingPhone && (
                          <View style={styles.missingPhoneFlag}>
                            <Text style={styles.missingPhoneFlagText}>
                              Missing phone
                            </Text>
                          </View>
                        )}
                        {isDuplicatePhone && (
                          <View style={styles.duplicatePhoneFlag}>
                            <AlertTriangle size={10} color="#92400E" />
                            <Text style={styles.duplicatePhoneFlagText}>
                              Duplicate phone
                            </Text>
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    disabled={isMissingPhone}
                    style={[
                      styles.bulkSendBtn,
                      isMissingPhone && styles.bulkSendBtnDisabled,
                      isSent && !isMissingPhone && styles.bulkSendBtnSent,
                    ]}
                    onPress={() => onSendOne(target)}>
                    {isSent && !isMissingPhone ? (
                      <Check size={13} color={OwnerTheme.colors.success} />
                    ) : (
                      <MessageCircle
                        size={13}
                        color={
                          isMissingPhone
                            ? OwnerTheme.colors.textMuted
                            : OwnerTheme.colors.primary
                        }
                      />
                    )}
                    <Text
                      style={[
                        styles.bulkSendBtnText,
                        isMissingPhone && styles.bulkSendBtnTextDisabled,
                        isSent && !isMissingPhone && styles.bulkSendBtnTextSent,
                      ]}>
                      {isMissingPhone ? 'No phone' : isSent ? 'Sent' : 'Send'}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>

          <View style={styles.bulkModalFooter}>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.copyAllBtn,
                pressed && styles.pressed,
              ]}
              onPress={onCopyAll}>
              <Copy size={16} color="#FFFFFF" />
              <Text style={styles.copyAllBtnText}>Copy all reminders</Text>
            </Pressable>
          </View>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  bulkModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  bulkModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  bulkModalSub: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 2,
  },
  bulkWarningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: OwnerTheme.radius.sm,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 10,
  },
  bulkWarningText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '500',
    color: '#92400E',
    lineHeight: 16,
  },
  bulkListScroll: {
    maxHeight: 340,
  },
  bulkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: OwnerTheme.colors.borderLight,
  },
  bulkRowName: {
    fontSize: 14,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  bulkRowRoom: {
    fontSize: 12,
    fontWeight: '500',
    color: OwnerTheme.colors.textSecondary,
  },
  bulkRowMeta: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 2,
  },
  bulkFlagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 5,
  },
  missingPhoneFlag: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: OwnerTheme.radius.full,
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  missingPhoneFlagText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#B91C1C',
  },
  duplicatePhoneFlag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: OwnerTheme.radius.full,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  duplicatePhoneFlagText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#92400E',
  },
  bulkSendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: OwnerTheme.radius.md,
    backgroundColor: OwnerTheme.colors.primaryLight,
  },
  bulkSendBtnDisabled: {
    backgroundColor: '#F1F5F9',
  },
  bulkSendBtnSent: {
    backgroundColor: OwnerTheme.colors.successLight,
  },
  bulkSendBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  bulkSendBtnTextDisabled: {
    color: OwnerTheme.colors.textMuted,
  },
  bulkSendBtnTextSent: {
    color: OwnerTheme.colors.success,
  },
  bulkModalFooter: {
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: OwnerTheme.colors.borderLight,
  },
  copyAllBtn: {
    height: 46,
    borderRadius: OwnerTheme.radius.md,
    backgroundColor: OwnerTheme.colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  copyAllBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  pressed: {
    opacity: 0.85,
  },
});
