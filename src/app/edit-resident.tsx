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

import { useAuth } from '@/context/auth-context';
import { supabase } from '@/lib/supabase';

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

  // 1. Fetch the resident details from Supabase
  const loadResident = useCallback(async () => {
    if (!id) {
      setErrorMessage('No resident ID provided.');
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
  }, [id]);

  useEffect(() => {
    loadResident();
  }, [loadResident]);

  // 2. Handle Edit / Update Resident (full_name, room_number, phone_number)
  // Strictly preserves property_id, profile_id, and is_active untouched.
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
      // Allowed column update: full_name, phone_number, room_number
      const updatePayload = {
        full_name: trimmedName,
        room_number: trimmedRoom,
        phone_number: trimmedPhone || null,
      };

      console.log('[EditResident] Updating resident payload:', {
        id: resident.id,
        payload: updatePayload,
      });

      const { data, error } = await supabase
        .from('residents')
        .update(updatePayload)
        .eq('id', resident.id)
        .eq('property_id', resident.property_id) // Defense-in-depth scope check
        .select('id, property_id, profile_id, full_name, room_number, phone_number, is_active')
        .single();

      if (error) {
        console.error('[EditResident] Update error:', error);
        const errDetail = error.details ? ` (${error.details})` : error.hint ? ` (${error.hint})` : '';
        const fullMessage = `Update Failed [Code: ${error.code || 'UNKNOWN'}]: ${error.message}${errDetail}`;
        Alert.alert('Update Failed', fullMessage);
        setErrorMessage(fullMessage);
        return;
      }

      if (!data || !data.id) {
        console.error('[EditResident] Update returned no row data:', data);
        const noRowMsg = 'Update Failed: The database did not return the updated resident record.';
        Alert.alert('Update Failed', noRowMsg);
        setErrorMessage(noRowMsg);
        return;
      }

      // Update confirmed
      console.log('[EditResident] Resident updated successfully:', data);
      setResident({
        ...data,
        profile: resident.profile || null,
      });
      setSuccessMessage('Resident details updated successfully!');

      Alert.alert('Changes Saved', `${data.full_name}'s details have been updated.`, [
        {
          text: 'Done',
          onPress: () => router.back(),
        },
        {
          text: 'Stay on Screen',
          style: 'cancel',
        },
      ]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[EditResident] Unexpected error during update:', err);
      Alert.alert('Update Failed', `Could not update resident: ${msg}`);
      setErrorMessage(`Update Failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  // 3. Handle Link Student Account (Owner-Only RPC Call)
  // Invokes public.link_resident_profile(p_resident_id, p_student_email).
  // Never updates residents.profile_id directly from the client.
  const handleLinkStudent = async () => {
    if (!user?.id) {
      Alert.alert('Authentication Required', 'You must be signed in as an owner.');
      return;
    }

    if (!resident) {
      Alert.alert('Error', 'Resident details not loaded.');
      return;
    }

    const trimmedEmail = studentEmail.trim();
    if (!trimmedEmail) {
      setErrorMessage('Please enter the student account email address.');
      return;
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      setErrorMessage('Please enter a valid email address (e.g. student@example.com).');
      return;
    }

    setLinking(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      console.log('[EditResident] Calling link_resident_profile RPC:', {
        p_resident_id: resident.id,
        p_student_email: trimmedEmail,
      });

      const { data, error } = await supabase.rpc('link_resident_profile', {
        p_resident_id: resident.id,
        p_student_email: trimmedEmail,
      });

      if (error) {
        console.error('[EditResident] RPC link error:', error);
        const errMsg = error.message || 'Failed to connect to the database to link account.';
        Alert.alert('Linking Failed', errMsg);
        setErrorMessage(errMsg);
        return;
      }

      const res = data as RpcResponse | null;
      if (!res) {
        const errMsg = 'Linking Failed: No response received from server.';
        Alert.alert('Linking Failed', errMsg);
        setErrorMessage(errMsg);
        return;
      }

      if (!res.success) {
        const errMsg = res.error || 'Failed to link student account.';
        Alert.alert('Linking Failed', errMsg);
        setErrorMessage(errMsg);
        return;
      }

      // Confirmed success
      const successMsg = res.message || 'Student account linked successfully!';
      setSuccessMessage(successMsg);
      setStudentEmail('');
      Alert.alert('Account Linked', successMsg);

      // Reload resident data to update profile_id and joined profile
      await loadResident();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[EditResident] Unexpected error during link:', err);
      Alert.alert('Linking Failed', msg);
      setErrorMessage(`Linking Failed: ${msg}`);
    } finally {
      setLinking(false);
    }
  };

  // 4. Handle Unlink Student Account (Owner-Only RPC Call with confirmation)
  // Invokes public.unlink_resident_profile(p_resident_id).
  const handleConfirmUnlink = () => {
    if (!resident) return;

    Alert.alert(
      'Unlink Student Account?',
      `Are you sure you want to unlink the student account from ${resident.full_name} (Room ${resident.room_number})?\n\n• The student will no longer have access to this room or published menus on their portal.\n• You can link another account at any time.`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
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
      console.log('[EditResident] Calling unlink_resident_profile RPC:', {
        p_resident_id: resident.id,
      });

      const { data, error } = await supabase.rpc('unlink_resident_profile', {
        p_resident_id: resident.id,
      });

      if (error) {
        console.error('[EditResident] RPC unlink error:', error);
        const errMsg = error.message || 'Failed to unlink account.';
        Alert.alert('Unlink Failed', errMsg);
        setErrorMessage(errMsg);
        return;
      }

      const res = data as RpcResponse | null;
      if (!res) {
        const errMsg = 'Unlink Failed: No response received from server.';
        Alert.alert('Unlink Failed', errMsg);
        setErrorMessage(errMsg);
        return;
      }

      if (!res.success) {
        const errMsg = res.error || 'Failed to unlink student account.';
        Alert.alert('Unlink Failed', errMsg);
        setErrorMessage(errMsg);
        return;
      }

      const successMsg = res.message || 'Student account unlinked successfully.';
      setSuccessMessage(successMsg);
      Alert.alert('Account Unlinked', successMsg);

      // Reload resident data to update profile_id
      await loadResident();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[EditResident] Unexpected error during unlink:', err);
      Alert.alert('Unlink Failed', msg);
      setErrorMessage(`Unlink Failed: ${msg}`);
    } finally {
      setUnlinking(false);
    }
  };

  // 5. Handle Deactivate Resident (Soft Deactivation: is_active = false)
  // Preserves resident record and historical movement_logs. Never deletes records.
  const handleConfirmDeactivate = () => {
    if (!resident) return;

    Alert.alert(
      'Deactivate Resident?',
      `Are you sure you want to deactivate ${resident.full_name} (Room ${resident.room_number})?\n\n• They will no longer appear in active attendance lists.\n• No new IN/OUT movements can be recorded for them.\n• Historical gate records will be preserved.`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Deactivate',
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
      console.log('[EditResident] Deactivating resident:', resident.id);

      // Only update is_active to false
      const { data, error } = await supabase
        .from('residents')
        .update({ is_active: false })
        .eq('id', resident.id)
        .eq('property_id', resident.property_id)
        .select('id, full_name, is_active')
        .single();

      if (error) {
        console.error('[EditResident] Deactivation error:', error);
        const errDetail = error.details ? ` (${error.details})` : error.hint ? ` (${error.hint})` : '';
        const fullMessage = `Deactivation Failed [Code: ${error.code || 'UNKNOWN'}]: ${error.message}${errDetail}`;
        Alert.alert('Deactivation Failed', fullMessage);
        setErrorMessage(fullMessage);
        return;
      }

      if (!data || data.is_active !== false) {
        console.error('[EditResident] Deactivation returned unexpected status:', data);
        const msg = 'Deactivation Failed: Database did not confirm inactive status.';
        Alert.alert('Deactivation Failed', msg);
        setErrorMessage(msg);
        return;
      }

      console.log('[EditResident] Resident deactivated successfully:', data);
      setResident((prev) => (prev ? { ...prev, is_active: false } : null));

      Alert.alert(
        'Resident Deactivated',
        `${data.full_name} has been marked as inactive. They have been removed from active attendance tracking while all previous logs are preserved.`,
        [
          {
            text: 'OK',
            onPress: () => router.back(),
          },
        ]
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[EditResident] Unexpected error during deactivation:', err);
      Alert.alert('Deactivation Failed', `Could not deactivate resident: ${msg}`);
      setErrorMessage(`Deactivation Failed: ${msg}`);
    } finally {
      setDeactivating(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.keyboardContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled">

          {/* Top Bar with Back Button */}
          <View style={styles.topBar}>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.backButton,
                pressed && styles.backButtonPressed,
              ]}
              onPress={() => router.back()}>
              <Text style={styles.backButtonText}>‹ Back</Text>
            </Pressable>
            <View style={styles.titleWrapper}>
              <Text style={styles.screenTitle}>Edit Resident</Text>
              <Text style={styles.screenSubtitle}>Update resident details</Text>
            </View>
          </View>

          {/* Loading Indicator */}
          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="small" color="#0284C7" />
              <Text style={styles.loadingText}>Loading resident details...</Text>
            </View>
          ) : !resident ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorIcon}>⚠️</Text>
              <Text style={styles.errorText}>
                {errorMessage || 'Resident record could not be found.'}
              </Text>
            </View>
          ) : (
            <>
              {/* Inactive Status Banner if already deactivated */}
              {!resident.is_active && (
                <View style={styles.inactiveStatusBanner}>
                  <Text style={styles.inactiveStatusIcon}>ℹ️</Text>
                  <View style={styles.inactiveStatusTextWrapper}>
                    <Text style={styles.inactiveStatusTitle}>Deactivated Resident</Text>
                    <Text style={styles.inactiveStatusSubtitle}>
                      This resident is inactive and does not appear in active gate attendance.
                    </Text>
                  </View>
                </View>
              )}

              {/* Success Banner */}
              {successMessage && (
                <View style={styles.successBanner}>
                  <Text style={styles.successIcon}>✓</Text>
                  <Text style={styles.successText}>{successMessage}</Text>
                  <Pressable hitSlop={8} onPress={() => setSuccessMessage(null)}>
                    <Text style={styles.bannerDismiss}>✕</Text>
                  </Pressable>
                </View>
              )}

              {/* Error Banner */}
              {errorMessage && (
                <View style={styles.errorBanner}>
                  <Text style={styles.errorIcon}>⚠️</Text>
                  <Text style={styles.errorText}>{errorMessage}</Text>
                  <Pressable hitSlop={8} onPress={() => setErrorMessage(null)}>
                    <Text style={styles.bannerDismiss}>✕</Text>
                  </Pressable>
                </View>
              )}

              {/* Edit Details Card */}
              <View style={styles.card}>
                <Text style={styles.cardHeaderTitle}>Resident Information</Text>

                {/* Full Name */}
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>
                    Full Name <Text style={styles.requiredAsterisk}>*</Text>
                  </Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. Rahul Sharma"
                    placeholderTextColor="#94A3B8"
                    value={fullName}
                    onChangeText={(val) => {
                      setFullName(val);
                      if (errorMessage) setErrorMessage(null);
                    }}
                    autoCapitalize="words"
                    autoCorrect={false}
                    editable={!saving && !deactivating}
                  />
                </View>

                {/* Room Number */}
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>
                    Room Number <Text style={styles.requiredAsterisk}>*</Text>
                  </Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. 101, A-204"
                    placeholderTextColor="#94A3B8"
                    value={roomNumber}
                    onChangeText={(val) => {
                      setRoomNumber(val);
                      if (errorMessage) setErrorMessage(null);
                    }}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    editable={!saving && !deactivating}
                  />
                </View>

                {/* Phone Number */}
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>
                    Phone Number <Text style={styles.optionalText}>(Optional)</Text>
                  </Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. 9876543210"
                    placeholderTextColor="#94A3B8"
                    value={phoneNumber}
                    onChangeText={(val) => {
                      setPhoneNumber(val);
                      if (errorMessage) setErrorMessage(null);
                    }}
                    keyboardType="phone-pad"
                    maxLength={15}
                    editable={!saving && !deactivating}
                  />
                </View>

                {/* Save Changes Button */}
                <Pressable
                  accessibilityRole="button"
                  disabled={saving || deactivating || linking || unlinking}
                  style={({ pressed }) => [
                    styles.submitBtn,
                    (saving || deactivating || linking || unlinking) && styles.submitBtnDisabled,
                    pressed && styles.submitBtnPressed,
                  ]}
                  onPress={handleSave}>
                  {saving ? (
                    <View style={styles.btnRow}>
                      <ActivityIndicator size="small" color="#FFFFFF" />
                      <Text style={styles.submitBtnText}>Saving Changes...</Text>
                    </View>
                  ) : (
                    <Text style={styles.submitBtnText}>Save Changes</Text>
                  )}
                </Pressable>
              </View>

              {/* Student Portal Access Card (Owner-Only Account Linking) */}
              <View style={styles.card}>
                <View style={styles.cardHeaderRow}>
                  <Text style={styles.cardHeaderTitle}>Student Portal Access</Text>
                  <View
                    style={[
                      styles.linkStatusBadge,
                      resident.profile_id
                        ? styles.linkStatusBadgeLinked
                        : styles.linkStatusBadgeUnlinked,
                    ]}>
                    <View
                      style={[
                        styles.linkStatusDot,
                        {
                          backgroundColor: resident.profile_id ? '#16A34A' : '#94A3B8',
                        },
                      ]}
                    />
                    <Text
                      style={[
                        styles.linkStatusText,
                        {
                          color: resident.profile_id ? '#15803D' : '#64748B',
                        },
                      ]}>
                      {resident.profile_id ? 'App Linked' : 'Not Linked'}
                    </Text>
                  </View>
                </View>

                {resident.profile_id ? (
                  /* State A: Currently Linked */
                  <View style={styles.linkedBox}>
                    <View style={styles.linkedInfoRow}>
                      <Text style={styles.linkedIcon}>📱</Text>
                      <View style={styles.linkedTextWrap}>
                        <Text style={styles.linkedStudentName}>
                          {resident.profile?.full_name || 'Linked Student Account'}
                        </Text>
                        <Text style={styles.linkedDesc}>
                          This student can sign in to the PGwala Student Portal to view room allocation, check gate status, and view daily food menus.
                        </Text>
                      </View>
                    </View>

                    <Pressable
                      accessibilityRole="button"
                      disabled={saving || deactivating || unlinking || linking}
                      style={({ pressed }) => [
                        styles.unlinkBtn,
                        (saving || deactivating || unlinking || linking) && styles.unlinkBtnDisabled,
                        pressed && styles.unlinkBtnPressed,
                      ]}
                      onPress={handleConfirmUnlink}>
                      {unlinking ? (
                        <View style={styles.btnRow}>
                          <ActivityIndicator size="small" color="#DC2626" />
                          <Text style={styles.unlinkBtnText}>Unlinking Account...</Text>
                        </View>
                      ) : (
                        <Text style={styles.unlinkBtnText}>Unlink Student Account</Text>
                      )}
                    </Pressable>
                  </View>
                ) : !resident.is_active ? (
                  /* State B: Inactive resident */
                  <Text style={styles.unlinkedHelpText}>
                    Student accounts cannot be linked to deactivated resident records.
                  </Text>
                ) : (
                  /* State C: Not Linked (Form to Link) */
                  <View>
                    <Text style={styles.unlinkedHelpText}>
                      Link this room to the student's registered PGwala account so they can view accommodation details in their student app.
                    </Text>

                    <View style={styles.inputGroup}>
                      <Text style={styles.label}>
                        Student Account Email <Text style={styles.requiredAsterisk}>*</Text>
                      </Text>
                      <TextInput
                        style={styles.input}
                        placeholder="student@example.com"
                        placeholderTextColor="#94A3B8"
                        value={studentEmail}
                        onChangeText={(val) => {
                          setStudentEmail(val);
                          if (errorMessage) setErrorMessage(null);
                        }}
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="email-address"
                        editable={!saving && !deactivating && !linking && !unlinking}
                      />
                    </View>

                    <Pressable
                      accessibilityRole="button"
                      disabled={saving || deactivating || linking || unlinking}
                      style={({ pressed }) => [
                        styles.linkBtn,
                        (saving || deactivating || linking || unlinking) && styles.linkBtnDisabled,
                        pressed && styles.linkBtnPressed,
                      ]}
                      onPress={handleLinkStudent}>
                      {linking ? (
                        <View style={styles.btnRow}>
                          <ActivityIndicator size="small" color="#FFFFFF" />
                          <Text style={styles.linkBtnText}>Linking Account...</Text>
                        </View>
                      ) : (
                        <Text style={styles.linkBtnText}>Link Student Account</Text>
                      )}
                    </Pressable>
                  </View>
                )}
              </View>

              {/* Danger Zone: Deactivate Resident */}
              {resident.is_active && (
                <View style={styles.dangerCard}>
                  <Text style={styles.dangerTitle}>Deactivate Resident</Text>
                  <Text style={styles.dangerSubtitle}>
                    Mark this student as moved out. They will no longer appear in active attendance lists, but their historical movement records are safely preserved.
                  </Text>

                  <Pressable
                    accessibilityRole="button"
                    disabled={saving || deactivating}
                    style={({ pressed }) => [
                      styles.deactivateBtn,
                      (saving || deactivating) && styles.deactivateBtnDisabled,
                      pressed && styles.deactivateBtnPressed,
                    ]}
                    onPress={handleConfirmDeactivate}>
                    {deactivating ? (
                      <View style={styles.btnRow}>
                        <ActivityIndicator size="small" color="#DC2626" />
                        <Text style={styles.deactivateBtnText}>Deactivating...</Text>
                      </View>
                    ) : (
                      <Text style={styles.deactivateBtnText}>Deactivate Resident</Text>
                    )}
                  </Pressable>
                </View>
              )}
            </>
          )}
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
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 40,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  backButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginRight: 12,
    minHeight: 40,
    justifyContent: 'center',
  },
  backButtonPressed: {
    backgroundColor: '#F1F5F9',
  },
  backButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  titleWrapper: {
    flex: 1,
  },
  screenTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  screenSubtitle: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
    marginTop: 1,
  },
  loadingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 24,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    justifyContent: 'center',
    gap: 10,
    marginTop: 20,
  },
  loadingText: {
    fontSize: 14,
    color: '#64748B',
    fontWeight: '500',
  },
  inactiveStatusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    gap: 10,
  },
  inactiveStatusIcon: {
    fontSize: 18,
  },
  inactiveStatusTextWrapper: {
    flex: 1,
  },
  inactiveStatusTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  inactiveStatusSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
  },
  successIcon: {
    fontSize: 14,
    color: '#059669',
    fontWeight: '800',
    marginRight: 8,
  },
  successText: {
    flex: 1,
    fontSize: 13,
    color: '#065F46',
    fontWeight: '600',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  errorIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: '#DC2626',
    fontWeight: '500',
  },
  bannerDismiss: {
    fontSize: 14,
    color: '#64748B',
    fontWeight: '700',
    paddingHorizontal: 4,
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
  cardHeaderTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 16,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  linkStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    gap: 6,
  },
  linkStatusBadgeLinked: {
    backgroundColor: '#DCFCE7',
  },
  linkStatusBadgeUnlinked: {
    backgroundColor: '#F1F5F9',
  },
  linkStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  linkStatusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  linkedBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  linkedInfoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
  },
  linkedIcon: {
    fontSize: 24,
    marginTop: 2,
  },
  linkedTextWrap: {
    flex: 1,
  },
  linkedStudentName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  linkedDesc: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 18,
    marginTop: 2,
  },
  unlinkBtn: {
    borderWidth: 1,
    borderColor: '#FCA5A5',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  unlinkBtnDisabled: {
    opacity: 0.6,
  },
  unlinkBtnPressed: {
    backgroundColor: '#FEF2F2',
  },
  unlinkBtnText: {
    color: '#DC2626',
    fontSize: 13,
    fontWeight: '700',
  },
  unlinkedHelpText: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 18,
    marginBottom: 14,
  },
  linkBtn: {
    backgroundColor: '#0284C7',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    minHeight: 46,
  },
  linkBtnDisabled: {
    backgroundColor: '#94A3B8',
  },
  linkBtnPressed: {
    backgroundColor: '#0369A1',
  },
  linkBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
  },
  requiredAsterisk: {
    color: '#EF4444',
  },
  optionalText: {
    fontSize: 12,
    fontWeight: '400',
    color: '#94A3B8',
  },
  input: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: '#0F172A',
    minHeight: 46,
  },
  submitBtn: {
    backgroundColor: '#0284C7',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    minHeight: 48,
  },
  submitBtnDisabled: {
    backgroundColor: '#94A3B8',
  },
  submitBtnPressed: {
    backgroundColor: '#0369A1',
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  btnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dangerCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: '#FECACA',
    borderLeftWidth: 4,
    borderLeftColor: '#EF4444',
  },
  dangerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#B91C1C',
  },
  dangerSubtitle: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 18,
    marginTop: 4,
    marginBottom: 14,
  },
  deactivateBtn: {
    borderWidth: 1,
    borderColor: '#FCA5A5',
    backgroundColor: '#FEF2F2',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  deactivateBtnDisabled: {
    opacity: 0.6,
  },
  deactivateBtnPressed: {
    backgroundColor: '#FEE2E2',
  },
  deactivateBtnText: {
    color: '#DC2626',
    fontSize: 14,
    fontWeight: '700',
  },
});
