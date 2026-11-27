import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Receipt } from 'lucide-react-native';
import { OwnerTheme } from '@/constants/theme';
import { formatPaiseToRupees } from '@/lib/billing-utils';
import { isValidUpiId } from '@/lib/upi';
import { toSentenceCaseStatus } from '@/lib/ux-utils';
import { StudentBillCardItem } from '@/services/billing.service';

export interface StudentChargeListProps {
  currentRentBill: StudentBillCardItem | null;
  currentEbBill: StudentBillCardItem | null;
  breakdownExpanded: boolean;
  ownerUpiId?: string | null;
  ownerUpiPayeeName?: string | null;
  propertyName?: string;
  onToggleBreakdown: () => void;
  onOpenPaymentModal: (bill: StudentBillCardItem) => void;
  onPayNow?: (bill: StudentBillCardItem) => void;
  onOpenReceipt: (paymentId: string) => void;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    }
  } catch {}
  return iso;
}

export function StudentChargeList({
  currentRentBill,
  currentEbBill,
  breakdownExpanded,
  ownerUpiId,
  ownerUpiPayeeName,
  propertyName,
  onToggleBreakdown,
  onOpenPaymentModal,
  onPayNow,
  onOpenReceipt,
}: StudentChargeListProps) {
  const canDirectPay = isValidUpiId(ownerUpiId);
  const resolvedPayee = ownerUpiPayeeName?.trim() || propertyName?.trim() || '';
  const unpaidBills = [currentRentBill, currentEbBill].filter(
    (b): b is StudentBillCardItem => Boolean(b && b.status !== 'paid')
  );
  const pendingReviewBills = unpaidBills.filter(
    (b) => b.pending_report?.status === 'pending'
  );
  const actionableDueBills = unpaidBills.filter(
    (b) => b.pending_report?.status !== 'pending'
  );
  const actionableDuePaise = actionableDueBills.reduce(
    (s, b) => s + b.total_paise,
    0
  );
  const pendingReviewPaise = pendingReviewBills.reduce(
    (s, b) => s + b.total_paise,
    0
  );
  const totalDuePaise = unpaidBills.reduce((s, b) => s + b.total_paise, 0);
  const totalBilledPaise =
    (currentRentBill?.total_paise || 0) + (currentEbBill?.total_paise || 0);
  const hasAnyCurrentBill = Boolean(currentRentBill || currentEbBill);
  const allCurrentPaid = hasAnyCurrentBill && unpaidBills.length === 0;
  const isAllUnderReview =
    actionableDuePaise === 0 && pendingReviewPaise > 0;
  const anyRejected = unpaidBills.some(
    (b) => b.pending_report?.status === 'rejected'
  );
  const earliestDueDate = unpaidBills[0]?.due_date || null;
  const primaryPaymentId =
    currentRentBill?.payment_id || currentEbBill?.payment_id || null;
  const primaryReceiptNum =
    currentRentBill?.receipt_number || currentEbBill?.receipt_number || null;
  const currentMonthLabel =
    currentRentBill?.month_label || currentEbBill?.month_label || 'This Month';

  const renderUnpaidItemRow = (
    bill: StudentBillCardItem,
    labelPrefix: 'Rent' | 'EB'
  ) => (
    <View style={styles.itemActionInline}>
      <Text style={styles.itemStatusMini}>
        {bill.pending_report?.status === 'pending'
          ? `${labelPrefix} proof under review`
          : bill.pending_report?.status === 'rejected'
          ? `${labelPrefix} proof rejected`
          : `${labelPrefix} unpaid`}
      </Text>
      <View style={styles.itemActionLinks}>
        {bill.pending_report?.status === 'pending' ? (
          <Text style={styles.itemStatusMini}>Awaiting approval</Text>
        ) : (
          <>
            {canDirectPay && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Pay ${labelPrefix} now via UPI`}
                onPress={() => onPayNow?.(bill)}>
                <Text style={styles.itemPayMiniLink}>Pay now</Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              onPress={() => onOpenPaymentModal(bill)}>
              <Text
                style={
                  canDirectPay
                    ? styles.itemUploadMiniLink
                    : styles.itemPayMiniLink
                }>
                {bill.pending_report?.status === 'rejected'
                  ? 'Resubmit ›'
                  : canDirectPay
                  ? 'Upload proof ›'
                  : 'Upload Payment Proof ›'}
              </Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );

  return (
    <>
      {/* HERO STATUS FIRST */}
      <View
        style={[
          styles.heroStatusCard,
          !hasAnyCurrentBill
            ? styles.heroStatusNeutral
            : totalDuePaise === 0
            ? styles.heroStatusClear
            : styles.heroStatusDue,
        ]}>
        <Text
          style={[
            styles.heroStatusAmount,
            !hasAnyCurrentBill
              ? styles.heroStatusAmountNeutral
              : totalDuePaise === 0
              ? styles.heroStatusAmountClear
              : styles.heroStatusAmountDue,
          ]}>
          {!hasAnyCurrentBill
            ? 'Bill not generated yet'
            : totalDuePaise === 0
            ? 'All dues settled'
            : isAllUnderReview
            ? `${formatPaiseToRupees(pendingReviewPaise)} under review`
            : `${formatPaiseToRupees(actionableDuePaise)} due`}
        </Text>
        <Text style={styles.heroStatusSub}>
          {!hasAnyCurrentBill
            ? 'Your PG owner has not generated this month’s bill yet'
            : totalDuePaise === 0
            ? 'No pending dues for this month'
            : isAllUnderReview
            ? 'Payment proof submitted • Awaiting owner review'
            : pendingReviewPaise > 0
            ? `${formatPaiseToRupees(pendingReviewPaise)} already under review`
            : earliestDueDate
            ? `Pay before ${formatDate(earliestDueDate)}`
            : 'Pending payment for this month'}
        </Text>
        {actionableDueBills.length > 0 &&
          (canDirectPay ? (
            <View style={styles.heroPayActions}>
              <Text style={styles.upiPayeeHint} numberOfLines={1}>
                UPI: {ownerUpiId?.trim()}
                {resolvedPayee ? ` • ${resolvedPayee}` : ''}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Pay now via UPI"
                style={({ pressed }) => [
                  styles.heroPayBtn,
                  pressed && styles.pressed,
                ]}
                onPress={() => onPayNow?.(actionableDueBills[0])}>
                <Text style={styles.heroPayBtnText}>Pay now</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                hitSlop={6}
                style={({ pressed }) => [
                  styles.heroSecondaryLinkWrap,
                  pressed && styles.pressed,
                ]}
                onPress={() => onOpenPaymentModal(actionableDueBills[0])}>
                <Text style={styles.heroSecondaryLinkText}>
                  Already paid? Upload proof
                </Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.heroPayActions}>
              <Text style={styles.upiMissingNote}>
                Pay by QR or ask the owner
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Upload Payment Proof"
                style={({ pressed }) => [
                  styles.heroPayBtn,
                  pressed && styles.pressed,
                ]}
                onPress={() => onOpenPaymentModal(actionableDueBills[0])}>
                <Text style={styles.heroPayBtnText}>Upload Payment Proof</Text>
              </Pressable>
            </View>
          ))}
      </View>

      {/* MERGED MONTHLY TOTAL CARD */}
      {hasAnyCurrentBill ? (
        <View style={styles.billCard}>
          <Pressable
            accessibilityRole="button"
            onPress={onToggleBreakdown}
            style={styles.billCardTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.billCardHeaderTitle}>
                {currentMonthLabel} Total
              </Text>
              <Text style={styles.mergedTotalAmount}>
                {formatPaiseToRupees(totalBilledPaise)}
              </Text>
              {!allCurrentPaid && earliestDueDate && (
                <Text style={styles.dueText}>
                  Pay before:{' '}
                  <Text style={styles.boldText}>
                    {formatDate(earliestDueDate)}
                  </Text>
                </Text>
              )}
            </View>

            <View style={{ alignItems: 'flex-end', gap: 6 }}>
              {allCurrentPaid ? (
                <View style={[styles.statusBadge, styles.badgePaid]}>
                  <Text style={styles.badgePaidText}>{toSentenceCaseStatus('paid')}</Text>
                </View>
              ) : isAllUnderReview ? (
                <View style={[styles.statusBadge, styles.badgeReview]}>
                  <Text style={styles.badgeReviewText}>
                    {toSentenceCaseStatus('under_review')}
                  </Text>
                </View>
              ) : anyRejected ? (
                <View style={[styles.statusBadge, styles.badgeRejected]}>
                  <Text style={styles.badgeRejectedText}>
                    {toSentenceCaseStatus('rejected')}
                  </Text>
                </View>
              ) : (
                <View style={[styles.statusBadge, styles.badgeUnpaid]}>
                  <Text style={styles.badgeUnpaidText}>{toSentenceCaseStatus('unpaid')}</Text>
                </View>
              )}
              <Text style={styles.expandToggleText}>
                {breakdownExpanded
                  ? 'Hide breakdown ▴'
                  : 'Tap for breakdown ▾'}
              </Text>
            </View>
          </Pressable>

          {breakdownExpanded && (
            <View style={styles.breakdownBox}>
              {currentRentBill && (
                <>
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>Room Rent</Text>
                    <Text style={styles.breakdownVal}>
                      {formatPaiseToRupees(currentRentBill.rent_paise || 0)}
                    </Text>
                  </View>
                  {(currentRentBill.wm_paise || 0) > 0 && (
                    <View style={styles.breakdownRow}>
                      <Text style={styles.breakdownLabel}>Washing Machine</Text>
                      <Text style={styles.breakdownVal}>
                        {formatPaiseToRupees(currentRentBill.wm_paise || 0)}
                      </Text>
                    </View>
                  )}
                  {(currentRentBill.ac_paise || 0) > 0 && (
                    <View style={styles.breakdownRow}>
                      <Text style={styles.breakdownLabel}>AC Room Fee</Text>
                      <Text style={styles.breakdownVal}>
                        {formatPaiseToRupees(currentRentBill.ac_paise || 0)}
                      </Text>
                    </View>
                  )}
                  {currentRentBill.status !== 'paid' &&
                    renderUnpaidItemRow(currentRentBill, 'Rent')}
                </>
              )}

              {currentEbBill && (
                <>
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>
                      Electricity (EB) Share
                    </Text>
                    <Text style={styles.breakdownVal}>
                      {formatPaiseToRupees(currentEbBill.total_paise)}
                    </Text>
                  </View>
                  {currentEbBill.status !== 'paid' &&
                    renderUnpaidItemRow(currentEbBill, 'EB')}
                </>
              )}

              <View style={[styles.breakdownRow, styles.totalRow]}>
                <Text style={styles.totalLabel}>Monthly Total</Text>
                <Text style={styles.totalVal}>
                  {formatPaiseToRupees(totalBilledPaise)}
                </Text>
              </View>
            </View>
          )}

          {/* Collapsed Single Receipt Link when Paid */}
          {allCurrentPaid && primaryPaymentId && (
            <Pressable
              style={styles.singleReceiptLink}
              onPress={() => onOpenReceipt(primaryPaymentId)}>
              <Text style={styles.singleReceiptLinkText}>
                Receipt{primaryReceiptNum ? ` (${primaryReceiptNum})` : ''} ›
              </Text>
            </Pressable>
          )}
        </View>
      ) : (
        <View style={styles.emptyCard}>
          <View style={styles.emptyIconCircle}>
            <Receipt size={22} color={OwnerTheme.colors.primary} />
          </View>
          <Text style={styles.emptyTitle}>No Active Bills Yet</Text>
          <Text style={styles.emptySubtitle}>
            Your PG owner has not generated any bills for this month yet. Check
            back soon!
          </Text>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  heroStatusCard: {
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderWidth: 1,
    marginBottom: 12,
  },
  heroStatusClear: {
    backgroundColor: '#0F172A',
    borderColor: 'rgba(16, 185, 129, 0.35)',
  },
  heroStatusNeutral: {
    backgroundColor: '#0F172A',
    borderColor: '#1E293B',
  },
  heroStatusDue: {
    backgroundColor: '#0F172A',
    borderColor: 'rgba(251, 191, 36, 0.4)',
  },
  heroStatusAmount: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  heroStatusAmountClear: {
    color: '#34D399',
  },
  heroStatusAmountNeutral: {
    color: '#E2E8F0',
  },
  heroStatusAmountDue: {
    color: '#FCD34D',
  },
  heroStatusSub: {
    fontSize: 13,
    color: '#94A3B8',
    marginTop: 4,
  },
  heroPayActions: {
    marginTop: 12,
    gap: 8,
  },
  upiPayeeHint: {
    fontSize: 11,
    fontWeight: '600',
    color: '#CBD5E1',
  },
  upiMissingNote: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94A3B8',
  },
  heroPayBtn: {
    backgroundColor: '#0284C7',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  heroPayBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  heroSecondaryLinkWrap: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  heroSecondaryLinkText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#38BDF8',
  },
  billCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  billCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  billCardHeaderTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0284C7',
    marginBottom: 2,
  },
  mergedTotalAmount: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
  },
  dueText: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  boldText: {
    fontWeight: '700',
    color: '#0F172A',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgePaid: {
    backgroundColor: '#DCFCE7',
  },
  badgePaidText: {
    color: '#15803D',
    fontSize: 11,
    fontWeight: '800',
  },
  badgeReview: {
    backgroundColor: '#FEF3C7',
  },
  badgeReviewText: {
    color: '#B45309',
    fontSize: 11,
    fontWeight: '800',
  },
  badgeUnpaid: {
    backgroundColor: '#FEE2E2',
  },
  badgeUnpaidText: {
    color: '#DC2626',
    fontSize: 11,
    fontWeight: '800',
  },
  badgeRejected: {
    backgroundColor: '#FEE2E2',
  },
  badgeRejectedText: {
    color: '#B91C1C',
    fontSize: 11,
    fontWeight: '800',
  },
  expandToggleText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0284C7',
  },
  breakdownBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    gap: 8,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  breakdownLabel: {
    fontSize: 13,
    color: '#64748B',
  },
  breakdownVal: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0F172A',
  },
  itemActionInline: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    paddingLeft: 8,
  },
  itemStatusMini: {
    fontSize: 11,
    color: '#64748B',
  },
  itemActionLinks: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  itemPayMiniLink: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0284C7',
  },
  itemUploadMiniLink: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  totalRow: {
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  totalLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  totalVal: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0284C7',
  },
  singleReceiptLink: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    alignItems: 'flex-end',
  },
  singleReceiptLinkText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0284C7',
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    padding: 24,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    alignItems: 'center',
  },
  emptyIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: OwnerTheme.colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  emptySubtitle: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 4,
  },
  pressed: {
    opacity: 0.8,
  },
});
