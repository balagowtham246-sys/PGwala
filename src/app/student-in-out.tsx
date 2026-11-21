import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Href, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  LogIn,
  LogOut,
  Search,
  UserPlus,
  Utensils,
  X,
} from 'lucide-react-native';

import { GateHistoryModal } from '@/components/student-gate/GateHistoryModal';
import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useProperty } from '@/context/property-context';
import { extractErrorMessage } from '@/lib/error-utils';
import { supabase } from '@/lib/supabase';
import { RoleBottomNav } from '@/components/ui/bottom-nav';
import {
  groupLogsByLocalDay,
  isLateReturn,
  sortLogsDescending,
} from '@/lib/movement-utils';
import {
  formatGateEventTimestamp,
  toSentenceCaseStatus,
} from '@/lib/ux-utils';
import {
  OwnerHeader,
  StatisticCard,
  StatusBadge,
  SegmentedFilter,
  EmptyState,
  ErrorState,
} from '@/components/ui/owner';

// --- Types ---
export type ResidentStatus = 'IN' | 'OUT';

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
  property_id?: string;
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

export default function StudentInOutScreen() {
  const { user } = useAuth();
  const { selectedProperty, selectedPropertyId } = useProperty();
  const params = useLocalSearchParams<{ residentId?: string | string[] }>();
  const rawParamResidentId = Array.isArray(params.residentId)
    ? params.residentId[0]
    : params.residentId;
  const paramResidentId = rawParamResidentId?.trim() || null;

  const userId = user?.id;
  const activeSelectedPropertyId = selectedPropertyId;
  const activeSelectedPropertyName = selectedProperty?.name;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [propertyName, setPropertyName] = useState('Shalom Residency');

  const [residents, setResidents] = useState<ResidentRecord[]>([]);
  const [allResidents, setAllResidents] = useState<ResidentRecord[]>([]);
  const [logs, setLogs] = useState<MovementLogRecord[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
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
  type FilterTab = 'ALL' | 'OUT' | 'IN';
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
  const [referenceTimeMs, setReferenceTimeMs] = useState(() => Date.now());

  const loadData = useCallback(async () => {
    try {
      setErrorMessage(null);

      // 1. Resolve active property ID & name
      let activePropId = activeSelectedPropertyId;
      let activePropName = activeSelectedPropertyName;

      if (!activePropId) {
        let query = supabase
          .from('properties')
          .select('id, name')
          .eq('is_active', true);

        if (userId) {
          query = query.eq('owner_id', userId);
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

      // 3. Fetch movement logs directly scoped by property_id
      let { data: logsData, error: logsError } = await supabase
        .from('movement_logs')
        .select(
          'id, resident_id, property_id, direction, event_time, note, purpose, expected_return_time, food_required, recorded_by'
        )
        .eq('property_id', activePropId)
        .order('event_time', { ascending: false })
        .limit(100);

      // Backwards-compatibility fallback if property_id was not yet backfilled
      if (
        !logsError &&
        (!logsData || logsData.length === 0) &&
        allResidentIds.length > 0
      ) {
        const { data: fallbackData } = await supabase
          .from('movement_logs')
          .select(
            'id, resident_id, property_id, direction, event_time, note, purpose, expected_return_time, food_required, recorded_by'
          )
          .in('resident_id', allResidentIds)
          .order('event_time', { ascending: false })
          .limit(100);

        if (fallbackData && fallbackData.length > 0) {
          logsData = fallbackData;
        }
      }

      if (logsError) throw logsError;

      setLogs(sortLogsDescending(logsData ?? []));
      setReferenceTimeMs(Date.now());
    } catch (err: unknown) {
      const msg = extractErrorMessage(err, 'Could not load gate logs.');
      console.error('[StudentInOut] Error fetching data:', err);
      setErrorMessage(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId, activeSelectedPropertyId, activeSelectedPropertyName]);

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
    return latest ? latest.direction : 'IN';
  };

  // Live count derivation
  const counts = residents.reduce(
    (acc, r) => {
      const status = getResidentCurrentStatus(r.id);
      if (status === 'IN') acc.inside += 1;
      else acc.outside += 1;
      return acc;
    },
    { inside: 0, outside: 0 }
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

  const lateReturnCount = residents.reduce((acc, r) => {
    const status = getResidentCurrentStatus(r.id);
    const latest = getLatestResidentLog(r.id);
    if (status === 'OUT' && latest && isLateReturn(latest.expected_return_time)) {
      return acc + 1;
    }
    return acc;
  }, 0);

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredResidents = residents.filter((r) => {
    if (activeResidentFilterId && r.id !== activeResidentFilterId) return false;
    const status = getResidentCurrentStatus(r.id);
    if (activeTab === 'OUT' && status !== 'OUT') return false;
    if (activeTab === 'IN' && status !== 'IN') return false;
    if (normalizedSearch) {
      const matchesName = r.full_name.toLowerCase().includes(normalizedSearch);
      const matchesRoom = r.room_number.toLowerCase().includes(normalizedSearch);
      return matchesName || matchesRoom;
    }
    return true;
  });

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

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
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
        keyboardShouldPersistTaps="handled"
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
            label="Inside"
            value={counts.inside}
            accentColor={OwnerTheme.colors.success}
            icon={LogIn}
            sublabel="Checked in"
            onPress={() => setActiveTab('IN')}
          />
          <StatisticCard
            label="Outside"
            value={counts.outside}
            accentColor={OwnerTheme.colors.warning}
            icon={LogOut}
            sublabel="Checked out"
            onPress={() => setActiveTab('OUT')}
          />
          <StatisticCard
            label="Dinner"
            value={mealsRequiredCount}
            accentColor={OwnerTheme.colors.primary}
            icon={Utensils}
            sublabel={`${counts.inside} in + ${outsideMealsCount} out`}
          />
        </View>

        {/* Late Return Alert Strip (only shown when overdue returns exist) */}
        {lateReturnCount > 0 && (
          <View style={styles.lateAlertRow}>
            <View style={styles.lateChip}>
              <Text style={styles.lateChipText}>
                {lateReturnCount} late return{lateReturnCount > 1 ? 's' : ''}
              </Text>
            </View>
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
            { key: 'OUT', label: 'Outside', count: counts.outside },
            { key: 'IN', label: 'Inside', count: counts.inside },
          ]}
          activeKey={activeTab}
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

        {/* Residents Roster */}
        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color={OwnerTheme.colors.primary} />
            <Text style={styles.loadingText}>Loading attendance roster...</Text>
          </View>
        ) : filteredResidents.length === 0 ? (
          normalizedSearch ? (
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
                activeTab === 'OUT'
                  ? 'No residents are currently marked outside.'
                  : activeTab === 'IN'
                  ? 'No residents are currently marked inside.'
                  : 'No active residents registered in this property.'
              }
            />
          )
        ) : (
          <View style={styles.residentsList}>
            {filteredResidents.map((resident) => {
              const currentStatus = getResidentCurrentStatus(resident.id);
              const latestLog = getLatestResidentLog(resident.id);
              const isInside = currentStatus === 'IN';
              const isOutside = currentStatus === 'OUT';
              const isLate = Boolean(
                isOutside && latestLog && isLateReturn(latestLog.expected_return_time)
              );

              return (
                <View
                  key={resident.id}
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
                      <View style={{ flex: 1, paddingRight: 8 }}>
                        <Text style={styles.residentName}>
                          {resident.full_name}
                        </Text>
                        <Text style={styles.residentRoom}>
                          Room {resident.room_number}
                        </Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        {isLate && (
                          <StatusBadge
                            label={toSentenceCaseStatus('late')}
                            variant="danger"
                            size="sm"
                          />
                        )}
                        <StatusBadge
                          label={toSentenceCaseStatus(isInside ? 'inside' : 'outside')}
                          variant={isInside ? 'success' : 'warning'}
                          size="sm"
                        />
                      </View>
                    </View>

                    {/* Clean information rows */}
                    {isOutside && latestLog ? (
                      <View style={styles.detailsBox}>
                        <View style={styles.detailRow}>
                          <Text style={styles.detailLabel}>Checked out:</Text>
                          <Text style={styles.detailValue}>
                            {formatGateEventTimestamp(latestLog.event_time)}
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
                          <Text
                            style={[
                              styles.detailValue,
                              !latestLog && { color: OwnerTheme.colors.textMuted },
                            ]}>
                            {latestLog
                              ? formatGateEventTimestamp(latestLog.event_time)
                              : 'No gate logs yet'}
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
                </View>
              );
            })}
          </View>
        )}

        {/* Recent Event History Section (Latest 3 events) */}
        <View style={styles.historySectionHeader}>
          <Text style={styles.historySectionTitle}>Recent Event History</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setReferenceTimeMs(Date.now());
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
      </ScrollView>

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
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  lateChipText: {
    fontSize: 11,
    fontWeight: '700',
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
});
