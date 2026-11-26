import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Building2,
  CheckCircle2,
  MessageCircle,
  RefreshCw,
  Share2,
  ShieldAlert,
  UserPlus,
} from 'lucide-react-native';

import { OwnerHeader } from '@/components/ui/owner';
import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/context/toast-context';
import { buildWhatsAppReminderUrl } from '@/lib/billing-utils';
import { isDeveloperAccessAllowed } from '@/lib/dev-tasks';
import { invokeEdgeFunction } from '@/lib/edge-functions';
import { extractErrorMessage } from '@/lib/error-utils';

type PgGenderType = 'coed' | 'boys' | 'girls';

function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = 'PG@';
  for (let i = 0; i < 6; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

interface CreatedOwnerResult {
  owner_name: string;
  owner_email: string;
  owner_phone: string | null;
  pg_name: string;
  password: string;
}

export default function AdminOwnersScreen() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const allowed = isDeveloperAccessAllowed(user?.email);

  const [activeTab, setActiveTab] = useState<'create' | 'reset'>('create');
  const [ownerName, setOwnerName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [password, setPassword] = useState(() => generateTempPassword());
  const [pgName, setPgName] = useState('');
  const [pgAddress, setPgAddress] = useState('');
  const [pgGenderType, setPgGenderType] = useState<PgGenderType>('coed');
  const [totalBeds, setTotalBeds] = useState('25');
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<CreatedOwnerResult | null>(null);

  // Reset Owner Password state
  const [resetEmail, setResetEmail] = useState('');
  const [resetPassword, setResetPassword] = useState(() => generateTempPassword());
  const [resetting, setResetting] = useState(false);
  const [resetResult, setResetResult] = useState<{
    target_name: string;
    target_email: string;
    target_phone: string | null;
    password: string;
  } | null>(null);

  const handleResetOwnerPassword = async () => {
    if (resetting) return;
    const cleanEmail = resetEmail.trim().toLowerCase();
    const cleanPass = resetPassword.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      Alert.alert('Invalid Email', 'Enter the PG owner login email.');
      return;
    }
    if (cleanPass.length < 6) {
      Alert.alert('Weak Password', 'Password must be at least 6 characters.');
      return;
    }
    setResetting(true);
    try {
      const data = await invokeEdgeFunction<{
        success?: boolean;
        error?: string;
        target_name?: string;
        target_email?: string;
        target_phone?: string | null;
      }>('reset-user-password', {
        target_type: 'owner',
        owner_email: cleanEmail,
        new_password: cleanPass,
      });
      if (!data?.success) {
        throw new Error(data?.error || 'Could not reset owner password.');
      }
      setResetResult({
        target_name: data.target_name || 'PG Owner',
        target_email: data.target_email || cleanEmail,
        target_phone: data.target_phone ?? null,
        password: cleanPass,
      });
      showToast('Owner password reset!');
    } catch (err: unknown) {
      Alert.alert(
        'Reset Failed',
        extractErrorMessage(err, 'Could not reset owner password.')
      );
    } finally {
      setResetting(false);
    }
  };

  if (!allowed) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <OwnerHeader title="Admin Access" showBack />
        <View style={styles.blockedWrap}>
          <ShieldAlert size={36} color="#DC2626" />
          <Text style={styles.blockedTitle}>Administrator Only</Text>
          <Text style={styles.blockedSub}>
            Only authorized PGwala administrators can create new PG owner accounts.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const buildWelcomeMessage = (res: CreatedOwnerResult) =>
    [
      `Welcome to *PGwala*, ${res.owner_name}!`,
      `Your PG *${res.pg_name}* is now ready.`,
      '',
      `*Owner Login Details:*`,
      `Email: ${res.owner_email}`,
      `Password: ${res.password}`,
      '',
      `Open the PGwala app and sign in with the credentials above. You can change your password anytime in Settings.`,
    ].join('\n');

  const handleCreateOwner = async () => {
    if (submitting) return;
    const cleanName = ownerName.trim();
    const cleanEmail = ownerEmail.trim().toLowerCase();
    const cleanPg = pgName.trim();
    const cleanPass = password.trim();

    if (cleanName.length < 2) {
      Alert.alert('Missing Name', 'Enter the PG owner full name.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      Alert.alert('Invalid Email', 'Enter a valid email address for the owner.');
      return;
    }
    if (cleanPass.length < 6) {
      Alert.alert('Weak Password', 'Temporary password must be at least 6 characters.');
      return;
    }
    if (cleanPg.length < 2) {
      Alert.alert('Missing PG Name', 'Enter the name of their PG / Hostel.');
      return;
    }

    setSubmitting(true);
    try {
      const data = await invokeEdgeFunction<{
        success?: boolean;
        error?: string;
        owner_name?: string;
        owner_email?: string;
        owner_phone?: string | null;
        pg_name?: string;
      }>('create-owner', {
        owner_name: cleanName,
        owner_phone: ownerPhone.trim() || undefined,
        owner_email: cleanEmail,
        temporary_password: cleanPass,
        pg_name: cleanPg,
        pg_address: pgAddress.trim() || null,
        pg_gender_type: pgGenderType,
        total_beds: parseInt(totalBeds, 10) || 25,
      });

      if (!data?.success) {
        throw new Error(data?.error || 'Failed to create PG owner.');
      }

      setCreated({
        owner_name: data.owner_name || cleanName,
        owner_email: data.owner_email || cleanEmail,
        owner_phone: data.owner_phone ?? (ownerPhone.trim() || null),
        pg_name: data.pg_name || cleanPg,
        password: cleanPass,
      });
      showToast(`Owner ${cleanName} created!`);
    } catch (err: unknown) {
      Alert.alert(
        'Creation Failed',
        extractErrorMessage(err, 'Could not create PG owner account.')
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetForm = () => {
    setCreated(null);
    setOwnerName('');
    setOwnerPhone('');
    setOwnerEmail('');
    setPassword(generateTempPassword());
    setPgName('');
    setPgAddress('');
    setTotalBeds('25');
  };

  const handleShareCredentials = async () => {
    if (!created) return;
    await Share.share({
      title: `PGwala Owner Login — ${created.pg_name}`,
      message: buildWelcomeMessage(created),
    });
  };

  const handleWhatsAppCredentials = () => {
    if (!created) return;
    const url = buildWhatsAppReminderUrl(
      created.owner_phone,
      buildWelcomeMessage(created)
    );
    if (!url) {
      Alert.alert('No Phone Number', 'Use Share Credentials to copy or send via WhatsApp.');
      return;
    }
    Linking.openURL(url).catch(() => {
      Alert.alert('WhatsApp Unavailable', 'Could not open WhatsApp on this device.');
    });
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <OwnerHeader
        title="Add PG Owner"
        subtitle="Admin Provisioning"
        showBack
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.tabRow}>
            <Pressable
              style={[styles.tabBtn, activeTab === 'create' && styles.tabBtnActive]}
              onPress={() => setActiveTab('create')}>
              <Text style={[styles.tabText, activeTab === 'create' && styles.tabTextActive]}>
                Create PG Owner
              </Text>
            </Pressable>
            <Pressable
              style={[styles.tabBtn, activeTab === 'reset' && styles.tabBtnActive]}
              onPress={() => setActiveTab('reset')}>
              <Text style={[styles.tabText, activeTab === 'reset' && styles.tabTextActive]}>
                Reset Password
              </Text>
            </Pressable>
          </View>

          {activeTab === 'reset' ? (
            resetResult ? (
              <View style={styles.successCard}>
                <View style={styles.successHeader}>
                  <CheckCircle2 size={28} color="#16A34A" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.successTitle}>Password Reset</Text>
                    <Text style={styles.successSub}>{resetResult.target_name}</Text>
                  </View>
                </View>

                <View style={styles.credBox}>
                  <Text style={styles.credLabel}>Login Email</Text>
                  <Text style={styles.credValue} selectable>
                    {resetResult.target_email}
                  </Text>
                  <Text style={[styles.credLabel, { marginTop: 10 }]}>
                    New Password
                  </Text>
                  <Text style={styles.credValue} selectable>
                    {resetResult.password}
                  </Text>
                </View>

                <View style={styles.shareBtnRow}>
                  {resetResult.target_phone ? (
                    <Pressable
                      style={[styles.actionBtn, styles.whatsappBtn]}
                      onPress={() => {
                        const msg = `Hi ${resetResult.target_name}, your PGwala Owner password has been reset.\n\nEmail: ${resetResult.target_email}\nNew Password: ${resetResult.password}`;
                        const url = buildWhatsAppReminderUrl(resetResult.target_phone, msg);
                        if (url) void Linking.openURL(url).catch(() => {});
                      }}>
                      <MessageCircle size={16} color="#FFFFFF" />
                      <Text style={styles.actionBtnText}>WhatsApp</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    style={[styles.actionBtn, styles.shareBtn]}
                    onPress={() =>
                      void Share.share({
                        title: 'PGwala Owner Password Reset',
                        message: `Hi ${resetResult.target_name}, your PGwala Owner password has been reset.\n\nEmail: ${resetResult.target_email}\nNew Password: ${resetResult.password}`,
                      })
                    }>
                    <Share2 size={16} color="#FFFFFF" />
                    <Text style={styles.actionBtnText}>Share / Copy</Text>
                  </Pressable>
                </View>

                <Pressable
                  style={styles.resetBtn}
                  onPress={() => {
                    setResetResult(null);
                    setResetEmail('');
                    setResetPassword(generateTempPassword());
                  }}>
                  <Text style={styles.resetBtnText}>Reset Another Owner</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.formCard}>
                <Text style={styles.label}>PG Owner Email *</Text>
                <TextInput
                  style={styles.input}
                  value={resetEmail}
                  onChangeText={setResetEmail}
                  placeholder="owner@gmail.com"
                  placeholderTextColor="#94A3B8"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                <Text style={styles.label}>New Temporary Password *</Text>
                <View style={styles.passwordRow}>
                  <TextInput
                    style={[styles.input, { flex: 1, marginBottom: 0 }]}
                    value={resetPassword}
                    onChangeText={setResetPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <Pressable
                    style={styles.regenBtn}
                    onPress={() => setResetPassword(generateTempPassword())}>
                    <RefreshCw size={16} color={OwnerTheme.colors.primary} />
                  </Pressable>
                </View>

                <Pressable
                  disabled={resetting}
                  style={[styles.submitBtn, resetting && { opacity: 0.6 }]}
                  onPress={() => void handleResetOwnerPassword()}>
                  {resetting ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.submitBtnText}>Reset Owner Password</Text>
                  )}
                </Pressable>
              </View>
            )
          ) : created ? (
            <View style={styles.successCard}>
              <View style={styles.successHeader}>
                <CheckCircle2 size={28} color="#16A34A" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.successTitle}>PG Owner Created</Text>
                  <Text style={styles.successSub}>
                    {created.owner_name} · {created.pg_name}
                  </Text>
                </View>
              </View>

              <View style={styles.credBox}>
                <Text style={styles.credLabel}>Login Email</Text>
                <Text style={styles.credValue} selectable>
                  {created.owner_email}
                </Text>
                <Text style={[styles.credLabel, { marginTop: 10 }]}>
                  Temporary Password
                </Text>
                <Text style={styles.credValue} selectable>
                  {created.password}
                </Text>
              </View>

              <View style={styles.shareBtnRow}>
                {created.owner_phone ? (
                  <Pressable
                    style={[styles.actionBtn, styles.whatsappBtn]}
                    onPress={handleWhatsAppCredentials}>
                    <MessageCircle size={16} color="#FFFFFF" />
                    <Text style={styles.actionBtnText}>Send on WhatsApp</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  style={[styles.actionBtn, styles.shareBtn]}
                  onPress={handleShareCredentials}>
                  <Share2 size={16} color="#FFFFFF" />
                  <Text style={styles.actionBtnText}>Share / Copy</Text>
                </Pressable>
              </View>

              <Pressable style={styles.resetBtn} onPress={handleResetForm}>
                <Text style={styles.resetBtnText}>+ Create Another PG Owner</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.formCard}>
              <View style={styles.sectionHeaderRow}>
                <UserPlus size={16} color={OwnerTheme.colors.primary} />
                <Text style={styles.sectionTitle}>Owner Account</Text>
              </View>

              <Text style={styles.label}>Owner Full Name *</Text>
              <TextInput
                style={styles.input}
                value={ownerName}
                onChangeText={setOwnerName}
                placeholder="e.g. Rajesh Kumar"
                placeholderTextColor="#94A3B8"
                autoCapitalize="words"
              />

              <Text style={styles.label}>Owner Phone (10 digits)</Text>
              <TextInput
                style={styles.input}
                value={ownerPhone}
                onChangeText={setOwnerPhone}
                placeholder="e.g. 9876543210"
                placeholderTextColor="#94A3B8"
                keyboardType="phone-pad"
                maxLength={14}
              />

              <Text style={styles.label}>Owner Login Email *</Text>
              <TextInput
                style={styles.input}
                value={ownerEmail}
                onChangeText={setOwnerEmail}
                placeholder="owner@gmail.com"
                placeholderTextColor="#94A3B8"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Text style={styles.label}>Temporary Password *</Text>
              <View style={styles.passwordRow}>
                <TextInput
                  style={[styles.input, { flex: 1, marginBottom: 0 }]}
                  value={password}
                  onChangeText={setPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Pressable
                  style={styles.regenBtn}
                  onPress={() => setPassword(generateTempPassword())}>
                  <RefreshCw size={16} color={OwnerTheme.colors.primary} />
                </Pressable>
              </View>

              <View style={[styles.sectionHeaderRow, { marginTop: 18 }]}>
                <Building2 size={16} color={OwnerTheme.colors.primary} />
                <Text style={styles.sectionTitle}>First PG Property</Text>
              </View>

              <Text style={styles.label}>PG / Hostel Name *</Text>
              <TextInput
                style={styles.input}
                value={pgName}
                onChangeText={setPgName}
                placeholder="e.g. Sri Lakshmi Men's PG"
                placeholderTextColor="#94A3B8"
              />

              <Text style={styles.label}>PG Type</Text>
              <View style={styles.genderRow}>
                {(
                  [
                    { key: 'coed', label: 'Co-ed' },
                    { key: 'boys', label: 'Boys' },
                    { key: 'girls', label: 'Girls' },
                  ] as const
                ).map((opt) => (
                  <Pressable
                    key={opt.key}
                    style={[
                      styles.genderChip,
                      pgGenderType === opt.key && styles.genderChipActive,
                    ]}
                    onPress={() => setPgGenderType(opt.key)}>
                    <Text
                      style={[
                        styles.genderChipText,
                        pgGenderType === opt.key && styles.genderChipTextActive,
                      ]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.label}>Total Beds</Text>
              <TextInput
                style={styles.input}
                value={totalBeds}
                onChangeText={setTotalBeds}
                keyboardType="number-pad"
                placeholder="25"
                placeholderTextColor="#94A3B8"
              />

              <Text style={styles.label}>Address (Optional)</Text>
              <TextInput
                style={styles.input}
                value={pgAddress}
                onChangeText={setPgAddress}
                placeholder="Area / City"
                placeholderTextColor="#94A3B8"
              />

              <Pressable
                disabled={submitting}
                style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
                onPress={() => void handleCreateOwner()}>
                {submitting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.submitBtnText}>Create Owner &amp; PG</Text>
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
  safeArea: { flex: 1, backgroundColor: OwnerTheme.colors.background },
  scrollContent: { padding: 16, paddingBottom: 40 },
  blockedWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 10,
  },
  blockedTitle: { fontSize: 18, fontWeight: '700', color: '#0F172A' },
  blockedSub: { fontSize: 13, color: '#64748B', textAlign: 'center' },
  formCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 16,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#0F172A' },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0F172A',
    backgroundColor: '#F8FAFC',
    marginBottom: 12,
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  regenBtn: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: OwnerTheme.colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  genderRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  genderChip: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
  },
  genderChipActive: {
    backgroundColor: OwnerTheme.colors.primary,
    borderColor: OwnerTheme.colors.primary,
  },
  genderChipText: { fontSize: 13, fontWeight: '600', color: '#475569' },
  genderChipTextActive: { color: '#FFFFFF' },
  submitBtn: {
    marginTop: 8,
    backgroundColor: OwnerTheme.colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitBtnText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  successCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    padding: 18,
    gap: 14,
  },
  successHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  successTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  successSub: { fontSize: 13, color: '#475569', marginTop: 2 },
  credBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
  },
  credLabel: { fontSize: 11, fontWeight: '700', color: '#64748B' },
  credValue: { fontSize: 15, fontWeight: '700', color: '#0F172A', marginTop: 2 },
  shareBtnRow: { flexDirection: 'row', gap: 10 },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
  },
  whatsappBtn: { backgroundColor: '#16A34A' },
  shareBtn: { backgroundColor: OwnerTheme.colors.primary },
  actionBtnText: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
  resetBtn: {
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
  },
  resetBtnText: { fontSize: 13, fontWeight: '700', color: '#334155' },
  tabRow: {
    flexDirection: 'row',
    backgroundColor: '#E2E8F0',
    borderRadius: 12,
    padding: 3,
    gap: 4,
    marginBottom: 14,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 9,
    alignItems: 'center',
  },
  tabBtnActive: { backgroundColor: '#FFFFFF' },
  tabText: { fontSize: 13, fontWeight: '600', color: '#64748B' },
  tabTextActive: { color: OwnerTheme.colors.primary, fontWeight: '700' },
});
