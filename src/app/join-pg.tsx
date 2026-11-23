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
import { router, useLocalSearchParams } from 'expo-router';
import { Building2, CheckCircle2, Eye, EyeOff, QrCode } from 'lucide-react-native';

import { DarkSlateHeroCard } from '@/components/ui/dark-slate-hero-card';
import { OwnerHeader } from '@/components/ui/owner';
import { OwnerTheme } from '@/constants/theme';
import { useToast } from '@/context/toast-context';
import {
  isValidInviteCodeFormat,
  normalizeInviteCode,
} from '@/lib/invite-utils';
import { supabase } from '@/lib/supabase';
import {
  formatPropertyGenderLabel,
  ResidentGender,
  validateIndianPhone,
} from '@/lib/ux-utils';
import {
  InvitePropertyPreview,
  lookupPropertyByInviteCode,
  submitResidentJoinRequest,
} from '@/services/join-requests.service';

export default function JoinPgScreen() {
  const { showToast } = useToast();
  const params = useLocalSearchParams<{ code?: string | string[] }>();
  const rawDeepLinkCode = Array.isArray(params.code) ? params.code[0] : params.code;

  const [inviteCode, setInviteCode] = useState(() =>
    normalizeInviteCode(rawDeepLinkCode)
  );
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [verifiedProperty, setVerifiedProperty] =
    useState<InvitePropertyPreview | null>(null);

  // Step 2 Form Fields
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [gender, setGender] = useState<ResidentGender | null>(null);
  const [emergencyContact, setEmergencyContact] = useState('');
  const [roomHint, setRoomHint] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleLookup = useCallback(async (raw: string) => {
    const norm = normalizeInviteCode(raw);
    if (!isValidInviteCodeFormat(norm)) {
      setLookupError('Enter the 6-character code from your PG owner or QR poster.');
      return;
    }
    setLookingUp(true);
    setLookupError(null);
    try {
      const prop = await lookupPropertyByInviteCode(norm);
      setVerifiedProperty(prop);
      if (prop.gender_type === 'girls') setGender('female');
      else if (prop.gender_type === 'boys') setGender('male');
    } catch (err) {
      setVerifiedProperty(null);
      setLookupError(
        err instanceof Error ? err.message : 'Could not verify invite code.'
      );
    } finally {
      setLookingUp(false);
    }
  }, []);

  useEffect(() => {
    const norm = normalizeInviteCode(rawDeepLinkCode);
    if (!isValidInviteCodeFormat(norm)) return;
    const timer = setTimeout(() => {
      setInviteCode(norm);
      void handleLookup(norm);
    }, 0);
    return () => clearTimeout(timer);
  }, [rawDeepLinkCode, handleLookup]);

  const handleSubmit = async () => {
    if (!verifiedProperty || submitting) return;
    setFormError(null);

    if (fullName.trim().length < 2) {
      setFormError('Please enter your full name.');
      return;
    }
    const phoneCheck = validateIndianPhone(phone);
    if (!phoneCheck.valid) {
      setFormError('Please enter a valid 10-digit Indian mobile number.');
      return;
    }
    const trimmedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setFormError('Please enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      setFormError('Password must be at least 6 characters.');
      return;
    }
    if (!gender) {
      setFormError('Please select your gender.');
      return;
    }

    setSubmitting(true);
    try {
      await submitResidentJoinRequest({
        invite_code: inviteCode,
        full_name: fullName.trim(),
        email: trimmedEmail,
        password,
        phone_number: phoneCheck.normalized10,
        gender,
        emergency_contact: emergencyContact.trim() || undefined,
        room_hint: roomHint.trim() || undefined,
      });

      // Automatically sign the resident in so they land on the live Pending Approval screen
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });

      if (signInErr) {
        Alert.alert(
          'Request Submitted!',
          `Your request to join ${verifiedProperty.name} was sent. Sign in with your email and password to check approval status.`,
          [{ text: 'Go to Login', onPress: () => router.replace('/login') }]
        );
        return;
      }

      showToast(`Join request sent to ${verifiedProperty.name}!`);
      router.replace('/pending-approval');
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Could not submit join request.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const genderLocked =
    verifiedProperty?.gender_type === 'girls' ||
    verifiedProperty?.gender_type === 'boys';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <OwnerHeader
        title="Join a PG"
        subtitle="Resident Self-Onboarding"
        showBack
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/login'))}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <DarkSlateHeroCard
            eyebrow="SELF-REGISTRATION"
            title={
              verifiedProperty ? verifiedProperty.name : 'Enter PG Invite Code'
            }
            subtitle={
              verifiedProperty
                ? `${formatPropertyGenderLabel(verifiedProperty.gender_type)}${
                    verifiedProperty.address ? ` · ${verifiedProperty.address}` : ''
                  }`
                : 'Get the 6-character code from your PG owner or scan the PG wall QR'
            }
            badgeLabel={verifiedProperty ? 'Verified PG' : 'Step 1 of 2'}
            badgeTone={verifiedProperty ? 'success' : 'info'}
          />

          {/* Step 1: Invite Code Lookup */}
          <View style={styles.card}>
            <View style={styles.cardTitleRow}>
              <QrCode size={17} color={OwnerTheme.colors.primary} />
              <Text style={styles.cardTitle}>PG Invite Code</Text>
            </View>
            <View style={styles.codeRow}>
              <TextInput
                style={styles.codeInput}
                placeholder="e.g. SHAL7K"
                placeholderTextColor="#94A3B8"
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={8}
                value={inviteCode}
                onChangeText={(txt) => {
                  const next = normalizeInviteCode(txt);
                  setInviteCode(next);
                  setLookupError(null);
                  if (verifiedProperty) setVerifiedProperty(null);
                }}
                editable={!lookingUp && !submitting}
              />
              <Pressable
                accessibilityRole="button"
                disabled={lookingUp || !isValidInviteCodeFormat(inviteCode)}
                style={[
                  styles.verifyBtn,
                  (!isValidInviteCodeFormat(inviteCode) || lookingUp) && {
                    opacity: 0.5,
                  },
                ]}
                onPress={() => void handleLookup(inviteCode)}>
                {lookingUp ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.verifyBtnText}>Verify</Text>
                )}
              </Pressable>
            </View>
            {lookupError && <Text style={styles.errorText}>{lookupError}</Text>}
            {verifiedProperty && (
              <View style={styles.verifiedStrip}>
                <CheckCircle2 size={15} color="#047857" />
                <Text style={styles.verifiedText}>
                  Matched: {verifiedProperty.name}
                </Text>
              </View>
            )}
          </View>

          {/* Step 2: Resident Details Form */}
          {verifiedProperty && (
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Building2 size={17} color={OwnerTheme.colors.primary} />
                <Text style={styles.cardTitle}>Your Details</Text>
              </View>

              <Text style={styles.label}>Full Name *</Text>
              <TextInput
                style={styles.input}
                placeholder="Your full name"
                placeholderTextColor="#94A3B8"
                value={fullName}
                onChangeText={setFullName}
                editable={!submitting}
              />

              <Text style={styles.label}>Mobile Number (10 digits) *</Text>
              <TextInput
                style={styles.input}
                placeholder="9876543210"
                placeholderTextColor="#94A3B8"
                keyboardType="phone-pad"
                maxLength={13}
                value={phone}
                onChangeText={setPhone}
                editable={!submitting}
              />

              <Text style={styles.label}>Email (for PGwala Login) *</Text>
              <TextInput
                style={styles.input}
                placeholder="you@example.com"
                placeholderTextColor="#94A3B8"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                value={email}
                onChangeText={setEmail}
                editable={!submitting}
              />

              <Text style={styles.label}>Create Password (min 6 chars) *</Text>
              <View style={styles.passwordWrap}>
                <TextInput
                  style={styles.passwordInput}
                  placeholder="Choose your own password"
                  placeholderTextColor="#94A3B8"
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  value={password}
                  onChangeText={setPassword}
                  editable={!submitting}
                />
                <Pressable
                  hitSlop={8}
                  style={styles.eyeBtn}
                  onPress={() => setShowPassword((prev) => !prev)}>
                  {showPassword ? (
                    <EyeOff size={18} color="#64748B" />
                  ) : (
                    <Eye size={18} color="#64748B" />
                  )}
                </Pressable>
              </View>

              <Text style={styles.label}>
                Gender *{genderLocked ? ' (set by PG policy)' : ''}
              </Text>
              <View style={styles.genderRow}>
                {(
                  [
                    { key: 'male', label: 'Male' },
                    { key: 'female', label: 'Female' },
                    { key: 'other', label: 'Other' },
                  ] as { key: ResidentGender; label: string }[]
                ).map((opt) => {
                  const selected = gender === opt.key;
                  const disabledOpt = genderLocked && !selected;
                  return (
                    <Pressable
                      key={opt.key}
                      disabled={disabledOpt || submitting}
                      style={[
                        styles.genderChip,
                        selected && styles.genderChipActive,
                        disabledOpt && { opacity: 0.35 },
                      ]}
                      onPress={() => setGender(opt.key)}>
                      <Text
                        style={[
                          styles.genderChipText,
                          selected && styles.genderChipTextActive,
                        ]}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.label}>
                Current / Preferred Room # (optional)
              </Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Room 204 (helps owner approve faster)"
                placeholderTextColor="#94A3B8"
                value={roomHint}
                onChangeText={setRoomHint}
                editable={!submitting}
              />

              <Text style={styles.label}>Emergency Contact (optional)</Text>
              <TextInput
                style={styles.input}
                placeholder="Parent / Guardian phone"
                placeholderTextColor="#94A3B8"
                value={emergencyContact}
                onChangeText={setEmergencyContact}
                editable={!submitting}
              />

              {formError && <Text style={styles.errorText}>{formError}</Text>}

              <Pressable
                accessibilityRole="button"
                disabled={submitting}
                style={({ pressed }) => [
                  styles.submitBtn,
                  (submitting || pressed) && { opacity: 0.8 },
                ]}
                onPress={() => void handleSubmit()}>
                {submitting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.submitBtnText}>Submit Join Request</Text>
                )}
              </Pressable>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F8FAFC' },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#0F172A' },
  codeRow: { flexDirection: 'row', gap: 10 },
  codeInput: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 14,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 3,
    color: '#0F172A',
  },
  verifyBtn: {
    paddingHorizontal: 18,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  verifyBtnText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  verifiedStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  verifiedText: { fontSize: 13, fontWeight: '700', color: '#047857' },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginTop: 12,
    marginBottom: 6,
  },
  input: {
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    fontSize: 14,
    color: '#0F172A',
  },
  passwordWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
  },
  passwordInput: {
    flex: 1,
    height: 44,
    paddingHorizontal: 12,
    fontSize: 14,
    color: '#0F172A',
  },
  eyeBtn: { paddingHorizontal: 12 },
  genderRow: { flexDirection: 'row', gap: 8 },
  genderChip: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  genderChipActive: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  genderChipText: { fontSize: 13, fontWeight: '600', color: '#475569' },
  genderChipTextActive: { color: '#FFFFFF', fontWeight: '700' },
  errorText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#DC2626',
    marginTop: 10,
  },
  submitBtn: {
    marginTop: 18,
    height: 50,
    borderRadius: 14,
    backgroundColor: OwnerTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
});
