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
import { Lock, User, CheckCircle2 } from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/lib/supabase';
import { OwnerHeader, PrimaryButton, ErrorState } from '@/components/ui/owner';

export default function OwnerProfileEditScreen() {
  const { user, profile, refreshProfile } = useAuth();

  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [phoneNumber, setPhoneNumber] = useState(profile?.phone_number || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [saving, setSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleSave = async () => {
    if (!user?.id) return;
    const trimmedName = fullName.trim();
    if (!trimmedName) {
      setErrorMessage('Full name cannot be empty.');
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

      // 1. Update Profile (Name & Phone)
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          full_name: trimmedName,
          phone_number: phoneNumber.trim() || null,
        })
        .eq('id', user.id);

      if (profileError) throw profileError;

      // 2. Update Password if provided
      if (newPassword) {
        const { error: authError } = await supabase.auth.updateUser({
          password: newPassword,
        });
        if (authError) throw authError;

        setNewPassword('');
        setConfirmPassword('');
      }

      await refreshProfile();
      setSuccessMessage('Profile and credentials updated successfully.');
      Alert.alert('Saved', 'Your profile details have been updated.');
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
        subtitle="Manage your personal details and password"
        showBack
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
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
              <Text style={styles.cardTitle}>Personal Information</Text>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Full Name *</Text>
              <TextInput
                style={styles.textInput}
                value={fullName}
                onChangeText={setFullName}
                placeholder="e.g. Ramesh Kumar"
                placeholderTextColor={OwnerTheme.colors.textMuted}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Contact Phone Number</Text>
              <TextInput
                style={styles.textInput}
                value={phoneNumber}
                onChangeText={setPhoneNumber}
                placeholder="e.g. 9876543210"
                placeholderTextColor={OwnerTheme.colors.textMuted}
                keyboardType="phone-pad"
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Login Email</Text>
              <TextInput
                style={[styles.textInput, styles.inputDisabled]}
                value={user?.email || ''}
                editable={false}
              />
              <Text style={styles.fieldHint}>
                Your email is managed by your authentication provider.
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
              Leave these fields blank if you do not want to change your password.
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
