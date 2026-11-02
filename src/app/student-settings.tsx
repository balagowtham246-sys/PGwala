import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
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

interface AccommodationInfo {
  propertyName: string;
  roomNumber: string;
  address: string | null;
}

export default function StudentSettingsScreen() {
  const { user, profile, signOut, refreshProfile } = useAuth();

  const [loading, setLoading] = useState(true);
  const [accommodation, setAccommodation] = useState<AccommodationInfo | null>(null);

  // Profile phone state
  const [phoneNumber, setPhoneNumber] = useState(profile?.phone_number || '');
  const [savingPhone, setSavingPhone] = useState(false);

  // Password state
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  // Feedback banner
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const isTemporaryPassword = Boolean(
    profile?.must_change_password || user?.user_metadata?.must_change_password
  );

  // 1. Fetch student's assigned accommodation
  const loadAccommodation = useCallback(async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('residents')
        .select(`
          room_number,
          property:properties (
            name,
            address
          )
        `)
        .eq('profile_id', user.id)
        .eq('is_active', true)
        .maybeSingle();

      if (error) {
        console.warn('[StudentSettings] Error fetching accommodation:', error.message);
      } else if (data) {
        const prop = Array.isArray(data.property) ? data.property[0] : data.property;
        setAccommodation({
          propertyName: prop?.name || 'Assigned PG',
          roomNumber: data.room_number,
          address: prop?.address || null,
        });
      }
    } catch (err: any) {
      console.warn('[StudentSettings] Unexpected error:', err.message);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadAccommodation();
    if (profile?.phone_number) {
      setPhoneNumber(profile.phone_number);
    }
  }, [loadAccommodation, profile?.phone_number]);

  // 2. Update Phone Number
  const handleSavePhone = async () => {
    if (!user?.id) return;
    const trimmed = phoneNumber.trim();

    if (trimmed && trimmed.length < 10) {
      Alert.alert('Invalid Phone', 'Please enter a valid phone number (at least 10 digits).');
      return;
    }

    setSavingPhone(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      // Update in public.profiles
      const { error: profileErr } = await supabase
        .from('profiles')
        .update({ phone_number: trimmed || null, updated_at: new Date().toISOString() })
        .eq('id', user.id);

      if (profileErr) throw new Error(profileErr.message);

      // Also sync to active resident record
      await supabase
        .from('residents')
        .update({ phone_number: trimmed || null, updated_at: new Date().toISOString() })
        .eq('profile_id', user.id);

      await refreshProfile();
      setSuccessMessage('Phone number updated successfully.');
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to update phone number.');
    } finally {
      setSavingPhone(false);
    }
  };

  // 3. Change Password
  const handleChangePassword = async () => {
    const trimmedNew = newPassword.trim();
    const trimmedConfirm = confirmPassword.trim();

    if (!trimmedNew) {
      Alert.alert('Password Required', 'Please enter a new password.');
      return;
    }

    if (trimmedNew.length < 6) {
      Alert.alert('Password Too Short', 'Password must be at least 6 characters long.');
      return;
    }

    if (trimmedNew !== trimmedConfirm) {
      Alert.alert('Mismatch', 'New password and confirm password do not match.');
      return;
    }

    setSavingPassword(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      // 1. Update Supabase Auth password & clear metadata flag
      const { error: authError } = await supabase.auth.updateUser({
        password: trimmedNew,
        data: { must_change_password: false },
      });

      if (authError) {
        throw new Error(authError.message);
      }

      // 2. Clear must_change_password in public.profiles
      if (user?.id) {
        await supabase
          .from('profiles')
          .update({ must_change_password: false, updated_at: new Date().toISOString() })
          .eq('id', user.id);
      }

      await refreshProfile();

      setNewPassword('');
      setConfirmPassword('');
      setSuccessMessage('Password changed successfully! Your account is secured.');
      Alert.alert('Success 🎉', 'Your password has been updated successfully.');
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to change password.');
      Alert.alert('Update Failed', err.message || 'Could not change password.');
    } finally {
      setSavingPassword(false);
    }
  };

  // 4. Sign Out (Cross-platform: window.confirm on Web, Alert.alert on native)
  const handleSignOut = async () => {
    if (Platform.OS === 'web') {
      const confirmed = typeof window !== 'undefined' ? window.confirm('Are you sure you want to sign out of your account?') : true;
      if (confirmed) {
        await signOut();
        router.replace('/login');
      }
      return;
    }

    Alert.alert('Sign Out', 'Are you sure you want to sign out of your account?', [
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
          keyboardShouldPersistTaps="handled">

          {/* Header */}
          <View style={styles.header}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go back"
              style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
              onPress={() => router.back()}>
              <Text style={styles.backButtonText}>← Dashboard</Text>
            </Pressable>
            <Text style={styles.title}>Settings & Profile</Text>
            <Text style={styles.subtitle}>Manage your account credentials and personal contact</Text>
          </View>

          {/* Feedback Banners */}
          {errorMessage && (
            <View style={styles.errorBanner}>
              <Text style={styles.bannerIcon}>⚠️</Text>
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          )}

          {successMessage && (
            <View style={styles.successBanner}>
              <Text style={styles.bannerIcon}>✓</Text>
              <Text style={styles.successText}>{successMessage}</Text>
            </View>
          )}

          {/* Temporary Password Highlight Banner */}
          {isTemporaryPassword && (
            <View style={styles.tempPasswordNotice}>
              <Text style={styles.tempPasswordIcon}>🔑</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.tempPasswordTitle}>Temporary Password Active</Text>
                <Text style={styles.tempPasswordDesc}>
                  You are currently using the default password created by your PG owner. Please choose a new private password below.
                </Text>
              </View>
            </View>
          )}

          {/* Card 1: Profile & Accommodation (Read-only + Phone edit) */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>My Accommodation Details</Text>

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Full Name</Text>
              <Text style={styles.infoValue}>{profile?.full_name || 'Resident'}</Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>PG Name</Text>
              <Text style={styles.infoValue}>
                {loading ? 'Loading...' : accommodation?.propertyName || 'Not Assigned'}
              </Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Room Number</Text>
              <Text style={styles.infoValue}>
                {loading ? '...' : accommodation?.roomNumber ? `Room ${accommodation.roomNumber}` : '—'}
              </Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Login Email</Text>
              <Text style={styles.infoValue}>{user?.email || '—'}</Text>
            </View>

            <View style={styles.divider} />

            {/* Editable Phone */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Contact Phone Number</Text>
              <View style={styles.inputWithActionRow}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={phoneNumber}
                  onChangeText={setPhoneNumber}
                  placeholder="e.g. 9876543210"
                  placeholderTextColor="#94A3B8"
                  keyboardType="phone-pad"
                  maxLength={15}
                  editable={!savingPhone}
                />
                <Pressable
                  style={({ pressed }) => [
                    styles.savePhoneBtn,
                    pressed && styles.pressed,
                    savingPhone && styles.btnDisabled,
                  ]}
                  disabled={savingPhone}
                  onPress={handleSavePhone}>
                  {savingPhone ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.savePhoneBtnText}>Save</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </View>

          {/* Card 2: Change Password */}
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardTitle}>Change Password</Text>
              {isTemporaryPassword && (
                <View style={styles.requiredBadge}>
                  <Text style={styles.requiredBadgeText}>Action Recommended</Text>
                </View>
              )}
            </View>
            <Text style={styles.cardSubtitle}>
              Update your login password to secure your student portal account.
            </Text>

            <View style={styles.fieldGroup}>
              <View style={styles.labelRow}>
                <Text style={styles.fieldLabel}>New Password</Text>
                <Pressable onPress={() => setShowPassword(!showPassword)} hitSlop={6}>
                  <Text style={styles.toggleText}>{showPassword ? 'Hide' : 'Show'}</Text>
                </Pressable>
              </View>
              <TextInput
                style={styles.input}
                value={newPassword}
                onChangeText={setNewPassword}
                placeholder="At least 6 characters"
                placeholderTextColor="#94A3B8"
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                editable={!savingPassword}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Confirm New Password</Text>
              <TextInput
                style={styles.input}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="Re-enter new password"
                placeholderTextColor="#94A3B8"
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                editable={!savingPassword}
              />
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.primaryBtn,
                pressed && styles.pressed,
                savingPassword && styles.btnDisabled,
              ]}
              disabled={savingPassword}
              onPress={handleChangePassword}>
              {savingPassword ? (
                <View style={styles.btnLoadingRow}>
                  <ActivityIndicator size="small" color="#FFFFFF" />
                  <Text style={styles.primaryBtnText}>Updating Password...</Text>
                </View>
              ) : (
                <Text style={styles.primaryBtnText}>Update Password</Text>
              )}
            </Pressable>
          </View>

          {/* Card 3: Sign Out */}
          <View style={[styles.card, { borderColor: '#FEE2E2' }]}>
            <Text style={[styles.cardTitle, { color: '#991B1B' }]}>Account Session</Text>
            <Text style={styles.cardSubtitle}>
              Signed in as {user?.email}
            </Text>

            <Pressable
              style={({ pressed }) => [styles.signOutBtn, pressed && styles.pressed]}
              onPress={handleSignOut}>
              <Text style={styles.signOutBtnText}>Sign Out of PGwala</Text>
            </Pressable>
          </View>

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
  header: {
    marginBottom: 16,
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#E2E8F0',
    borderRadius: 8,
    marginBottom: 10,
  },
  backButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
  },
  subtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    padding: 12,
    borderRadius: 10,
    marginBottom: 14,
    gap: 8,
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#6EE7B7',
    padding: 12,
    borderRadius: 10,
    marginBottom: 14,
    gap: 8,
  },
  bannerIcon: {
    fontSize: 16,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: '#B91C1C',
    fontWeight: '600',
  },
  successText: {
    flex: 1,
    fontSize: 13,
    color: '#047857',
    fontWeight: '600',
  },
  tempPasswordNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
    gap: 10,
  },
  tempPasswordIcon: {
    fontSize: 22,
  },
  tempPasswordTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400E',
  },
  tempPasswordDesc: {
    fontSize: 11,
    color: '#B45309',
    marginTop: 2,
    lineHeight: 16,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 16,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 3,
      },
      android: {
        elevation: 1,
      },
    }),
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  cardSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
    marginBottom: 14,
  },
  requiredBadge: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  requiredBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#B45309',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  infoLabel: {
    fontSize: 13,
    color: '#64748B',
  },
  infoValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  divider: {
    height: 1,
    backgroundColor: '#F1F5F9',
  },
  fieldGroup: {
    marginTop: 12,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 6,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  toggleText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0284C7',
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
  inputWithActionRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  savePhoneBtn: {
    backgroundColor: '#0284C7',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  savePhoneBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  primaryBtn: {
    backgroundColor: '#0284C7',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  btnLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  signOutBtn: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  signOutBtnText: {
    color: '#DC2626',
    fontSize: 14,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.75,
  },
  btnDisabled: {
    opacity: 0.6,
  },
});

