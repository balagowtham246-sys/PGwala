import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  Eye,
  EyeOff,
  AlertCircle,
  Fingerprint,
} from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';
import { extractErrorMessage } from '@/lib/error-utils';
import { supabase } from '@/lib/supabase';
import { posthogLog } from '@/lib/posthog';
import { useAuth, UserProfile } from '@/context/auth-context';
import { PrimaryButton } from '@/components/ui/owner';
import {
  authenticateWithBiometrics,
  clearBiometricCredentials,
  getBiometricAvailability,
  getSavedBiometricCredentials,
  isBiometricSignInEnabled,
  saveBiometricCredentials,
  SavedBiometricCredentials,
} from '@/lib/biometric-auth';

export default function LoginScreen() {
  const { signOut } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [savedCreds, setSavedCreds] = useState<SavedBiometricCredentials | null>(null);
  const [focusedField, setFocusedField] = useState<'email' | 'password' | null>(null);
  const passwordInputRef = useRef<React.ComponentRef<typeof TextInput>>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const [avail, enabled, creds] = await Promise.all([
        getBiometricAvailability(),
        isBiometricSignInEnabled(),
        getSavedBiometricCredentials(),
      ]);
      if (!active) return;
      setBiometricAvailable(avail.available);
      if (avail.available && enabled && creds) {
        setSavedCreds(creds);
        setEmail((prev) => prev || creds.email);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const performSignIn = async (
    targetEmail: string,
    targetPassword: string,
    fromBiometric: boolean
  ) => {
    setLoading(true);
    setErrorMessage(null);
    const authenticationMethod = fromBiometric ? 'biometric' : 'password';

    try {
      // 1. Authenticate with Supabase Auth
      const { data: authData, error: authError } =
        await supabase.auth.signInWithPassword({
          email: targetEmail,
          password: targetPassword,
        });

      if (authError) {
        const failureKind = authError.message
          .toLowerCase()
          .includes('invalid login credentials')
          ? 'invalid_credentials'
          : authError.message.toLowerCase().includes('network')
            ? 'network'
            : 'provider';
        posthogLog?.warn('authentication attempt completed', {
          event: 'authentication_attempt',
          outcome: 'failed',
          authentication_method: authenticationMethod,
          failure_kind: failureKind,
        });
        if (
          authError.message.toLowerCase().includes('invalid login credentials')
        ) {
          if (fromBiometric) {
            await clearBiometricCredentials();
            setSavedCreds(null);
            setErrorMessage(
              'Saved credentials expired or changed. Please sign in with your password.'
            );
          } else {
            setErrorMessage(
              'Invalid email or password. Please verify and try again.'
            );
          }
        } else if (authError.message.toLowerCase().includes('network')) {
          setErrorMessage(
            'Network connection error. Please verify your internet connection.'
          );
        } else {
          setErrorMessage(authError.message);
        }
        return;
      }

      const user = authData.user;
      if (!user) {
        posthogLog?.warn('authentication attempt completed', {
          event: 'authentication_attempt',
          outcome: 'failed',
          authentication_method: authenticationMethod,
          failure_kind: 'missing_user',
        });
        setErrorMessage('Authentication failed. No user record returned.');
        return;
      }

      // 2. Fetch the user profile from public.profiles
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name, phone_number, role')
        .eq('id', user.id)
        .single();

      if (profileError || !profileData) {
        posthogLog?.error('account profile lookup completed', {
          event: 'account_profile_lookup',
          outcome: 'failed',
          authentication_method: authenticationMethod,
        });
        await signOut();
        setErrorMessage(
          'Profile record not found for this account. Contact system support.'
        );
        return;
      }

      const profile = profileData as UserProfile;

      // 3. Refresh stored biometric credentials only if user already enabled it in Settings for this account
      if (!fromBiometric && biometricAvailable && savedCreds && savedCreds.email === targetEmail) {
        await saveBiometricCredentials(targetEmail, targetPassword);
        setSavedCreds({ email: targetEmail, password: targetPassword });
      }

      // 4. Enforce Role Check and Navigation
      if (
        profile.role === 'owner' ||
        profile.role === 'student' ||
        profile.role === 'warden'
      ) {
        posthogLog?.info('authentication attempt completed', {
          event: 'authentication_attempt',
          outcome: 'succeeded',
          authentication_method: authenticationMethod,
          account_role: profile.role,
        });
      }
      if (profile.role === 'owner') {
        router.replace('/owner-tabs');
      } else if (profile.role === 'student') {
        router.replace('/resident-tabs');
      } else if (profile.role === 'warden') {
        router.replace('/warden-dashboard');
      } else {
        await signOut();
        setErrorMessage(
          `Access Denied: Unrecognized account role '${profile.role}'. Please contact support.`
        );
      }
    } catch (err: unknown) {
      setErrorMessage(
        extractErrorMessage(err, 'Unexpected error during sign in.')
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setErrorMessage('Please enter both email and password.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }

    await performSignIn(trimmedEmail, password, false);
  };

  const handleBiometricSignIn = async () => {
    if (!savedCreds || loading) return;
    const verified = await authenticateWithBiometrics(
      'Verify your biometrics to sign in to PGwala'
    );
    if (!verified) return;
    await performSignIn(savedCreds.email, savedCreds.password, true);
  };

  const handleForgotPassword = () => {
    Alert.alert(
      'Reset Password',
      '• Residents & Wardens: Ask your PG Owner to open your profile and tap "Reset Password" — they can send your new password on WhatsApp in 5 seconds.\n\n• PG Owners: Email admin.pgwala@gmail.com to get an instant reset.',
      [
        {
          text: 'Email Admin',
          onPress: () => {
            const subject = encodeURIComponent('PGwala Owner Password Reset');
            const body = encodeURIComponent(
              `Please reset my PGwala Owner password.\nRegistered Email: ${email.trim() || 'N/A'}\n`
            );
            void Linking.openURL(
              `mailto:admin.pgwala@gmail.com?subject=${subject}&body=${body}`
            ).catch(() => {});
          },
        },
        { text: 'OK', style: 'cancel' },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 20 : 0}
        style={styles.keyboardContainer}>
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 100 }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}>
          {/* Brand Header */}
          <View style={styles.brandContainer}>
            <View style={styles.logoHalo}>
              <View style={styles.logoBadge}>
                <Text style={styles.logoBadgeText}>PG</Text>
              </View>
            </View>
            <Text style={styles.appTitle}>PGwala</Text>
            <Text style={styles.appSubtitle}>
              Smart PG management for owners, residents &amp; wardens
            </Text>
          </View>

          {/* Login Card */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Sign In</Text>
            <Text style={styles.cardSubtitle}>
              Enter your credentials to access your dashboard
            </Text>

            {/* Error Message Banner */}
            {errorMessage && (
              <View style={styles.errorBox}>
                <AlertCircle size={16} color={OwnerTheme.colors.danger} />
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            )}

            {/* Email Field */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Email Address</Text>
              <TextInput
                style={[
                  styles.input,
                  focusedField === 'email' && styles.inputFocused,
                ]}
                placeholder="you@example.com"
                placeholderTextColor={OwnerTheme.colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                returnKeyType="next"
                blurOnSubmit={false}
                onFocus={() => setFocusedField('email')}
                onBlur={() => setFocusedField((prev) => (prev === 'email' ? null : prev))}
                onSubmitEditing={() => passwordInputRef.current?.focus()}
                value={email}
                onChangeText={(text) => {
                  setEmail(text);
                  if (errorMessage) setErrorMessage(null);
                }}
                editable={!loading}
              />
            </View>

            {/* Password Field */}
            <View style={styles.fieldGroup}>
              <View style={styles.passwordLabelRow}>
                <Text style={styles.fieldLabel}>Password</Text>
                <Pressable hitSlop={6} onPress={handleForgotPassword}>
                  <Text style={styles.forgotPasswordText}>
                    Forgot Password?
                  </Text>
                </Pressable>
              </View>
              <View
                style={[
                  styles.passwordInputContainer,
                  focusedField === 'password' && styles.inputFocused,
                ]}>
                <TextInput
                  ref={passwordInputRef}
                  style={styles.passwordInput}
                  placeholder="Enter your password"
                  placeholderTextColor={OwnerTheme.colors.textMuted}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  onFocus={() => setFocusedField('password')}
                  onBlur={() => setFocusedField((prev) => (prev === 'password' ? null : prev))}
                  onSubmitEditing={() => void handleSignIn()}
                  value={password}
                  onChangeText={(text) => {
                    setPassword(text);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  editable={!loading}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                  hitSlop={8}
                  style={styles.eyeBtn}
                  onPress={() => setShowPassword(!showPassword)}>
                  {showPassword ? (
                    <EyeOff size={18} color={OwnerTheme.colors.textSecondary} />
                  ) : (
                    <Eye size={18} color={OwnerTheme.colors.textSecondary} />
                  )}
                </Pressable>
              </View>
            </View>

            {/* Sign In Button */}
            <PrimaryButton
              label="Sign In"
              onPress={handleSignIn}
              loading={loading}
              style={{ marginTop: 8 }}
            />

            {/* Biometric Quick Sign-In (only shown when enabled in Settings) */}
            {biometricAvailable && savedCreds && (
              <Pressable
                style={[styles.biometricBtn, loading && { opacity: 0.6 }]}
                onPress={handleBiometricSignIn}
                disabled={loading}>
                <Fingerprint size={18} color={OwnerTheme.colors.primary} />
                <Text style={styles.biometricBtnText}>
                  Sign in with Biometrics
                </Text>
              </Pressable>
            )}
          </View>

          {/* Self-Onboarding CTA for New Residents */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Join a PG with Invite Code"
            style={({ pressed }) => [
              {
                marginTop: 14,
                backgroundColor: '#0F172A',
                borderRadius: 14,
                paddingVertical: 13,
                paddingHorizontal: 16,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              },
              pressed && { opacity: 0.85 },
            ]}
            onPress={() => router.push('/join-pg')}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFFFFF' }}>
                New to a PG? Join with Invite Code
              </Text>
              <Text style={{ fontSize: 12, color: '#94A3B8', marginTop: 1 }}>
                Enter your 6-character PG code to self-register
              </Text>
            </View>
            <Text style={{ fontSize: 16, fontWeight: '800', color: '#38BDF8' }}>
              ›
            </Text>
          </Pressable>

          {/* Footer Note */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>
              Need an account? Contact your PG owner or management.
            </Text>
            <Text style={styles.versionText}>
              PGwala v{Constants.expoConfig?.version || '1.0.0'}
            </Text>
          </View>
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
  keyboardContainer: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 24,
    maxWidth: 440,
    width: '100%',
    alignSelf: 'center',
  },
  brandContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logoHalo: {
    width: 68,
    height: 68,
    borderRadius: 20,
    backgroundColor: OwnerTheme.colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  logoBadge: {
    width: 52,
    height: 52,
    borderRadius: OwnerTheme.radius.md,
    backgroundColor: OwnerTheme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    ...OwnerTheme.shadow,
  },
  logoBadgeText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  appTitle: {
    ...OwnerTheme.typography.screenHeading,
    fontSize: 26,
    color: OwnerTheme.colors.textPrimary,
  },
  appSubtitle: {
    fontSize: 14,
    color: OwnerTheme.colors.textSecondary,
    fontWeight: '600',
    marginTop: 2,
  },
  valuePillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
  },
  valuePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: OwnerTheme.colors.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: OwnerTheme.radius.full,
  },
  valuePillText: {
    fontSize: 12,
    fontWeight: '600',
    color: OwnerTheme.colors.primaryDark,
  },
  biometricToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  biometricToggleLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: OwnerTheme.colors.textSecondary,
  },
  biometricBtn: {
    marginTop: 10,
    height: 46,
    borderRadius: OwnerTheme.radius.md,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.primary,
    backgroundColor: OwnerTheme.colors.primarySoft,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  biometricBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 22,
    ...OwnerTheme.shadow,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  cardSubtitle: {
    fontSize: 13,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 3,
    marginBottom: 18,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: OwnerTheme.colors.dangerLight,
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: OwnerTheme.radius.md,
    padding: 12,
    marginBottom: 14,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: OwnerTheme.colors.danger,
    fontWeight: '500',
  },
  fieldGroup: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
    marginBottom: 6,
  },
  passwordLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  forgotPasswordText: {
    fontSize: 12,
    color: OwnerTheme.colors.primary,
    fontWeight: '600',
  },
  input: {
    height: 50,
    borderRadius: OwnerTheme.radius.md,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    paddingHorizontal: 14,
    fontSize: 15,
    color: OwnerTheme.colors.textPrimary,
    backgroundColor: OwnerTheme.colors.surfaceElevated,
  },
  inputFocused: {
    borderColor: OwnerTheme.colors.primary,
    borderWidth: 1.5,
    backgroundColor: '#FFFFFF',
  },
  passwordInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 50,
    borderRadius: OwnerTheme.radius.md,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    backgroundColor: OwnerTheme.colors.surfaceElevated,
    paddingRight: 10,
  },
  passwordInput: {
    flex: 1,
    height: '100%',
    paddingHorizontal: 14,
    fontSize: 15,
    color: OwnerTheme.colors.textPrimary,
  },
  eyeBtn: {
    padding: 6,
  },
  footer: {
    marginTop: 20,
    alignItems: 'center',
    gap: 6,
  },
  footerText: {
    fontSize: 12,
    color: OwnerTheme.colors.textMuted,
    textAlign: 'center',
  },
  versionText: {
    fontSize: 11,
    fontWeight: '600',
    color: OwnerTheme.colors.textMuted,
    opacity: 0.75,
  },
});
