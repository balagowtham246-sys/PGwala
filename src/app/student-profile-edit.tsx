import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Lock, User, Phone, CheckCircle2, AlertCircle } from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/lib/supabase';
import { OwnerHeader, PrimaryButton, ErrorState } from '@/components/ui/owner';

export default function ResidentProfileEditScreen() {
  const { user, profile, refreshProfile } = useAuth();

  const [phoneNumber, setPhoneNumber] = useState(profile?.phone_number || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [saving, setSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const isTemporaryPassword = Boolean(
    profile?.must_change_password || user?.user_metadata?.must_change_password
  );

  const handleSave = async () => {
    if (!user?.id) return;
    const trimmedPhone = phoneNumber.trim();

    if (trimmedPhone && trimmedPhone.length < 10) {
      setErrorMessage('Please enter a valid phone number (at least 10 digits).');
      return;
    }

    if (newPassword || confirmPassword) {
      if (newPassword.length < 6) {
        setPasswordError('New password must be at least 6 characters.');
        return;
      }
      if (newPassword !== confirmPassword) {
        setPasswordError('Passwords do not match.');
        return;
      }
    }

    try {
      setSaving(true);
      setErrorMessage(null);
      setPasswordError(null);
      setSuccessMessage(null);

      // 1. Update Profile & Resident record phone
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          phone_number: trimmedPhone || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      if (profileError) throw profileError;

      await supabase
        .from('residents')
        .update({
          phone_number: trimmedPhone || null,
          updated_at: new Date().toISOString(),
        })
        .eq('profile_id', user.id);

      // 2. Update Password if provided
      if (newPassword) {
        const { error: authError } = await supabase.auth.updateUser({
          password: newPassword,
        });
        if (authError) throw authError;

        // Clear must_change_password flag
        await supabase
          .from('profiles')
          .update({ must_change_password: false })
          .eq('id', user.id);

        setNewPassword('');
        setConfirmPassword('');
      }

      await refreshProfile();
      setSuccessMessage('Profile details and credentials updated successfully.');
      Alert.alert('Saved', 'Your resident profile has been updated.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg || 'Failed to update profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <OwnerHeader
        title="Profile & Security"
        subtitle="Manage contact information and login credentials"
        showBack
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {isTemporaryPassword && (
            <View style={styles.warningBanner}>
              <AlertCircle size={18} color="#B45309" />
              <View style={{ flex: 1 }}>
                <Text style={styles.warningBannerTitle}>Temporary Password Active</Text>
                <Text style={styles.warningBannerText}>
                  Please choose a permanent, private password to secure your resident portal.
                </Text>
              </View>
            </View>
          )}

          {errorMessage && (
            <ErrorState
              message={errorMessage}
              onRetry={() => setErrorMessage(null)}
            />
          )}

          {successMessage && (
            <View style={styles.successBanner}>
              <CheckCircle2 size={16} color={OwnerTheme.colors.success} />
              <Text style={styles.successBannerText}>{successMessage}</Text>
            </View>
          )}

          {/* Personal Information */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <User size={18} color={OwnerTheme.colors.primary} />
              <Text style={styles.cardTitle}>Resident Details</Text>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Registered Name</Text>
              <TextInput
                style={[styles.textInput, styles.inputDisabled]}
                value={profile?.full_name || 'Resident'}
                editable={false}
              />
              <Text style={styles.fieldHint}>
                Your registered name is managed by your PG administrator.
              </Text>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Login Email</Text>
              <TextInput
                style={[styles.textInput, styles.inputDisabled]}
                value={user?.email || ''}
                editable={false}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Contact Phone Number *</Text>
              <TextInput
                style={styles.textInput}
                value={phoneNumber}
                onChangeText={setPhoneNumber}
                placeholder="e.g. 9876543210"
                placeholderTextColor={OwnerTheme.colors.textMuted}
                keyboardType="phone-pad"
              />
              <Text style={styles.fieldHint}>
                Used by PG management for emergency notifications.
              </Text>
            </View>
          </View>

          {/* Password & Security */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Lock size={18} color={OwnerTheme.colors.primary} />
              <Text style={styles.cardTitle}>Change Password</Text>
            </View>
            <Text style={styles.cardDescription}>
              Leave blank if you do not want to change your password.
            </Text>

            {passwordError && (
              <Text style={styles.passwordErrorText}>{passwordError}</Text>
            )}

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>New Password</Text>
              <TextInput
                style={styles.textInput}
                value={newPassword}
                onChangeText={(val) => {
                  setNewPassword(val);
                  setPasswordError(null);
                }}
                placeholder="Minimum 6 characters"
                placeholderTextColor={OwnerTheme.colors.textMuted}
                secureTextEntry
              />
            </View>

            {newPassword ? (
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Confirm New Password</Text>
                <TextInput
                  style={styles.textInput}
                  value={confirmPassword}
                  onChangeText={(val) => {
                    setConfirmPassword(val);
                    setPasswordError(null);
                  }}
                  placeholder="Repeat new password"
                  placeholderTextColor={OwnerTheme.colors.textMuted}
                  secureTextEntry
                />
              </View>
            ) : null}
          </View>

          <PrimaryButton
            label="Save Changes"
            onPress={handleSave}
            loading={saving}
            style={{ marginTop: 8 }}
          />

          <View style={{ height: 32 }} />
        </ScrollView>
      </KeyboardAvoidingView>
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
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FCD34D',
    borderRadius: OwnerTheme.radius.card,
    padding: 14,
  },
  warningBannerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400E',
  },
  warningBannerText: {
    fontSize: 12,
    color: '#B45309',
    marginTop: 2,
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
    marginBottom: 8,
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
  fieldGroup: {
    marginTop: 10,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
    marginBottom: 6,
  },
  textInput: {
    height: 50,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    borderRadius: OwnerTheme.radius.md,
    paddingHorizontal: 14,
    fontSize: 15,
    color: OwnerTheme.colors.textPrimary,
    backgroundColor: '#FAFAFA',
  },
  inputDisabled: {
    backgroundColor: '#F1F5F9',
    color: OwnerTheme.colors.textMuted,
  },
  fieldHint: {
    fontSize: 11,
    color: OwnerTheme.colors.textMuted,
    marginTop: 4,
  },
  passwordErrorText: {
    fontSize: 12,
    color: OwnerTheme.colors.danger,
    marginBottom: 6,
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: OwnerTheme.colors.successLight,
    borderWidth: 1,
    borderColor: '#86EFAC',
    borderRadius: OwnerTheme.radius.md,
    padding: 12,
  },
  successBannerText: {
    fontSize: 13,
    color: OwnerTheme.colors.success,
    fontWeight: '600',
    flex: 1,
  },
});

