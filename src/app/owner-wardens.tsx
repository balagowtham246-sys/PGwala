import React, { useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Eye, EyeOff, UserCog } from 'lucide-react-native';

import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useProperty } from '@/context/property-context';
import { useToast } from '@/context/toast-context';
import { queryKeys } from '@/lib/query-keys';
import { broadcastPropertySync } from '@/lib/realtime-sync';
import {
  assignPropertyWarden,
  fetchOwnerWardens,
  OwnerWardensMap,
  removePropertyWarden,
} from '@/services/wardens.service';
import {
  DestructiveButton,
  OwnerHeader,
  PrimaryButton,
  SecondaryButton,
  SkeletonBlock,
} from '@/components/ui/owner';

export default function OwnerWardensScreen() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { properties } = useProperty();
  const { showToast } = useToast();
  const userId = user?.id ?? 'owner';
  const propertyIds = useMemo(() => properties.map((p) => p.id), [properties]);

  const wardensQuery = useQuery<OwnerWardensMap>({
    queryKey: queryKeys.wardens.owner(userId),
    enabled: propertyIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetchOwnerWardens(propertyIds);
      if (!res.ok) throw res.error;
      return res.data;
    },
  });

  const wardens = wardensQuery.data ?? {};
  const loading = wardensQuery.isPending && !wardensQuery.data && propertyIds.length > 0;
  const errorMessage = wardensQuery.isError ? wardensQuery.error.message : null;
  const [refreshing, setRefreshing] = useState(false);

  const [modalPropertyId, setModalPropertyId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removingPropertyId, setRemovingPropertyId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await wardensQuery.refetch();
    } finally {
      setRefreshing(false);
    }
  };

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
    const targetPropertyId = modalPropertyId;
    try {
      const res = await assignPropertyWarden({
        propertyId: targetPropertyId,
        fullName: trimmedName,
        email: trimmedEmail,
        phoneNumber: phone.trim() || undefined,
        temporaryPassword: password,
      });
      if (!res.ok) {
        setFormError(res.error.message);
        return;
      }
      // Instant local cache update (no slow refetch round-trip)
      qc.setQueryData<OwnerWardensMap>(queryKeys.wardens.owner(userId), (prev) => ({
        ...(prev ?? {}),
        [targetPropertyId]: res.data,
      }));
      setModalPropertyId(null);
      Alert.alert(
        'Warden assigned',
        'Share the email and temporary password with the warden. They will be asked to change it on first login.'
      );
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
          const prevMap = qc.getQueryData<OwnerWardensMap>(queryKeys.wardens.owner(userId));
          setRemovingPropertyId(propertyId);
          // Optimistically clear warden in UI immediately
          qc.setQueryData<OwnerWardensMap>(queryKeys.wardens.owner(userId), (prev) => ({
            ...(prev ?? {}),
            [propertyId]: null,
          }));
          try {
            const res = await removePropertyWarden(propertyId);
            if (!res.ok) {
              qc.setQueryData(queryKeys.wardens.owner(userId), prevMap);
              Alert.alert('Could not remove', res.error.message);
              return;
            }
            broadcastPropertySync('settings', propertyId);
            showToast(`${wardenName} removed`);
          } finally {
            setRemovingPropertyId(null);
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <OwnerHeader title="Wardens" subtitle="Assign a warden to each property" showBack />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void handleRefresh()}
            colors={[OwnerTheme.colors.primary]}
          />
        }>
        {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}

        {properties.map((p) => {
          const warden = wardens[p.id];
          const isRemoving = removingPropertyId === p.id;
          return (
            <View key={p.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Building2 size={18} color={OwnerTheme.colors.primary} />
                <Text style={styles.propertyName} numberOfLines={1}>
                  {p.name}
                </Text>
              </View>

              {loading ? (
                <View style={styles.wardenBox}>
                  <SkeletonBlock width={24} height={24} borderRadius={12} />
                  <View style={{ flex: 1, gap: 6 }}>
                    <SkeletonBlock width="48%" height={14} />
                    <SkeletonBlock width="68%" height={11} />
                  </View>
                </View>
              ) : warden ? (
                <View style={styles.wardenBox}>
                  <UserCog size={18} color={OwnerTheme.colors.textSecondary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.wardenName}>{warden.full_name}</Text>
                    <Text style={styles.wardenMeta} numberOfLines={1}>
                      {warden.email || warden.phone_number
                        ? [warden.email, warden.phone_number].filter(Boolean).join(' • ')
                        : 'Assigned warden'}
                    </Text>
                  </View>
                </View>
              ) : (
                <Text style={styles.noWarden}>No warden assigned</Text>
              )}

              <View style={styles.actions}>
                <SecondaryButton
                  label={warden ? 'Change warden' : 'Assign warden'}
                  onPress={() => openModal(p.id)}
                  disabled={loading || isRemoving}
                  style={{ flex: 1 }}
                />
                {warden ? (
                  <DestructiveButton
                    label="Remove"
                    loading={isRemoving}
                    onPress={() => handleRemove(p.id, warden.full_name)}
                    style={{ flex: 1 }}
                  />
                ) : null}
              </View>
            </View>
          );
        })}
      </ScrollView>

      <BottomSheetModal
        visible={Boolean(modalPropertyId)}
        onClose={() => setModalPropertyId(null)}
        title="Assign warden"
        disabled={saving}>
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
      </BottomSheetModal>
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
