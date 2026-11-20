import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  AppState,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { router, useFocusEffect } from 'expo-router';
import {
  Bell,
  Disc3,
  Megaphone,
  Moon,
  Receipt,
  Settings,
  Smartphone,
  Utensils,
} from 'lucide-react-native';

import {
  HIGH_CONTRAST_SWITCH_COLORS,
  OwnerHeader,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  SWITCH_THUMB_COLOR,
} from '@/components/ui/owner';
import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/context/toast-context';
import { useOfflineMutation } from '@/hooks/use-offline-mutation';
import { triggerSelectionHaptic, triggerSuccessHaptic } from '@/lib/haptics';
import { registerForPushNotifications } from '@/lib/push-notifications';
import { supabase } from '@/lib/supabase';

const QUIET_HOURS_PRESETS = [
  '10:00 pm – 7:00 am',
  '11:00 pm – 6:00 am',
  '9:00 pm – 7:00 am',
] as const;

type QuietHoursWindow = (typeof QUIET_HOURS_PRESETS)[number];

interface ResidentNotifPrefs {
  rentReminders: boolean;
  foodMealUpdates: boolean;
  washingMachineAlerts: boolean;
  ownerAnnouncements: boolean;
  quietHoursEnabled: boolean;
  quietHoursWindow: QuietHoursWindow;
}

const DEFAULT_PREFS: ResidentNotifPrefs = {
  rentReminders: true,
  foodMealUpdates: true,
  washingMachineAlerts: true,
  ownerAnnouncements: true,
  quietHoursEnabled: false,
  quietHoursWindow: '10:00 pm – 7:00 am',
};

function normalizeQuietWindow(val: unknown): QuietHoursWindow {
  if (typeof val !== 'string') return DEFAULT_PREFS.quietHoursWindow;
  const normalized = val.trim().toLowerCase();
  const match = QUIET_HOURS_PRESETS.find(
    (preset) => preset.toLowerCase() === normalized
  );
  return match ?? DEFAULT_PREFS.quietHoursWindow;
}

function prefsStorageKey(userId?: string): string {
  return `@pgwala_student_notif_prefs:${userId || 'local'}`;
}

export default function StudentNotificationsScreen() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const userId = user?.id;
  const storageKey = prefsStorageKey(userId);

  const [prefs, setPrefs] = useState<ResidentNotifPrefs>(DEFAULT_PREFS);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [canAskAgain, setCanAskAgain] = useState(true);
  const [enablingPush, setEnablingPush] = useState(false);
  const [testingNotif, setTestingNotif] = useState(false);
  const [testNotice, setTestNotice] = useState<string | null>(null);

  const executeFoodOptIn = useCallback(async (payload: { value: boolean }) => {
    const { error } = await supabase.rpc('set_my_meal_opt_in', {
      p_value: payload.value,
    });
    if (error) throw error;
  }, []);

  const { mutate: mutateFoodOptIn, isMutating: savingFoodOptIn } =
    useOfflineMutation<{ value: boolean }, void>({
      operation: 'food_opt_in',
      execute: executeFoodOptIn,
    });

  const refreshPermissionStatus = useCallback(async () => {
    if (Platform.OS === 'web') {
      setPushEnabled(false);
      setCanAskAgain(false);
      return;
    }
    try {
      const perms = await Notifications.getPermissionsAsync();
      setPushEnabled(Boolean(perms.granted || perms.status === 'granted'));
      setCanAskAgain(perms.canAskAgain ?? true);
    } catch {
      setPushEnabled(false);
    }
  }, []);

  const loadPreferences = useCallback(async () => {
    try {
      const [savedRaw, residentRes] = await Promise.all([
        AsyncStorage.getItem(storageKey),
        userId
          ? supabase
              .from('residents')
              .select('meal_opt_in')
              .eq('profile_id', userId)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);

      let nextPrefs: ResidentNotifPrefs = { ...DEFAULT_PREFS };
      if (savedRaw) {
        const parsed = JSON.parse(savedRaw) as Partial<ResidentNotifPrefs>;
        nextPrefs = {
          rentReminders:
            typeof parsed.rentReminders === 'boolean'
              ? parsed.rentReminders
              : DEFAULT_PREFS.rentReminders,
          foodMealUpdates:
            typeof parsed.foodMealUpdates === 'boolean'
              ? parsed.foodMealUpdates
              : DEFAULT_PREFS.foodMealUpdates,
          washingMachineAlerts:
            typeof parsed.washingMachineAlerts === 'boolean'
              ? parsed.washingMachineAlerts
              : DEFAULT_PREFS.washingMachineAlerts,
          ownerAnnouncements:
            typeof parsed.ownerAnnouncements === 'boolean'
              ? parsed.ownerAnnouncements
              : DEFAULT_PREFS.ownerAnnouncements,
          quietHoursEnabled:
            typeof parsed.quietHoursEnabled === 'boolean'
              ? parsed.quietHoursEnabled
              : DEFAULT_PREFS.quietHoursEnabled,
          quietHoursWindow: normalizeQuietWindow(parsed.quietHoursWindow),
        };
      }

      if (
        !residentRes.error &&
        residentRes.data &&
        typeof (residentRes.data as { meal_opt_in?: unknown }).meal_opt_in === 'boolean'
      ) {
        const serverMealOptIn = (residentRes.data as { meal_opt_in: boolean }).meal_opt_in;
        if (nextPrefs.foodMealUpdates !== serverMealOptIn) {
          nextPrefs = { ...nextPrefs, foodMealUpdates: serverMealOptIn };
          await AsyncStorage.setItem(storageKey, JSON.stringify(nextPrefs));
        }
      }

      setPrefs(nextPrefs);
    } catch (err) {
      console.warn('[StudentNotifications] Failed to load preferences:', err);
    }
  }, [storageKey, userId]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const timer = setTimeout(() => {
        if (!active) return;
        void refreshPermissionStatus();
        void loadPreferences();
      }, 0);
      return () => {
        active = false;
        clearTimeout(timer);
      };
    }, [refreshPermissionStatus, loadPreferences])
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void refreshPermissionStatus();
      }
    });
    return () => {
      subscription.remove();
    };
  }, [refreshPermissionStatus]);

  const persistLocalPrefs = async (next: ResidentNotifPrefs) => {
    try {
      await AsyncStorage.setItem(storageKey, JSON.stringify(next));
    } catch (err) {
      console.warn('[StudentNotifications] Failed to persist preferences:', err);
    }
  };

  const handleUpdatePrefs = (patch: Partial<ResidentNotifPrefs>) => {
    const next: ResidentNotifPrefs = {
      ...prefs,
      ...patch,
    };
    setPrefs(next);
    triggerSelectionHaptic();
    void persistLocalPrefs(next);
    showToast('Notification settings saved');
  };

  const handleToggleFoodMealUpdates = async (nextValue: boolean) => {
    if (savingFoodOptIn) return;
    const previous = prefs;
    const next: ResidentNotifPrefs = {
      ...prefs,
      foodMealUpdates: nextValue,
    };
    setPrefs(next);
    triggerSelectionHaptic();
    await persistLocalPrefs(next);

    const outcome = await mutateFoodOptIn(
      { value: nextValue },
      `food-opt-in-${userId || 'local'}-${Date.now()}`
    );

    if (!outcome.ok) {
      setPrefs(previous);
      await persistLocalPrefs(previous);
      Alert.alert(
        'Update Failed',
        outcome.error.message || 'Could not sync meal update preference.'
      );
      return;
    }

    showToast('Notification settings saved');
  };

  const handleEnablePush = async () => {
    if (enablingPush) return;
    if (Platform.OS === 'web') {
      Alert.alert(
        'Mobile App Only',
        'Push notifications are available on the PGwala Android and iOS mobile apps.'
      );
      return;
    }

    setEnablingPush(true);
    try {
      const regRes = await registerForPushNotifications({ askPermission: true });
      const perms = await Notifications.getPermissionsAsync();
      const granted = Boolean(perms.granted || perms.status === 'granted');
      setPushEnabled(granted);
      setCanAskAgain(perms.canAskAgain ?? true);

      if (regRes.status === 'registered' || granted) {
        triggerSuccessHaptic();
        showToast('Push notifications enabled');
        return;
      }

      if (regRes.status === 'denied' || (!granted && !perms.canAskAgain)) {
        await Linking.openSettings();
        return;
      }

      if (regRes.status === 'unsupported') {
        const requested = await Notifications.requestPermissionsAsync();
        const reqGranted = Boolean(
          requested.granted || requested.status === 'granted'
        );
        setPushEnabled(reqGranted);
        setCanAskAgain(requested.canAskAgain ?? true);
        if (reqGranted) {
          triggerSuccessHaptic();
          showToast('Notification permissions enabled');
        } else {
          Alert.alert('Push Notifications', regRes.reason);
        }
      }
    } catch {
      await Linking.openSettings().catch(() => {});
    } finally {
      setEnablingPush(false);
    }
  };

  const handleOpenDeviceSettings = () => {
    void Linking.openSettings().catch(() => {
      Alert.alert(
        'Settings Unavailable',
        'Open your device Settings app and allow notifications for PGwala.'
      );
    });
  };

  const handleSendTestNotification = async () => {
    if (testingNotif) return;
    setTestingNotif(true);
    setTestNotice(null);

    try {
      if (Platform.OS === 'web') {
        const msg =
          'Local push notifications are unavailable on web browsers. On Android and iOS devices, PGwala triggers a live alert banner here.';
        setTestNotice(msg);
        Alert.alert('Test Notification (Web)', msg);
        return;
      }

      const existing = await Notifications.getPermissionsAsync();
      let finalStatus = existing.status;
      if (finalStatus !== 'granted') {
        const requested = await Notifications.requestPermissionsAsync();
        finalStatus = requested.status;
      }

      setPushEnabled(finalStatus === 'granted');

      if (finalStatus !== 'granted') {
        const deniedMsg =
          'Notification permissions are denied. Please enable notifications for PGwala in your device settings to test alerts.';
        setTestNotice(deniedMsg);
        Alert.alert('Permission Required', deniedMsg);
        return;
      }

      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });

      if (Platform.OS === 'android') {
        try {
          await Notifications.setNotificationChannelAsync('resident-alerts', {
            name: 'Resident Alerts',
            importance: 6, // AndroidImportance.HIGH === 6
          });
        } catch (channelErr) {
          console.warn('[StudentNotifications] Channel setup skipped:', channelErr);
        }
      }

      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'PGwala Test Alert',
          body: 'Dinner is ready in the mess hall. Check your Mess Menu for tonight!',
          sound: true,
        },
        trigger: null,
      });

      triggerSuccessHaptic();
      setTestNotice('Test notification triggered on this device.');
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Could not trigger test notification on this device.';
      setTestNotice(msg);
      Alert.alert('Notification Test Failed', msg);
    } finally {
      setTestingNotif(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <OwnerHeader
        title="Notification Settings"
        subtitle="Manage your PG alert preferences"
        showBack
        onBack={() =>
          router.canGoBack() ? router.back() : router.replace('/student-dashboard')
        }
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        {/* Push Permission & Test Card */}
        <View style={styles.card}>
          <View style={styles.permissionHeaderRow}>
            <View style={styles.cardHeaderLeft}>
              <Smartphone size={18} color={OwnerTheme.colors.primary} />
              <Text style={styles.cardTitle}>Device Push Alerts</Text>
            </View>
            <StatusBadge
              label={pushEnabled ? 'Enabled' : 'Off'}
              variant={pushEnabled ? 'success' : 'neutral'}
              size="sm"
            />
          </View>

          <Text style={styles.cardDescription}>
            {Platform.OS === 'web'
              ? 'Push notifications are delivered on the PGwala Android and iOS apps. You can always read updates inside the Notices inbox.'
              : pushEnabled
                ? 'Push permissions are active on this device for rent reminders, meal updates, and owner announcements.'
                : 'Enable push notifications on this device so you never miss meal updates, rent dues, or urgent PG notices.'}
          </Text>

          <View style={styles.pushActionsRow}>
            {!pushEnabled && canAskAgain && Platform.OS !== 'web' ? (
              <SecondaryButton
                label="Enable"
                icon={Bell}
                onPress={() => void handleEnablePush()}
                loading={enablingPush}
                style={styles.pushActionFlex}
              />
            ) : (
              <SecondaryButton
                label="Device Settings"
                icon={Settings}
                onPress={handleOpenDeviceSettings}
                style={styles.pushActionFlex}
              />
            )}
          </View>

          <PrimaryButton
            label="Send Test Notification"
            icon={Bell}
            onPress={() => void handleSendTestNotification()}
            loading={testingNotif}
            style={styles.testButton}
          />

          {testNotice && (
            <View style={styles.testNoticeBox}>
              <Text style={styles.testNoticeText}>{testNotice}</Text>
            </View>
          )}
        </View>

        {/* Alert Toggles Section */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Bell size={18} color={OwnerTheme.colors.primary} />
            <Text style={styles.cardTitle}>Alert Preferences</Text>
          </View>
          <Text style={styles.cardDescription}>
            Choose which PG updates and reminders you want to receive.
          </Text>

          <View style={styles.settingRow}>
            <View style={styles.settingTextCol}>
              <View style={styles.labelWithIcon}>
                <Receipt size={14} color={OwnerTheme.colors.textSecondary} />
                <Text style={styles.settingLabel}>Rent & Bill Reminders</Text>
              </View>
              <Text style={styles.settingHint}>
                Reminders for monthly rent, EB split bills, and payment approvals
              </Text>
            </View>
            <Switch
              value={prefs.rentReminders}
              onValueChange={(val) => handleUpdatePrefs({ rentReminders: val })}
              trackColor={HIGH_CONTRAST_SWITCH_COLORS}
              thumbColor={SWITCH_THUMB_COLOR}
            />
          </View>

          <View style={styles.settingRow}>
            <View style={styles.settingTextCol}>
              <View style={styles.labelWithIcon}>
                <Utensils size={14} color={OwnerTheme.colors.textSecondary} />
                <Text style={styles.settingLabel}>Food & Meal Updates</Text>
              </View>
              <Text style={styles.settingHint}>
                Get meal alerts when food is ready, delayed, or cancelled
              </Text>
            </View>
            <Switch
              value={prefs.foodMealUpdates}
              disabled={savingFoodOptIn}
              onValueChange={(val) => void handleToggleFoodMealUpdates(val)}
              trackColor={HIGH_CONTRAST_SWITCH_COLORS}
              thumbColor={SWITCH_THUMB_COLOR}
            />
          </View>

          <View style={styles.settingRow}>
            <View style={styles.settingTextCol}>
              <View style={styles.labelWithIcon}>
                <Disc3 size={14} color={OwnerTheme.colors.textSecondary} />
                <Text style={styles.settingLabel}>Washing Machine Free Alerts</Text>
              </View>
              <Text style={styles.settingHint}>
                Get notified when a shared washing machine finishes and becomes free
              </Text>
            </View>
            <Switch
              value={prefs.washingMachineAlerts}
              onValueChange={(val) =>
                handleUpdatePrefs({ washingMachineAlerts: val })
              }
              trackColor={HIGH_CONTRAST_SWITCH_COLORS}
              thumbColor={SWITCH_THUMB_COLOR}
            />
          </View>

          <View style={[styles.settingRow, styles.lastRow]}>
            <View style={styles.settingTextCol}>
              <View style={styles.labelWithIcon}>
                <Megaphone size={14} color={OwnerTheme.colors.textSecondary} />
                <Text style={styles.settingLabel}>Owner Announcements</Text>
              </View>
              <Text style={styles.settingHint}>
                Important notices, maintenance schedules, and room broadcasts
              </Text>
            </View>
            <Switch
              value={prefs.ownerAnnouncements}
              onValueChange={(val) =>
                handleUpdatePrefs({ ownerAnnouncements: val })
              }
              trackColor={HIGH_CONTRAST_SWITCH_COLORS}
              thumbColor={SWITCH_THUMB_COLOR}
            />
          </View>
        </View>

        {/* Quiet Hours Section */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Moon size={18} color={OwnerTheme.colors.primary} />
            <Text style={styles.cardTitle}>Quiet Hours</Text>
          </View>
          <Text style={styles.cardDescription}>
            Silence non-urgent notifications during overnight hours.
          </Text>

          <View style={styles.settingRow}>
            <View style={styles.settingTextCol}>
              <Text style={styles.settingLabel}>Enable Quiet Hours</Text>
              <Text style={styles.settingHint}>
                Hold non-critical alerts during your selected sleep window
              </Text>
            </View>
            <Switch
              value={prefs.quietHoursEnabled}
              onValueChange={(val) =>
                handleUpdatePrefs({ quietHoursEnabled: val })
              }
              trackColor={HIGH_CONTRAST_SWITCH_COLORS}
              thumbColor={SWITCH_THUMB_COLOR}
            />
          </View>

          <View
            style={[
              styles.quietPresetsContainer,
              !prefs.quietHoursEnabled && styles.nestedDisabled,
            ]}
            pointerEvents={prefs.quietHoursEnabled ? 'auto' : 'none'}>
            <Text style={styles.presetsLabel}>Quiet Hours Window</Text>
            <View style={styles.presetsWrap}>
              {QUIET_HOURS_PRESETS.map((windowLabel) => {
                const isSelected = prefs.quietHoursWindow === windowLabel;
                return (
                  <Pressable
                    key={windowLabel}
                    accessibilityRole="radio"
                    accessibilityState={{
                      selected: isSelected,
                      disabled: !prefs.quietHoursEnabled,
                    }}
                    disabled={!prefs.quietHoursEnabled}
                    onPress={() =>
                      handleUpdatePrefs({ quietHoursWindow: windowLabel })
                    }
                    style={[
                      styles.presetChip,
                      isSelected && styles.presetChipActive,
                    ]}>
                    <Text
                      style={[
                        styles.presetChipText,
                        isSelected && styles.presetChipTextActive,
                      ]}>
                      {windowLabel}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: OwnerTheme.colors.background,
  },
  scrollContent: {
    padding: 16,
    gap: 14,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 16,
  },
  permissionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 6,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  cardDescription: {
    fontSize: 13,
    color: OwnerTheme.colors.textSecondary,
    marginBottom: 12,
    lineHeight: 18,
  },
  pushActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  pushActionFlex: {
    flex: 1,
  },
  testButton: {
    marginTop: 10,
  },
  testNoticeBox: {
    marginTop: 10,
    padding: 10,
    borderRadius: OwnerTheme.radius.sm,
    backgroundColor: OwnerTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.primaryLight,
  },
  testNoticeText: {
    fontSize: 12,
    color: OwnerTheme.colors.textPrimary,
    lineHeight: 17,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: OwnerTheme.colors.borderLight,
    gap: 12,
  },
  lastRow: {
    borderBottomWidth: 0,
    paddingBottom: 4,
  },
  settingTextCol: {
    flex: 1,
  },
  labelWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  settingLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  settingHint: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 2,
    lineHeight: 16,
  },
  nestedDisabled: {
    opacity: 0.45,
  },
  quietPresetsContainer: {
    marginTop: 12,
  },
  presetsLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
    marginBottom: 8,
  },
  presetsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  presetChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: OwnerTheme.radius.full,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    backgroundColor: '#FAFAFA',
  },
  presetChipActive: {
    borderColor: OwnerTheme.colors.primary,
    backgroundColor: OwnerTheme.colors.primaryLight,
  },
  presetChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  presetChipTextActive: {
    color: OwnerTheme.colors.primary,
    fontWeight: '700',
  },
});
