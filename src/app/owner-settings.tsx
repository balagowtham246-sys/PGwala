import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
  Bell,
  ShieldCheck,
  UserPlus,
  UserCog,
  Disc3,
  Minus,
  Plus,
  X,
} from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useProperty } from '@/context/property-context';
import { supabase } from '@/lib/supabase';
import { extractErrorMessage } from '@/lib/error-utils';
import { OwnerHeader } from '@/components/ui/owner';
import { BiometricSettingsRow } from '@/components/biometric-settings-row';

export default function OwnerSettingsScreen() {
  const { user, profile, signOut } = useAuth();
  const { selectedProperty, properties } = useProperty();
  const colors = OwnerTheme.colors;
  const [ownerInfoVisible, setOwnerInfoVisible] = useState(false);

  const [wmModalVisible, setWmModalVisible] = useState(false);
  const [wmCount, setWmCount] = useState<number>(2);
  const [wmCountLoading, setWmCountLoading] = useState(false);
  const [savingWm, setSavingWm] = useState(false);

  const loadWmCount = useCallback(async () => {
    if (!selectedProperty?.id) return;
    try {
      setWmCountLoading(true);
      const { count, error } = await supabase
        .from('washing_machines')
        .select('*', { count: 'exact', head: true })
        .eq('property_id', selectedProperty.id)
        .eq('is_active', true);
      if (!error && typeof count === 'number' && count > 0) {
        setWmCount(count);
      }
    } catch {
      // Graceful fallback
    } finally {
      setWmCountLoading(false);
    }
  }, [selectedProperty?.id]);

  useEffect(() => {
    loadWmCount();
  }, [loadWmCount]);

  const handleSaveWmCount = async () => {
    if (!selectedProperty?.id) return;
    try {
      setSavingWm(true);
      const { data, error } = await supabase.rpc('set_property_wm_count', {
        p_property_id: selectedProperty.id,
        p_count: wmCount,
      });
      if (error) throw error;
      if (data && !data.success) throw new Error(data.error);

      Alert.alert('Capacity Updated', data?.message || `Configured ${wmCount} washing machines.`);
      setWmModalVisible(false);
      await loadWmCount();
    } catch (err: unknown) {
      Alert.alert('Update Failed', extractErrorMessage(err, 'Could not update washing machine capacity.'));
    } finally {
      setSavingWm(false);
    }
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

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <OwnerHeader
        title="Settings"
        subtitle={selectedProperty?.name || 'Owner Portal'}
        showBack
      />

      <ScrollView contentContainerStyle={[styles.container, { flex: undefined, paddingBottom: 40 }]} showsVerticalScrollIndicator={false}>
        {/* Profile Card Header (Read-only Info Modal) */}
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.profileCard,
            { backgroundColor: colors.card, borderColor: colors.border },
            pressed && { backgroundColor: colors.surfaceElevated },
          ]}
          onPress={() => setOwnerInfoVisible(true)}>
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
                styles.rowDivider,
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

            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.settingsRow,
                pressed && styles.rowPressed,
              ]}
              onPress={() => setWmModalVisible(true)}>
              <View
                style={[
                  styles.iconWrap,
                  { backgroundColor: '#E0F2FE' },
                ]}>
                <Disc3 size={18} color="#0284C7" />
              </View>
              <View style={styles.rowContent}>
                <Text style={styles.rowTitle}>Washing Machines</Text>
                <Text style={styles.rowSubtitle}>
                  {wmCountLoading
                    ? 'Checking units...'
                    : `${wmCount} unit${wmCount === 1 ? '' : 's'} configured for ${selectedProperty?.name || 'this PG'}`}
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

            <BiometricSettingsRow />
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

        <Text style={[styles.versionText, { color: colors.textMuted }]}>PGwala v2.0 • Owner Portal</Text>
      </ScrollView>

      {/* Read-only Owner Information Modal */}
      <Modal
        visible={ownerInfoVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setOwnerInfoVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>Owner Information</Text>
              <Pressable hitSlop={8} onPress={() => setOwnerInfoVisible(false)}>
                <X size={20} color={colors.textSecondary} />
              </Pressable>
            </View>
            <View style={{ gap: 10, marginTop: 12 }}>
              <View>
                <Text style={[styles.rowSubtitle, { color: colors.textSecondary }]}>Full Name</Text>
                <Text style={[styles.rowTitle, { color: colors.textPrimary }]}>{profile?.full_name || 'PG Owner'}</Text>
              </View>
              <View>
                <Text style={[styles.rowSubtitle, { color: colors.textSecondary }]}>Email</Text>
                <Text style={[styles.rowTitle, { color: colors.textPrimary }]}>{user?.email || '—'}</Text>
              </View>
              <View>
                <Text style={[styles.rowSubtitle, { color: colors.textSecondary }]}>Phone</Text>
                <Text style={[styles.rowTitle, { color: colors.textPrimary }]}>{profile?.phone_number || 'Not added'}</Text>
              </View>
              <View>
                <Text style={[styles.rowSubtitle, { color: colors.textSecondary }]}>Properties Managed</Text>
                <Text style={[styles.rowTitle, { color: colors.textPrimary }]}>{properties.length}</Text>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Configure Washing Machines Stepper Modal */}
      <Modal
        visible={wmModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setWmModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Washing Machine Units</Text>
                <Text style={styles.modalSubtitle} numberOfLines={1}>
                  {selectedProperty?.name || 'Active Property'}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => setWmModalVisible(false)}>
                <X size={20} color={OwnerTheme.colors.textMuted} />
              </Pressable>
            </View>

            <Text style={styles.stepperHelpText}>
              Set the total number of washing machines available in this PG. Residents will be able to select from these units in their portal.
            </Text>

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
                <Minus size={22} color={wmCount <= 1 ? '#CBD5E1' : OwnerTheme.colors.primary} />
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
                onPress={() => setWmCount((prev) => Math.min(20, prev + 1))}>
                <Plus size={22} color={wmCount >= 20 ? '#CBD5E1' : OwnerTheme.colors.primary} />
              </Pressable>
            </View>

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
                style={[styles.modalSaveBtn, savingWm && styles.modalSaveBtnDisabled]}
                disabled={savingWm}
                onPress={handleSaveWmCount}>
                {savingWm ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalSaveBtnText}>Save Capacity</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
    marginVertical: 12,
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
  modalActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
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
});
