import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RealtimeChannel } from '@supabase/supabase-js';
import * as Notifications from 'expo-notifications';
import { ChevronRight, Disc3 } from 'lucide-react-native';

import { supabase } from '@/lib/supabase';
import { OwnerTheme } from '@/constants/theme';
import { useToast } from '@/context/toast-context';
import { toSentenceCaseStatus } from '@/lib/ux-utils';
import {
  CYCLE_DURATION_MINUTES,
  fetchWashingMachineStatus,
  formatCountdown,
  getRemainingWashSeconds,
  isWashingMachineConflictError,
  releaseWashingMachineUnit,
  requestWashingMachineAccess,
  startWashingMachineUnit,
  WashingMachineRequestStatus,
  WashingMachineStatusData,
  WashingMachineUnitData,
} from '@/services/washing-machine.service';
import { MachineBookingModal } from '@/components/washing-machine/MachineBookingModal';
import { MachineSlotRow } from '@/components/washing-machine/MachineSlotRow';

export type { WashingMachineStatusData, WashingMachineUnitData };

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

interface WashingMachineCardProps {
  propertyId: string | null;
  userRole: 'owner' | 'student';
  currentResidentId?: string | null;
  compact?: boolean;
  style?: any;
}

let wmChannelSequence = 0;

interface QueueStoragePayload {
  joined: boolean;
  notifId: string | null;
}

interface QueueState extends QueueStoragePayload {
  propertyId: string | null;
}

const getQueueStorageKey = (propertyId: string) =>
  `@pgwala_wm_queue:${propertyId}`;

const getMyWashTimerKey = (propertyId: string) =>
  `@pgwala_wm_my_timer:${propertyId}`;

async function cancelMyWashCompletionNotification(propertyId: string): Promise<void> {
  try {
    const existingId = await AsyncStorage.getItem(getMyWashTimerKey(propertyId));
    if (existingId) {
      if (Platform.OS !== 'web') {
        await Notifications.cancelScheduledNotificationAsync(existingId).catch(() => {});
      }
      await AsyncStorage.removeItem(getMyWashTimerKey(propertyId));
    }
  } catch {
    // Non-fatal
  }
}

async function scheduleMyWashCompletionNotification(
  propertyId: string,
  machineName: string
): Promise<boolean> {
  await cancelMyWashCompletionNotification(propertyId);
  if (Platform.OS === 'web') return false;
  try {
    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted || existing.status === 'granted';
    if (!granted && existing.canAskAgain !== false) {
      const req = await Notifications.requestPermissionsAsync();
      granted = req.granted || req.status === 'granted';
    }
    if (!granted) return false;
    const notifId = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Laundry cycle complete!',
        body: `Your wash in ${machineName} is done. Please collect your clothes and mark the machine free.`,
        sound: true,
        data: { type: 'washing_machine' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: CYCLE_DURATION_MINUTES * 60,
        repeats: false,
      },
    });
    await AsyncStorage.setItem(getMyWashTimerKey(propertyId), notifId);
    return true;
  } catch {
    return false;
  }
}

export function WashingMachineCard({
  propertyId,
  userRole,
  currentResidentId,
  compact = false,
  style,
}: WashingMachineCardProps) {
  const { showToast } = useToast();
  const [machines, setMachines] = useState<WashingMachineUnitData[]>([]);
  const [residentEnabled, setResidentEnabled] = useState(true);
  const [requestStatus, setRequestStatus] =
    useState<WashingMachineRequestStatus>('none');
  const [requestingAccess, setRequestingAccess] = useState(false);
  const [popupVisible, setPopupVisible] = useState(false);

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionUnitId, setActionUnitId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [notifyMap, setNotifyMap] = useState<Record<string, string>>({});
  const [queueState, setQueueState] = useState<QueueState>({
    propertyId: null,
    joined: false,
    notifId: null,
  });
  const [queueHydratedPropertyId, setQueueHydratedPropertyId] = useState<
    string | null
  >(null);
  const [queueActionLoading, setQueueActionLoading] = useState(false);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const isMountedRef = useRef(true);
  const actionLockRef = useRef(false);
  const queueActionLockRef = useRef(false);

  const activeMachines = machines.filter((m) => m.is_active);
  const freeMachines = activeMachines.filter((m) => m.status === 'free');
  const inUseMachines = activeMachines.filter((m) => m.status === 'in_use');
  const myOccupiedMachine = machines.find(
    (m) => currentResidentId && m.current_resident_id === currentResidentId
  );
  const isUserWashing = Boolean(myOccupiedMachine);
  const hasFree = freeMachines.length > 0;
  const freeCount = freeMachines.length;
  const firstFreeMachineName =
    freeMachines[0]?.machine_name || 'A washing machine';
  const inQueue = Boolean(
    propertyId && queueState.propertyId === propertyId && queueState.joined
  );
  const queueEligible =
    userRole === 'student' &&
    !isUserWashing &&
    residentEnabled &&
    activeMachines.length > 0 &&
    freeCount === 0;
  const anyInUse = machines.some((m) => m.status === 'in_use');

  useEffect(() => {
    if (!propertyId) return;
    let cancelled = false;

    void (async () => {
      let parsed: QueueStoragePayload | null = null;
      try {
        const raw = await AsyncStorage.getItem(getQueueStorageKey(propertyId));
        if (raw) {
          parsed = JSON.parse(raw) as QueueStoragePayload;
        }
      } catch {
        // Ignore AsyncStorage read errors
      }
      if (cancelled || !isMountedRef.current) return;
      setQueueState((prev) =>
        prev.propertyId === propertyId && prev.joined
          ? prev
          : {
              propertyId,
              joined: Boolean(parsed?.joined),
              notifId: parsed?.notifId ?? null,
            }
      );
      setQueueHydratedPropertyId(propertyId);
    })();

    return () => {
      cancelled = true;
    };
  }, [propertyId]);

  useEffect(() => {
    if (!propertyId || loading || queueHydratedPropertyId !== propertyId) {
      return;
    }
    if (!inQueue || activeMachines.length === 0) return;

    const hasFreeMachine = freeCount > 0;
    if (!hasFreeMachine && !isUserWashing && residentEnabled) return;

    const notifIdToCancel = queueState.notifId;
    const shouldNotifyFree = hasFreeMachine && !isUserWashing && residentEnabled;

    const timer = setTimeout(() => {
      setQueueState({ propertyId, joined: false, notifId: null });
      void AsyncStorage.removeItem(getQueueStorageKey(propertyId)).catch(
        () => {}
      );

      if (
        notifIdToCancel &&
        notifIdToCancel !== 'in_app_only' &&
        Platform.OS !== 'web'
      ) {
        void Notifications.cancelScheduledNotificationAsync(
          notifIdToCancel
        ).catch(() => {});
      }

      if (shouldNotifyFree) {
        showToast('A washing machine is now free!');
        if (Platform.OS !== 'web') {
          void (async () => {
            try {
              const { status } = await Notifications.getPermissionsAsync();
              if (status === 'granted') {
                await Notifications.scheduleNotificationAsync({
                  content: {
                    title: 'A washing machine is now free!',
                    body: `${firstFreeMachineName} is free to start your wash.`,
                    sound: true,
                    data: { type: 'washing_machine' },
                  },
                  trigger: null,
                });
              }
            } catch {
              // Non-fatal local notification failure
            }
          })();
        }
      }
    }, 0);

    return () => clearTimeout(timer);
  }, [
    propertyId,
    loading,
    queueHydratedPropertyId,
    inQueue,
    activeMachines.length,
    freeCount,
    firstFreeMachineName,
    isUserWashing,
    residentEnabled,
    queueState.notifId,
    showToast,
  ]);

  useEffect(() => {
    if (!anyInUse) return;
    const id = setInterval(() => {
      setNowMs(Date.now());
    }, 30000);
    return () => clearInterval(id);
  }, [anyInUse]);

  // Watch for a notified machine becoming free while the app is open
  useEffect(() => {
    const notifiedIds = Object.keys(notifyMap);
    if (notifiedIds.length === 0) return;

    const freedUnits = machines.filter(
      (unit) => unit.status === 'free' && Boolean(notifyMap[unit.id])
    );
    if (freedUnits.length === 0) return;

    const timer = setTimeout(() => {
      for (const unit of freedUnits) {
        const notifId = notifyMap[unit.id];
        if (notifId && notifId !== 'in_app_only') {
          Notifications.cancelScheduledNotificationAsync(notifId).catch(() => {});
        }
        showToast(`${unit.machine_name} is now free to use`);
      }
      setNotifyMap((prev) => {
        const next = { ...prev };
        for (const unit of freedUnits) {
          delete next[unit.id];
        }
        return next;
      });
    }, 0);

    return () => clearTimeout(timer);
  }, [machines, notifyMap, showToast]);

  const handleToggleNotify = async (unit: WashingMachineUnitData) => {
    const existingId = notifyMap[unit.id];
    if (existingId) {
      if (existingId !== 'in_app_only') {
        await Notifications.cancelScheduledNotificationAsync(existingId).catch(
          () => {}
        );
      }
      setNotifyMap((prev) => {
        const next = { ...prev };
        delete next[unit.id];
        return next;
      });
      return;
    }

    const remainingSeconds = getRemainingWashSeconds(unit.started_at);
    const triggerSeconds = Math.max(10, remainingSeconds);

    try {
      const { status } = await Notifications.getPermissionsAsync();
      let finalStatus = status;
      if (status !== 'granted') {
        const req = await Notifications.requestPermissionsAsync();
        finalStatus = req.status;
      }

      if (finalStatus === 'granted') {
        const notifId = await Notifications.scheduleNotificationAsync({
          content: {
            title: `${unit.machine_name} is likely free`,
            body: 'The 45-minute wash cycle should be done now.',
            data: { type: 'washing_machine' },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
            seconds: triggerSeconds,
            repeats: false,
          },
        });
        setNotifyMap((prev) => ({ ...prev, [unit.id]: notifId }));
        return;
      }
    } catch {
      // Fallback to in-app Realtime alert if local notifications aren't permitted
    }

    setNotifyMap((prev) => ({ ...prev, [unit.id]: 'in_app_only' }));
    showToast(`In-app reminder set for ${unit.machine_name}`);
  };

  // Fetch authoritative multi-unit state from the server
  const fetchStatus = useCallback(
    async (isInitial = false) => {
      if (!propertyId) {
        if (isMountedRef.current) setLoading(false);
        return;
      }

      if (isInitial && isMountedRef.current) {
        setLoading(true);
      }
      setErrorMessage(null);

      try {
        const result = await fetchWashingMachineStatus(propertyId, userRole);
        if (!result.ok) {
          throw new Error(result.error.message);
        }

        if (isMountedRef.current && result.data.machines !== null) {
          setMachines(result.data.machines);
          if (userRole === 'student') {
            if (typeof result.data.residentEnabled === 'boolean') {
              setResidentEnabled(result.data.residentEnabled);
            }
            if (result.data.requestStatus) {
              setRequestStatus(result.data.requestStatus);
            }
          }
        }
      } catch (err: any) {
        console.warn('[WashingMachine] Fetch error:', err.message);
        if (isMountedRef.current) {
          setErrorMessage(err.message || 'Could not load washing machine status.');
        }
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    },
    [propertyId, userRole]
  );

  const [isAppActive, setIsAppActive] = useState(AppState.currentState === 'active');

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      setIsAppActive(nextState === 'active');
    });
    return () => sub.remove();
  }, []);

  // Set up Realtime subscription scoped to this property (300ms debounced, active app only)
  useEffect(() => {
    isMountedRef.current = true;
    let isEffectActive = true;

    if (!propertyId) {
      return () => {
        isMountedRef.current = false;
        isEffectActive = false;
      };
    }

    const initialFetchTimer = setTimeout(() => {
      if (isEffectActive && isMountedRef.current) {
        void fetchStatus(true);
      }
    }, 0);

    if (channelRef.current) {
      const oldChannel = channelRef.current;
      channelRef.current = null;
      void supabase.removeChannel(oldChannel);
    }

    if (!isAppActive) {
      return () => {
        clearTimeout(initialFetchTimer);
        isMountedRef.current = false;
        isEffectActive = false;
      };
    }

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRealtimeRefetch = () => {
      if (!isEffectActive || !isMountedRef.current) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (isEffectActive && isMountedRef.current) {
          void fetchStatus(false);
        }
      }, 300);
    };

    wmChannelSequence += 1;
    const channelName = `wm_status_${propertyId}_${wmChannelSequence}`;

    let channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'washing_machines',
          filter: `property_id=eq.${propertyId}`,
        },
        scheduleRealtimeRefetch
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'washing_machine_requests',
          filter: `property_id=eq.${propertyId}`,
        },
        scheduleRealtimeRefetch
      );

    // Scope resident_opt_ins Realtime strictly to the active student's resident_id
    // so changes in other PGs/residents never trigger cross-property refetches.
    if (userRole === 'student' && currentResidentId) {
      channel = channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'resident_opt_ins',
          filter: `resident_id=eq.${currentResidentId}`,
        },
        scheduleRealtimeRefetch
      );
    }

    channel = channel.subscribe((status) => {
      if (isEffectActive && isMountedRef.current) {
        setIsSubscribed(status === 'SUBSCRIBED');
      }
    });

    channelRef.current = channel;

    return () => {
      clearTimeout(initialFetchTimer);
      if (debounceTimer) clearTimeout(debounceTimer);
      isMountedRef.current = false;
      isEffectActive = false;
      setIsSubscribed(false);
      if (channelRef.current === channel) {
        channelRef.current = null;
      }
      void supabase.removeChannel(channel);
    };
  }, [propertyId, userRole, currentResidentId, isAppActive, fetchStatus]);

  // Request Access from Owner (strictly online)
  const handleRequestAccess = async () => {
    if (!propertyId || requestingAccess) return;
    try {
      setRequestingAccess(true);
      const result = await requestWashingMachineAccess(propertyId);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      setRequestStatus('pending');
      showToast('Access request sent to PG owner');
    } catch (err: any) {
      Alert.alert('Request Failed', err.message || 'Could not submit request.');
    } finally {
      setRequestingAccess(false);
    }
  };

  // Action: Start washing machine session (strictly online, double-tap & race guarded)
  const handleStartUsing = async (targetMachineId?: string) => {
    if (!propertyId || actionLoading || actionLockRef.current) return;

    if (userRole === 'student' && currentResidentId) {
      const activeUnit = machines.find(
        (m) => m.current_resident_id === currentResidentId && m.status === 'in_use'
      );
      if (activeUnit) {
        showToast(`You are already using ${activeUnit.machine_name}. Mark it free first.`);
        return;
      }
    }

    if (userRole === 'student' && !residentEnabled) {
      Alert.alert(
        'Access Required',
        'Washing machine access is not enabled for your account. Please request access from the owner.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Request Access', onPress: handleRequestAccess },
        ]
      );
      return;
    }

    actionLockRef.current = true;
    try {
      setActionLoading(true);
      if (targetMachineId) setActionUnitId(targetMachineId);
      setErrorMessage(null);

      const result = await startWashingMachineUnit(propertyId, targetMachineId);
      if (!result.ok) {
        if (isWashingMachineConflictError(result.error)) {
          showToast(
            result.error.message ||
              'Machine was just booked by another resident — refreshing status'
          );
          await fetchStatus(false);
          return;
        }
        throw new Error(result.error.message);
      }

      if (result.data.status === 'not_enabled') {
        setResidentEnabled(false);
        Alert.alert('Access Not Enabled', result.data.errorMessage);
        return;
      }

      await fetchStatus(false);
      const resolvedMachineName = result.data.machineName || 'selected machine';
      const alarmScheduled =
        userRole === 'student'
          ? await scheduleMyWashCompletionNotification(propertyId, resolvedMachineName)
          : false;
      if (result.data.usedLegacyFallback) {
        showToast(
          alarmScheduled
            ? `Wash started · ${CYCLE_DURATION_MINUTES}m completion alarm set`
            : 'Wash started — mark machine free when done'
        );
      } else {
        showToast(
          alarmScheduled
            ? `Wash started on ${resolvedMachineName} · ${CYCLE_DURATION_MINUTES}m alarm set`
            : `Wash started on ${resolvedMachineName}`
        );
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Washing machine could not be started.';
      console.warn('[WashingMachine] Start error:', msg);
      if (isWashingMachineConflictError({ message: msg })) {
        showToast(msg);
      } else {
        Alert.alert('Could Not Start', msg);
      }
      await fetchStatus(false);
    } finally {
      actionLockRef.current = false;
      if (isMountedRef.current) {
        setActionLoading(false);
        setActionUnitId(null);
      }
    }
  };

  // Action: Release washing machine session (strictly online, double-tap guarded)
  const handleMarkFree = async (targetMachineId?: string) => {
    if (!propertyId || actionLoading || actionLockRef.current) return;

    Alert.alert(
      'Finish Washing Session',
      'Are you sure your wash is done and the machine is free for others?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark Free',
          style: 'default',
          onPress: async () => {
            if (actionLockRef.current) return;
            actionLockRef.current = true;
            try {
              setActionLoading(true);
              if (targetMachineId) setActionUnitId(targetMachineId);
              setErrorMessage(null);

              const result = await releaseWashingMachineUnit(
                propertyId,
                targetMachineId
              );
              if (!result.ok) {
                throw new Error(result.error.message);
              }

              await cancelMyWashCompletionNotification(propertyId);
              await fetchStatus(false);
              showToast('Machine marked free for fellow residents');
            } catch (err: unknown) {
              const msg =
                err instanceof Error ? err.message : 'Could not mark machine free.';
              console.warn('[WashingMachine] Release error:', msg);
              Alert.alert('Error', msg);
              await fetchStatus(false);
            } finally {
              actionLockRef.current = false;
              if (isMountedRef.current) {
                setActionLoading(false);
                setActionUnitId(null);
              }
            }
          },
        },
      ]
    );
  };

  const handleJoinQueue = async () => {
    if (!propertyId || !queueEligible || inQueue || queueActionLockRef.current) {
      return;
    }
    queueActionLockRef.current = true;
    setQueueActionLoading(true);
    try {
      const busyList =
        inUseMachines.length > 0 ? inUseMachines : activeMachines;
      const earliest = busyList.reduce((best, curr) =>
        getRemainingWashSeconds(curr.started_at) <
        getRemainingWashSeconds(best.started_at)
          ? curr
          : best
      );
      const earliestRemainingSec = getRemainingWashSeconds(earliest.started_at);
      const triggerSeconds = Math.max(10, earliestRemainingSec);

      let notifId: string | null = null;
      if (Platform.OS !== 'web') {
        try {
          const { status } = await Notifications.getPermissionsAsync();
          let finalStatus = status;
          if (status !== 'granted') {
            const req = await Notifications.requestPermissionsAsync();
            finalStatus = req.status;
          }
          if (finalStatus === 'granted') {
            notifId = await Notifications.scheduleNotificationAsync({
              content: {
                title: `${earliest.machine_name} should be free soon`,
                body: 'The current wash cycle is finishing — check PGwala now.',
                data: { type: 'washing_machine' },
              },
              trigger: {
                type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
                seconds: triggerSeconds,
                repeats: false,
              },
            });
          }
        } catch {
          // Fall back to in-app queue state if local notifications fail
        }
      }

      if (!isMountedRef.current) return;
      setQueueState({ propertyId, joined: true, notifId });
      setQueueHydratedPropertyId(propertyId);
      await AsyncStorage.setItem(
        getQueueStorageKey(propertyId),
        JSON.stringify({ joined: true, notifId })
      ).catch(() => {});

      showToast("Joined queue — we'll notify you when a machine is free");
    } finally {
      queueActionLockRef.current = false;
      if (isMountedRef.current) {
        setQueueActionLoading(false);
      }
    }
  };

  const handleLeaveQueue = async () => {
    if (!propertyId || !inQueue || queueActionLockRef.current) {
      return;
    }
    queueActionLockRef.current = true;
    setQueueActionLoading(true);
    try {
      const existingNotifId = queueState.notifId;
      if (
        existingNotifId &&
        existingNotifId !== 'in_app_only' &&
        Platform.OS !== 'web'
      ) {
        await Notifications.cancelScheduledNotificationAsync(
          existingNotifId
        ).catch(() => {});
      }

      if (!isMountedRef.current) return;
      setQueueState({ propertyId, joined: false, notifId: null });
      await AsyncStorage.removeItem(getQueueStorageKey(propertyId)).catch(
        () => {}
      );
      showToast('Left washing machine queue');
    } finally {
      queueActionLockRef.current = false;
      if (isMountedRef.current) {
        setQueueActionLoading(false);
      }
    }
  };

  if (!propertyId) {
    return null;
  }

  const earliestBusyMachine =
    inUseMachines.length > 0
      ? inUseMachines.reduce((best, curr) =>
          formatCountdown(curr.started_at, nowMs).remainingSeconds <
          formatCountdown(best.started_at, nowMs).remainingSeconds
            ? curr
            : best
        )
      : null;
  const earliestWaitLabel = earliestBusyMachine
    ? formatCountdown(earliestBusyMachine.started_at, nowMs).label
    : null;

  const modalElement = (
    <MachineBookingModal
      visible={popupVisible}
      loading={loading}
      activeMachines={activeMachines}
      freeCount={freeMachines.length}
      inUseCount={inUseMachines.length}
      userRole={userRole}
      currentResidentId={currentResidentId}
      residentEnabled={residentEnabled}
      hasActiveSession={Boolean(myOccupiedMachine)}
      requestStatus={requestStatus}
      requestingAccess={requestingAccess}
      actionLoading={actionLoading}
      actionUnitId={actionUnitId}
      nowMs={nowMs}
      notifyMap={notifyMap}
      inQueue={inQueue}
      queueActionLoading={queueActionLoading}
      earliestWaitLabel={earliestWaitLabel}
      onClose={() => setPopupVisible(false)}
      onRequestAccess={handleRequestAccess}
      onStartUsing={handleStartUsing}
      onMarkFree={handleMarkFree}
      onToggleNotify={handleToggleNotify}
      onJoinQueue={() => void handleJoinQueue()}
      onLeaveQueue={() => void handleLeaveQueue()}
    />
  );

  // ---------------------------------------------------------------------------
  // COMPACT MODE (e.g. Embedded Side-by-Side in Student Dashboard)
  // ---------------------------------------------------------------------------
  if (compact) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Washing machine live usage popup"
        style={({ pressed }) => [
          styles.compactCard,
          style,
          pressed && styles.cardPressed,
        ]}
        onPress={() => setPopupVisible(true)}>
        {/* Top Header Row */}
        <View style={styles.compactHeaderRow}>
          <View
            style={[
              styles.compactIconWrap,
              isUserWashing
                ? styles.iconWrapActiveWash
                : !residentEnabled
                ? styles.iconWrapDisabled
                : hasFree
                ? styles.iconWrapFree
                : styles.iconWrapInUse,
            ]}>
            <Disc3 size={18} color={OwnerTheme.colors.primary} />
          </View>
          <View
            style={[
              styles.compactPill,
              isUserWashing
                ? styles.pillActiveWash
                : !residentEnabled
                ? styles.pillDisabled
                : hasFree
                ? styles.pillFree
                : styles.pillInUse,
            ]}>
            <Text
              style={[
                styles.compactPillText,
                isUserWashing
                  ? styles.textActiveWash
                  : !residentEnabled
                  ? styles.textDisabled
                  : hasFree
                  ? styles.textFree
                  : styles.textInUse,
              ]}>
              {loading
                ? '...'
                : isUserWashing
                ? toSentenceCaseStatus('your_wash')
                : !residentEnabled
                ? toSentenceCaseStatus('not_enabled')
                : hasFree
                ? `${freeMachines.length} free`
                : toSentenceCaseStatus('all_in_use')}
            </Text>
          </View>
        </View>

        {/* Card Title & Subtitle */}
        <View style={{ flex: 1, justifyContent: 'center', marginVertical: 4 }}>
          <Text style={styles.compactCardTitle} numberOfLines={1}>
            Washing Machines
          </Text>
          <Text style={styles.compactCardSubtitle} numberOfLines={2}>
            {loading
              ? 'Checking status...'
              : isUserWashing
              ? `In Wash: ${myOccupiedMachine?.machine_name || 'Unit'}`
              : !residentEnabled
              ? requestStatus === 'pending'
                ? 'Request pending approval'
                : 'Owner enablement required'
              : hasFree
              ? `${freeMachines.length} of ${activeMachines.length} available`
              : inQueue
              ? 'In queue • Notify when free'
              : 'All machines are currently busy'}
          </Text>
        </View>

        {/* Action Button Row */}
        {queueEligible && !inQueue ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Join washing machine queue"
            disabled={queueActionLoading}
            style={({ pressed }) => [
              styles.compactTouchPill,
              pressed && styles.btnPressed,
              queueActionLoading && styles.btnDisabled,
            ]}
            onPress={(e) => {
              e?.stopPropagation?.();
              void handleJoinQueue();
            }}>
            <Text style={styles.compactTouchPillText}>Join queue</Text>
            <ChevronRight size={13} color="#0284C7" />
          </Pressable>
        ) : (
          <View
            style={[
              styles.compactTouchPill,
              queueEligible && inQueue && styles.compactTouchPillQueued,
            ]}>
            <Text
              style={[
                styles.compactTouchPillText,
                queueEligible && inQueue && styles.compactTouchPillTextQueued,
              ]}>
              {isUserWashing
                ? 'Manage Wash'
                : !residentEnabled
                ? 'Request Access'
                : queueEligible && inQueue
                ? 'In queue'
                : 'Choose Machine'}
            </Text>
            <ChevronRight
              size={13}
              color={queueEligible && inQueue ? '#15803D' : '#0284C7'}
            />
          </View>
        )}

        {/* Attach the interactive popup modal */}
        {modalElement}
      </Pressable>
    );
  }

  // ---------------------------------------------------------------------------
  // FULL / EXPANDED MODE
  // ---------------------------------------------------------------------------
  return (
    <View style={styles.card}>
      {/* Header Row */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <View
            style={[
              styles.iconWrap,
              !residentEnabled
                ? styles.iconWrapDisabled
                : freeMachines.length > 0
                ? styles.iconWrapFree
                : styles.iconWrapInUse,
            ]}>
            <Disc3 size={20} color={OwnerTheme.colors.primary} />
          </View>
          <View>
            <View style={styles.titleRow}>
              <Text style={styles.cardTitle}>Washing Machines</Text>
              {isSubscribed && <View style={styles.liveDot} />}
            </View>
            <Text style={styles.cardSubtitle}>
              {loading
                ? 'Checking live availability...'
                : !residentEnabled
                ? 'Access requires owner enablement'
                : `${activeMachines.length} units installed • ${freeMachines.length} free`}
            </Text>
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open washing machines modal"
          style={styles.fullModeModalTrigger}
          onPress={() => setPopupVisible(true)}>
          <Text style={styles.fullModeModalTriggerText}>View All Units ›</Text>
        </Pressable>
      </View>

      {/* Access Control Notice for Un-enabled Residents */}
      {userRole === 'student' && !residentEnabled && !loading && (
        <View style={styles.notEnabledNotice}>
          <Text style={styles.notEnabledTitle}>Washing Machine Access Disabled</Text>
          <Text style={styles.notEnabledSub}>
            Only residents authorized by the PG owner can use the washing machines (fee: ₹500/month added to rent).
          </Text>

          {requestStatus === 'pending' ? (
            <View style={styles.pendingCard}>
              <Text style={styles.pendingText}>
                ⏳ Your access request is currently pending owner approval in billing.
              </Text>
            </View>
          ) : (
            <Pressable
              style={({ pressed }) => [
                styles.requestAccessBtn,
                pressed && styles.btnPressed,
                requestingAccess && styles.btnDisabled,
              ]}
              disabled={requestingAccess}
              onPress={handleRequestAccess}>
              {requestingAccess ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.requestAccessBtnText}>
                  Request Access from Owner
                </Text>
              )}
            </Pressable>
          )}
        </View>
      )}

      {/* Content Area */}
      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="small" color="#0284C7" />
          <Text style={styles.loadingText}>Fetching status...</Text>
        </View>
      ) : errorMessage && machines.length === 0 ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{errorMessage}</Text>
          <Pressable style={styles.retryBtn} onPress={() => fetchStatus(true)}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.contentBox}>
          {activeMachines.map((m) => (
            <MachineSlotRow
              key={m.id}
              unit={m}
              variant="full"
              userRole={userRole}
              currentResidentId={currentResidentId}
              residentEnabled={residentEnabled}
              hasActiveSession={Boolean(myOccupiedMachine)}
              actionLoading={actionLoading}
              actionUnitId={actionUnitId}
              nowMs={nowMs}
              isNotified={Boolean(notifyMap[m.id])}
              onStartUsing={handleStartUsing}
              onMarkFree={handleMarkFree}
              onToggleNotify={handleToggleNotify}
              onRequestAccess={handleRequestAccess}
            />
          ))}
        </View>
      )}

      {/* Attach Modal to full mode as well */}
      {modalElement}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    marginVertical: 6,
  },
  compactCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
    justifyContent: 'space-between',
    minHeight: 140,
  },
  cardPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  compactHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  compactIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  compactPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  compactPillText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  compactCardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  compactCardSubtitle: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
    lineHeight: 15,
  },
  compactTouchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F0F9FF',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: '#BAE6FD',
    marginTop: 4,
  },
  compactTouchPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0284C7',
  },
  compactTouchPillQueued: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  compactTouchPillTextQueued: {
    color: '#15803D',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconWrapFree: {
    backgroundColor: '#DCFCE7',
  },
  iconWrapInUse: {
    backgroundColor: '#FEF3C7',
  },
  iconWrapActiveWash: {
    backgroundColor: '#E0F2FE',
  },
  iconWrapDisabled: {
    backgroundColor: '#F1F5F9',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#16A34A',
  },
  cardSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  fullModeModalTrigger: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: '#F0F9FF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  fullModeModalTriggerText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0284C7',
  },
  pillFree: {
    backgroundColor: '#DCFCE7',
  },
  pillInUse: {
    backgroundColor: '#FEF3C7',
  },
  pillActiveWash: {
    backgroundColor: '#E0F2FE',
  },
  pillDisabled: {
    backgroundColor: '#F1F5F9',
  },
  textFree: {
    color: '#16A34A',
  },
  textInUse: {
    color: '#D97706',
  },
  textActiveWash: {
    color: '#0284C7',
  },
  textDisabled: {
    color: '#64748B',
  },
  notEnabledNotice: {
    backgroundColor: '#FFFBEB',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#FDE68A',
    marginBottom: 12,
  },
  notEnabledTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#92400E',
    marginBottom: 4,
  },
  notEnabledSub: {
    fontSize: 11,
    color: '#78350F',
    lineHeight: 16,
    marginBottom: 8,
  },
  requestAccessBtn: {
    backgroundColor: '#D97706',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  requestAccessBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  pendingCard: {
    backgroundColor: '#FEF3C7',
    padding: 8,
    borderRadius: 6,
  },
  pendingText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#B45309',
  },
  contentBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 8,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    gap: 8,
  },
  loadingBox: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 6,
  },
  errorBox: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  errorText: {
    fontSize: 12,
    color: '#DC2626',
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#0284C7',
    borderRadius: 6,
  },
  retryBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  btnPressed: {
    opacity: 0.8,
  },
  btnDisabled: {
    opacity: 0.5,
  },
});
