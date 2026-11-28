import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Receipt } from 'lucide-react-native';
import { OwnerTheme } from '@/constants/theme';
import { formatPaiseToRupees } from '@/lib/billing-utils';
import { isValidUpiId } from '@/lib/upi';
import { toSentenceCaseStatus } from '@/lib/ux-utils';
import { StudentBillCardItem } from '@/services/billing.service';

export interface StudentChargeListProps {
  currentRentBill: StudentBillCardItem | null;
  currentEbBill: StudentBillCardItem | null;
  unpaidBills?: StudentBillCardItem[];
  breakdownExpanded: boolean;
  ownerUpiId?: string | null;
  ownerUpiPayeeName?: string | null;
  propertyName?: string;
  withdrawingReportId?: string | null;
  onToggleBreakdown: () => void;
  onOpenPaymentModal: (bill: StudentBillCardItem) => void;
  onPayNow?: (bill: StudentBillCardItem) => void;
  onWithdrawProof?: (bill: StudentBillCardItem) => void;
  onOpenReceipt: (paymentId: string) => void;
}

interface UnpaidMonthGroup {
  billingMonth: string;
  monthLabel: string;
  bills: StudentBillCardItem[];
  rentBill: StudentBillCardItem | null;
  ebBill: StudentBillCardItem | null;
  totalBilledPaise: number;
  totalDuePaise: number;
  earliestDueDate: string | null;
  allUnderReview: boolean;
  anyRejected: boolean;
}

function getBillDuePaise(bill: StudentBillCardItem): number {
  return bill.remaining_paise ?? bill.total_paise;
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

function shortMonth(monthLabel: string): string {
  return monthLabel.split(' ')[0]?.slice(0, 3) || monthLabel;
}

export function StudentChargeList({
  currentRentBill,
  currentEbBill,
  unpaidBills: unpaidBillsProp,
  breakdownExpanded,
  ownerUpiId,
  ownerUpiPayeeName,
  propertyName,
  withdrawingReportId,
  onToggleBreakdown,
  onOpenPaymentModal,
  onPayNow,
  onWithdrawProof,
  onOpenReceipt,
}: StudentChargeListProps) {
  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>(
    {}
  );

  const canDirectPay = isValidUpiId(ownerUpiId);
  const resolvedPayee = ownerUpiPayeeName?.trim() || propertyName?.trim() || '';

  const effectiveUnpaidBills = useMemo<StudentBillCardItem[]>(() => {
    if (unpaidBillsProp) {
      return unpaidBillsProp.filter((b) => b.status !== 'paid');
    }
    return [currentRentBill, currentEbBill].filter(
      (b): b is StudentBillCardItem => Boolean(b && b.status !== 'paid')
    );
  }, [unpaidBillsProp, currentRentBill, currentEbBill]);

  const unpaidMonthGroups = useMemo<UnpaidMonthGroup[]>(() => {
    const map = new Map<string, StudentBillCardItem[]>();
    for (const bill of effectiveUnpaidBills) {
      const key = bill.billing_month || bill.month_label || 'current';
      const list = map.get(key) ?? [];
      list.push(bill);
      map.set(key, list);
    }

    return Array.from(map.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([billingMonth, bills]) => {
        const rentBill = bills.find((b) => b.category === 'rent') ?? null;
        const ebBill = bills.find((b) => b.category === 'electricity') ?? null;
        const totalBilledPaise = bills.reduce((s, b) => s + b.total_paise, 0);
        const totalDuePaise = bills.reduce((s, b) => s + getBillDuePaise(b), 0);
        const earliestDueDate =
          bills
            .map((b) => b.due_date)
            .filter(Boolean)
            .sort()[0] ?? null;
        const allUnderReview =
          bills.length > 0 &&
          bills.every((b) => b.pending_report?.status === 'pending');
        const anyRejected = bills.some(
          (b) => b.pending_report?.status === 'rejected'
        );

        return {
          billingMonth,
          monthLabel: bills[0]?.month_label || billingMonth,
          bills,
          rentBill,
          ebBill,
          totalBilledPaise,
          totalDuePaise,
          earliestDueDate,
          allUnderReview,
          anyRejected,
        };
      });
  }, [effectiveUnpaidBills]);

  const pendingReviewBills = useMemo(
    () =>
      effectiveUnpaidBills.filter(
        (b) => b.pending_report?.status === 'pending'
      ),
    [effectiveUnpaidBills]
  );
  const actionableDueBills = useMemo(
    () =>
      effectiveUnpaidBills.filter(
        (b) => b.pending_report?.status !== 'pending'
      ),
    [effectiveUnpaidBills]
  );

  const actionableDuePaise = actionableDueBills.reduce(
    (s, b) => s + getBillDuePaise(b),
    0
  );
  const pendingReviewPaise = pendingReviewBills.reduce(
    (s, b) => s + getBillDuePaise(b),
    0
  );
  const totalDuePaise = actionableDuePaise + pendingReviewPaise;

  const hasAnyActiveBill = Boolean(
    effectiveUnpaidBills.length > 0 || currentRentBill || currentEbBill
  );
  const isAllUnderReview =
    actionableDuePaise === 0 && pendingReviewPaise > 0;
  const earliestDueDate =
    actionableDueBills
      .map((b) => b.due_date)
      .filter(Boolean)
      .sort()[0] ||
    effectiveUnpaidBills[0]?.due_date ||
    null;

  // Settled current month card fields (when all dues are settled)
  const totalCurrentBilledPaise =
    (currentRentBill?.total_paise || 0) + (currentEbBill?.total_paise || 0);
  const primaryPaymentId =
    currentRentBill?.payment_id || currentEbBill?.payment_id || null;
  const primaryReceiptNum =
    currentRentBill?.receipt_number || currentEbBill?.receipt_number || null;
  const currentMonthLabel =
    currentRentBill?.month_label || currentEbBill?.month_label || 'This Month';

  const primaryActionBill = actionableDueBills[0] ?? null;
  const heroPayCtaLabel = primaryActionBill
    ? actionableDueBills.length > 1
      ? `Pay ${shortMonth(primaryActionBill.month_label)} ${
          primaryActionBill.category === 'rent' ? 'Rent' : 'EB'
        } (${formatPaiseToRupees(getBillDuePaise(primaryActionBill))})`
      : 'Pay now'
    : 'Pay now';

  const toggleMonthBreakdown = (monthKey: string) => {
    setExpandedMonths((prev) => ({ ...prev, [monthKey]: !prev[monthKey] }));
  };

  const renderUnpaidBillActionRow = (bill: StudentBillCardItem) => {
    const isRent = bill.category === 'rent';
    const label = isRent ? 'Room Rent' : 'Electricity (EB)';
    const duePaise = getBillDuePaise(bill);
    const paidPaise = bill.paid_paise ?? 0;
    const isPending = bill.pending_report?.status === 'pending';
    const isRejected = bill.pending_report?.status === 'rejected';
    const isWithdrawing =
      Boolean(bill.pending_report?.id) &&
      withdrawingReportId === bill.pending_report?.id;

    return (
      <View key={bill.charge_id} style={styles.unpaidItemBox}>
        <View style={styles.unpaidItemHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.unpaidItemTitle}>{label}</Text>
            {paidPaise > 0 && (
              <Text style={styles.partialPaidSub}>
                Paid {formatPaiseToRupees(paidPaise)} of{' '}
                {formatPaiseToRupees(bill.total_paise)}
              </Text>
            )}
            {isPending ? (
              <Text style={styles.itemStatusReview}>
                Proof under review • Awaiting owner approval
              </Text>
            ) : isRejected ? (
              <Text style={styles.itemStatusRejected} numberOfLines={2}>
                Proof rejected
                {bill.pending_report?.rejection_reason
                  ? `: ${bill.pending_report.rejection_reason}`
                  : ''}
              </Text>
            ) : (
              <Text style={styles.itemStatusMini}>
                {bill.due_date ? `Due ${formatDate(bill.due_date)}` : 'Unpaid'}
              </Text>
            )}
          </View>
          <Text style={styles.unpaidItemAmount}>
            {formatPaiseToRupees(duePaise)}
          </Text>
        </View>

        <View style={styles.unpaidItemActions}>
          {isPending ? (
            onWithdrawProof && bill.pending_report ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Withdraw ${label} payment proof`}
                disabled={isWithdrawing}
                style={({ pressed }) => [
                  styles.withdrawBtn,
                  isWithdrawing && { opacity: 0.6 },
                  pressed && styles.pressed,
                ]}
                onPress={() => onWithdrawProof(bill)}>
                {isWithdrawing ? (
                  <ActivityIndicator size="small" color="#B45309" />
                ) : (
                  <Text style={styles.withdrawBtnText}>Withdraw proof</Text>
                )}
              </Pressable>
            ) : (
              <Text style={styles.itemStatusMini}>Awaiting approval</Text>
            )
          ) : (
            <>
              {canDirectPay && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Pay ${bill.month_label} ${label} now via UPI`}
                  style={({ pressed }) => [
                    styles.itemPayChip,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => onPayNow?.(bill)}>
                  <Text style={styles.itemPayChipText}>Pay now</Text>
                </Pressable>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Upload proof for ${bill.month_label} ${label}`}
                style={({ pressed }) => [
                  canDirectPay ? styles.itemUploadChip : styles.itemPayChip,
                  pressed && styles.pressed,
                ]}
                onPress={() => onOpenPaymentModal(bill)}>
                <Text
                  style={
                    canDirectPay
                      ? styles.itemUploadChipText
                      : styles.itemPayChipText
                  }>
                  {isRejected
                    ? 'Resubmit proof'
                    : canDirectPay
                    ? 'Upload proof'
                    : 'Upload Payment Proof'}
                </Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    );
  };

  return (
    <>
      {/* HERO STATUS FIRST */}
      <View
        style={[
          styles.heroStatusCard,
          !hasAnyActiveBill
            ? styles.heroStatusNeutral
            : totalDuePaise === 0
            ? styles.heroStatusClear
            : styles.heroStatusDue,
        ]}>
        <Text
          style={[
            styles.heroStatusAmount,
            !hasAnyActiveBill
              ? styles.heroStatusAmountNeutral
              : totalDuePaise === 0
              ? styles.heroStatusAmountClear
              : styles.heroStatusAmountDue,
          ]}>
          {!hasAnyActiveBill
            ? 'Bill not generated yet'
            : totalDuePaise === 0
            ? 'All dues settled'
            : isAllUnderReview
            ? `${formatPaiseToRupees(pendingReviewPaise)} under review`
            : `${formatPaiseToRupees(actionableDuePaise)} due`}
        </Text>
        <Text style={styles.heroStatusSub}>
          {!hasAnyActiveBill
            ? 'Your PG owner has not generated this month’s bill yet'
            : totalDuePaise === 0
            ? 'No pending dues across any month'
            : isAllUnderReview
            ? 'Payment proof submitted • Awaiting owner review'
            : pendingReviewPaise > 0
            ? `${formatPaiseToRupees(pendingReviewPaise)} already under review`
            : unpaidMonthGroups.length > 1
            ? `${actionableDueBills.length} unpaid bills across ${unpaidMonthGroups.length} months`
            : earliestDueDate
            ? `Pay before ${formatDate(earliestDueDate)}`
            : 'Pending payment'}
        </Text>
        {primaryActionBill &&
          (canDirectPay ? (
            <View style={styles.heroPayActions}>
              <Text style={styles.upiPayeeHint} numberOfLines={1}>
                UPI: {ownerUpiId?.trim()}
                {resolvedPayee ? ` • ${resolvedPayee}` : ''}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={heroPayCtaLabel}
                style={({ pressed }) => [
                  styles.heroPayBtn,
                  pressed && styles.pressed,
                ]}
                onPress={() => onPayNow?.(primaryActionBill)}>
                <Text style={styles.heroPayBtnText}>{heroPayCtaLabel}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                hitSlop={6}
                style={({ pressed }) => [
                  styles.heroSecondaryLinkWrap,
                  pressed && styles.pressed,
                ]}
                onPress={() => onOpenPaymentModal(primaryActionBill)}>
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
                onPress={() => onOpenPaymentModal(primaryActionBill)}>
                <Text style={styles.heroPayBtnText}>Upload Payment Proof</Text>
              </Pressable>
            </View>
          ))}
      </View>

      {/* UNPAID BILLS GROUPED STRICTLY BY MONTH */}
      {unpaidMonthGroups.length > 0 ? (
        <View style={styles.monthGroupStack}>
          {unpaidMonthGroups.map((group) => {
            const isExpanded = Boolean(expandedMonths[group.billingMonth]);
            const hasPaidPart = group.totalDuePaise < group.totalBilledPaise;

            return (
              <View key={group.billingMonth} style={styles.billCard}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => toggleMonthBreakdown(group.billingMonth)}
                  style={styles.billCardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.billCardHeaderTitle}>
                      {group.monthLabel}
                    </Text>
                    <Text style={styles.mergedTotalAmount}>
                      {formatPaiseToRupees(group.totalDuePaise)}
                    </Text>
                    {hasPaidPart ? (
                      <Text style={styles.dueText}>
                        Remaining of{' '}
                        <Text style={styles.boldText}>
                          {formatPaiseToRupees(group.totalBilledPaise)}
                        </Text>
                      </Text>
                    ) : group.earliestDueDate ? (
                      <Text style={styles.dueText}>
                        Pay before:{' '}
                        <Text style={styles.boldText}>
                          {formatDate(group.earliestDueDate)}
                        </Text>
                      </Text>
                    ) : null}
                  </View>

                  <View style={{ alignItems: 'flex-end', gap: 6 }}>
                    {group.allUnderReview ? (
                      <View style={[styles.statusBadge, styles.badgeReview]}>
                        <Text style={styles.badgeReviewText}>
                          {toSentenceCaseStatus('under_review')}
                        </Text>
                      </View>
                    ) : group.anyRejected ? (
                      <View style={[styles.statusBadge, styles.badgeRejected]}>
                        <Text style={styles.badgeRejectedText}>
                          {toSentenceCaseStatus('rejected')}
                        </Text>
                      </View>
                    ) : (
                      <View style={[styles.statusBadge, styles.badgeUnpaid]}>
                        <Text style={styles.badgeUnpaidText}>
                          {toSentenceCaseStatus('unpaid')}
                        </Text>
                      </View>
                    )}
                    <Text style={styles.expandToggleText}>
                      {isExpanded ? 'Hide breakdown ▴' : 'Tap for breakdown ▾'}
                    </Text>
                  </View>
                </Pressable>

                {/* Actionable items for this month (always visible) */}
                <View style={styles.unpaidItemsList}>
                  {group.bills.map((bill) => renderUnpaidBillActionRow(bill))}
                </View>

                {isExpanded && (
                  <View style={[styles.breakdownBox, { marginTop: 10 }]}>
                    {group.rentBill && (
                      <>
                        <View style={styles.breakdownRow}>
                          <Text style={styles.breakdownLabel}>Room Rent</Text>
                          <Text style={styles.breakdownVal}>
                            {formatPaiseToRupees(
                              group.rentBill.rent_paise || 0
                            )}
                          </Text>
                        </View>
                        {(group.rentBill.wm_paise || 0) > 0 && (
                          <View style={styles.breakdownRow}>
                            <Text style={styles.breakdownLabel}>
                              Washing Machine
                            </Text>
                            <Text style={styles.breakdownVal}>
                              {formatPaiseToRupees(
                                group.rentBill.wm_paise || 0
                              )}
                            </Text>
                          </View>
                        )}
                        {(group.rentBill.ac_paise || 0) > 0 && (
                          <View style={styles.breakdownRow}>
                            <Text style={styles.breakdownLabel}>
                              AC Room Fee
                            </Text>
                            <Text style={styles.breakdownVal}>
                              {formatPaiseToRupees(
                                group.rentBill.ac_paise || 0
                              )}
                            </Text>
                          </View>
                        )}
                      </>
                    )}

                    {group.ebBill && (
                      <View style={styles.breakdownRow}>
                        <Text style={styles.breakdownLabel}>
                          Electricity (EB) Share
                        </Text>
                        <Text style={styles.breakdownVal}>
                          {formatPaiseToRupees(group.ebBill.total_paise)}
                        </Text>
                      </View>
                    )}

                    {hasPaidPart && (
                      <View style={styles.breakdownRow}>
                        <Text style={styles.breakdownLabel}>Already Paid</Text>
                        <Text style={[styles.breakdownVal, { color: '#15803D' }]}>
                          −
                          {formatPaiseToRupees(
                            group.totalBilledPaise - group.totalDuePaise
                          )}
                        </Text>
                      </View>
                    )}

                    <View style={[styles.breakdownRow, styles.totalRow]}>
                      <Text style={styles.totalLabel}>
                        {hasPaidPart ? 'Balance Due' : 'Monthly Total'}
                      </Text>
                      <Text style={styles.totalVal}>
                        {formatPaiseToRupees(group.totalDuePaise)}
                      </Text>
                    </View>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      ) : hasAnyActiveBill ? (
        /* ALL DUES SETTLED: LATEST MONTH CARD */
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
                {formatPaiseToRupees(totalCurrentBilledPaise)}
              </Text>
            </View>

            <View style={{ alignItems: 'flex-end', gap: 6 }}>
              <View style={[styles.statusBadge, styles.badgePaid]}>
                <Text style={styles.badgePaidText}>
                  {toSentenceCaseStatus('paid')}
                </Text>
              </View>
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
                </>
              )}

              {currentEbBill && (
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>
                    Electricity (EB) Share
                  </Text>
                  <Text style={styles.breakdownVal}>
                    {formatPaiseToRupees(currentEbBill.total_paise)}
                  </Text>
                </View>
              )}

              <View style={[styles.breakdownRow, styles.totalRow]}>
                <Text style={styles.totalLabel}>Monthly Total</Text>
                <Text style={styles.totalVal}>
                  {formatPaiseToRupees(totalCurrentBilledPaise)}
                </Text>
              </View>
            </View>
          )}

          {primaryPaymentId && (
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
  monthGroupStack: {
    gap: 12,
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
  unpaidItemsList: {
    gap: 8,
  },
  unpaidItemBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 10,
  },
  unpaidItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  unpaidItemTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  unpaidItemAmount: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  partialPaidSub: {
    fontSize: 11,
    fontWeight: '600',
    color: '#15803D',
    marginTop: 2,
  },
  unpaidItemActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  itemPayChip: {
    flex: 1,
    backgroundColor: '#0284C7',
    borderRadius: 9,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  itemPayChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  itemUploadChip: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 9,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  itemUploadChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  withdrawBtn: {
    flex: 1,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FCD34D',
    borderRadius: 9,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  withdrawBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B45309',
  },
  itemStatusMini: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  itemStatusReview: {
    fontSize: 11,
    fontWeight: '600',
    color: '#B45309',
    marginTop: 2,
  },
  itemStatusRejected: {
    fontSize: 11,
    fontWeight: '600',
    color: '#B91C1C',
    marginTop: 2,
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
