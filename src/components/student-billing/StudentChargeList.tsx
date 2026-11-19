import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatPaiseToRupees } from '@/lib/billing-utils';
import { StudentBillCardItem } from '@/services/billing.service';

export interface StudentChargeListProps {
  currentRentBill: StudentBillCardItem | null;
  currentEbBill: StudentBillCardItem | null;
  breakdownExpanded: boolean;
  onToggleBreakdown: () => void;
  onOpenPaymentModal: (bill: StudentBillCardItem) => void;
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
  onToggleBreakdown,
  onOpenPaymentModal,
  onOpenReceipt,
}: StudentChargeListProps) {
  const unpaidBills = [currentRentBill, currentEbBill].filter(
    (b): b is StudentBillCardItem => Boolean(b && b.status !== 'paid')
  );
  const totalDuePaise = unpaidBills.reduce((s, b) => s + b.total_paise, 0);
  const totalBilledPaise =
    (currentRentBill?.total_paise || 0) + (currentEbBill?.total_paise || 0);
  const hasAnyCurrentBill = Boolean(currentRentBill || currentEbBill);
  const allCurrentPaid = hasAnyCurrentBill && unpaidBills.length === 0;
  const anyPendingReview = unpaidBills.some(
    (b) => b.pending_report?.status === 'pending'
  );
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

  return (
    <>
      {/* HERO STATUS FIRST */}
      <View
        style={[
          styles.heroStatusCard,
          totalDuePaise === 0 ? styles.heroStatusClear : styles.heroStatusDue,
        ]}>
        <Text
          style={[
            styles.heroStatusAmount,
            totalDuePaise === 0
              ? styles.heroStatusAmountClear
              : styles.heroStatusAmountDue,
          ]}>
          {totalDuePaise === 0
            ? 'All clear'
            : `${formatPaiseToRupees(totalDuePaise)} due`}
        </Text>
        <Text style={styles.heroStatusSub}>
          {totalDuePaise === 0
            ? 'No pending dues for this month'
            : anyPendingReview
            ? 'Payment proof submitted • Awaiting owner review'
            : earliestDueDate
            ? `Pay before ${formatDate(earliestDueDate)}`
            : 'Pending payment for this month'}
        </Text>
        {unpaidBills.length > 0 && (
          <Pressable
            style={({ pressed }) => [
              styles.heroPayBtn,
              pressed && styles.pressed,
            ]}
            onPress={() => onOpenPaymentModal(unpaidBills[0])}>
            <Text style={styles.heroPayBtnText}>
              Pay via UPI & Upload Proof
            </Text>
          </Pressable>
        )}
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
                  <Text style={styles.badgePaidText}>PAID</Text>
                </View>
              ) : anyPendingReview ? (
                <View style={[styles.statusBadge, styles.badgeReview]}>
                  <Text style={styles.badgeReviewText}>UNDER REVIEW</Text>
                </View>
              ) : anyRejected ? (
                <View style={[styles.statusBadge, styles.badgeRejected]}>
                  <Text style={styles.badgeRejectedText}>REJECTED</Text>
                </View>
              ) : (
                <View style={[styles.statusBadge, styles.badgeUnpaid]}>
                  <Text style={styles.badgeUnpaidText}>UNPAID</Text>
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
                  {currentRentBill.status !== 'paid' && (
                    <View style={styles.itemActionInline}>
                      <Text style={styles.itemStatusMini}>
                        {currentRentBill.pending_report?.status === 'pending'
                          ? 'Rent proof under review'
                          : currentRentBill.pending_report?.status ===
                            'rejected'
                          ? 'Rent proof rejected'
                          : 'Rent unpaid'}
                      </Text>
                      <Pressable
                        onPress={() => onOpenPaymentModal(currentRentBill)}>
                        <Text style={styles.itemPayMiniLink}>
                          {currentRentBill.pending_report?.status === 'rejected'
                            ? 'Resubmit ›'
                            : 'Pay Rent ›'}
                        </Text>
                      </Pressable>
                    </View>
                  )}
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
                  {currentEbBill.status !== 'paid' && (
                    <View style={styles.itemActionInline}>
                      <Text style={styles.itemStatusMini}>
                        {currentEbBill.pending_report?.status === 'pending'
                          ? 'EB proof under review'
                          : currentEbBill.pending_report?.status === 'rejected'
                          ? 'EB proof rejected'
                          : 'EB unpaid'}
                      </Text>
                      <Pressable
                        onPress={() => onOpenPaymentModal(currentEbBill)}>
                        <Text style={styles.itemPayMiniLink}>
                          {currentEbBill.pending_report?.status === 'rejected'
                            ? 'Resubmit ›'
                            : 'Pay EB ›'}
                        </Text>
                      </Pressable>
                    </View>
                  )}
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
          <Text style={styles.emptyTitle}>No Active Bills</Text>
          <Text style={styles.emptySubtitle}>
            Your owner has not generated any bills for this month yet. Check
            back soon!
          </Text>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  heroStatusCard: {
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    marginBottom: 14,
  },
  heroStatusClear: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  heroStatusDue: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  heroStatusAmount: {
    fontSize: 28,
    fontWeight: '800',
  },
  heroStatusAmountClear: {
    color: '#15803D',
  },
  heroStatusAmountDue: {
    color: '#B45309',
  },
  heroStatusSub: {
    fontSize: 13,
    color: '#475569',
    marginTop: 4,
  },
  heroPayBtn: {
    marginTop: 14,
    backgroundColor: '#0284C7',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  heroPayBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
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
  itemPayMiniLink: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0284C7',
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
    borderRadius: 14,
    padding: 24,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
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
