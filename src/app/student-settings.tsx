import React, { useEffect, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronRight, LogOut, ShieldCheck } from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/lib/supabase';
import { OwnerHeader } from '@/components/ui/owner';
import { BiometricSettingsRow } from '@/components/biometric-settings-row';

interface ResidentProfileSummary {
  roomNumber: string;
  propertyName: string;
}

export default function ResidentSettingsScreen() {
  const { user, profile, signOut } = useAuth();
  const colors = OwnerTheme.colors;
  const [summary, setSummary] = useState<ResidentProfileSummary | null>(null);

  useEffect(() => {
    (async () => {
      if (!user?.id) return;
      try {
        const { data } = await supabase
          .from('residents')
          .select(`
            room_number,
            property:properties (
              name
            )
          `)
          .eq('profile_id', user.id)
          .eq('is_active', true)
          .maybeSingle();

        if (data) {
          const prop = Array.isArray(data.property) ? data.property[0] : data.property;
          setSummary({
            roomNumber: data.room_number,
            propertyName: prop?.name || 'My PG',
          });
        }
      } catch (err) {
        console.warn('Failed to load resident summary:', err);
      }
    })();
  }, [user?.id]);

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
    if (!name) return 'RE';
    const parts = name.trim().split(' ');
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <OwnerHeader title="Settings" subtitle="Resident Portal" showBack />

      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        {/* Profile Card Header (Read-only Info View) */}
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.profileCard,
            { backgroundColor: colors.card, borderColor: colors.border },
            pressed && { backgroundColor: colors.surfaceElevated },
          ]}
          onPress={() => router.push('/student-accommodation')}>
          <View style={[styles.avatarCircle, { backgroundColor: colors.primary }]}>
            <Text style={styles.avatarText}>{getInitials(profile?.full_name)}</Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={[styles.profileName, { color: colors.textPrimary }]}>
              {profile?.full_name || 'Resident'}
            </Text>
            <Text style={[styles.profileSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
              {summary
                ? `Room ${summary.roomNumber} • ${summary.propertyName}`
                : profile?.phone_number || user?.email || 'Resident Account'}
            </Text>
          </View>
          <ChevronRight size={18} color={colors.textMuted} />
        </Pressable>

        {/* Account & Security */}
        <View style={styles.section}>
          <Text style={[styles.sectionHeader, { color: colors.textMuted }]}>ACCOUNT & SECURITY</Text>
          <View style={[styles.groupedCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.settingsRow,
                pressed && { backgroundColor: colors.surfaceElevated },
              ]}
              onPress={() => router.push('/student-profile-edit')}>
              <View style={[styles.iconWrap, { backgroundColor: colors.successLight }]}>
                <ShieldCheck size={18} color={colors.success} />
              </View>
              <View style={styles.rowContent}>
                <Text style={[styles.rowTitle, { color: colors.textPrimary }]}>Profile & Password</Text>
                <Text style={[styles.rowSubtitle, { color: colors.textSecondary }]}>
                  Update contact phone & change private password
                </Text>
              </View>
              <ChevronRight size={18} color={colors.textMuted} />
            </Pressable>

            <BiometricSettingsRow />
          </View>
        </View>

        {/* Log Out */}
        <View style={styles.section}>
          <View style={[styles.groupedCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.settingsRow,
                pressed && { backgroundColor: colors.surfaceElevated },
              ]}
              onPress={handleLogout}>
              <View style={[styles.iconWrap, { backgroundColor: colors.dangerLight }]}>
                <LogOut size={18} color={colors.danger} />
              </View>
              <View style={styles.rowContent}>
                <Text style={[styles.logoutText, { color: colors.danger }]}>Log Out of PGwala</Text>
              </View>
            </Pressable>
          </View>
        </View>

        <Text style={[styles.versionText, { color: colors.textMuted }]}>
          PGwala v2.0 • Resident Edition
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 40,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
    gap: 12,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    padding: 14,
    gap: 12,
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 16, fontWeight: '700' },
  profileSubtitle: { fontSize: 13, marginTop: 2 },
  section: { gap: 4 },
  sectionHeader: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginLeft: 4 },
  groupedCard: {
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    overflow: 'hidden',
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 12,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: OwnerTheme.radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rowContent: { flex: 1 },
  rowTitle: { fontSize: 14, fontWeight: '600' },
  rowSubtitle: { fontSize: 12, marginTop: 2 },
  logoutText: { fontSize: 14, fontWeight: '700' },
  versionText: { textAlign: 'center', fontSize: 12, marginTop: 6 },
});
