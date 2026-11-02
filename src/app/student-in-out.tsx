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
  purpose?: string | null;
  expected_return_time?: string | null;
  food_required?: boolean;
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
        .select('id, resident_id, direction, event_time, note, purpose, expected_return_time, food_required, recorded_by')
        .in('resident_id', allResidentIds)
        .order('event_time', { ascending: false })
        .limit(100);

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

  // Filter Tabs
  type FilterTab = 'ALL' | 'OUT' | 'IN';
  const [activeTab, setActiveTab] = useState<FilterTab>('ALL');

  // Count meals to prepare:
  // 1. All residents Inside PG always require food.
  // 2. Residents who are Outside PG only require food if they explicitly confirmed food_required: true.
  const outsideMealsCount = residents.reduce((acc, r) => {
    const status = getResidentCurrentStatus(r.id);
    const latest = getLatestResidentLog(r.id);
    if (status === 'OUT' && latest && latest.food_required) {
      return acc + 1;
    }
    return acc;
  }, 0);

  // Total meals needed = (Inside residents) + (Outside residents returning for food)
  const mealsRequiredCount = counts.inside + outsideMealsCount;

  const filteredResidents = residents.filter((r) => {
    const status = getResidentCurrentStatus(r.id);
    if (activeTab === 'OUT') return status === 'OUT';
    if (activeTab === 'IN') return status === 'IN';
    return true;
  });

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
            <Text style={styles.summaryLabel}>Inside PG</Text>
          </View>
          <View style={[styles.summaryCard, styles.outsideBorder]}>
            <Text style={[styles.summaryNumber, { color: '#EA580C' }]}>
              {counts.outside}
            </Text>
            <Text style={styles.summaryLabel}>Outside PG</Text>
          </View>
          <View style={[styles.summaryCard, styles.mealsBorder]}>
            <Text style={[styles.summaryNumber, { color: '#0284C7' }]}>
              {mealsRequiredCount}
            </Text>
            <Text style={styles.summaryLabel}>Meals Needed</Text>
            <Text style={styles.summarySubNote}>
              {counts.inside} in + {outsideMealsCount} out
            </Text>
          </View>
        </View>

        {/* View-Only Information Banner */}
        <View style={styles.infoBanner}>
          <Text style={styles.infoBannerIcon}>ℹ️</Text>
          <Text style={styles.infoBannerText}>
            Live Roster: Residents mark their movement, purpose, and dinner requirements from their student app.
          </Text>
        </View>

        {/* Filter Tabs */}
        <View style={styles.filterTabsRow}>
          <Pressable
            style={[styles.filterTab, activeTab === 'ALL' && styles.filterTabActive]}
            onPress={() => setActiveTab('ALL')}>
            <Text style={[styles.filterTabText, activeTab === 'ALL' && styles.filterTabTextActive]}>
              All ({residents.length})
            </Text>
          </Pressable>
          <Pressable
            style={[styles.filterTab, activeTab === 'OUT' && styles.filterTabActive]}
            onPress={() => setActiveTab('OUT')}>
            <Text style={[styles.filterTabText, activeTab === 'OUT' && styles.filterTabTextActive]}>
              Outside ({counts.outside})
            </Text>
          </Pressable>
          <Pressable
            style={[styles.filterTab, activeTab === 'IN' && styles.filterTabActive]}
            onPress={() => setActiveTab('IN')}>
            <Text style={[styles.filterTabText, activeTab === 'IN' && styles.filterTabTextActive]}>
              Inside ({counts.inside})
            </Text>
          </Pressable>
        </View>

        {/* Section: Residents List */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>
            {activeTab === 'ALL'
              ? 'All Residents'
              : activeTab === 'OUT'
              ? 'Currently Outside PG'
              : 'Currently Inside PG'}
          </Text>
          <View style={styles.sectionHeaderRight}>
            <Text style={styles.sectionMeta}>{filteredResidents.length} Listed</Text>
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
            <Text style={styles.loadingText}>Loading attendance roster & logs...</Text>
          </View>
        ) : filteredResidents.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No Residents in this Filter</Text>
            <Text style={styles.emptySubtitle}>
              {activeTab === 'OUT'
                ? 'No residents are currently marked outside.'
                : activeTab === 'IN'
                ? 'No residents are currently marked inside.'
                : 'No active resident records exist for your PG property in Supabase.'}
            </Text>
          </View>
        ) : (
          <View style={styles.residentList}>
            {filteredResidents.map((resident) => {
              const currentStatus = getResidentCurrentStatus(resident.id);
              const latestLog = getLatestResidentLog(resident.id);
              const isInside = currentStatus === 'IN';
              const isOutside = currentStatus === 'OUT';
              const isUnknown = currentStatus === 'UNKNOWN';

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
                      <View style={styles.roomTagRow}>
                        <Text style={styles.residentRoom}>Room {resident.room_number}</Text>
                        {resident.profile_id ? (
                          <View style={styles.appLinkedPill}>
                            <Text style={styles.appLinkedPillText}>App Linked</Text>
                          </View>
                        ) : null}
                      </View>
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
                        {isInside ? 'INSIDE' : isOutside ? 'OUTSIDE' : 'UNKNOWN'}
                      </Text>
                    </View>
                  </View>

                  {/* Conveyed Student Information & Movement Details */}
                  {isOutside && latestLog ? (
                    <View style={styles.conveyedDetailsBox}>
                      <View style={styles.conveyedRow}>
                        <Text style={styles.conveyedLabel}>Left at:</Text>
                        <Text style={styles.conveyedValue}>
                          {formatEventTime(latestLog.event_time)}
                        </Text>
                      </View>
                      {latestLog.purpose ? (
                        <View style={styles.conveyedRow}>
                          <Text style={styles.conveyedLabel}>Purpose:</Text>
                          <Text style={styles.conveyedValueHighlight}>
                            {latestLog.purpose}
                          </Text>
                        </View>
                      ) : null}
                      {latestLog.expected_return_time ? (
                        <View style={styles.conveyedRow}>
                          <Text style={styles.conveyedLabel}>Expected Return:</Text>
                          <Text style={styles.conveyedValue}>
                            {latestLog.expected_return_time}
                          </Text>
                        </View>
                      ) : null}
                      <View style={styles.conveyedRow}>
                        <Text style={styles.conveyedLabel}>Dinner / Meal:</Text>
                        <Text
                          style={[
                            styles.foodStatusBadge,
                            latestLog.food_required
                              ? styles.foodNeededBadge
                              : styles.foodNotNeededBadge,
                          ]}>
                          {latestLog.food_required
                            ? '🍽️ Dinner Required'
                            : '❌ No Dinner Needed'}
                        </Text>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.insideStatusBox}>
                      <View style={styles.insideCheckInRow}>
                        <Text style={styles.insideStatusText}>
                          {latestLog
                            ? `Checked in at ${formatEventTime(latestLog.event_time)}`
                            : 'Currently inside accommodation'}
                        </Text>
                        <Text style={[styles.foodStatusBadge, styles.foodIncludedBadge]}>
                          🍽️ Food Included (Inside PG)
                        </Text>
                      </View>
                    </View>
                  )}
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
  mealsBorder: {
    borderLeftColor: '#0284C7',
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
  summarySubNote: {
    fontSize: 10,
    color: '#0284C7',
    fontWeight: '500',
    marginTop: 2,
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    gap: 8,
  },
  infoBannerIcon: {
    fontSize: 16,
  },
  infoBannerText: {
    flex: 1,
    fontSize: 12,
    color: '#0369A1',
    fontWeight: '500',
    lineHeight: 17,
  },
  filterTabsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  filterTab: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
  },
  filterTabActive: {
    backgroundColor: '#0284C7',
    borderColor: '#0284C7',
  },
  filterTabText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },
  filterTabTextActive: {
    color: '#FFFFFF',
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
  },
  roomTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  appLinkedPill: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  appLinkedPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#15803D',
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
  conveyedDetailsBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
    gap: 5,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  conveyedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  conveyedLabel: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  conveyedValue: {
    fontSize: 12,
    color: '#0F172A',
    fontWeight: '600',
  },
  conveyedValueHighlight: {
    fontSize: 12,
    color: '#1D4ED8',
    fontWeight: '700',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  foodStatusBadge: {
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  foodNeededBadge: {
    backgroundColor: '#DCFCE7',
    color: '#15803D',
  },
  foodIncludedBadge: {
    backgroundColor: '#DCFCE7',
    color: '#15803D',
  },
  foodNotNeededBadge: {
    backgroundColor: '#FEF3C7',
    color: '#B45309',
  },
  insideStatusBox: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  insideCheckInRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  insideStatusText: {
    fontSize: 12,
    color: '#64748B',
    fontStyle: 'italic',
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
