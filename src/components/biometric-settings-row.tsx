import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Eye, EyeOff, Fingerprint, X } from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/lib/supabase';
import {
  authenticateWithBiometrics,
  clearBiometricCredentials,
  getBiometricAvailability,
  isBiometricSignInEnabled,
  saveBiometricCredentials,
} from '@/lib/biometric-auth';

/**
 * Shared Biometric Sign-In settings toggle + password verification modal
 * for Residents, Owners, and Wardens.
 */
export function BiometricSettingsRow({ showDivider = true }: { showDivider?: boolean }) {
  const { user } = useAuth();
  const colors = OwnerTheme.colors;

  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const [avail, enabled] = await Promise.all([
        getBiometricAvailability(),
        isBiometricSignInEnabled(),
      ]);
      if (!active) return;
      setBiometricAvailable(avail.available);
      setBiometricEnabled(avail.available && enabled);
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!biometricAvailable) return null;

  const handleToggle = async (next: boolean) => {
    if (!next) {
      await clearBiometricCredentials();
      setBiometricEnabled(false);
      return;
    }
    setConfirmPassword('');
    setShowPassword(false);
    setError(null);
    setModalVisible(true);
  };

  const handleConfirm = async () => {
    if (!user?.email || saving) return;
    if (!confirmPassword) {
      setError('Please enter your current password.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const { error: authErr } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: confirmPassword,
      });
      if (authErr) {
        setError('Incorrect password. Please try again.');
        return;
      }

      const ok = await authenticateWithBiometrics(
        'Verify your biometrics to enable quick sign-in'
      );
      if (!ok) {
        setError('Biometric verification was cancelled or failed.');
        return;
      }

      await saveBiometricCredentials(user.email, confirmPassword);
      setBiometricEnabled(true);
      setModalVisible(false);
      setConfirmPassword('');
    } catch {
      setError('Could not enable biometric sign-in. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <View
        style={[
          styles.row,
          showDivider && {
            borderTopWidth: 1,
            borderTopColor: colors.borderLight,
          },
        ]}>
        <View style={[styles.iconWrap, { backgroundColor: colors.primaryLight }]}>
          <Fingerprint size={18} color={colors.primary} />
        </View>
        <View style={styles.content}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Biometric Sign-In</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Use device fingerprint or face unlock on login
          </Text>
        </View>
        <Switch
          value={biometricEnabled}
          onValueChange={handleToggle}
          trackColor={{ false: colors.border, true: colors.primary }}
        />
      </View>

      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>
                Enable Biometric Sign-In
              </Text>
              <Pressable hitSlop={8} onPress={() => setModalVisible(false)}>
                <X size={20} color={colors.textSecondary} />
              </Pressable>
            </View>
            <Text style={[styles.modalSub, { color: colors.textSecondary }]}>
              Enter your current password once. Your credentials are stored encrypted on this device only and removed if you turn this off.
            </Text>
            <View
              style={[
                styles.inputRow,
                { borderColor: colors.border, backgroundColor: colors.surfaceElevated },
              ]}>
              <TextInput
                style={[styles.input, { color: colors.textPrimary }]}
                placeholder="Current password"
                placeholderTextColor={colors.textMuted}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                editable={!saving}
              />
              <Pressable hitSlop={8} onPress={() => setShowPassword((v) => !v)}>
                {showPassword ? (
                  <EyeOff size={18} color={colors.textSecondary} />
                ) : (
                  <Eye size={18} color={colors.textSecondary} />
                )}
              </Pressable>
            </View>
            {error ? <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text> : null}
            <View style={styles.actions}>
              <Pressable
                style={[styles.cancelBtn, { borderColor: colors.border }]}
                onPress={() => setModalVisible(false)}
                disabled={saving}>
                <Text style={[styles.cancelText, { color: colors.textSecondary }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.confirmBtn,
                  { backgroundColor: colors.primary },
                  saving && { opacity: 0.7 },
                ]}
                onPress={handleConfirm}
                disabled={saving}>
                {saving ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.confirmText}>Verify & Enable</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 12,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: { flex: 1 },
  title: { fontSize: 14, fontWeight: '600' },
  subtitle: { fontSize: 12, marginTop: 2 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    borderRadius: 18,
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalTitle: { fontSize: 17, fontWeight: '700' },
  modalSub: { fontSize: 13, lineHeight: 19, marginTop: 8, marginBottom: 14 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 48,
  },
  input: { flex: 1, fontSize: 15 },
  errorText: { fontSize: 13, marginTop: 8 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  cancelBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: { fontSize: 14, fontWeight: '600' },
  confirmBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
});
