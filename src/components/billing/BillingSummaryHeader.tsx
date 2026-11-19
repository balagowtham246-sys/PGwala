import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check, ChevronLeft, ChevronRight, CreditCard, X } from 'lucide-react-native';
import { SegmentedFilter } from '@/components/ui/owner';
import { OwnerTheme } from '@/constants/theme';
import { formatPaiseToRupees } from '@/lib/billing-utils';
import { BillingFilterTab, BillingMode } from '@/services/billing.service';

export interface BillingSummaryHeaderProps {
  billingMode: BillingMode;
  onSelectBillingMode: (mode: BillingMode) => void;
  monthLabel: string;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  totalBilledPaise: number;
  totalCollectedPaise: number;
  unpaidAmountPaise: number;
  totalCount: number;
  paidCount: number;
  unpaidCount: number;
  reviewCount: number;
  rentUngeneratedCount: number;
  filterTab: BillingFilterTab;
  onSelectFilterTab: (tab: BillingFilterTab) => void;
  onOpenGenerateRent: () => void;
  showGeneratedBanner?: boolean;
  onDismissGeneratedBanner?: () => void;
}

export function BillingSummaryHeader({
  billingMode,
  onSelectBillingMode,
  monthLabel,
  onPrevMonth,
  onNextMonth,
  totalBilledPaise,
  totalCollectedPaise,
  unpaidAmountPaise,
  totalCount,
  paidCount,
  unpaidCount,
  reviewCount,
  rentUngeneratedCount,
  filterTab,
  onSelectFilterTab,
  onOpenGenerateRent,
  showGeneratedBanner = false,
  onDismissGeneratedBanner,
}: BillingSummaryHeaderProps) {
  const collectionPercent =
    totalBilledPaise > 0
      ? Math.min(100, Math.round((totalCollectedPaise / totalBilledPaise) * 100))
      : 0;

  return (
    <>
      {/* Compact Segmented Control: Rent vs Electricity vs Combined */}
      <SegmentedFilter
        options={[
          { key: 'RENT', label: 'Rent' },
          { key: 'EB', label: 'Electricity' },
          { key: 'COMBINED', label: 'Combined' },
        ]}
        activeKey={billingMode}
        onSelect={(key) => onSelectBillingMode(key as BillingMode)}
        style={{ marginBottom: 12 }}
      />

      {/* Compact Month Selector Bar */}
      <View style={styles.monthSelectorBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          hitSlop={8}
          style={({ pressed }) => [
            styles.monthNavBtn,
            pressed && styles.monthNavBtnPressed,
          ]}
          onPress={onPrevMonth}>
          <ChevronLeft size={20} color={OwnerTheme.colors.textPrimary} />
        </Pressable>
        <View style={styles.monthLabelWrap}>
          <Text style={styles.monthLabelText}>{monthLabel}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next month"
          hitSlop={8}
          style={({ pressed }) => [
            styles.monthNavBtn,
            pressed && styles.monthNavBtnPressed,
          ]}
          onPress={onNextMonth}>
          <ChevronRight size={20} color={OwnerTheme.colors.textPrimary} />
        </Pressable>
      </View>

      {/* Single Clean Billing Summary Strip */}
      <View style={styles.summaryStripCard}>
        <View style={styles.summaryTopRow}>
          <View>
            <Text style={styles.summaryLabel}>Total Billed</Text>
            <Text style={styles.summaryTotalValue}>
              {formatPaiseToRupees(totalBilledPaise)}
            </Text>
          </View>
          <View style={styles.summaryRightCol}>
            <Text style={styles.summaryProgressLabel}>Collection progress</Text>
            <Text style={styles.summaryProgressPercent}>
              {collectionPercent}% · {totalCount} resident{totalCount === 1 ? '' : 's'}
            </Text>
          </View>
        </View>

        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${collectionPercent}%` },
            ]}
          />
        </View>

        <Text style={styles.collectionBreakdownText}>
          <Text style={styles.collectedHighlight}>
            {formatPaiseToRupees(totalCollectedPaise)} collected
          </Text>
          {' · '}
          <Text
            style={
              unpaidAmountPaise > 0
                ? styles.pendingHighlight
                : styles.settledHighlight
            }>
            {formatPaiseToRupees(unpaidAmountPaise)} pending
          </Text>
        </Text>
      </View>

      {/* Needs Review indicator if applicable */}
      {reviewCount > 0 && (
        <Pressable
          style={styles.reviewBanner}
          onPress={() => onSelectFilterTab('REVIEW')}>
          <View style={styles.reviewBannerIcon}>
            <CreditCard size={16} color={OwnerTheme.colors.warning} />
          </View>
          <Text style={styles.reviewBannerText}>
            {reviewCount} payment proof{reviewCount > 1 ? 's' : ''} awaiting
            review
          </Text>
          <Text style={styles.reviewBannerAction}>View ›</Text>
        </Pressable>
      )}

      {/* Unbilled warning OR transient post-generation success banner */}
      {billingMode === 'RENT' ? (
        rentUngeneratedCount > 0 ? (
          <View style={styles.inlineWarningBanner}>
            <Text style={styles.inlineWarningText}>
              {rentUngeneratedCount} resident
              {rentUngeneratedCount > 1 ? 's' : ''} not yet billed for{' '}
              {monthLabel}.
            </Text>
            <Pressable accessibilityRole="button" onPress={onOpenGenerateRent}>
              <Text style={styles.inlineActionLink}>Generate Bills ›</Text>
            </Pressable>
          </View>
        ) : showGeneratedBanner ? (
          <View style={styles.inlineSuccessBanner}>
            <View style={styles.inlineSuccessLeft}>
              <Check size={14} color={OwnerTheme.colors.success} />
              <Text style={styles.inlineSuccessText}>
                Bills generated for all active residents.
              </Text>
            </View>
            {onDismissGeneratedBanner && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Dismiss banner"
                hitSlop={8}
                onPress={onDismissGeneratedBanner}>
                <X size={14} color={OwnerTheme.colors.success} />
              </Pressable>
            )}
          </View>
        ) : null
      ) : billingMode === 'EB' ? (
        <View style={styles.ebSplitterBanner}>
          <View style={{ flex: 1 }}>
            <Text style={styles.ebSplitterTitle}>Room EB Splitter</Text>
            <Text style={styles.ebSplitterSub}>
              Use &ldquo;Split EB&rdquo; above to divide room electricity equally
              among occupants.
            </Text>
          </View>
        </View>
      ) : null}

      {/* Compact Billing Filter Tabs */}
      <SegmentedFilter
        options={[
          { key: 'ALL', label: 'All', count: totalCount },
          { key: 'REVIEW', label: 'Review', count: reviewCount },
          { key: 'UNPAID', label: 'Unpaid', count: unpaidCount },
          { key: 'PAID', label: 'Paid', count: paidCount },
        ]}
        activeKey={filterTab}
        onSelect={(key) => onSelectFilterTab(key as BillingFilterTab)}
        style={{ marginVertical: 12 }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  monthSelectorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.md,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  monthNavBtn: {
    width: 34,
    height: 34,
    borderRadius: OwnerTheme.radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  monthNavBtnPressed: {
    backgroundColor: '#F1F5F9',
  },
  monthLabelWrap: {
    alignItems: 'center',
  },
  monthLabelText: {
    fontSize: 15,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  summaryStripCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 14,
    marginBottom: 10,
  },
  summaryTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 10,
  },
  summaryLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  summaryTotalValue: {
    fontSize: 22,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
    letterSpacing: -0.4,
    marginTop: 2,
  },
  summaryRightCol: {
    alignItems: 'flex-end',
  },
  summaryProgressLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  summaryProgressPercent: {
    fontSize: 13,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
    marginTop: 2,
  },
  progressTrack: {
    height: 6,
    borderRadius: OwnerTheme.radius.full,
    backgroundColor: '#E2E8F0',
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    borderRadius: OwnerTheme.radius.full,
    backgroundColor: OwnerTheme.colors.success,
  },
  collectionBreakdownText: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  collectedHighlight: {
    color: OwnerTheme.colors.success,
    fontWeight: '600',
  },
  pendingHighlight: {
    color: OwnerTheme.colors.danger,
    fontWeight: '600',
  },
  settledHighlight: {
    color: OwnerTheme.colors.textSecondary,
    fontWeight: '600',
  },
  reviewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: OwnerTheme.radius.md,
    paddingVertical: 9,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  reviewBannerIcon: {
    marginRight: 8,
  },
  reviewBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#92400E',
  },
  reviewBannerAction: {
    fontSize: 13,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  inlineSuccessBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: OwnerTheme.colors.successLight,
    borderRadius: OwnerTheme.radius.sm,
    marginBottom: 8,
  },
  inlineSuccessLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  inlineSuccessText: {
    fontSize: 12,
    fontWeight: '500',
    color: OwnerTheme.colors.success,
  },
  inlineWarningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#FEF3C7',
    borderRadius: OwnerTheme.radius.sm,
    marginBottom: 8,
  },
  inlineWarningText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#92400E',
  },
  inlineActionLink: {
    fontSize: 12,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  ebSplitterBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    borderRadius: OwnerTheme.radius.md,
    padding: 12,
    marginBottom: 8,
  },
  ebSplitterTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  ebSplitterSub: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 2,
  },
});
