import React, { useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Bell, ShieldAlert, CreditCard, Wrench, CheckCircle2 } from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';
import { OwnerHeader } from '@/components/ui/owner';

const STORAGE_NOTIF_PREFS = '@pgwala_owner_notif_prefs';

export default function OwnerNotificationsScreen() {
  const [nonCollegeAlerts, setNonCollegeAlerts] = useState(true);
  const [eveningOnly, setEveningOnly] = useState(true);
  const [rateLimitEnabled, setRateLimitEnabled] = useState(true);
  const [paymentAlerts, setPaymentAlerts] = useState(true);
  const [maintenanceAlerts, setMaintenanceAlerts] = useState(true);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const savedPrefs = await AsyncStorage.getItem(STORAGE_NOTIF_PREFS);
        if (savedPrefs) {
          const parsed = JSON.parse(savedPrefs);
          if (typeof parsed.nonCollegeAlerts === 'boolean')
            setNonCollegeAlerts(parsed.nonCollegeAlerts);
          if (typeof parsed.eveningOnly === 'boolean')
            setEveningOnly(parsed.eveningOnly);
          if (typeof parsed.rateLimitEnabled === 'boolean')
            setRateLimitEnabled(parsed.rateLimitEnabled);
          if (typeof parsed.paymentAlerts === 'boolean')
            setPaymentAlerts(parsed.paymentAlerts);
          if (typeof parsed.maintenanceAlerts === 'boolean')
            setMaintenanceAlerts(parsed.maintenanceAlerts);
        }
      } catch (err) {
        console.warn('Failed to load notification preferences:', err);
      }
    })();
  }, []);

  const savePreferences = async (newPrefs: {
    nonCollegeAlerts?: boolean;
    eveningOnly?: boolean;
    rateLimitEnabled?: boolean;
    paymentAlerts?: boolean;
    maintenanceAlerts?: boolean;
  }) => {
    try {
      const payload = {
        nonCollegeAlerts,
        eveningOnly,
        rateLimitEnabled,
        paymentAlerts,
        maintenanceAlerts,
        ...newPrefs,
      };
      await AsyncStorage.setItem(STORAGE_NOTIF_PREFS, JSON.stringify(payload));
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2000);
    } catch (err) {
      console.warn('Failed to save notification preferences:', err);
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

        {/* Departure Alerts Section */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <ShieldAlert size={18} color={OwnerTheme.colors.warning} />
            <Text style={styles.cardTitle}>Student Departure Alerts</Text>
          </View>
          <Text style={styles.cardDescription}>
            Get notified when residents check OUT for reasons other than college.
          </Text>

          <View style={styles.settingRow}>
            <View style={styles.settingTextCol}>
              <Text style={styles.settingLabel}>Non-College Exit Alerts</Text>
              <Text style={styles.settingHint}>
                Alerts when students leave for shopping, outing, or hometown
              </Text>
            </View>
            <Switch
              value={nonCollegeAlerts}
              onValueChange={(val) => {
                setNonCollegeAlerts(val);
                savePreferences({ nonCollegeAlerts: val });
              }}
              trackColor={{
                false: '#E2E8F0',
                true: OwnerTheme.colors.primary,
              }}
              thumbColor="#FFFFFF"
            />
          </View>

          <View style={styles.settingRow}>
            <View style={styles.settingTextCol}>
              <Text style={styles.settingLabel}>Evening Hours Only (6:00 PM+)</Text>
              <Text style={styles.settingHint}>
                Only alert for evening or night departures to avoid routine daytime notifications
              </Text>
            </View>
            <Switch
              value={eveningOnly}
              disabled={!nonCollegeAlerts}
              onValueChange={(val) => {
                setEveningOnly(val);
                savePreferences({ eveningOnly: val });
              }}
              trackColor={{
                false: '#E2E8F0',
                true: OwnerTheme.colors.primary,
              }}
              thumbColor="#FFFFFF"
            />
          </View>

          <View style={styles.settingRow}>
            <View style={styles.settingTextCol}>
              <Text style={styles.settingLabel}>Anti-Flooding Rate Limiter</Text>
              <Text style={styles.settingHint}>
                Throttle repeated logs to at most 1 alert every 15 minutes per resident
              </Text>
            </View>
            <Switch
              value={rateLimitEnabled}
              disabled={!nonCollegeAlerts}
              onValueChange={(val) => {
                setRateLimitEnabled(val);
                savePreferences({ rateLimitEnabled: val });
              }}
              trackColor={{
                false: '#E2E8F0',
                true: OwnerTheme.colors.primary,
              }}
              thumbColor="#FFFFFF"
            />
          </View>
        </View>

        {/* Operational Alerts Section */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Bell size={18} color={OwnerTheme.colors.primary} />
            <Text style={styles.cardTitle}>Operational Notifications</Text>
          </View>
          <Text style={styles.cardDescription}>
            Notifications for daily PG management tasks.
          </Text>

          <View style={styles.settingRow}>
            <View style={styles.settingTextCol}>
              <View style={styles.labelWithIcon}>
                <CreditCard size={14} color={OwnerTheme.colors.textSecondary} />
                <Text style={styles.settingLabel}>Payment Proof Submissions</Text>
              </View>
              <Text style={styles.settingHint}>
                Notify when a student submits UPI or cash payment proof
              </Text>
            </View>
            <Switch
              value={paymentAlerts}
              onValueChange={(val) => {
                setPaymentAlerts(val);
                savePreferences({ paymentAlerts: val });
              }}
              trackColor={{
                false: '#E2E8F0',
                true: OwnerTheme.colors.primary,
              }}
              thumbColor="#FFFFFF"
            />
          </View>

          <View style={styles.settingRow}>
            <View style={styles.settingTextCol}>
              <View style={styles.labelWithIcon}>
                <Wrench size={14} color={OwnerTheme.colors.textSecondary} />
                <Text style={styles.settingLabel}>New Maintenance Requests</Text>
              </View>
              <Text style={styles.settingHint}>
                Notify when an issue (plumbing, electrical, Wi-Fi) is submitted
              </Text>
            </View>
            <Switch
              value={maintenanceAlerts}
              onValueChange={(val) => {
                setMaintenanceAlerts(val);
                savePreferences({ maintenanceAlerts: val });
              }}
              trackColor={{
                false: '#E2E8F0',
                true: OwnerTheme.colors.primary,
              }}
              thumbColor="#FFFFFF"
            />
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
