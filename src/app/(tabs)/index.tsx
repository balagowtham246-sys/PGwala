import React, { useCallback, useEffect, useState } from 'react';
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
import { router } from 'expo-router';

import { BottomTabInset } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/lib/supabase';

// --- Types ---
interface SummaryCardProps {
  label: string;
  value: number | string;
  sublabel: string;
  accentColor: string;
}

interface ActionButtonProps {
  iconText: string;
  title: string;
  subtitle: string;
  onPress: () => void;
}

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
  resident?: {
    full_name: string;
    room_number: string;
  };
}

interface ActivityItem {
  id: string;
  title: string;
  time: string;
  tag: string;
  tagColor: string;
}

export default function OwnerDashboard() {
  const { profile, signOut } = useAuth();

  // Dashboard state powered by live Supabase queries
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [propertyName, setPropertyName] = useState<string>('My PG');
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [stats, setStats] = useState({
    totalResidents: 0,
    studentsInside: 0,
    studentsOutside: 0,
    studentsUnknown: 0,
    pendingBillsCount: 0,
    pendingBillsAmount: 0,
  });

  const [recentActivities, setRecentActivities] = useState<ActivityItem[]>([]);

  // Formatted date string (e.g., "Thursday, 29 October 2026")
  const todayDate = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  // Fetch all dashboard data from Supabase
  const loadDashboardData = useCallback(async () => {
    try {
      setErrorMessage(null);

      // 1. Fetch the owner's property
      const { data: properties, error: propError } = await supabase
        .from('properties')
        .select('id, name')
        .eq('is_active', true)
        .limit(1);

      if (propError) throw propError;

      if (!properties || properties.length === 0) {
        setPropertyName('No Property Found');
        setStats({
          totalResidents: 0,
          studentsInside: 0,
          studentsOutside: 0,
          studentsUnknown: 0,
          pendingBillsCount: 0,
          pendingBillsAmount: 0,
        });
        setRecentActivities([]);
        setLoading(false);
        return;
      }

      const activeProp = properties[0];
      setPropertyId(activeProp.id);
      setPropertyName(activeProp.name);

      // 2. Fetch all residents for this property (active & inactive)
      const { data: residentsData, error: resError } = await supabase
        .from('residents')
        .select('id, full_name, room_number, property_id, is_active')
        .eq('property_id', activeProp.id);

      if (resError) throw resError;

      const allResidents: ResidentRecord[] = residentsData ?? [];
      const activeResidents = allResidents.filter((r) => r.is_active);
      const allResidentIds = allResidents.map((r) => r.id);

      if (allResidentIds.length === 0) {
        setStats({
          totalResidents: 0,
          studentsInside: 0,
          studentsOutside: 0,
          studentsUnknown: 0,
          pendingBillsCount: 0,
          pendingBillsAmount: 0,
        });
        setRecentActivities([]);
        setLoading(false);
        return;
      }

      // 3. Fetch movement logs for all property residents (preserving historical records)
      const { data: logsData, error: logsError } = await supabase
        .from('movement_logs')
        .select('id, resident_id, direction, event_time, note')
        .in('resident_id', allResidentIds)
        .order('event_time', { ascending: false });

      if (logsError) throw logsError;

      const logs: MovementLogRecord[] = logsData ?? [];

      // 4. Calculate status per resident based on their LATEST movement log
      // Computed STRICTLY for active residents only (inactive residents are excluded)
      const latestStatusMap = new Map<string, 'IN' | 'OUT'>();

      for (const log of logs) {
        if (!latestStatusMap.has(log.resident_id)) {
          latestStatusMap.set(log.resident_id, log.direction);
        }
      }

      let insideCount = 0;
      let outsideCount = 0;
      let unknownCount = 0;

      for (const res of activeResidents) {
        const latestDirection = latestStatusMap.get(res.id);
        if (latestDirection === 'IN') {
          insideCount += 1;
        } else if (latestDirection === 'OUT') {
          outsideCount += 1;
        } else {
          // Resident has NO movement logs yet -> treat as UNKNOWN
          unknownCount += 1;
        }
      }

      // 4b. Fetch live outstanding billing totals (fails softly if migration not yet run)
      let pendingBillsCount = 0;
      let pendingBillsAmount = 0;
      try {
        const { data: billsData } = await supabase
          .from('charges')
          .select('amount_paise')
          .eq('property_id', activeProp.id)
          .eq('status', 'outstanding');

        if (billsData && billsData.length > 0) {
          pendingBillsCount = billsData.length;
          pendingBillsAmount = billsData.reduce((acc, curr) => acc + (curr.amount_paise || 0), 0);
        }
      } catch {
        // Table not created yet; fail softly
      }

      setStats({
        totalResidents: activeResidents.length,
        studentsInside: insideCount,
        studentsOutside: outsideCount,
        studentsUnknown: unknownCount,
        pendingBillsCount,
        pendingBillsAmount,
      });

      // 5. Build recent gate activity feed from the latest 5 logs
      // Uses allResidents map so deactivated residents' past events still display their names
      const residentMap = new Map<string, ResidentRecord>();
      for (const r of allResidents) {
        residentMap.set(r.id, r);
      }

      const activities: ActivityItem[] = logs.slice(0, 5).map((log) => {
        const resident = residentMap.get(log.resident_id);
        const residentName = resident ? resident.full_name : 'Resident';
        const room = resident ? ` (${resident.room_number})` : '';
        const directionText = log.direction === 'IN' ? 'marked IN' : 'marked OUT';

        // Format event time (e.g., "09:15 AM")
        const eventDate = new Date(log.event_time);
        const timeFormatted = eventDate.toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        });

        return {
          id: log.id,
          title: `${residentName}${room} ${directionText}`,
          time: timeFormatted,
          tag: log.direction === 'IN' ? 'Gate IN' : 'Gate OUT',
          tagColor: log.direction === 'IN' ? '#DCFCE7' : '#FFEDD5', // Green or Orange badge
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
  }, []);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  // Pull-to-refresh handler
  const handleRefresh = () => {
    setRefreshing(true);
    loadDashboardData();
  };

  // Sign out handler
  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to log out of PGwala?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await signOut();
        },
      },
    ]);
  };

  // Action handler for buttons
  const handleQuickAction = (featureName: string) => {
    Alert.alert(
      featureName,
      `Opening ${featureName}... This module will be connected next.`,
      [{ text: 'OK' }]
    );
  };

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
        
        {/* Header Section */}
        <View style={styles.header}>
          <View>
            <Text style={styles.appTitle}>PGwala</Text>
            <Text style={styles.appSubtitle}>{propertyName}</Text>
          </View>
          <View style={styles.headerActions}>
            <View style={styles.badgeContainer}>
              <Text style={styles.badgeText}>Owner Portal</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sign Out"
              style={({ pressed }) => [
                styles.signOutButton,
                pressed && styles.signOutButtonPressed,
              ]}
              onPress={handleSignOut}>
              <Text style={styles.signOutButtonText}>Log out</Text>
            </Pressable>
          </View>
        </View>

        {/* Welcome & Date Greeting Card */}
        <View style={styles.greetingCard}>
          <Text style={styles.greetingTitle}>
            Welcome, {profile?.full_name || 'Owner'} 👋
          </Text>
          <Text style={styles.greetingDate}>{todayDate}</Text>
          <Text style={styles.greetingNote}>
            Here is the live status of your PG accommodation.
          </Text>
        </View>

        {/* Error Banner if query failed */}
        {errorMessage && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerIcon}>⚠️</Text>
            <Text style={styles.errorBannerText}>{errorMessage}</Text>
            <Pressable hitSlop={8} onPress={loadDashboardData}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        )}

        {/* Section: Overview / Summary */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Today's Overview</Text>
          <Text style={styles.sectionMeta}>
            Total {stats.totalResidents} Active Resident{stats.totalResidents === 1 ? '' : 's'}
          </Text>
        </View>

        {/* Live Summary Cards */}
        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color="#0284C7" />
            <Text style={styles.loadingText}>Loading live PG status...</Text>
          </View>
        ) : (
          <View style={styles.gridContainer}>
            <SummaryCard
              label="Inside PG"
              value={stats.studentsInside}
              sublabel={stats.studentsUnknown > 0 ? `${stats.studentsUnknown} unknown` : 'Checked in'}
              accentColor="#16A34A" // Green
            />
            <SummaryCard
              label="Outside PG"
              value={stats.studentsOutside}
              sublabel="Checked out"
              accentColor="#EA580C" // Orange
            />
            <SummaryCard
              label="Pending Bills"
              value={stats.pendingBillsAmount > 0 ? `₹${(stats.pendingBillsAmount / 100).toLocaleString('en-IN')}` : '₹0'}
              sublabel={stats.pendingBillsCount > 0 ? `${stats.pendingBillsCount} dues pending` : 'All settled'}
              accentColor="#0284C7"
            />
            <SummaryCard
              label="Open Issues"
              value="—"
              sublabel="Coming soon"
              accentColor="#94A3B8" // Slate gray placeholder
            />
          </View>
        )}

        {/* Section: Quick Actions */}
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.actionsList}>
          <ActionButton
            iconText="👤"
            title="Add Resident"
            subtitle="Register new student & assign room"
            onPress={() => router.push('/add-resident')}
          />
          <ActionButton
            iconText="🚪"
            title="Student In / Out"
            subtitle="Record entry & exit gate logs"
            onPress={() => router.push('/student-in-out')}
          />
          <ActionButton
            iconText="🍛"
            title="Food Menu"
            subtitle="Manage daily breakfast, lunch & dinner"
            onPress={() => router.push('/food-menu')}
          />
          <ActionButton
            iconText="💵"
            title="Rent & Bills"
            subtitle="Manage rent, EB, washing & payments"
            onPress={() => router.push('/billing-management')}
          />
          <ActionButton
            iconText="🔧"
            title="Maintenance"
            subtitle="Maintenance requests (Coming soon)"
            onPress={() => handleQuickAction('Maintenance')}
          />
          <ActionButton
            iconText="⚠️"
            title="Complaints & Issues"
            subtitle="Resident complaints (Coming soon)"
            onPress={() => handleQuickAction('Issues')}
          />
        </View>

        {/* Section: Recent Activity */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Recent Activity</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/student-in-out')}>
            <Text style={styles.linkText}>View all</Text>
          </Pressable>
        </View>

        <View style={styles.activityContainer}>
          {loading ? (
            <View style={styles.emptyActivityBox}>
              <ActivityIndicator size="small" color="#0284C7" />
            </View>
          ) : recentActivities.length === 0 ? (
            <View style={styles.emptyActivityBox}>
              <Text style={styles.emptyActivityTitle}>No gate logs yet</Text>
              <Text style={styles.emptyActivitySub}>
                Recent gate check-ins and check-outs will appear here.
              </Text>
            </View>
          ) : (
            recentActivities.map((item, index) => (
              <View
                key={item.id}
                style={[
                  styles.activityRow,
                  index === recentActivities.length - 1 && styles.activityRowLast,
                ]}>
                <View style={styles.activityContent}>
                  <Text style={styles.activityTitle}>{item.title}</Text>
                  <Text style={styles.activityTime}>{item.time}</Text>
                </View>
                <View
                  style={[
                    styles.tagBadge,
                    { backgroundColor: item.tagColor },
                  ]}>
                  <Text style={styles.tagText}>{item.tag}</Text>
                </View>
              </View>
            ))
          )}
        </View>

        {/* Bottom spacer to prevent native tab bar overlap */}
        <View style={{ height: BottomTabInset + 20 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// --- Sub-components ---

function SummaryCard({ label, value, sublabel, accentColor }: SummaryCardProps) {
  return (
    <View style={styles.summaryCard}>
      <View style={[styles.cardAccentBar, { backgroundColor: accentColor }]} />
      <Text style={[styles.summaryValue, { color: accentColor }]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summarySublabel}>{sublabel}</Text>
    </View>
  );
}

function ActionButton({ iconText, title, subtitle, onPress }: ActionButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.actionCard,
        pressed && styles.actionCardPressed,
      ]}
      onPress={onPress}>
      <View style={styles.actionIconContainer}>
        <Text style={styles.actionIconText}>{iconText}</Text>
      </View>
      <View style={styles.actionTextContainer}>
        <Text style={styles.actionTitle}>{title}</Text>
        <Text style={styles.actionSubtitle}>{subtitle}</Text>
      </View>
      <Text style={styles.actionArrow}>›</Text>
    </Pressable>
  );
}

// --- Stylesheet ---
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8FAFC', // Slate 50 background
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  appTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#0F172A', // Slate 900
    letterSpacing: -0.5,
  },
  appSubtitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0284C7', // Sky 600
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  badgeContainer: {
    backgroundColor: '#E0F2FE',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
  },
  badgeText: {
    color: '#0369A1',
    fontSize: 12,
    fontWeight: '700',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  signOutButton: {
    backgroundColor: '#FEE2E2', // light red
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
  },
  signOutButtonPressed: {
    opacity: 0.7,
  },
  signOutButtonText: {
    color: '#DC2626', // Red 600
    fontSize: 12,
    fontWeight: '700',
  },
  greetingCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
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
  greetingTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E293B',
  },
  greetingDate: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
    fontWeight: '500',
  },
  greetingNote: {
    fontSize: 14,
    color: '#475569',
    marginTop: 8,
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
  errorBannerIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  errorBannerText: {
    flex: 1,
    color: '#DC2626',
    fontSize: 13,
    fontWeight: '500',
  },
  retryText: {
    color: '#0284C7',
    fontSize: 13,
    fontWeight: '700',
    paddingHorizontal: 6,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A',
  },
  sectionMeta: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '500',
  },
  linkText: {
    fontSize: 13,
    color: '#0284C7',
    fontWeight: '600',
  },
  loadingBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
    color: '#64748B',
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
  },
  summaryCard: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    position: 'relative',
    overflow: 'hidden',
  },
  cardAccentBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4,
  },
  summaryValue: {
    fontSize: 26,
    fontWeight: '800',
    marginTop: 4,
  },
  summaryLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1E293B',
    marginTop: 2,
  },
  summarySublabel: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  actionsList: {
    gap: 10,
    marginBottom: 24,
  },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    minHeight: 64, // Ensures accessible minimum 48px+ touch target
  },
  actionCardPressed: {
    backgroundColor: '#F1F5F9',
  },
  actionIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  actionIconText: {
    fontSize: 22,
  },
  actionTextContainer: {
    flex: 1,
  },
  actionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  actionSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  actionArrow: {
    fontSize: 24,
    color: '#94A3B8',
    marginLeft: 8,
    fontWeight: '300',
  },
  activityContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 14,
  },
  emptyActivityBox: {
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyActivityTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
  },
  emptyActivitySub: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 4,
    textAlign: 'center',
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  activityRowLast: {
    borderBottomWidth: 0,
  },
  activityContent: {
    flex: 1,
    paddingRight: 10,
  },
  activityTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1E293B',
  },
  activityTime: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 3,
  },
  tagBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  tagText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#334155',
  },
});
