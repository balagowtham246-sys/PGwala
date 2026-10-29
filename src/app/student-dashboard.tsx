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

import { BottomTabInset } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/lib/supabase';

interface StudentResidentInfo {
  id: string;
  property_id: string;
  profile_id: string;
  full_name: string;
  room_number: string;
  phone_number: string | null;
  is_active: boolean;
  property?: {
    id: string;
    name: string;
    address: string | null;
  } | null;
}

export type MealType = 'breakfast' | 'lunch' | 'dinner';

export interface StudentFoodMenu {
  id: string;
  meal_type: MealType;
  items: string;
  notes: string | null;
  is_published: boolean;
}

const MEAL_CONFIG: Record<MealType, { title: string; icon: string; timeHint: string }> = {
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

function formatTodayDate(): string {
  return new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function getTodayIsoDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function StudentDashboardScreen() {
  const { user, profile, signOut } = useAuth();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [resident, setResident] = useState<StudentResidentInfo | null>(null);
  const [menus, setMenus] = useState<Record<MealType, StudentFoodMenu | null>>({
    breakfast: null,
    lunch: null,
    dinner: null,
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  /**
   * 1. Load authenticated student's resident record from Supabase.
   * Strictly relies on trusted profile_id = auth.uid() relation under RLS.
   */
  const loadStudentData = useCallback(async () => {
    if (!user?.id) return;

    try {
      setErrorMessage(null);

      // Fetch resident record securely linked to this authenticated profile
      const { data: resData, error: resError } = await supabase
        .from('residents')
        .select(`
          id,
          property_id,
          profile_id,
          full_name,
          room_number,
          phone_number,
          is_active,
          property:properties (
            id,
            name,
            address
          )
        `)
        .eq('profile_id', user.id)
        .eq('is_active', true)
        .maybeSingle();

      if (resError) {
        throw new Error(resError.message);
      }

      if (!resData) {
        // Not linked to any resident record yet
        setResident(null);
        setMenus({ breakfast: null, lunch: null, dinner: null });
        setLoading(false);
        setRefreshing(false);
        return;
      }

      // Handle joined property data cleanly
      const propertyObj = Array.isArray(resData.property)
        ? resData.property[0]
        : resData.property;

      const residentInfo: StudentResidentInfo = {
        id: resData.id,
        property_id: resData.property_id,
        profile_id: resData.profile_id,
        full_name: resData.full_name,
        room_number: resData.room_number,
        phone_number: resData.phone_number,
        is_active: resData.is_active,
        property: propertyObj || null,
      };

      setResident(residentInfo);

      // 2. Fetch today's published food menus for the student's property
      const todayIso = getTodayIsoDate();
      const { data: menuData, error: menuError } = await supabase
        .from('food_menus')
        .select('id, meal_type, items, notes, is_published')
        .eq('property_id', residentInfo.property_id)
        .eq('menu_date', todayIso)
        .eq('is_published', true);

      // If food_menus table doesn't exist yet or errors, fail softly without breaking dashboard
      if (menuError) {
        console.warn('[StudentDashboard] Could not fetch food menus:', menuError.message);
        setMenus({ breakfast: null, lunch: null, dinner: null });
      } else {
        const menuMap: Record<MealType, StudentFoodMenu | null> = {
          breakfast: null,
          lunch: null,
          dinner: null,
        };

        if (menuData && menuData.length > 0) {
          for (const item of menuData as StudentFoodMenu[]) {
            if (['breakfast', 'lunch', 'dinner'].includes(item.meal_type)) {
              menuMap[item.meal_type] = item;
            }
          }
        }
        setMenus(menuMap);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[StudentDashboard] Error loading student data:', err);
      setErrorMessage(`Failed to load student data: ${msg}`);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadStudentData();
  }, [loadStudentData]);

  const handleRefresh = () => {
    setRefreshing(true);
    loadStudentData();
  };

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
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

  const showPlaceholderNotice = (featureName: string, description: string) => {
    Alert.alert(
      `${featureName} (Coming Soon)`,
      `${description}\n\nThis feature is currently under active development.`
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

        {/* Top Bar with Student Greeting & Sign Out */}
        <View style={styles.topBar}>
          <View style={styles.greetingWrapper}>
            <Text style={styles.portalTag}>STUDENT PORTAL</Text>
            <Text style={styles.greetingTitle}>
              Hello, {resident?.full_name || profile?.full_name || 'Student'}!
            </Text>
            <Text style={styles.dateSubtitle}>{formatTodayDate()}</Text>
          </View>

          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.signOutButton,
              pressed && styles.signOutButtonPressed,
            ]}
            onPress={handleSignOut}>
            <Text style={styles.signOutButtonText}>Sign Out</Text>
          </Pressable>
        </View>

        {/* Error Banner */}
        {errorMessage && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorIcon}>⚠️</Text>
            <Text style={styles.errorText}>{errorMessage}</Text>
            <Pressable hitSlop={8} onPress={loadStudentData}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        )}

        {/* Loading State */}
        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color="#0284C7" />
            <Text style={styles.loadingText}>Loading your accommodation details...</Text>
          </View>
        ) : resident ? (
          /* Enrolled Accommodation Card */
          <View style={styles.residentCard}>
            <View style={styles.residentHeaderRow}>
              <View style={styles.propertyInfo}>
                <Text style={styles.propertyIcon}>🏢</Text>
                <View>
                  <Text style={styles.propertyName}>
                    {resident.property?.name || 'Your PG Accommodation'}
                  </Text>
                  {resident.property?.address && (
                    <Text style={styles.propertyAddress}>
                      {resident.property.address}
                    </Text>
                  )}
                </View>
              </View>

              <View style={styles.activePill}>
                <View style={styles.activeDot} />
                <Text style={styles.activePillText}>Active</Text>
              </View>
            </View>

            <View style={styles.divider} />

            <View style={styles.detailsRow}>
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>Assigned Room</Text>
                <Text style={styles.detailValue}>Room {resident.room_number}</Text>
              </View>

              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>Registered Name</Text>
                <Text style={styles.detailValue}>{resident.full_name}</Text>
              </View>
            </View>
          </View>
        ) : (
          /* Unlinked / Pending Allocation State */
          <View style={styles.unlinkedCard}>
            <Text style={styles.unlinkedIcon}>📋</Text>
            <Text style={styles.unlinkedTitle}>Awaiting Room Allocation</Text>
            <Text style={styles.unlinkedBody}>
              Your account is signed in, but has not yet been linked to a room allocation by your PG owner.
            </Text>
            <View style={styles.accountDetailBox}>
              <Text style={styles.accountDetailLabel}>Your Registered Account:</Text>
              <Text style={styles.accountDetailValue}>{user?.email || profile?.full_name}</Text>
            </View>
            <Text style={styles.unlinkedHint}>
              Please contact your PG owner to link your account to your room record. Pull down to refresh once linked.
            </Text>
          </View>
        )}

        {/* Section: Today's Food Menu */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Today's Food Menu</Text>
          <Text style={styles.sectionMeta}>Published Daily</Text>
        </View>

        {!resident ? (
          <View style={styles.emptyMenuBox}>
            <Text style={styles.emptyMenuTitle}>Menu Unavailable</Text>
            <Text style={styles.emptyMenuSubtitle}>
              Food menus will appear here once your account is linked to your PG property.
            </Text>
          </View>
        ) : (
          <View style={styles.mealsContainer}>
            {(['breakfast', 'lunch', 'dinner'] as MealType[]).map((mealType) => {
              const menu = menus[mealType];
              const config = MEAL_CONFIG[mealType];

              return (
                <View key={mealType} style={styles.mealCard}>
                  <View style={styles.mealHeader}>
                    <Text style={styles.mealIcon}>{config.icon}</Text>
                    <View style={styles.mealTitleWrapper}>
                      <Text style={styles.mealTitle}>{config.title}</Text>
                      <Text style={styles.mealTimeHint}>{config.timeHint}</Text>
                    </View>
                    <View
                      style={[
                        styles.menuStatusBadge,
                        menu ? styles.menuStatusAvailable : styles.menuStatusNotSet,
                      ]}>
                      <Text
                        style={[
                          styles.menuStatusText,
                          menu ? styles.menuStatusTextAvailable : styles.menuStatusTextNotSet,
                        ]}>
                        {menu ? 'Published' : 'Not set'}
                      </Text>
                    </View>
                  </View>

                  {menu ? (
                    <View style={styles.menuContentBox}>
                      <Text style={styles.menuItemsText}>{menu.items}</Text>
                      {menu.notes && (
                        <View style={styles.notesRow}>
                          <Text style={styles.notesIcon}>📝</Text>
                          <Text style={styles.notesText}>{menu.notes}</Text>
                        </View>
                      )}
                    </View>
                  ) : (
                    <View style={styles.emptyMealContent}>
                      <Text style={styles.emptyMealText}>
                        No menu published for {config.title.toLowerCase()} today.
                      </Text>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {/* Section: Quick Actions / Future Services (Placeholders) */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Student Services</Text>
          <Text style={styles.sectionMeta}>PGwala Features</Text>
        </View>

        <View style={styles.servicesGrid}>
          {/* Gate History Placeholder */}
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.serviceCard,
              pressed && styles.serviceCardPressed,
            ]}
            onPress={() =>
              showPlaceholderNotice(
                'My Gate History',
                'You will be able to review all your past IN/OUT gate entry and exit timestamps.'
              )
            }>
            <View style={styles.serviceIconBox}>
              <Text style={styles.serviceIcon}>🚪</Text>
            </View>
            <View style={styles.serviceContent}>
              <Text style={styles.serviceTitle}>My Gate History</Text>
              <Text style={styles.serviceSubtitle}>View entry and exit records</Text>
            </View>
            <View style={styles.comingSoonBadge}>
              <Text style={styles.comingSoonText}>Coming soon</Text>
            </View>
          </Pressable>

          {/* Bills & Rent Placeholder */}
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.serviceCard,
              pressed && styles.serviceCardPressed,
            ]}
            onPress={() =>
              showPlaceholderNotice(
                'My Bills & Rent',
                'You will be able to check monthly rent invoices, due dates, and payment history.'
              )
            }>
            <View style={styles.serviceIconBox}>
              <Text style={styles.serviceIcon}>💵</Text>
            </View>
            <View style={styles.serviceContent}>
              <Text style={styles.serviceTitle}>My Bills & Rent</Text>
              <Text style={styles.serviceSubtitle}>Dues & payment receipts</Text>
            </View>
            <View style={styles.comingSoonBadge}>
              <Text style={styles.comingSoonText}>Coming soon</Text>
            </View>
          </Pressable>

          {/* Complaints & Requests Placeholder */}
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.serviceCard,
              pressed && styles.serviceCardPressed,
            ]}
            onPress={() =>
              showPlaceholderNotice(
                'Complaints & Requests',
                'You will be able to report maintenance issues or room complaints directly to your PG owner.'
              )
            }>
            <View style={styles.serviceIconBox}>
              <Text style={styles.serviceIcon}>🔧</Text>
            </View>
            <View style={styles.serviceContent}>
              <Text style={styles.serviceTitle}>Complaints & Requests</Text>
              <Text style={styles.serviceSubtitle}>Raise room or PG issues</Text>
            </View>
            <View style={styles.comingSoonBadge}>
              <Text style={styles.comingSoonText}>Coming soon</Text>
            </View>
          </Pressable>
        </View>

        <View style={{ height: BottomTabInset + 40 }} />
      </ScrollView>
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
    paddingBottom: 40,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  greetingWrapper: {
    flex: 1,
  },
  portalTag: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0284C7',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  greetingTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.3,
    marginTop: 2,
  },
  dateSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  signOutButton: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  signOutButtonPressed: {
    backgroundColor: '#F1F5F9',
  },
  signOutButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#DC2626',
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
  loadingBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
    color: '#64748B',
  },
  residentCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 18,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 3,
      },
      android: {
        elevation: 1,
      },
    }),
  },
  residentHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  propertyInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  propertyIcon: {
    fontSize: 24,
  },
  propertyName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  propertyAddress: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
  },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 6,
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#16A34A',
  },
  activePillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#15803D',
  },
  divider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 14,
  },
  detailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  detailItem: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  detailValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0284C7',
    marginTop: 2,
  },
  unlinkedCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: '#FED7AA',
    borderLeftWidth: 4,
    borderLeftColor: '#F97316',
    marginBottom: 18,
    alignItems: 'center',
  },
  unlinkedIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  unlinkedTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#C2410C',
    marginBottom: 4,
  },
  unlinkedBody: {
    fontSize: 13,
    color: '#475569',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 12,
  },
  accountDetailBox: {
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    marginBottom: 10,
  },
  accountDetailLabel: {
    fontSize: 11,
    color: '#64748B',
  },
  accountDetailValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 2,
  },
  unlinkedHint: {
    fontSize: 12,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 16,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  sectionMeta: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  emptyMenuBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    marginBottom: 18,
  },
  emptyMenuTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#64748B',
  },
  emptyMenuSubtitle: {
    fontSize: 12,
    color: '#94A3B8',
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 16,
  },
  mealsContainer: {
    gap: 12,
    marginBottom: 20,
  },
  mealCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
  },
  mealHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#FAFAFA',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  mealIcon: {
    fontSize: 20,
    marginRight: 10,
  },
  mealTitleWrapper: {
    flex: 1,
  },
  mealTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  mealTimeHint: {
    fontSize: 11,
    color: '#64748B',
  },
  menuStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  menuStatusAvailable: {
    backgroundColor: '#DCFCE7',
  },
  menuStatusNotSet: {
    backgroundColor: '#F1F5F9',
  },
  menuStatusText: {
    fontSize: 10,
    fontWeight: '700',
  },
  menuStatusTextAvailable: {
    color: '#15803D',
  },
  menuStatusTextNotSet: {
    color: '#94A3B8',
  },
  menuContentBox: {
    padding: 14,
  },
  menuItemsText: {
    fontSize: 13,
    color: '#1E293B',
    lineHeight: 20,
    fontWeight: '500',
  },
  notesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginTop: 8,
    gap: 6,
  },
  notesIcon: {
    fontSize: 12,
  },
  notesText: {
    fontSize: 11,
    color: '#92400E',
    flex: 1,
  },
  emptyMealContent: {
    padding: 12,
    alignItems: 'center',
  },
  emptyMealText: {
    fontSize: 12,
    color: '#94A3B8',
    fontStyle: 'italic',
  },
  servicesGrid: {
    gap: 10,
    marginBottom: 20,
  },
  serviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  serviceCardPressed: {
    backgroundColor: '#F8FAFC',
  },
  serviceIconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#F0F9FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  serviceIcon: {
    fontSize: 20,
  },
  serviceContent: {
    flex: 1,
  },
  serviceTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  serviceSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
  },
  comingSoonBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  comingSoonText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
  },
});

