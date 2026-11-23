import React, { useEffect, useState } from 'react';
import {
  Alert,
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
import {
  Bell,
  CheckCircle2,
  Moon,
  Send,
  ShieldAlert,
  Smartphone,
} from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';
import { useToast } from '@/context/toast-context';
import { extractErrorMessage } from '@/lib/error-utils';
import {
  HIGH_CONTRAST_SWITCH_COLORS,
  OwnerHeader,
  PrimaryButton,
  SWITCH_THUMB_COLOR,
} from '@/components/ui/owner';

const STORAGE_NOTIF_PREFS = '@pgwala_owner_notif_prefs';

const QUIET_HOURS_PRESETS = [
  '10:00 PM – 7:00 AM',
  '11:00 PM – 6:00 AM',
  '9:00 PM – 7:00 AM',
] as const;

type QuietHoursWindow = (typeof QUIET_HOURS_PRESETS)[number];

interface DeliveryChannels {
  push: boolean;
  whatsapp: boolean;
  sms: boolean;
}

interface OwnerNotifPrefs {
  nonCollegeAlerts: boolean;
  eveningOnly: boolean;
  rateLimitEnabled: boolean;
  deliveryChannels: DeliveryChannels;
  quietHoursEnabled: boolean;
  quietHoursWindow: QuietHoursWindow;
}

const DEFAULT_PREFS: OwnerNotifPrefs = {
  nonCollegeAlerts: true,
  eveningOnly: true,
  rateLimitEnabled: true,
  deliveryChannels: {
    push: true,
    whatsapp: false,
    sms: false,
  },
  quietHoursEnabled: false,
  quietHoursWindow: '10:00 PM – 7:00 AM',
};

function isValidQuietWindow(val: unknown): val is QuietHoursWindow {
  return (
    typeof val === 'string' &&
    (QUIET_HOURS_PRESETS as readonly string[]).includes(val)
  );
}

export default function OwnerNotificationsScreen() {
  const { showToast } = useToast();
  const [prefs, setPrefs] = useState<OwnerNotifPrefs>(DEFAULT_PREFS);
  const [savedNotice, setSavedNotice] = useState(false);
  const [testingNotif, setTestingNotif] = useState(false);
  const [testNotice, setTestNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const savedPrefs = await AsyncStorage.getItem(STORAGE_NOTIF_PREFS);
        if (!active || !savedPrefs) return;
        const parsed = JSON.parse(savedPrefs);
        setPrefs({
          nonCollegeAlerts:
            typeof parsed.nonCollegeAlerts === 'boolean'
              ? parsed.nonCollegeAlerts
              : DEFAULT_PREFS.nonCollegeAlerts,
          eveningOnly:
            typeof parsed.eveningOnly === 'boolean'
              ? parsed.eveningOnly
              : DEFAULT_PREFS.eveningOnly,
          rateLimitEnabled:
            typeof parsed.rateLimitEnabled === 'boolean'
              ? parsed.rateLimitEnabled
              : DEFAULT_PREFS.rateLimitEnabled,
          deliveryChannels: {
            push:
              typeof parsed.deliveryChannels?.push === 'boolean'
                ? parsed.deliveryChannels.push
                : DEFAULT_PREFS.deliveryChannels.push,
            whatsapp:
              typeof parsed.deliveryChannels?.whatsapp === 'boolean'
                ? parsed.deliveryChannels.whatsapp
                : DEFAULT_PREFS.deliveryChannels.whatsapp,
            sms:
              typeof parsed.deliveryChannels?.sms === 'boolean'
                ? parsed.deliveryChannels.sms
                : DEFAULT_PREFS.deliveryChannels.sms,
          },
          quietHoursEnabled:
            typeof parsed.quietHoursEnabled === 'boolean'
              ? parsed.quietHoursEnabled
              : DEFAULT_PREFS.quietHoursEnabled,
          quietHoursWindow: isValidQuietWindow(parsed.quietHoursWindow)
            ? parsed.quietHoursWindow
            : DEFAULT_PREFS.quietHoursWindow,
        });
      } catch (err) {
        console.warn('Failed to load notification preferences:', err);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!savedNotice) return;
    const timer = setTimeout(() => setSavedNotice(false), 2000);
    return () => clearTimeout(timer);
  }, [savedNotice]);

  const persistPreferences = async (next: OwnerNotifPrefs) => {
    try {
      await AsyncStorage.setItem(STORAGE_NOTIF_PREFS, JSON.stringify(next));
      setSavedNotice(true);
    } catch (err) {
      console.warn('Failed to save notification preferences:', err);
    }
  };

  const updatePrefs = (patch: Partial<OwnerNotifPrefs>) => {
    setPrefs((prev) => {
      const next: OwnerNotifPrefs = {
        ...prev,
        ...patch,
        deliveryChannels: {
          ...prev.deliveryChannels,
          ...(patch.deliveryChannels ?? {}),
        },
      };
      void persistPreferences(next);
      return next;
    });
  };

  const updateChannel = (channel: keyof DeliveryChannels, value: boolean) => {
    setPrefs((prev) => {
      const next: OwnerNotifPrefs = {
        ...prev,
        deliveryChannels: {
          ...prev.deliveryChannels,
          [channel]: value,
        },
      };
      void persistPreferences(next);
      return next;
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
        showToast('Local push notifications are unavailable on web browsers.');
        return;
      }

      const existing = await Notifications.getPermissionsAsync();
      let finalStatus = existing.status;
      if (finalStatus !== 'granted') {
        const requested = await Notifications.requestPermissionsAsync();
        finalStatus = requested.status;
      }

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
          await Notifications.setNotificationChannelAsync('owner-alerts', {
            name: 'Owner Alerts',
            importance: 6, // AndroidImportance.HIGH === 6
          });
        } catch (channelErr) {
          console.warn('[OwnerNotifications] Channel setup skipped:', channelErr);
        }
      }

      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'PGwala Test Alert',
          body: 'Resident Departure Alert: Arun Kumar (Room 101) checked OUT.',
          sound: true,
        },
        trigger: null,
      });

      setTestNotice('Test notification triggered on this device.');
    } catch (err: unknown) {
      const msg = extractErrorMessage(
        err,
        'Could not trigger test notification on this device.'
      );
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
        subtitle="Manage gate alerts and operational notifications"
        showBack
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        {savedNotice && (
          <View style={styles.savedBanner}>
            <CheckCircle2 size={16} color={OwnerTheme.colors.success} />
            <Text style={styles.savedBannerText}>Preferences saved</Text>
          </View>
        )}

        {/* Resident Departure Alerts Section */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <ShieldAlert size={18} color={OwnerTheme.colors.warning} />
            <Text style={styles.cardTitle}>Resident Departure Alerts</Text>
          </View>
          <Text style={styles.cardDescription}>
            Get notified when residents check OUT for reasons other than college.
          </Text>

          <View style={styles.settingRow}>
            <View style={styles.settingTextCol}>
              <Text style={styles.settingLabel}>Non-College Exit Alerts</Text>
              <Text style={styles.settingHint}>
                Alerts when residents leave for shopping, outing, or hometown
              </Text>
            </View>
            <Switch
              value={prefs.nonCollegeAlerts}
              onValueChange={(val) => updatePrefs({ nonCollegeAlerts: val })}
              trackColor={HIGH_CONTRAST_SWITCH_COLORS}
              thumbColor={SWITCH_THUMB_COLOR}
            />
          </View>

          {/* Nested Child Options */}
          <View
            style={[
              styles.nestedChildren,
              !prefs.nonCollegeAlerts && styles.nestedDisabled,
            ]}
            pointerEvents={prefs.nonCollegeAlerts ? 'auto' : 'none'}>
            <View style={styles.settingRow}>
              <View style={styles.settingTextCol}>
                <Text style={styles.settingLabel}>
                  Evening Hours Only (6:00 PM+)
                </Text>
                <Text style={styles.settingHint}>
                  Only alert for evening or night departures to avoid routine
                  daytime notifications
                </Text>
              </View>
              <Switch
                value={prefs.eveningOnly}
                disabled={!prefs.nonCollegeAlerts}
                onValueChange={(val) => updatePrefs({ eveningOnly: val })}
                trackColor={HIGH_CONTRAST_SWITCH_COLORS}
                thumbColor={SWITCH_THUMB_COLOR}
              />
            </View>

            <View style={[styles.settingRow, styles.lastRow]}>
              <View style={styles.settingTextCol}>
                <Text style={styles.settingLabel}>Limit repeat alerts</Text>
                <Text style={styles.settingHint}>
                  Limit repeat alerts to 1 per 15 min per resident
                </Text>
              </View>
              <Switch
                value={prefs.rateLimitEnabled}
                disabled={!prefs.nonCollegeAlerts}
                onValueChange={(val) => updatePrefs({ rateLimitEnabled: val })}
                trackColor={HIGH_CONTRAST_SWITCH_COLORS}
                thumbColor={SWITCH_THUMB_COLOR}
              />
            </View>
          </View>
        </View>

        {/* Delivery Channels Section */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Bell size={18} color={OwnerTheme.colors.primary} />
            <Text style={styles.cardTitle}>Delivery Channels</Text>
          </View>
          <Text style={styles.cardDescription}>
            Choose how departure and operational alerts are delivered to you.
          </Text>

          <View style={[styles.settingRow, styles.lastRow]}>
            <View style={styles.settingTextCol}>
              <View style={styles.labelWithIcon}>
                <Smartphone size={14} color={OwnerTheme.colors.textSecondary} />
                <Text style={styles.settingLabel}>Push notifications</Text>
              </View>
              <Text style={styles.settingHint}>
                Instant alerts on this device through the PGwala app
              </Text>
            </View>
            <Switch
              value={prefs.deliveryChannels.push}
              onValueChange={(val) => updateChannel('push', val)}
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
              onValueChange={(val) => updatePrefs({ quietHoursEnabled: val })}
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
                      updatePrefs({ quietHoursWindow: windowLabel })
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

        {/* Test Notification Action */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Send size={17} color={OwnerTheme.colors.primary} />
            <Text style={styles.cardTitle}>Verify Device Alerts</Text>
          </View>
          <Text style={styles.cardDescription}>
            Trigger an immediate sample notification to verify alerts are
            working on this device.
          </Text>

          <PrimaryButton
            label="Send Test Notification"
            icon={Bell}
            onPress={handleSendTestNotification}
            loading={testingNotif}
          />

          {testNotice && (
            <View style={styles.testNoticeBox}>
              <Text style={styles.testNoticeText}>{testNotice}</Text>
            </View>
          )}
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
  nestedChildren: {
    marginLeft: 14,
    paddingLeft: 14,
    marginTop: 4,
    borderLeftWidth: 2,
    borderLeftColor: OwnerTheme.colors.border,
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
  savedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: OwnerTheme.colors.successLight,
    borderWidth: 1,
    borderColor: '#86EFAC',
    borderRadius: OwnerTheme.radius.md,
    padding: 10,
  },
  savedBannerText: {
    fontSize: 13,
    color: OwnerTheme.colors.success,
    fontWeight: '600',
  },
});
