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
import { router, useFocusEffect } from 'expo-router';

import { useAuth } from '@/context/auth-context';
import { supabase } from '@/lib/supabase';

interface PropertyInfo {
  id: string;
  name: string;
}

export default function AddResidentScreen() {
  const { user, profile } = useAuth();

  const [loadingProperty, setLoadingProperty] = useState(true);
  const [property, setProperty] = useState<PropertyInfo | null>(null);

  // Form Fields
  const [fullName, setFullName] = useState('');
  const [roomNumber, setRoomNumber] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');

  // Status & Feedback
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // 1. Fetch authenticated owner's active property
  const loadOwnerProperty = useCallback(async () => {
    try {
      setErrorMessage(null);
      setLoadingProperty(true);

      let query = supabase
        .from('properties')
        .select('id, name')
        .eq('is_active', true);

      if (user?.id) {
        query = query.eq('owner_id', user.id);
      }

      const { data, error } = await query.limit(1);

      if (error) {
        throw new Error(`Failed to load property: ${error.message}`);
      }

      if (!data || data.length === 0) {
        setProperty(null);
        setErrorMessage('No active PG property found for your account. Please set up a property first.');
      } else {
        setProperty(data[0]);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[AddResident] Error loading property:', err);
      setErrorMessage(msg);
    } finally {
      setLoadingProperty(false);
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      loadOwnerProperty();
    }, [loadOwnerProperty])
  );

  const resetForm = () => {
    setFullName('');
    setRoomNumber('');
    setPhoneNumber('');
    setErrorMessage(null);
  };

  // 2. Validate and insert new resident
  const handleSaveResident = async () => {
    if (!user?.id) {
      Alert.alert('Authentication Required', 'You must be signed in as an owner to add residents.');
      return;
    }

    if (!property?.id) {
      Alert.alert('Property Required', 'Cannot add resident without an active PG property.');
      return;
    }

    const trimmedName = fullName.trim();
    const trimmedRoom = roomNumber.trim();
    const trimmedPhone = phoneNumber.trim();

    // Client-side validations
    if (!trimmedName) {
      setErrorMessage('Please enter the resident\'s full name.');
      return;
    }

    if (!trimmedRoom) {
      setErrorMessage('Please enter a room number.');
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
      const payload = {
        property_id: property.id,
        full_name: trimmedName,
        room_number: trimmedRoom,
        phone_number: trimmedPhone || null,
        is_active: true,
      };

      console.log('[AddResident] Inserting resident payload:', payload);

      const { data, error } = await supabase
        .from('residents')
        .insert(payload)
        .select('id, property_id, full_name, room_number, phone_number, is_active')
        .single();

      if (error) {
        console.error('[AddResident] Insert error:', error);
        const errDetail = error.details ? ` (${error.details})` : error.hint ? ` (${error.hint})` : '';
        const fullMessage = `Save Failed [Code: ${error.code || 'UNKNOWN'}]: ${error.message}${errDetail}`;
        Alert.alert('Save Failed', fullMessage);
        setErrorMessage(fullMessage);
        return;
      }

      if (!data || !data.id) {
        console.error('[AddResident] Insert returned no row data:', data);
        const noRowMsg = 'Save Failed: The database did not return the saved resident record.';
        Alert.alert('Save Failed', noRowMsg);
        setErrorMessage(noRowMsg);
        return;
      }

      // Confirmed persistence
      console.log('[AddResident] Resident created successfully:', data);
      const confirmationMsg = `Added ${data.full_name} to Room ${data.room_number} successfully!`;
      setSuccessMessage(confirmationMsg);

      Alert.alert(
        'Resident Added',
        `${data.full_name} has been registered to Room ${data.room_number}.`,
        [
          {
            text: 'Add Another',
            style: 'default',
            onPress: () => resetForm(),
          },
          {
            text: 'View in Gate Attendance',
            style: 'default',
            onPress: () => {
              resetForm();
              router.replace('/student-in-out');
            },
          },
        ]
      );

      resetForm();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[AddResident] Unexpected error:', err);
      Alert.alert('Error', `Could not add resident: ${msg}`);
      setErrorMessage(`Error: ${msg}`);
    } finally {
      setSaving(false);
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
              <Text style={styles.screenTitle}>Add Resident</Text>
              <Text style={styles.screenSubtitle}>Register a new student</Text>
            </View>
          </View>

          {/* Property Context Badge */}
          {loadingProperty ? (
            <View style={styles.propertyLoadingBox}>
              <ActivityIndicator size="small" color="#0284C7" />
              <Text style={styles.propertyLoadingText}>Verifying property...</Text>
            </View>
          ) : property ? (
            <View style={styles.propertyBadge}>
              <Text style={styles.propertyBadgeIcon}>🏢</Text>
              <View style={styles.propertyBadgeDetails}>
                <Text style={styles.propertyBadgeLabel}>Allocating to Property</Text>
                <Text style={styles.propertyBadgeName}>{property.name}</Text>
              </View>
            </View>
          ) : null}

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

          {/* Form Card */}
          <View style={styles.card}>
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
                editable={!saving && !loadingProperty}
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
                editable={!saving && !loadingProperty}
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
                editable={!saving && !loadingProperty}
              />
            </View>

            {/* Submit Button */}
            <Pressable
              accessibilityRole="button"
              disabled={saving || loadingProperty || !property}
              style={({ pressed }) => [
                styles.submitBtn,
                (saving || loadingProperty || !property) && styles.submitBtnDisabled,
                pressed && styles.submitBtnPressed,
              ]}
              onPress={handleSaveResident}>
              {saving ? (
                <View style={styles.savingRow}>
                  <ActivityIndicator size="small" color="#FFFFFF" />
                  <Text style={styles.submitBtnText}>Saving Resident...</Text>
                </View>
              ) : (
                <Text style={styles.submitBtnText}>+ Save Resident</Text>
              )}
            </Pressable>
          </View>

          {/* Information Card */}
          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>💡 Important Note</Text>
            <Text style={styles.infoText}>
              Once registered, the resident will immediately appear in your Gate Attendance directory with an initial status of <Text style={{ fontWeight: '700' }}>UNKNOWN</Text> until their first IN or OUT movement is recorded.
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
    backgroundColor: '#F8FAFC', // Slate 50
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
  propertyLoadingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    marginBottom: 16,
    gap: 8,
  },
  propertyLoadingText: {
    fontSize: 13,
    color: '#0284C7',
    fontWeight: '500',
  },
  propertyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    gap: 10,
  },
  propertyBadgeIcon: {
    fontSize: 20,
  },
  propertyBadgeDetails: {
    flex: 1,
  },
  propertyBadgeLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  propertyBadgeName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0369A1',
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
    backgroundColor: '#0284C7', // Sky 600
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
  savingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoCard: {
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  infoTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 4,
  },
  infoText: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 17,
  },
});

