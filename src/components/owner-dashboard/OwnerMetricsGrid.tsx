import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Href, router } from 'expo-router';
import {
  Building2,
  ChevronRight,
  Disc3,
  LogIn,
  LogOut,
  Megaphone,
  QrCode,
  Users,
  Wrench,
} from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';
import { useResidentTabs } from '@/context/resident-tabs-context';
import { formatPaiseToRupees } from '@/lib/billing-utils';
import type { OwnerDashboardStats } from '@/services/dashboard.service';

interface OwnerMetricsGridProps {
  stats: OwnerDashboardStats;
  totalBeds?: number;
}

export function OwnerMetricsGrid({ stats, totalBeds = 0 }: OwnerMetricsGridProps) {
  const { isInsidePager, navigateToTab } = useResidentTabs();

  const pendingRentPaise = Math.max(0, stats.rentTotalPaise - stats.rentCollectedPaise);
  const collectionPct =
    stats.rentTotalPaise > 0
      ? Math.min(100, Math.round((stats.rentCollectedPaise / stats.rentTotalPaise) * 100))
      : 0;
  const unpaidCount = stats.unpaidResidentsCount ?? 0;
  const occupancyLabel =
    totalBeds > 0
      ? `${stats.totalResidents}/${totalBeds} beds`
      : `${stats.totalResidents} active`;

  const goBilling = () => {
    if (isInsidePager) {
      navigateToTab('bill');
    } else {
      router.push('/billing-management');
    }
  };

  const goGate = () => {
    if (isInsidePager) {
      navigateToTab('gate');
    } else {
      router.push('/resident-in-out');
    }
  };

  const goMaintenance = () => {
    if (isInsidePager) {
      navigateToTab('maintenance');
    } else {
      router.push('/owner-complaints');
    }
  };

  return (
    <View style={styles.root}>
      {/* Fintech-Modern Dark-Slate Hero Revenue & Occupancy Card */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open monthly billing and rent collection"
        style={({ pressed }) => [styles.heroCard, pressed && styles.cardPressed]}
        onPress={goBilling}>
        <View style={styles.heroTopRow}>
          <Text style={styles.heroEyebrow}>MONTHLY RENT COLLECTION</Text>
          <View style={styles.occupancyPill}>
            <Building2 size={11} color="#CBD5E1" />
            <Text style={styles.occupancyPillText}>{occupancyLabel}</Text>
          </View>
        </View>

        <View style={styles.heroAmountRow}>
          <View style={styles.heroAmountCol}>
            <Text style={styles.heroAmount}>
              {formatPaiseToRupees(stats.rentCollectedPaise)}
            </Text>
            <Text style={styles.heroTotalSub}>
              {stats.rentTotalPaise > 0
                ? `of ${formatPaiseToRupees(stats.rentTotalPaise)} billed`
                : 'No bills generated yet'}
            </Text>
          </View>

          <View
            style={[
              styles.pendingBadge,
              pendingRentPaise > 0 ? styles.pendingBadgeDue : styles.pendingBadgeClear,
            ]}>
            <Text
              style={[
                styles.pendingBadgeText,
                pendingRentPaise > 0
                  ? styles.pendingBadgeTextDue
                  : styles.pendingBadgeTextClear,
              ]}>
              {stats.rentTotalPaise === 0
                ? 'Not billed'
                : pendingRentPaise > 0
                  ? `${formatPaiseToRupees(pendingRentPaise)} pending`
                  : 'All settled'}
            </Text>
          </View>
        </View>

        {/* Visual Progress Bar */}
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              {
                width: `${stats.rentTotalPaise > 0 ? Math.max(collectionPct, 4) : 0}%`,
                backgroundColor:
                  collectionPct >= 80 ? '#10B981' : '#38BDF8',
              },
            ]}
          />
        </View>

        <View style={styles.heroFooterRow}>
          <Text style={styles.heroFooterMeta}>
            {stats.rentTotalPaise > 0
              ? `${collectionPct}% collected · ${unpaidCount} with dues`
              : `${stats.totalResidents} active residents`}
          </Text>
          {stats.pendingProofsCount > 0 ? (
            <View style={styles.proofAlertPill}>
              <Text style={styles.proofAlertText}>
                {stats.pendingProofsCount} proof{stats.pendingProofsCount > 1 ? 's' : ''} to verify ›
              </Text>
            </View>
          ) : (
            <View style={styles.heroLinkRow}>
              <Text style={styles.heroLinkText}>Billing</Text>
              <ChevronRight size={13} color="#38BDF8" />
            </View>
          )}
        </View>
      </Pressable>

      {/* 4-Icon Quick Action Dock (distinct tools not in bottom bar) */}
      <View style={styles.quickDock}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="View residents directory"
          style={({ pressed }) => [styles.dockItem, pressed && styles.cardPressed]}
          onPress={() => router.push('/residents-directory' as Href)}>
          <View style={[styles.dockIconWrap, { backgroundColor: '#DCFCE7' }]}>
            <Users size={19} color="#059669" />
          </View>
          <Text style={styles.dockLabel} numberOfLines={1}>
            Residents
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Invite residents via QR code or review join requests"
          style={({ pressed }) => [styles.dockItem, pressed && styles.cardPressed]}
          onPress={() => router.push('/owner-join-requests' as Href)}>
          <View style={[styles.dockIconWrap, { backgroundColor: '#E0F2FE' }]}>
            <QrCode size={19} color="#0284C7" />
          </View>
          <Text style={styles.dockLabel} numberOfLines={1}>
            Invite QR
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send announcement"
          style={({ pressed }) => [styles.dockItem, pressed && styles.cardPressed]}
          onPress={() => router.push('/owner-announcements' as Href)}>
          <View style={[styles.dockIconWrap, { backgroundColor: '#F3E8FF' }]}>
            <Megaphone size={19} color="#7C3AED" />
          </View>
          <Text style={styles.dockLabel} numberOfLines={1}>
            Notice
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Manage washing machines and live status"
          style={({ pressed }) => [styles.dockItem, pressed && styles.cardPressed]}
          onPress={() => router.push('/owner-settings' as Href)}>
          <View style={[styles.dockIconWrap, { backgroundColor: '#FEF3C7' }]}>
            <Disc3 size={19} color="#D97706" />
          </View>
          <Text style={styles.dockLabel} numberOfLines={1}>
            Machines
          </Text>
        </Pressable>
      </View>

      {/* Single-Source-of-Truth Live Operations Strip (Zero Duplication) */}
      <View style={styles.opsStrip}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Residents inside PG"
          style={({ pressed }) => [styles.opsTile, pressed && styles.cardPressed]}
          onPress={goGate}>
          <View style={styles.opsTileHeader}>
            <View style={[styles.opsIconDot, { backgroundColor: '#DCFCE7' }]}>
              <LogIn size={13} color="#16A34A" />
            </View>
            <Text style={styles.opsLabel}>Inside</Text>
          </View>
          <Text style={[styles.opsValue, { color: '#15803D' }]}>
            {stats.studentsInside}
          </Text>
          <Text style={styles.opsSub} numberOfLines={1}>
            of {stats.totalResidents} active
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Residents outside PG"
          style={({ pressed }) => [styles.opsTile, pressed && styles.cardPressed]}
          onPress={goGate}>
          <View style={styles.opsTileHeader}>
            <View style={[styles.opsIconDot, { backgroundColor: '#FEF3C7' }]}>
              <LogOut size={13} color="#D97706" />
            </View>
            <Text style={styles.opsLabel}>Outside</Text>
          </View>
          <Text
            style={[
              styles.opsValue,
              { color: stats.studentsOutside > 0 ? '#D97706' : '#0F172A' },
            ]}>
            {stats.studentsOutside}
          </Text>
          <Text style={styles.opsSub} numberOfLines={1}>
            Checked out
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open maintenance issues"
          style={({ pressed }) => [styles.opsTile, pressed && styles.cardPressed]}
          onPress={goMaintenance}>
          <View style={styles.opsTileHeader}>
            <View
              style={[
                styles.opsIconDot,
                {
                  backgroundColor:
                    stats.openComplaintsCount > 0 ? '#FEE2E2' : '#F1F5F9',
                },
              ]}>
              <Wrench
                size={13}
                color={stats.openComplaintsCount > 0 ? '#DC2626' : '#64748B'}
              />
            </View>
            <Text style={styles.opsLabel}>Issues</Text>
          </View>
          <Text
            style={[
              styles.opsValue,
              { color: stats.openComplaintsCount > 0 ? '#DC2626' : '#0F172A' },
            ]}>
            {stats.openComplaintsCount}
          </Text>
          <Text style={styles.opsSub} numberOfLines={1}>
            {stats.openComplaintsCount > 0 ? 'Needs action' : 'All clear'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 12,
  },
  heroCard: {
    backgroundColor: '#0F172A',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#1E293B',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 6,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  heroEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: '#94A3B8',
  },
  occupancyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  occupancyPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#E2E8F0',
  },
  heroAmountRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 12,
  },
  heroAmountCol: {
    flex: 1,
    minWidth: 0,
  },
  heroAmount: {
    fontSize: 30,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.8,
  },
  heroTotalSub: {
    fontSize: 12,
    fontWeight: '500',
    color: '#94A3B8',
    marginTop: 2,
  },
  pendingBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  pendingBadgeClear: {
    backgroundColor: 'rgba(16, 185, 129, 0.18)',
  },
  pendingBadgeDue: {
    backgroundColor: 'rgba(244, 63, 94, 0.22)',
  },
  pendingBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  pendingBadgeTextClear: {
    color: '#34D399',
  },
  pendingBadgeTextDue: {
    color: '#FDA4AF',
  },
  progressTrack: {
    height: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
    marginTop: 16,
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  heroFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 12,
  },
  heroFooterMeta: {
    fontSize: 12,
    fontWeight: '500',
    color: '#CBD5E1',
    flex: 1,
  },
  proofAlertPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(56, 189, 248, 0.2)',
  },
  proofAlertText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#7DD3FC',
  },
  heroLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  heroLinkText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#38BDF8',
  },
  quickDock: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    ...OwnerTheme.shadow,
  },
  dockItem: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 2,
  },
  dockIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dockLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
    textAlign: 'center',
  },
  opsStrip: {
    flexDirection: 'row',
    gap: 8,
  },
  opsTile: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    ...OwnerTheme.shadow,
  },
  opsTileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  opsIconDot: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  opsLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  opsValue: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginTop: 8,
  },
  opsSub: {
    fontSize: 11,
    fontWeight: '500',
    color: OwnerTheme.colors.textMuted,
    marginTop: 2,
  },
  cardPressed: {
    opacity: 0.86,
    transform: [{ scale: 0.99 }],
  },
});
