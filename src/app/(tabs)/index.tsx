import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  DoorOpen,
  Utensils,
  Receipt,
  Wrench,
  User,
  ArrowRight,
  LogIn,
  LogOut,
  Building2,
  ChevronDown,
  Check,
  Plus,
  X,
  BellRing,
  Disc3,
  Clock,
} from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/context/auth-context';
import { useProperty } from '@/context/property-context';
import { supabase } from '@/lib/supabase';
import { extractErrorMessage } from '@/lib/error-utils';
import {
  StatisticCard,
  SectionHeader,
  EmptyState,
  ErrorState,
} from '@/components/ui/owner';

// --- Types ---
interface ResidentRecord {
  id: string;
  full_name: string;
  room_number: string;
  property_id: string;
  is_active: boolean;
}

interface MovementLogRecord {
  id: string;
  resident_id: string;
  property_id?: string;
  direction: 'IN' | 'OUT';
  event_time: string;
  note: string | null;
  purpose?: string | null;
  expected_return_time?: string | null;
  food_required?: boolean;
}

interface ActivityItem {
  id: string;
  residentName: string;
  roomNumber: string;
  direction: 'IN' | 'OUT';
  purpose: string | null;
  time: string;
}

export type MealType = 'breakfast' | 'lunch' | 'dinner';

export interface OwnerFoodMenuRecord {
  id: string;
  meal_type: MealType;
  items: string;
  notes: string | null;
  is_published: boolean;
}

const MEAL_CONFIG: Record<
  MealType,
  { title: string; icon: string; timeHint: string }
> = {
  breakfast: {
    title: 'Breakfast',
    icon: '🍳',
    timeHint: 'Morning (7:30 AM – 9:30 AM)',
  },
  lunch: {
    title: 'Lunch',
    icon: '🍛',
    timeHint: 'Afternoon (12:30 PM – 2:30 PM)',
  },
  dinner: {
    title: 'Dinner',
    icon: '🍲',
    timeHint: 'Night (8:00 PM – 10:00 PM)',
  },
};

function toLocalIsoDate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export interface DashboardWmUnit {
  id: string;
  property_id: string;
  machine_number: number;
  machine_name: string;
  is_active: boolean;
  status: 'free' | 'in_use';
  current_resident_id: string | null;
  current_resident_name: string | null;
  current_resident_room: string | null;
  started_at: string | null;
  updated_at: string;
}

function formatElapsed(startedAtIso: string | null): string {
  if (!startedAtIso) return '';
  try {
    const started = new Date(startedAtIso).getTime();
    const diff = Math.max(0, Math.floor((Date.now() - started) / 60000));
    if (diff < 1) return 'Just started';
    if (diff < 60) return `${diff} min${diff === 1 ? '' : 's'} ago`;
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    return `${h}h ${m}m ago`;
  } catch {
    return '';
  }
}

interface TodayMenuSummary {
  breakfast: boolean;
  lunch: boolean;
  dinner: boolean;
}

export default function OwnerDashboard() {
  const { user, session, profile, isLoading: authLoading, signOut } = useAuth();
  const {
    properties,
    selectedProperty,
    selectedPropertyId,
    selectProperty,
    addProperty,
    refreshProperties,
  } = useProperty();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Property Switcher Modal State
  const [switcherVisible, setSwitcherVisible] = useState(false);
  const [showAddPropertyModal, setShowAddPropertyModal] = useState(false);
  const [newPropName, setNewPropName] = useState('');
  const [newPropAddress, setNewPropAddress] = useState('');
  const [creatingProperty, setCreatingProperty] = useState(false);

  // Key Operational State (Gate, Menu, Complaints)
  const [stats, setStats] = useState({
    totalResidents: 0,
    studentsInside: 0,
    studentsOutside: 0,
    openComplaintsCount: 0,
  });

  const [todayMenu, setTodayMenu] = useState<TodayMenuSummary>({
    breakfast: false,
    lunch: false,
    dinner: false,
  });

  const [todayMenus, setTodayMenus] = useState<Record<MealType, OwnerFoodMenuRecord | null>>({
    breakfast: null,
    lunch: null,
    dinner: null,
  });
  const [activeMealTab, setActiveMealTab] = useState<MealType>('breakfast');

  // Live Washing Machine Status State
  const [wmSummary, setWmSummary] = useState({
    totalCount: 0,
    inUseCount: 0,
    freeCount: 0,
  });
  const [wmUnits, setWmUnits] = useState<DashboardWmUnit[]>([]);
  const [wmModalVisible, setWmModalVisible] = useState(false);
  const [releasingMachineId, setReleasingMachineId] = useState<string | null>(null);

  const [recentActivities, setRecentActivities] = useState<ActivityItem[]>([]);

  // Non-college Departure In-App Push Alert State
  const [departureAlert, setDepartureAlert] = useState<{
    residentName: string;
    roomNumber: string;
    purpose: string;
    time: string;
  } | null>(null);

  // Anti-flooding: Track recent alert timestamps per resident (15-min throttle)
  const alertThrottleRef = useRef<Map<string, number>>(new Map());

  // ISO string for today 'YYYY-MM-DD' (local calendar date matching food_menus)
  const todayIsoDate = toLocalIsoDate();

  // Instant render from cache (stale-while-revalidate for slow networks)
  useEffect(() => {
    if (!selectedPropertyId) return;
    void (async () => {
      try {
        const cached = await AsyncStorage.getItem(`owner_dash_cache_${selectedPropertyId}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed?.stats) setStats(parsed.stats);
          if (parsed?.recentActivities) setRecentActivities(parsed.recentActivities);
          if (parsed?.washingMachines) {
            setWmSummary({
              totalCount: parsed.washingMachines.totalCount || 0,
              inUseCount: parsed.washingMachines.inUseCount || 0,
              freeCount: parsed.washingMachines.freeCount || 0,
            });
            setWmUnits(parsed.washingMachines.units || []);
          }
        }
      } catch {
        // Cache miss/parse fail
      }
    })();
  }, [selectedPropertyId]);

  // Fetch operational dashboard data scoped to the active selected property
  const loadDashboardData = useCallback(async () => {
    if (!user?.id || profile?.role !== 'owner' || !selectedPropertyId) {
      setLoading(false);
      return;
    }

    try {
      setErrorMessage(null);

      // Fast Path: Single-roundtrip composite SQL RPC
      const { data: summaryRpc, error: rpcError } = await supabase.rpc(
        'get_owner_dashboard_summary',
        {
          p_property_id: selectedPropertyId,
          p_date: todayIsoDate,
        }
      );

      if (!rpcError && summaryRpc?.success) {
        if (summaryRpc.stats) setStats(summaryRpc.stats);
        if (summaryRpc.recentActivities) setRecentActivities(summaryRpc.recentActivities);

        if (summaryRpc.todayMenus) {
          const menuMap: Record<MealType, OwnerFoodMenuRecord | null> = {
            breakfast: null,
            lunch: null,
            dinner: null,
          };
          const summary: TodayMenuSummary = { breakfast: false, lunch: false, dinner: false };
          for (const m of summaryRpc.todayMenus as OwnerFoodMenuRecord[]) {
            if (['breakfast', 'lunch', 'dinner'].includes(m.meal_type)) {
              menuMap[m.meal_type] = m;
              if (m.is_published) summary[m.meal_type] = true;
            }
          }
          setTodayMenus(menuMap);
          setTodayMenu(summary);
        }

        if (summaryRpc.washingMachines) {
          setWmSummary({
            totalCount: summaryRpc.washingMachines.totalCount || 0,
            inUseCount: summaryRpc.washingMachines.inUseCount || 0,
            freeCount: summaryRpc.washingMachines.freeCount || 0,
          });
          setWmUnits(summaryRpc.washingMachines.units || []);
        }

        void AsyncStorage.setItem(
          `owner_dash_cache_${selectedPropertyId}`,
          JSON.stringify(summaryRpc)
        );
        return;
      }

      // Fallback: Individual queries if RPC not yet deployed
      // 1. Fetch active residents of selected property
      const { data: residentsData, error: resError } = await supabase
        .from('residents')
        .select('id, full_name, room_number, property_id, is_active')
        .eq('property_id', selectedPropertyId);

      if (resError) throw resError;

      const allResidents: ResidentRecord[] = residentsData ?? [];
      const activeResidents = allResidents.filter((r) => r.is_active);
      const allResidentIds = allResidents.map((r) => r.id);

      if (allResidentIds.length === 0) {
        setStats({
          totalResidents: 0,
          studentsInside: 0,
          studentsOutside: 0,
          openComplaintsCount: 0,
        });
        setRecentActivities([]);
        setLoading(false);
        return;
      }

      // 2. Fetch recent movement logs (optimized via direct property_id index)
      let { data: logsData, error: logsError } = await supabase
        .from('movement_logs')
        .select(
          'id, resident_id, property_id, direction, event_time, note, purpose, expected_return_time, food_required'
        )
        .eq('property_id', selectedPropertyId)
        .order('event_time', { ascending: false })
        .limit(60);

      // Backwards-compatibility fallback if property_id was not yet backfilled
      if (
        !logsError &&
        (!logsData || logsData.length === 0) &&
        allResidentIds.length > 0
      ) {
        const { data: fallbackData } = await supabase
          .from('movement_logs')
          .select(
            'id, resident_id, property_id, direction, event_time, note, purpose, expected_return_time, food_required'
          )
          .in('resident_id', allResidentIds)
          .order('event_time', { ascending: false })
          .limit(60);

        if (fallbackData && fallbackData.length > 0) {
          logsData = fallbackData;
        }
      }

      if (logsError) throw logsError;
      const logs: MovementLogRecord[] = logsData ?? [];

      // Calculate resident status based on newest log
      const latestStatusMap = new Map<string, MovementLogRecord>();
      for (const log of logs) {
        if (!latestStatusMap.has(log.resident_id)) {
          latestStatusMap.set(log.resident_id, log);
        }
      }

      let insideCount = 0;
      let outsideCount = 0;

      for (const res of activeResidents) {
        const latest = latestStatusMap.get(res.id);
        const direction = latest?.direction || 'IN';

        if (direction === 'IN') {
          insideCount += 1;
        } else {
          outsideCount += 1;
        }
      }

      // 3. Fetch today's food menu status and full item details
      try {
        const { data: menuData } = await supabase
          .from('food_menus')
          .select('id, meal_type, items, notes, is_published')
          .eq('property_id', selectedPropertyId)
          .eq('menu_date', todayIsoDate);

        const summary: TodayMenuSummary = {
          breakfast: false,
          lunch: false,
          dinner: false,
        };

        const menuMap: Record<MealType, OwnerFoodMenuRecord | null> = {
          breakfast: null,
          lunch: null,
          dinner: null,
        };

        if (menuData) {
          for (const m of menuData as OwnerFoodMenuRecord[]) {
            if (['breakfast', 'lunch', 'dinner'].includes(m.meal_type)) {
              menuMap[m.meal_type] = m;
              if (m.is_published) {
                summary[m.meal_type] = true;
              }
            }
          }
        }
        setTodayMenu(summary);
        setTodayMenus(menuMap);
      } catch (menuErr) {
        console.warn('[OwnerDashboard] Could not fetch food menu:', menuErr);
      }

      // 4. Fetch open maintenance complaints count
      let openComplaintsCount = 0;
      try {
        const { data: compData } = await supabase
          .from('complaints')
          .select('id')
          .eq('property_id', selectedPropertyId)
          .eq('status', 'open');

        if (compData) {
          openComplaintsCount = compData.length;
        }
      } catch (compErr) {
        console.warn('[OwnerDashboard] Could not fetch complaints count:', compErr);
      }

      setStats({
        totalResidents: activeResidents.length,
        studentsInside: insideCount,
        studentsOutside: outsideCount,
        openComplaintsCount,
      });

      // 5. Build recent activity feed (latest 3)
      const residentMap = new Map<string, ResidentRecord>();
      for (const r of allResidents) {
        residentMap.set(r.id, r);
      }

      const activities: ActivityItem[] = logs.slice(0, 2).map((log) => {
        const resident = residentMap.get(log.resident_id);
        const residentName = resident ? resident.full_name : 'Resident';
        const roomNumber = resident?.room_number || '';

        const eventDate = new Date(log.event_time);
        const timeFormatted = eventDate.toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        });

        return {
          id: log.id,
          residentName,
          roomNumber,
          direction: log.direction,
          purpose: log.purpose || null,
          time: timeFormatted,
        };
      });

      setRecentActivities(activities);

      // 6. Fetch washing machines for fallback
      try {
        const { data: wmList } = await supabase
          .from('washing_machines')
          .select(`
            id, property_id, machine_number, machine_name, is_active, status,
            current_resident_id, started_at, updated_at
          `)
          .eq('property_id', selectedPropertyId)
          .eq('is_active', true)
          .order('machine_number', { ascending: true });

        if (wmList && wmList.length > 0) {
          const mappedUnits: DashboardWmUnit[] = wmList.map((w: any) => {
            const res = w.current_resident_id ? residentMap.get(w.current_resident_id) : null;
            return {
              id: w.id,
              property_id: w.property_id,
              machine_number: w.machine_number,
              machine_name: w.machine_name,
              is_active: w.is_active,
              status: w.status,
              current_resident_id: w.current_resident_id,
              current_resident_name: res?.full_name || null,
              current_resident_room: res?.room_number || null,
              started_at: w.started_at,
              updated_at: w.updated_at,
            };
          });
          setWmUnits(mappedUnits);
          setWmSummary({
            totalCount: mappedUnits.length,
            inUseCount: mappedUnits.filter((u) => u.status === 'in_use').length,
            freeCount: mappedUnits.filter((u) => u.status === 'free').length,
          });
        }
      } catch (wmErr) {
        console.warn('[OwnerDashboard] Could not fetch washing machines:', wmErr);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[OwnerDashboard] Error loading data:', err);
      setErrorMessage(`Failed to load dashboard: ${msg}`);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id, profile?.role, selectedPropertyId, todayIsoDate]);

  useEffect(() => {
    if (authLoading) return;
    if (!session || !user?.id) {
      router.replace('/login');
      return;
    }
    if (profile?.role === 'owner') {
      loadDashboardData();
    }
  }, [authLoading, session, user?.id, profile?.role, loadDashboardData]);

  // Refetch latest operational status and menu whenever returning to dashboard
  useFocusEffect(
    useCallback(() => {
      if (!authLoading && user?.id && profile?.role === 'owner' && selectedPropertyId) {
        loadDashboardData();
      }
    }, [authLoading, user?.id, profile?.role, selectedPropertyId, loadDashboardData])
  );

  const handleOwnerReleaseWm = async (machineId: string, machineName: string) => {
    if (!selectedPropertyId) return;
    Alert.alert(
      'Release Machine',
      `Are you sure you want to mark ${machineName} as free? This will end the current resident's session.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark Free',
          style: 'destructive',
          onPress: async () => {
            try {
              setReleasingMachineId(machineId);
              const { error } = await supabase.rpc('release_washing_machine_unit', {
                p_property_id: selectedPropertyId,
                p_machine_id: machineId,
              });
              if (error) throw error;
              await loadDashboardData();
            } catch (err: unknown) {
              Alert.alert('Error', extractErrorMessage(err, 'Failed to release washing machine.'));
            } finally {
              setReleasingMachineId(null);
            }
          },
        },
      ]
    );
  };

  // Non-college Movement Realtime Push Listener
  useEffect(() => {
    if (!selectedPropertyId) return;

    const channel = supabase
      .channel(`non_college_alerts_${selectedPropertyId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'movement_logs',
          filter: `property_id=eq.${selectedPropertyId}`,
        },
        async (payload) => {
          const newLog = payload.new as MovementLogRecord;
          if (newLog.direction === 'OUT') {
            const rawPurpose = (newLog.purpose || '').trim().toLowerCase();
            const isCollege =
              rawPurpose === 'college' ||
              rawPurpose.includes('college') ||
              rawPurpose.includes('class');

            // Non-college departure detected
            if (!isCollege) {
              // 1. Fetch resident details and strictly enforce property isolation
              const { data: res } = await supabase
                .from('residents')
                .select('id, full_name, room_number, property_id')
                .eq('id', newLog.resident_id)
                .single();

              // Ignore alerts for residents belonging to other properties
              if (!res || res.property_id !== selectedPropertyId) {
                return;
              }

              // 2. Read owner notification preferences from storage
              let nonCollegeEnabled = true;
              let eveningOnly = true;
              let rateLimitEnabled = true;

              try {
                const prefsStr = await AsyncStorage.getItem(
                  '@pgwala_owner_notif_prefs'
                );
                if (prefsStr) {
                  const prefs = JSON.parse(prefsStr);
                  if (typeof prefs.nonCollegeAlerts === 'boolean')
                    nonCollegeEnabled = prefs.nonCollegeAlerts;
                  if (typeof prefs.eveningOnly === 'boolean')
                    eveningOnly = prefs.eveningOnly;
                  if (typeof prefs.rateLimitEnabled === 'boolean')
                    rateLimitEnabled = prefs.rateLimitEnabled;
                }
              } catch {
                // Keep defaults if prefs failed to load
              }

              // If non-college alerts disabled by owner, refresh stats silently without showing alert banner
              if (!nonCollegeEnabled) {
                loadDashboardData();
                return;
              }

              // If evening only is enabled, only alert after 6:00 PM (18:00) or before 6:00 AM
              if (eveningOnly) {
                const currentHour = new Date().getHours();
                const isEveningOrNight = currentHour >= 18 || currentHour < 6;
                if (!isEveningOrNight) {
                  loadDashboardData();
                  return;
                }
              }

              // Anti-flooding throttle: Skip if alerted within 15 minutes for this resident
              const now = Date.now();
              if (rateLimitEnabled) {
                const lastAlertTime =
                  alertThrottleRef.current.get(newLog.resident_id) || 0;
                if (now - lastAlertTime < 15 * 60 * 1000) {
                  loadDashboardData();
                  return;
                }
              }
              alertThrottleRef.current.set(newLog.resident_id, now);

              const resName = res.full_name || 'Resident';
              const resRoom = res.room_number || '';
              const eventDate = new Date(newLog.event_time);
              const formattedTime = eventDate.toLocaleTimeString('en-IN', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
              });

              setDepartureAlert({
                residentName: resName,
                roomNumber: resRoom,
                purpose: newLog.purpose || 'Personal Outing',
                time: formattedTime,
              });

              // Also refresh dashboard stats in background
              loadDashboardData();
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedPropertyId, loadDashboardData]);

  const handleRefresh = () => {
    setRefreshing(true);
    loadDashboardData();
  };

  // Add new PG property from modal
  const handleCreateProperty = async () => {
    const trimmed = newPropName.trim();
    if (!trimmed) {
      Alert.alert('Required', 'Please enter a PG property name.');
      return;
    }

    try {
      setCreatingProperty(true);
      await addProperty(trimmed, newPropAddress.trim() || undefined);
      setShowAddPropertyModal(false);
      setSwitcherVisible(false);
      setNewPropName('');
      setNewPropAddress('');
      Alert.alert('Property Added', `Switched to "${trimmed}".`);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not add property.');
    } finally {
      setCreatingProperty(false);
    }
  };

  // Auth Loading
  if (authLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.authLoadingContainer}>
          <ActivityIndicator size="large" color={OwnerTheme.colors.primary} />
          <Text style={styles.authNoticeText}>Initializing session...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Non-College Departure Push Alert Banner */}
      {departureAlert && (
        <View style={styles.pushAlertBanner}>
          <View style={styles.pushAlertIconWrap}>
            <BellRing size={16} color="#B91C1C" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.pushAlertTitle}>
              Departure Alert: {departureAlert.residentName} (Room{' '}
              {departureAlert.roomNumber})
            </Text>
            <Text style={styles.pushAlertText}>
              Left for: {departureAlert.purpose} at {departureAlert.time}
            </Text>
          </View>
          <Pressable
            hitSlop={8}
            onPress={() => setDepartureAlert(null)}
            style={styles.pushAlertClose}>
            <X size={16} color="#7F1D1D" />
          </Pressable>
        </View>
      )}

      {/* Top Header: Brand + Global Property Switcher + Account */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Text style={styles.brandTitle}>PGwala</Text>
        </View>

        {/* Global Property Switcher Pill */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Switch active property"
          style={({ pressed }) => [
            styles.propertySwitcherPill,
            pressed && styles.cardPressed,
          ]}
          onPress={() => setSwitcherVisible(true)}>
          <Building2 size={15} color={OwnerTheme.colors.primary} />
          <Text style={styles.propertySwitcherText} numberOfLines={1}>
            {selectedProperty?.name || 'Select PG'}
          </Text>
          <ChevronDown size={14} color={OwnerTheme.colors.textSecondary} />
        </Pressable>

        {/* Dedicated Account Button */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Account and Settings"
          style={({ pressed }) => [
            styles.accountBtn,
            pressed && styles.cardPressed,
          ]}
          onPress={() => router.push('/owner-settings')}>
          <User size={18} color={OwnerTheme.colors.primary} />
        </Pressable>
      </View>

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
          <ErrorState message={errorMessage} onRetry={loadDashboardData} />
        )}

        {/* Priority Area 1: Live Gate Status (Side-by-side Hero Row) */}
        <View style={styles.gateStatsRow}>
          <StatisticCard
            label="Inside PG"
            value={stats.studentsInside}
            accentColor={OwnerTheme.colors.success}
            icon={LogIn}
            sublabel="Present in PG"
            onPress={() => router.push('/student-in-out')}
            style={styles.gateStatHalfCard}
          />
          <StatisticCard
            label="Outside PG"
            value={stats.studentsOutside}
            accentColor={OwnerTheme.colors.warning}
            icon={LogOut}
            sublabel="Checked out"
            onPress={() => router.push('/student-in-out')}
            style={styles.gateStatHalfCard}
          />
        </View>

        {/* Priority Area 1b: Live Washing Machine Summary Card */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="View washing machine usage"
          style={({ pressed }) => [
            styles.wmSummaryCard,
            pressed && styles.cardPressed,
          ]}
          onPress={() => setWmModalVisible(true)}>
          <View style={styles.wmSummaryLeft}>
            <View style={styles.wmIconBadge}>
              <Disc3 size={18} color="#0284C7" />
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.wmSummaryTitle}>Washing Machines</Text>
                {wmSummary.inUseCount > 0 ? (
                  <View style={styles.wmActiveChip}>
                    <Text style={styles.wmActiveChipText}>{wmSummary.inUseCount} In Use</Text>
                  </View>
                ) : (
                  <View style={styles.wmAllFreeChip}>
                    <Text style={styles.wmAllFreeChipText}>All Free</Text>
                  </View>
                )}
              </View>
              <Text style={styles.wmSummarySub}>
                {wmSummary.totalCount > 0
                  ? `${wmSummary.inUseCount} active • ${wmSummary.freeCount} available of ${wmSummary.totalCount} units`
                  : 'Tap to view live machine usage'}
              </Text>
            </View>
          </View>
          <View style={styles.wmSummaryRight}>
            <Text style={styles.wmViewUsageBtnText}>View Usage ›</Text>
          </View>
        </Pressable>

        {/* Priority Area 2: Food Menu Today (Resident-Style In-Place Interactive Card) */}
        <View style={styles.menuCard}>
          <View style={styles.menuHeader}>
            <View style={styles.menuHeaderLeft}>
              <View style={styles.menuIconContainer}>
                <Utensils size={16} color={OwnerTheme.colors.primary} />
              </View>
              <View>
                <Text style={styles.menuTitle}>Today&apos;s Food Menu</Text>
                <Text style={styles.menuSubtitle}>
                  {new Date().toLocaleDateString('en-IN', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                  })}
                </Text>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.menuManageBtn,
                pressed && styles.cardPressed,
              ]}
              onPress={() => router.push('/food-menu')}>
              <Text style={styles.menuManageBtnText}>Manage Menu ›</Text>
            </Pressable>
          </View>

          {/* 3-Chip Meal Selector */}
          <View style={styles.mealSegmentRow}>
            {(['breakfast', 'lunch', 'dinner'] as MealType[]).map((mealKey) => {
              const cfg = MEAL_CONFIG[mealKey];
              const menuRecord = todayMenus[mealKey];
              const isSelected = activeMealTab === mealKey;
              const isPublished = Boolean(menuRecord?.is_published);
              const hasDraft = Boolean(menuRecord && !menuRecord.is_published);

              return (
                <Pressable
                  key={mealKey}
                  accessibilityRole="button"
                  style={[
                    styles.mealSegmentChip,
                    isSelected && styles.mealSegmentChipSelected,
                  ]}
                  onPress={() => setActiveMealTab(mealKey)}>
                  <Text style={styles.mealChipEmoji}>{cfg.icon}</Text>
                  <Text
                    style={[
                      styles.mealChipText,
                      isSelected && styles.mealChipTextSelected,
                    ]}>
                    {cfg.title}
                  </Text>
                  <View
                    style={[
                      styles.mealStatusIndicator,
                      isPublished
                        ? styles.indicatorPublished
                        : hasDraft
                        ? styles.indicatorDraft
                        : styles.indicatorEmpty,
                    ]}>
                    <Text
                      style={[
                        styles.indicatorText,
                        isPublished
                          ? styles.indicatorTextPublished
                          : hasDraft
                          ? styles.indicatorTextDraft
                          : styles.indicatorTextEmpty,
                      ]}>
                      {isPublished ? '✓' : hasDraft ? 'Draft' : '—'}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          {/* In-Place Selected Meal Details */}
          <View style={styles.mealDetailBox}>
            <View style={styles.mealDetailTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.mealDetailTitle}>
                  {MEAL_CONFIG[activeMealTab].title}
                </Text>
                <Text style={styles.mealDetailTime}>
                  {MEAL_CONFIG[activeMealTab].timeHint}
                </Text>
              </View>
              {todayMenus[activeMealTab] ? (
                <View
                  style={[
                    styles.detailBadge,
                    todayMenus[activeMealTab]!.is_published
                      ? styles.detailBadgePublished
                      : styles.detailBadgeDraft,
                  ]}>
                  <View
                    style={[
                      styles.detailDot,
                      {
                        backgroundColor: todayMenus[activeMealTab]!.is_published
                          ? '#16A34A'
                          : '#F59E0B',
                      },
                    ]}
                  />
                  <Text
                    style={[
                      styles.detailBadgeText,
                      {
                        color: todayMenus[activeMealTab]!.is_published
                          ? '#15803D'
                          : '#B45309',
                      },
                    ]}>
                    {todayMenus[activeMealTab]!.is_published ? 'Published' : 'Draft'}
                  </Text>
                </View>
              ) : (
                <View style={styles.detailBadgeNotSet}>
                  <Text style={styles.detailBadgeNotSetText}>Not Configured</Text>
                </View>
              )}
            </View>

            {todayMenus[activeMealTab] ? (
              <View style={styles.mealItemsContainer}>
                <Text style={styles.mealItemsText}>
                  {todayMenus[activeMealTab]!.items}
                </Text>
                {todayMenus[activeMealTab]!.notes ? (
                  <Text style={styles.mealNotesText}>
                    Note: {todayMenus[activeMealTab]!.notes}
                  </Text>
                ) : null}
              </View>
            ) : (
              <View style={styles.noMenuContainer}>
                <Text style={styles.noMenuText}>
                  No menu set for {MEAL_CONFIG[activeMealTab].title.toLowerCase()} today.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  style={styles.addMenuInlineBtn}
                  onPress={() => router.push('/food-menu')}>
                  <Text style={styles.addMenuInlineBtnText}>+ Add {MEAL_CONFIG[activeMealTab].title}</Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>

        {/* Priority Area 3: Handy Quick Actions Grid (2x2 Compact) */}
        <View style={styles.quickGrid}>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.quickCard,
              pressed && styles.cardPressed,
            ]}
            onPress={() => router.push('/student-in-out')}>
            <View
              style={[
                styles.quickIconWrap,
                { backgroundColor: OwnerTheme.colors.successLight },
              ]}>
              <DoorOpen size={20} color={OwnerTheme.colors.success} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.quickTitle}>Gate Attendance</Text>
              <Text style={styles.quickSub}>Movement & dinner list</Text>
            </View>
            <ArrowRight size={15} color={OwnerTheme.colors.textMuted} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.quickCard,
              pressed && styles.cardPressed,
            ]}
            onPress={() => router.push('/food-menu')}>
            <View
              style={[
                styles.quickIconWrap,
                { backgroundColor: OwnerTheme.colors.primaryLight },
              ]}>
              <Utensils size={20} color={OwnerTheme.colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.quickTitle}>Food Menu</Text>
              <Text style={styles.quickSub}>Daily meal planner</Text>
            </View>
            <ArrowRight size={15} color={OwnerTheme.colors.textMuted} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.quickCard,
              pressed && styles.cardPressed,
            ]}
            onPress={() => router.push('/billing-management')}>
            <View
              style={[
                styles.quickIconWrap,
                { backgroundColor: '#F1F5F9' },
              ]}>
              <Receipt size={20} color={OwnerTheme.colors.textPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.quickTitle}>Rent & Bills</Text>
              <Text style={styles.quickSub}>Monthly collections</Text>
            </View>
            <ArrowRight size={15} color={OwnerTheme.colors.textMuted} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.quickCard,
              pressed && styles.cardPressed,
            ]}
            onPress={() => router.push('/owner-complaints')}>
            <View
              style={[
                styles.quickIconWrap,
                {
                  backgroundColor:
                    stats.openComplaintsCount > 0
                      ? OwnerTheme.colors.warningLight
                      : '#F1F5F9',
                },
              ]}>
              <Wrench
                size={20}
                color={
                  stats.openComplaintsCount > 0
                    ? OwnerTheme.colors.warning
                    : OwnerTheme.colors.textSecondary
                }
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.quickTitle}>Maintenance</Text>
              <Text style={styles.quickSub}>
                {stats.openComplaintsCount > 0
                  ? `${stats.openComplaintsCount} open issues`
                  : 'All resolved'}
              </Text>
            </View>
            <ArrowRight size={15} color={OwnerTheme.colors.textMuted} />
          </Pressable>
        </View>

        {/* Priority Area 4: Recent Gate Movements */}
        <SectionHeader
          title="Recent Movement"
          actionText="View all ›"
          onAction={() => router.push('/student-in-out')}
          style={{ marginTop: 12, marginBottom: 8 }}
        />

        <View style={styles.activityCard}>
          {loading ? (
            <View style={styles.activityLoading}>
              <ActivityIndicator size="small" color={OwnerTheme.colors.primary} />
            </View>
          ) : recentActivities.length === 0 ? (
            <EmptyState
              title="No recent movements"
              description="Student gate check-ins and check-outs will display here."
            />
          ) : (
            recentActivities.map((item, index) => {
              const isEntry = item.direction === 'IN';
              return (
                <View
                  key={item.id}
                  style={[
                    styles.activityRow,
                    index === recentActivities.length - 1 &&
                      styles.activityRowLast,
                  ]}>
                  <View
                    style={[
                      styles.activityIconCircle,
                      {
                        backgroundColor: isEntry
                          ? OwnerTheme.colors.successLight
                          : OwnerTheme.colors.warningLight,
                      },
                    ]}>
                    {isEntry ? (
                      <LogIn size={14} color={OwnerTheme.colors.success} />
                    ) : (
                      <LogOut size={14} color={OwnerTheme.colors.warning} />
                    )}
                  </View>
                  <View style={styles.activityDetails}>
                    <Text style={styles.activityResidentName}>
                      {item.residentName} (Room {item.roomNumber})
                    </Text>
                    <Text style={styles.activityActionText}>
                      marked {item.direction}
                      {item.purpose ? ` • ${item.purpose}` : ''}
                    </Text>
                  </View>
                  <Text style={styles.activityTimeText}>{item.time}</Text>
                </View>
              );
            })
          )}
        </View>

        <View style={{ height: 24 }} />
      </ScrollView>

      {/* Global Property Switcher Modal */}
      <Modal
        visible={switcherVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSwitcherVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.switcherModalCard}>
            <View style={styles.switcherModalHeader}>
              <Text style={styles.switcherModalTitle}>Switch PG Property</Text>
              <Pressable hitSlop={8} onPress={() => setSwitcherVisible(false)}>
                <X size={20} color={OwnerTheme.colors.textSecondary} />
              </Pressable>
            </View>
            <Text style={styles.switcherModalSub}>
              Select which accommodation to view and manage:
            </Text>

            <ScrollView style={{ maxHeight: 260 }}>
              {properties.map((prop) => {
                const isSelected = prop.id === selectedPropertyId;
                return (
                  <Pressable
                    key={prop.id}
                    style={[
                      styles.propertyItemRow,
                      isSelected && styles.propertyItemRowSelected,
                    ]}
                    onPress={async () => {
                      await selectProperty(prop.id);
                      setSwitcherVisible(false);
                    }}>
                    <Building2
                      size={18}
                      color={
                        isSelected
                          ? OwnerTheme.colors.primary
                          : OwnerTheme.colors.textSecondary
                      }
                      style={{ marginRight: 10 }}
                    />
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.propertyNameItem,
                          isSelected && styles.propertyNameItemSelected,
                        ]}>
                        {prop.name}
                      </Text>
                      {prop.address ? (
                        <Text style={styles.propertyAddressItem} numberOfLines={1}>
                          {prop.address}
                        </Text>
                      ) : null}
                    </View>
                    {isSelected && (
                      <Check size={18} color={OwnerTheme.colors.primary} />
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>

            <Pressable
              style={styles.addPropertyBtn}
              onPress={() => setShowAddPropertyModal(true)}>
              <Plus size={16} color={OwnerTheme.colors.primary} />
              <Text style={styles.addPropertyBtnText}>Add Another PG Property</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Add New Property Sub-Modal */}
      <Modal
        visible={showAddPropertyModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAddPropertyModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.switcherModalCard}>
            <View style={styles.switcherModalHeader}>
              <Text style={styles.switcherModalTitle}>Add New PG Property</Text>
              <Pressable
                hitSlop={8}
                onPress={() => setShowAddPropertyModal(false)}>
                <X size={20} color={OwnerTheme.colors.textSecondary} />
              </Pressable>
            </View>

            <Text style={styles.inputLabel}>PG Name *</Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g. Shalom Girls PG"
              placeholderTextColor={OwnerTheme.colors.textMuted}
              value={newPropName}
              onChangeText={setNewPropName}
            />

            <Text style={styles.inputLabel}>Address (Optional)</Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g. Street 4, College Road"
              placeholderTextColor={OwnerTheme.colors.textMuted}
              value={newPropAddress}
              onChangeText={setNewPropAddress}
            />

            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalCancelBtn}
                onPress={() => setShowAddPropertyModal(false)}>
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.modalConfirmBtn,
                  creatingProperty && { opacity: 0.6 },
                ]}
                disabled={creatingProperty}
                onPress={handleCreateProperty}>
                {creatingProperty ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalConfirmBtnText}>Create PG</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Washing Machine Live Usage Popup Modal */}
      <Modal
        visible={wmModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setWmModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.wmModalContent}>
            <View style={styles.wmModalHeader}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Disc3 size={18} color="#0284C7" />
                  <Text style={styles.wmModalTitle}>Washing Machine Units</Text>
                </View>
                <Text style={styles.wmModalSubtitle} numberOfLines={1}>
                  {selectedProperty?.name || 'Live Usage'} • {wmSummary.inUseCount} in use, {wmSummary.freeCount} free
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => setWmModalVisible(false)}>
                <X size={20} color={OwnerTheme.colors.textMuted} />
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
              {wmUnits.length === 0 ? (
                <View style={styles.wmModalEmpty}>
                  <Text style={styles.wmModalEmptyText}>No active washing machines configured.</Text>
                  <Pressable
                    style={styles.configureWmBtn}
                    onPress={() => {
                      setWmModalVisible(false);
                      router.push('/owner-settings');
                    }}>
                    <Text style={styles.configureWmBtnText}>Configure in Settings ›</Text>
                  </Pressable>
                </View>
              ) : (
                wmUnits.map((unit) => {
                  const isInUse = unit.status === 'in_use';
                  const isReleasing = releasingMachineId === unit.id;
                  return (
                    <View key={unit.id} style={styles.wmUnitRow}>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text style={styles.wmUnitName}>{unit.machine_name}</Text>
                          <View
                            style={[
                              styles.wmStatusBadge,
                              isInUse ? styles.wmStatusInUse : styles.wmStatusFree,
                            ]}>
                            <View
                              style={[
                                styles.wmStatusDot,
                                { backgroundColor: isInUse ? '#DC2626' : '#16A34A' },
                              ]}
                            />
                            <Text
                              style={[
                                styles.wmStatusText,
                                { color: isInUse ? '#B91C1C' : '#15803D' },
                              ]}>
                              {isInUse ? 'In Use' : 'Free'}
                            </Text>
                          </View>
                        </View>

                        {isInUse ? (
                          <View style={styles.wmInUseDetails}>
                            <Text style={styles.wmOccupantText}>
                              👤 {unit.current_resident_name || 'Resident'}
                              {unit.current_resident_room ? ` (Room ${unit.current_resident_room})` : ''}
                            </Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                              <Clock size={12} color="#64748B" />
                              <Text style={styles.wmDurationText}>
                                {formatElapsed(unit.started_at)}
                              </Text>
                            </View>
                          </View>
                        ) : (
                          <Text style={styles.wmFreeSub}>Machine is idle and available.</Text>
                        )}
                      </View>

                      {isInUse && (
                        <Pressable
                          accessibilityRole="button"
                          style={[styles.forceFreeBtn, isReleasing && styles.forceFreeBtnDisabled]}
                          disabled={isReleasing}
                          onPress={() => handleOwnerReleaseWm(unit.id, unit.machine_name)}>
                          {isReleasing ? (
                            <ActivityIndicator size="small" color="#DC2626" />
                          ) : (
                            <Text style={styles.forceFreeBtnText}>Mark Free</Text>
                          )}
                        </Pressable>
                      )}
                    </View>
                  );
                })
              )}
            </ScrollView>

            <View style={styles.wmModalFooter}>
              <Pressable
                accessibilityRole="button"
                style={styles.wmCloseBtn}
                onPress={() => setWmModalVisible(false)}>
                <Text style={styles.wmCloseBtnText}>Close</Text>
              </Pressable>
            </View>
          </View>
        </View>
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
    paddingHorizontal: 16,
    paddingTop: 8,
    maxWidth: 960,
    width: '100%',
    alignSelf: 'center',
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: OwnerTheme.colors.border,
    gap: 10,
  },
  headerLeft: {
    justifyContent: 'center',
  },
  brandTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: OwnerTheme.colors.primary,
    letterSpacing: -0.5,
  },
  propertySwitcherPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: OwnerTheme.radius.full,
    backgroundColor: OwnerTheme.colors.background,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    maxWidth: 240,
  },
  propertySwitcherText: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
    flex: 1,
  },
  accountBtn: {
    width: 38,
    height: 38,
    borderRadius: OwnerTheme.radius.full,
    backgroundColor: OwnerTheme.colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pushAlertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderBottomWidth: 1,
    borderBottomColor: '#FCA5A5',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  pushAlertIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FEE2E2',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pushAlertTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#991B1B',
  },
  pushAlertText: {
    fontSize: 11,
    color: '#B91C1C',
  },
  pushAlertClose: {
    padding: 4,
  },
  gateStatsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  gateStatHalfCard: {
    flex: 1,
  },
  wmSummaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 12,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  wmSummaryLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  wmIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E0F2FE',
    justifyContent: 'center',
    alignItems: 'center',
  },
  wmSummaryTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  wmActiveChip: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  wmActiveChipText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#DC2626',
  },
  wmAllFreeChip: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  wmAllFreeChipText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#15803D',
  },
  wmSummarySub: {
    fontSize: 11,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 2,
  },
  wmSummaryRight: {
    paddingLeft: 8,
  },
  wmViewUsageBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  wmModalContent: {
    width: '90%',
    maxWidth: 480,
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    padding: 18,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  wmModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: OwnerTheme.colors.borderLight,
    marginBottom: 10,
  },
  wmModalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  wmModalSubtitle: {
    fontSize: 11,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 2,
  },
  wmModalEmpty: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  wmModalEmptyText: {
    fontSize: 13,
    color: OwnerTheme.colors.textMuted,
  },
  configureWmBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: OwnerTheme.radius.full,
    backgroundColor: OwnerTheme.colors.primaryLight,
  },
  configureWmBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  wmUnitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  wmUnitName: {
    fontSize: 14,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  wmStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  wmStatusInUse: {
    backgroundColor: '#FEE2E2',
  },
  wmStatusFree: {
    backgroundColor: '#DCFCE7',
  },
  wmStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  wmStatusText: {
    fontSize: 10,
    fontWeight: '700',
  },
  wmInUseDetails: {
    marginTop: 4,
  },
  wmOccupantText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  wmDurationText: {
    fontSize: 11,
    color: '#64748B',
  },
  wmFreeSub: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
  },
  forceFreeBtn: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  forceFreeBtnDisabled: {
    opacity: 0.6,
  },
  forceFreeBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#DC2626',
  },
  wmModalFooter: {
    paddingTop: 12,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: OwnerTheme.colors.borderLight,
    alignItems: 'flex-end',
  },
  wmCloseBtn: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: OwnerTheme.radius.sm,
    backgroundColor: '#F1F5F9',
  },
  wmCloseBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  menuCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 14,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  menuHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  menuHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  menuIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: OwnerTheme.colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  menuSubtitle: {
    fontSize: 11,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 1,
  },
  menuManageBtn: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: OwnerTheme.colors.primaryLight,
    borderRadius: OwnerTheme.radius.full,
  },
  menuManageBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  mealSegmentRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  mealSegmentChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: 6,
    backgroundColor: '#F8FAFC',
    borderRadius: OwnerTheme.radius.md,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
  },
  mealSegmentChipSelected: {
    backgroundColor: '#F0F9FF',
    borderColor: OwnerTheme.colors.primary,
  },
  mealChipEmoji: {
    fontSize: 14,
  },
  mealChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  mealChipTextSelected: {
    color: OwnerTheme.colors.primary,
    fontWeight: '700',
  },
  mealStatusIndicator: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  indicatorPublished: {
    backgroundColor: '#DCFCE7',
  },
  indicatorDraft: {
    backgroundColor: '#FEF3C7',
  },
  indicatorEmpty: {
    backgroundColor: '#E2E8F0',
  },
  indicatorText: {
    fontSize: 9,
    fontWeight: '700',
  },
  indicatorTextPublished: {
    color: '#15803D',
  },
  indicatorTextDraft: {
    color: '#B45309',
  },
  indicatorTextEmpty: {
    color: '#94A3B8',
  },
  mealDetailBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: OwnerTheme.radius.md,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  mealDetailTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  mealDetailTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  mealDetailTime: {
    fontSize: 11,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 1,
  },
  detailBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  detailBadgePublished: {
    backgroundColor: '#DCFCE7',
  },
  detailBadgeDraft: {
    backgroundColor: '#FEF3C7',
  },
  detailBadgeNotSet: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  detailDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  detailBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  detailBadgeNotSetText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#94A3B8',
  },
  mealItemsContainer: {
    marginTop: 4,
  },
  mealItemsText: {
    fontSize: 13,
    color: '#334155',
    lineHeight: 19,
  },
  mealNotesText: {
    fontSize: 11,
    color: '#64748B',
    fontStyle: 'italic',
    marginTop: 6,
  },
  noMenuContainer: {
    alignItems: 'center',
    paddingVertical: 10,
    gap: 6,
  },
  noMenuText: {
    fontSize: 12,
    color: '#94A3B8',
    fontStyle: 'italic',
  },
  addMenuInlineBtn: {
    marginTop: 2,
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: OwnerTheme.colors.primaryLight,
    borderRadius: OwnerTheme.radius.full,
  },
  addMenuInlineBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  quickCard: {
    width: '48.8%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 10,
    gap: 8,
  },
  quickIconWrap: {
    width: 36,
    height: 36,
    borderRadius: OwnerTheme.radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quickTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  quickSub: {
    fontSize: 11,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 1,
  },
  activityCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    paddingHorizontal: 12,
    paddingVertical: 2,
  },
  activityLoading: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: OwnerTheme.colors.borderLight,
  },
  activityRowLast: {
    borderBottomWidth: 0,
  },
  activityIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  activityDetails: {
    flex: 1,
  },
  activityResidentName: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  activityActionText: {
    fontSize: 11,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 1,
  },
  activityTimeText: {
    fontSize: 11,
    color: OwnerTheme.colors.textMuted,
  },
  cardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  authLoadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  authNoticeText: {
    marginTop: 12,
    fontSize: 14,
    color: OwnerTheme.colors.textSecondary,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  switcherModalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    padding: 20,
    ...OwnerTheme.shadow,
  },
  switcherModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  switcherModalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  switcherModalSub: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
    marginBottom: 14,
  },
  propertyItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: OwnerTheme.radius.sm,
    marginBottom: 6,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: OwnerTheme.colors.borderLight,
  },
  propertyItemRowSelected: {
    backgroundColor: OwnerTheme.colors.primaryLight,
    borderColor: OwnerTheme.colors.primary,
  },
  propertyNameItem: {
    fontSize: 14,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  propertyNameItemSelected: {
    color: OwnerTheme.colors.primary,
  },
  propertyAddressItem: {
    fontSize: 11,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 1,
  },
  addPropertyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: OwnerTheme.radius.md,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.primary,
    borderStyle: 'dashed',
  },
  addPropertyBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.primary,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
    marginBottom: 4,
    marginTop: 8,
  },
  textInput: {
    height: 46,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    borderRadius: OwnerTheme.radius.md,
    paddingHorizontal: 12,
    fontSize: 14,
    color: OwnerTheme.colors.textPrimary,
    backgroundColor: '#F8FAFC',
    marginBottom: 8,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 12,
  },
  modalCancelBtn: {
    height: 40,
    paddingHorizontal: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCancelBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  modalConfirmBtn: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: OwnerTheme.radius.md,
    backgroundColor: OwnerTheme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalConfirmBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
