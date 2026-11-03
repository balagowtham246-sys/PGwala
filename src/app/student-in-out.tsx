import React, { useCallback, useState, useMemo } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import {
  LogIn,
  LogOut,
  UserPlus,
  Utensils,
  X,
} from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useProperty } from '@/context/property-context';
import { supabase } from '@/lib/supabase';
import {
  OwnerHeader,
  StatisticCard,
  StatusBadge,
  SegmentedFilter,
  EmptyState,
  ErrorState,
} from '@/components/ui/owner';

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

function formatEventDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
    });
  } catch {
    return '';
  }
}

export default function StudentInOutScreen() {
  const { user } = useAuth();
  const { selectedProperty, selectedPropertyId } = useProperty();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [propertyName, setPropertyName] = useState('Shalom Residency');

  const [residents, setResidents] = useState<ResidentRecord[]>([]);
  const [allResidents, setAllResidents] = useState<ResidentRecord[]>([]);
  const [logs, setLogs] = useState<MovementLogRecord[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Filter Tabs
  type FilterTab = 'ALL' | 'OUT' | 'IN';
  const [activeTab, setActiveTab] = useState<FilterTab>('ALL');

  // Full History Modal state
  const [fullHistoryVisible, setFullHistoryVisible] = useState(false);
  const [historyDirectionFilter, setHistoryDirectionFilter] = useState<
    'ALL' | 'IN' | 'OUT'
  >('ALL');
  const [historyResidentFilter, setHistoryResidentFilter] = useState<string>('ALL');
  const [historyDateFilter, setHistoryDateFilter] = useState<
    'ALL' | 'TODAY' | 'WEEK'
  >('ALL');

  const loadData = useCallback(async () => {
    try {
      setErrorMessage(null);

      // 1. Resolve active property ID & name
      let activePropId = selectedPropertyId;
      let activePropName = selectedProperty?.name;

      if (!activePropId) {
        let query = supabase
          .from('properties')
          .select('id, name')
          .eq('is_active', true);

        if (user?.id) {
          query = query.eq('owner_id', user.id);
        }

        const { data: properties, error: propError } = await query.limit(1);
        if (propError) throw propError;

        if (!properties || properties.length === 0) {
          setResidents([]);
          setAllResidents([]);
          setLogs([]);
          setLoading(false);
          return;
        }

        activePropId = properties[0].id;
        activePropName = properties[0].name;
      }

      setPropertyName(activePropName || 'Shalom Residency');

      // 2. Fetch all residents
      const { data: residentsData, error: resError } = await supabase
        .from('residents')
        .select(
          'id, property_id, profile_id, full_name, phone_number, room_number, is_active'
        )
        .eq('property_id', activePropId)
        .order('room_number', { ascending: true });

      if (resError) throw resError;

      const loadedAll: ResidentRecord[] = residentsData ?? [];
      setAllResidents(loadedAll);

      const activeResidents = loadedAll.filter((r) => r.is_active);
      setResidents(activeResidents);

      const allResidentIds = loadedAll.map((r) => r.id);
      if (allResidentIds.length === 0) {
        setLogs([]);
        setLoading(false);
        return;
      }

      // 3. Fetch movement logs
      const { data: logsData, error: logsError } = await supabase
        .from('movement_logs')
        .select(
          'id, resident_id, direction, event_time, note, purpose, expected_return_time, food_required, recorded_by'
        )
        .in('resident_id', allResidentIds)
        .order('event_time', { ascending: false })
        .limit(100);

      if (logsError) throw logsError;

      setLogs(logsData ?? []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[StudentInOut] Error fetching data:', err);
      setErrorMessage(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id, selectedPropertyId, selectedProperty?.name]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const handleRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const getLatestResidentLog = (
    residentId: string
  ): MovementLogRecord | undefined => {
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

  const outsideMealsCount = residents.reduce((acc, r) => {
    const status = getResidentCurrentStatus(r.id);
    const latest = getLatestResidentLog(r.id);
    if (status === 'OUT' && latest && latest.food_required) {
      return acc + 1;
    }
    return acc;
  }, 0);

  const mealsRequiredCount = counts.inside + outsideMealsCount;

  const filteredResidents = residents.filter((r) => {
    const status = getResidentCurrentStatus(r.id);
    if (activeTab === 'OUT') return status === 'OUT';
    if (activeTab === 'IN') return status === 'IN';
    return true;
  });

  const residentMap = useMemo(() => {
    const map = new Map<string, ResidentRecord>();
    for (const r of allResidents) {
      map.set(r.id, r);
    }
    return map;
  }, [allResidents]);

  // Full history filtered list
  const filteredHistoryLogs = useMemo(() => {
    return logs.filter((log) => {
      if (
        historyDirectionFilter !== 'ALL' &&
        log.direction !== historyDirectionFilter
      ) {
        return false;
      }
      if (
        historyResidentFilter !== 'ALL' &&
        log.resident_id !== historyResidentFilter
      ) {
        return false;
      }
      if (historyDateFilter === 'TODAY') {
        const logDate = new Date(log.event_time).toDateString();
        const today = new Date().toDateString();
        if (logDate !== today) return false;
      } else if (historyDateFilter === 'WEEK') {
        const logTime = new Date(log.event_time).getTime();
        const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        if (logTime < oneWeekAgo) return false;
      }
      return true;
    });
  }, [logs, historyDirectionFilter, historyResidentFilter, historyDateFilter]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <OwnerHeader
        title="Gate Attendance"
        subtitle={propertyName}
        showBack
        rightAction={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add Resident"
            style={({ pressed }) => [
              styles.headerAddBtn,
              pressed && styles.cardPressed,
            ]}
            onPress={() => router.push('/add-resident')}>
            <UserPlus size={16} color={OwnerTheme.colors.primary} />
            <Text style={styles.headerAddBtnText}>Add</Text>
          </Pressable>
        }
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
        {errorMessage && (
          <ErrorState message={errorMessage} onRetry={loadData} />
        )}

        {/* Top 3 Real-Time Statistics */}
        <View style={styles.statsRow}>
          <StatisticCard
            label="Inside PG"
            value={counts.inside}
            accentColor={OwnerTheme.colors.success}
            icon={LogIn}
            sublabel="Checked in"
            onPress={() => setActiveTab('IN')}
          />
          <StatisticCard
            label="Outside PG"
            value={counts.outside}
            accentColor={OwnerTheme.colors.warning}
            icon={LogOut}
            sublabel="Checked out"
            onPress={() => setActiveTab('OUT')}
          />
          <StatisticCard
            label="Meals Needed"
            value={mealsRequiredCount}
            accentColor={OwnerTheme.colors.primary}
            icon={Utensils}
            sublabel={`${counts.inside} in + ${outsideMealsCount} out`}
          />
        </View>

        {/* Filter Segmented Control */}
        <SegmentedFilter
          options={[
            { key: 'ALL', label: 'All', count: residents.length },
            { key: 'OUT', label: 'Outside', count: counts.outside },
            { key: 'IN', label: 'Inside', count: counts.inside },
          ]}
          activeKey={activeTab}
          onSelect={(key) => setActiveTab(key as FilterTab)}
          style={{ marginVertical: 14 }}
        />

        {/* Residents Roster */}
        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color={OwnerTheme.colors.primary} />
            <Text style={styles.loadingText}>Loading attendance roster...</Text>
          </View>
        ) : filteredResidents.length === 0 ? (
          <EmptyState
            title="No residents found"
            description={
              activeTab === 'OUT'
                ? 'No residents are currently marked outside.'
                : activeTab === 'IN'
                ? 'No residents are currently marked inside.'
                : 'No active residents registered in this property.'
            }
          />
        ) : (
          <View style={styles.residentsList}>
            {filteredResidents.map((resident) => {
              const currentStatus = getResidentCurrentStatus(resident.id);
              const latestLog = getLatestResidentLog(resident.id);
              const isInside = currentStatus === 'IN';
              const isOutside = currentStatus === 'OUT';

              return (
                <Pressable
                  key={resident.id}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.residentCard,
                    pressed && styles.cardPressed,
                  ]}
                  onPress={() =>
                    router.push({
                      pathname: '/edit-resident',
                      params: { id: resident.id },
                    })
                  }>
                  <View style={styles.residentCardHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.residentName}>
                        {resident.full_name}
                      </Text>
                      <Text style={styles.residentRoom}>
                        Room {resident.room_number}
                      </Text>
                    </View>
                    <StatusBadge
                      label={
                        isInside ? 'INSIDE' : isOutside ? 'OUTSIDE' : 'UNKNOWN'
                      }
                      variant={
                        isInside
                          ? 'success'
                          : isOutside
                          ? 'warning'
                          : 'neutral'
                      }
                      size="sm"
                    />
                  </View>

                  {/* Clean information rows */}
                  {isOutside && latestLog ? (
                    <View style={styles.detailsBox}>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Left at:</Text>
                        <Text style={styles.detailValue}>
                          {formatEventTime(latestLog.event_time)}
                        </Text>
                      </View>
                      {latestLog.purpose ? (
                        <View style={styles.detailRow}>
                          <Text style={styles.detailLabel}>Purpose:</Text>
                          <Text style={styles.detailValueBold}>
                            {latestLog.purpose}
                          </Text>
                        </View>
                      ) : null}
                      {latestLog.expected_return_time ? (
                        <View style={styles.detailRow}>
                          <Text style={styles.detailLabel}>
                            Expected return:
                          </Text>
                          <Text style={styles.detailValue}>
                            {latestLog.expected_return_time}
                          </Text>
                        </View>
                      ) : null}
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Dinner:</Text>
                        <Text
                          style={[
                            styles.dinnerText,
                            latestLog.food_required
                              ? { color: OwnerTheme.colors.success }
                              : { color: OwnerTheme.colors.textMuted },
                          ]}>
                          {latestLog.food_required ? 'Required' : 'Not required'}
                        </Text>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.detailsBox}>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Checked in:</Text>
                        <Text style={styles.detailValue}>
                          {latestLog
                            ? formatEventTime(latestLog.event_time)
                            : 'Inside PG'}
                        </Text>
                      </View>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Dinner:</Text>
                        <Text
                          style={[
                            styles.dinnerText,
                            { color: OwnerTheme.colors.success },
                          ]}>
                          Included (Inside PG)
                        </Text>
                      </View>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        )}

        {/* Recent Event History Section (Latest 3 events) */}
        <View style={styles.historySectionHeader}>
          <Text style={styles.historySectionTitle}>Recent Event History</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setFullHistoryVisible(true)}>
            <Text style={styles.viewAllText}>View All ›</Text>
          </Pressable>
        </View>

        <View style={styles.historyCard}>
          {loading ? (
            <View style={{ padding: 16, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={OwnerTheme.colors.primary} />
            </View>
          ) : logs.length === 0 ? (
            <EmptyState
              title="No movement records"
              description="When students check in or out, records will appear here."
            />
          ) : (
            logs.slice(0, 3).map((item, index) => {
              const resident = residentMap.get(item.resident_id);
              const isEntry = item.direction === 'IN';
              return (
                <View
                  key={item.id}
                  style={[
                    styles.historyItemRow,
                    index === Math.min(logs.length, 3) - 1 && {
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
                      marked {item.direction}
                      {item.purpose ? ` • ${item.purpose}` : ''}
                    </Text>
                  </View>
                  <Text style={styles.historyItemTime}>
                    {formatEventTime(item.event_time)}
                  </Text>
                </View>
              );
            })
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Full History Modal */}
      <Modal
        visible={fullHistoryVisible}
        animationType="slide"
        onRequestClose={() => setFullHistoryVisible(false)}>
        <SafeAreaView style={styles.fullModalSafe}>
          <View style={styles.modalHeaderRow}>
            <Text style={styles.modalTitle}>Gate Event History</Text>
            <Pressable
              hitSlop={8}
              onPress={() => setFullHistoryVisible(false)}
              style={styles.modalCloseBtn}>
              <X size={20} color={OwnerTheme.colors.textPrimary} />
            </Pressable>
          </View>

          {/* Filters Bar in Modal */}
          <View style={styles.modalFiltersBox}>
            <View style={styles.modalFilterRow}>
              <Text style={styles.filterGroupLabel}>Direction:</Text>
              {(['ALL', 'IN', 'OUT'] as const).map((dir) => (
                <Pressable
                  key={dir}
                  style={[
                    styles.filterChip,
                    historyDirectionFilter === dir && styles.filterChipActive,
                  ]}
                  onPress={() => setHistoryDirectionFilter(dir)}>
                  <Text
                    style={[
                      styles.filterChipText,
                      historyDirectionFilter === dir &&
                        styles.filterChipTextActive,
                    ]}>
                    {dir}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.modalFilterRow}>
              <Text style={styles.filterGroupLabel}>Timeframe:</Text>
              {(['ALL', 'TODAY', 'WEEK'] as const).map((timeOpt) => (
                <Pressable
                  key={timeOpt}
                  style={[
                    styles.filterChip,
                    historyDateFilter === timeOpt && styles.filterChipActive,
                  ]}
                  onPress={() => setHistoryDateFilter(timeOpt)}>
                  <Text
                    style={[
                      styles.filterChipText,
                      historyDateFilter === timeOpt &&
                        styles.filterChipTextActive,
                    ]}>
                    {timeOpt === 'ALL'
                      ? 'All'
                      : timeOpt === 'TODAY'
                      ? 'Today'
                      : 'Past 7 Days'}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* History Records List */}
          <ScrollView
            contentContainerStyle={styles.historyModalScroll}
            showsVerticalScrollIndicator={false}>
            {filteredHistoryLogs.length === 0 ? (
              <EmptyState
                title="No events match this filter"
                description="Try clearing filters to view more gate logs."
              />
            ) : (
              filteredHistoryLogs.map((item, idx) => {
                const resident = residentMap.get(item.resident_id);
                const isEntry = item.direction === 'IN';
                return (
                  <View key={item.id} style={styles.modalHistoryCard}>
                    <View style={styles.modalHistoryHeader}>
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
                          <LogIn size={14} color={OwnerTheme.colors.success} />
                        ) : (
                          <LogOut
                            size={14}
                            color={OwnerTheme.colors.warning}
                          />
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.modalHistName}>
                          {resident ? resident.full_name : 'Resident'}
                        </Text>
                        <Text style={styles.modalHistRoom}>
                          Room {resident?.room_number || '-'}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <StatusBadge
                          label={isEntry ? 'IN' : 'OUT'}
                          variant={isEntry ? 'success' : 'warning'}
                          size="sm"
                        />
                        <Text style={styles.modalHistTime}>
                          {formatEventDate(item.event_time)} •{' '}
                          {formatEventTime(item.event_time)}
                        </Text>
                      </View>
                    </View>

                    {item.purpose ? (
                      <View style={styles.modalDetailSubRow}>
                        <Text style={styles.modalDetailSubLabel}>Purpose: </Text>
                        <Text style={styles.modalDetailSubVal}>
                          {item.purpose}
                        </Text>
                      </View>
                    ) : null}

                    {item.expected_return_time ? (
                      <View style={styles.modalDetailSubRow}>
                        <Text style={styles.modalDetailSubLabel}>
                          Expected return:{' '}
                        </Text>
                        <Text style={styles.modalDetailSubVal}>
                          {item.expected_return_time}
                        </Text>
                      </View>
                    ) : null}

                    {!isEntry && (
                      <View style={styles.modalDetailSubRow}>
                        <Text style={styles.modalDetailSubLabel}>Dinner: </Text>
                        <Text
                          style={[
                            styles.modalDetailSubVal,
                            item.food_required
                              ? { color: OwnerTheme.colors.success }
                              : { color: OwnerTheme.colors.textMuted },
                          ]}>
                          {item.food_required ? 'Required' : 'Not required'}
                        </Text>
                      </View>
                    )}
                  </View>
                );
              })
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
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
  // Full History Modal
  fullModalSafe: {
    flex: 1,
    backgroundColor: OwnerTheme.colors.background,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: OwnerTheme.colors.border,
    backgroundColor: '#FFFFFF',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  modalCloseBtn: {
    padding: 6,
  },
  modalFiltersBox: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: OwnerTheme.colors.border,
    gap: 8,
  },
  modalFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filterGroupLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
    minWidth: 70,
  },
  filterChip: {
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: OwnerTheme.radius.full,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    backgroundColor: '#F8FAFC',
  },
  filterChipActive: {
    backgroundColor: OwnerTheme.colors.primary,
    borderColor: OwnerTheme.colors.primary,
  },
  filterChipText: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
    fontWeight: '500',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  historyModalScroll: {
    padding: 16,
    gap: 10,
  },
  modalHistoryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.md,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 12,
  },
  modalHistoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  modalHistName: {
    fontSize: 14,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  modalHistRoom: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
  },
  modalHistTime: {
    fontSize: 11,
    color: OwnerTheme.colors.textMuted,
    marginTop: 2,
  },
  modalDetailSubRow: {
    flexDirection: 'row',
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: OwnerTheme.colors.borderLight,
  },
  modalDetailSubLabel: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
  },
  modalDetailSubVal: {
    fontSize: 12,
    fontWeight: '500',
    color: OwnerTheme.colors.textPrimary,
  },
});
