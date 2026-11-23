import { useQueryClient } from '@tanstack/react-query';
import { Href, router, useFocusEffect } from 'expo-router';
import {
  Bell,
  Building2,
  ChevronDown,
  User,
  Utensils,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  AddPropertyModal,
  PropertySwitcherModal,
} from '@/components/owner-dashboard/OwnerDashboardModals';
import { OwnerMetricsGrid } from '@/components/owner-dashboard/OwnerMetricsGrid';
import { OwnerQuickActions } from '@/components/owner-dashboard/OwnerQuickActions';
import { RecentActivitySection } from '@/components/owner-dashboard/RecentActivitySection';
import { RoleBottomNav } from '@/components/ui/bottom-nav';
import { DashboardSkeleton, ErrorState } from '@/components/ui/owner';
import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useProperty } from '@/context/property-context';
import { useResidentTabs } from '@/context/resident-tabs-context';
import {
  useOwnerDashboardQuery,
  useOwnerUnreadInboxQuery,
} from '@/hooks/use-dashboards';
import { invalidatePrefix } from '@/lib/query-cache';
import { extractErrorMessage } from '@/lib/error-utils';
import { queryKeys } from '@/lib/query-keys';
import { supabase } from '@/lib/supabase';
import { toSentenceCaseStatus } from '@/lib/ux-utils';
import {
  createEmptyOwnerMenus,
  DashboardWmUnit,
  MealType,
  OwnerFoodMenuRecord,
  toLocalIsoDate,
} from '@/services/dashboard.service';

export type { DashboardWmUnit, MealType, OwnerFoodMenuRecord };

const MEAL_CONFIG: Record<MealType, { title: string }> = {
  breakfast: { title: 'Breakfast' },
  lunch: { title: 'Lunch' },
  dinner: { title: 'Dinner' },
};

function getFeaturedMealKey(
  todayMenus: Record<MealType, OwnerFoodMenuRecord | null>
): MealType {
  const hour = new Date().getHours();
  const order: MealType[] =
    hour < 11
      ? ['breakfast', 'lunch', 'dinner']
      : hour < 16
        ? ['lunch', 'dinner', 'breakfast']
        : ['dinner', 'breakfast', 'lunch'];

  return order.find((key) => Boolean(todayMenus[key])) ?? order[0];
}

export default function OwnerDashboard() {
  const qc = useQueryClient();
  const { user, session, profile, isLoading: authLoading } = useAuth();
  const {
    properties,
    selectedProperty,
    selectedPropertyId,
    selectProperty,
    addProperty,
  } = useProperty();
  const { isInsidePager, navigateToTab } = useResidentTabs();

  const userId = user?.id;
  const profileRole = profile?.role;

  const [manualRefreshing, setManualRefreshing] = useState(false);

  // Property Switcher Modal State
  const [switcherVisible, setSwitcherVisible] = useState(false);
  const [showAddPropertyModal, setShowAddPropertyModal] = useState(false);
  const [newPropName, setNewPropName] = useState('');
  const [newPropAddress, setNewPropAddress] = useState('');
  const [creatingProperty, setCreatingProperty] = useState(false);

  const hasFocusedOnceRef = useRef(false);

  const canQueryOwner = !authLoading && Boolean(userId) && profileRole === 'owner';
  const dashboardQuery = useOwnerDashboardQuery(selectedPropertyId, canQueryOwner);
  const inboxQuery = useOwnerUnreadInboxQuery(userId, selectedPropertyId, canQueryOwner);

  const dash = dashboardQuery.data;
  const loading =
    authLoading ||
    (canQueryOwner && Boolean(selectedPropertyId) && dashboardQuery.isPending && !dash);
  const refreshing = manualRefreshing;
  const errorMessage = dashboardQuery.isError
    ? `Failed to load dashboard: ${dashboardQuery.error.message}`
    : null;

  const stats = useMemo(
    () =>
      dash?.stats ?? {
        totalResidents: 0,
        studentsInside: 0,
        studentsOutside: 0,
        openComplaintsCount: 0,
        rentCollectedPaise: 0,
        rentTotalPaise: 0,
        pendingProofsCount: 0,
        unpaidResidentsCount: 0,
      },
    [dash?.stats]
  );
  const todayMenus = useMemo(
    () => dash?.todayMenus ?? createEmptyOwnerMenus(),
    [dash?.todayMenus]
  );
  const recentActivities = useMemo(
    () => dash?.recentActivities ?? [],
    [dash?.recentActivities]
  );
  const unreadInboxCount = canQueryOwner && selectedPropertyId ? (inboxQuery.data ?? 0) : 0;

  const refetchDashboard = dashboardQuery.refetch;
  const refetchInbox = inboxQuery.refetch;

  const loadDashboardData = useCallback(async () => {
    if (!canQueryOwner || !selectedPropertyId) return;
    await refetchDashboard();
  }, [canQueryOwner, selectedPropertyId, refetchDashboard]);

  useEffect(() => {
    if (authLoading) return;
    if (!session || !userId) {
      router.replace('/login');
    }
  }, [authLoading, session, userId]);

  const refreshUnreadInboxCount = useCallback(
    async (forceInvalidate = false) => {
      if (!canQueryOwner || !selectedPropertyId) {
        return;
      }
      if (forceInvalidate) {
        await invalidatePrefix('inbox:');
      }
      await refetchInbox();
    },
    [canQueryOwner, selectedPropertyId, refetchInbox]
  );

  // Refetch stale operational status, menu, and unread notifications on return
  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedOnceRef.current) {
        hasFocusedOnceRef.current = true;
        return;
      }
      if (canQueryOwner && selectedPropertyId) {
        const todayIso = toLocalIsoDate();
        void qc.invalidateQueries({
          queryKey: queryKeys.dashboard.owner(selectedPropertyId, todayIso),
        });
        void refreshUnreadInboxCount(true);
      }
    }, [canQueryOwner, selectedPropertyId, qc, refreshUnreadInboxCount])
  );

  const handleOpenFoodMenu = () => {
    if (isInsidePager) {
      navigateToTab('menu');
    } else {
      router.push('/food-menu');
    }
  };

  const [isScreenFocused, setIsScreenFocused] = useState(true);
  const [isAppActive, setIsAppActive] = useState(AppState.currentState === 'active');

  useFocusEffect(
    useCallback(() => {
      setIsScreenFocused(true);
      return () => setIsScreenFocused(false);
    }, [])
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      setIsAppActive(nextState === 'active');
    });
    return () => sub.remove();
  }, []);

  // Realtime listener for gate movements & complaints (300ms debounced, active/focused only)
  useEffect(() => {
    if (!userId || profileRole !== 'owner' || !selectedPropertyId || !isScreenFocused || !isAppActive) {
      return;
    }

    let active = true;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRealtimeRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (!active) return;
        const todayIso = toLocalIsoDate();
        void (async () => {
          await invalidatePrefix('inbox:');
          if (!active) return;
          await Promise.all([
            qc.invalidateQueries({
              queryKey: queryKeys.dashboard.owner(selectedPropertyId, todayIso),
            }),
            qc.invalidateQueries({
              queryKey: queryKeys.dashboard.ownerInbox(userId, selectedPropertyId),
            }),
          ]);
        })();
      }, 300);
    };

    const channel = supabase
      .channel(`owner_home_alerts_${selectedPropertyId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'movement_logs',
          filter: `property_id=eq.${selectedPropertyId}`,
        },
        scheduleRealtimeRefresh
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'complaints',
          filter: `property_id=eq.${selectedPropertyId}`,
        },
        scheduleRealtimeRefresh
      )
      .subscribe();

    return () => {
      active = false;
      if (debounceTimer) clearTimeout(debounceTimer);
      void supabase.removeChannel(channel);
    };
  }, [
    userId,
    profileRole,
    selectedPropertyId,
    isScreenFocused,
    isAppActive,
    qc,
  ]);

  const handleRefresh = () => {
    setManualRefreshing(true);
    void Promise.all([
      loadDashboardData(),
      refreshUnreadInboxCount(true),
    ]).finally(() => {
      setManualRefreshing(false);
    });
  };

  // Add new PG property from modal
  const handleCreateProperty = async () => {
    const trimmed = newPropName.trim();
    if (!trimmed) {
      Alert.alert('Required', 'Please enter a PG property name.');
      return;
    }

    try {
      setCreatingProperty(true);
      await addProperty(trimmed, newPropAddress.trim() || undefined);
      setShowAddPropertyModal(false);
      setSwitcherVisible(false);
      setNewPropName('');
      setNewPropAddress('');
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
      Alert.alert('Property Added', `Switched to "${trimmed}".`);
    } catch (err: unknown) {
      const msg = extractErrorMessage(err, 'Could not add property.');
      Alert.alert('Error', msg);
    } finally {
      setCreatingProperty(false);
    }
  };

  // Auth Loading
  if (authLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.authLoadingContainer}>
          <ActivityIndicator size="large" color={OwnerTheme.colors.primary} />
          <Text style={styles.authNoticeText}>Initializing session...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const featuredMealKey = getFeaturedMealKey(todayMenus);
  const featuredMenu = todayMenus[featuredMealKey];
  const featuredMealTitle = MEAL_CONFIG[featuredMealKey].title;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      {/* Top Header: Brand + Global Property Switcher + Notification Bell + Account */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Text style={styles.brandTitle}>PGwala</Text>
        </View>

        {/* Global Property Switcher Pill */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Switch active property"
          style={({ pressed }) => [
            styles.propertySwitcherPill,
            pressed && styles.cardPressed,
          ]}
          onPress={() => setSwitcherVisible(true)}>
          <Building2
            size={14}
            color={OwnerTheme.colors.primary}
            style={styles.switcherIcon}
          />
          <Text style={styles.propertySwitcherText} numberOfLines={1}>
            {selectedProperty?.name || 'Select PG'}
          </Text>
          <ChevronDown
            size={14}
            color={OwnerTheme.colors.textSecondary}
            style={styles.switcherIcon}
          />
        </Pressable>

        {/* Notification Bell & Account Actions */}
        <View style={styles.headerActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Notification center"
            hitSlop={4}
            style={({ pressed }) => [styles.iconCircleBtn, pressed && styles.cardPressed]}
            onPress={() => router.push('/notification-center' as Href)}>
            <Bell size={18} color={OwnerTheme.colors.primary} />
            {unreadInboxCount > 0 && (
              <View style={styles.bellBadge}>
                <Text style={styles.bellBadgeText}>
                  {unreadInboxCount > 9 ? '9+' : String(unreadInboxCount)}
                </Text>
              </View>
            )}
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Account and Settings"
            hitSlop={4}
            style={({ pressed }) => [styles.iconCircleBtn, pressed && styles.cardPressed]}
            onPress={() => router.push('/owner-settings')}>
            <User size={18} color={OwnerTheme.colors.primary} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={[OwnerTheme.colors.primary]}
          />
        }>
        {errorMessage && (
          <ErrorState message={errorMessage} onRetry={loadDashboardData} />
        )}

        {loading && !dash ? (
          <DashboardSkeleton />
        ) : (
          <>
            {/* Priority Area 0 & 1: Needs Attention Strip + 4-Card Operational KPI Grid */}
            <OwnerMetricsGrid stats={stats} />

            {/* Priority Area 2: Compact Single-Row Food Menu Card */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Manage today's food menu"
              style={({ pressed }) => [styles.menuCompactCard, pressed && styles.cardPressed]}
              onPress={handleOpenFoodMenu}>
              <View style={styles.menuIconContainer}>
                <Utensils size={16} color={OwnerTheme.colors.primary} />
              </View>
              <Text style={styles.menuCompactSummary} numberOfLines={1}>
                <Text style={styles.menuCompactLabel}>{featuredMealTitle}: </Text>
                {featuredMenu ? featuredMenu.items : 'Not set'}
              </Text>
              {featuredMenu && (
                <View
                  style={[
                    styles.menuStatusPill,
                    featuredMenu.is_published
                      ? styles.menuStatusPillPublished
                      : styles.menuStatusPillDraft,
                  ]}>
                  <Text
                    style={[
                      styles.menuStatusPillText,
                      featuredMenu.is_published
                        ? styles.menuStatusTextPublished
                        : styles.menuStatusTextDraft,
                    ]}>
                    {toSentenceCaseStatus(featuredMenu.is_published ? 'published' : 'draft')}
                  </Text>
                </View>
              )}
              <Text style={styles.menuManageText}>Manage ›</Text>
            </Pressable>

            {/* Priority Area 3: Residents Insights & Announcements */}
            <OwnerQuickActions
              totalResidents={stats.totalResidents}
              studentsInside={stats.studentsInside}
              unpaidResidentsCount={stats.unpaidResidentsCount ?? 0}
              totalBeds={selectedProperty?.total_beds ?? 0}
              rentCollectedPaise={stats.rentCollectedPaise}
              rentTotalPaise={stats.rentTotalPaise}
            />

            {/* Priority Area 4: Recent Gate Movements */}
            <RecentActivitySection loading={loading} activities={recentActivities} />
          </>
        )}
      </ScrollView>

      <PropertySwitcherModal
        visible={switcherVisible}
        properties={properties}
        selectedPropertyId={selectedPropertyId}
        activePropertyResidentsCount={stats.totalResidents}
        onSelectProperty={selectProperty}
        onOpenAddProperty={() => setShowAddPropertyModal(true)}
        onClose={() => setSwitcherVisible(false)}
      />

      <AddPropertyModal
        visible={showAddPropertyModal}
        propName={newPropName}
        propAddress={newPropAddress}
        creating={creatingProperty}
        onChangeName={setNewPropName}
        onChangeAddress={setNewPropAddress}
        onCreate={handleCreateProperty}
        onClose={() => setShowAddPropertyModal(false)}
      />

      <RoleBottomNav activeTab="home" roleOverride="owner" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: OwnerTheme.colors.background,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 28,
    maxWidth: 960,
    width: '100%',
    alignSelf: 'center',
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: OwnerTheme.colors.border,
    gap: 8,
  },
  headerLeft: {
    justifyContent: 'center',
    flexShrink: 0,
  },
  brandTitle: {
    fontSize: 21,
    fontWeight: '800',
    color: OwnerTheme.colors.primary,
    letterSpacing: -0.5,
  },
  propertySwitcherPill: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: OwnerTheme.radius.full,
    backgroundColor: OwnerTheme.colors.background,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    maxWidth: 220,
  },
  switcherIcon: {
    flexShrink: 0,
  },
  propertySwitcherText: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
    flex: 1,
    minWidth: 0,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  iconCircleBtn: {
    width: 38,
    height: 38,
    borderRadius: OwnerTheme.radius.full,
    backgroundColor: OwnerTheme.colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  bellBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: '#DC2626',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bellBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFFFFF',
    lineHeight: 12,
    includeFontPadding: false,
  },
  wmCompactChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    paddingHorizontal: 12,
    paddingVertical: 11,
    gap: 8,
    ...OwnerTheme.shadow,
  },
  wmCompactLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  wmCompactIconBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#E0F2FE',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  wmCompactTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  wmSummaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 12,
    ...OwnerTheme.shadow,
  },
  wmSummaryLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  wmIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E0F2FE',
    justifyContent: 'center',
    alignItems: 'center',
  },
  wmSummaryTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  wmSummaryTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  wmActiveChip: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  wmActiveChipText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#DC2626',
  },
  wmOutOfOrderChip: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  wmOutOfOrderChipText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#B45309',
  },
  wmAllFreeChip: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  wmAllFreeChipText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#15803D',
  },
  wmSummarySub: {
    fontSize: 11,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 2,
  },
  wmSummaryRight: {
    paddingLeft: 8,
    flexShrink: 0,
  },
  wmViewUsageBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
    flexShrink: 0,
  },
  menuCompactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    paddingHorizontal: 12,
    paddingVertical: 11,
    gap: 8,
    ...OwnerTheme.shadow,
  },
  menuIconContainer: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: OwnerTheme.colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  menuCompactSummary: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '500',
    color: OwnerTheme.colors.textSecondary,
  },
  menuCompactLabel: {
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  menuStatusPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: OwnerTheme.radius.full,
    flexShrink: 0,
  },
  menuStatusPillPublished: {
    backgroundColor: '#DCFCE7',
  },
  menuStatusPillDraft: {
    backgroundColor: '#FEF3C7',
  },
  menuStatusPillText: {
    fontSize: 10,
    fontWeight: '700',
  },
  menuStatusTextPublished: {
    color: '#15803D',
  },
  menuStatusTextDraft: {
    color: '#B45309',
  },
  menuManageText: {
    fontSize: 12,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
    flexShrink: 0,
  },
  cardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  authLoadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  authNoticeText: {
    marginTop: 12,
    fontSize: 14,
    color: OwnerTheme.colors.textSecondary,
  },
});
