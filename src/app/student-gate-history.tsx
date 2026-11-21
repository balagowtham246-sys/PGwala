import { GoingOutModal, GoingOutSubmitPayload } from '@/components/going-out-modal';
import { RoleBottomNav } from '@/components/ui/bottom-nav';
import { OwnerHeader } from '@/components/ui/owner';
import { BottomTabInset } from '@/constants/theme';
import { buildWhatsAppReminderUrl } from '@/lib/billing-utils';
import { triggerLightHaptic, triggerSuccessHaptic } from '@/lib/haptics';
import {
  countDaysOutThisMonth,
  groupLogsByLocalDay,
  isOutOverHours,
} from '@/lib/movement-utils';
import {
  formatRoomLabel,
  normalizeTimeMeridiemLowercase,
  resolveExpectedReturnDate,
  toSentenceCaseStatus,
} from '@/lib/ux-utils';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Clock, DoorOpen, HelpCircle, Home, LogOut } from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/context/auth-context';
import { useResident } from '@/context/resident-context';
import { useToast } from '@/context/toast-context';
import {
  useRecordStudentMovementMutation,
  useStudentGateHistoryQuery,
} from '@/hooks/use-movement';
import { extractErrorMessage } from '@/lib/error-utils';
import { queryKeys } from '@/lib/query-keys';

interface StudentResident {
  id: string;
  property_id: string;
  full_name: string;
  room_number: string;
  curfew_time?: string | null;
  owner_phone?: string | null;
  owner_name?: string | null;
  property?: {
    name: string;
  };
}

interface MovementLog {
  id: string;
  resident_id: string;
  direction: 'IN' | 'OUT';
  event_time: string;
  note: string | null;
  purpose?: string | null;
  expected_return_time?: string | null;
  food_required?: boolean;
  recorded_by: string;
}

type DateFilter = 'all' | 'today' | 'week' | 'month';

const RETURN_REMINDER_STORAGE_KEY = '@pgwala_return_reminder_id';
const ACCIDENTAL_TAP_WINDOW_MS = 5 * 60 * 1000;

async function cancelReturnReminderNotification(): Promise<void> {
  try {
    const existingId = await AsyncStorage.getItem(RETURN_REMINDER_STORAGE_KEY);
    if (existingId) {
      if (Platform.OS !== 'web') {
        await Notifications.cancelScheduledNotificationAsync(existingId).catch(() => { });
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

function formatEventTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    return normalizeTimeMeridiemLowercase(
      d.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      })
    );
  } catch {
    return normalizeTimeMeridiemLowercase(isoString);
  }
}

function formatDateHeader(isoString: string): string {
  try {
    const d = new Date(isoString);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    if (d.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (d.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    } else {
      return d.toLocaleDateString('en-IN', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    }
  } catch {
    return isoString.split('T')[0] || isoString;
  }
}

const GateLogRowCard = memo(function GateLogRowCard({
  log,
}: {
  log: MovementLog;
}) {
  const isIn = log.direction === 'IN';
  return (
    <View style={styles.logCard}>
      <View style={[styles.directionBadge, isIn ? styles.badgeIn : styles.badgeOut]}>
        {isIn ? (
          <DoorOpen size={14} color="#15803D" />
        ) : (
          <LogOut size={14} color="#B45309" />
        )}
        <Text
          style={[
            styles.directionText,
            isIn ? styles.directionTextIn : styles.directionTextOut,
          ]}>
          {toSentenceCaseStatus(isIn ? 'gate_in' : 'gate_out')}
        </Text>
      </View>

      <View style={styles.logDetails}>
        <Text style={styles.logTime}>{formatEventTime(log.event_time)}</Text>
        {log.purpose && (
          <View style={styles.purposeTagRow}>
            <Text style={styles.purposeBadge}>{log.purpose}</Text>
            {log.expected_return_time && (
              <Text style={styles.returnBadge}>
                Return: {normalizeTimeMeridiemLowercase(log.expected_return_time)}
              </Text>
            )}
          </View>
        )}
        {!isIn && typeof log.food_required === 'boolean' && (
          <Text
            style={[
              styles.foodBadge,
              log.food_required ? styles.foodNeeded : styles.foodNotNeeded,
            ]}>
            {log.food_required ? 'Dinner Required' : 'No Dinner Needed'}
          </Text>
        )}
        {log.note && <Text style={styles.logNote}>Note: {log.note}</Text>}
      </View>
    </View>
  );
});

export default function StudentGateHistoryScreen() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { resident: sharedResident, refreshResident } = useResident();
  const { showToast } = useToast();
  const userId = user?.id;

  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [fallbackResident, setFallbackResident] = useState<StudentResident | null>(null);
  const [filter, setFilter] = useState<DateFilter>('all');
  const [goingOutModalVisible, setGoingOutModalVisible] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const savingRef = useRef(false);
  const lastErrorAtRef = useRef(0);
  const recordGateToggleRef = useRef<
    ((targetDirection: 'IN' | 'OUT', isUndo?: boolean) => Promise<void>) | null
  >(null);

  const resident = useMemo<StudentResident | null>(() => {
    if (sharedResident) {
      return {
        id: sharedResident.residentId,
        property_id: sharedResident.propertyId,
        full_name: sharedResident.fullName,
        room_number: sharedResident.roomNumber,
        curfew_time: sharedResident.curfewTime,
        owner_phone: sharedResident.ownerPhone,
        owner_name: sharedResident.ownerName,
        property: { name: sharedResident.propertyName },
      };
    }
    return fallbackResident;
  }, [sharedResident, fallbackResident]);

  useEffect(() => {
    if (sharedResident || !userId) return;
    let cancelled = false;
    void refreshResident(false).then((activeRes) => {
      if (!cancelled && activeRes) {
        setFallbackResident({
          id: activeRes.residentId,
          property_id: activeRes.propertyId,
          full_name: activeRes.fullName,
          room_number: activeRes.roomNumber,
          curfew_time: activeRes.curfewTime,
          owner_phone: activeRes.ownerPhone,
          owner_name: activeRes.ownerName,
          property: { name: activeRes.propertyName },
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [sharedResident, userId, refreshResident]);

  const gateQuery = useStudentGateHistoryQuery(resident?.id);
  const movementMutation = useRecordStudentMovementMutation();

  const loading =
    (!resident && Boolean(userId)) ||
    (gateQuery.isPending && !gateQuery.data);
  const refreshing = manualRefreshing;
  const loadingMoreLogs = gateQuery.isFetchingNextPage;
  const savingMovement = movementMutation.isPending;

  const logs = useMemo<MovementLog[]>(() => {
    const pages = gateQuery.data?.pages ?? [];
    const seen = new Set<string>();
    const combined: MovementLog[] = [];
    for (const page of pages) {
      for (const item of page.logs) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          combined.push({
            id: item.id,
            resident_id: item.resident_id,
            direction: item.direction,
            event_time: item.event_time,
            note: item.note,
            purpose: item.purpose,
            expected_return_time: item.expected_return_time,
            food_required: item.food_required,
            recorded_by: item.recorded_by,
          });
        }
      }
    }
    return combined;
  }, [gateQuery.data?.pages]);

  useEffect(() => {
    if (
      gateQuery.isError &&
      gateQuery.errorUpdatedAt > lastErrorAtRef.current &&
      (!gateQuery.data || manualRefreshing)
    ) {
      lastErrorAtRef.current = gateQuery.errorUpdatedAt;
      const msg = extractErrorMessage(
        gateQuery.error,
        'Could not load your gate entry and exit history.'
      );
      Alert.alert('Load Error', msg);
    }
  }, [
    gateQuery.isError,
    gateQuery.error,
    gateQuery.errorUpdatedAt,
    gateQuery.data,
    manualRefreshing,
  ]);

  const loadData = useCallback(async () => {
    if (!userId) return;
    if (!resident) {
      const activeRes = await refreshResident(false);
      if (activeRes) {
        setFallbackResident({
          id: activeRes.residentId,
          property_id: activeRes.propertyId,
          full_name: activeRes.fullName,
          room_number: activeRes.roomNumber,
          curfew_time: activeRes.curfewTime,
          owner_phone: activeRes.ownerPhone,
          owner_name: activeRes.ownerName,
          property: { name: activeRes.propertyName },
        });
      }
      return;
    }
    await gateQuery.refetch();
  }, [userId, resident, refreshResident, gateQuery]);

  const loadMoreLogs = () => {
    if (!gateQuery.hasNextPage || gateQuery.isFetchingNextPage) return;
    void gateQuery.fetchNextPage();
  };

  // Current status based on most recent log (default IN if no logs yet)
  const latestLog = logs.length > 0 ? logs[0] : null;
  const currentStatus = latestLog ? latestLog.direction : 'IN';
  const lastEventTime = latestLog ? formatEventTime(latestLog.event_time) : null;
  const lastEventDate = latestLog ? formatDateHeader(latestLog.event_time) : null;
  const outNudge = isOutOverHours(currentStatus, latestLog?.event_time);
  const daysOutThisMonth = useMemo(() => countDaysOutThisMonth(logs), [logs]);
  const expectedReturnDate =
    currentStatus === 'OUT' && latestLog
      ? resolveExpectedReturnDate(
        latestLog.expected_return_time,
        latestLog.event_time
      )
      : null;
  const isRunningLate = Boolean(
    expectedReturnDate && nowMs >= expectedReturnDate.getTime()
  );

  useEffect(() => {
    if (currentStatus !== 'OUT') return;
    const id = setInterval(() => {
      setNowMs(Date.now());
    }, 30000);
    return () => clearInterval(id);
  }, [currentStatus]);

  const recordGateToggle = useCallback(
    async (targetDirection: 'IN' | 'OUT', isUndo: boolean = false) => {
      if (savingRef.current) return;
      savingRef.current = true;
      if (isUndo) {
        triggerLightHaptic();
      } else {
        triggerSuccessHaptic();
      }
      try {
        const outcome = await movementMutation.mutateAsync({
          residentId: resident?.id,
          input: {
            direction: targetDirection,
            note: isUndo ? 'Undo previous gate tap' : undefined,
            userId,
          },
        });
        if (targetDirection === 'IN') {
          void cancelReturnReminderNotification();
        }
        if (outcome.queued) {
          showToast('Saved offline — will sync automatically');
          return;
        }
        if (!isUndo) {
          showToast(
            targetDirection === 'IN' ? 'Marked Inside PG' : 'Marked Outside PG',
            {
              actionLabel: 'Undo',
              onAction: () => {
                void recordGateToggleRef.current?.(
                  targetDirection === 'IN' ? 'OUT' : 'IN',
                  true
                );
              },
            }
          );
        }
      } catch (err: unknown) {
        const msg = extractErrorMessage(err, 'Could not update gate status.');
        Alert.alert('Update Failed', msg);
      } finally {
        savingRef.current = false;
      }
    },
    [movementMutation, resident, showToast, userId]
  );

  useEffect(() => {
    recordGateToggleRef.current = recordGateToggle;
    return () => {
      recordGateToggleRef.current = null;
    };
  }, [recordGateToggle]);

  const handleConfirmGoingOut = async (payload: GoingOutSubmitPayload) => {
    if (savingRef.current) return;
    savingRef.current = true;
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
        showToast('Saved offline — will sync automatically');
        return;
      }
      showToast('Marked Outside PG', {
        actionLabel: 'Undo',
        onAction: () => {
          void recordGateToggleRef.current?.('IN', true);
        },
      });
    } catch (err: unknown) {
      const msg = extractErrorMessage(err, 'Could not update gate status.');
      Alert.alert('Update Failed', msg);
    } finally {
      savingRef.current = false;
    }
  };

  const handleTellOwnerRunningLate = useCallback(async () => {
    if (savingRef.current || currentStatus !== 'OUT' || !latestLog) return;
    savingRef.current = true;
    try {
      const outcome = await movementMutation.mutateAsync({
        residentId: resident?.id,
        input: {
          direction: 'OUT',
          purpose: latestLog.purpose || 'Running late',
          expectedReturnTime: 'Running late',
          note: 'Resident running late (expected return passed)',
          userId,
        },
      });

      triggerSuccessHaptic();
      void cancelReturnReminderNotification();

      if (outcome.queued) {
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
    } catch (err: unknown) {
      const msg = extractErrorMessage(err, 'Could not notify PG owner.');
      Alert.alert('Update Failed', msg);
    } finally {
      savingRef.current = false;
      void qc.invalidateQueries({ queryKey: queryKeys.movement.all });
    }
  }, [
    currentStatus,
    latestLog,
    movementMutation,
    resident?.id,
    resident?.owner_phone,
    userId,
    showToast,
    qc,
  ]);

  // Filtered logs
  const filteredLogs = useMemo(() => {
    if (filter === 'all') return logs;

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    return logs.filter((log) => {
      const logDate = new Date(log.event_time);
      if (filter === 'today') {
        return logDate >= startOfToday;
      }
      if (filter === 'week') {
        const weekAgo = new Date(startOfToday);
        weekAgo.setDate(weekAgo.getDate() - 7);
        return logDate >= weekAgo;
      }
      if (filter === 'month') {
        const monthAgo = new Date(startOfToday);
        monthAgo.setDate(monthAgo.getDate() - 30);
        return logDate >= monthAgo;
      }
      return true;
    });
  }, [logs, filter]);

  // Group filtered logs by local calendar date
  const groupedLogs = useMemo(
    () => groupLogsByLocalDay(filteredLogs),
    [filteredLogs]
  );

  const logSections = useMemo(
    () =>
      loading || !resident
        ? []
        : groupedLogs.map((group) => ({
          dateKey: group.dateKey,
          dateTitle: group.dateTitle,
          data: group.items,
        })),
    [loading, resident, groupedLogs]
  );

  const propertyName = resident?.property?.name || 'PG Accommodation';
  const headerSubtitle = resident?.room_number
    ? `${propertyName} · ${formatRoomLabel(resident.room_number)}`
    : propertyName;

  const listHeader = useMemo(() => {
    if (loading || !resident) return undefined;
    return (
      <>
        {/* Status Card */}
        <View
          style={[
            styles.statusCard,
            currentStatus === 'IN'
              ? styles.statusCardIn
              : currentStatus === 'OUT'
                ? styles.statusCardOut
                : styles.statusCardUnknown,
          ]}>
          <View style={styles.statusIconWrap}>
            {currentStatus === 'IN' ? (
              <Home size={22} color="#16A34A" />
            ) : currentStatus === 'OUT' ? (
              <LogOut size={22} color="#D97706" />
            ) : (
              <HelpCircle size={22} color="#64748B" />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.statusLabel}>Current Gate Status</Text>
            <Text
              style={[
                styles.statusValue,
                currentStatus === 'IN'
                  ? styles.textIn
                  : currentStatus === 'OUT'
                    ? styles.textOut
                    : styles.textUnknown,
              ]}>
              {currentStatus === 'IN'
                ? 'Checked in'
                : currentStatus === 'OUT'
                  ? 'Checked out'
                  : 'No Gate Logs Recorded'}
            </Text>
            {lastEventTime && (
              <Text style={styles.statusSub}>
                Last recorded: {lastEventDate} at {lastEventTime}
              </Text>
            )}
          </View>
          <Pressable
            style={[
              styles.gateQuickBtn,
              currentStatus === 'IN' ? styles.gateQuickOutBtn : styles.gateQuickInBtn,
              savingMovement && { opacity: 0.6 },
            ]}
            disabled={savingMovement}
            onPress={() => {
              if (currentStatus === 'IN') {
                setGoingOutModalVisible(true);
                return;
              }
              const eventMs = latestLog?.event_time
                ? new Date(latestLog.event_time).getTime()
                : NaN;
              if (
                !Number.isNaN(eventMs) &&
                Date.now() - eventMs < ACCIDENTAL_TAP_WINDOW_MS
              ) {
                Alert.alert(
                  'Confirm Check-In',
                  'You marked Going Out less than 5 minutes ago. Record check-in anyway?',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Mark Inside', onPress: () => void recordGateToggle('IN') },
                  ]
                );
                return;
              }
              void recordGateToggle('IN');
            }}>
            {savingMovement ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.gateQuickBtnText}>
                {currentStatus === 'IN' ? 'Going Out' : 'Mark Inside'}
              </Text>
            )}
          </Pressable>
        </View>

        {/* Running Late Banner when expected return time has passed */}
        {isRunningLate && latestLog && (
          <View style={styles.runningLateBanner}>
            <View style={styles.runningLateHeader}>
              <Clock size={16} color="#B45309" />
              <View style={{ flex: 1 }}>
                <Text style={styles.runningLateTitle}>Running late</Text>
                <Text style={styles.runningLateSub}>
                  Expected return (
                  {normalizeTimeMeridiemLowercase(
                    latestLog.expected_return_time || ''
                  )}
                  ) has passed.
                </Text>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              style={[
                styles.runningLateBtn,
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

        {/* 10+ Hours Out Nudge */}
        {outNudge.isOver && (
          <View style={styles.overHoursBanner}>
            <Text style={styles.overHoursText}>
              You&apos;ve been out for {outNudge.hoursOut}+ hours. Tap &quot;Mark Inside&quot; when you&apos;re back at the PG.
            </Text>
          </View>
        )}

        {/* Monthly Summary */}
        <View style={styles.monthSummaryCard}>
          <Text style={styles.monthSummaryLabel}>This month</Text>
          <Text style={styles.monthSummaryValue}>
            {daysOutThisMonth} {daysOutThisMonth === 1 ? 'day' : 'days'} out
          </Text>
        </View>

        {/* Filter Tabs */}
        <View style={styles.filterRow}>
          {(
            [
              { key: 'all', label: 'All' },
              { key: 'today', label: 'Today' },
              { key: 'week', label: 'Last 7 Days' },
              { key: 'month', label: 'Last 30 Days' },
            ] as const
          ).map((f) => (
            <Pressable
              key={f.key}
              style={[styles.filterBtn, filter === f.key && styles.filterBtnActive]}
              onPress={() => setFilter(f.key)}>
              <Text
                style={[
                  styles.filterBtnText,
                  filter === f.key && styles.filterBtnTextActive,
                ]}>
                {f.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </>
    );
  }, [
    loading,
    resident,
    currentStatus,
    lastEventTime,
    lastEventDate,
    savingMovement,
    latestLog,
    isRunningLate,
    outNudge,
    daysOutThisMonth,
    filter,
    recordGateToggle,
    handleTellOwnerRunningLate,
  ]);

  const listEmpty = useMemo(() => {
    if (loading) {
      return (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="small" color="#0284C7" />
          <Text style={styles.loadingText}>Loading gate access logs...</Text>
        </View>
      );
    }
    if (!resident) {
      return (
        <View style={styles.unlinkedCard}>
          <Text style={styles.unlinkedTitle}>Account Not Linked</Text>
          <Text style={styles.unlinkedSub}>
            Your account is not linked to an active PG room record yet.
          </Text>
        </View>
      );
    }
    return (
      <View style={styles.emptyCard}>
        <Text style={styles.emptyTitle}>No Gate Logs</Text>
        <Text style={styles.emptySub}>
          No gate check-in or check-out events found for the selected timeframe.
        </Text>
      </View>
    );
  }, [loading, resident]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <OwnerHeader
        title="My Gate History"
        subtitle={headerSubtitle}
        showBack
        onBack={() =>
          router.canGoBack() ? router.back() : router.replace('/student-dashboard')
        }
      />

      <SectionList
        sections={logSections}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <GateLogRowCard log={item} />}
        renderSectionHeader={({ section }) => (
          <View style={styles.dateHeader}>
            <Text style={styles.dateHeaderTitle}>{section.dateTitle}</Text>
            <Text style={styles.dateHeaderCount}>
              {section.data.length} event{section.data.length === 1 ? '' : 's'}
            </Text>
          </View>
        )}
        renderSectionFooter={() => <View style={{ height: 10 }} />}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={listEmpty}
        ListFooterComponent={
          loadingMoreLogs ? (
            <View style={{ paddingVertical: 16, alignItems: 'center' }}>
              <ActivityIndicator size="small" color="#0284C7" />
            </View>
          ) : undefined
        }
        onEndReached={() => void loadMoreLogs()}
        onEndReachedThreshold={0.4}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled={false}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setManualRefreshing(true);
              void loadData().finally(() => {
                setManualRefreshing(false);
              });
            }}
            colors={['#0284C7']}
          />
        }
      />

      <GoingOutModal
        visible={goingOutModalVisible}
        saving={savingMovement}
        curfewTime={resident?.curfew_time ?? null}
        onClose={() => setGoingOutModalVisible(false)}
        onConfirm={handleConfirmGoingOut}
      />

      <RoleBottomNav activeTab="gate" roleOverride="student" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: BottomTabInset + 40,
  },
  gateQuickBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gateQuickOutBtn: {
    backgroundColor: '#D97706',
  },
  gateQuickInBtn: {
    backgroundColor: '#16A34A',
  },
  gateQuickBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  overHoursBanner: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FCD34D',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  overHoursText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#92400E',
  },
  runningLateBanner: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FCD34D',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
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
    backgroundColor: '#D97706',
    borderRadius: 8,
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
  monthSummaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 14,
  },
  monthSummaryLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  monthSummaryValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  loadingBox: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 8,
  },
  unlinkedCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  unlinkedTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  unlinkedSub: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 4,
    textAlign: 'center',
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 14,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  statusCardIn: {
    borderLeftWidth: 4,
    borderLeftColor: '#16A34A',
  },
  statusCardOut: {
    borderLeftWidth: 4,
    borderLeftColor: '#EA580C',
  },
  statusCardUnknown: {
    borderLeftWidth: 4,
    borderLeftColor: '#94A3B8',
  },
  statusIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  statusIcon: {
    fontSize: 22,
  },
  statusLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  statusValue: {
    fontSize: 16,
    fontWeight: '800',
    marginTop: 2,
  },
  statusSub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 3,
  },
  textIn: {
    color: '#16A34A',
  },
  textOut: {
    color: '#EA580C',
  },
  textUnknown: {
    color: '#64748B',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  statBox: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  statVal: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  statLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
    marginTop: 2,
  },
  filterRow: {
    flexDirection: 'row',
    backgroundColor: '#E2E8F0',
    borderRadius: 8,
    padding: 2,
    marginBottom: 16,
  },
  filterBtn: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    borderRadius: 6,
  },
  filterBtnActive: {
    backgroundColor: '#FFFFFF',
  },
  filterBtnText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  filterBtnTextActive: {
    color: '#0F172A',
    fontWeight: '700',
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#475569',
  },
  emptySub: {
    fontSize: 12,
    color: '#94A3B8',
    textAlign: 'center',
    marginTop: 4,
  },
  dateGroup: {
    marginBottom: 14,
  },
  dateHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginBottom: 6,
  },
  dateHeaderTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  dateHeaderCount: {
    fontSize: 11,
    color: '#64748B',
  },
  logCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 6,
  },
  directionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginRight: 12,
    gap: 4,
  },
  badgeIn: {
    backgroundColor: '#DCFCE7',
  },
  badgeOut: {
    backgroundColor: '#FFEDD5',
  },
  directionIcon: {
    fontSize: 12,
  },
  directionText: {
    fontSize: 11,
    fontWeight: '800',
  },
  directionTextIn: {
    color: '#15803D',
  },
  directionTextOut: {
    color: '#C2410C',
  },
  logDetails: {
    flex: 1,
  },
  logTime: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  logNote: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  purposeTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  purposeBadge: {
    backgroundColor: '#EFF6FF',
    color: '#1D4ED8',
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  returnBadge: {
    backgroundColor: '#F8FAFC',
    color: '#475569',
    fontSize: 11,
    fontWeight: '600',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  foodBadge: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  foodNeeded: {
    backgroundColor: '#DCFCE7',
    color: '#15803D',
  },
  foodNotNeeded: {
    backgroundColor: '#FEF3C7',
    color: '#92400E',
  },
});

