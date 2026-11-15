import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Building2, Eye, EyeOff, UserCog, X } from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';
import { useProperty } from '@/context/property-context';
import { invokeEdgeFunction } from '@/lib/edge-functions';
import { extractErrorMessage } from '@/lib/error-utils';
import { OwnerHeader, PrimaryButton, SecondaryButton, DestructiveButton } from '@/components/ui/owner';

interface WardenInfo {
  profile_id: string;
  full_name: string;
  email: string | null;
  phone_number: string | null;
}

export default function OwnerWardensScreen() {
  const { properties } = useProperty();
  const [wardens, setWardens] = useState<Record<string, WardenInfo | null>>({});
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [modalPropertyId, setModalPropertyId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadWardens = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const entries = await Promise.all(
        properties.map(async (p) => {
          const res = await invokeEdgeFunction<{ warden: WardenInfo | null }>('manage-warden', {
            action: 'get',
            property_id: p.id,
          });
          return [p.id, res.warden] as const;
        })
      );
      setWardens(Object.fromEntries(entries));
    } catch (err) {
      setErrorMessage(extractErrorMessage(err, 'Could not load wardens.'));
    } finally {
      setLoading(false);
    }
  }, [properties]);

  useEffect(() => {
    loadWardens();
  }, [loadWardens]);

  const openModal = (propertyId: string) => {
    setModalPropertyId(propertyId);
    setName('');
    setEmail('');
    setPhone('');
    setPassword('');
    setShowPassword(false);
    setFormError(null);
  };

  const handleSave = async () => {
    if (!modalPropertyId || saving) return;
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (trimmedName.length < 2) return setFormError('Enter the warden name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) return setFormError('Enter a valid email.');
    if (password.length < 6) return setFormError('Temporary password must be at least 6 characters.');

    setSaving(true);
    setFormError(null);
    try {
      await invokeEdgeFunction('manage-warden', {
        action: 'create_and_assign',
        property_id: modalPropertyId,
        full_name: trimmedName,
        email: trimmedEmail,
        phone_number: phone.trim() || undefined,
        temporary_password: password,
      });
      setModalPropertyId(null);
      await loadWardens();
      Alert.alert('Warden assigned', 'Share the email and temporary password with the warden. They will be asked to change it on first login.');
    } catch (err) {
      setFormError(extractErrorMessage(err, 'Could not assign warden.'));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = (propertyId: string, wardenName: string) => {
    Alert.alert('Remove warden?', `${wardenName} will lose access to this property immediately.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await invokeEdgeFunction('manage-warden', { action: 'remove', property_id: propertyId });
            await loadWardens();
          } catch (err) {
            Alert.alert('Could not remove', extractErrorMessage(err, 'Please try again.'));
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <OwnerHeader title="Wardens" subtitle="Assign a warden to each property" showBack />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}

        {loading && properties.length > 0 ? (
          <ActivityIndicator style={{ marginTop: 32 }} color={OwnerTheme.colors.primary} />
        ) : null}

        {properties.map((p) => {
          const warden = wardens[p.id];
          return (
            <View key={p.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Building2 size={18} color={OwnerTheme.colors.primary} />
                <Text style={styles.propertyName} numberOfLines={1}>
                  {p.name}
                </Text>
              </View>

              {warden ? (
                <View style={styles.wardenBox}>
                  <UserCog size={18} color={OwnerTheme.colors.textSecondary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.wardenName}>{warden.full_name}</Text>
                    <Text style={styles.wardenMeta} numberOfLines={1}>
                      {warden.email ?? 'No email'}
                      {warden.phone_number ? ` • ${warden.phone_number}` : ''}
                    </Text>
                  </View>
                </View>
              ) : (
                <Text style={styles.noWarden}>{loading ? 'Loading…' : 'No warden assigned'}</Text>
              )}

              <View style={styles.actions}>
                <SecondaryButton
                  label={warden ? 'Change warden' : 'Assign warden'}
                  onPress={() => openModal(p.id)}
                  style={{ flex: 1 }}
                />
                {warden ? (
                  <DestructiveButton
                    label="Remove"
                    onPress={() => handleRemove(p.id, warden.full_name)}
                    style={{ flex: 1 }}
                  />
                ) : null}
              </View>
            </View>
          );
        })}
      </ScrollView>

      <Modal visible={Boolean(modalPropertyId)} transparent animationType="slide" onRequestClose={() => setModalPropertyId(null)}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Assign warden</Text>
              <Pressable hitSlop={10} onPress={() => setModalPropertyId(null)}>
                <X size={22} color={OwnerTheme.colors.textSecondary} />
              </Pressable>
            </View>
            <Text style={styles.modalHint}>
              Any current warden for this property will be replaced. The warden signs in like a resident, with email and password.
            </Text>

            <TextInput style={styles.input} placeholder="Full name" value={name} onChangeText={setName} />
            <TextInput
              style={styles.input}
              placeholder="Email"
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            <TextInput
              style={styles.input}
              placeholder="Phone (optional)"
              keyboardType="phone-pad"
              value={phone}
              onChangeText={setPhone}
            />
            <View style={styles.passwordRow}>
              <TextInput
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                placeholder="Temporary password"
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                value={password}
                onChangeText={setPassword}
              />
              <Pressable hitSlop={10} onPress={() => setShowPassword((v) => !v)} style={styles.eyeBtn}>
                {showPassword ? (
                  <EyeOff size={20} color={OwnerTheme.colors.textSecondary} />
                ) : (
                  <Eye size={20} color={OwnerTheme.colors.textSecondary} />
                )}
              </Pressable>
            </View>

            {formError && <Text style={styles.errorText}>{formError}</Text>}

            <PrimaryButton label="Assign warden" onPress={handleSave} loading={saving} style={{ marginTop: 16 }} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OwnerTheme.colors.background },
  content: { padding: 16, paddingBottom: 60, gap: 14 },
  card: {
    backgroundColor: OwnerTheme.colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 16,
    gap: 12,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  propertyName: { fontSize: 16, fontWeight: '700', color: OwnerTheme.colors.textPrimary, flex: 1 },
  wardenBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: OwnerTheme.colors.surfaceElevated,
    borderRadius: 12,
    padding: 12,
  },
  wardenName: { fontSize: 15, fontWeight: '600', color: OwnerTheme.colors.textPrimary },
  wardenMeta: { fontSize: 13, color: OwnerTheme.colors.textSecondary, marginTop: 2 },
  noWarden: { fontSize: 14, color: OwnerTheme.colors.textMuted },
  actions: { flexDirection: 'row', gap: 10 },
  errorText: { color: OwnerTheme.colors.danger, fontSize: 13, marginTop: 8 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 32,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: 18, fontWeight: '700', color: OwnerTheme.colors.textPrimary },
  modalHint: { fontSize: 13, color: OwnerTheme.colors.textSecondary, marginVertical: 10 },
  input: {
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 48,
    fontSize: 15,
    color: OwnerTheme.colors.textPrimary,
    marginBottom: 10,
    backgroundColor: '#FFFFFF',
  },
  passwordRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eyeBtn: { padding: 8 },
});
