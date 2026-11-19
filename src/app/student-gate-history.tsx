import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DoorOpen, HelpCircle, Home, LogOut } from 'lucide-react-native';
import { RoleBottomNav } from '@/components/ui/bottom-nav';
import { GoingOutModal, GoingOutSubmitPayload } from '@/components/going-out-modal';
import { BottomTabInset } from '@/constants/theme';
import {
  countDaysOutThisMonth,
  groupLogsByLocalDay,
  isOutOverHours,
} from '@/lib/movement-utils';
import { triggerLightHaptic, triggerSuccessHaptic } from '@/lib/haptics';
import { router } from 'expo-router';

import { useAuth } from '@/context/auth-context';
import { supabase } from '@/lib/supabase';

interface StudentResident {
  id: string;
  property_id: string;
  full_name: string;
  room_number: string;
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

export default function StudentGateHistoryScreen() {
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [resident, setResident] = useState<StudentResident | null>(null);
  const [logs, setLogs] = useState<MovementLog[]>([]);
  const [filter, setFilter] = useState<DateFilter>('all');
  const [savingMovement, setSavingMovement] = useState(false);
  const [goingOutModalVisible, setGoingOutModalVisible] = useState(false);
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

  const loadData = useCallback(async () => {
    if (!user?.id) return;
    try {
      setLoading(true);

      // 1. Fetch linked resident record
      const { data: resData, error: resError } = await supabase
        .from('residents')
        .select(`
          id,
          property_id,
          full_name,
          room_number,
          property:properties (
            name
          )
        `)
        .eq('profile_id', user.id)
        .eq('is_active', true)
        .maybeSingle();

      if (resError) throw resError;
      if (!resData) {
        setResident(null);
        setLoading(false);
        return;
      }

      const resObj: StudentResident = {
        id: resData.id,
        property_id: resData.property_id,
        full_name: resData.full_name,
        room_number: resData.room_number,
        property: Array.isArray(resData.property) ? resData.property[0] : resData.property,
      };
      setResident(resObj);

      // 2. Fetch movement logs for this resident
      const { data: logData, error: logError } = await supabase
        .from('movement_logs')
        .select('*')
        .eq('resident_id', resObj.id)
        .order('event_time', { ascending: false });

      if (logError) throw logError;
      setLogs(logData || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[StudentGateHistory] Error loading gate logs:', err);
      Alert.alert('Load Error', msg || 'Could not load your gate entry and exit history.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Current status based on most recent log (default IN if no logs yet)
  const currentStatus = logs.length > 0 ? logs[0].direction : 'IN';
  const lastEventTime = logs.length > 0 ? formatEventTime(logs[0].event_time) : null;
  const lastEventDate = logs.length > 0 ? formatDateHeader(logs[0].event_time) : null;
  const outNudge = isOutOverHours(currentStatus, logs[0]?.event_time);
  const daysOutThisMonth = useMemo(() => countDaysOutThisMonth(logs), [logs]);

  const recordGateToggle = async (targetDirection: 'IN' | 'OUT', isUndo: boolean = false) => {
    if (savingMovement) return;
    if (isUndo) {
      triggerLightHaptic();
    } else {
      triggerSuccessHaptic();
    }
    setSavingMovement(true);
    try {
      const { data, error } = await supabase.rpc('record_student_movement', {
        p_direction: targetDirection,
        p_note: isUndo ? 'Undo previous gate tap' : undefined,
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Could not update gate status.');
      if (!isUndo) {
        showUndoToast(
          targetDirection === 'IN' ? 'Marked Inside PG' : 'Marked Outside PG',
          targetDirection === 'IN' ? 'OUT' : 'IN'
        );
      }
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert('Update Failed', msg || 'Could not update gate status.');
    } finally {
      setSavingMovement(false);
    }
  };

  const handleConfirmGoingOut = async (payload: GoingOutSubmitPayload) => {
    if (savingMovement) return;
    setSavingMovement(true);
    try {
      const { data, error } = await supabase.rpc('record_student_movement', {
        p_direction: 'OUT',
        p_purpose: payload.purpose,
        p_expected_return_time: payload.expectedReturnTime || undefined,
        p_food_required: payload.foodRequired,
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Could not update gate status.');
      setGoingOutModalVisible(false);
      triggerSuccessHaptic();
      showUndoToast('Marked Outside PG', 'IN');
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert('Update Failed', msg || 'Could not update gate status.');
    } finally {
      setSavingMovement(false);
    }
  };

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

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              loadData();
            }}
            colors={['#0284C7']}
          />
        }>
        {/* Header Bar */}
        <View style={styles.topBar}>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace('/student-dashboard');
              }
            }}>
            <Text style={styles.backButtonText}>‹ Back</Text>
          </Pressable>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.screenTitle}>My Gate History</Text>
            <Text style={styles.screenSubtitle}>
              {resident?.property?.name || 'PG Accommodation'} • Room {resident?.room_number}
            </Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color="#0284C7" />
            <Text style={styles.loadingText}>Loading gate access logs...</Text>
          </View>
        ) : !resident ? (
          <View style={styles.unlinkedCard}>
            <Text style={styles.unlinkedTitle}>Account Not Linked</Text>
            <Text style={styles.unlinkedSub}>
              Your account is not linked to an active PG room record yet.
            </Text>
          </View>
        ) : (
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
                    ? 'Checked IN (Inside PG)'
                    : currentStatus === 'OUT'
                    ? 'Checked OUT (Outside PG)'
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
                  } else {
                    recordGateToggle('IN');
                  }
                }}>
                {savingMovement ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.gateQuickBtnText}>
                    {currentStatus === 'IN' ? 'Mark Out' : 'Mark In'}
                  </Text>
                )}
              </Pressable>
            </View>

            {/* 10+ Hours Out Nudge */}
            {outNudge.isOver && (
              <View style={styles.overHoursBanner}>
                <Text style={styles.overHoursText}>
                  You&apos;ve been out for {outNudge.hoursOut}+ hours. Tap &quot;Mark In&quot; when you&apos;re back at the PG.
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

            {/* Movement Logs List */}
            {groupedLogs.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>No Gate Logs</Text>
                <Text style={styles.emptySub}>
                  No gate check-in or check-out events found for the selected timeframe.
                </Text>
              </View>
            ) : (
              groupedLogs.map((group) => (
                <View key={group.dateKey} style={styles.dateGroup}>
                  <View style={styles.dateHeader}>
                    <Text style={styles.dateHeaderTitle}>{group.dateTitle}</Text>
                    <Text style={styles.dateHeaderCount}>
                      {group.items.length} event{group.items.length === 1 ? '' : 's'}
                    </Text>
                  </View>

                  {group.items.map((log) => {
                    const isIn = log.direction === 'IN';
                    return (
                      <View key={log.id} style={styles.logCard}>
                        <View
                          style={[
                            styles.directionBadge,
                            isIn ? styles.badgeIn : styles.badgeOut,
                          ]}>
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
                            {isIn ? 'GATE IN' : 'GATE OUT'}
                          </Text>
                        </View>

                        <View style={styles.logDetails}>
                          <Text style={styles.logTime}>{formatEventTime(log.event_time)}</Text>
                          {log.purpose && (
                            <View style={styles.purposeTagRow}>
                              <Text style={styles.purposeBadge}>{log.purpose}</Text>
                              {log.expected_return_time && (
                                <Text style={styles.returnBadge}>
                                  Return: {log.expected_return_time}
                                </Text>
                              )}
                            </View>
                          )}
                          {!isIn && typeof log.food_required === 'boolean' && (
                            <Text style={[styles.foodBadge, log.food_required ? styles.foodNeeded : styles.foodNotNeeded]}>
                              {log.food_required ? 'Dinner Required' : 'No Dinner Needed'}
                            </Text>
                          )}
                          {log.note && (
                            <Text style={styles.logNote}>Note: {log.note}</Text>
                          )}
                        </View>
                      </View>
                    );
                  })}
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>

      {undoToast && (
        <View style={styles.undoToast}>
          <Text style={styles.undoToastText}>{undoToast.message}</Text>
          <Pressable
            hitSlop={8}
            onPress={() => {
              const dir = undoToast.undoDirection;
              setUndoToast(null);
              if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
              recordGateToggle(dir, true);
            }}>
            <Text style={styles.undoToastAction}>UNDO</Text>
          </Pressable>
        </View>
      )}

      <GoingOutModal
        visible={goingOutModalVisible}
        saving={savingMovement}
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
  undoToast: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: BottomTabInset + 14,
    backgroundColor: '#0F172A',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  backButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginRight: 10,
  },
  backButtonPressed: {
    backgroundColor: '#F1F5F9',
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0284C7',
  },
  headerTitleWrap: {
    flex: 1,
  },
  screenTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
  },
  screenSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
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
    textTransform: 'uppercase',
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

