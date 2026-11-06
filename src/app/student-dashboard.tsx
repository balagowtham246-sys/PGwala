import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  Building2,
  DoorOpen,
  Utensils,
  Receipt,
  Wrench,
  Clock,
  LogIn,
  LogOut,
  ChevronRight,
  Settings,
  Check,
  ArrowRight,
  AlertCircle,
  MessageCircle,
  X,
} from 'lucide-react-native';

import { BottomTabInset, OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/lib/supabase';
import { WashingMachineCard } from '@/components/washing-machine-card';

// --- Types ---
interface ResidentAccommodationInfo {
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

export interface ResidentFoodMenu {
  id: string;
  meal_type: MealType;
  items: string;
  notes: string | null;
  is_published: boolean;
}

export interface ResidentMovementRecord {
  id: string;
  direction: 'IN' | 'OUT';
  event_time: string;
  purpose: string | null;
  expected_return_time: string | null;
  food_required: boolean;
  note: string | null;
}

const PURPOSE_OPTIONS = ['College', 'Work', 'Home Visit', 'Outing', 'Other'];
const RETURN_TIME_OPTIONS = [
  'Evening (~8:00 PM)',
  'Night (~10:00 PM)',
  'Late Night (~11:30 PM)',
  'Tomorrow Morning',
  'Custom',
];

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

function getTodayIsoDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatMovementTime(isoString: string): string {
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

export default function ResidentDashboardScreen() {
  const { user, profile } = useAuth();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [resident, setResident] = useState<ResidentAccommodationInfo | null>(null);

  // Active Meal Tab for in-place detail view
  const [activeMealTab, setActiveMealTab] = useState<MealType>('breakfast');
  const [menus, setMenus] = useState<Record<MealType, ResidentFoodMenu | null>>({
    breakfast: null,
    lunch: null,
    dinner: null,
  });

  // Billing dues indicator
  const [pendingDuesPaise, setPendingDuesPaise] = useState<number | null>(null);

  // Movement & Gate Status
  const [latestMovement, setLatestMovement] = useState<ResidentMovementRecord | null>(null);
  const [goingOutModalVisible, setGoingOutModalVisible] = useState(false);
  const [savingMovement, setSavingMovement] = useState(false);

  // Going Out Form State
  const [leavingPurpose, setLeavingPurpose] = useState<string>('College');
  const [customPurpose, setCustomPurpose] = useState<string>('');
  const [returnTime, setReturnTime] = useState<string>('Evening (~8:00 PM)');
  const [customReturnTime, setCustomReturnTime] = useState<string>('');
  const [foodRequired, setFoodRequired] = useState<boolean>(true);

  // Feedback State
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadResidentData = useCallback(async () => {
    if (!user?.id) return;
    try {
      setErrorMessage(null);

      // 1. Fetch resident allocation record
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

      if (resError) throw resError;

      if (!resData) {
        setResident(null);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const propertyObj = Array.isArray(resData.property)
        ? resData.property[0]
        : resData.property;

      const residentInfo: ResidentAccommodationInfo = {
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

      // 2. Fetch today's published food menus
      const todayIso = getTodayIsoDate();
      const { data: menuData, error: menuError } = await supabase
        .from('food_menus')
        .select('id, meal_type, items, notes, is_published')
        .eq('property_id', residentInfo.property_id)
        .eq('menu_date', todayIso)
        .eq('is_published', true);

      if (menuError) {
        console.warn('[ResidentDashboard] Could not fetch food menus:', menuError.message);
        setMenus({ breakfast: null, lunch: null, dinner: null });
      } else {
        const menuMap: Record<MealType, ResidentFoodMenu | null> = {
          breakfast: null,
          lunch: null,
          dinner: null,
        };

        if (menuData && menuData.length > 0) {
          for (const item of menuData as ResidentFoodMenu[]) {
            if (['breakfast', 'lunch', 'dinner'].includes(item.meal_type)) {
              menuMap[item.meal_type] = item;
            }
          }
        }
        setMenus(menuMap);
      }

      // 3. Query outstanding dues for quick badge
      try {
        const { data: chargesData } = await supabase
          .from('charges')
          .select('amount_paise')
          .eq('resident_id', residentInfo.id)
          .eq('status', 'outstanding');

        let totalOut = 0;
        if (chargesData && chargesData.length > 0) {
          for (const ch of chargesData) {
            totalOut += ch.amount_paise || 0;
          }
        }
        setPendingDuesPaise(totalOut);
      } catch (billingErr) {
        console.warn('[ResidentDashboard] Dues fetch error:', billingErr);
        setPendingDuesPaise(null);
      }

      // 4. Fetch latest gate movement status
      try {
        const { data: movementData } = await supabase
          .from('movement_logs')
          .select('id, direction, event_time, purpose, expected_return_time, food_required, note')
          .eq('resident_id', residentInfo.id)
          .order('event_time', { ascending: false })
          .limit(1)
          .maybeSingle();

        setLatestMovement((movementData as ResidentMovementRecord) || null);
      } catch (movErr) {
        console.warn('[ResidentDashboard] Error fetching movement log:', movErr);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[ResidentDashboard] Error loading resident data:', err);
      setErrorMessage(`Failed to load resident data: ${msg}`);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadResidentData();
  }, [loadResidentData]);

  const handleRefresh = () => {
    setRefreshing(true);
    loadResidentData();
  };

  // 1-tap Check-In when back at PG
  const handleMarkBackIn = async () => {
    if (savingMovement) return;
    setSavingMovement(true);

    try {
      const { data, error } = await supabase.rpc('record_student_movement', {
        p_direction: 'IN',
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to update attendance.');

      Alert.alert('Welcome Back! 🏠', 'You have marked yourself INSIDE the PG.');
      await loadResidentData();
    } catch (err: any) {
      Alert.alert('Update Failed', err.message || 'Could not record check-in.');
    } finally {
      setSavingMovement(false);
    }
  };

  // Confirm Going Out with Purpose, Return Time & Food Requirement
  const handleConfirmGoingOut = async () => {
    if (savingMovement) return;
    const resolvedPurpose = leavingPurpose === 'Other' ? customPurpose.trim() : leavingPurpose;
    const resolvedReturn = returnTime === 'Custom' ? customReturnTime.trim() : returnTime;

    if (!resolvedPurpose) {
      Alert.alert('Purpose Required', 'Please specify the purpose of leaving.');
      return;
    }

    setSavingMovement(true);

    try {
      const { data, error } = await supabase.rpc('record_student_movement', {
        p_direction: 'OUT',
        p_purpose: resolvedPurpose,
        p_expected_return_time: resolvedReturn || undefined,
        p_food_required: foodRequired,
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to update attendance.');

      setGoingOutModalVisible(false);
      Alert.alert('Status Updated 🚶', 'You have marked yourself OUT of the PG.');
      await loadResidentData();
    } catch (err: any) {
      Alert.alert('Update Failed', err.message || 'Could not record departure.');
    } finally {
      setSavingMovement(false);
    }
  };

  const isInside = !latestMovement || latestMovement.direction === 'IN';

  const getInitials = (name?: string | null) => {
    if (!name) return 'RE';
    const parts = name.trim().split(' ');
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Top Header: Brand + PG Accommodation Badge + Settings Cog */}
      <View style={styles.headerRow}>
        <Text style={styles.brandTitle}>PGwala</Text>

        <View style={styles.propertyPill}>
          <Building2 size={14} color={OwnerTheme.colors.primary} />
          <Text style={styles.propertyPillText} numberOfLines={1}>
            {resident?.property?.name || 'Resident Portal'}
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Resident Settings"
          style={({ pressed }) => [
            styles.settingsBtn,
            pressed && styles.btnPressed,
          ]}
          onPress={() => router.push('/student-settings')}>
          <Settings size={18} color={OwnerTheme.colors.primary} />
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
        {/* Temporary Password Alert Banner */}
        {user?.user_metadata?.must_change_password && (
          <Pressable
            style={({ pressed }) => [
              styles.tempPasswordBanner,
              pressed && { opacity: 0.8 },
            ]}
            onPress={() => router.push('/student-profile-edit')}>
            <AlertCircle size={18} color="#92400E" />
            <View style={{ flex: 1 }}>
              <Text style={styles.tempPasswordTitle}>Temporary Password Active</Text>
              <Text style={styles.tempPasswordSubtitle}>
                Tap here to set your private password and secure your resident account.
              </Text>
            </View>
            <ChevronRight size={16} color="#92400E" />
          </Pressable>
        )}

        {/* Error Banner */}
        {errorMessage && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{errorMessage}</Text>
            <Pressable hitSlop={8} onPress={loadResidentData}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        )}

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color={OwnerTheme.colors.primary} />
            <Text style={styles.loadingText}>Loading accommodation details...</Text>
          </View>
        ) : resident ? (
          <>
            {/* Top 1: Simplified Resident Tile Card */}
            <View style={styles.residentTileCard}>
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarText}>
                  {getInitials(resident.full_name)}
                </Text>
              </View>

              <View style={styles.residentTileInfo}>
                <View style={styles.residentNameRow}>
                  <Text style={styles.residentTileName} numberOfLines={1}>
                    {resident.full_name}
                  </Text>
                  <View style={styles.roomPill}>
                    <Text style={styles.roomPillText}>Room {resident.room_number}</Text>
                  </View>
                </View>

                <Text style={styles.residentTileProp} numberOfLines={1}>
                  {resident.property?.name || 'Assigned PG'}
                  {resident.property?.address ? ` • ${resident.property.address}` : ''}
                </Text>
              </View>

              <View style={styles.activeDotBadge}>
                <View style={styles.activeDot} />
                <Text style={styles.activeDotText}>Active</Text>
              </View>
            </View>

            {/* Top 2: 1 x 2 Hero Section (Washing Machine & Gate Attendance Side-by-Side) */}
            <View style={styles.heroRow}>
              {/* Left Column: Washing Machine Card */}
              <WashingMachineCard
                propertyId={resident.property_id}
                userRole="student"
                currentResidentId={resident.id}
                compact
                style={{ flex: 1 }}
              />

              {/* Right Column: Gate Attendance Marking System */}
              <View style={styles.gateHeroCard}>
                <View style={styles.gateHeaderRow}>
                  <View
                    style={[
                      styles.gateIconCircle,
                      isInside ? styles.gateIconIn : styles.gateIconOut,
                    ]}>
                    {isInside ? (
                      <LogIn size={18} color={OwnerTheme.colors.success} />
                    ) : (
                      <LogOut size={18} color={OwnerTheme.colors.warning} />
                    )}
                  </View>
                  <View
                    style={[
                      styles.gatePill,
                      isInside ? styles.gatePillIn : styles.gatePillOut,
                    ]}>
                    <Text
                      style={[
                        styles.gatePillText,
                        isInside ? styles.gateTextIn : styles.gateTextOut,
                      ]}>
                      {isInside ? 'INSIDE' : 'OUTSIDE'}
                    </Text>
                  </View>
                </View>

                <Text style={styles.gateTitle}>Gate Attendance</Text>
                <Text style={styles.gateSubtitle} numberOfLines={1}>
                  {latestMovement?.event_time
                    ? `${isInside ? 'In since' : 'Out at'} ${formatMovementTime(latestMovement.event_time)}`
                    : 'Present on campus'}
                </Text>

                <View style={styles.gateActionWrap}>
                  {isInside ? (
                    <Pressable
                      style={({ pressed }) => [
                        styles.gateActionBtn,
                        styles.gateOutBtn,
                        pressed && styles.btnPressed,
                      ]}
                      onPress={() => {
                        setFoodRequired(true);
                        setGoingOutModalVisible(true);
                      }}>
                      <Text style={styles.gateOutBtnText}>🚶 Going Out</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      style={({ pressed }) => [
                        styles.gateActionBtn,
                        styles.gateInBtn,
                        pressed && styles.btnPressed,
                        savingMovement && styles.btnDisabled,
                      ]}
                      disabled={savingMovement}
                      onPress={handleMarkBackIn}>
                      {savingMovement ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Text style={styles.gateInBtnText}>✓ Mark Inside</Text>
                      )}
                    </Pressable>
                  )}
                </View>
              </View>
            </View>

            {/* Section 3: Today's Food Menu (Interactive In-Place Card) */}
            <View style={styles.menuCard}>
              <View style={styles.menuHeader}>
                <View style={styles.menuHeaderLeft}>
                  <Utensils size={16} color={OwnerTheme.colors.primary} />
                  <Text style={styles.menuTitle}>Today&apos;s Food Menu</Text>
                </View>
                <Text style={styles.menuPublishedHint}>Published Daily</Text>
              </View>

              {/* 3-Chip Meal Selector */}
              <View style={styles.mealSegmentRow}>
                {(['breakfast', 'lunch', 'dinner'] as MealType[]).map((mealKey) => {
                  const cfg = MEAL_CONFIG[mealKey];
                  const hasMenu = Boolean(menus[mealKey]);
                  const isSelected = activeMealTab === mealKey;

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
                          styles.mealDot,
                          hasMenu ? styles.mealDotActive : styles.mealDotInactive,
                        ]}
                      />
                    </Pressable>
                  );
                })}
              </View>

              {/* In-Place Selected Meal Details */}
              <View style={styles.mealDetailBox}>
                <View style={styles.mealDetailTop}>
                  <Text style={styles.mealDetailTitle}>
                    {MEAL_CONFIG[activeMealTab].title}
                  </Text>
                  <Text style={styles.mealDetailTime}>
                    {MEAL_CONFIG[activeMealTab].timeHint}
                  </Text>
                </View>

                {menus[activeMealTab] ? (
                  <View style={styles.mealItemsContainer}>
                    <Text style={styles.mealItemsText}>
                      {menus[activeMealTab]!.items}
                    </Text>
                    {menus[activeMealTab]!.notes ? (
                      <Text style={styles.mealNotesText}>
                        Note: {menus[activeMealTab]!.notes}
                      </Text>
                    ) : null}
                  </View>
                ) : (
                  <Text style={styles.noMenuText}>
                    No menu published for {MEAL_CONFIG[activeMealTab].title.toLowerCase()} today.
                  </Text>
                )}
              </View>
            </View>

            {/* Section 4: Resident Services (Neatly Aligned 3-Card Grid) */}
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionHeading}>Resident Services</Text>
            </View>

            <View style={styles.servicesList}>
              {/* Bills & Rent */}
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.serviceCard,
                  pressed && styles.btnPressed,
                ]}
                onPress={() => router.push('/student-billing')}>
                <View
                  style={[
                    styles.serviceIconWrap,
                    { backgroundColor: '#F1F5F9' },
                  ]}>
                  <Receipt size={18} color={OwnerTheme.colors.textPrimary} />
                </View>
                <View style={styles.serviceTextCol}>
                  <Text style={styles.serviceTitle}>My Bills & Rent</Text>
                  <Text style={styles.serviceSubtitle}>Dues, payments & receipts</Text>
                </View>
                {pendingDuesPaise !== null ? (
                  <View
                    style={[
                      styles.duesBadge,
                      pendingDuesPaise > 0 ? styles.duesPending : styles.duesClear,
                    ]}>
                    <Text
                      style={[
                        styles.duesBadgeText,
                        pendingDuesPaise > 0 ? styles.duesPendingText : styles.duesClearText,
                      ]}>
                      {pendingDuesPaise > 0
                        ? `₹${(pendingDuesPaise / 100).toLocaleString('en-IN')}`
                        : 'Clear'}
                    </Text>
                  </View>
                ) : null}
                <ChevronRight size={18} color={OwnerTheme.colors.textMuted} />
              </Pressable>

              {/* Maintenance & Complaints */}
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.serviceCard,
                  pressed && styles.btnPressed,
                ]}
                onPress={() => router.push('/student-complaints')}>
                <View
                  style={[
                    styles.serviceIconWrap,
                    { backgroundColor: OwnerTheme.colors.warningLight },
                  ]}>
                  <Wrench size={18} color={OwnerTheme.colors.warning} />
                </View>
                <View style={styles.serviceTextCol}>
                  <Text style={styles.serviceTitle}>Complaints & Requests</Text>
                  <Text style={styles.serviceSubtitle}>Raise room maintenance or repairs</Text>
                </View>
                <ChevronRight size={18} color={OwnerTheme.colors.textMuted} />
              </Pressable>

              {/* Gate History */}
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.serviceCard,
                  pressed && styles.btnPressed,
                ]}
                onPress={() => router.push('/student-gate-history')}>
                <View
                  style={[
                    styles.serviceIconWrap,
                    { backgroundColor: OwnerTheme.colors.primaryLight },
                  ]}>
                  <Clock size={18} color={OwnerTheme.colors.primary} />
                </View>
                <View style={styles.serviceTextCol}>
                  <Text style={styles.serviceTitle}>Gate Movement History</Text>
                  <Text style={styles.serviceSubtitle}>Review your entry & exit logs</Text>
                </View>
                <ChevronRight size={18} color={OwnerTheme.colors.textMuted} />
              </Pressable>
            </View>
          </>
        ) : (
          /* Unlinked Account State */
          <View style={styles.unlinkedCard}>
            <Text style={{ fontSize: 32 }}>📋</Text>
            <Text style={styles.unlinkedTitle}>Awaiting Room Allocation</Text>
            <Text style={styles.unlinkedBody}>
              Your account is signed in, but has not yet been linked to a room allocation by your PG owner.
            </Text>
            <View style={styles.accountBox}>
              <Text style={styles.accountBoxLabel}>Signed in as:</Text>
              <Text style={styles.accountBoxValue}>{user?.email || profile?.full_name}</Text>
            </View>
            <Text style={styles.unlinkedHint}>
              Please contact your PG administrator to assign your room. Pull down to refresh once completed.
            </Text>
          </View>
        )}

        <View style={{ height: BottomTabInset + 20 }} />
      </ScrollView>

      {/* Modal: Mark Going Out */}
      <Modal
        visible={goingOutModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setGoingOutModalVisible(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Going Out of PG</Text>
              <Pressable hitSlop={8} onPress={() => setGoingOutModalVisible(false)}>
                <X size={20} color={OwnerTheme.colors.textSecondary} />
              </Pressable>
            </View>
            <Text style={styles.modalSubtitle}>
              Inform PG management about your departure and dinner requirement.
            </Text>

            {/* Purpose Selection */}
            <Text style={styles.inputSectionLabel}>Purpose of Leaving</Text>
            <View style={styles.optionChipRow}>
              {PURPOSE_OPTIONS.map((opt) => (
                <Pressable
                  key={opt}
                  style={[
                    styles.optionChip,
                    leavingPurpose === opt && styles.optionChipSelected,
                  ]}
                  onPress={() => setLeavingPurpose(opt)}>
                  <Text
                    style={[
                      styles.optionChipText,
                      leavingPurpose === opt && styles.optionChipTextSelected,
                    ]}>
                    {opt}
                  </Text>
                </Pressable>
              ))}
            </View>

            {leavingPurpose === 'Other' && (
              <TextInput
                style={styles.textInput}
                placeholder="Specify your purpose..."
                placeholderTextColor={OwnerTheme.colors.textMuted}
                value={customPurpose}
                onChangeText={setCustomPurpose}
              />
            )}

            {/* Expected Return */}
            <Text style={styles.inputSectionLabel}>Expected Return Time</Text>
            <View style={styles.optionChipRow}>
              {RETURN_TIME_OPTIONS.map((opt) => (
                <Pressable
                  key={opt}
                  style={[
                    styles.optionChip,
                    returnTime === opt && styles.optionChipSelected,
                  ]}
                  onPress={() => setReturnTime(opt)}>
                  <Text
                    style={[
                      styles.optionChipText,
                      returnTime === opt && styles.optionChipTextSelected,
                    ]}>
                    {opt}
                  </Text>
                </Pressable>
              ))}
            </View>

            {returnTime === 'Custom' && (
              <TextInput
                style={styles.textInput}
                placeholder="e.g. 9:30 PM tonight"
                placeholderTextColor={OwnerTheme.colors.textMuted}
                value={customReturnTime}
                onChangeText={setCustomReturnTime}
              />
            )}

            {/* Dinner Requirement Switch */}
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.switchLabel}>Do you need Dinner tonight?</Text>
                <Text style={styles.switchHint}>
                  Helps the kitchen prepare the right quantity of food
                </Text>
              </View>
              <Switch
                value={foodRequired}
                onValueChange={setFoodRequired}
                trackColor={{ false: '#E2E8F0', true: OwnerTheme.colors.primary }}
                thumbColor="#FFFFFF"
              />
            </View>

            {/* Submit & Cancel Buttons */}
            <View style={styles.modalBtnRow}>
              <Pressable
                style={styles.modalCancelBtn}
                onPress={() => setGoingOutModalVisible(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.modalConfirmBtn,
                  savingMovement && styles.btnDisabled,
                ]}
                disabled={savingMovement}
                onPress={handleConfirmGoingOut}>
                {savingMovement ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalConfirmText}>Confirm Departure</Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Floating Action Button: PG Community Chat */}
      {resident && (
        <Pressable
          style={styles.chatFab}
          onPress={() => router.push('/student-chat')}
          accessibilityLabel="Open Resident Community Chat">
          <MessageCircle size={20} color="#FFFFFF" />
          <Text style={styles.chatFabText}>PG Chat</Text>
        </Pressable>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: OwnerTheme.colors.background,
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
  brandTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: OwnerTheme.colors.primary,
    letterSpacing: -0.5,
  },
  propertyPill: {
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
  propertyPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
    flex: 1,
  },
  settingsBtn: {
    width: 38,
    height: 38,
    borderRadius: OwnerTheme.radius.full,
    backgroundColor: OwnerTheme.colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 10,
    maxWidth: 800,
    width: '100%',
    alignSelf: 'center',
    gap: 12,
  },
  tempPasswordBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FCD34D',
    borderRadius: OwnerTheme.radius.card,
    padding: 12,
  },
  tempPasswordTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400E',
  },
  tempPasswordSubtitle: {
    fontSize: 11,
    color: '#B45309',
    marginTop: 1,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: OwnerTheme.radius.md,
    padding: 12,
  },
  errorText: {
    fontSize: 12,
    color: '#991B1B',
    flex: 1,
  },
  retryText: {
    fontSize: 12,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
    marginLeft: 8,
  },
  loadingBox: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 8,
    fontSize: 13,
    color: OwnerTheme.colors.textSecondary,
  },
  residentTileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 12,
    gap: 12,
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: OwnerTheme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  residentTileInfo: {
    flex: 1,
  },
  residentNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  residentTileName: {
    fontSize: 16,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  roomPill: {
    backgroundColor: OwnerTheme.colors.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: OwnerTheme.radius.sm,
  },
  roomPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  residentTileProp: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 2,
  },
  activeDotBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F0FDF4',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: OwnerTheme.radius.full,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: OwnerTheme.colors.success,
  },
  activeDotText: {
    fontSize: 11,
    fontWeight: '700',
    color: OwnerTheme.colors.success,
  },
  heroRow: {
    flexDirection: 'row',
    gap: 10,
  },
  gateHeroCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    padding: 12,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    justifyContent: 'space-between',
    minHeight: 140,
  },
  gateHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  gateIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gateIconIn: {
    backgroundColor: OwnerTheme.colors.successLight,
  },
  gateIconOut: {
    backgroundColor: OwnerTheme.colors.warningLight,
  },
  gatePill: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 9999,
  },
  gatePillIn: {
    backgroundColor: OwnerTheme.colors.successLight,
  },
  gatePillOut: {
    backgroundColor: OwnerTheme.colors.warningLight,
  },
  gatePillText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  gateTextIn: {
    color: OwnerTheme.colors.success,
  },
  gateTextOut: {
    color: OwnerTheme.colors.warning,
  },
  gateTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
    marginTop: 6,
  },
  gateSubtitle: {
    fontSize: 11,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 1,
  },
  gateActionWrap: {
    marginTop: 10,
  },
  gateActionBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: OwnerTheme.radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gateOutBtn: {
    backgroundColor: OwnerTheme.colors.warning,
  },
  gateOutBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  gateInBtn: {
    backgroundColor: OwnerTheme.colors.success,
  },
  gateInBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  menuCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 12,
  },
  menuHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  menuHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  menuTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  menuPublishedHint: {
    fontSize: 11,
    color: OwnerTheme.colors.textMuted,
  },
  mealSegmentRow: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: OwnerTheme.radius.sm,
    padding: 3,
    gap: 4,
  },
  mealSegmentChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    borderRadius: 6,
    gap: 4,
  },
  mealSegmentChipSelected: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  mealChipEmoji: {
    fontSize: 13,
  },
  mealChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  mealChipTextSelected: {
    color: OwnerTheme.colors.textPrimary,
    fontWeight: '700',
  },
  mealDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  mealDotActive: {
    backgroundColor: OwnerTheme.colors.success,
  },
  mealDotInactive: {
    backgroundColor: '#CBD5E1',
  },
  mealDetailBox: {
    marginTop: 10,
    padding: 10,
    backgroundColor: '#FAFAFA',
    borderRadius: OwnerTheme.radius.sm,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.borderLight,
  },
  mealDetailTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  mealDetailTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  mealDetailTime: {
    fontSize: 11,
    color: OwnerTheme.colors.textMuted,
  },
  mealItemsContainer: {
    gap: 4,
  },
  mealItemsText: {
    fontSize: 13,
    color: OwnerTheme.colors.textPrimary,
    lineHeight: 18,
    fontWeight: '500',
  },
  mealNotesText: {
    fontSize: 11,
    color: OwnerTheme.colors.textSecondary,
    fontStyle: 'italic',
  },
  noMenuText: {
    fontSize: 12,
    color: OwnerTheme.colors.textMuted,
    fontStyle: 'italic',
    paddingVertical: 4,
  },
  sectionHeaderRow: {
    marginTop: 2,
    marginBottom: 2,
  },
  sectionHeading: {
    fontSize: 13,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  servicesList: {
    gap: 8,
  },
  serviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 12,
    gap: 12,
  },
  serviceIconWrap: {
    width: 36,
    height: 36,
    borderRadius: OwnerTheme.radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  serviceTextCol: {
    flex: 1,
  },
  serviceTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  serviceSubtitle: {
    fontSize: 11,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 1,
  },
  duesBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: OwnerTheme.radius.sm,
  },
  duesPending: {
    backgroundColor: OwnerTheme.colors.dangerLight,
  },
  duesClear: {
    backgroundColor: OwnerTheme.colors.successLight,
  },
  duesBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  duesPendingText: {
    color: OwnerTheme.colors.danger,
  },
  duesClearText: {
    color: OwnerTheme.colors.success,
  },
  unlinkedCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 24,
    alignItems: 'center',
    gap: 10,
  },
  unlinkedTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  unlinkedBody: {
    fontSize: 13,
    color: OwnerTheme.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },
  accountBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: OwnerTheme.radius.sm,
    padding: 10,
    width: '100%',
    alignItems: 'center',
  },
  accountBoxLabel: {
    fontSize: 11,
    color: OwnerTheme.colors.textMuted,
  },
  accountBoxValue: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
    marginTop: 2,
  },
  unlinkedHint: {
    fontSize: 11,
    color: OwnerTheme.colors.textMuted,
    textAlign: 'center',
    lineHeight: 15,
  },
  btnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  btnDisabled: {
    opacity: 0.6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    gap: 12,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  modalSubtitle: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
  },
  inputSectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
    marginTop: 4,
  },
  optionChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionChip: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: OwnerTheme.radius.sm,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  optionChipSelected: {
    backgroundColor: OwnerTheme.colors.primaryLight,
    borderColor: OwnerTheme.colors.primary,
  },
  optionChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  optionChipTextSelected: {
    color: OwnerTheme.colors.primary,
    fontWeight: '700',
  },
  textInput: {
    height: 44,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    borderRadius: OwnerTheme.radius.sm,
    paddingHorizontal: 12,
    fontSize: 14,
    color: OwnerTheme.colors.textPrimary,
    backgroundColor: '#FAFAFA',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: OwnerTheme.colors.borderLight,
    marginTop: 6,
  },
  switchLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  switchHint: {
    fontSize: 11,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 2,
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: OwnerTheme.radius.md,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
  },
  modalCancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  modalConfirmBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: OwnerTheme.radius.md,
    backgroundColor: OwnerTheme.colors.primary,
    alignItems: 'center',
  },
  modalConfirmText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  chatFab: {
    position: 'absolute',
    bottom: BottomTabInset + 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0284C7',
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 28,
    gap: 8,
    shadowColor: '#0284C7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 6,
    zIndex: 99,
  },
  chatFabText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
