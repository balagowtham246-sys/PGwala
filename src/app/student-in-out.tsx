import React, { useCallback, useState } from 'react';
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
import { router, useFocusEffect } from 'expo-router';

import { BottomTabInset } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/lib/supabase';

// --- Types ---
export type ResidentStatus = 'IN' | 'OUT' | 'UNKNOWN';

export interface ResidentRecord {
  id: string;
  property_id: string;
  profile_id: string | null;
  full_name: string;
  phone_number: string | null;
  room_number: string;
  is_active: boolean;
}

export interface MovementLogRecord {
  id: string;
  resident_id: string;
  direction: 'IN' | 'OUT';
  event_time: string;
  note: string | null;
  recorded_by: string;
}

// Helper to format event time
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

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingResidentId, setSavingResidentId] = useState<string | null>(null);

  const [residents, setResidents] = useState<ResidentRecord[]>([]);
  const [allResidents, setAllResidents] = useState<ResidentRecord[]>([]);
  const [logs, setLogs] = useState<MovementLogRecord[]>([]);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  /**
   * Fetch active property, its residents (active for gate attendance, all for history),
   * and all recent movement logs.
   * Completely live from Supabase (ZERO hardcoded fallback residents).
   */
  const loadData = useCallback(async () => {
    try {
      setErrorMessage(null);

      // 1. Fetch active property belonging to authenticated owner
      let query = supabase
        .from('properties')
        .select('id, name')
        .eq('is_active', true);

      if (user?.id) {
        query = query.eq('owner_id', user.id);
      }

      const { data: properties, error: propError } = await query.limit(1);

      if (propError) {
        throw new Error(`Property query failed: ${propError.message}`);
      }

      if (!properties || properties.length === 0) {
        setResidents([]);
        setAllResidents([]);
        setLogs([]);
        setLoading(false);
        return;
      }

      const activeProp = properties[0];

      // 2. Fetch all residents for this property (active & inactive)
      const { data: residentsData, error: resError } = await supabase
        .from('residents')
        .select('id, property_id, profile_id, full_name, phone_number, room_number, is_active')
        .eq('property_id', activeProp.id)
        .order('room_number', { ascending: true });

      if (resError) {
        throw new Error(`Residents query failed: ${resError.message}`);
      }

      const loadedAll: ResidentRecord[] = residentsData ?? [];
      setAllResidents(loadedAll);

      // Active residents for live gate attendance & inside/outside count derivation
      const activeResidents = loadedAll.filter((r) => r.is_active);
      setResidents(activeResidents);

      const allResidentIds = loadedAll.map((r) => r.id);

      if (allResidentIds.length === 0) {
        setLogs([]);
        setLoading(false);
        return;
      }

      // 3. Fetch movement logs for all property residents (preserving historical records)
      const { data: logsData, error: logsError } = await supabase
        .from('movement_logs')
        .select('id, resident_id, direction, event_time, note, recorded_by')
        .in('resident_id', allResidentIds)
        .order('event_time', { ascending: false })
        .limit(30);

      if (logsError) {
        throw new Error(`Movement logs query failed: ${logsError.message}`);
      }

      setLogs(logsData ?? []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[StudentInOut] Error fetching data:', err);
      setErrorMessage(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  /**
   * useFocusEffect: Refetches live Supabase data EVERY TIME the screen comes into focus.
   * Guarantees newly recorded movements or navigation between Dashboard <-> In/Out are synced.
   */
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const handleRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  /**
   * DERIVED STATUS:
   * Finds the resident's newest movement log in `logs` (which is sorted event_time DESC).
   * - If found: status is log.direction ('IN' or 'OUT')
   * - If not found: status is 'UNKNOWN'
   */
  const getLatestResidentLog = (residentId: string): MovementLogRecord | undefined => {
    return logs.find((l) => l.resident_id === residentId);
  };

  const getResidentCurrentStatus = (residentId: string): ResidentStatus => {
    const latest = getLatestResidentLog(residentId);
    return latest ? latest.direction : 'UNKNOWN';
  };

  // Live count derivation
  const counts = residents.reduce(
    (acc, r) => {
      const status = getResidentCurrentStatus(r.id);
      if (status === 'IN') acc.inside += 1;
      else if (status === 'OUT') acc.outside += 1;
      else acc.unknown += 1;
      return acc;
    },
    { inside: 0, outside: 0, unknown: 0 }
  );

  /**
   * ACTION HANDLER:
   * Inserts into public.movement_logs with resident_id, direction, note, recorded_by.
   * Enforces RLS: recorded_by must match auth.uid().
   * Awaits insert, selects representation with .single(), and verifies confirmed row.
   */
  const handleRecordMovement = async (resident: ResidentRecord, targetDirection: 'IN' | 'OUT') => {
    if (!user?.id) {
      Alert.alert('Authentication Required', 'You must be signed in as an owner to record movement.');
      return;
    }

    if (savingResidentId) return; // Prevent concurrent/repeated taps

    setSavingResidentId(resident.id);
    setErrorMessage(null);
    setFeedbackMessage(null);

    try {
      const defaultNote = targetDirection === 'IN' ? 'Gate check-in' : 'Gate check-out';

      // Explicit insert payload matching allowed column grants:
      // (resident_id, direction, note, recorded_by)
      // id, event_time, and created_at are generated by PostgreSQL defaults.
      const payload = {
        resident_id: resident.id,
        direction: targetDirection,
        note: defaultNote,
        recorded_by: user.id, // Strictly satisfies RLS policy recorded_by = auth.uid()
      };

      const { data, error } = await supabase
        .from('movement_logs')
        .insert(payload)
        .select('id, resident_id, direction, event_time, recorded_by')
        .single();

      // Strict failure check 1: Supabase / PostgREST returned error
      if (error) {
        console.error('[StudentInOut] Movement insert failed:', error);
        const errDetail = error.details ? ` (${error.details})` : error.hint ? ` (${error.hint})` : '';
        const fullMessage = `Insert Failed [Code: ${error.code || 'UNKNOWN'}]: ${error.message}${errDetail}`;
        Alert.alert('Insert Failed', fullMessage);
        setErrorMessage(fullMessage);
        return; // HALT - strictly no success banner
      }

      // Strict failure check 2: No confirmed row representation returned
      if (!data || !data.id) {
        console.error('[StudentInOut] No row data returned from insert:', data);
        const noRowMsg = 'Insert Failed: The database did not return the saved movement record.';
        Alert.alert('Insert Failed', noRowMsg);
        setErrorMessage(noRowMsg);
        return; // HALT - strictly no success banner
      }

      // ONLY reach here when a confirmed row with a valid id was persisted and returned
      setFeedbackMessage(
        `Marked ${resident.full_name} as ${data.direction} successfully!`
      );

      // Refetch live database logs immediately to re-derive status and timeline
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[StudentInOut] Unexpected error during insert:', err);
      Alert.alert('Action Exception', `Unexpected error: ${msg}`);
      setErrorMessage(`Action Exception: ${msg}`);
    } finally {
      setSavingResidentId(null);
    }
  };

  // Build fast resident lookup map for recent history (includes deactivated residents)
  const residentMap = new Map<string, ResidentRecord>();
  for (const r of allResidents) {
    residentMap.set(r.id, r);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={['#0284C7']}
          />
        }>

        {/* Top Navigation Bar with Back Button */}
        <View style={styles.topBar}>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.backButton,
              pressed && styles.backButtonPressed,
            ]}
            onPress={() => router.back()}>
            <Text style={styles.backButtonText}>‹ Back</Text>
          </Pressable>
          <View style={styles.titleWrapper}>
            <Text style={styles.screenTitle}>Student In / Out</Text>
            <Text style={styles.screenSubtitle}>Gate Attendance & Logs</Text>
          </View>
        </View>

        {/* Transient Feedback Banner */}
        {feedbackMessage && (
          <View style={styles.feedbackBanner}>
            <Text style={styles.feedbackIcon}>✓</Text>
            <Text style={styles.feedbackText}>{feedbackMessage}</Text>
            <Pressable hitSlop={8} onPress={() => setFeedbackMessage(null)}>
              <Text style={styles.feedbackDismiss}>✕</Text>
            </Pressable>
          </View>
        )}

        {/* Error Banner */}
        {errorMessage && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorIcon}>⚠️</Text>
            <Text style={styles.errorText}>{errorMessage}</Text>
            <Pressable hitSlop={8} onPress={loadData}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        )}

        {/* Real-time Summary Cards derived from latest status */}
        <View style={styles.summaryRow}>
          <View style={[styles.summaryCard, styles.insideBorder]}>
            <Text style={[styles.summaryNumber, { color: '#16A34A' }]}>
              {counts.inside}
            </Text>
            <Text style={styles.summaryLabel}>Currently IN</Text>
          </View>
          <View style={[styles.summaryCard, styles.outsideBorder]}>
            <Text style={[styles.summaryNumber, { color: '#EA580C' }]}>
              {counts.outside}
            </Text>
            <Text style={styles.summaryLabel}>Currently OUT</Text>
          </View>
          {counts.unknown > 0 && (
            <View style={[styles.summaryCard, styles.unknownBorder]}>
              <Text style={[styles.summaryNumber, { color: '#64748B' }]}>
                {counts.unknown}
              </Text>
              <Text style={styles.summaryLabel}>Unknown</Text>
            </View>
          )}
        </View>

        {/* Section: Residents List */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Residents</Text>
          <View style={styles.sectionHeaderRight}>
            <Text style={styles.sectionMeta}>{residents.length} Active</Text>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.addResidentPill,
                pressed && styles.addResidentPillPressed,
              ]}
              onPress={() => router.push('/add-resident')}>
              <Text style={styles.addResidentPillText}>+ Add</Text>
            </Pressable>
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color="#0284C7" />
            <Text style={styles.loadingText}>Loading residents & gate logs...</Text>
          </View>
        ) : residents.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No Active Residents Found</Text>
            <Text style={styles.emptySubtitle}>
              No active resident records exist for your PG property in Supabase.
            </Text>
            <Pressable
              accessibilityRole="button"
              style={styles.emptyAddBtn}
              onPress={() => router.push('/add-resident')}>
              <Text style={styles.emptyAddBtnText}>+ Add First Resident</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.residentList}>
            {residents.map((resident) => {
              const currentStatus = getResidentCurrentStatus(resident.id);
              const latestLog = getLatestResidentLog(resident.id);
              const isInside = currentStatus === 'IN';
              const isOutside = currentStatus === 'OUT';
              const isUnknown = currentStatus === 'UNKNOWN';
              const isSaving = savingResidentId === resident.id;

              return (
                <View key={resident.id} style={styles.residentCard}>
                  <View style={styles.residentHeaderRow}>
                    <View style={styles.residentInfo}>
                      <View style={styles.residentNameRow}>
                        <Text style={styles.residentName}>{resident.full_name}</Text>
                        <Pressable
                          accessibilityRole="button"
                          hitSlop={8}
                          style={({ pressed }) => [
                            styles.editBadgeBtn,
                            pressed && styles.editBadgeBtnPressed,
                          ]}
                          onPress={() =>
                            router.push({
                              pathname: '/edit-resident',
                              params: { id: resident.id },
                            })
                          }>
                          <Text style={styles.editBadgeBtnText}>Edit</Text>
                        </Pressable>
                      </View>
                      <Text style={styles.residentRoom}>Room {resident.room_number}</Text>
                    </View>

                    {/* Status Pill Badge */}
                    <View
                      style={[
                        styles.statusBadge,
                        isInside && styles.statusBadgeIn,
                        isOutside && styles.statusBadgeOut,
                        isUnknown && styles.statusBadgeUnknown,
                      ]}>
                      <View
                        style={[
                          styles.statusDot,
                          {
                            backgroundColor: isInside
                              ? '#16A34A'
                              : isOutside
                              ? '#EA580C'
                              : '#94A3B8',
                          },
                        ]}
                      />
                      <Text
                        style={[
                          styles.statusText,
                          {
                            color: isInside
                              ? '#15803D'
                              : isOutside
                              ? '#C2410C'
                              : '#475569',
                          },
                        ]}>
                        {currentStatus}
                      </Text>
                    </View>
                  </View>

                  {/* Latest Event Metadata */}
                  <View style={styles.eventMetaRow}>
                    <Text style={styles.eventMetaText}>
                      Last log:{' '}
                      <Text style={styles.eventMetaHighlight}>
                        {latestLog ? formatEventTime(latestLog.event_time) : 'No log yet'}
                      </Text>
                      {latestLog?.note ? ` • ${latestLog.note}` : ''}
                    </Text>
                  </View>

                  {/* Action Buttons: Mark IN and Mark OUT */}
                  <View style={styles.actionButtonGroup}>
                    <Pressable
                      accessibilityRole="button"
                      disabled={isSaving || isInside}
                      style={({ pressed }) => [
                        styles.actionBtn,
                        styles.actionBtnIn,
                        (isInside || isSaving) && styles.actionBtnDisabled,
                        pressed && styles.actionBtnPressed,
                      ]}
                      onPress={() => handleRecordMovement(resident, 'IN')}>
                      {isSaving ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Text style={styles.actionBtnText}>
                          {isInside ? '✓ Inside' : 'Mark IN'}
                        </Text>
                      )}
                    </Pressable>

                    <Pressable
                      accessibilityRole="button"
                      disabled={isSaving || isOutside}
                      style={({ pressed }) => [
                        styles.actionBtn,
                        styles.actionBtnOut,
                        (isOutside || isSaving) && styles.actionBtnDisabled,
                        pressed && styles.actionBtnPressed,
                      ]}
                      onPress={() => handleRecordMovement(resident, 'OUT')}>
                      {isSaving ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Text style={styles.actionBtnText}>
                          {isOutside ? '✓ Outside' : 'Mark OUT'}
                        </Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Section: Recent Event History */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Recent Event History</Text>
          <Text style={styles.sectionMeta}>{logs.length} records</Text>
        </View>

        <View style={styles.historyContainer}>
          {loading ? (
            <View style={styles.emptyHistoryBox}>
              <ActivityIndicator size="small" color="#0284C7" />
            </View>
          ) : logs.length === 0 ? (
            <View style={styles.emptyHistoryBox}>
              <Text style={styles.emptyHistoryTitle}>No movement records</Text>
              <Text style={styles.emptyHistorySub}>
                When students enter or exit, recorded events will display here in real time.
              </Text>
            </View>
          ) : (
            logs.slice(0, 10).map((item, index) => {
              const resident = residentMap.get(item.resident_id);
              const isEntry = item.direction === 'IN';

              return (
                <View
                  key={item.id}
                  style={[
                    styles.historyRow,
                    index === Math.min(logs.length, 10) - 1 && styles.historyRowLast,
                  ]}>
                  <View style={styles.historyLeft}>
                    <View
                      style={[
                        styles.historyIconBox,
                        { backgroundColor: isEntry ? '#DCFCE7' : '#FFEDD5' },
                      ]}>
                      <Text style={styles.historyIcon}>
                        {isEntry ? '↓' : '↑'}
                      </Text>
                    </View>
                    <View style={styles.historyDetails}>
                      <Text style={styles.historyName}>
                        {resident ? resident.full_name : 'Resident'}
                      </Text>
                      <Text style={styles.historySub}>
                        {resident
                          ? resident.is_active
                            ? `Room ${resident.room_number}`
                            : `Room ${resident.room_number} (Inactive)`
                          : ''}
                        {item.note ? ` • ${item.note}` : ''}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.historyRight}>
                    <View
                      style={[
                        styles.miniBadge,
                        { backgroundColor: isEntry ? '#DCFCE7' : '#FFEDD5' },
                      ]}>
                      <Text
                        style={[
                          styles.miniBadgeText,
                          { color: isEntry ? '#15803D' : '#C2410C' },
                        ]}>
                        {item.direction}
                      </Text>
                    </View>
                    <Text style={styles.historyTime}>
                      {formatEventTime(item.event_time)}
                    </Text>
                  </View>
                </View>
              );
            })
          )}
        </View>

        {/* Spacing for bottom tab bar */}
        <View style={{ height: BottomTabInset + 30 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// --- Styles ---
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8FAFC', // Slate 50
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  backButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginRight: 12,
    minHeight: 40,
    justifyContent: 'center',
  },
  backButtonPressed: {
    backgroundColor: '#F1F5F9',
  },
  backButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  titleWrapper: {
    flex: 1,
  },
  screenTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  screenSubtitle: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
    marginTop: 1,
  },
  feedbackBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
  },
  feedbackIcon: {
    fontSize: 14,
    color: '#059669',
    fontWeight: '800',
    marginRight: 8,
  },
  feedbackText: {
    flex: 1,
    fontSize: 13,
    color: '#065F46',
    fontWeight: '600',
  },
  feedbackDismiss: {
    fontSize: 14,
    color: '#059669',
    fontWeight: '700',
    paddingHorizontal: 4,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  errorIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: '#DC2626',
    fontWeight: '500',
  },
  retryText: {
    color: '#0284C7',
    fontSize: 13,
    fontWeight: '700',
    paddingHorizontal: 6,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderLeftWidth: 4,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
      },
      android: {
        elevation: 1,
      },
    }),
  },
  insideBorder: {
    borderLeftColor: '#16A34A',
  },
  outsideBorder: {
    borderLeftColor: '#EA580C',
  },
  unknownBorder: {
    borderLeftColor: '#94A3B8',
  },
  summaryNumber: {
    fontSize: 24,
    fontWeight: '800',
  },
  summaryLabel: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
    marginTop: 2,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  sectionHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sectionMeta: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  addResidentPill: {
    backgroundColor: '#0284C7',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  addResidentPillPressed: {
    backgroundColor: '#0369A1',
  },
  addResidentPillText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  loadingBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
    color: '#64748B',
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  emptySubtitle: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 18,
  },
  emptyAddBtn: {
    marginTop: 14,
    backgroundColor: '#0284C7',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  emptyAddBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  residentList: {
    gap: 12,
    marginBottom: 24,
  },
  residentCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  residentHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  residentInfo: {
    flex: 1,
  },
  residentNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  residentName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  editBadgeBtn: {
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  editBadgeBtnPressed: {
    backgroundColor: '#E2E8F0',
  },
  editBadgeBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0369A1',
  },
  residentRoom: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusBadgeIn: {
    backgroundColor: '#DCFCE7',
  },
  statusBadgeOut: {
    backgroundColor: '#FFEDD5',
  },
  statusBadgeUnknown: {
    backgroundColor: '#F1F5F9',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
  },
  eventMetaRow: {
    marginTop: 10,
    marginBottom: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  eventMetaText: {
    fontSize: 12,
    color: '#64748B',
  },
  eventMetaHighlight: {
    color: '#0F172A',
    fontWeight: '600',
  },
  actionButtonGroup: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtn: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44, // Accessible touch target
  },
  actionBtnIn: {
    backgroundColor: '#16A34A', // Green
  },
  actionBtnOut: {
    backgroundColor: '#EA580C', // Orange
  },
  actionBtnDisabled: {
    opacity: 0.45,
  },
  actionBtnPressed: {
    opacity: 0.85,
  },
  actionBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  historyContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 14,
  },
  emptyHistoryBox: {
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyHistoryTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
  },
  emptyHistorySub: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 4,
    textAlign: 'center',
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  historyRowLast: {
    borderBottomWidth: 0,
  },
  historyLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  historyIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  historyIcon: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  historyDetails: {
    flex: 1,
  },
  historyName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  historySub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  historyRight: {
    alignItems: 'flex-end',
    marginLeft: 8,
  },
  miniBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginBottom: 2,
  },
  miniBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  historyTime: {
    fontSize: 11,
    color: '#94A3B8',
  },
});
