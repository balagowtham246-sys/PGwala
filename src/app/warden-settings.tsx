import React, { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
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
  Mail,
  Phone,
  ShieldCheck,
  User,
  X,
} from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/lib/supabase';
import { OwnerHeader } from '@/components/ui/owner';
import { BiometricSettingsRow } from '@/components/biometric-settings-row';
import { SettingsComplianceSection } from '@/components/settings-compliance-section';

export default function WardenSettingsScreen() {
  const { user, profile, signOut } = useAuth();
  const colors = OwnerTheme.colors;
  const [propertyName, setPropertyName] = useState<string | null>(null);
  const [infoVisible, setInfoVisible] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!user?.id) return;
      const { data } = await supabase
        .from('property_wardens')
        .select('properties(name)')
        .eq('warden_profile_id', user.id)
        .eq('is_active', true)
        .maybeSingle();
      if (!active || !data) return;
      const rel = (data as any).properties;
      setPropertyName(Array.isArray(rel) ? rel[0]?.name ?? null : rel?.name ?? null);
    })();
    return () => {
      active = false;
    };
  }, [user?.id]);

  const handleLogout = async () => {
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined' || window.confirm('Log out of PGwala?')) {
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

  const initials = (profile?.full_name || 'WD')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <OwnerHeader title="Settings" subtitle="Warden Portal" showBack />

      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        {/* Warden Info Card (Read-Only Modal) */}
        <Pressable
          accessibilityRole="button"
          style={[styles.profileCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => setInfoVisible(true)}>
          <View style={[styles.avatarCircle, { backgroundColor: colors.primary }]}>
            <Text style={styles.avatarText}>{initials || 'WD'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.profileName, { color: colors.textPrimary }]}>
              {profile?.full_name || 'Warden'}
            </Text>
            <Text style={[styles.profileSub, { color: colors.textSecondary }]} numberOfLines={1}>
              {propertyName ? `Warden • ${propertyName}` : user?.email || 'Warden Account'}
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
              style={styles.settingsRow}
              onPress={() => router.push('/resident-profile-edit')}>
              <View style={[styles.iconWrap, { backgroundColor: colors.successLight }]}>
                <ShieldCheck size={18} color={colors.success} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: colors.textPrimary }]}>Profile & Password</Text>
                <Text style={[styles.rowSub, { color: colors.textSecondary }]}>
                  Update contact phone & change password
                </Text>
              </View>
              <ChevronRight size={18} color={colors.textMuted} />
            </Pressable>
            <BiometricSettingsRow />
          </View>
        </View>

        <SettingsComplianceSection role="warden" userEmail={user?.email} />

        {/* Log Out */}
        <View style={styles.section}>
          <View style={[styles.groupedCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Pressable accessibilityRole="button" style={styles.settingsRow} onPress={handleLogout}>
              <View style={[styles.iconWrap, { backgroundColor: colors.dangerLight }]}>
                <LogOut size={18} color={colors.danger} />
              </View>
              <Text style={[styles.logoutText, { color: colors.danger }]}>Log Out of PGwala</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>

      {/* Read-only Warden Information Modal */}
      <Modal visible={infoVisible} transparent animationType="fade" onRequestClose={() => setInfoVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>Warden Information</Text>
              <Pressable hitSlop={8} onPress={() => setInfoVisible(false)}>
                <X size={20} color={colors.textSecondary} />
              </Pressable>
            </View>
            <View style={styles.infoRow}>
              <User size={16} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Full Name</Text>
                <Text style={[styles.infoValue, { color: colors.textPrimary }]}>
                  {profile?.full_name || 'Warden'}
                </Text>
              </View>
            </View>
            <View style={styles.infoRow}>
              <Mail size={16} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Email</Text>
                <Text style={[styles.infoValue, { color: colors.textPrimary }]}>{user?.email || '—'}</Text>
              </View>
            </View>
            <View style={styles.infoRow}>
              <Phone size={16} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Phone</Text>
                <Text style={[styles.infoValue, { color: colors.textPrimary }]}>
                  {profile?.phone_number || 'Not added'}
                </Text>
              </View>
            </View>
            <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
              <Building2 size={16} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Assigned Property</Text>
                <Text style={[styles.infoValue, { color: colors.textPrimary }]}>
                  {propertyName || 'Not assigned'}
                </Text>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { padding: 16, gap: 14, paddingBottom: 40 },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
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
  avatarText: { fontSize: 16, fontWeight: '800', color: '#FFFFFF' },
  profileName: { fontSize: 16, fontWeight: '700' },
  profileSub: { fontSize: 13, marginTop: 2 },
  section: { gap: 6 },
  sectionHeader: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginLeft: 4 },
  groupedCard: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  settingsRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14, gap: 12 },
  iconWrap: { width: 34, height: 34, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  rowTitle: { fontSize: 14, fontWeight: '600' },
  rowSub: { fontSize: 12, marginTop: 2 },
  logoutText: { fontSize: 14, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.5)', justifyContent: 'center', padding: 20 },
  modalCard: { borderRadius: 18, padding: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  modalTitle: { fontSize: 17, fontWeight: '700' },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(148, 163, 184, 0.2)',
  },
  infoLabel: { fontSize: 12 },
  infoValue: { fontSize: 14, fontWeight: '600', marginTop: 2 },
});
