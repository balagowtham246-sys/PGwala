import React, { useCallback, useEffect, useState, useMemo } from 'react';
import {
  ActivityIndicator,
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
import { router, useLocalSearchParams } from 'expo-router';
import {
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/lib/supabase';
import {
  OwnerHeader,
  PrimaryButton,
  SecondaryButton,
  DestructiveButton,
  StatusBadge,
  ErrorState,
} from '@/components/ui/owner';

interface ResidentData {
  id: string;
  property_id: string;
  profile_id: string | null;
  full_name: string;
  phone_number: string | null;
  room_number: string;
  is_active: boolean;
  profile?: {
    id: string;
    full_name: string;
  } | null;
}

interface RpcResponse {
  success: boolean;
  message?: string;
  error?: string;
  resident_id?: string;
  profile_id?: string;
}

export default function EditResidentScreen() {
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id?: string }>();

  const [loading, setLoading] = useState(true);
  const [resident, setResident] = useState<ResidentData | null>(null);

  // Form Fields
  const [fullName, setFullName] = useState('');
  const [roomNumber, setRoomNumber] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [studentEmail, setStudentEmail] = useState('');

  // Mutation states
  const [saving, setSaving] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [linking, setLinking] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Check if form has unsaved changes
  const hasChanges = useMemo(() => {
    if (!resident) return false;
    return (
      fullName.trim() !== resident.full_name ||
      roomNumber.trim() !== resident.room_number ||
      phoneNumber.trim() !== (resident.phone_number || '')
    );
  }, [resident, fullName, roomNumber, phoneNumber]);

  // 1. Fetch the resident details from Supabase
  const loadResident = useCallback(async () => {
    if (!id || !user?.id) {
      if (!id) {
        setErrorMessage('No resident ID provided.');
      }
      setLoading(false);
      return;
    }

    try {
      setErrorMessage(null);
      setLoading(true);

      const { data, error } = await supabase
        .from('residents')
        .select(`
          id,
          property_id,
          profile_id,
          full_name,
          phone_number,
          room_number,
          is_active,
          profile:profiles (
            id,
            full_name
          )
        `)
        .eq('id', id)
        .single();

      if (error) {
        throw new Error(error.message);
      }

      if (!data) {
        throw new Error('Resident record not found.');
      }

      const profileObj = Array.isArray(data.profile)
        ? data.profile[0]
        : data.profile;

      const residentInfo: ResidentData = {
        id: data.id,
        property_id: data.property_id,
        profile_id: data.profile_id,
        full_name: data.full_name,
        phone_number: data.phone_number,
        room_number: data.room_number,
        is_active: data.is_active,
        profile: profileObj || null,
      };

      setResident(residentInfo);
      setFullName(residentInfo.full_name);
      setRoomNumber(residentInfo.room_number);
      setPhoneNumber(residentInfo.phone_number || '');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[EditResident] Error fetching resident:', err);
      setErrorMessage(`Failed to load resident: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [id, user?.id]);

  useEffect(() => {
    if (id && user?.id) {
      loadResident();
    }
  }, [id, user?.id, loadResident]);

  // Back navigation with unsaved changes confirmation
  const handleBack = () => {
    if (hasChanges) {
      Alert.alert(
        'Unsaved Changes',
        'You have unsaved changes. Are you sure you want to discard them?',
        [
          { text: 'Stay Here', style: 'cancel' },
          {
            text: 'Discard & Exit',
            style: 'destructive',
            onPress: () => router.back(),
          },
        ]
      );
    } else {
      router.back();
    }
  };

  // 2. Handle Edit / Update Resident Details
  const handleSave = async () => {
    if (!user?.id) {
      Alert.alert('Authentication Required', 'You must be signed in as an owner.');
      return;
    }

    if (!resident) {
      Alert.alert('Error', 'Resident details not loaded.');
      return;
    }

    const trimmedName = fullName.trim();
    const trimmedRoom = roomNumber.trim();
    const trimmedPhone = phoneNumber.trim();

    if (!trimmedName) {
      setErrorMessage('Full name cannot be empty.');
      return;
    }

    if (!trimmedRoom) {
      setErrorMessage('Room number cannot be empty.');
      return;
    }

    if (trimmedPhone && trimmedPhone.length < 10) {
      setErrorMessage('Phone number should be at least 10 digits.');
      return;
    }

    setSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const updatePayload = {
        full_name: trimmedName,
        room_number: trimmedRoom,
        phone_number: trimmedPhone || null,
      };

      const { data, error } = await supabase
        .from('residents')
        .update(updatePayload)
        .eq('id', resident.id)
        .eq('property_id', resident.property_id)
        .select(
          'id, property_id, profile_id, full_name, room_number, phone_number, is_active'
        )
        .single();

      if (error) {
        throw new Error(error.message);
      }

      setResident({
        ...data,
        profile: resident.profile || null,
      });
      setSuccessMessage('Resident details updated successfully.');
      Alert.alert('Changes Saved', `${data.full_name}'s details have been updated.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[EditResident] Update error:', err);
      setErrorMessage(`Update Failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  // 3. Handle Link Student Account (Owner RPC)
  const handleLinkStudent = async () => {
    if (!user?.id || !resident) return;

    const trimmedEmail = studentEmail.trim().toLowerCase();
    if (!trimmedEmail) {
      setErrorMessage('Please enter the student account email address.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }

    setLinking(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const { data, error } = await supabase.rpc('link_resident_profile', {
        p_resident_id: resident.id,
        p_student_email: trimmedEmail,
      });

      if (error) throw error;
      const res = data as RpcResponse | null;
      if (!res?.success) {
        throw new Error(res?.error || 'Failed to link student account.');
      }

      const successMsg = res.message || 'Student account linked successfully.';
      setSuccessMessage(successMsg);
      setStudentEmail('');
      Alert.alert('Account Linked', successMsg);
      await loadResident();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
    } finally {
      setLinking(false);
    }
  };

  // 4. Handle Unlink Student Account (with confirmation)
  const handleConfirmUnlink = () => {
    if (!resident) return;

    Alert.alert(
      'Unlink Student Account?',
      `Are you sure you want to unlink the student account from ${resident.full_name} (Room ${resident.room_number})?\n\n• The student will no longer have access to this room in their portal.\n• Historical billing and gate logs remain untouched.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unlink Account',
          style: 'destructive',
          onPress: performUnlink,
        },
      ]
    );
  };

  const performUnlink = async () => {
    if (!user?.id || !resident) return;

    setUnlinking(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const { data, error } = await supabase.rpc('unlink_resident_profile', {
        p_resident_id: resident.id,
      });

      if (error) throw error;
      const res = data as RpcResponse | null;
      if (!res?.success) {
        throw new Error(res?.error || 'Failed to unlink student account.');
      }

      const successMsg = res.message || 'Student account unlinked successfully.';
      setSuccessMessage(successMsg);
      Alert.alert('Account Unlinked', successMsg);
      await loadResident();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
    } finally {
      setUnlinking(false);
    }
  };

  // 5. Handle Deactivate Resident (Soft Deactivation: is_active = false)
  const handleConfirmDeactivate = () => {
    if (!resident) return;

    Alert.alert(
      'Deactivate Resident?',
      `Are you sure you want to deactivate ${resident.full_name} (Room ${resident.room_number})?\n\n• They will no longer appear in active attendance lists.\n• All previous payments, receipts, and gate history are strictly preserved.\n• This action does NOT delete any historical data.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Deactivate Resident',
          style: 'destructive',
          onPress: performDeactivation,
        },
      ]
    );
  };

  const performDeactivation = async () => {
    if (!resident || !user?.id) return;

    setDeactivating(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const { data, error } = await supabase
        .from('residents')
        .update({ is_active: false })
        .eq('id', resident.id)
        .eq('property_id', resident.property_id)
        .select('id, full_name, is_active')
        .single();

      if (error) throw error;

      Alert.alert(
        'Resident Deactivated',
        `${resident.full_name} has been moved to inactive status. Historical records are preserved.`,
        [
          {
            text: 'OK',
            onPress: () => router.replace('/(tabs)'),
          },
        ]
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Deactivation Failed: ${msg}`);
    } finally {
      setDeactivating(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <OwnerHeader title="Edit Resident" showBack onBack={handleBack} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={OwnerTheme.colors.primary} />
          <Text style={styles.loadingText}>Loading resident details...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isLinked = Boolean(resident?.profile_id);

  return (
    <SafeAreaView style={styles.safeArea}>
      <OwnerHeader
        title="Edit Resident"
        subtitle={resident ? `${resident.full_name} • Room ${resident.room_number}` : ''}
        showBack
        onBack={handleBack}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled">
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

          {/* Section A: Resident Information */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Resident Information</Text>
              <StatusBadge
                label={resident?.is_active ? 'ACTIVE' : 'INACTIVE'}
                variant={resident?.is_active ? 'success' : 'neutral'}
                size="sm"
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Full Name</Text>
              <TextInput
                style={styles.textInput}
                value={fullName}
                onChangeText={(val) => {
                  setFullName(val);
                  setErrorMessage(null);
                  setSuccessMessage(null);
                }}
                placeholder="Full name"
                placeholderTextColor={OwnerTheme.colors.textMuted}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Room Number</Text>
              <TextInput
                style={styles.textInput}
                value={roomNumber}
                onChangeText={(val) => {
                  setRoomNumber(val);
                  setErrorMessage(null);
                  setSuccessMessage(null);
                }}
                placeholder="Room number"
                placeholderTextColor={OwnerTheme.colors.textMuted}
                autoCapitalize="characters"
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Phone Number</Text>
              <TextInput
                style={styles.textInput}
                value={phoneNumber}
                onChangeText={(val) => {
                  setPhoneNumber(val);
                  setErrorMessage(null);
                  setSuccessMessage(null);
                }}
                placeholder="Phone number"
                placeholderTextColor={OwnerTheme.colors.textMuted}
                keyboardType="phone-pad"
              />
            </View>

            <PrimaryButton
              label="Save Changes"
              onPress={handleSave}
              loading={saving}
              disabled={!hasChanges || saving}
              style={{ marginTop: 6 }}
            />
          </View>

          {/* Section B: Student Portal Access */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Student Portal Access</Text>
              <StatusBadge
                label={isLinked ? 'LINKED' : 'NOT LINKED'}
                variant={isLinked ? 'success' : 'warning'}
                size="sm"
              />
            </View>

            {isLinked ? (
              <View style={styles.linkedInfoBox}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.linkedAccountName}>
                    {resident?.profile?.full_name || 'Linked Student Account'}
                  </Text>
                  <Text style={styles.linkedAccountSub}>
                    Account is active and linked to this resident profile.
                  </Text>
                </View>
                <SecondaryButton
                  label="Unlink"
                  onPress={handleConfirmUnlink}
                  loading={unlinking}
                  style={styles.unlinkBtn}
                  textStyle={{ color: OwnerTheme.colors.danger, fontSize: 13 }}
                />
              </View>
            ) : (
              <View>
                <Text style={styles.portalExplanation}>
                  Link this resident to a registered student account email so
                  they can access their personal PG app.
                </Text>
                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>Student Login Email</Text>
                  <TextInput
                    style={styles.textInput}
                    value={studentEmail}
                    onChangeText={(val) => {
                      setStudentEmail(val);
                      setErrorMessage(null);
                    }}
                    placeholder="student@example.com"
                    placeholderTextColor={OwnerTheme.colors.textMuted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                </View>
                <SecondaryButton
                  label="Link Student Account"
                  onPress={handleLinkStudent}
                  loading={linking}
                />
              </View>
            )}
          </View>

          {/* Section C: Danger Zone */}
          <View style={styles.dangerZoneCard}>
            <View style={styles.dangerHeader}>
              <AlertTriangle size={18} color={OwnerTheme.colors.danger} />
              <Text style={styles.dangerTitle}>Danger Zone</Text>
            </View>
            <Text style={styles.dangerExplanation}>
              Deactivating will remove the resident from the active roster. All
              historical payments, receipts, and attendance logs are strictly
              preserved.
            </Text>
            <DestructiveButton
              label={
                resident?.is_active
                  ? 'Deactivate Resident'
                  : 'Resident Already Inactive'
              }
              onPress={handleConfirmDeactivate}
              loading={deactivating}
              disabled={!resident?.is_active || deactivating}
            />
          </View>

          <View style={{ height: 40 }} />
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
    paddingHorizontal: 20,
    paddingTop: 16,
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
    gap: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: OwnerTheme.colors.textSecondary,
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: OwnerTheme.colors.successLight,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: OwnerTheme.radius.md,
    padding: 12,
  },
  successBannerText: {
    fontSize: 13,
    fontWeight: '500',
    color: OwnerTheme.colors.success,
  },
  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 18,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  fieldGroup: {
    marginBottom: 14,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
    marginBottom: 6,
  },
  textInput: {
    height: 50,
    borderRadius: OwnerTheme.radius.md,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    paddingHorizontal: 14,
    fontSize: 15,
    color: OwnerTheme.colors.textPrimary,
    backgroundColor: '#FFFFFF',
  },
  portalExplanation: {
    fontSize: 13,
    color: OwnerTheme.colors.textSecondary,
    marginBottom: 14,
    lineHeight: 18,
  },
  linkedInfoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: OwnerTheme.radius.md,
    padding: 14,
    gap: 12,
  },
  linkedAccountName: {
    fontSize: 14,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  linkedAccountSub: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 2,
  },
  unlinkBtn: {
    height: 38,
    paddingHorizontal: 14,
    borderColor: '#FECACA',
    backgroundColor: '#FFF5F5',
  },
  dangerZoneCard: {
    backgroundColor: '#FFF5F5',
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: '#FEE2E2',
    padding: 18,
  },
  dangerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  dangerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: OwnerTheme.colors.danger,
  },
  dangerExplanation: {
    fontSize: 13,
    color: OwnerTheme.colors.textSecondary,
    marginBottom: 16,
    lineHeight: 18,
  },
});
