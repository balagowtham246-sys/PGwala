import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { useAuth } from '@/context/auth-context';
import { supabase } from '@/lib/supabase';

interface PropertyProfile {
  id: string;
  name: string;
  address: string | null;
  owner_id: string;
  is_active: boolean;
}

export default function OwnerSettingsScreen() {
  const { user, profile, signOut, refreshProfile } = useAuth();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Profile fields
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');

  // Owner Property configuration
  const [property, setProperty] = useState<PropertyProfile | null>(null);
  const [propertyName, setPropertyName] = useState('');
  const [propertyAddress, setPropertyAddress] = useState('');

  // Password change state
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

  // Load profile and relevant owner settings
  const loadData = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }

    try {
      setErrorMessage(null);

      // 1. User profile info
      if (profile) {
        setFullName(profile.full_name || '');
        setPhoneNumber(profile.phone_number || '');
      }

      // 2. Fetch active property owned by this owner
      const { data: propData, error: propErr } = await supabase
        .from('properties')
        .select('id, name, address, owner_id, is_active')
        .eq('owner_id', user.id)
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (propErr) {
        console.warn('[OwnerSettings] Error fetching property:', propErr.message);
      } else if (propData) {
        setProperty(propData as PropertyProfile);
        setPropertyName(propData.name || '');
        setPropertyAddress(propData.address || '');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[OwnerSettings] Unexpected error:', err);
      setErrorMessage(msg || 'Failed to load settings data.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id, profile]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setSuccessMessage(null);
    loadData();
  }, [loadData]);

  // Handle saving personal profile (name & phone)
  const handleSaveProfile = async () => {
    if (!user?.id) return;
    const trimmedName = fullName.trim();
    if (!trimmedName) {
      setErrorMessage('Full name cannot be empty.');
      return;
    }

    try {
      setSaving(true);
      setErrorMessage(null);
      setSuccessMessage(null);

      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: trimmedName,
          phone_number: phoneNumber.trim() || null,
        })
        .eq('id', user.id);

      if (error) {
        throw new Error(error.message);
      }

      await refreshProfile();
      setSuccessMessage('Profile updated successfully.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg || 'Failed to update profile.');
    } finally {
      setSaving(false);
    }
  };

  // Handle saving property details (for Owner)
  const handleSaveProperty = async () => {
    if (!property?.id || profile?.role !== 'owner') return;
    const trimmedPropName = propertyName.trim();
    if (!trimmedPropName) {
      setErrorMessage('PG / Property name cannot be empty.');
      return;
    }

    try {
      setSaving(true);
      setErrorMessage(null);
      setSuccessMessage(null);

      const { error } = await supabase
        .from('properties')
        .update({
          name: trimmedPropName,
          address: propertyAddress.trim() || null,
        })
        .eq('id', property.id)
        .eq('owner_id', user!.id);

      if (error) {
        throw new Error(error.message);
      }

      setProperty((prev) =>
        prev
          ? {
              ...prev,
              name: trimmedPropName,
              address: propertyAddress.trim() || null,
            }
          : null
      );
      setSuccessMessage('Property details updated successfully.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg || 'Failed to update property details.');
    } finally {
      setSaving(false);
    }
  };

  // Handle password update
  const handleChangePassword = async () => {
    if (!newPassword || !confirmPassword) {
      setPasswordError('Please fill in both password fields.');
      return;
    }

    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match.');
      return;
    }

    try {
      setChangingPassword(true);
      setPasswordError(null);
      setPasswordSuccess(null);

      const { error: authError } = await supabase.auth.updateUser({
        password: newPassword,
        data: { must_change_password: false },
      });

      if (authError) {
        throw new Error(authError.message);
      }

      await supabase
        .from('profiles')
        .update({ must_change_password: false })
        .eq('id', user!.id);

      setPasswordSuccess('Password changed successfully! Keep your new credentials safe.');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setPasswordError(msg || 'Failed to update password.');
    } finally {
      setChangingPassword(false);
    }
  };

  // Handle Logout Confirmation (Cross-platform: window.confirm on Web, Alert.alert on native)
  const handleLogout = async () => {
    if (Platform.OS === 'web') {
      const confirmed = typeof window !== 'undefined' ? window.confirm('Are you sure you want to log out of PGwala?') : true;
      if (confirmed) {
        await signOut();
        router.replace('/login');
      }
      return;
    }

    Alert.alert('Sign Out', 'Are you sure you want to log out of PGwala?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await signOut();
          router.replace('/login');
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.keyboardContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={['#0284C7']}
            />
          }>

          {/* Top Bar with Back Button */}
          <View style={styles.topBar}>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.backButton,
                pressed && styles.backButtonPressed,
              ]}
              onPress={() => router.back()}>
              <Text style={styles.backButtonText}>‹ Back</Text>
            </Pressable>
            <View style={styles.titleWrapper}>
              <Text style={styles.screenTitle}>Settings</Text>
              <Text style={styles.screenSubtitle}>Owner & Property Management</Text>
            </View>
          </View>

          {/* Feedback Banners */}
          {errorMessage && (
            <View style={styles.errorBanner}>
              <Text style={styles.bannerIcon}>⚠️</Text>
              <Text style={styles.bannerText}>{errorMessage}</Text>
              <Pressable hitSlop={8} onPress={() => setErrorMessage(null)}>
                <Text style={styles.bannerDismiss}>✕</Text>
              </Pressable>
            </View>
          )}

          {successMessage && (
            <View style={styles.successBanner}>
              <Text style={styles.bannerIcon}>✓</Text>
              <Text style={styles.bannerText}>{successMessage}</Text>
              <Pressable hitSlop={8} onPress={() => setSuccessMessage(null)}>
                <Text style={styles.bannerDismiss}>✕</Text>
              </Pressable>
            </View>
          )}

          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="small" color="#0284C7" />
              <Text style={styles.loadingText}>Loading settings...</Text>
            </View>
          ) : (
            <>
              {/* SECTION 1: PROPERTY CONFIGURATION */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardIcon}>🏢</Text>
                  <View style={styles.cardTitleWrap}>
                    <Text style={styles.cardTitle}>Property Details</Text>
                    <Text style={styles.cardSubtitle}>
                      Manage your PG name and physical address
                    </Text>
                  </View>
                </View>

                {property ? (
                  <View style={styles.formGroup}>
                    <Text style={styles.label}>PG / Property Name</Text>
                    <TextInput
                      style={styles.input}
                      value={propertyName}
                      onChangeText={setPropertyName}
                      placeholder="e.g. Greenfield Luxury Men's PG"
                      placeholderTextColor="#94A3B8"
                    />

                    <Text style={styles.label}>Physical Address</Text>
                    <TextInput
                      style={[styles.input, styles.textArea]}
                      value={propertyAddress}
                      onChangeText={setPropertyAddress}
                      placeholder="e.g. 42 Gandhi Road, Near Tech Park, Phase 1"
                      placeholderTextColor="#94A3B8"
                      multiline
                      numberOfLines={3}
                    />

                    <Pressable
                      style={({ pressed }) => [
                        styles.primaryBtn,
                        pressed && styles.pressed,
                        saving && styles.disabledBtn,
                      ]}
                      disabled={saving}
                      onPress={handleSaveProperty}>
                      <Text style={styles.primaryBtnText}>
                        {saving ? 'Saving...' : 'Save Property Changes'}
                      </Text>
                    </Pressable>
                  </View>
                ) : (
                  <Text style={styles.emptyNote}>
                    No active property associated with your account.
                  </Text>
                )}
              </View>

              {/* SECTION 2: OWNER PERSONAL PROFILE */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardIcon}>👤</Text>
                  <View style={styles.cardTitleWrap}>
                    <Text style={styles.cardTitle}>Owner Profile</Text>
                    <Text style={styles.cardSubtitle}>
                      Your personal contact information
                    </Text>
                  </View>
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.label}>Full Name</Text>
                  <TextInput
                    style={styles.input}
                    value={fullName}
                    onChangeText={setFullName}
                    placeholder="e.g. Ramesh Kumar"
                    placeholderTextColor="#94A3B8"
                  />

                  <Text style={styles.label}>Contact Phone Number</Text>
                  <TextInput
                    style={styles.input}
                    value={phoneNumber}
                    onChangeText={setPhoneNumber}
                    placeholder="e.g. 9876543210"
                    placeholderTextColor="#94A3B8"
                    keyboardType="phone-pad"
                  />

                  <Text style={styles.label}>Login Email</Text>
                  <TextInput
                    style={[styles.input, styles.inputDisabled]}
                    value={user?.email || ''}
                    editable={false}
                  />
                  <Text style={styles.fieldHint}>
                    Login email is managed via Supabase Auth and cannot be changed here.
                  </Text>

                  <Pressable
                    style={({ pressed }) => [
                      styles.primaryBtn,
                      pressed && styles.pressed,
                      saving && styles.disabledBtn,
                    ]}
                    disabled={saving}
                    onPress={handleSaveProfile}>
                    <Text style={styles.primaryBtnText}>
                      {saving ? 'Updating...' : 'Update Profile'}
                    </Text>
                  </Pressable>
                </View>
              </View>

              {/* SECTION 3: CHANGE PASSWORD */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardIcon}>🔒</Text>
                  <View style={styles.cardTitleWrap}>
                    <Text style={styles.cardTitle}>Change Password</Text>
                    <Text style={styles.cardSubtitle}>
                      Keep your owner account secure
                    </Text>
                  </View>
                </View>

                {passwordError && (
                  <Text style={styles.passwordErrorText}>{passwordError}</Text>
                )}
                {passwordSuccess && (
                  <Text style={styles.passwordSuccessText}>{passwordSuccess}</Text>
                )}

                <View style={styles.formGroup}>
                  <Text style={styles.label}>New Password</Text>
                  <TextInput
                    style={styles.input}
                    value={newPassword}
                    onChangeText={setNewPassword}
                    placeholder="Min 6 characters"
                    placeholderTextColor="#94A3B8"
                    secureTextEntry
                  />

                  <Text style={styles.label}>Confirm New Password</Text>
                  <TextInput
                    style={styles.input}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    placeholder="Repeat new password"
                    placeholderTextColor="#94A3B8"
                    secureTextEntry
                  />

                  <Pressable
                    style={({ pressed }) => [
                      styles.secondaryBtn,
                      pressed && styles.pressed,
                      changingPassword && styles.disabledBtn,
                    ]}
                    disabled={changingPassword}
                    onPress={handleChangePassword}>
                    <Text style={styles.secondaryBtnText}>
                      {changingPassword ? 'Updating Password...' : 'Update Password'}
                    </Text>
                  </Pressable>
                </View>
              </View>

              {/* SECTION 4: APP INFO & LOGOUT */}
              <View style={styles.card}>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>App Version</Text>
                  <Text style={styles.infoValue}>PGwala 1.0.0 (Production)</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Role</Text>
                  <Text style={styles.roleBadge}>PG Owner / Admin</Text>
                </View>

                <Pressable
                  style={({ pressed }) => [
                    styles.logoutBtn,
                    pressed && styles.pressed,
                  ]}
                  onPress={handleLogout}>
                  <Text style={styles.logoutBtnText}>🚪 Log Out of PGwala</Text>
                </Pressable>
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  keyboardContainer: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    gap: 12,
  },
  backButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  backButtonPressed: {
    backgroundColor: '#F1F5F9',
  },
  backButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  titleWrapper: {
    flex: 1,
  },
  screenTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
  },
  screenSubtitle: {
    fontSize: 12,
    color: '#64748B',
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
    gap: 8,
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    gap: 8,
  },
  bannerIcon: {
    fontSize: 16,
  },
  bannerText: {
    flex: 1,
    fontSize: 13,
    color: '#0F172A',
    fontWeight: '500',
  },
  bannerDismiss: {
    fontSize: 14,
    color: '#64748B',
    paddingHorizontal: 4,
  },
  loadingBox: {
    padding: 40,
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: '#64748B',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  cardIcon: {
    fontSize: 24,
  },
  cardTitleWrap: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  cardSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  formGroup: {
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    marginTop: 6,
  },
  input: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0F172A',
  },
  textArea: {
    minHeight: 64,
    textAlignVertical: 'top',
  },
  inputDisabled: {
    backgroundColor: '#F1F5F9',
    color: '#64748B',
  },
  fieldHint: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  primaryBtn: {
    backgroundColor: '#0284C7',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  secondaryBtn: {
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  secondaryBtnText: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '600',
  },
  logoutBtn: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 14,
  },
  logoutBtnText: {
    color: '#DC2626',
    fontSize: 14,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.8,
  },
  disabledBtn: {
    opacity: 0.6,
  },
  passwordErrorText: {
    color: '#DC2626',
    fontSize: 12,
    marginBottom: 8,
  },
  passwordSuccessText: {
    color: '#16A34A',
    fontSize: 12,
    marginBottom: 8,
  },
  emptyNote: {
    fontSize: 13,
    color: '#64748B',
    fontStyle: 'italic',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  infoLabel: {
    fontSize: 13,
    color: '#64748B',
  },
  infoValue: {
    fontSize: 13,
    fontWeight: '500',
    color: '#0F172A',
  },
  roleBadge: {
    backgroundColor: '#E0F2FE',
    color: '#0369A1',
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
});

