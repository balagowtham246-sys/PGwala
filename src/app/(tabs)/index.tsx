import { Href, router, useFocusEffect } from 'expo-router';
import {
  Bell,
  Building2,
  Check,
  ChevronDown,
  Clock,
  Disc3,
  Plus,
  User,
  Utensils,
  X,
} from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OwnerMetricsGrid } from '@/components/owner-dashboard/OwnerMetricsGrid';
import { OwnerQuickActions } from '@/components/owner-dashboard/OwnerQuickActions';
import { RecentActivitySection } from '@/components/owner-dashboard/RecentActivitySection';
import { RoleBottomNav } from '@/components/ui/bottom-nav';
import { ErrorState } from '@/components/ui/owner';
import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useProperty } from '@/context/property-context';
import { useResidentTabs } from '@/context/resident-tabs-context';
import { triggerSelectionHaptic } from '@/lib/haptics';
import { invalidatePrefix } from '@/lib/query-cache';
import { supabase } from '@/lib/supabase';
import {
  formatPropertyGenderLabel,
  inferPropertyGender,
  PropertyGenderType,
  toSentenceCaseStatus,
} from '@/lib/ux-utils';
import {
  createEmptyOwnerMenus,
  DashboardWmUnit,
  fetchOwnerDashboard,
  getCachedOwnerDashboard,
  MealType,
  OwnerActivityItem,
  OwnerDashboardStats,
  OwnerFoodMenuRecord,
  OwnerWmSummary,
  releaseWashingMachineUnit,
  setWashingMachineOutOfOrder,
  toLocalIsoDate,
} from '@/services/dashboard.service';
import { getUnreadInboxCount } from '@/services/notification-center.service';

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

function formatElapsed(startedAtIso: string | null): string {
  if (!startedAtIso) return '';
  try {
    const started = new Date(startedAtIso).getTime();
    if (Number.isNaN(started)) return '';
    const diff = Math.max(0, Math.floor((Date.now() - started) / 60000));
    if (diff < 1) return 'Just started';
    if (diff < 60) return `${diff} min${diff === 1 ? '' : 's'} ago`;
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    return `${h}h ${m}m ago`;
  } catch {
    return '';
  }
}

function formatCycleStartTime(startedAtIso: string | null): string {
  if (!startedAtIso) return '';
  try {
    const started = new Date(startedAtIso);
    if (Number.isNaN(started.getTime())) return '';
    const startTimeStr = started.toLocaleTimeString('en-IN', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    const elapsed = formatElapsed(startedAtIso);
    return elapsed ? `Started ${startTimeStr} · ${elapsed}` : `Started ${startTimeStr}`;
  } catch {
    return '';
  }
}

function getGenderPillStyle(gender: PropertyGenderType): {
  bg: string;
  text: string;
} {
  if (gender === 'girls') return { bg: '#FCE7F3', text: '#BE185D' };
  if (gender === 'boys') return { bg: '#E0F2FE', text: '#0369A1' };
  return { bg: '#EEF2FF', text: '#4338CA' };
}

export default function OwnerDashboard() {
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

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Property Switcher Modal State
  const [switcherVisible, setSwitcherVisible] = useState(false);
  const [showAddPropertyModal, setShowAddPropertyModal] = useState(false);
  const [newPropName, setNewPropName] = useState('');
  const [newPropAddress, setNewPropAddress] = useState('');
  const [creatingProperty, setCreatingProperty] = useState(false);

  // Key Operational State (Gate, Menu, Complaints, Rent Collections)
  const [stats, setStats] = useState<OwnerDashboardStats>({
    totalResidents: 0,
    studentsInside: 0,
    studentsOutside: 0,
    openComplaintsCount: 0,
    rentCollectedPaise: 0,
    rentTotalPaise: 0,
    pendingProofsCount: 0,
    unpaidResidentsCount: 0,
  });

  const [todayMenus, setTodayMenus] = useState<Record<MealType, OwnerFoodMenuRecord | null>>(() =>
    createEmptyOwnerMenus()
  );

  // Live Washing Machine Status State
  const [wmSummary, setWmSummary] = useState<OwnerWmSummary>({
    totalCount: 0,
    inUseCount: 0,
    freeCount: 0,
    outOfOrderCount: 0,
  });
  const [wmUnits, setWmUnits] = useState<DashboardWmUnit[]>([]);
  const [wmModalVisible, setWmModalVisible] = useState(false);
  const [busyMachineId, setBusyMachineId] = useState<string | null>(null);

  const [recentActivities, setRecentActivities] = useState<OwnerActivityItem[]>([]);
  const [unreadInboxCount, setUnreadInboxCount] = useState(0);

  const hasFocusedOnceRef = useRef(false);

  // Instant render from unified query cache (stale-while-revalidate for slow networks)
  useEffect(() => {
    if (!selectedPropertyId) return;
    let cancelled = false;
    void getCachedOwnerDashboard(selectedPropertyId).then((cached) => {
      if (cancelled || !cached) return;
      setStats(cached.stats);
      setRecentActivities(cached.recentActivities);
      setTodayMenus(cached.todayMenus);
      setWmSummary(cached.wmSummary);
      setWmUnits(cached.wmUnits);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedPropertyId]);

  // Fetch operational dashboard data scoped to the active selected property
  const applyDashboardResult = useCallback(
    (result: Awaited<ReturnType<typeof fetchOwnerDashboard>>) => {
      if (result.ok) {
        setErrorMessage(null);
        setStats(result.data.stats);
        setRecentActivities(result.data.recentActivities);
        setTodayMenus(result.data.todayMenus);
        setWmSummary(result.data.wmSummary);
        setWmUnits(result.data.wmUnits);
      } else {
        console.error('[OwnerDashboard] Error loading data:', result.error);
        setErrorMessage(`Failed to load dashboard: ${result.error.message}`);
      }
      setLoading(false);
      setRefreshing(false);
    },
    []
  );

  const loadDashboardData = useCallback(async () => {
    if (!userId || profileRole !== 'owner' || !selectedPropertyId) {
      return;
    }

    const todayIsoDate = toLocalIsoDate();
    const currentMonthStartIso = `${todayIsoDate.slice(0, 7)}-01`;

    const result = await fetchOwnerDashboard(selectedPropertyId, {
      dateIso: todayIsoDate,
      monthStartIso: currentMonthStartIso,
    });
    applyDashboardResult(result);
  }, [userId, profileRole, selectedPropertyId, applyDashboardResult]);

  useEffect(() => {
    if (authLoading) return;
    if (!session || !userId) {
      router.replace('/login');
      return;
    }
    if (profileRole === 'owner' && selectedPropertyId) {
      let cancelled = false;
      const todayIsoDate = toLocalIsoDate();
      const currentMonthStartIso = `${todayIsoDate.slice(0, 7)}-01`;
      void fetchOwnerDashboard(selectedPropertyId, {
        dateIso: todayIsoDate,
        monthStartIso: currentMonthStartIso,
      }).then((result) => {
        if (!cancelled) {
          applyDashboardResult(result);
        }
      });
      return () => {
        cancelled = true;
      };
    }
    const timer = setTimeout(() => {
      setLoading(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [authLoading, session, userId, profileRole, selectedPropertyId, applyDashboardResult]);

  const refreshUnreadInboxCount = useCallback(
    async (forceInvalidate = false) => {
      if (!userId || profileRole !== 'owner' || !selectedPropertyId) {
        setUnreadInboxCount(0);
        return;
      }
      if (forceInvalidate) {
        await invalidatePrefix('inbox:');
      }
      const count = await getUnreadInboxCount(userId, selectedPropertyId);
      setUnreadInboxCount(count);
    },
    [userId, profileRole, selectedPropertyId]
  );

  useEffect(() => {
    if (!userId || profileRole !== 'owner' || !selectedPropertyId) {
      const timer = setTimeout(() => {
        setUnreadInboxCount(0);
      }, 0);
      return () => clearTimeout(timer);
    }
    let cancelled = false;
    void getUnreadInboxCount(userId, selectedPropertyId).then((count) => {
      if (!cancelled) {
        setUnreadInboxCount(count);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [userId, profileRole, selectedPropertyId]);

  // Refetch latest operational status, menu, and unread notifications whenever returning to dashboard
  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedOnceRef.current) {
        hasFocusedOnceRef.current = true;
        return;
      }
      if (!authLoading && userId && profileRole === 'owner' && selectedPropertyId) {
        void loadDashboardData();
        void refreshUnreadInboxCount(true);
      }
    }, [
      authLoading,
      userId,
      profileRole,
      selectedPropertyId,
      loadDashboardData,
      refreshUnreadInboxCount,
    ])
  );

  const handleOpenFoodMenu = () => {
    if (isInsidePager) {
      navigateToTab('menu');
    } else {
      router.push('/food-menu');
    }
  };

  const handleOwnerReleaseWm = (machineId: string, machineName: string) => {
    if (!selectedPropertyId) return;
    Alert.alert(
      'Free Up Machine',
      `Are you sure you want to free up ${machineName}? This will end the current resident's session.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Free Up',
          style: 'destructive',
          onPress: async () => {
            setBusyMachineId(machineId);
            const result = await releaseWashingMachineUnit(selectedPropertyId, machineId);
            setBusyMachineId(null);
            if (!result.ok) {
              Alert.alert(
                'Error',
                result.error.message || 'Failed to release washing machine.'
              );
              return;
            }
            await loadDashboardData();
          },
        },
      ]
    );
  };

  const handleOwnerSetOutOfOrder = (
    machineId: string,
    machineName: string,
    outOfOrder: boolean,
    isInUse: boolean
  ) => {
    if (!selectedPropertyId) return;

    const applyChange = async () => {
      setBusyMachineId(machineId);
      const result = await setWashingMachineOutOfOrder(
        selectedPropertyId,
        machineId,
        outOfOrder
      );
      setBusyMachineId(null);
      if (!result.ok) {
        Alert.alert(
          'Error',
          result.error.message || 'Failed to update washing machine status.'
        );
        return;
      }
      await loadDashboardData();
    };

    if (outOfOrder) {
      Alert.alert(
        'Mark Out of Order',
        `Mark ${machineName} as out of order?${isInUse ? " This will end the current resident's session." : ''}`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Mark Out of Order',
            style: 'destructive',
            onPress: applyChange,
          },
        ]
      );
      return;
    }

    void applyChange();
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
        void (async () => {
          await invalidatePrefix('inbox:');
          if (!active) return;
          await Promise.all([loadDashboardData(), refreshUnreadInboxCount()]);
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
    loadDashboardData,
    refreshUnreadInboxCount,
  ]);

  const handleRefresh = () => {
    setRefreshing(true);
    void loadDashboardData();
    void refreshUnreadInboxCount(true);
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
      Alert.alert('Property Added', `Switched to "${trimmed}".`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not add property.';
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

  const outOfOrderCount =
    wmSummary.outOfOrderCount ??
    wmUnits.filter((u) => u.status === 'out_of_order').length;
  const hasWmAttention = wmSummary.inUseCount > 0 || outOfOrderCount > 0;
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

        {/* Priority Area 0 & 1: Needs Attention Strip + 4-Card Operational KPI Grid */}
        <OwnerMetricsGrid stats={stats} />

        {/* Priority Area 1b: Washing Machines */}
        {hasWmAttention ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View washing machine usage"
            style={({ pressed }) => [
              styles.wmSummaryCard,
              pressed && styles.cardPressed,
            ]}
            onPress={() => setWmModalVisible(true)}>
            <View style={styles.wmSummaryLeft}>
              <View style={styles.wmIconBadge}>
                <Disc3 size={18} color="#0284C7" />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={styles.wmSummaryTitleRow}>
                  <Text style={styles.wmSummaryTitle}>Washing Machines</Text>
                  {wmSummary.inUseCount > 0 && (
                    <View style={styles.wmActiveChip}>
                      <Text style={styles.wmActiveChipText}>
                        {wmSummary.inUseCount === 1
                          ? toSentenceCaseStatus('in_use')
                          : `${wmSummary.inUseCount} in use`}
                      </Text>
                    </View>
                  )}
                  {outOfOrderCount > 0 && (
                    <View style={styles.wmOutOfOrderChip}>
                      <Text style={styles.wmOutOfOrderChipText}>
                        {outOfOrderCount === 1
                          ? toSentenceCaseStatus('out_of_order')
                          : `${outOfOrderCount} out of order`}
                      </Text>
                    </View>
                  )}
                </View>
                <Text style={styles.wmSummarySub}>
                  {outOfOrderCount > 0
                    ? `${wmSummary.inUseCount} active · ${wmSummary.freeCount} free · ${outOfOrderCount} out of order`
                    : `${wmSummary.inUseCount} active · ${wmSummary.freeCount} available of ${wmSummary.totalCount} units`}
                </Text>
              </View>
            </View>
            <View style={styles.wmSummaryRight}>
              <Text style={styles.wmViewUsageBtnText}>View Usage ›</Text>
            </View>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Washing machines all free"
            style={({ pressed }) => [
              styles.wmCompactChipRow,
              pressed && styles.cardPressed,
            ]}
            onPress={() => setWmModalVisible(true)}>
            <View style={styles.wmCompactLeft}>
              <View style={styles.wmCompactIconBadge}>
                <Disc3 size={16} color="#0284C7" />
              </View>
              <Text style={styles.wmCompactTitle}>Washing Machines</Text>
              <View style={styles.wmAllFreeChip}>
                <Text style={styles.wmAllFreeChipText}>
                  {wmSummary.totalCount > 0
                    ? `${toSentenceCaseStatus('free')} (${wmSummary.totalCount})`
                    : toSentenceCaseStatus('free')}
                </Text>
              </View>
            </View>
            <Text style={styles.wmViewUsageBtnText}>Details ›</Text>
          </Pressable>
        )}

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
      </ScrollView>

      {/* Global Property Switcher Modal */}
      <Modal
        visible={switcherVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSwitcherVisible(false)}>
        <View style={styles.modalOverlay}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close switch property modal"
            style={StyleSheet.absoluteFill}
            onPress={() => setSwitcherVisible(false)}
          />
          <View style={styles.switcherModalCard}>
            <View style={styles.switcherModalHeader}>
              <Text style={styles.switcherModalTitle}>Switch PG Property</Text>
              <Pressable hitSlop={8} onPress={() => setSwitcherVisible(false)}>
                <X size={20} color={OwnerTheme.colors.textSecondary} />
              </Pressable>
            </View>
            <Text style={styles.switcherModalSub}>
              Select which accommodation to view and manage:
            </Text>

            <ScrollView style={{ maxHeight: 260 }}>
              {properties.map((prop) => {
                const isSelected = prop.id === selectedPropertyId;
                const occupied =
                  typeof prop.active_resident_count === 'number'
                    ? prop.active_resident_count
                    : isSelected
                      ? stats.totalResidents
                      : 0;
                const totalBeds =
                  typeof prop.total_beds === 'number' ? prop.total_beds : 0;
                const occupancyText =
                  totalBeds > 0
                    ? `${occupied}/${totalBeds} beds`
                    : `${occupied} residents`;
                const genderType = inferPropertyGender(
                  prop.name,
                  prop.gender_type ?? null
                );
                const genderLabel = formatPropertyGenderLabel(genderType);
                const genderStyle = getGenderPillStyle(genderType);

                return (
                  <Pressable
                    key={prop.id}
                    style={[
                      styles.propertyItemRow,
                      isSelected && styles.propertyItemRowSelected,
                    ]}
                    onPress={async () => {
                      triggerSelectionHaptic();
                      await selectProperty(prop.id);
                      setSwitcherVisible(false);
                    }}>
                    <Building2
                      size={18}
                      color={
                        isSelected
                          ? OwnerTheme.colors.primary
                          : OwnerTheme.colors.textSecondary
                      }
                      style={{ marginRight: 10 }}
                    />
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.propertyNameItem,
                          isSelected && styles.propertyNameItemSelected,
                        ]}>
                        {prop.name}
                      </Text>
                      <View style={styles.propertyMetaRow}>
                        <Text style={styles.propertyOccupancyText}>{occupancyText}</Text>
                        <View
                          style={[
                            styles.propertyGenderPill,
                            { backgroundColor: genderStyle.bg },
                          ]}>
                          <Text
                            style={[
                              styles.propertyGenderText,
                              { color: genderStyle.text },
                            ]}>
                            {genderLabel}
                          </Text>
                        </View>
                      </View>
                    </View>
                    {isSelected && (
                      <Check size={18} color={OwnerTheme.colors.primary} />
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>

            <Pressable
              style={styles.addPropertyBtn}
              onPress={() => setShowAddPropertyModal(true)}>
              <Plus size={16} color={OwnerTheme.colors.primary} />
              <Text style={styles.addPropertyBtnText}>Add Another PG Property</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Add New Property Sub-Modal */}
      <Modal
        visible={showAddPropertyModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAddPropertyModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.switcherModalCard}>
            <View style={styles.switcherModalHeader}>
              <Text style={styles.switcherModalTitle}>Add New PG Property</Text>
              <Pressable
                hitSlop={8}
                onPress={() => setShowAddPropertyModal(false)}>
                <X size={20} color={OwnerTheme.colors.textSecondary} />
              </Pressable>
            </View>

            <Text style={styles.inputLabel}>PG Name *</Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g. Shalom Girls PG"
              placeholderTextColor={OwnerTheme.colors.textMuted}
              value={newPropName}
              onChangeText={setNewPropName}
            />

            <Text style={styles.inputLabel}>Address (Optional)</Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g. Street 4, College Road"
              placeholderTextColor={OwnerTheme.colors.textMuted}
              value={newPropAddress}
              onChangeText={setNewPropAddress}
            />

            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalCancelBtn}
                onPress={() => setShowAddPropertyModal(false)}>
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.modalConfirmBtn,
                  creatingProperty && { opacity: 0.6 },
                ]}
                disabled={creatingProperty}
                onPress={handleCreateProperty}>
                {creatingProperty ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalConfirmBtnText}>Create PG</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Washing Machine Live Usage Popup Modal */}
      <Modal
        visible={wmModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setWmModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close washing machine modal"
            style={StyleSheet.absoluteFill}
            onPress={() => setWmModalVisible(false)}
          />
          <View style={styles.wmModalContent}>
            <View style={styles.wmModalHeader}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Disc3 size={18} color="#0284C7" />
                  <Text style={styles.wmModalTitle}>Washing Machine Units</Text>
                </View>
                <Text style={styles.wmModalSubtitle} numberOfLines={1}>
                  {selectedProperty?.name || 'Live Usage'} • {wmSummary.inUseCount} in use,{' '}
                  {wmSummary.freeCount} free
                  {outOfOrderCount > 0 ? `, ${outOfOrderCount} out of order` : ''}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close modal"
                hitSlop={8}
                onPress={() => setWmModalVisible(false)}>
                <X size={20} color={OwnerTheme.colors.textMuted} />
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
              {wmUnits.length === 0 ? (
                <View style={styles.wmModalEmpty}>
                  <Text style={styles.wmModalEmptyText}>
                    No active washing machines configured.
                  </Text>
                  <Pressable
                    style={styles.configureWmBtn}
                    onPress={() => {
                      setWmModalVisible(false);
                      router.push('/owner-settings');
                    }}>
                    <Text style={styles.configureWmBtnText}>Configure in Settings ›</Text>
                  </Pressable>
                </View>
              ) : (
                wmUnits.map((unit, idx) => {
                  const isInUse = unit.status === 'in_use';
                  const isOutOfOrder = unit.status === 'out_of_order';
                  const isBusy = busyMachineId === unit.id;
                  const statusLabel = toSentenceCaseStatus(unit.status);
                  const badgeStyle = isInUse
                    ? styles.wmStatusInUse
                    : isOutOfOrder
                      ? styles.wmStatusOutOfOrder
                      : styles.wmStatusFree;
                  const dotColor = isInUse
                    ? '#DC2626'
                    : isOutOfOrder
                      ? '#D97706'
                      : '#16A34A';
                  const textColor = isInUse
                    ? '#B91C1C'
                    : isOutOfOrder
                      ? '#B45309'
                      : '#15803D';
                  const cycleStartText = isInUse
                    ? formatCycleStartTime(unit.started_at)
                    : '';

                  return (
                    <View
                      key={unit.id}
                      style={[
                        styles.wmUnitRow,
                        idx === wmUnits.length - 1 && { borderBottomWidth: 0 },
                      ]}>
                      <View style={styles.wmUnitTopRow}>
                        <Text style={styles.wmUnitName}>{unit.machine_name}</Text>
                        <View style={[styles.wmStatusBadge, badgeStyle]}>
                          <View
                            style={[styles.wmStatusDot, { backgroundColor: dotColor }]}
                          />
                          <Text style={[styles.wmStatusText, { color: textColor }]}>
                            {statusLabel}
                          </Text>
                        </View>
                      </View>

                      {isInUse && (
                        <View style={styles.wmInUseDetails}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                            <User size={12} color="#1E293B" />
                            <Text style={styles.wmOccupantText}>
                              {unit.current_resident_name || 'Resident'}
                              {unit.current_resident_room
                                ? ` (Room ${unit.current_resident_room})`
                                : ''}
                            </Text>
                          </View>
                          {cycleStartText ? (
                            <View
                              style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: 4,
                                marginTop: 2,
                              }}>
                              <Clock size={12} color="#64748B" />
                              <Text style={styles.wmDurationText}>{cycleStartText}</Text>
                            </View>
                          ) : null}
                        </View>
                      )}

                      <View style={styles.wmUnitActionsRow}>
                        {isInUse && (
                          <Pressable
                            accessibilityRole="button"
                            style={[
                              styles.forceFreeBtn,
                              isBusy && styles.forceFreeBtnDisabled,
                            ]}
                            disabled={isBusy}
                            onPress={() => handleOwnerReleaseWm(unit.id, unit.machine_name)}>
                            {isBusy ? (
                              <ActivityIndicator size="small" color="#DC2626" />
                            ) : (
                              <Text style={styles.forceFreeBtnText}>Free up</Text>
                            )}
                          </Pressable>
                        )}

                        {isOutOfOrder ? (
                          <Pressable
                            accessibilityRole="button"
                            style={[
                              styles.markAvailableBtn,
                              isBusy && styles.forceFreeBtnDisabled,
                            ]}
                            disabled={isBusy}
                            onPress={() =>
                              handleOwnerSetOutOfOrder(
                                unit.id,
                                unit.machine_name,
                                false,
                                false
                              )
                            }>
                            {isBusy ? (
                              <ActivityIndicator size="small" color="#15803D" />
                            ) : (
                              <Text style={styles.markAvailableBtnText}>
                                Mark available
                              </Text>
                            )}
                          </Pressable>
                        ) : (
                          <Pressable
                            accessibilityRole="button"
                            style={[
                              styles.markOutOfOrderBtn,
                              isBusy && styles.forceFreeBtnDisabled,
                            ]}
                            disabled={isBusy}
                            onPress={() =>
                              handleOwnerSetOutOfOrder(
                                unit.id,
                                unit.machine_name,
                                true,
                                isInUse
                              )
                            }>
                            <Text style={styles.markOutOfOrderBtnText}>
                              Mark out of order
                            </Text>
                          </Pressable>
                        )}
                      </View>
                    </View>
                  );
                })
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

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
  wmModalContent: {
    width: '90%',
    maxWidth: 480,
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    padding: 18,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  wmModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: OwnerTheme.colors.borderLight,
    marginBottom: 10,
  },
  wmModalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  wmModalSubtitle: {
    fontSize: 11,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 2,
  },
  wmModalEmpty: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  wmModalEmptyText: {
    fontSize: 13,
    color: OwnerTheme.colors.textMuted,
  },
  configureWmBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: OwnerTheme.radius.full,
    backgroundColor: OwnerTheme.colors.primaryLight,
  },
  configureWmBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  wmUnitRow: {
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  wmUnitTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  wmUnitName: {
    fontSize: 14,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
    flex: 1,
  },
  wmStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
  },
  wmStatusInUse: {
    backgroundColor: '#FEE2E2',
  },
  wmStatusOutOfOrder: {
    backgroundColor: '#FEF3C7',
  },
  wmStatusFree: {
    backgroundColor: '#DCFCE7',
  },
  wmStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  wmStatusText: {
    fontSize: 10,
    fontWeight: '700',
  },
  wmInUseDetails: {
    marginTop: 5,
  },
  wmOccupantText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  wmDurationText: {
    fontSize: 11,
    color: '#64748B',
  },
  wmUnitActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  forceFreeBtn: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  forceFreeBtnDisabled: {
    opacity: 0.6,
  },
  forceFreeBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#DC2626',
  },
  markOutOfOrderBtn: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  markOutOfOrderBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#B45309',
  },
  markAvailableBtn: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#86EFAC',
  },
  markAvailableBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#15803D',
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  switcherModalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    padding: 20,
    ...OwnerTheme.shadow,
  },
  switcherModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  switcherModalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  switcherModalSub: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
    marginBottom: 14,
  },
  propertyItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: OwnerTheme.radius.sm,
    marginBottom: 6,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: OwnerTheme.colors.borderLight,
  },
  propertyItemRowSelected: {
    backgroundColor: OwnerTheme.colors.primaryLight,
    borderColor: OwnerTheme.colors.primary,
  },
  propertyNameItem: {
    fontSize: 14,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  propertyNameItemSelected: {
    color: OwnerTheme.colors.primary,
  },
  propertyMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 3,
  },
  propertyOccupancyText: {
    fontSize: 11,
    fontWeight: '500',
    color: OwnerTheme.colors.textSecondary,
  },
  propertyGenderPill: {
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: OwnerTheme.radius.full,
  },
  propertyGenderText: {
    fontSize: 10,
    fontWeight: '700',
  },
  addPropertyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: OwnerTheme.radius.md,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.primary,
    borderStyle: 'dashed',
  },
  addPropertyBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.primary,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
    marginBottom: 4,
    marginTop: 8,
  },
  textInput: {
    height: 46,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    borderRadius: OwnerTheme.radius.md,
    paddingHorizontal: 12,
    fontSize: 14,
    color: OwnerTheme.colors.textPrimary,
    backgroundColor: '#F8FAFC',
    marginBottom: 8,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 12,
  },
  modalCancelBtn: {
    height: 40,
    paddingHorizontal: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCancelBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  modalConfirmBtn: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: OwnerTheme.radius.md,
    backgroundColor: OwnerTheme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalConfirmBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
