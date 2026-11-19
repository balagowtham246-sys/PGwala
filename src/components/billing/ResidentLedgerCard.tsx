import React from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Href, router } from 'expo-router';
import {
  AlertTriangle,
  Check,
  Eye,
  MessageCircle,
  Receipt,
} from 'lucide-react-native';
import {
  HIGH_CONTRAST_SWITCH_COLORS,
  StatusBadge,
  StatusBadgeVariant,
  SWITCH_THUMB_COLOR,
} from '@/components/ui/owner';
import { OwnerTheme } from '@/constants/theme';
import { formatDueStatus, formatPaiseToRupees } from '@/lib/billing-utils';
import { toSentenceCaseStatus } from '@/lib/ux-utils';
import {
  CombinedBillItem,
  RejectedPaymentReport,
  ResidentEbBillItem,
  ResidentRentBillItem,
  ReviewPaymentItem,
} from '@/services/billing.service';

export type ResidentLedgerCardProps =
  | {
      mode: 'RENT';
      item: ResidentRentBillItem;
      monthLabel: string;
      isDuplicatePhone?: boolean;
      onOpenProfile?: (residentId: string) => void;
      onEditRent: (item: ResidentRentBillItem) => void;
      onToggleWashingMachine: (item: ResidentRentBillItem) => void;
      onReviewProof: (reviewItem: ReviewPaymentItem) => void;
      onConfirmCashPayment: (chargeId: string) => void;
      onSendReminder: (
        residentName: string,
        phoneNumber: string | null | undefined,
        amountPaise: number,
        billLabel: string,
        dueDateIso?: string | null
      ) => void;
    }
  | {
      mode: 'EB';
      item: ResidentEbBillItem;
      monthLabel: string;
      isDuplicatePhone?: boolean;
      onOpenProfile?: (residentId: string) => void;
      onReviewProof: (reviewItem: ReviewPaymentItem) => void;
      onConfirmCashPayment: (chargeId: string) => void;
      onSendReminder: (
        residentName: string,
        phoneNumber: string | null | undefined,
        amountPaise: number,
        billLabel: string,
        dueDateIso?: string | null
      ) => void;
    }
  | {
      mode: 'COMBINED';
      item: CombinedBillItem;
      isDuplicatePhone?: boolean;
      unpaidChargeIds?: string[];
      onOpenProfile?: (residentId: string) => void;
      onConfirmCashPayment?: (chargeIds: string[]) => void;
      onSendReminder: (
        residentName: string,
        phoneNumber: string | null | undefined,
        amountPaise: number,
        billLabel: string,
        dueDateIso?: string | null
      ) => void;
    };

function CardHeader({
  residentId,
  fullName,
  roomNumber,
  phoneNumber,
  dueStatus,
  isDuplicatePhone = false,
  badgeLabel,
  badgeVariant,
  onOpenProfile,
}: {
  residentId: string;
  fullName: string;
  roomNumber: string;
  phoneNumber: string | null;
  dueStatus: { label: string; isOverdue: boolean } | null;
  isDuplicatePhone?: boolean;
  badgeLabel: string;
  badgeVariant: StatusBadgeVariant;
  onOpenProfile?: (residentId: string) => void;
}) {
  const handleOpenProfile = () => {
    if (onOpenProfile) {
      onOpenProfile(residentId);
      return;
    }
    router.push({
      pathname: '/resident-profile',
      params: { id: residentId },
    } as Href);
  };

  return (
    <View style={styles.cardHeader}>
      <View style={{ flex: 1, paddingRight: 8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View profile for ${fullName}`}
          hitSlop={6}
          style={({ pressed }) => [
            styles.resNameBtn,
            pressed && { opacity: 0.7 },
          ]}
          onPress={handleOpenProfile}>
          <Text style={styles.resName}>{fullName}</Text>
        </Pressable>
        <Text style={styles.resRoom}>
          Room {roomNumber}
          {phoneNumber ? ` • ${phoneNumber}` : ''}
        </Text>
        {(dueStatus || isDuplicatePhone) && (
          <View style={styles.metaPillsRow}>
            {dueStatus && (
              <View
                style={[
                  styles.duePill,
                  dueStatus.isOverdue && styles.duePillOverdue,
                ]}>
                <Text
                  style={[
                    styles.duePillText,
                    dueStatus.isOverdue && styles.duePillTextOverdue,
                  ]}>
                  {dueStatus.label}
                </Text>
              </View>
            )}
            {isDuplicatePhone && (
              <View style={styles.duplicatePhoneBadge}>
                <AlertTriangle size={11} color="#B45309" />
                <Text style={styles.duplicatePhoneText}>Duplicate phone</Text>
              </View>
            )}
          </View>
        )}
      </View>
      <StatusBadge label={badgeLabel} variant={badgeVariant} size="sm" />
    </View>
  );
}

function RejectedBanner({
  rejectedReport,
}: {
  rejectedReport: RejectedPaymentReport;
}) {
  return (
    <View style={styles.rejectedBannerWrap}>
      <Text style={styles.rejectedBannerTitle}>Payment Proof Rejected</Text>
      <Text style={styles.rejectedBannerSub} numberOfLines={2}>
        Reason: {rejectedReport.rejection_reason || 'Verification failed'}
      </Text>
    </View>
  );
}

export function ResidentLedgerCard(props: ResidentLedgerCardProps) {
  if (props.mode === 'RENT') {
    const {
      item: res,
      monthLabel,
      isDuplicatePhone = false,
      onOpenProfile,
      onEditRent,
      onToggleWashingMachine,
      onReviewProof,
      onConfirmCashPayment,
      onSendReminder,
    } = props;
    const isPaid = res.status === 'paid';
    const isNotGen = res.status === 'not_generated';
    const hasReport = res.has_pending_report && !isPaid;
    const dueStatus = !isPaid && !isNotGen ? formatDueStatus(res.due_date) : null;

    return (
      <View style={styles.billCard}>
        <CardHeader
          residentId={res.resident_id}
          fullName={res.full_name}
          roomNumber={res.room_number}
          phoneNumber={res.phone_number}
          dueStatus={dueStatus}
          isDuplicatePhone={isDuplicatePhone}
          onOpenProfile={onOpenProfile}
          badgeLabel={
            isPaid
              ? toSentenceCaseStatus('paid')
              : hasReport
              ? toSentenceCaseStatus('pending')
              : isNotGen
              ? toSentenceCaseStatus('not_generated')
              : toSentenceCaseStatus('unpaid')
          }
          badgeVariant={
            isPaid
              ? 'success'
              : hasReport
              ? 'warning'
              : isNotGen
              ? 'neutral'
              : 'danger'
          }
        />

        <View style={styles.breakdownBox}>
          <View style={styles.breakdownRow}>
            <View style={styles.breakdownLabelGroup}>
              <Text style={styles.breakdownLabel}>Room Rent</Text>
              {!isPaid && (
                <Pressable hitSlop={6} onPress={() => onEditRent(res)}>
                  <Text style={styles.editLink}>Edit</Text>
                </Pressable>
              )}
            </View>
            <Text style={styles.breakdownValue}>
              {formatPaiseToRupees(res.rent_paise)}
            </Text>
          </View>

          <View style={styles.breakdownRow}>
            <View style={styles.wmRow}>
              <View
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.breakdownLabel}>Washing Machine</Text>
                {res.wm_request_pending && !res.opt_in_wm ? (
                  <View style={styles.wmPendingBadge}>
                    <Text style={styles.wmPendingBadgeText}>Requested</Text>
                  </View>
                ) : null}
              </View>
              <Switch
                value={res.opt_in_wm}
                onValueChange={() => {
                  const nextVal = !res.opt_in_wm;
                  Alert.alert(
                    nextVal
                      ? 'Enable Washing Machine?'
                      : 'Disable Washing Machine?',
                    `${nextVal ? 'Add' : 'Remove'} ₹500/month washing machine charge for ${
                      res.full_name
                    } (Room ${res.room_number})?${
                      isPaid ? ' Changes apply to future unpaid bills.' : ''
                    }`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: nextVal ? 'Enable' : 'Disable',
                        style: nextVal ? 'default' : 'destructive',
                        onPress: () => onToggleWashingMachine(res),
                      },
                    ]
                  );
                }}
                trackColor={HIGH_CONTRAST_SWITCH_COLORS}
                thumbColor={SWITCH_THUMB_COLOR}
                ios_backgroundColor={HIGH_CONTRAST_SWITCH_COLORS.false}
                style={{
                  transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }],
                }}
              />
            </View>
            <Text
              style={[
                styles.breakdownValue,
                !res.opt_in_wm && { color: OwnerTheme.colors.textMuted },
              ]}>
              {res.opt_in_wm ? '₹500' : '₹0'}
            </Text>
          </View>

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>
              {formatPaiseToRupees(res.total_paise)}
            </Text>
          </View>
        </View>

        {isPaid ? (
          <View style={styles.paidInfoBox}>
            <Receipt size={14} color={OwnerTheme.colors.success} />
            <Text style={styles.paidInfoText}>
              Receipt #{res.receipt_number || 'Confirmed'}
              {res.paid_method ? ` • ${res.paid_method.toUpperCase()}` : ''}
              {res.paid_date ? ` • ${res.paid_date}` : ''}
            </Text>
          </View>
        ) : hasReport && res.pending_report && res.charge_id ? (
          <View style={styles.actionRow}>
            <Pressable
              style={styles.reviewActionBtn}
              onPress={() => {
                onReviewProof({
                  full_name: res.full_name,
                  room_number: res.room_number,
                  charge_id: res.charge_id!,
                  bill_title: `${monthLabel} Rent Bill`,
                  report: res.pending_report!,
                });
              }}>
              <Eye size={14} color={OwnerTheme.colors.primary} />
              <Text style={styles.reviewActionBtnText}>
                Review Payment Proof ›
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            {res.rejected_report && (
              <RejectedBanner rejectedReport={res.rejected_report} />
            )}
            <View style={styles.actionRow}>
              {!isNotGen && res.total_paise > 0 && (
                <Pressable
                  accessibilityRole="button"
                  style={styles.reminderActionBtn}
                  onPress={() =>
                    onSendReminder(
                      res.full_name,
                      res.phone_number,
                      res.total_paise,
                      'monthly rent',
                      res.due_date
                    )
                  }>
                  <MessageCircle
                    size={14}
                    color={OwnerTheme.colors.primary}
                  />
                  <Text style={styles.reminderActionBtnText}>Remind</Text>
                </Pressable>
              )}
              <Pressable
                accessibilityRole="button"
                style={styles.cashActionBtn}
                onPress={() => {
                  if (!res.charge_id) {
                    Alert.alert(
                      'Notice',
                      'Please generate monthly rent bills first.'
                    );
                    return;
                  }
                  Alert.alert(
                    'Confirm In-Person Cash Payment',
                    `Confirm cash payment of ${formatPaiseToRupees(
                      res.total_paise
                    )} received from ${res.full_name} for Room ${
                      res.room_number
                    }?`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Confirm Cash Payment',
                        style: 'default',
                        onPress: () => onConfirmCashPayment(res.charge_id!),
                      },
                    ]
                  );
                }}>
                <Check size={14} color={OwnerTheme.colors.textPrimary} />
                <Text style={styles.cashActionBtnText}>Mark paid</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
    );
  }

  if (props.mode === 'EB') {
    const {
      item: res,
      monthLabel,
      isDuplicatePhone = false,
      onOpenProfile,
      onReviewProof,
      onConfirmCashPayment,
      onSendReminder,
    } = props;
    const isPaid = res.status === 'paid';
    const hasReport = res.has_pending_report && !isPaid;
    const dueStatus = !isPaid ? formatDueStatus(res.due_date) : null;

    return (
      <View style={styles.billCard}>
        <CardHeader
          residentId={res.resident_id}
          fullName={res.full_name}
          roomNumber={res.room_number}
          phoneNumber={res.phone_number}
          dueStatus={dueStatus}
          isDuplicatePhone={isDuplicatePhone}
          onOpenProfile={onOpenProfile}
          badgeLabel={
            isPaid
              ? toSentenceCaseStatus('paid')
              : hasReport
              ? toSentenceCaseStatus('pending')
              : toSentenceCaseStatus('unpaid')
          }
          badgeVariant={isPaid ? 'success' : hasReport ? 'warning' : 'danger'}
        />

        <View style={styles.breakdownBox}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>EB Meter Share</Text>
            <Text
              style={[
                styles.totalValue,
                { color: OwnerTheme.colors.warning },
              ]}>
              {formatPaiseToRupees(res.amount_paise)}
            </Text>
          </View>
        </View>

        {isPaid ? (
          <View style={styles.paidInfoBox}>
            <Receipt size={14} color={OwnerTheme.colors.success} />
            <Text style={styles.paidInfoText}>
              Receipt #{res.receipt_number || 'Confirmed'}
              {res.paid_method ? ` • ${res.paid_method.toUpperCase()}` : ''}
            </Text>
          </View>
        ) : hasReport && res.pending_report && res.charge_id ? (
          <View style={styles.actionRow}>
            <Pressable
              style={styles.reviewActionBtn}
              onPress={() => {
                onReviewProof({
                  full_name: res.full_name,
                  room_number: res.room_number,
                  charge_id: res.charge_id!,
                  bill_title: `${monthLabel} Room ${res.room_number} EB Bill`,
                  report: res.pending_report!,
                });
              }}>
              <Eye size={14} color={OwnerTheme.colors.primary} />
              <Text style={styles.reviewActionBtnText}>Review EB Proof ›</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {res.rejected_report && (
              <RejectedBanner rejectedReport={res.rejected_report} />
            )}
            <View style={styles.actionRow}>
              <Pressable
                accessibilityRole="button"
                style={styles.reminderActionBtn}
                onPress={() =>
                  onSendReminder(
                    res.full_name,
                    res.phone_number,
                    res.amount_paise,
                    'electricity share',
                    res.due_date
                  )
                }>
                <MessageCircle size={14} color={OwnerTheme.colors.primary} />
                <Text style={styles.reminderActionBtnText}>Remind</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={styles.cashActionBtn}
                onPress={() => {
                  Alert.alert(
                    'Confirm In-Person Cash Payment',
                    `Confirm cash payment of ${formatPaiseToRupees(
                      res.amount_paise
                    )} received from ${res.full_name} for electricity?`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Confirm Cash Payment',
                        onPress: () => onConfirmCashPayment(res.charge_id!),
                      },
                    ]
                  );
                }}>
                <Check size={14} color={OwnerTheme.colors.textPrimary} />
                <Text style={styles.cashActionBtnText}>Mark paid</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
    );
  }

  const {
    item: res,
    isDuplicatePhone = false,
    unpaidChargeIds = [],
    onOpenProfile,
    onConfirmCashPayment,
    onSendReminder,
  } = props;
  const dueStatus =
    res.remaining_paise > 0 ? formatDueStatus(res.due_date) : null;

  return (
    <View style={styles.billCard}>
      <CardHeader
        residentId={res.resident_id}
        fullName={res.full_name}
        roomNumber={res.room_number}
        phoneNumber={res.phone_number}
        dueStatus={dueStatus}
        isDuplicatePhone={isDuplicatePhone}
        onOpenProfile={onOpenProfile}
        badgeLabel={
          res.is_all_paid
            ? toSentenceCaseStatus('paid')
            : res.has_pending_report
            ? toSentenceCaseStatus('pending')
            : res.total_paise === 0
            ? toSentenceCaseStatus('not_generated')
            : toSentenceCaseStatus('unpaid')
        }
        badgeVariant={
          res.is_all_paid
            ? 'success'
            : res.has_pending_report
            ? 'warning'
            : res.total_paise === 0
            ? 'neutral'
            : 'danger'
        }
      />

      <View style={styles.breakdownBox}>
        <View style={styles.breakdownRow}>
          <Text style={styles.breakdownLabel}>Room Rent</Text>
          <Text style={styles.breakdownValue}>
            {formatPaiseToRupees(res.rent_paise)}
          </Text>
        </View>
        {res.wm_paise > 0 && (
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>Washing Machine</Text>
            <Text style={styles.breakdownValue}>
              {formatPaiseToRupees(res.wm_paise)}
            </Text>
          </View>
        )}
        {res.eb_paise > 0 && (
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>EB Share</Text>
            <Text style={styles.breakdownValue}>
              {formatPaiseToRupees(res.eb_paise)}
            </Text>
          </View>
        )}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Combined Total</Text>
          <Text style={styles.totalValue}>
            {formatPaiseToRupees(res.total_paise)}
          </Text>
        </View>
        {res.paid_paise > 0 && res.remaining_paise > 0 && (
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>
              Paid ({formatPaiseToRupees(res.paid_paise)}) • Due
            </Text>
            <Text
              style={[
                styles.breakdownValue,
                { color: OwnerTheme.colors.danger },
              ]}>
              {formatPaiseToRupees(res.remaining_paise)}
            </Text>
          </View>
        )}
      </View>

      {res.is_all_paid ? (
        <View style={styles.paidInfoBox}>
          <Receipt size={14} color={OwnerTheme.colors.success} />
          <Text style={styles.paidInfoText}>
            All rent and EB bills settled
          </Text>
        </View>
      ) : res.remaining_paise > 0 ? (
        <View style={styles.actionRow}>
          <Pressable
            accessibilityRole="button"
            style={styles.reminderActionBtn}
            onPress={() =>
              onSendReminder(
                res.full_name,
                res.phone_number,
                res.remaining_paise,
                'combined PG bill (Rent + EB)',
                res.due_date
              )
            }>
            <MessageCircle size={14} color={OwnerTheme.colors.primary} />
            <Text style={styles.reminderActionBtnText}>Remind</Text>
          </Pressable>
          {!res.has_pending_report &&
            unpaidChargeIds.length > 0 &&
            onConfirmCashPayment && (
              <Pressable
                accessibilityRole="button"
                style={styles.cashActionBtn}
                onPress={() => {
                  Alert.alert(
                    'Confirm In-Person Cash Payment',
                    `Confirm cash payment of ${formatPaiseToRupees(
                      res.remaining_paise
                    )} received from ${res.full_name} for Room ${
                      res.room_number
                    }?`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Confirm Cash Payment',
                        onPress: () => onConfirmCashPayment(unpaidChargeIds),
                      },
                    ]
                  );
                }}>
                <Check size={14} color={OwnerTheme.colors.textPrimary} />
                <Text style={styles.cashActionBtnText}>Mark paid</Text>
              </Pressable>
            )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  billCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 14,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  resNameBtn: {
    alignSelf: 'flex-start',
  },
  resName: {
    fontSize: 16,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  resRoom: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 2,
  },
  metaPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  breakdownBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: OwnerTheme.radius.sm,
    padding: 10,
    gap: 8,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  breakdownLabelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  breakdownLabel: {
    fontSize: 13,
    color: OwnerTheme.colors.textSecondary,
  },
  editLink: {
    fontSize: 12,
    color: OwnerTheme.colors.primary,
    fontWeight: '600',
  },
  breakdownValue: {
    fontSize: 13,
    fontWeight: '500',
    color: OwnerTheme.colors.textPrimary,
  },
  wmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: OwnerTheme.colors.border,
    paddingTop: 8,
    marginTop: 2,
  },
  totalLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  totalValue: {
    fontSize: 15,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  paidInfoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: OwnerTheme.colors.successLight,
    borderRadius: OwnerTheme.radius.sm,
  },
  paidInfoText: {
    fontSize: 12,
    color: OwnerTheme.colors.success,
    fontWeight: '500',
  },
  duePill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: OwnerTheme.radius.full,
    backgroundColor: '#F1F5F9',
  },
  duePillOverdue: {
    backgroundColor: '#FEE2E2',
  },
  duePillText: {
    fontSize: 11,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  duePillTextOverdue: {
    color: OwnerTheme.colors.danger,
  },
  duplicatePhoneBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: OwnerTheme.radius.full,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  duplicatePhoneText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#92400E',
  },
  actionRow: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 8,
  },
  cashActionBtn: {
    flex: 1,
    height: 42,
    paddingHorizontal: 10,
    flexDirection: 'row',
    gap: 6,
    borderRadius: OwnerTheme.radius.md,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cashActionBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  reminderActionBtn: {
    flex: 1,
    height: 42,
    paddingHorizontal: 10,
    flexDirection: 'row',
    gap: 6,
    borderRadius: OwnerTheme.radius.md,
    backgroundColor: OwnerTheme.colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reminderActionBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.primary,
  },
  reviewActionBtn: {
    flex: 1,
    height: 42,
    flexDirection: 'row',
    gap: 6,
    borderRadius: OwnerTheme.radius.md,
    backgroundColor: OwnerTheme.colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reviewActionBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.primary,
  },
  rejectedBannerWrap: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: OwnerTheme.radius.sm,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginTop: 8,
    marginBottom: 4,
  },
  rejectedBannerTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B91C1C',
  },
  rejectedBannerSub: {
    fontSize: 11,
    color: '#7F1D1D',
    marginTop: 2,
  },
  wmPendingBadge: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FCD34D',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: OwnerTheme.radius.full,
  },
  wmPendingBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#92400E',
  },
});
