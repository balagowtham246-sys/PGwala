import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import {
  Building2,
  ChevronRight,
  LogOut,
  Bell,
  ShieldCheck,
  UserCog,
  Disc3,
  Minus,
  Plus,
  X,
} from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useProperty } from '@/context/property-context';
import { useToast } from '@/context/toast-context';
import { supabase } from '@/lib/supabase';
import { isDeveloperAccessAllowed } from '@/lib/dev-tasks';
import { extractErrorMessage } from '@/lib/error-utils';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { OwnerHeader } from '@/components/ui/owner';
import { BiometricSettingsRow } from '@/components/biometric-settings-row';
import { SettingsComplianceSection } from '@/components/settings-compliance-section';
import {
  useOwnerDashboardQuery,
  useOwnerReleaseWmMutation,
  useOwnerSetWmOutOfOrderMutation,
} from '@/hooks/use-dashboards';

interface WashingMachineRow {
  id: string;
  machine_number: number;
  machine_name: string | null;
}

const getWmNamesStorageKey = (propertyId: string) =>
  `@pgwala_wm_names:${propertyId}`;

export default function OwnerSettingsScreen() {
  const { user, profile, signOut } = useAuth();
  const { selectedProperty, properties } = useProperty();
  const { showToast } = useToast();
  const colors = OwnerTheme.colors;
  const [ownerInfoVisible, setOwnerInfoVisible] = useState(false);
  const devTapCountRef = useRef(0);
  const devTapResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (devTapResetTimerRef.current) {
        clearTimeout(devTapResetTimerRef.current);
      }
    };
  }, []);

  const handleVersionFooterTap = useCallback(() => {
    if (!isDeveloperAccessAllowed(user?.email)) return;
    devTapCountRef.current += 1;
    if (devTapResetTimerRef.current) {
      clearTimeout(devTapResetTimerRef.current);
    }
    if (devTapCountRef.current >= 5) {
      devTapCountRef.current = 0;
      router.push('/dev-monitor');
      return;
    }
    devTapResetTimerRef.current = setTimeout(() => {
      devTapCountRef.current = 0;
    }, 3000);
  }, [user?.email]);

  const [wmModalVisible, setWmModalVisible] = useState(false);
  const [wmModalTab, setWmModalTab] = useState<'live' | 'configure'>('live');
  const [wmCount, setWmCount] = useState<number>(2);
  const [initialWmCount, setInitialWmCount] = useState<number>(2);
  const [wmNames, setWmNames] = useState<Record<number, string>>({
    1: 'Washing Machine 1',
    2: 'Washing Machine 2',
  });
  const [wmCountLoading, setWmCountLoading] = useState(false);
  const [savingWm, setSavingWm] = useState(false);

  const selectedPropertyId = selectedProperty?.id ?? null;

  const dashboardQuery = useOwnerDashboardQuery(
    selectedPropertyId,
    Boolean(selectedPropertyId) && wmModalVisible
  );
  const releaseWmMutation = useOwnerReleaseWmMutation();
  const outOfOrderWmMutation = useOwnerSetWmOutOfOrderMutation();

  const wmUnits = dashboardQuery.data?.wmUnits ?? [];
  const wmSummary = dashboardQuery.data?.wmSummary ?? {
    totalCount: wmCount,
    inUseCount: 0,
    freeCount: wmCount,
    outOfOrderCount: 0,
  };
  const outOfOrderCount =
    wmSummary.outOfOrderCount ??
    wmUnits.filter((u) => u.status === 'out_of_order').length;
  const busyMachineId = releaseWmMutation.isPending
    ? releaseWmMutation.variables.machineId
    : outOfOrderWmMutation.isPending
      ? outOfOrderWmMutation.variables.machineId
      : null;

  const handleOwnerReleaseWm = (machineId: string, machineName: string) => {
    if (!selectedPropertyId) return;
    Alert.alert(
      'Free Up Machine',
      `Are you sure you want to free up ${machineName}? This will end the current resident's session.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Free Up',
          style: 'destructive',
          onPress: async () => {
            try {
              await releaseWmMutation.mutateAsync({
                propertyId: selectedPropertyId,
                machineId,
              });
            } catch (err) {
              Alert.alert(
                'Error',
                err instanceof Error ? err.message : 'Failed to release washing machine.'
              );
            }
          },
        },
      ]
    );
  };

  const handleOwnerSetOutOfOrder = (
    machineId: string,
    machineName: string,
    outOfOrder: boolean,
    isInUse: boolean
  ) => {
    if (!selectedPropertyId) return;
    const applyChange = async () => {
      try {
        await outOfOrderWmMutation.mutateAsync({
          propertyId: selectedPropertyId,
          machineId,
          outOfOrder,
        });
      } catch (err) {
        Alert.alert(
          'Error',
          err instanceof Error
            ? err.message
            : 'Failed to update washing machine status.'
        );
      }
    };
    if (outOfOrder) {
      Alert.alert(
        'Mark Out of Order',
        `Mark ${machineName} as out of order?${isInUse ? " This will end the current resident's session." : ''}`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Mark Out of Order', style: 'destructive', onPress: applyChange },
        ]
      );
      return;
    }
    void applyChange();
  };

  const fetchWmDataForProperty = useCallback(async (propertyId: string) => {
    let storedNames: Record<string, string> = {};
    try {
      const raw = await AsyncStorage.getItem(getWmNamesStorageKey(propertyId));
      if (raw) {
        storedNames = JSON.parse(raw) as Record<string, string>;
      }
    } catch {
      // Ignore AsyncStorage read errors
    }

    const { data, count, error } = await supabase
      .from('washing_machines')
      .select('id, machine_number, machine_name', { count: 'exact' })
      .eq('property_id', propertyId)
      .eq('is_active', true)
      .order('machine_number', { ascending: true });

    if (error) return null;

    const rows = (data ?? []) as WashingMachineRow[];
    const resolvedCount =
      rows.length > 0
        ? rows.length
        : typeof count === 'number' && count > 0
          ? count
          : 2;

    const nextNames: Record<number, string> = {};
    for (const [k, v] of Object.entries(storedNames)) {
      const parsedNum = Number(k);
      if (Number.isInteger(parsedNum) && parsedNum >= 1 && v?.trim()) {
        nextNames[parsedNum] = v.trim();
      }
    }

    for (const row of rows) {
      const defaultLabel = `Washing Machine ${row.machine_number}`;
      const dbName = row.machine_name?.trim();
      const fallbackName = storedNames[String(row.machine_number)]?.trim();
      nextNames[row.machine_number] =
        dbName && dbName !== defaultLabel
          ? dbName
          : fallbackName || dbName || defaultLabel;
    }

    for (let num = 1; num <= resolvedCount; num++) {
      if (!nextNames[num]) {
        nextNames[num] = `Washing Machine ${num}`;
      }
    }

    return { resolvedCount, nextNames };
  }, []);

  const loadWmData = useCallback(async () => {
    if (!selectedPropertyId) return;
    try {
      setWmCountLoading(true);
      const res = await fetchWmDataForProperty(selectedPropertyId);
      if (res) {
        setWmCount(res.resolvedCount);
        setInitialWmCount(res.resolvedCount);
        setWmNames(res.nextNames);
      }
    } catch {
      // Graceful fallback
    } finally {
      setWmCountLoading(false);
    }
  }, [fetchWmDataForProperty, selectedPropertyId]);

  useEffect(() => {
    if (!selectedPropertyId) return;
    let active = true;
    (async () => {
      try {
        const res = await fetchWmDataForProperty(selectedPropertyId);
        if (!active || !res) return;
        setWmCount(res.resolvedCount);
        setInitialWmCount(res.resolvedCount);
        setWmNames(res.nextNames);
      } catch {
        // Graceful fallback
      }
    })();
    return () => {
      active = false;
    };
  }, [fetchWmDataForProperty, selectedPropertyId]);

  const openWmModal = () => {
    setWmModalVisible(true);
    void loadWmData();
  };

  const executeSaveWmCount = async () => {
    if (!selectedProperty?.id) return;
    try {
      setSavingWm(true);

      // Build finalized names for units 1..wmCount
      const finalizedNames: Record<string, string> = {};
      for (let num = 1; num <= wmCount; num++) {
        const rawName = (wmNames[num] ?? '').trim();
        finalizedNames[String(num)] = rawName || `Washing Machine ${num}`;
      }

      // 1. Update unit count via authoritative RPC first (since increasing count resets names on server)
      const { data, error } = await supabase.rpc('set_property_wm_count', {
        p_property_id: selectedProperty.id,
        p_count: wmCount,
      });
      if (error) throw error;
      if (data && !data.success) throw new Error(data.error);

      // 2. Persist custom machine names to AsyncStorage fallback
      try {
        await AsyncStorage.setItem(
          getWmNamesStorageKey(selectedProperty.id),
          JSON.stringify(finalizedNames)
        );
      } catch {
        // Non-fatal fallback
      }

      // 3. Persist custom machine names to washing_machines.machine_name
      await Promise.all(
        Array.from({ length: wmCount }, (_, idx) => idx + 1).map(async (num) => {
          const machineName = finalizedNames[String(num)];
          const { error: updateErr } = await supabase
            .from('washing_machines')
            .update({ machine_name: machineName })
            .eq('property_id', selectedProperty.id)
            .eq('machine_number', num);

          if (updateErr) {
            console.warn(
              `[OwnerSettings] Failed to update name for machine ${num}:`,
              updateErr.message
            );
          }
        })
      );

      setWmModalVisible(false);
      showToast(data?.message || `Configured ${wmCount} washing machines.`);
      await loadWmData();
    } catch (err: unknown) {
      Alert.alert(
        'Update Failed',
        extractErrorMessage(err, 'Could not update washing machine capacity.')
      );
    } finally {
      setSavingWm(false);
    }
  };

  const handleSaveWmCount = () => {
    if (!selectedProperty?.id || savingWm) return;

    if (wmCount < initialWmCount) {
      const removed = initialWmCount - wmCount;
      const message = `Reducing capacity from ${initialWmCount} to ${wmCount} unit${wmCount === 1 ? '' : 's'} will deactivate ${removed} washing machine${removed === 1 ? '' : 's'}. Are you sure you want to continue?`;

      if (Platform.OS === 'web') {
        const confirmed =
          typeof window !== 'undefined' && typeof window.confirm === 'function'
            ? window.confirm(message)
            : true;
        if (confirmed) {
          void executeSaveWmCount();
        }
        return;
      }

      Alert.alert('Reduce Machine Capacity?', message, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reduce & Save',
          style: 'destructive',
          onPress: () => {
            void executeSaveWmCount();
          },
        },
      ]);
      return;
    }

    void executeSaveWmCount();
  };

  const handleLogout = async () => {
    if (Platform.OS === 'web') {
      const confirmed =
        typeof window !== 'undefined'
          ? window.confirm('Are you sure you want to log out of PGwala?')
          : true;
      if (confirmed) {
        await signOut();
        router.replace('/login');
      }
      return;
    }

    Alert.alert('Log Out', 'Are you sure you want to log out of PGwala?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: async () => {
          await signOut();
          router.replace('/login');
        },
      },
    ]);
  };

  const getInitials = (name?: string | null) => {
    if (!name) return 'OW';
    const parts = name.trim().split(' ');
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const unitNumbers = Array.from({ length: wmCount }, (_, idx) => idx + 1);

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <OwnerHeader
        title="Settings"
        subtitle={selectedProperty?.name || 'Owner Portal'}
        showBack
      />

      <ScrollView
        contentContainerStyle={[
          styles.container,
          { flex: undefined, paddingBottom: 40 },
        ]}
        showsVerticalScrollIndicator={false}>
        {/* Profile Card Header (Read-only Info Modal) */}
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.profileCard,
            { backgroundColor: '#0F172A', borderColor: '#0F172A', borderRadius: 18 },
            pressed && { opacity: 0.9 },
          ]}
          onPress={() => setOwnerInfoVisible(true)}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>
              {getInitials(profile?.full_name)}
            </Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={[styles.profileName, { color: '#FFFFFF' }]}>
              {profile?.full_name || 'PG Owner'}
            </Text>
            <Text
              style={[styles.profileSubtitle, { color: '#94A3B8' }]}
              numberOfLines={1}>
              {profile?.phone_number || user?.email || 'Owner Account'}
            </Text>
          </View>
          <ChevronRight size={18} color="#94A3B8" />
        </Pressable>

        {/* Group 1: Properties & Operations */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>ACCOMMODATIONS</Text>
          <View style={styles.groupedCard}>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.settingsRow,
                styles.rowDivider,
                pressed && styles.rowPressed,
              ]}
              onPress={() => router.push('/owner-properties')}>
              <View
                style={[
                  styles.iconWrap,
                  { backgroundColor: OwnerTheme.colors.primaryLight },
                ]}>
                <Building2 size={18} color={OwnerTheme.colors.primary} />
              </View>
              <View style={styles.rowContent}>
                <Text style={styles.rowTitle}>PG Properties</Text>
                <Text style={styles.rowSubtitle} numberOfLines={1}>
                  {selectedProperty?.name || 'Manage PGs'} • {properties.length}{' '}
                  {properties.length === 1 ? 'property' : 'properties'}
                </Text>
              </View>
              <ChevronRight size={18} color={OwnerTheme.colors.textMuted} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.settingsRow,
                styles.rowDivider,
                pressed && styles.rowPressed,
              ]}
              onPress={() => router.push('/owner-wardens')}>
              <View
                style={[
                  styles.iconWrap,
                  { backgroundColor: OwnerTheme.colors.primaryLight },
                ]}>
                <UserCog size={18} color={OwnerTheme.colors.primary} />
              </View>
              <View style={styles.rowContent}>
                <Text style={styles.rowTitle}>Wardens</Text>
                <Text style={styles.rowSubtitle} numberOfLines={1}>
                  Assign food-alert wardens to your PGs
                </Text>
              </View>
              <ChevronRight size={18} color={OwnerTheme.colors.textMuted} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.settingsRow,
                pressed && styles.rowPressed,
              ]}
              onPress={() => {
                setWmModalTab('live');
                void openWmModal();
              }}>
              <View
                style={[
                  styles.iconWrap,
                  { backgroundColor: OwnerTheme.colors.primaryLight },
                ]}>
                <Disc3 size={18} color={OwnerTheme.colors.primary} />
              </View>
              <View style={styles.rowContent}>
                <Text style={styles.rowTitle}>Washing Machines</Text>
                <Text style={styles.rowSubtitle}>
                  {wmCountLoading
                    ? 'Checking units...'
                    : `${wmCount} unit${wmCount === 1 ? '' : 's'} · Live status, force-free & setup`}
                </Text>
              </View>
              <ChevronRight size={18} color={OwnerTheme.colors.textMuted} />
            </Pressable>
          </View>
        </View>

        {/* Group 2: Preferences & Security */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>PREFERENCES & SECURITY</Text>
          <View style={styles.groupedCard}>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.settingsRow,
                styles.rowDivider,
                pressed && styles.rowPressed,
              ]}
              onPress={() => router.push('/owner-notifications')}>
              <View
                style={[
                  styles.iconWrap,
                  { backgroundColor: OwnerTheme.colors.warningLight },
                ]}>
                <Bell size={18} color={OwnerTheme.colors.warning} />
              </View>
              <View style={styles.rowContent}>
                <Text style={styles.rowTitle}>Notifications & Alerts</Text>
                <Text style={styles.rowSubtitle}>
                  Non-college exits, evening hours & rate limits
                </Text>
              </View>
              <ChevronRight size={18} color={OwnerTheme.colors.textMuted} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.settingsRow,
                pressed && styles.rowPressed,
              ]}
              onPress={() => router.push('/owner-profile-edit')}>
              <View style={[styles.iconWrap, { backgroundColor: '#F1F5F9' }]}>
                <ShieldCheck
                  size={18}
                  color={OwnerTheme.colors.textPrimary}
                />
              </View>
              <View style={styles.rowContent}>
                <Text style={styles.rowTitle}>Profile & Password</Text>
                <Text style={styles.rowSubtitle}>
                  Update contact details & change password
                </Text>
              </View>
              <ChevronRight size={18} color={OwnerTheme.colors.textMuted} />
            </Pressable>

            <BiometricSettingsRow />
          </View>
        </View>

        <SettingsComplianceSection role="owner" userEmail={user?.email} />

        {/* Group 3: Log Out */}
        <View style={styles.section}>
          <View style={styles.groupedCard}>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.settingsRow,
                pressed && styles.rowPressed,
              ]}
              onPress={handleLogout}>
              <View
                style={[
                  styles.iconWrap,
                  { backgroundColor: OwnerTheme.colors.dangerLight },
                ]}>
                <LogOut size={18} color={OwnerTheme.colors.danger} />
              </View>
              <View style={styles.rowContent}>
                <Text style={styles.logoutText}>Log Out of PGwala</Text>
              </View>
            </Pressable>
          </View>
        </View>

        <Pressable
          accessibilityRole="text"
          onPress={handleVersionFooterTap}>
          <Text style={[styles.versionText, { color: colors.textMuted }]}>
            PGwala v{Constants.expoConfig?.version || '1.0.0'} • Owner Portal
          </Text>
        </Pressable>
      </ScrollView>

      {/* Read-only Owner Information Modal */}
      <Modal
        visible={ownerInfoVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setOwnerInfoVisible(false)}>
        <View style={styles.modalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityLabel="Close owner information modal"
            onPress={() => setOwnerInfoVisible(false)}
          />
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <View style={styles.modalHeader}>
              <Text
                style={[styles.modalTitle, { color: colors.textPrimary }]}>
                Owner Information
              </Text>
              <Pressable
                hitSlop={8}
                onPress={() => setOwnerInfoVisible(false)}>
                <X size={20} color={colors.textSecondary} />
              </Pressable>
            </View>
            <View style={{ gap: 10, marginTop: 12 }}>
              <View>
                <Text
                  style={[styles.rowSubtitle, { color: colors.textSecondary }]}>
                  Full Name
                </Text>
                <Text style={[styles.rowTitle, { color: colors.textPrimary }]}>
                  {profile?.full_name || 'PG Owner'}
                </Text>
              </View>
              <View>
                <Text
                  style={[styles.rowSubtitle, { color: colors.textSecondary }]}>
                  Email
                </Text>
                <Text style={[styles.rowTitle, { color: colors.textPrimary }]}>
                  {user?.email || '—'}
                </Text>
              </View>
              <View>
                <Text
                  style={[styles.rowSubtitle, { color: colors.textSecondary }]}>
                  Phone
                </Text>
                <Text style={[styles.rowTitle, { color: colors.textPrimary }]}>
                  {profile?.phone_number || 'Not added'}
                </Text>
              </View>
              <View>
                <Text
                  style={[styles.rowSubtitle, { color: colors.textSecondary }]}>
                  Properties Managed
                </Text>
                <Text style={[styles.rowTitle, { color: colors.textPrimary }]}>
                  {properties.length}
                </Text>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Unified Washing Machines Bottom Sheet (Live Status + Configure) */}
      <BottomSheetModal
        visible={wmModalVisible}
        onClose={() => setWmModalVisible(false)}
        title="Washing Machines"
        subtitle={selectedProperty?.name || 'Active Property'}
        disabled={savingWm}
        maxHeight="88%">
            {/* Unified Tab Switcher */}
            <View style={styles.wmTabRow}>
              <Pressable
                style={[
                  styles.wmTabBtn,
                  wmModalTab === 'live' && styles.wmTabBtnActive,
                ]}
                onPress={() => setWmModalTab('live')}>
                <Text
                  style={[
                    styles.wmTabText,
                    wmModalTab === 'live' && styles.wmTabTextActive,
                  ]}>
                  Live Status ({wmSummary.inUseCount} active)
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.wmTabBtn,
                  wmModalTab === 'configure' && styles.wmTabBtnActive,
                ]}
                onPress={() => setWmModalTab('configure')}>
                <Text
                  style={[
                    styles.wmTabText,
                    wmModalTab === 'configure' && styles.wmTabTextActive,
                  ]}>
                  Configure ({wmCount})
                </Text>
              </Pressable>
            </View>

            {wmModalTab === 'live' ? (
              <View style={{ gap: 10 }}>
                <View style={styles.wmSummaryStrip}>
                  <Text style={styles.wmSummaryChipFree}>
                    {wmSummary.freeCount} Free
                  </Text>
                  <Text style={styles.wmSummaryChipBusy}>
                    {wmSummary.inUseCount} In Use
                  </Text>
                  {outOfOrderCount > 0 ? (
                    <Text style={styles.wmSummaryChipOff}>
                      {outOfOrderCount} Out of Order
                    </Text>
                  ) : null}
                </View>

                <ScrollView
                  style={{ maxHeight: 300 }}
                  contentContainerStyle={{ gap: 8 }}
                  showsVerticalScrollIndicator={false}>
                  {dashboardQuery.isPending && wmUnits.length === 0 ? (
                    <View style={{ padding: 20, alignItems: 'center' }}>
                      <ActivityIndicator size="small" color={OwnerTheme.colors.primary} />
                    </View>
                  ) : wmUnits.length === 0 ? (
                    <Text style={styles.stepperHelpText}>
                      No washing machine units found. Switch to Configure to set up units.
                    </Text>
                  ) : (
                    wmUnits.map((unit) => {
                      const isInUse = unit.status === 'in_use';
                      const isOff = unit.status === 'out_of_order';
                      const isBusy = busyMachineId === unit.id;
                      const label = unit.machine_name || `Washing Machine ${unit.machine_number}`;
                      return (
                        <View key={unit.id} style={styles.liveUnitCard}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.liveUnitTitle}>{label}</Text>
                            <Text style={styles.liveUnitSub}>
                              {isOff
                                ? 'Out of order'
                                : isInUse
                                  ? `In use by ${unit.current_resident_name || 'Resident'}${
                                      unit.current_resident_room
                                        ? ` (Room ${unit.current_resident_room})`
                                        : ''
                                    }`
                                  : 'Free and ready'}
                            </Text>
                          </View>
                          <View style={styles.liveUnitActions}>
                            {isInUse ? (
                              <Pressable
                                disabled={isBusy}
                                style={styles.liveUnitBtnWarn}
                                onPress={() => handleOwnerReleaseWm(unit.id, label)}>
                                <Text style={styles.liveUnitBtnWarnText}>Free Up</Text>
                              </Pressable>
                            ) : null}
                            <Pressable
                              disabled={isBusy}
                              style={isOff ? styles.liveUnitBtnOk : styles.liveUnitBtnOff}
                              onPress={() =>
                                handleOwnerSetOutOfOrder(unit.id, label, !isOff, isInUse)
                              }>
                              <Text
                                style={
                                  isOff ? styles.liveUnitBtnOkText : styles.liveUnitBtnOffText
                                }>
                                {isOff ? 'Mark Working' : 'Out of Order'}
                              </Text>
                            </Pressable>
                          </View>
                        </View>
                      );
                    })
                  )}
                </ScrollView>
              </View>
            ) : (
              <>
                <View style={styles.stepperContainer}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Decrease units"
                    disabled={wmCount <= 1 || savingWm}
                    style={[
                      styles.stepperBtn,
                      (wmCount <= 1 || savingWm) && styles.stepperBtnDisabled,
                    ]}
                    onPress={() => setWmCount((prev) => Math.max(1, prev - 1))}>
                    <Minus
                      size={22}
                      color={
                        wmCount <= 1 ? '#CBD5E1' : OwnerTheme.colors.primary
                      }
                    />
                  </Pressable>

                  <View style={styles.stepperCountBox}>
                    <Text style={styles.stepperCountText}>{wmCount}</Text>
                    <Text style={styles.stepperCountLabel}>
                      {wmCount === 1 ? 'Machine Unit' : 'Machine Units'}
                    </Text>
                  </View>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Increase units"
                    disabled={wmCount >= 20 || savingWm}
                    style={[
                      styles.stepperBtn,
                      (wmCount >= 20 || savingWm) && styles.stepperBtnDisabled,
                    ]}
                    onPress={() => {
                      setWmCount((prev) => {
                        const next = Math.min(20, prev + 1);
                        setWmNames((prevNames) =>
                          prevNames[next]
                            ? prevNames
                            : { ...prevNames, [next]: `Washing Machine ${next}` }
                        );
                        return next;
                      });
                    }}>
                    <Plus
                      size={22}
                      color={
                        wmCount >= 20 ? '#CBD5E1' : OwnerTheme.colors.primary
                      }
                    />
                  </Pressable>
                </View>

                <Text style={styles.machineNamesLabel}>Machine Names</Text>
                <ScrollView
                  style={styles.machineNamesScroll}
                  contentContainerStyle={styles.machineNamesList}
                  nestedScrollEnabled
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator>
                  {unitNumbers.map((num) => (
                    <View key={num} style={styles.machineNameRow}>
                      <View style={styles.machineNumberPill}>
                        <Text style={styles.machineNumberText}>#{num}</Text>
                      </View>
                      <TextInput
                        style={styles.machineNameInput}
                        value={wmNames[num] ?? `Washing Machine ${num}`}
                        onChangeText={(val) =>
                          setWmNames((prev) => ({ ...prev, [num]: val }))
                        }
                        placeholder={`Washing Machine ${num}`}
                        placeholderTextColor={OwnerTheme.colors.textMuted}
                        editable={!savingWm}
                        maxLength={40}
                      />
                    </View>
                  ))}
                </ScrollView>

                <View style={styles.modalActionsRow}>
                  <Pressable
                    accessibilityRole="button"
                    style={styles.modalCancelBtn}
                    disabled={savingWm}
                    onPress={() => setWmModalVisible(false)}>
                    <Text style={styles.modalCancelBtnText}>Cancel</Text>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    style={[
                      styles.modalSaveBtn,
                      savingWm && styles.modalSaveBtnDisabled,
                    ]}
                    disabled={savingWm}
                    onPress={handleSaveWmCount}>
                    {savingWm ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={styles.modalSaveBtnText}>Save Capacity</Text>
                    )}
                  </Pressable>
                </View>
              </>
            )}
      </BottomSheetModal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: OwnerTheme.colors.background,
  },
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
    justifyContent: 'flex-start',
    gap: 12,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 14,
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
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 16,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  profileSubtitle: {
    fontSize: 13,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 2,
  },
  section: {
    gap: 4,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: OwnerTheme.colors.textMuted,
    letterSpacing: 0.6,
    marginLeft: 4,
  },
  groupedCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    overflow: 'hidden',
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 12,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: OwnerTheme.colors.borderLight,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: OwnerTheme.radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rowContent: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  rowSubtitle: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 2,
  },
  logoutText: {
    fontSize: 14,
    fontWeight: '700',
    color: OwnerTheme.colors.danger,
  },
  rowPressed: {
    backgroundColor: '#F8FAFC',
  },
  versionText: {
    textAlign: 'center',
    fontSize: 12,
    color: OwnerTheme.colors.textMuted,
    marginTop: 6,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    padding: 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  modalSubtitle: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 2,
  },
  stepperHelpText: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 18,
    marginVertical: 10,
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    paddingVertical: 14,
    paddingHorizontal: 20,
    marginVertical: 8,
    gap: 24,
  },
  stepperBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: OwnerTheme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#0284C7',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  stepperBtnDisabled: {
    borderColor: '#E2E8F0',
    backgroundColor: '#F1F5F9',
    shadowOpacity: 0,
    elevation: 0,
  },
  stepperCountBox: {
    alignItems: 'center',
    minWidth: 90,
  },
  stepperCountText: {
    fontSize: 34,
    fontWeight: '800',
    color: OwnerTheme.colors.textPrimary,
  },
  stepperCountLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
    marginTop: 2,
  },
  machineNamesLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: OwnerTheme.colors.textSecondary,
    marginTop: 10,
    marginBottom: 6,
  },
  machineNamesScroll: {
    maxHeight: 200,
  },
  machineNamesList: {
    gap: 8,
    paddingBottom: 4,
  },
  machineNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  machineNumberPill: {
    width: 34,
    height: 40,
    borderRadius: OwnerTheme.radius.sm,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  machineNumberText: {
    fontSize: 12,
    fontWeight: '700',
    color: OwnerTheme.colors.textSecondary,
  },
  machineNameInput: {
    flex: 1,
    height: 40,
    borderRadius: OwnerTheme.radius.sm,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    paddingHorizontal: 12,
    fontSize: 14,
    color: OwnerTheme.colors.textPrimary,
    backgroundColor: '#FAFAFA',
  },
  modalActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: OwnerTheme.radius.md,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  modalSaveBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: OwnerTheme.radius.md,
    backgroundColor: OwnerTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSaveBtnDisabled: {
    opacity: 0.65,
  },
  modalSaveBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  wmTabRow: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    padding: 3,
    marginBottom: 12,
    gap: 4,
  },
  wmTabBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  wmTabBtnActive: {
    backgroundColor: '#FFFFFF',
  },
  wmTabText: {
    fontSize: 12,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  wmTabTextActive: {
    color: OwnerTheme.colors.primary,
    fontWeight: '700',
  },
  wmSummaryStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  wmSummaryChipFree: {
    fontSize: 11,
    fontWeight: '700',
    color: '#15803D',
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  wmSummaryChipBusy: {
    fontSize: 11,
    fontWeight: '700',
    color: '#B45309',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  wmSummaryChipOff: {
    fontSize: 11,
    fontWeight: '700',
    color: '#B91C1C',
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  liveUnitCard: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  liveUnitTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  liveUnitSub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  liveUnitActions: {
    flexDirection: 'row',
    gap: 8,
  },
  liveUnitBtnWarn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  liveUnitBtnWarnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B45309',
  },
  liveUnitBtnOff: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  liveUnitBtnOffText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B91C1C',
  },
  liveUnitBtnOk: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  liveUnitBtnOkText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#15803D',
  },
});
