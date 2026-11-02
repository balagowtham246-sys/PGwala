import React, { useCallback, useState } from 'react';
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

function generateRandomPassword(length = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$';
  let res = '';
  for (let i = 0; i < length; i++) {
    res += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return res;
}

export default function AddResidentScreen() {
  const { user, profile } = useAuth();

  const [loadingProperty, setLoadingProperty] = useState(true);
  const [property, setProperty] = useState<PropertyInfo | null>(null);

  // Form Fields
  const [fullName, setFullName] = useState('');
  const [roomNumber, setRoomNumber] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

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
    setEmail('');
    setTemporaryPassword('');
    setErrorMessage(null);
  };

  const handleGeneratePassword = () => {
    const pw = generateRandomPassword(8);
    setTemporaryPassword(pw);
    setShowPassword(true);
  };

  // 2. Validate and submit unified resident + auth creation via protected Edge Function
  const handleSaveResident = async () => {
    if (!user?.id || profile?.role !== 'owner') {
      Alert.alert('Authorization Required', 'You must be signed in as a PG owner to add residents.');
      return;
    }

    if (!property?.id) {
      Alert.alert('Property Required', 'Cannot add resident without an active PG property.');
      return;
    }

    const trimmedName = fullName.trim();
    const trimmedRoom = roomNumber.trim();
    const trimmedPhone = phoneNumber.trim();
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPassword = temporaryPassword.trim();

    // Client-side validations
    if (!trimmedName) {
      setErrorMessage("Please enter the resident's full name.");
      return;
    }

    if (!trimmedRoom) {
      setErrorMessage('Please enter a room number.');
      return;
    }

    if (!trimmedEmail) {
      setErrorMessage("Please enter the resident's login email.");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }

    if (!trimmedPassword) {
      setErrorMessage('Please provide a temporary password or generate one.');
      return;
    }

    if (trimmedPassword.length < 6) {
      setErrorMessage('Temporary password must be at least 6 characters.');
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
      // 1. Obtain and verify the current authenticated owner session at submission time
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        throw new Error(`Authentication check failed: ${sessionError.message}`);
      }

      let activeSession = sessionData?.session ?? null;

      // Refresh session if missing access_token or expiring within 60 seconds
      const isExpiringSoon =
        !activeSession?.expires_at || activeSession.expires_at * 1000 < Date.now() + 60_000;

      if (!activeSession || isExpiringSoon) {
        const { data: refreshedData, error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError || !refreshedData?.session) {
          throw new Error('Your login session has expired. Please sign out and sign in again.');
        }
        activeSession = refreshedData.session;
      }

      if (!activeSession?.user?.id || !activeSession.access_token) {
        throw new Error('No active authenticated owner session found. Please sign in again.');
      }

      if (activeSession.user.id !== user.id) {
        throw new Error('Session user mismatch detected. Please sign in again as the PG owner.');
      }

      // 2. Invoke the protected create-resident Edge Function (single authoritative path)
      const {
        data: edgeData,
        error: edgeError,
        response: edgeResponse,
      } = await supabase.functions.invoke('create-resident', {
        headers: {
          Authorization: `Bearer ${activeSession.access_token}`,
        },
        body: {
          property_id: property.id,
          full_name: trimmedName,
          room_number: trimmedRoom,
          phone_number: trimmedPhone || undefined,
          email: trimmedEmail,
          temporary_password: trimmedPassword,
        },
      });

      if (edgeError) {
        const httpStatus: number | undefined =
          edgeResponse?.status ?? (edgeError as any)?.context?.status;
        let serverCode: string | undefined;
        let serverMessage: string | undefined;

        const errorContext = (edgeError as any)?.context;
        if (errorContext && typeof errorContext.json === 'function') {
          try {
            const parsed = await errorContext.json();
            serverCode = parsed?.code;
            serverMessage = parsed?.error || parsed?.message;
          } catch {
            // Response body was not JSON
          }
        }

        let diagnosticMessage =
          serverMessage || edgeError.message || 'Resident creation service returned an error.';

        if (httpStatus === 401 || serverCode === 'AUTH_MISSING' || serverCode === 'AUTH_INVALID') {
          diagnosticMessage =
            serverMessage ||
            'Authentication failed (401): Your owner session was rejected. Please sign in again and retry.';
        } else if (httpStatus === 403 || serverCode === 'FORBIDDEN') {
          diagnosticMessage =
            serverMessage ||
            'Authorization denied (403): You do not have permission to manage residents for this PG property.';
        } else if (
          httpStatus === 409 ||
          serverCode === 'DUPLICATE_EMAIL' ||
          serverCode === 'DUPLICATE_RESIDENT'
        ) {
          diagnosticMessage =
            serverMessage ||
            `Conflict (409): A resident or login account with email "${trimmedEmail}" already exists.`;
        } else if (httpStatus === 400 || serverCode === 'VALIDATION_ERROR') {
          diagnosticMessage = serverMessage || 'Invalid resident details provided (400).';
        } else if (httpStatus === 404) {
          diagnosticMessage =
            'Service unavailable (404): The "create-resident" Supabase Edge Function is not deployed yet.';
        } else if (httpStatus && httpStatus >= 500) {
          diagnosticMessage =
            serverMessage ||
            `Server error (${httpStatus}): The resident creation service encountered a configuration or internal error.`;
        }

        console.warn('[AddResident] Edge Function error:', {
          status: httpStatus,
          code: serverCode,
          message: diagnosticMessage,
        });

        throw new Error(diagnosticMessage);
      }

      if (!edgeData || !edgeData.success) {
        throw new Error(edgeData?.error || 'Failed to create resident account.');
      }

      const createdResidentName = edgeData.full_name || trimmedName;
      const createdRoom = edgeData.room_number || trimmedRoom;
      const createdEmail = edgeData.email || trimmedEmail;

      // Success feedback
      const successText = `${createdResidentName} was registered with login ${createdEmail}.`;
      setSuccessMessage(successText);

      Alert.alert(
        'Resident & Auth Created!',
        `Account provisioned successfully for ${createdResidentName} (Room ${createdRoom}).\n\nLogin Email: ${createdEmail}\nTemporary Password: ${trimmedPassword}\n\nPlease share these credentials with the resident.`,
        [
          {
            text: 'Add Another',
            style: 'default',
            onPress: () => resetForm(),
          },
          {
            text: 'Go to Dashboard',
            style: 'default',
            onPress: () => {
              resetForm();
              router.replace('/(tabs)');
            },
          },
        ]
      );

      resetForm();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[AddResident] Creation failed:', msg);
      // Preserve form inputs so the owner can correct any issue and retry
      setErrorMessage(msg);
      Alert.alert('Resident Creation Failed', msg);
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
          keyboardShouldPersistTaps="handled">
          
          {/* Header */}
          <View style={styles.header}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go back"
              style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
              onPress={() => router.back()}>
              <Text style={styles.backButtonText}>← Back</Text>
            </Pressable>
            <Text style={styles.title}>Add New Resident</Text>
            <Text style={styles.subtitle}>
              {property?.name
                ? `Register resident to ${property.name}`
                : 'Register student & create login credentials'}
            </Text>
          </View>

          {/* Feedback Banners */}
          {errorMessage && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerIcon}>⚠️</Text>
              <Text style={styles.errorBannerText}>{errorMessage}</Text>
            </View>
          )}

          {successMessage && (
            <View style={styles.successBanner}>
              <Text style={styles.successBannerIcon}>✓</Text>
              <Text style={styles.successBannerText}>{successMessage}</Text>
            </View>
          )}

          {/* Form Card */}
          <View style={styles.formCard}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>1. Resident & Room Information</Text>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>
                Full Name <Text style={styles.required}>*</Text>
              </Text>
              <TextInput
                style={styles.input}
                value={fullName}
                onChangeText={setFullName}
                placeholder="e.g. Rahul Sharma"
                placeholderTextColor="#94A3B8"
                autoCapitalize="words"
                editable={!saving}
              />
            </View>

            <View style={styles.fieldRow}>
              <View style={[styles.fieldGroup, { flex: 1, marginRight: 8 }]}>
                <Text style={styles.label}>
                  Room Number <Text style={styles.required}>*</Text>
                </Text>
                <TextInput
                  style={styles.input}
                  value={roomNumber}
                  onChangeText={setRoomNumber}
                  placeholder="e.g. 101"
                  placeholderTextColor="#94A3B8"
                  autoCapitalize="characters"
                  editable={!saving}
                />
              </View>

              <View style={[styles.fieldGroup, { flex: 1.4, marginLeft: 8 }]}>
                <Text style={styles.label}>Phone Number</Text>
                <TextInput
                  style={styles.input}
                  value={phoneNumber}
                  onChangeText={setPhoneNumber}
                  placeholder="e.g. 9876543210"
                  placeholderTextColor="#94A3B8"
                  keyboardType="phone-pad"
                  maxLength={15}
                  editable={!saving}
                />
              </View>
            </View>

            <View style={styles.divider} />

            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>2. Supabase Login Account</Text>
            </View>
            <Text style={styles.sectionHint}>
              The student will use this email and password to log in to the student portal.
            </Text>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>
                Resident Login Email <Text style={styles.required}>*</Text>
              </Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="e.g. rahul.sharma@example.com"
                placeholderTextColor="#94A3B8"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!saving}
              />
            </View>

            <View style={styles.fieldGroup}>
              <View style={styles.labelRow}>
                <Text style={styles.label}>
                  Temporary Password <Text style={styles.required}>*</Text>
                </Text>
                <Pressable onPress={handleGeneratePassword} hitSlop={6}>
                  <Text style={styles.generateBtnText}>⚡ Generate</Text>
                </Pressable>
              </View>
              <View style={styles.passwordInputWrap}>
                <TextInput
                  style={[styles.input, { flex: 1, borderWidth: 0, paddingHorizontal: 0 }]}
                  value={temporaryPassword}
                  onChangeText={setTemporaryPassword}
                  placeholder="Min 6 characters"
                  placeholderTextColor="#94A3B8"
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  editable={!saving}
                />
                <Pressable
                  onPress={() => setShowPassword(!showPassword)}
                  style={styles.eyeBtn}>
                  <Text style={styles.eyeBtnText}>{showPassword ? 'Hide' : 'Show'}</Text>
                </Pressable>
              </View>
            </View>

            {/* Submit Action */}
            <Pressable
              style={({ pressed }) => [
                styles.submitButton,
                pressed && styles.buttonPressed,
                (saving || loadingProperty) && styles.buttonDisabled,
              ]}
              disabled={saving || loadingProperty}
              onPress={handleSaveResident}>
              {saving ? (
                <View style={styles.buttonLoadingRow}>
                  <ActivityIndicator size="small" color="#FFFFFF" />
                  <Text style={styles.submitButtonText}>Creating Account & Profile...</Text>
                </View>
              ) : (
                <Text style={styles.submitButtonText}>Create Resident & Login Account</Text>
              )}
            </Pressable>
          </View>
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
    padding: 16,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 16,
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#E2E8F0',
    borderRadius: 6,
    marginBottom: 10,
  },
  backButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
  },
  subtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    padding: 12,
    borderRadius: 8,
    marginBottom: 14,
    gap: 8,
  },
  errorBannerIcon: {
    fontSize: 16,
  },
  errorBannerText: {
    flex: 1,
    fontSize: 13,
    color: '#B91C1C',
    fontWeight: '600',
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#6EE7B7',
    padding: 12,
    borderRadius: 8,
    marginBottom: 14,
    gap: 8,
  },
  successBannerIcon: {
    fontSize: 16,
    color: '#059669',
    fontWeight: '800',
  },
  successBannerText: {
    flex: 1,
    fontSize: 13,
    color: '#047857',
    fontWeight: '600',
  },
  formCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
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
  sectionHeaderRow: {
    marginBottom: 6,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  sectionHint: {
    fontSize: 11,
    color: '#64748B',
    marginBottom: 12,
  },
  fieldGroup: {
    marginBottom: 14,
  },
  fieldRow: {
    flexDirection: 'row',
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 6,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  generateBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0284C7',
  },
  required: {
    color: '#DC2626',
  },
  input: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0F172A',
  },
  passwordInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  eyeBtn: {
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  eyeBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0284C7',
  },
  divider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 14,
  },
  submitButton: {
    backgroundColor: '#0284C7',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  buttonLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  pressed: {
    opacity: 0.7,
  },
});
