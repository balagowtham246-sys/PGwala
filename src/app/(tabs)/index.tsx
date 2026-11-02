import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomTabInset } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/lib/supabase';
import { WashingMachineCard } from '@/components/washing-machine-card';

// --- Types ---
interface SummaryCardProps {
  label: string;
  value: number | string;
  sublabel: string;
  accentColor: string;
  onPress?: () => void;
  isLargeScreen?: boolean;
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
  const { user, session, profile, isLoading: authLoading, signOut } = useAuth();
  const { width } = useWindowDimensions();
  const isLargeScreen = width >= 768;

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
    totalCollectedPaise: 0,
    outstandingPaise: 0,
    overduePaise: 0,
    pendingReportsCount: 0,
    pendingBillsCount: 0,
    pendingBillsAmount: 0,
    openComplaintsCount: 0,
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
    // Defense-in-depth: Never fire queries if unauthenticated or not an owner
    if (!user?.id || profile?.role !== 'owner') {
      return;
    }

    try {
      setErrorMessage(null);

      // 1. Fetch the owner's property (scoped explicitly to authenticated owner)
      const { data: properties, error: propError } = await supabase
        .from('properties')
        .select('id, name')
        .eq('owner_id', user.id)
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1);

      if (propError) throw propError;

      if (!properties || properties.length === 0) {
        setPropertyName('No Property Found');
        setStats({
          totalResidents: 0,
          studentsInside: 0,
          studentsOutside: 0,
          studentsUnknown: 0,
          totalCollectedPaise: 0,
          outstandingPaise: 0,
          overduePaise: 0,
          pendingReportsCount: 0,
          pendingBillsCount: 0,
          pendingBillsAmount: 0,
          openComplaintsCount: 0,
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
          totalCollectedPaise: 0,
          outstandingPaise: 0,
          overduePaise: 0,
          pendingReportsCount: 0,
          pendingBillsCount: 0,
          pendingBillsAmount: 0,
          openComplaintsCount: 0,
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

      // 4b. Fetch live billing records (fails softly if billing tables not yet migrated)
      let totalCollectedPaise = 0;
      let outstandingPaise = 0;
      let overduePaise = 0;
      let pendingReportsCount = 0;
      let pendingBillsCount = 0;
      let pendingBillsAmount = 0;

      const todayIso = new Date().toISOString().split('T')[0];

      try {
        // Authoritative query 1: Approved payments (strictly excludes reversed payments)
        const { data: paymentsData } = await supabase
          .from('payments')
          .select('amount_paise')
          .eq('property_id', activeProp.id)
          .eq('status', 'approved');

        if (paymentsData && paymentsData.length > 0) {
          totalCollectedPaise = paymentsData.reduce(
            (acc, curr) => acc + (curr.amount_paise || 0),
            0
          );
        }

        // Authoritative query 2: Outstanding charges & overdue calculation
        const { data: chargesData } = await supabase
          .from('charges')
          .select('amount_paise, due_date')
          .eq('property_id', activeProp.id)
          .eq('status', 'outstanding');

        if (chargesData && chargesData.length > 0) {
          pendingBillsCount = chargesData.length;
          for (const ch of chargesData) {
            const amt = ch.amount_paise || 0;
            outstandingPaise += amt;
            if (ch.due_date && ch.due_date < todayIso) {
              overduePaise += amt;
            }
          }
          pendingBillsAmount = outstandingPaise;
        }

        // Authoritative query 3: Pending student payment reports awaiting verification
        const { data: reportsData } = await supabase
          .from('student_payment_reports')
          .select('id')
          .eq('property_id', activeProp.id)
          .eq('status', 'pending');

        if (reportsData) {
          pendingReportsCount = reportsData.length;
        }
      } catch (billingErr) {
        console.warn('[OwnerDashboard] Could not fetch billing overview:', billingErr);
      }

      // 4c. Fetch open maintenance complaints count
      let openComplaintsCount = 0;
      try {
        const { data: compData } = await supabase
          .from('complaints')
          .select('id')
          .eq('property_id', activeProp.id)
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
        studentsUnknown: unknownCount,
        totalCollectedPaise,
        outstandingPaise,
        overduePaise,
        pendingReportsCount,
        pendingBillsCount,
        pendingBillsAmount,
        openComplaintsCount,
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
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === '42501'
      ) {
        setErrorMessage(
          'Session expired or unauthorized. Please log out and sign in again.'
        );
      } else {
        setErrorMessage(`Failed to load dashboard: ${msg}`);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id, profile?.role]);

  useEffect(() => {
    // Wait until auth initialization completes
    if (authLoading) return;

    // Handle signed-out state: active redirect to login
    if (!session || !user?.id) {
      router.replace('/login');
      return;
    }

    // Handle student role: active redirect to student portal
    if (profile && profile.role !== 'owner') {
      if (profile.role === 'student') {
        router.replace('/student-dashboard');
      } else {
        router.replace('/login');
      }
      return;
    }

    // Owner verified: load dashboard data
    if (profile?.role === 'owner') {
      loadDashboardData();
    }
  }, [authLoading, session, user?.id, profile?.role, loadDashboardData]);

  // Pull-to-refresh handler
  const handleRefresh = () => {
    setRefreshing(true);
    loadDashboardData();
  };

  // Sign out handler (Cross-platform: uses window.confirm on Web, Alert.alert on native)
  const handleSignOut = async () => {
    if (Platform.OS === 'web') {
      const confirmed = typeof window !== 'undefined' ? window.confirm('Are you sure you want to log out of PGwala?') : true;
      if (confirmed) {
        await signOut();
        router.replace('/login');
      }
      return;
    }

    Alert.alert('Sign Out', 'Are you sure you want to log out of PGwala?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await signOut();
          router.replace('/login');
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

  // 1. Initial auth loading state (restoring session from storage)
  if (authLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.authLoadingContainer}>
          <ActivityIndicator size="large" color="#0284C7" />
          <Text style={styles.authNoticeText}>Initializing session...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // 2. Signed-out state: prevents getting stuck on loading screen
  if (!session || !user) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.authLoadingContainer}>
          <ActivityIndicator size="large" color="#0284C7" />
          <Text style={styles.authNoticeText}>Redirecting to login...</Text>
          <Pressable
            style={styles.authActionButton}
            onPress={() => router.replace('/login')}>
            <Text style={styles.authActionButtonText}>Go to Login</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // 3. User authenticated but profile missing or failed to fetch
  if (!profile) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.authLoadingContainer}>
          <Text style={styles.authErrorTitle}>Profile Not Found</Text>
          <Text style={styles.authNoticeText}>
            Could not load user profile. Please sign in again.
          </Text>
          <Pressable
            style={styles.authActionButton}
            onPress={async () => {
              await signOut();
              router.replace('/login');
            }}>
            <Text style={styles.authActionButtonText}>Sign Out & Retry</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // 4. Non-owner account accessing owner dashboard
  if (profile.role !== 'owner') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.authLoadingContainer}>
          <ActivityIndicator size="large" color="#0284C7" />
          <Text style={styles.authNoticeText}>Redirecting to student portal...</Text>
        </View>
      </SafeAreaView>
    );
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

        {/* Header Section */}
        <View style={styles.header}>
          <View>
            <Text style={styles.appTitle}>PGwala</Text>
            <Text style={styles.appSubtitle}>{propertyName}</Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open Settings"
              style={({ pressed }) => [
                styles.settingsButton,
                pressed && styles.settingsButtonPressed,
              ]}
              onPress={() => router.push('/owner-settings')}>
              <Text style={styles.settingsButtonText}>⚙️ Settings</Text>
            </Pressable>
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

        {/* Live Washing Machine Availability */}
        {propertyId && (
          <WashingMachineCard
            propertyId={propertyId}
            userRole="owner"
          />
        )}

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

        {/* Section: Gate Status */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Gate & Resident Status</Text>
          <Text style={styles.sectionMeta}>
            Total {stats.totalResidents} Active Resident{stats.totalResidents === 1 ? '' : 's'}
          </Text>
        </View>

        {/* Gate Summary Cards */}
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
              onPress={() => router.push('/student-in-out')}
              isLargeScreen={true}
            />
            <SummaryCard
              label="Outside PG"
              value={stats.studentsOutside}
              sublabel="Checked out"
              accentColor="#EA580C" // Orange
              onPress={() => router.push('/student-in-out')}
              isLargeScreen={true}
            />
          </View>
        )}

        {/* Section: Financial & Billing Overview */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Financial & Billing</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/billing-management')}>
            <Text style={styles.linkText}>Manage Bills ›</Text>
          </Pressable>
        </View>

        {/* Pending Reports Notification Banner */}
        {stats.pendingReportsCount > 0 && (
          <Pressable
            style={styles.pendingReportsBanner}
            onPress={() => router.push('/billing-management')}>
            <View style={styles.pendingReportsLeft}>
              <Text style={styles.pendingReportsIcon}>🔔</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.pendingReportsTitle}>
                  {stats.pendingReportsCount} Payment Report{stats.pendingReportsCount > 1 ? 's' : ''} Pending
                </Text>
                <Text style={styles.pendingReportsSub}>
                  Student payments awaiting verification & approval
                </Text>
              </View>
            </View>
            <View style={styles.reviewBadge}>
              <Text style={styles.reviewBadgeText}>Review</Text>
            </View>
          </Pressable>
        )}

        {/* Live Financial Cards */}
        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color="#0284C7" />
            <Text style={styles.loadingText}>Loading financial summary...</Text>
          </View>
        ) : (
          <View style={styles.gridContainer}>
            <SummaryCard
              label="Total Collected"
              value={`₹${(stats.totalCollectedPaise / 100).toLocaleString('en-IN')}`}
              sublabel="Confirmed payments"
              accentColor="#16A34A"
              isLargeScreen={isLargeScreen}
            />
            <SummaryCard
              label="Unpaid Bills"
              value={`₹${(stats.outstandingPaise / 100).toLocaleString('en-IN')}`}
              sublabel={`${stats.pendingBillsCount} pending bill${stats.pendingBillsCount === 1 ? '' : 's'}`}
              accentColor="#0284C7"
              onPress={() => router.push('/billing-management')}
              isLargeScreen={isLargeScreen}
            />
            <SummaryCard
              label="Past Due"
              value={`₹${(stats.overduePaise / 100).toLocaleString('en-IN')}`}
              sublabel={stats.overduePaise > 0 ? 'Past due date' : 'All up to date'}
              accentColor={stats.overduePaise > 0 ? '#DC2626' : '#64748B'}
              onPress={() => router.push('/billing-management')}
              isLargeScreen={isLargeScreen}
            />
            <SummaryCard
              label="Needs Review"
              value={stats.pendingReportsCount}
              sublabel={stats.pendingReportsCount > 0 ? 'Payment proof sent' : 'All confirmed'}
              accentColor={stats.pendingReportsCount > 0 ? '#D97706' : '#16A34A'}
              onPress={() => router.push('/billing-management')}
              isLargeScreen={isLargeScreen}
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
            title="Gate Attendance"
            subtitle="Live attendance, return times & meal counts"
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
            subtitle="Manage monthly rent, washing machine & payments"
            onPress={() => router.push('/billing-management')}
          />
          <ActionButton
            iconText="🔧"
            title="Maintenance & Issues"
            subtitle={
              stats.openComplaintsCount > 0
                ? `${stats.openComplaintsCount} open complaint${stats.openComplaintsCount === 1 ? '' : 's'} to resolve`
                : 'View & manage resident maintenance requests'
            }
            onPress={() => router.push('/owner-complaints')}
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

        {/* Bottom spacer */}
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// --- Sub-components ---

function SummaryCard({
  label,
  value,
  sublabel,
  accentColor,
  onPress,
  isLargeScreen = false,
}: SummaryCardProps) {
  const content = (
    <>
      <View style={[styles.cardAccentBar, { backgroundColor: accentColor }]} />
      <Text
        style={[styles.summaryValue, { color: accentColor }]}
        numberOfLines={1}
        adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.summaryLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.summarySublabel} numberOfLines={1}>
        {sublabel}
      </Text>
    </>
  );

  const cardStyle = [
    styles.summaryCard,
    isLargeScreen ? styles.summaryCardLarge : styles.summaryCardSmall,
  ];

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => [
          cardStyle,
          pressed && { opacity: 0.85, transform: [{ scale: 0.99 }] },
        ]}
        onPress={onPress}>
        {content}
      </Pressable>
    );
  }

  return <View style={cardStyle}>{content}</View>;
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
    width: '100%',
    maxWidth: 1080,
    alignSelf: 'center',
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
  settingsButton: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  settingsButtonPressed: {
    backgroundColor: '#F1F5F9',
  },
  settingsButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
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
  pendingReportsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  pendingReportsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 10,
  },
  pendingReportsIcon: {
    fontSize: 22,
  },
  pendingReportsTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#92400E',
  },
  pendingReportsSub: {
    fontSize: 12,
    color: '#B45309',
    marginTop: 2,
  },
  reviewBadge: {
    backgroundColor: '#D97706',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginLeft: 8,
  },
  reviewBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    position: 'relative',
    overflow: 'hidden',
  },
  summaryCardSmall: {
    flexBasis: '47%',
    flexGrow: 1,
    minWidth: 140,
  },
  summaryCardLarge: {
    flex: 1,
    minWidth: 160,
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
  authLoadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  authNoticeText: {
    fontSize: 14,
    color: '#64748B',
    marginTop: 12,
    textAlign: 'center',
  },
  authErrorTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 6,
    textAlign: 'center',
  },
  authActionButton: {
    backgroundColor: '#0284C7',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    marginTop: 16,
  },
  authActionButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});
