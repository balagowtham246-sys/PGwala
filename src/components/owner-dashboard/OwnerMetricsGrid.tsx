import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { LogIn, LogOut, Receipt, Wrench } from 'lucide-react-native';

import { StatisticCard } from '@/components/ui/owner';
import { OwnerTheme } from '@/constants/theme';
import { formatPaiseToRupees } from '@/lib/billing-utils';
import { toSentenceCaseStatus } from '@/lib/ux-utils';
import type { OwnerDashboardStats } from '@/services/dashboard.service';

interface OwnerMetricsGridProps {
  stats: OwnerDashboardStats;
}

export function OwnerMetricsGrid({ stats }: OwnerMetricsGridProps) {
  const pendingRentPaise = Math.max(0, stats.rentTotalPaise - stats.rentCollectedPaise);
  const hasAttentionItems =
    stats.pendingProofsCount > 0 ||
    stats.studentsOutside > 0 ||
    stats.openComplaintsCount > 0;

  return (
    <>
      {/* Priority Area 0: Needs Attention Strip (Actionable Alerts) */}
      {hasAttentionItems && (
        <View style={styles.attentionSection}>
          <Text style={styles.attentionTitle}>Needs Attention</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.attentionStrip}>
            {stats.pendingProofsCount > 0 && (
              <Pressable
                accessibilityRole="button"
                style={[styles.attentionChip, styles.attentionChipPrimary]}
                onPress={() => router.push('/billing-management')}>
                <Text style={[styles.attentionChipText, styles.attentionTextPrimary]}>
                  {stats.pendingProofsCount} proof
                  {stats.pendingProofsCount > 1 ? 's' : ''} to verify
                </Text>
              </Pressable>
            )}
            {stats.studentsOutside > 0 && (
              <Pressable
                accessibilityRole="button"
                style={[styles.attentionChip, styles.attentionChipWarning]}
                onPress={() => router.push('/student-in-out')}>
                <Text style={[styles.attentionChipText, styles.attentionTextWarning]}>
                  {stats.studentsOutside} outside PG
                </Text>
              </Pressable>
            )}
            {stats.openComplaintsCount > 0 && (
              <Pressable
                accessibilityRole="button"
                style={[styles.attentionChip, styles.attentionChipWarning]}
                onPress={() => router.push('/owner-complaints')}>
                <Text style={[styles.attentionChipText, styles.attentionTextWarning]}>
                  {stats.openComplaintsCount} open issue
                  {stats.openComplaintsCount > 1 ? 's' : ''}
                </Text>
              </Pressable>
            )}
          </ScrollView>
        </View>
      )}

      {/* Priority Area 1: 4-Card Operational KPI Grid (Money & Alerts First) */}
      <View style={styles.kpiGrid}>
        <View style={styles.gateStatsRow}>
          <StatisticCard
            label="Pending Rent"
            value={formatPaiseToRupees(pendingRentPaise)}
            accentColor={
              pendingRentPaise > 0 ? OwnerTheme.colors.danger : OwnerTheme.colors.success
            }
            icon={Receipt}
            sublabel={
              stats.pendingProofsCount > 0
                ? `${stats.pendingProofsCount} proof${stats.pendingProofsCount > 1 ? 's' : ''} pending`
                : `${formatPaiseToRupees(stats.rentCollectedPaise)} collected`
            }
            onPress={() => router.push('/billing-management')}
            style={styles.gateStatHalfCard}
          />
          <StatisticCard
            label="Open Maintenance"
            value={stats.openComplaintsCount}
            accentColor={
              stats.openComplaintsCount > 0
                ? OwnerTheme.colors.warning
                : OwnerTheme.colors.textSecondary
            }
            icon={Wrench}
            sublabel={stats.openComplaintsCount > 0 ? 'Needs attention' : 'All resolved'}
            onPress={() => router.push('/owner-complaints')}
            style={styles.gateStatHalfCard}
          />
        </View>
        <View style={styles.gateStatsRow}>
          <StatisticCard
            label="Residents Inside"
            value={stats.studentsInside}
            accentColor={OwnerTheme.colors.success}
            icon={LogIn}
            sublabel={`of ${stats.totalResidents} active`}
            onPress={() => router.push('/student-in-out')}
            style={styles.gateStatHalfCard}
          />
          <StatisticCard
            label={toSentenceCaseStatus('outside')}
            value={stats.studentsOutside}
            accentColor={OwnerTheme.colors.warning}
            icon={LogOut}
            sublabel="Checked out"
            onPress={() => router.push('/student-in-out')}
            style={styles.gateStatHalfCard}
          />
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  attentionSection: {
    gap: 6,
  },
  attentionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: OwnerTheme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  attentionStrip: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 2,
  },
  attentionChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: OwnerTheme.radius.full,
    borderWidth: 1,
  },
  attentionChipPrimary: {
    backgroundColor: OwnerTheme.colors.primaryLight,
    borderColor: '#BAE6FD',
  },
  attentionChipWarning: {
    backgroundColor: OwnerTheme.colors.warningLight,
    borderColor: '#FDE68A',
  },
  attentionChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  attentionTextPrimary: {
    color: OwnerTheme.colors.primary,
  },
  attentionTextWarning: {
    color: '#B45309',
  },
  kpiGrid: {
    gap: 8,
  },
  gateStatsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  gateStatHalfCard: {
    flex: 1,
  },
});
