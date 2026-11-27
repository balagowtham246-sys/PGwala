import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DarkSlateHeroCard } from '@/components/ui/dark-slate-hero-card';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Href, router, useLocalSearchParams } from 'expo-router';
import {
  Calendar,
  LogIn,
  LogOut,
  MessageCircle,
  Search,
  X,
} from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';

import { GateHistoryModal } from '@/components/student-gate/GateHistoryModal';
import { CalendarDatePickerModal } from '@/components/ui/calendar-date-picker-modal';
import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useProperty } from '@/context/property-context';
import { useToast } from '@/context/toast-context';
import {
  MovementLogItem,
  MovementResidentRecord,
  useOwnerMovementQuery,
} from '@/hooks/use-movement';
import { RoleBottomNav } from '@/components/ui/bottom-nav';
import { buildWhatsAppReminderUrl } from '@/lib/billing-utils';
import {
  formatShortReturnDate,
  groupLogsByLocalDay,
  isLateReturn,
  isLeaveOverdue,
  isOnMultiDayLeave,
} from '@/lib/movement-utils';
import { queryKeys } from '@/lib/query-keys';
import { broadcastPropertySync } from '@/lib/realtime-sync';
import { supabase } from '@/lib/supabase';
import {
  addDaysToIsoDate,
  formatGateEventTimestamp,
  formatLocalIsoDate,
  toSentenceCaseStatus,
} from '@/lib/ux-utils';
import {
  OwnerHeader,
  StatusBadge,
  SegmentedFilter,
  EmptyState,
  ErrorState,
} from '@/components/ui/owner';

// --- Types ---
export type ResidentStatus = 'IN' | 'OUT';

export type ResidentRecord = MovementResidentRecord;
export type MovementLogRecord = MovementLogItem;

function formatEventTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return isoString;
  }
}

export default function StudentInOutScreen() {
  const { user } = useAuth();
  const { selectedProperty, selectedPropertyId } = useProperty();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ residentId?: string | string[] }>();
  const rawParamResidentId = Array.isArray(params.residentId)
    ? params.residentId[0]
    : params.residentId;
  const paramResidentId = rawParamResidentId?.trim() || null;

  const userId = user?.id;
  const activeSelectedPropertyId = selectedPropertyId;
  const activeSelectedPropertyName = selectedProperty?.name;

  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [togglingResidentId, setTogglingResidentId] = useState<string | null>(
    null
  );
  const [leaveTargetResident, setLeaveTargetResident] =
    useState<MovementResidentRecord | null>(null);

  const handleOwnerMarkLeave = useCallback(
    async (resident: MovementResidentRecord, returnDateIso: string) => {
      if (!userId || togglingResidentId) return;
      setTogglingResidentId(resident.id);
      try {
        const { error } = await supabase.from('movement_logs').insert({
          property_id: resident.property_id,
          resident_id: resident.id,
          direction: 'OUT',
          event_time: new Date().toISOString(),
          purpose: 'Home Visit',
          expected_return_time: `Returns ${formatShortReturnDate(returnDateIso)}`,
          expected_return_date: returnDateIso,
          food_required: false,
          note: 'Marked on leave by owner',
          recorded_by: userId,
        });
        if (error) throw error;
        broadcastPropertySync('movement', resident.property_id);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.movement.all }),
          queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
          queryClient.invalidateQueries({ queryKey: queryKeys.residents.all }),
        ]);
        showToast(
          `${resident.full_name} marked On Leave until ${formatShortReturnDate(returnDateIso)}.`
        );
      } catch (err) {
        Alert.alert(
          'Update Failed',
          err instanceof Error
            ? err.message
            : 'Could not mark resident on leave.'
        );
      } finally {
        setTogglingResidentId(null);
      }
    },
    [queryClient, showToast, togglingResidentId, userId]
  );

  const handleOwnerToggleGate = useCallback(
    async (resident: MovementResidentRecord, currentlyInside: boolean) => {
      if (!userId || togglingResidentId) return;
      const nextDirection: 'IN' | 'OUT' = currentlyInside ? 'OUT' : 'IN';
      setTogglingResidentId(resident.id);
      try {
        const { error } = await supabase.from('movement_logs').insert({
          property_id: resident.property_id,
          resident_id: resident.id,
          direction: nextDirection,
          event_time: new Date().toISOString(),
          food_required: nextDirection === 'IN',
          note: 'Updated by owner',
          recorded_by: userId,
        });
        if (error) throw error;
        broadcastPropertySync('movement', resident.property_id);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.movement.all }),
          queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
        ]);
        showToast(
          `${resident.full_name} marked ${
            nextDirection === 'IN' ? 'Inside PG' : 'Outside PG'
          }.`
        );
      } catch (err) {
        Alert.alert(
          'Update Failed',
          err instanceof Error
            ? err.message
            : 'Could not update gate status.'
        );
      } finally {
        setTogglingResidentId(null);
      }
    },
    [queryClient, showToast, togglingResidentId, userId]
  );
  const [clearedResidentId, setClearedResidentId] = useState<string | null>(
    null
  );

  useEffect(() => {
    if (paramResidentId) return;
    const timer = setTimeout(() => {
      setClearedResidentId(null);
    }, 0);
    return () => clearTimeout(timer);
  }, [paramResidentId]);

  const activeResidentFilterId =
    paramResidentId && paramResidentId !== clearedResidentId
      ? paramResidentId
      : null;

  const handleClearResidentFilter = () => {
    setClearedResidentId(paramResidentId);
    try {
      router.setParams({ residentId: undefined });
    } catch {
      // Non-fatal in pager context
    }
  };

  // Filter Tabs & Search
  type FilterTab = 'ALL' | 'OUT' | 'ON_LEAVE' | 'IN' | 'LATE';
  const [activeTab, setActiveTab] = useState<FilterTab>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Full History Modal state
  const [fullHistoryVisible, setFullHistoryVisible] = useState(false);
  const [historyDirectionFilter, setHistoryDirectionFilter] = useState<
    'ALL' | 'IN' | 'OUT'
  >('ALL');
  const [historyDateFilter, setHistoryDateFilter] = useState<
    'ALL' | 'TODAY' | 'WEEK'
  >('ALL');

  const movementQuery = useOwnerMovementQuery({
    userId,
    selectedPropertyId: activeSelectedPropertyId,
    selectedPropertyName: activeSelectedPropertyName,
  });

  const snapshot = movementQuery.data;
  const loading = movementQuery.isPending && !snapshot;
  const refreshing = manualRefreshing;
  const propertyName =
    snapshot?.propertyName ?? activeSelectedPropertyName ?? 'My PG';
  const residents = useMemo(
    () => snapshot?.activeResidents ?? [],
    [snapshot?.activeResidents]
  );
  const allResidents = useMemo(
    () => snapshot?.allResidents ?? [],
    [snapshot?.allResidents]
  );
  const logs = useMemo(() => snapshot?.logs ?? [], [snapshot?.logs]);
  const errorMessage = movementQuery.isError
    ? movementQuery.error.message
    : null;
  const referenceTimeMs = snapshot?.fetchedAtMs ?? 0;

  const handleRefresh = async () => {
    setManualRefreshing(true);
    try {
      await movementQuery.refetch();
    } finally {
      setManualRefreshing(false);
    }
  };

  const loadData = () => {
    void movementQuery.refetch();
  };

  const latestLogByResident = useMemo(() => {
    const map = new Map<string, MovementLogRecord>();
    for (const l of logs) {
      if (!map.has(l.resident_id)) {
        map.set(l.resident_id, l);
      }
    }
    return map;
  }, [logs]);

  const getLatestResidentLog = useCallback(
    (residentId: string): MovementLogRecord | undefined => {
      return latestLogByResident.get(residentId);
    },
    [latestLogByResident]
  );

  const getResidentCurrentStatus = useCallback(
    (residentId: string): ResidentStatus => {
      const latest = latestLogByResident.get(residentId);
      return latest ? latest.direction : 'IN';
    },
    [latestLogByResident]
  );

  // Live count derivation (memoized)
  const { counts, outsideMealsCount, lateReturnCount } = useMemo(() => {
    let inside = 0;
    let outsideDay = 0;
    let onLeave = 0;
    let outsideMeals = 0;
    let late = 0;

    for (const r of residents) {
      const status = getResidentCurrentStatus(r.id);
      if (status === 'IN') {
        inside += 1;
      } else {
        const latest = getLatestResidentLog(r.id);
        const residentOnLeave = isOnMultiDayLeave(latest);
        if (residentOnLeave) {
          onLeave += 1;
        } else {
          outsideDay += 1;
          if (latest?.food_required) {
            outsideMeals += 1;
          }
        }
        if (
          latest &&
          isLateReturn(
            latest.expected_return_time,
            undefined,
            latest.expected_return_date
          )
        ) {
          late += 1;
        }
      }
    }

    return {
      counts: {
        inside,
        outsideDay,
        onLeave,
        outside: outsideDay + onLeave,
      },
      outsideMealsCount: outsideMeals,
      lateReturnCount: late,
    };
  }, [residents, getResidentCurrentStatus, getLatestResidentLog]);

  const mealsRequiredCount = counts.inside + outsideMealsCount;

  const effectiveTab: FilterTab =
    activeTab === 'LATE' && lateReturnCount === 0
      ? 'ALL'
      : activeTab === 'ON_LEAVE' && counts.onLeave === 0
        ? 'ALL'
        : activeTab;

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredResidents = useMemo(
    () =>
      residents.filter((r) => {
        if (activeResidentFilterId && r.id !== activeResidentFilterId) return false;
        const status = getResidentCurrentStatus(r.id);
        const latest = getLatestResidentLog(r.id);
        const residentOnLeave = isOnMultiDayLeave(latest);
        if (effectiveTab === 'OUT' && (status !== 'OUT' || residentOnLeave)) return false;
        if (effectiveTab === 'ON_LEAVE' && !residentOnLeave) return false;
        if (effectiveTab === 'IN' && status !== 'IN') return false;
        if (effectiveTab === 'LATE') {
          if (
            status !== 'OUT' ||
            !latest ||
            !isLateReturn(
              latest.expected_return_time,
              undefined,
              latest.expected_return_date
            )
          ) {
            return false;
          }
        }
        if (normalizedSearch) {
          const matchesName = r.full_name.toLowerCase().includes(normalizedSearch);
          const matchesRoom = r.room_number.toLowerCase().includes(normalizedSearch);
          return matchesName || matchesRoom;
        }
        return true;
      }),
    [
      residents,
      activeResidentFilterId,
      effectiveTab,
      normalizedSearch,
      getResidentCurrentStatus,
      getLatestResidentLog,
    ]
  );

  const handleWhatsAppCheckIn = useCallback(
    (resident: MovementResidentRecord, isLate: boolean, expectedReturn?: string | null) => {
      const message = isLate
        ? `Hi ${resident.full_name}, this is a quick safety check-in from ${propertyName}. Your expected return time${expectedReturn ? ` (${expectedReturn})` : ''} has passed — please confirm when you will be back at the PG.`
        : `Hi ${resident.full_name}, quick check-in from ${propertyName}. Hope everything is well — please let us know your expected return time.`;
      const waUrl = buildWhatsAppReminderUrl(resident.phone_number, message);
      if (!waUrl) {
        Alert.alert('No Phone Number', 'This resident does not have a valid phone number on file.');
        return;
      }
      Linking.openURL(waUrl).catch(() => {
        Alert.alert('WhatsApp Unavailable', 'Could not open WhatsApp on this device.');
      });
    },
    [propertyName]
  );

  const residentMap = useMemo(() => {
    const map = new Map<string, ResidentRecord>();
    for (const r of allResidents) {
      map.set(r.id, r);
    }
    return map;
  }, [allResidents]);

  const filteredResidentName = useMemo(() => {
    if (!activeResidentFilterId) return '';
    return residentMap.get(activeResidentFilterId)?.full_name || 'Resident';
  }, [activeResidentFilterId, residentMap]);

  const scopedLogs = useMemo(() => {
    if (!activeResidentFilterId) return logs;
    return logs.filter((l) => l.resident_id === activeResidentFilterId);
  }, [logs, activeResidentFilterId]);

  // Full history filtered list
  const filteredHistoryLogs = useMemo(() => {
    const today = new Date(referenceTimeMs).toDateString();
    const oneWeekAgo = referenceTimeMs - 7 * 24 * 60 * 60 * 1000;

    return scopedLogs.filter((log) => {
      if (
        historyDirectionFilter !== 'ALL' &&
        log.direction !== historyDirectionFilter
      ) {
        return false;
      }
      if (historyDateFilter === 'TODAY') {
        const logDate = new Date(log.event_time).toDateString();
        if (logDate !== today) return false;
      } else if (historyDateFilter === 'WEEK') {
        const logTime = new Date(log.event_time).getTime();
        if (logTime < oneWeekAgo) return false;
      }
      return true;
    });
  }, [scopedLogs, historyDirectionFilter, historyDateFilter, referenceTimeMs]);

  const renderResidentItem = useCallback(
    ({ item: resident }: { item: MovementResidentRecord }) => {
      const currentStatus = getResidentCurrentStatus(resident.id);
      const latestLog = getLatestResidentLog(resident.id);
      const isInside = currentStatus === 'IN';
      const isOutside = currentStatus === 'OUT';
      const onLeave = isOnMultiDayLeave(latestLog);
      const leaveOverdue = onLeave && isLeaveOverdue(latestLog?.expected_return_date);
      const isLate = Boolean(
        isOutside &&
          latestLog &&
          isLateReturn(
            latestLog.expected_return_time,
            undefined,
            latestLog.expected_return_date
          )
      );

      const initials = resident.full_name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0]?.toUpperCase() ?? '')
        .join('') || 'R';

      return (
        <View
          style={[
            styles.residentCard,
            isLate && styles.residentCardLate,
          ]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open profile for ${resident.full_name}`}
            style={({ pressed }) => [pressed && styles.cardPressed]}
            onPress={() =>
              router.push({
                pathname: '/resident-profile',
                params: { id: resident.id },
              } as Href)
            }>
            <View style={styles.residentCardHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, paddingRight: 8 }}>
                <View
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 17,
                    backgroundColor: isLate
                      ? '#FEE2E2'
                      : isInside
                        ? '#DCFCE7'
                        : onLeave
                          ? '#EDE9FE'
                          : '#FEF3C7',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: '800',
                      color: isLate
                        ? '#B91C1C'
                        : isInside
                          ? '#15803D'
                          : onLeave
                            ? '#6D28D9'
                            : '#B45309',
                    }}>
                    {initials}
                  </Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.residentName} numberOfLines={1}>
                    {resident.full_name}
                  </Text>
                  <Text style={styles.residentRoom} numberOfLines={1}>
                    Room {resident.room_number}
                    {latestLog
                      ? ` · ${isInside ? 'In' : onLeave ? 'On leave' : 'Out'} ${formatGateEventTimestamp(latestLog.event_time)}`
                      : ' · No gate logs yet'}
                  </Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                {isLate && (
                  <StatusBadge
                    label={leaveOverdue ? 'Overdue' : toSentenceCaseStatus('late')}
                    variant="danger"
                    size="sm"
                  />
                )}
                {onLeave ? (
                  <View
                    style={{
                      backgroundColor: '#EDE9FE',
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                      borderRadius: 999,
                    }}>
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: '700',
                        color: '#6D28D9',
                      }}>
                      On Leave
                    </Text>
                  </View>
                ) : (
                  <StatusBadge
                    label={toSentenceCaseStatus(isInside ? 'inside' : 'outside')}
                    variant={isInside ? 'success' : 'warning'}
                    size="sm"
                  />
                )}
              </View>
            </View>

            {/* Compact Modern Metadata Chips */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
              {isOutside && latestLog?.purpose ? (
                <View style={{ backgroundColor: '#F1F5F9', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                  <Text style={{ fontSize: 11, fontWeight: '600', color: '#334155' }}>
                    {latestLog.purpose}
                  </Text>
                </View>
              ) : null}
              {onLeave && latestLog?.expected_return_date ? (
                <View
                  style={{
                    backgroundColor: leaveOverdue ? '#FEE2E2' : '#EDE9FE',
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                    borderRadius: 6,
                  }}>
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: '700',
                      color: leaveOverdue ? '#B91C1C' : '#6D28D9',
                    }}>
                    Returns {formatShortReturnDate(latestLog.expected_return_date)}
                  </Text>
                </View>
              ) : isOutside && latestLog?.expected_return_time ? (
                <View
                  style={{
                    backgroundColor: isLate ? '#FEE2E2' : '#F1F5F9',
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                    borderRadius: 6,
                  }}>
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: '600',
                      color: isLate ? '#B91C1C' : '#334155',
                    }}>
                    ETA {latestLog.expected_return_time}
                  </Text>
                </View>
              ) : null}
              <View
                style={{
                  backgroundColor:
                    isInside || (!onLeave && latestLog?.food_required)
                      ? '#DCFCE7'
                      : '#F1F5F9',
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  borderRadius: 6,
                }}>
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: '600',
                    color:
                      isInside || (!onLeave && latestLog?.food_required)
                        ? '#15803D'
                        : '#64748B',
                  }}>
                  {onLeave
                    ? 'Meals: Paused'
                    : `Dinner: ${isInside || latestLog?.food_required ? 'Yes' : 'No'}`}
                </Text>
              </View>
            </View>
          </Pressable>

          {/* Owner Actions: Mark Leave for inside residents, WhatsApp + Mark In for outside/on-leave */}
          {isInside ? (
            <View style={styles.cardActionRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Mark ${resident.full_name} on multi-day leave`}
                disabled={togglingResidentId === resident.id}
                style={({ pressed }) => [
                  styles.ownerOverrideBtn,
                  {
                    backgroundColor: '#FAF5FF',
                    borderColor: '#DDD6FE',
                  },
                  togglingResidentId === resident.id && { opacity: 0.6 },
                  pressed && styles.cardPressed,
                ]}
                onPress={() => setLeaveTargetResident(resident)}>
                <Calendar size={14} color="#6D28D9" />
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#6D28D9' }}>
                  Mark Leave
                </Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.cardActionRow}>
              {(resident.phone_number ?? '').replace(/\D/g, '').length >= 10 && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Send WhatsApp safety check-in to ${resident.full_name}`}
                  style={({ pressed }) => [
                    styles.checkInBtn,
                    { flex: 1, marginTop: 0 },
                    isLate && styles.checkInBtnLate,
                    pressed && styles.cardPressed,
                  ]}
                  onPress={() =>
                    handleWhatsAppCheckIn(
                      resident,
                      isLate,
                      latestLog?.expected_return_time
                    )
                  }>
                  <MessageCircle
                    size={14}
                    color={isLate ? '#B91C1C' : '#15803D'}
                  />
                  <Text
                    style={[
                      styles.checkInBtnText,
                      isLate && styles.checkInBtnTextLate,
                    ]}
                    numberOfLines={1}>
                    {isLate ? 'Late Check-In' : 'WhatsApp'}
                  </Text>
                </Pressable>
              )}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Mark ${resident.full_name} inside`}
                disabled={togglingResidentId === resident.id}
                style={({ pressed }) => [
                  styles.ownerOverrideBtn,
                  styles.ownerOverrideBtnIn,
                  togglingResidentId === resident.id && { opacity: 0.6 },
                  pressed && styles.cardPressed,
                ]}
                onPress={() => void handleOwnerToggleGate(resident, false)}>
                {togglingResidentId === resident.id ? (
                  <ActivityIndicator size="small" color="#047857" />
                ) : (
                  <>
                    <LogIn size={14} color="#047857" />
                    <Text style={styles.ownerOverrideBtnTextIn}>Mark In</Text>
                  </>
                )}
              </Pressable>
            </View>
          )}
        </View>
      );
    },
    [
      getResidentCurrentStatus,
      getLatestResidentLog,
      handleWhatsAppCheckIn,
      handleOwnerToggleGate,
      togglingResidentId,
    ]
  );

  const residentKeyExtractor = useCallback((item: MovementResidentRecord) => item.id, []);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <OwnerHeader
        title="Gate Attendance"
        subtitle={propertyName}
      />

      <FlatList
        data={loading ? [] : filteredResidents}
        keyExtractor={residentKeyExtractor}
        renderItem={renderResidentItem}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={[OwnerTheme.colors.primary]}
          />
        }
        ListHeaderComponent={
          <View>
            {errorMessage && (
              <ErrorState message={errorMessage} onRetry={loadData} />
            )}

            {/* Dark-Slate Gate Attendance Hero */}
            <DarkSlateHeroCard
              eyebrow="LIVE GATE ATTENDANCE"
              title={`${counts.inside} of ${counts.inside + counts.outside} inside PG`}
              subtitle={`${mealsRequiredCount} dinner meals (${counts.inside} in + ${outsideMealsCount} out)${counts.onLeave > 0 ? ` · ${counts.onLeave} on leave` : ''}`}
              badgeLabel={
                lateReturnCount > 0
                  ? `${lateReturnCount} late`
                  : counts.onLeave > 0
                    ? `${counts.onLeave} on leave`
                    : counts.outsideDay > 0
                      ? `${counts.outsideDay} outside`
                      : 'All inside'
              }
              badgeTone={
                lateReturnCount > 0
                  ? 'danger'
                  : counts.outside > 0
                    ? 'warning'
                    : 'success'
              }
              stats={[
                { label: 'Inside', value: counts.inside, tone: 'success' },
                {
                  label: counts.onLeave > 0 ? 'On Leave' : 'Outside',
                  value: counts.onLeave > 0 ? counts.onLeave : counts.outsideDay,
                  tone: counts.outside > 0 ? 'warning' : 'default',
                },
                { label: 'Dinner', value: mealsRequiredCount, tone: 'info' },
              ]}
            />

            {/* Late Return Alert Strip (only shown when overdue returns exist) */}
            {lateReturnCount > 0 && (
              <View style={styles.lateAlertRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    effectiveTab === 'LATE'
                      ? 'Showing late returns, tap to show all'
                      : `Filter ${lateReturnCount} late return${lateReturnCount > 1 ? 's' : ''}`
                  }
                  style={({ pressed }) => [
                    styles.lateChip,
                    effectiveTab === 'LATE' && styles.lateChipActive,
                    pressed && styles.cardPressed,
                  ]}
                  onPress={() =>
                    setActiveTab((prev) => (prev === 'LATE' ? 'ALL' : 'LATE'))
                  }>
                  <Text
                    style={[
                      styles.lateChipText,
                      effectiveTab === 'LATE' && styles.lateChipTextActive,
                    ]}>
                    {lateReturnCount} late return{lateReturnCount > 1 ? 's' : ''} ·{' '}
                    {effectiveTab === 'LATE' ? 'Showing' : 'Tap to filter'}
                  </Text>
                </Pressable>
              </View>
            )}

            {/* Resident Filter Banner */}
            {activeResidentFilterId && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Filtered to ${filteredResidentName}. Show all`}
                style={({ pressed }) => [
                  styles.residentFilterBanner,
                  pressed && styles.cardPressed,
                ]}
                onPress={handleClearResidentFilter}>
                <Text style={styles.residentFilterBannerText} numberOfLines={1}>
                  Filtered to {filteredResidentName} ·{' '}
                  <Text style={styles.residentFilterBannerAction}>Show all</Text>
                </Text>
                <X size={15} color={OwnerTheme.colors.primary} />
              </Pressable>
            )}

            {/* Filter Segmented Control */}
            <SegmentedFilter
              options={[
                { key: 'ALL', label: 'All', count: residents.length },
                { key: 'OUT', label: 'Outside', count: counts.outsideDay },
                ...(counts.onLeave > 0
                  ? [{ key: 'ON_LEAVE', label: 'On Leave', count: counts.onLeave }]
                  : []),
                { key: 'IN', label: 'Inside', count: counts.inside },
                ...(lateReturnCount > 0
                  ? [{ key: 'LATE', label: 'Late', count: lateReturnCount }]
                  : []),
              ]}
              activeKey={effectiveTab}
              onSelect={(key) => setActiveTab(key as FilterTab)}
              style={{ marginTop: 14, marginBottom: 10 }}
            />

            {/* Live Resident Search Bar */}
            <View style={styles.searchBarWrap}>
              <Search size={16} color={OwnerTheme.colors.textMuted} />
              <TextInput
                style={styles.searchInput}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search by name or room..."
                placeholderTextColor={OwnerTheme.colors.textMuted}
                returnKeyType="search"
                autoCorrect={false}
              />
              {searchQuery.length > 0 && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  hitSlop={8}
                  onPress={() => setSearchQuery('')}>
                  <X size={16} color={OwnerTheme.colors.textSecondary} />
                </Pressable>
              )}
            </View>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="small" color={OwnerTheme.colors.primary} />
              <Text style={styles.loadingText}>Loading attendance roster...</Text>
            </View>
          ) : normalizedSearch ? (
            <EmptyState
              title="No matching residents"
              description={`No residents match "${searchQuery.trim()}".`}
              actionLabel="Clear search"
              onAction={() => setSearchQuery('')}
            />
          ) : activeResidentFilterId ? (
            <EmptyState
              title="No matching resident in this filter"
              description={`Switch tabs or show all residents to view the full roster.`}
              actionLabel="Show all"
              onAction={handleClearResidentFilter}
            />
          ) : (
            <EmptyState
              title="No residents found"
              description={
                effectiveTab === 'LATE'
                  ? 'No residents are currently past their expected return time.'
                  : effectiveTab === 'ON_LEAVE'
                  ? 'No residents are currently on multi-day leave.'
                  : effectiveTab === 'OUT'
                  ? 'No residents are currently marked outside.'
                  : effectiveTab === 'IN'
                  ? 'No residents are currently marked inside.'
                  : 'No active residents registered in this property.'
              }
            />
          )
        }
        ListFooterComponent={
          <View>
            {/* Recent Event History Section (Latest 3 events) */}
            <View style={styles.historySectionHeader}>
              <Text style={styles.historySectionTitle}>Recent Event History</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setFullHistoryVisible(true);
                }}>
                <Text style={styles.viewAllText}>View All ›</Text>
              </Pressable>
            </View>

            <View style={styles.historyCard}>
              {loading ? (
                <View style={{ padding: 16, alignItems: 'center' }}>
                  <ActivityIndicator size="small" color={OwnerTheme.colors.primary} />
                </View>
              ) : scopedLogs.length === 0 ? (
                <EmptyState
                  title="No movement records"
                  description="When residents check in or out, records will appear here."
                />
              ) : (
                groupLogsByLocalDay(scopedLogs.slice(0, 3)).map((group) => (
                  <View key={group.dateKey}>
                    <Text style={styles.historyDayLabel}>{group.dateTitle}</Text>
                    {group.items.map((item, index) => {
                      const resident = residentMap.get(item.resident_id);
                      const isEntry = item.direction === 'IN';
                      return (
                        <View
                          key={item.id}
                          style={[
                            styles.historyItemRow,
                            index === group.items.length - 1 && {
                              borderBottomWidth: 0,
                            },
                          ]}>
                          <View
                            style={[
                              styles.historyItemIcon,
                              {
                                backgroundColor: isEntry
                                  ? OwnerTheme.colors.successLight
                                  : OwnerTheme.colors.warningLight,
                              },
                            ]}>
                            {isEntry ? (
                              <LogIn size={15} color={OwnerTheme.colors.success} />
                            ) : (
                              <LogOut size={15} color={OwnerTheme.colors.warning} />
                            )}
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.historyItemName}>
                              {resident ? resident.full_name : 'Resident'}{' '}
                              {resident ? `(Room ${resident.room_number})` : ''}
                            </Text>
                            <Text style={styles.historyItemSub}>
                              {isEntry ? 'Checked in' : 'Checked out'}
                              {item.purpose ? ` • ${item.purpose}` : ''}
                            </Text>
                          </View>
                          <Text style={styles.historyItemTime}>
                            {formatEventTime(item.event_time)}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                ))
              )}
            </View>

            <View style={{ height: 40 }} />
          </View>
        }
      />

      <GateHistoryModal
        visible={fullHistoryVisible}
        historyDirectionFilter={historyDirectionFilter}
        historyDateFilter={historyDateFilter}
        filteredHistoryLogs={filteredHistoryLogs}
        residentMap={residentMap}
        onSelectDirection={setHistoryDirectionFilter}
        onSelectTimeframe={setHistoryDateFilter}
        onClose={() => setFullHistoryVisible(false)}
      />

      <CalendarDatePickerModal
        visible={Boolean(leaveTargetResident)}
        value={addDaysToIsoDate(formatLocalIsoDate(), 2)}
        title={
          leaveTargetResident
            ? `Return Date · ${leaveTargetResident.full_name}`
            : 'Expected Return Date'
        }
        onSelect={(iso) => {
          const target = leaveTargetResident;
          setLeaveTargetResident(null);
          if (target) {
            void handleOwnerMarkLeave(target, iso);
          }
        }}
        onClose={() => setLeaveTargetResident(null)}
      />

      <RoleBottomNav activeTab="gate" roleOverride="owner" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: OwnerTheme.colors.background,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    maxWidth: 960,
    width: '100%',
    alignSelf: 'center',
  },
  headerAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: OwnerTheme.radius.full,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
  },
  headerAddBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.primary,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  lateAlertRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  lateChip: {
    backgroundColor: '#FEE2E2',
    borderRadius: OwnerTheme.radius.full,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  lateChipActive: {
    backgroundColor: '#DC2626',
    borderColor: '#B91C1C',
  },
  lateChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#B91C1C',
  },
  lateChipTextActive: {
    color: '#FFFFFF',
  },
  checkInBtn: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: OwnerTheme.radius.sm,
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  checkInBtnLate: {
    backgroundColor: '#FEE2E2',
    borderColor: '#FECACA',
  },
  checkInBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#15803D',
  },
  checkInBtnTextLate: {
    color: '#B91C1C',
  },
  residentFilterBanner: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    backgroundColor: OwnerTheme.colors.primaryLight,
    borderWidth: 1,
    borderColor: '#BAE6FD',
    borderRadius: OwnerTheme.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  residentFilterBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: OwnerTheme.colors.textPrimary,
  },
  residentFilterBannerAction: {
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  searchBarWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    borderRadius: OwnerTheme.radius.md,
    paddingHorizontal: 12,
    height: 44,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: OwnerTheme.colors.textPrimary,
    paddingVertical: 0,
  },
  residentCardLate: {
    borderColor: '#FCA5A5',
    backgroundColor: '#FEF2F2',
  },
  residentsList: {
    gap: 10,
    marginBottom: 20,
  },
  residentCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 14,
  },
  cardPressed: {
    opacity: 0.88,
  },
  residentCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  residentName: {
    fontSize: 16,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  residentRoom: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 2,
  },
  detailsBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: OwnerTheme.radius.sm,
    padding: 10,
    gap: 6,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    fontSize: 13,
    color: OwnerTheme.colors.textSecondary,
  },
  detailValue: {
    fontSize: 13,
    color: OwnerTheme.colors.textPrimary,
  },
  detailValueBold: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  dinnerText: {
    fontSize: 13,
    fontWeight: '600',
  },
  historySectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 10,
  },
  historySectionTitle: {
    ...OwnerTheme.typography.sectionHeading,
  },
  viewAllText: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.primary,
  },
  historyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  historyDayLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: OwnerTheme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    paddingTop: 10,
    paddingBottom: 2,
  },
  historyItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: OwnerTheme.colors.borderLight,
  },
  historyItemIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  historyItemName: {
    fontSize: 14,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  historyItemSub: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 2,
  },
  historyItemTime: {
    fontSize: 12,
    color: OwnerTheme.colors.textMuted,
  },
  loadingBox: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 8,
    fontSize: 13,
    color: OwnerTheme.colors.textSecondary,
  },
  cardActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  ownerOverrideBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: OwnerTheme.radius.sm,
    borderWidth: 1,
  },
  ownerOverrideBtnIn: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  ownerOverrideBtnOut: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  ownerOverrideBtnTextIn: {
    fontSize: 12,
    fontWeight: '700',
    color: '#047857',
  },
  ownerOverrideBtnTextOut: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B45309',
  },
});
