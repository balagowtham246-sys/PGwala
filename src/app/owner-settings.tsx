import React from 'react';
import {
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  Building2,
  ChevronRight,
  LogOut,
  Bell,
  ShieldCheck,
  UserPlus,
} from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useProperty } from '@/context/property-context';
import { OwnerHeader } from '@/components/ui/owner';

export default function OwnerSettingsScreen() {
  const { user, profile, signOut } = useAuth();
  const { selectedProperty, properties } = useProperty();

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

  return (
    <SafeAreaView style={styles.safeArea}>
      <OwnerHeader
        title="Settings"
        subtitle={selectedProperty?.name || 'Owner Portal'}
        showBack
      />

      <View style={styles.container}>
        {/* Profile Card Header (Tap to Edit) */}
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.profileCard,
            pressed && styles.rowPressed,
          ]}
          onPress={() => router.push('/owner-profile-edit')}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>
              {getInitials(profile?.full_name)}
            </Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>
              {profile?.full_name || 'PG Owner'}
            </Text>
            <Text style={styles.profileSubtitle} numberOfLines={1}>
              {profile?.phone_number || user?.email || 'Owner Account'}
            </Text>
          </View>
          <ChevronRight size={18} color={OwnerTheme.colors.textMuted} />
        </Pressable>

        {/* Group 1: Properties & Admissions */}
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
                  {selectedProperty?.name || 'Manage PGs'} • {properties.length} property
                  {properties.length === 1 ? '' : 'ies'}
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
              onPress={() => router.push('/add-resident')}>
              <View
                style={[
                  styles.iconWrap,
                  { backgroundColor: OwnerTheme.colors.successLight },
                ]}>
                <UserPlus size={18} color={OwnerTheme.colors.success} />
              </View>
              <View style={styles.rowContent}>
                <Text style={styles.rowTitle}>Resident Admission</Text>
                <Text style={styles.rowSubtitle}>
                  Register a new student & set up credentials
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
              <View
                style={[
                  styles.iconWrap,
                  { backgroundColor: '#F1F5F9' },
                ]}>
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
          </View>
        </View>

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

        <Text style={styles.versionText}>PGwala v2.0 • Owner Portal</Text>
      </View>
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
});
