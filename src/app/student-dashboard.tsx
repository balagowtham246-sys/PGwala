import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { router, useFocusEffect } from 'expo-router';
import { AlertCircle, ChevronRight, ClipboardList } from 'lucide-react-native';

import { BottomTabInset, OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { triggerLightHaptic, triggerSuccessHaptic } from '@/lib/haptics';
import { flushOfflineQueue, getPendingCount } from '@/lib/offline-queue';
import { invalidatePrefix } from '@/lib/query-cache';
import { getFirstName, getNextUpcomingMeal } from '@/lib/resident-home-utils';
import { defaultOfflineExecutors } from '@/services/offline-executors';
import {
  createEmptyResidentMenus,
  fetchStudentDashboard,
  getCachedStudentDashboard,
  MealType,
  recordStudentMovement,
  ResidentAccommodationInfo,
  ResidentFoodMenu,
  ResidentMovementRecord,
  studentDashboardCacheKey,
} from '@/services/dashboard.service';
import { WashingMachineCard } from '@/components/washing-machine-card';
import { RoleBottomNav } from '@/components/ui/bottom-nav';
import { FoodStatusBanner } from '@/components/food-status-banner';
import { GoingOutModal, GoingOutSubmitPayload } from '@/components/going-out-modal';
import { ResidentStatusHeader } from '@/components/student-dashboard/ResidentStatusHeader';
import { ResidentQuickTiles } from '@/components/student-dashboard/ResidentQuickTiles';
import { TodaysMenuPreview } from '@/components/student-dashboard/TodaysMenuPreview';

export type { MealType, ResidentFoodMenu, ResidentMovementRecord };

export default function ResidentDashboardScreen() {
  const { user, profile, refreshProfile } = useAuth();
  const userId = user?.id;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [foodRefreshKey, setFoodRefreshKey] = useState(0);
  const [resident, setResident] = useState<ResidentAccommodationInfo | null>(null);

  // Active Meal Tab for in-place detail view (defaults to next upcoming meal)
  const [activeMealTab, setActiveMealTab] = useState<MealType>(() => getNextUpcomingMeal());
  const [hasUnreadChat, setHasUnreadChat] = useState(false);
  const [menus, setMenus] = useState<Record<MealType, ResidentFoodMenu | null>>(() =>
    createEmptyResidentMenus()
  );

  // Billing dues indicator
  const [pendingDuesPaise, setPendingDuesPaise] = useState<number | null>(null);

  // Movement & Gate Status
  const [latestMovement, setLatestMovement] = useState<ResidentMovementRecord | null>(null);
  const [goingOutModalVisible, setGoingOutModalVisible] = useState(false);
  const [savingMovement, setSavingMovement] = useState(false);
  const [pendingOfflineCount, setPendingOfflineCount] = useState(0);

  // Feedback State
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const hasMountedRef = useRef(false);
  const [undoToast, setUndoToast] = useState<{
    message: string;
    undoDirection: 'IN' | 'OUT';
  } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  const showUndoToast = (message: string, undoDirection: 'IN' | 'OUT') => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoToast({ message, undoDirection });
    undoTimerRef.current = setTimeout(() => {
      setUndoToast(null);
    }, 8000);
  };

  const applyStudentDashboardResult = useCallback(
    (result: Awaited<ReturnType<typeof fetchStudentDashboard>>) => {
      if (result.ok) {
        setErrorMessage(null);
        setResident(result.data.resident);
        setMenus(result.data.menus);
        setPendingDuesPaise(result.data.pendingDuesPaise);
        setLatestMovement(result.data.latestMovement);
        setHasUnreadChat(result.data.hasUnreadChat);
        setActiveMealTab(getNextUpcomingMeal());
      } else {
        console.error('[ResidentDashboard] Error loading resident data:', result.error);
        setErrorMessage(`Failed to load resident data: ${result.error.message}`);
      }
      setLoading(false);
      setRefreshing(false);
    },
    []
  );

  const loadResidentData = useCallback(async () => {
    if (!userId) return;
    const result = await fetchStudentDashboard(userId);
    applyStudentDashboardResult(result);
  }, [userId, applyStudentDashboardResult]);

  const flushOfflineAndSync = useCallback(async () => {
    const summary = await flushOfflineQueue(defaultOfflineExecutors);
    setPendingOfflineCount(summary.remainingCount);
    if (summary.succeeded > 0) {
      if (userId) {
        await invalidatePrefix(studentDashboardCacheKey(userId));
      }
      await loadResidentData();
    }
  }, [userId, loadResidentData]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void fetchStudentDashboard(userId).then((result) => {
      if (!cancelled) {
        applyStudentDashboardResult(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [userId, applyStudentDashboardResult]);

  // Instant 0ms cache restore on slow connections
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void getCachedStudentDashboard(userId).then((cached) => {
      if (cancelled || !cached) return;
      if (cached.resident) setResident(cached.resident);
      setMenus(cached.menus);
      setPendingDuesPaise(cached.pendingDuesPaise);
      setLatestMovement(cached.latestMovement);
      setHasUnreadChat(cached.hasUnreadChat);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Flush offline gate mutations when app returns to foreground
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void flushOfflineAndSync();
      }
    });
    return () => {
      subscription.remove();
    };
  }, [flushOfflineAndSync]);

  // Refresh profile & flush offline queue when returning to dashboard
  useFocusEffect(
    useCallback(() => {
      void flushOfflineAndSync();
      if (!hasMountedRef.current) {
        hasMountedRef.current = true;
        return;
      }
      void refreshProfile();
    }, [flushOfflineAndSync, refreshProfile])
  );

  const handleRefresh = () => {
    setRefreshing(true);
    setFoodRefreshKey((k) => k + 1);
    void refreshProfile();
    void (async () => {
      await flushOfflineQueue(defaultOfflineExecutors);
      const count = await getPendingCount();
      setPendingOfflineCount(count);
      await loadResidentData();
    })();
  };

  // 1-tap Check-In when back at PG
  const handleMarkBackIn = async () => {
    if (savingMovement) return;
    setSavingMovement(true);

    try {
      const result = await recordStudentMovement({
        direction: 'IN',
        userId,
      });

      if (!result.ok) {
        Alert.alert('Update Failed', result.error.message || 'Could not record check-in.');
        return;
      }

      triggerSuccessHaptic();
      if (result.data.queued) {
        setLatestMovement({
          id: 'offline-queued',
          direction: 'IN',
          event_time: new Date().toISOString(),
          purpose: null,
          expected_return_time: null,
          food_required: true,
          note: null,
        });
        setPendingOfflineCount(await getPendingCount());
        Alert.alert(
          'Queued Offline',
          'You appear to be offline. Your check-in has been saved and will sync automatically when you are back online.'
        );
        return;
      }

      showUndoToast('Marked Inside PG', 'OUT');
      await loadResidentData();
    } finally {
      setSavingMovement(false);
    }
  };

  // Confirm Going Out with Purpose, Return Time & Food Requirement
  const handleConfirmGoingOut = async (payload: GoingOutSubmitPayload) => {
    if (savingMovement) return;
    setSavingMovement(true);

    try {
      const result = await recordStudentMovement({
        direction: 'OUT',
        purpose: payload.purpose,
        expectedReturnTime: payload.expectedReturnTime || undefined,
        foodRequired: payload.foodRequired,
        userId,
      });

      if (!result.ok) {
        Alert.alert('Update Failed', result.error.message || 'Could not record departure.');
        return;
      }

      setGoingOutModalVisible(false);
      triggerSuccessHaptic();

      if (result.data.queued) {
        setLatestMovement({
          id: 'offline-queued',
          direction: 'OUT',
          event_time: new Date().toISOString(),
          purpose: payload.purpose,
          expected_return_time: payload.expectedReturnTime || null,
          food_required: payload.foodRequired,
          note: null,
        });
        setPendingOfflineCount(await getPendingCount());
        Alert.alert(
          'Queued Offline',
          'You appear to be offline. Your departure has been saved and will sync automatically when you are back online.'
        );
        return;
      }

      showUndoToast('Marked Outside PG', 'IN');
      await loadResidentData();
    } finally {
      setSavingMovement(false);
    }
  };

  const handleUndoMovement = async () => {
    if (!undoToast || savingMovement) return;
    const targetDir = undoToast.undoDirection;
    setUndoToast(null);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    triggerLightHaptic();
    setSavingMovement(true);
    try {
      const result = await recordStudentMovement({
        direction: targetDir,
        note: 'Undo previous gate tap',
        userId,
      });
      if (!result.ok) {
        Alert.alert('Undo Failed', result.error.message || 'Could not undo last gate action.');
        return;
      }
      if (result.data.queued) {
        setLatestMovement({
          id: 'offline-queued',
          direction: targetDir,
          event_time: new Date().toISOString(),
          purpose: null,
          expected_return_time: null,
          food_required: true,
          note: 'Undo previous gate tap',
        });
        setPendingOfflineCount(await getPendingCount());
        Alert.alert(
          'Queued Offline',
          'You appear to be offline. Your gate update has been saved and will sync automatically when you are back online.'
        );
        return;
      }
      await loadResidentData();
    } finally {
      setSavingMovement(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      {/* Top Header: Brand + Chat Icon (with Unread Dot) + Settings Cog */}
      <ResidentStatusHeader
        showChat={Boolean(resident)}
        hasUnreadChat={hasUnreadChat}
        onPressChat={() => {
          setHasUnreadChat(false);
          router.push('/student-chat');
        }}
        onPressSettings={() => router.push('/student-settings')}
      />

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
        {/* First-Login Profile / Password Alert Banner */}
        {(() => {
          const needsPasswordChange = Boolean(
            profile?.must_change_password ||
              user?.user_metadata?.must_change_password ||
              user?.user_metadata?.is_temporary_password
          );
          const needsPhone = Boolean(
            resident && !resident.phone_number?.trim() && !profile?.phone_number?.trim()
          );
          if (!needsPasswordChange && !needsPhone) return null;
          return (
            <Pressable
              style={({ pressed }) => [
                styles.tempPasswordBanner,
                pressed && { opacity: 0.8 },
              ]}
              onPress={() => router.push('/student-profile-edit')}>
              <AlertCircle size={18} color="#92400E" />
              <View style={{ flex: 1 }}>
                <Text style={styles.tempPasswordTitle}>
                  {needsPhone && needsPasswordChange
                    ? 'Complete Your Profile'
                    : needsPhone
                    ? 'Add Your Phone Number'
                    : 'Temporary Password Active'}
                </Text>
                <Text style={styles.tempPasswordSubtitle}>
                  {needsPhone && needsPasswordChange
                    ? 'Tap here to add your phone number and set a private password.'
                    : needsPhone
                    ? 'Tap here to save your contact phone number for your PG owner.'
                    : 'Tap here to set your private password and secure your resident account.'}
                </Text>
              </View>
              <ChevronRight size={16} color="#92400E" />
            </Pressable>
          );
        })()}

        {/* Error Banner */}
        {errorMessage && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{errorMessage}</Text>
            <Pressable hitSlop={8} onPress={() => void loadResidentData()}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        )}

        {pendingOfflineCount > 0 && (
          <View style={styles.offlineQueueBanner}>
            <Text style={styles.offlineQueueText}>
              {pendingOfflineCount} offline update{pendingOfflineCount > 1 ? 's' : ''} queued — will sync automatically when connected
            </Text>
          </View>
        )}

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color={OwnerTheme.colors.primary} />
            <Text style={styles.loadingText}>Loading accommodation details...</Text>
          </View>
        ) : resident ? (
          <>
            {/* Simple Greeting */}
            <View style={styles.greetingSimpleRow}>
              <Text style={styles.greetingSimpleText} numberOfLines={1}>
                Hi, {getFirstName(resident.full_name)}
              </Text>
              <View style={styles.roomPill}>
                <Text style={styles.roomPillText}>Room {resident.room_number}</Text>
              </View>
            </View>

            {/* Food Alerts: today's latest status per meal (delayed / cancelled highlighted) */}
            <FoodStatusBanner refreshKey={foodRefreshKey} />

            {/* Lead Hero Card + Washing Machine & Gate Attendance 1x2 Hero */}
            <ResidentQuickTiles
              pendingDuesPaise={pendingDuesPaise}
              menus={menus}
              latestMovement={latestMovement}
              savingMovement={savingMovement}
              washingMachineSlot={
                <WashingMachineCard
                  propertyId={resident.property_id}
                  userRole="student"
                  currentResidentId={resident.id}
                  compact
                  style={{ flex: 1 }}
                />
              }
              onPressRentDue={() => router.push('/student-billing')}
              onPressUpNextMeal={() => router.push('/student-menu')}
              onOpenGoingOut={() => setGoingOutModalVisible(true)}
              onMarkBackIn={handleMarkBackIn}
            />

            {/* Section 3: Today's Food Menu (Interactive In-Place Card) */}
            <TodaysMenuPreview
              menus={menus}
              activeMealTab={activeMealTab}
              onSelectMealTab={setActiveMealTab}
              onPressFullMenu={() => router.push('/student-menu')}
            />
          </>
        ) : (
          /* Unlinked Account State */
          <View style={styles.unlinkedCard}>
            <ClipboardList size={32} color={OwnerTheme.colors.primary} />
            <Text style={styles.unlinkedTitle}>Awaiting Room Allocation</Text>
            <Text style={styles.unlinkedBody}>
              Your account is signed in, but has not yet been linked to a room allocation by your PG owner.
            </Text>
            <View style={styles.accountBox}>
              <Text style={styles.accountBoxLabel}>Signed in as:</Text>
              <Text style={styles.accountBoxValue}>{user?.email || profile?.full_name}</Text>
            </View>
            <Text style={styles.unlinkedHint}>
              Please contact your PG administrator to assign your room. Pull down to refresh once completed.
            </Text>
          </View>
        )}

        <View style={{ height: BottomTabInset + 20 }} />
      </ScrollView>

      {/* Modal: Mark Going Out */}
      <GoingOutModal
        visible={goingOutModalVisible}
        saving={savingMovement}
        onClose={() => setGoingOutModalVisible(false)}
        onConfirm={handleConfirmGoingOut}
      />

      {undoToast && (
        <View style={styles.undoToast}>
          <Text style={styles.undoToastText}>{undoToast.message}</Text>
          <Pressable hitSlop={8} onPress={handleUndoMovement}>
            <Text style={styles.undoToastAction}>UNDO</Text>
          </Pressable>
        </View>
      )}

      <RoleBottomNav activeTab="home" roleOverride="student" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: OwnerTheme.colors.background,
  },
  greetingSimpleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 2,
  },
  greetingSimpleText: {
    fontSize: 22,
    fontWeight: '800',
    color: OwnerTheme.colors.textPrimary,
    flex: 1,
  },
  roomPill: {
    backgroundColor: OwnerTheme.colors.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: OwnerTheme.radius.sm,
  },
  roomPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  undoToast: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: BottomTabInset + 14,
    backgroundColor: '#0F172A',
    borderRadius: OwnerTheme.radius.md,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...OwnerTheme.shadow,
  },
  undoToastText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  undoToastAction: {
    color: '#38BDF8',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 10,
    maxWidth: 800,
    width: '100%',
    alignSelf: 'center',
    gap: 12,
  },
  tempPasswordBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FCD34D',
    borderRadius: OwnerTheme.radius.card,
    padding: 12,
  },
  tempPasswordTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400E',
  },
  tempPasswordSubtitle: {
    fontSize: 11,
    color: '#B45309',
    marginTop: 1,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: OwnerTheme.radius.md,
    padding: 12,
  },
  errorText: {
    fontSize: 12,
    color: '#991B1B',
    flex: 1,
  },
  retryText: {
    fontSize: 12,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
    marginLeft: 8,
  },
  offlineQueueBanner: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: OwnerTheme.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  offlineQueueText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#92400E',
  },
  loadingBox: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 8,
    fontSize: 13,
    color: OwnerTheme.colors.textSecondary,
  },
  unlinkedCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 24,
    alignItems: 'center',
    gap: 10,
  },
  unlinkedTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  unlinkedBody: {
    fontSize: 13,
    color: OwnerTheme.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },
  accountBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: OwnerTheme.radius.sm,
    padding: 10,
    width: '100%',
    alignItems: 'center',
  },
  accountBoxLabel: {
    fontSize: 11,
    color: OwnerTheme.colors.textMuted,
  },
  accountBoxValue: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
    marginTop: 2,
  },
  unlinkedHint: {
    fontSize: 11,
    color: OwnerTheme.colors.textMuted,
    textAlign: 'center',
    lineHeight: 15,
  },
});
