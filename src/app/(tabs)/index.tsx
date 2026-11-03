import { router } from 'expo-router';
import { useCallback, useEffect, useState, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
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
  AlertCircle,
  BellRing,
} from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useProperty, PropertyItem } from '@/context/property-context';
import { supabase } from '@/lib/supabase';
import {
  StatisticCard,
  StatusBadge,
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

  // ISO string for today 'YYYY-MM-DD'
  const todayIsoDate = new Date().toISOString().split('T')[0];

  // Fetch operational dashboard data scoped to the active selected property
  const loadDashboardData = useCallback(async () => {
    if (!user?.id || profile?.role !== 'owner' || !selectedPropertyId) {
      setLoading(false);
      return;
    }

    try {
      setErrorMessage(null);

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

      // 2. Fetch recent movement logs
      const { data: logsData, error: logsError } = await supabase
        .from('movement_logs')
        .select(
          'id, resident_id, direction, event_time, note, purpose, expected_return_time, food_required'
        )
        .in('resident_id', allResidentIds)
        .order('event_time', { ascending: false })
        .limit(60);

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

      // 3. Fetch today's food menu status
      try {
        const { data: menuData } = await supabase
          .from('food_menus')
          .select('meal_type, is_published')
          .eq('property_id', selectedPropertyId)
          .eq('menu_date', todayIsoDate);

        const summary: TodayMenuSummary = {
          breakfast: false,
          lunch: false,
          dinner: false,
        };

        if (menuData) {
          for (const m of menuData) {
            if (m.meal_type === 'breakfast' && m.is_published)
              summary.breakfast = true;
            if (m.meal_type === 'lunch' && m.is_published)
              summary.lunch = true;
            if (m.meal_type === 'dinner' && m.is_published)
              summary.dinner = true;
          }
        }
        setTodayMenu(summary);
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
              const now = Date.now();
              const lastAlertTime =
                alertThrottleRef.current.get(newLog.resident_id) || 0;

              // Anti-flooding throttle: Skip if alerted within 15 minutes for this resident
              if (now - lastAlertTime < 15 * 60 * 1000) {
                return;
              }
              alertThrottleRef.current.set(newLog.resident_id, now);

              // Fetch resident details for readable notification
              const { data: res } = await supabase
                .from('residents')
                .select('full_name, room_number')
                .eq('id', newLog.resident_id)
                .single();

              const resName = res?.full_name || 'Resident';
              const resRoom = res?.room_number || '';
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

        {/* Priority Area 2: Food Menu Today Quick Card */}
        <View style={styles.menuQuickCard}>
          <View style={styles.menuQuickHeader}>
            <View style={styles.menuQuickTitleCol}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Utensils size={15} color={OwnerTheme.colors.primary} />
                <Text style={styles.menuQuickTitle}>Today's Food Menu</Text>
              </View>
              <Text style={styles.menuQuickSubtitle}>
                Breakfast, lunch & dinner status
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.menuUpdateBtn,
                pressed && styles.cardPressed,
              ]}
              onPress={() => router.push('/food-menu')}>
              <Text style={styles.menuUpdateBtnText}>Update Menu ›</Text>
            </Pressable>
          </View>

          <View style={styles.menuPillRow}>
            <View
              style={[
                styles.mealPill,
                todayMenu.breakfast ? styles.mealPillPublished : styles.mealPillDraft,
              ]}>
              <Text
                style={[
                  styles.mealPillText,
                  todayMenu.breakfast && styles.mealPillTextPublished,
                ]}>
                Breakfast {todayMenu.breakfast ? '✓' : '• Draft'}
              </Text>
            </View>
            <View
              style={[
                styles.mealPill,
                todayMenu.lunch ? styles.mealPillPublished : styles.mealPillDraft,
              ]}>
              <Text
                style={[
                  styles.mealPillText,
                  todayMenu.lunch && styles.mealPillTextPublished,
                ]}>
                Lunch {todayMenu.lunch ? '✓' : '• Draft'}
              </Text>
            </View>
            <View
              style={[
                styles.mealPill,
                todayMenu.dinner ? styles.mealPillPublished : styles.mealPillDraft,
              ]}>
              <Text
                style={[
                  styles.mealPillText,
                  todayMenu.dinner && styles.mealPillTextPublished,
                ]}>
                Dinner {todayMenu.dinner ? '✓' : '• Draft'}
              </Text>
            </View>
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
  menuQuickCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 12,
  },
  menuQuickHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  menuQuickTitleCol: {
    flex: 1,
  },
  menuQuickTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  menuQuickSubtitle: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 1,
  },
  menuUpdateBtn: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: OwnerTheme.colors.primaryLight,
    borderRadius: OwnerTheme.radius.sm,
  },
  menuUpdateBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: OwnerTheme.colors.primary,
  },
  menuPillRow: {
    flexDirection: 'row',
    gap: 8,
  },
  mealPill: {
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: OwnerTheme.radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mealPillPublished: {
    backgroundColor: OwnerTheme.colors.successLight,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  mealPillDraft: {
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: OwnerTheme.colors.borderLight,
  },
  mealPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  mealPillTextPublished: {
    color: OwnerTheme.colors.success,
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
