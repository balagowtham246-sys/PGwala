import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { Href, router, useFocusEffect } from 'expo-router';
import { AlertCircle, ChevronRight, ClipboardList, Clock, Megaphone } from 'lucide-react-native';

import { BottomTabInset, OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useResidentTabs } from '@/context/resident-tabs-context';
import { useToast } from '@/context/toast-context';
import {
  useStudentDashboardQuery,
  useStudentUnreadNoticesQuery,
} from '@/hooks/use-dashboards';
import { useRecordStudentMovementMutation } from '@/hooks/use-movement';
import { buildWhatsAppReminderUrl } from '@/lib/billing-utils';
import { triggerLightHaptic, triggerSuccessHaptic } from '@/lib/haptics';
import { flushOfflineQueue, getPendingCount } from '@/lib/offline-queue';
import { invalidatePrefix } from '@/lib/query-cache';
import { queryKeys } from '@/lib/query-keys';
import { getFirstName, getSmartDefaultMeal } from '@/lib/resident-home-utils';
import {
  formatRoomLabel,
  normalizeTimeMeridiemLowercase,
  resolveExpectedReturnDate,
} from '@/lib/ux-utils';
import { defaultOfflineExecutors } from '@/services/offline-executors';
import {
  createEmptyResidentMenus,
  MealType,
  ResidentFoodMenu,
  ResidentMovementRecord,
  StudentDashboardData,
  toLocalIsoDate,
} from '@/services/dashboard.service';
import { RESIDENT_NOTICES_CACHE_PREFIX } from '@/services/resident-notices.service';
import { WashingMachineCard } from '@/components/washing-machine-card';
import { RoleBottomNav } from '@/components/ui/bottom-nav';
import { DashboardSkeleton } from '@/components/ui/owner';
import { FoodStatusBanner } from '@/components/food-status-banner';
import { GoingOutModal, GoingOutSubmitPayload } from '@/components/going-out-modal';
import { ResidentStatusHeader } from '@/components/student-dashboard/ResidentStatusHeader';
import { ResidentQuickTiles } from '@/components/student-dashboard/ResidentQuickTiles';
import { TodaysMenuPreview } from '@/components/student-dashboard/TodaysMenuPreview';

export type { MealType, ResidentFoodMenu, ResidentMovementRecord };

const RETURN_REMINDER_STORAGE_KEY = '@pgwala_return_reminder_id';
const ACCIDENTAL_TAP_WINDOW_MS = 5 * 60 * 1000;

async function cancelReturnReminderNotification(): Promise<void> {
  try {
    const existingId = await AsyncStorage.getItem(RETURN_REMINDER_STORAGE_KEY);
    if (existingId) {
      if (Platform.OS !== 'web') {
        await Notifications.cancelScheduledNotificationAsync(existingId).catch(() => {});
      }
      await AsyncStorage.removeItem(RETURN_REMINDER_STORAGE_KEY);
    }
  } catch {
    // Non-fatal
  }
}

async function scheduleReturnReminderNotification(
  expectedReturnTime: string | null | undefined,
  departedAtIso: string
): Promise<void> {
  await cancelReturnReminderNotification();
  if (Platform.OS === 'web') return;
  const targetDate = resolveExpectedReturnDate(expectedReturnTime, departedAtIso);
  if (!targetDate || targetDate.getTime() <= Date.now()) return;
  try {
    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted || existing.status === 'granted';
    if (!granted && existing.canAskAgain !== false) {
      const req = await Notifications.requestPermissionsAsync();
      granted = req.granted || req.status === 'granted';
    }
    if (!granted) return;
    const notifId = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Return time reminder',
        body: 'Your expected return time has passed. Mark Inside or tell your PG owner if you are running late.',
        data: { type: 'return_reminder' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: targetDate,
      },
    });
    await AsyncStorage.setItem(RETURN_REMINDER_STORAGE_KEY, notifId);
  } catch {
    // Non-fatal: local notifications may be unavailable or denied
  }
}

export default function ResidentDashboardScreen() {
  const qc = useQueryClient();
  const { user, profile, refreshProfile } = useAuth();
  const { isInsidePager, navigateToTab } = useResidentTabs();
  const { showToast } = useToast();
  const userId = user?.id;

  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [foodRefreshKey, setFoodRefreshKey] = useState(0);
  const [manualMealTab, setManualMealTab] = useState<MealType | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [goingOutModalVisible, setGoingOutModalVisible] = useState(false);
  const [pendingOfflineCount, setPendingOfflineCount] = useState(0);

  const hasMountedRef = useRef(false);
  const savingMovementRef = useRef(false);

  const dashboardQuery = useStudentDashboardQuery(userId);
  const movementMutation = useRecordStudentMovementMutation();

  const dashData = dashboardQuery.data;
  const resident = dashData?.resident ?? null;
  const menus = useMemo(
    () => dashData?.menus ?? createEmptyResidentMenus(),
    [dashData?.menus]
  );
  const activeMealTab = manualMealTab ?? getSmartDefaultMeal(menus);
  const setActiveMealTab = setManualMealTab;
  const pendingDuesPaise = dashData?.pendingDuesPaise ?? null;
  const pendingReviewPaise = dashData?.pendingReviewPaise ?? null;
  const latestMovement = dashData?.latestMovement ?? null;
  const hasUnreadChat = dashData?.hasUnreadChat ?? false;
  const loading = Boolean(userId) && dashboardQuery.isPending && !dashData;
  const refreshing = manualRefreshing;
  const savingMovement = movementMutation.isPending;
  const errorMessage = dashboardQuery.isError
    ? `Failed to load resident data: ${dashboardQuery.error.message}`
    : null;

  const residentPropertyId = resident?.property_id ?? null;
  const residentRoomNumber = resident?.room_number ?? '';

  const noticesQuery = useStudentUnreadNoticesQuery(
    userId,
    residentPropertyId,
    residentRoomNumber
  );
  const unreadSummary = noticesQuery.data ?? {
    unreadCount: 0,
    latestUnreadAnnouncement: null,
  };

  const refetchNotices = noticesQuery.refetch;
  const refetchDashboard = dashboardQuery.refetch;

  const loadUnreadNotices = useCallback(
    async (forceInvalidate = false) => {
      if (!userId || !residentPropertyId) return;
      if (forceInvalidate) {
        await invalidatePrefix(RESIDENT_NOTICES_CACHE_PREFIX);
      }
      await refetchNotices();
    },
    [userId, residentPropertyId, refetchNotices]
  );

  const loadResidentData = useCallback(async () => {
    if (!userId) return;
    await refetchDashboard();
  }, [userId, refetchDashboard]);

  const flushOfflineAndSync = useCallback(async () => {
    const summary = await flushOfflineQueue(defaultOfflineExecutors);
    setPendingOfflineCount(summary.remainingCount);
    setNowMs(Date.now());
    if (summary.succeeded > 0) {
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
        qc.invalidateQueries({ queryKey: queryKeys.movement.all }),
      ]);
    }
  }, [qc]);

  // Refresh unread notices immediately when a push notification arrives in foreground
  useEffect(() => {
    if (Platform.OS === 'web' || !userId || !residentPropertyId) return;
    const sub = Notifications.addNotificationReceivedListener(() => {
      void loadUnreadNotices(true);
    });
    return () => sub.remove();
  }, [userId, residentPropertyId, loadUnreadNotices]);

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

  const isCurrentlyOut = latestMovement?.direction === 'OUT';
  const expectedReturnDate =
    isCurrentlyOut && latestMovement
      ? resolveExpectedReturnDate(
          latestMovement.expected_return_time,
          latestMovement.event_time
        )
      : null;
  const isRunningLate = Boolean(
    expectedReturnDate && nowMs >= expectedReturnDate.getTime()
  );

  useEffect(() => {
    if (!isCurrentlyOut) return;
    const id = setInterval(() => {
      setNowMs(Date.now());
    }, 30000);
    return () => clearInterval(id);
  }, [isCurrentlyOut]);

  // Refresh profile, notices & flush offline queue when returning to dashboard
  useFocusEffect(
    useCallback(() => {
      void flushOfflineAndSync();
      if (!hasMountedRef.current) {
        hasMountedRef.current = true;
        return;
      }
      void refreshProfile();
      if (userId) {
        void qc.invalidateQueries({
          queryKey: queryKeys.dashboard.student(userId, toLocalIsoDate()),
        });
      }
      if (userId && residentPropertyId) {
        void qc.invalidateQueries({
          queryKey: queryKeys.dashboard.studentNotices(
            userId,
            residentPropertyId,
            residentRoomNumber
          ),
        });
      }
    }, [flushOfflineAndSync, refreshProfile, qc, userId, residentPropertyId, residentRoomNumber])
  );

  const handleRefresh = () => {
    setManualRefreshing(true);
    setFoodRefreshKey((k) => k + 1);
    void refreshProfile();
    void (async () => {
      try {
        await flushOfflineQueue(defaultOfflineExecutors);
        const count = await getPendingCount();
        setPendingOfflineCount(count);
        await Promise.all([loadResidentData(), loadUnreadNotices(true)]);
      } finally {
        setManualRefreshing(false);
      }
    })();
  };

  const performUndoDirection = useCallback(
    async (targetDir: 'IN' | 'OUT') => {
      if (savingMovementRef.current) return;
      savingMovementRef.current = true;
      triggerLightHaptic();
      try {
        const outcome = await movementMutation.mutateAsync({
          residentId: resident?.id,
          input: {
            direction: targetDir,
            note: 'Undo previous gate tap',
            userId,
          },
        });
        if (targetDir === 'IN') {
          void cancelReturnReminderNotification();
        }
        if (outcome.queued) {
          setPendingOfflineCount(await getPendingCount());
          showToast('Saved offline — will sync automatically');
        }
      } catch (err) {
        Alert.alert(
          'Undo Failed',
          err instanceof Error ? err.message : 'Could not undo last gate action.'
        );
      } finally {
        savingMovementRef.current = false;
      }
    },
    [movementMutation, resident, userId, showToast]
  );

  // 1-tap Check-In when back at PG (optimistic update + rollback via useRecordStudentMovementMutation)
  const proceedMarkBackIn = useCallback(async () => {
    if (savingMovementRef.current) return;
    savingMovementRef.current = true;

    try {
      const outcome = await movementMutation.mutateAsync({
        residentId: resident?.id,
        input: {
          direction: 'IN',
          userId,
        },
      });

      triggerSuccessHaptic();
      void cancelReturnReminderNotification();

      if (outcome.queued) {
        setPendingOfflineCount(await getPendingCount());
        showToast('Saved offline — will sync automatically');
        return;
      }

      showToast('Marked Inside PG', {
        actionLabel: 'Undo',
        onAction: () => {
          void performUndoDirection('OUT');
        },
      });
    } catch (err) {
      Alert.alert(
        'Update Failed',
        err instanceof Error ? err.message : 'Could not record check-in.'
      );
    } finally {
      savingMovementRef.current = false;
    }
  }, [movementMutation, resident, userId, performUndoDirection, showToast]);

  const handleMarkBackIn = () => {
    if (savingMovementRef.current) return;
    const eventMs = latestMovement?.event_time
      ? new Date(latestMovement.event_time).getTime()
      : NaN;
    if (
      latestMovement?.direction === 'OUT' &&
      !Number.isNaN(eventMs) &&
      Date.now() - eventMs < ACCIDENTAL_TAP_WINDOW_MS
    ) {
      Alert.alert(
        'Confirm Check-In',
        'You marked Going Out less than 5 minutes ago. Record check-in anyway?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Mark Inside', onPress: () => void proceedMarkBackIn() },
        ]
      );
      return;
    }
    void proceedMarkBackIn();
  };

  // Confirm Going Out with Purpose, Return Time & Food Requirement (optimistic)
  const handleConfirmGoingOut = async (payload: GoingOutSubmitPayload) => {
    if (savingMovementRef.current) return;
    savingMovementRef.current = true;

    try {
      const nowIso = new Date().toISOString();
      const outcome = await movementMutation.mutateAsync({
        residentId: resident?.id,
        input: {
          direction: 'OUT',
          purpose: payload.purpose,
          expectedReturnTime: payload.expectedReturnTime || undefined,
          foodRequired: payload.foodRequired,
          userId,
        },
      });

      setGoingOutModalVisible(false);
      triggerSuccessHaptic();
      void scheduleReturnReminderNotification(payload.expectedReturnTime, nowIso);

      if (outcome.queued) {
        setPendingOfflineCount(await getPendingCount());
        showToast('Saved offline — will sync automatically');
        return;
      }

      showToast('Marked Outside PG', {
        actionLabel: 'Undo',
        onAction: () => {
          void performUndoDirection('IN');
        },
      });
    } catch (err) {
      Alert.alert(
        'Update Failed',
        err instanceof Error ? err.message : 'Could not record departure.'
      );
    } finally {
      savingMovementRef.current = false;
    }
  };

  const handleTellOwnerRunningLate = async () => {
    if (
      savingMovementRef.current ||
      !latestMovement ||
      latestMovement.direction !== 'OUT'
    ) {
      return;
    }
    savingMovementRef.current = true;
    try {
      const outcome = await movementMutation.mutateAsync({
        residentId: resident?.id,
        input: {
          direction: 'OUT',
          purpose: latestMovement.purpose || 'Running late',
          expectedReturnTime: 'Running late',
          note: 'Resident running late (expected return passed)',
          userId,
        },
      });

      triggerSuccessHaptic();
      void cancelReturnReminderNotification();

      if (outcome.queued) {
        setPendingOfflineCount(await getPendingCount());
        showToast('Saved offline — will sync automatically');
        return;
      }

      const ownerPhone = resident?.owner_phone ?? null;
      const whatsappUrl = buildWhatsAppReminderUrl(
        ownerPhone,
        'Hi, I am currently outside the PG and running late. I will update once I return.'
      );
      showToast(
        'Owner notified that you are running late',
        whatsappUrl
          ? {
              actionLabel: 'WhatsApp',
              onAction: () => {
                void Linking.openURL(whatsappUrl).catch(() => {
                  Alert.alert(
                    'WhatsApp Unavailable',
                    'Could not open WhatsApp on this device.'
                  );
                });
              },
            }
          : undefined
      );
    } catch (err) {
      Alert.alert(
        'Update Failed',
        err instanceof Error ? err.message : 'Could not notify PG owner.'
      );
    } finally {
      savingMovementRef.current = false;
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      {/* Top Header: Brand + Chat Icon + Notices Bell + Settings Cog */}
      <ResidentStatusHeader
        showChat={Boolean(resident)}
        hasUnreadChat={hasUnreadChat}
        unreadNoticesCount={unreadSummary.unreadCount}
        onPressChat={() => {
          if (userId) {
            qc.setQueryData<StudentDashboardData>(
              queryKeys.dashboard.student(userId, toLocalIsoDate()),
              (prev) => (prev ? { ...prev, hasUnreadChat: false } : prev)
            );
          }
          router.push('/resident-chat');
        }}
        onPressNotices={() => router.push('/resident-announcements' as Href)}
        onPressSettings={() => router.push('/resident-settings')}
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
              onPress={() => router.push('/resident-profile-edit')}>
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
          <DashboardSkeleton />
        ) : resident ? (
          <>
            {/* Unread Notice Preview Card */}
            {unreadSummary.latestUnreadAnnouncement && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Notice: ${unreadSummary.latestUnreadAnnouncement.title}`}
                style={({ pressed }) => [
                  styles.noticePreviewCard,
                  pressed && styles.btnPressed,
                ]}
                onPress={() => router.push('/resident-announcements' as Href)}>
                <View style={styles.noticePreviewIconWrap}>
                  <Megaphone size={16} color={OwnerTheme.colors.primary} />
                </View>
                <View style={styles.noticePreviewTextWrap}>
                  <Text style={styles.noticePreviewTitle} numberOfLines={1}>
                    {unreadSummary.latestUnreadAnnouncement.title}
                  </Text>
                  <Text style={styles.noticePreviewBody} numberOfLines={1}>
                    {unreadSummary.latestUnreadAnnouncement.message}
                  </Text>
                </View>
                <Text style={styles.noticePreviewViewText}>View ›</Text>
              </Pressable>
            )}

            {/* Fintech-Modern Dark-Slate Resident Pass + Washing Machine & Gate 1x2 */}
            <ResidentQuickTiles
              residentName={getFirstName(resident.full_name)}
              roomLabel={formatRoomLabel(resident.room_number)}
              propertyName={resident.property?.name || 'My PG'}
              pendingDuesPaise={pendingDuesPaise}
              pendingReviewPaise={pendingReviewPaise}
              currentMonthBillGenerated={dashData?.currentMonthBillGenerated}
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
              onPressRentDue={() => {
                if (isInsidePager) {
                  navigateToTab('bill');
                } else {
                  router.push('/resident-billing');
                }
              }}
              onOpenGoingOut={() => setGoingOutModalVisible(true)}
              onMarkBackIn={handleMarkBackIn}
            />

            {/* Live Food Status Banner (from Warden) */}
            <FoodStatusBanner refreshKey={foodRefreshKey} />

            {/* Running Late Banner when expected return time has passed */}
            {isRunningLate && latestMovement && (
              <View style={styles.runningLateBanner}>
                <View style={styles.runningLateHeader}>
                  <Clock size={16} color="#B45309" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.runningLateTitle}>Running late</Text>
                    <Text style={styles.runningLateSub}>
                      Expected return (
                      {normalizeTimeMeridiemLowercase(
                        latestMovement.expected_return_time || ''
                      )}
                      ) has passed.
                    </Text>
                  </View>
                </View>
                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.runningLateBtn,
                    pressed && styles.btnPressed,
                    savingMovement && { opacity: 0.6 },
                  ]}
                  disabled={savingMovement}
                  onPress={() => void handleTellOwnerRunningLate()}>
                  <Text style={styles.runningLateBtnText}>
                    Tell the owner I&apos;m running late
                  </Text>
                </Pressable>
              </View>
            )}

            {/* Section 3: Today's Food Menu (Interactive In-Place Card) */}
            <TodaysMenuPreview
              menus={menus}
              activeMealTab={activeMealTab}
              onSelectMealTab={setActiveMealTab}
              onPressFullMenu={() => {
                if (isInsidePager) {
                  navigateToTab('menu');
                } else {
                  router.push('/resident-menu');
                }
              }}
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
        curfewTime={resident?.curfew_time ?? null}
        onClose={() => setGoingOutModalVisible(false)}
        onConfirm={handleConfirmGoingOut}
      />

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
  noticePreviewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: OwnerTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: '#BAE6FD',
    borderRadius: OwnerTheme.radius.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  noticePreviewIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: OwnerTheme.colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noticePreviewTextWrap: {
    flex: 1,
    gap: 1,
  },
  noticePreviewTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  noticePreviewBody: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
  },
  noticePreviewViewText: {
    fontSize: 12,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  btnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  runningLateBanner: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FCD34D',
    borderRadius: OwnerTheme.radius.card,
    padding: 12,
    gap: 10,
  },
  runningLateHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  runningLateTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#92400E',
  },
  runningLateSub: {
    fontSize: 12,
    color: '#B45309',
    marginTop: 1,
  },
  runningLateBtn: {
    backgroundColor: OwnerTheme.colors.warning,
    borderRadius: OwnerTheme.radius.sm,
    paddingVertical: 9,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  runningLateBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
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
