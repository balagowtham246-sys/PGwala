import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatPaiseToRupees } from '@/lib/billing-utils';
import { toSentenceCaseStatus } from '@/lib/ux-utils';
import { StudentBillCardItem } from '@/services/billing.service';

export interface AllocationHistoryCardProps {
  bill: StudentBillCardItem;
  onOpenReceipt?: (paymentId: string) => void;
}

function formatHistoryDate(iso?: string | null): string | null {
  if (!iso) return null;
  const datePart = iso.trim().split('T')[0];
  const [y, m, d] = datePart.split('-').map(Number);
  if (!y || !m || !d) return null;
  const parsed = new Date(y, m - 1, d);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function AllocationHistoryCard({
  bill,
  onOpenReceipt,
}: AllocationHistoryCardProps) {
  const paidDateLabel = formatHistoryDate(bill.paid_date);
  return (
    <View style={styles.historyCard}>
      <View style={styles.historyCardLeft}>
        <Text style={styles.historyMonth}>
          {bill.month_label} · {bill.title}
        </Text>
        <Text style={styles.historyAmount}>
          {formatPaiseToRupees(bill.total_paise)}
        </Text>
        {bill.category === 'rent' && (
          <Text style={styles.historyMeta}>
            Rent: {formatPaiseToRupees(bill.rent_paise || 0)}
            {(bill.wm_paise || 0) > 0
              ? ` + WM: ${formatPaiseToRupees(bill.wm_paise || 0)}`
              : ''}
            {(bill.ac_paise || 0) > 0
              ? ` + AC: ${formatPaiseToRupees(bill.ac_paise || 0)}`
              : ''}
          </Text>
        )}
        {paidDateLabel && (
          <Text style={styles.historyMeta}>Paid {paidDateLabel}</Text>
        )}
      </View>

      <View style={styles.historyCardRight}>
        {bill.status === 'paid' ? (
          <View style={[styles.statusBadge, styles.badgePaid]}>
            <Text style={styles.badgePaidText}>{toSentenceCaseStatus('paid')}</Text>
          </View>
        ) : bill.pending_report?.status === 'pending' ? (
          <View style={[styles.statusBadge, styles.badgeReview]}>
            <Text style={styles.badgeReviewText}>
              {toSentenceCaseStatus('under_review')}
            </Text>
          </View>
        ) : bill.pending_report?.status === 'rejected' ? (
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

        {bill.payment_id && onOpenReceipt ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={6}
            onPress={() => onOpenReceipt(bill.payment_id!)}>
            <Text style={styles.historyReceiptLink}>
              {bill.receipt_number ? `${bill.receipt_number} ›` : 'Receipt ›'}
            </Text>
          </Pressable>
        ) : bill.receipt_number ? (
          <Text style={styles.historyReceiptNum}>{bill.receipt_number}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  historyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  historyCardLeft: {
    gap: 2,
    flex: 1,
  },
  historyMonth: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  historyAmount: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0284C7',
  },
  historyMeta: {
    fontSize: 11,
    color: '#64748B',
  },
  historyCardRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  historyReceiptNum: {
    fontSize: 10,
    color: '#94A3B8',
  },
  historyReceiptLink: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0284C7',
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
});
