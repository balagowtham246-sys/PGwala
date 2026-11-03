import React, { useCallback, useState } from 'react';
import {
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
import {
  Eye,
  EyeOff,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useProperty } from '@/context/property-context';
import { supabase } from '@/lib/supabase';
import {
  OwnerHeader,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  ErrorState,
} from '@/components/ui/owner';

interface PropertyInfo {
  id: string;
  name: string;
}

function generateRandomPassword(length = 8): string {
  const chars =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$';
  let res = '';
  for (let i = 0; i < length; i++) {
    res += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return res;
}

export default function AddResidentScreen() {
  const { user, profile } = useAuth();
  const { selectedProperty } = useProperty();

  const [loadingProperty, setLoadingProperty] = useState(true);
  const [property, setProperty] = useState<PropertyInfo | null>(null);

  // Form Step: 1 = Resident Details, 2 = Account Setup, 3 = Success Screen
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);

  // Form Fields
  const [fullName, setFullName] = useState('');
  const [roomNumber, setRoomNumber] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Created Resident summary for Step 3
  const [createdSummary, setCreatedSummary] = useState<{
    id: string;
    fullName: string;
    roomNumber: string;
    email: string;
  } | null>(null);

  // Status & Feedback
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 1. Fetch authenticated owner's active property
  const loadOwnerProperty = useCallback(async () => {
    try {
      setErrorMessage(null);
      setLoadingProperty(true);

      if (selectedProperty) {
        setProperty({ id: selectedProperty.id, name: selectedProperty.name });
        return;
      }

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
        setErrorMessage(
          'No active PG property found for your account. Please set up a property first.'
        );
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
  }, [user?.id, selectedProperty]);

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
    setShowPassword(false);
    setCreatedSummary(null);
    setErrorMessage(null);
    setCurrentStep(1);
  };

  const handleGeneratePassword = () => {
    const pw = generateRandomPassword(8);
    setTemporaryPassword(pw);
    setShowPassword(true);
  };

  // Validate Step 1 before moving to Step 2
  const handleProceedToStep2 = () => {
    const trimmedName = fullName.trim();
    const trimmedRoom = roomNumber.trim();
    const trimmedPhone = phoneNumber.trim();

    if (!trimmedName) {
      setErrorMessage("Please enter the resident's full name.");
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

    setErrorMessage(null);
    setCurrentStep(2);
  };

  // Validate and submit unified resident + auth creation via Edge Function
  const handleSaveResident = async () => {
    if (!user?.id || profile?.role !== 'owner') {
      Alert.alert(
        'Authorization Required',
        'You must be signed in as a PG owner to add residents.'
      );
      return;
    }

    if (!property?.id) {
      Alert.alert(
        'Property Required',
        'Cannot add resident without an active PG property.'
      );
      return;
    }

    const trimmedName = fullName.trim();
    const trimmedRoom = roomNumber.trim();
    const trimmedPhone = phoneNumber.trim();
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPassword = temporaryPassword.trim();

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
      setErrorMessage('Please provide a temporary password or tap generate.');
      return;
    }

    if (trimmedPassword.length < 6) {
      setErrorMessage('Temporary password must be at least 6 characters.');
      return;
    }

    setSaving(true);
    setErrorMessage(null);

    try {
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();
      if (sessionError) {
        throw new Error(
          `Authentication check failed: ${sessionError.message}`
        );
      }

      let activeSession = sessionData?.session ?? null;
      const isExpiringSoon =
        !activeSession?.expires_at ||
        activeSession.expires_at * 1000 < Date.now() + 60_000;

      if (!activeSession || isExpiringSoon) {
        const { data: refreshedData, error: refreshError } =
          await supabase.auth.refreshSession();
        if (refreshError || !refreshedData?.session) {
          throw new Error(
            'Your login session has expired. Please sign out and sign in again.'
          );
        }
        activeSession = refreshedData.session;
      }

      if (!activeSession?.user?.id || !activeSession.access_token) {
        throw new Error(
          'No active authenticated owner session found. Please sign in again.'
        );
      }

      // Invoke the protected create-resident Edge Function
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
        let serverMessage: string | undefined;

        if (httpStatus === 409) {
          serverMessage = `A resident or account with email "${trimmedEmail}" already exists.`;
        } else if (httpStatus === 400) {
          serverMessage = 'Invalid resident details provided (400).';
        } else if (httpStatus === 404) {
          serverMessage =
            'The resident setup service is currently unavailable. Please contact support.';
        } else {
          serverMessage = edgeError.message;
        }

        throw new Error(serverMessage || 'Failed to create resident.');
      }

      if (!edgeData || !edgeData.success) {
        throw new Error(
          edgeData?.error || 'Failed to create resident account.'
        );
      }

      // Save created summary for confirmation screen
      setCreatedSummary({
        id: edgeData.resident_id || edgeData.id || '',
        fullName: edgeData.full_name || trimmedName,
        roomNumber: edgeData.room_number || trimmedRoom,
        email: edgeData.email || trimmedEmail,
      });

      setCurrentStep(3);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <OwnerHeader
        title="Add Resident"
        subtitle={property?.name || 'Property'}
        showBack
        onBack={() => {
          if (currentStep === 2) {
            setCurrentStep(1);
          } else {
            router.back();
          }
        }}
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

          {/* Step 3: Success Screen */}
          {currentStep === 3 && createdSummary ? (
            <View style={styles.successCard}>
              <View style={styles.successIconWrap}>
                <CheckCircle2 size={44} color={OwnerTheme.colors.success} />
              </View>
              <Text style={styles.successHeading}>Resident Added</Text>
              <Text style={styles.successSubheading}>
                The resident profile and login credentials have been created
                successfully.
              </Text>

              <View style={styles.summaryDetailsBox}>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Name</Text>
                  <Text style={styles.summaryValue}>
                    {createdSummary.fullName}
                  </Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Room</Text>
                  <Text style={styles.summaryValue}>
                    Room {createdSummary.roomNumber}
                  </Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Login Email</Text>
                  <Text style={styles.summaryValue}>
                    {createdSummary.email}
                  </Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Account Status</Text>
                  <StatusBadge label="ACTIVE" variant="success" size="sm" />
                </View>
              </View>

              <View style={styles.successActions}>
                <PrimaryButton
                  label="View Resident"
                  onPress={() => {
                    if (createdSummary.id) {
                      router.replace({
                        pathname: '/edit-resident',
                        params: { id: createdSummary.id },
                      });
                    } else {
                      router.replace('/(tabs)');
                    }
                  }}
                  style={{ marginBottom: 10 }}
                />
                <SecondaryButton
                  label="Add Another Resident"
                  onPress={resetForm}
                />
              </View>
            </View>
          ) : (
            <>
              {/* Step Progress Indicator */}
              <View style={styles.progressRow}>
                <View
                  style={[
                    styles.progressStep,
                    styles.progressStepActive,
                  ]}>
                  <Text style={styles.progressStepTextActive}>1</Text>
                  <Text style={styles.progressStepLabelActive}>
                    Resident Info
                  </Text>
                </View>
                <View style={styles.progressDivider} />
                <View
                  style={[
                    styles.progressStep,
                    currentStep === 2 && styles.progressStepActive,
                  ]}>
                  <Text
                    style={[
                      styles.progressStepText,
                      currentStep === 2 && styles.progressStepTextActive,
                    ]}>
                    2
                  </Text>
                  <Text
                    style={[
                      styles.progressStepLabel,
                      currentStep === 2 && styles.progressStepLabelActive,
                    ]}>
                    Account Setup
                  </Text>
                </View>
              </View>

              {/* Step 1: Resident Details */}
              {currentStep === 1 ? (
                <View style={styles.formCard}>
                  <Text style={styles.formSectionTitle}>
                    Personal & Room Details
                  </Text>

                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>Full Name *</Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder="e.g. Arun Kumar"
                      placeholderTextColor={OwnerTheme.colors.textMuted}
                      value={fullName}
                      onChangeText={(val) => {
                        setFullName(val);
                        if (errorMessage) setErrorMessage(null);
                      }}
                      autoCapitalize="words"
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>Room Number *</Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder="e.g. 101 or A"
                      placeholderTextColor={OwnerTheme.colors.textMuted}
                      value={roomNumber}
                      onChangeText={(val) => {
                        setRoomNumber(val);
                        if (errorMessage) setErrorMessage(null);
                      }}
                      autoCapitalize="characters"
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>Phone Number (Optional)</Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder="e.g. 9876543210"
                      placeholderTextColor={OwnerTheme.colors.textMuted}
                      value={phoneNumber}
                      onChangeText={(val) => {
                        setPhoneNumber(val);
                        if (errorMessage) setErrorMessage(null);
                      }}
                      keyboardType="phone-pad"
                    />
                  </View>

                  <PrimaryButton
                    label="Next: Account Setup"
                    onPress={handleProceedToStep2}
                    style={{ marginTop: 12 }}
                  />
                </View>
              ) : (
                /* Step 2: Account Setup */
                <View style={styles.formCard}>
                  <Text style={styles.formSectionTitle}>
                    Student Portal Login
                  </Text>
                  <Text style={styles.formSectionSubtitle}>
                    Provide the email and temporary password for the resident to
                    log into their PG app.
                  </Text>

                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>Resident Login Email *</Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder="resident@example.com"
                      placeholderTextColor={OwnerTheme.colors.textMuted}
                      value={email}
                      onChangeText={(val) => {
                        setEmail(val);
                        if (errorMessage) setErrorMessage(null);
                      }}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <View style={styles.labelRow}>
                      <Text style={styles.label}>Temporary Password *</Text>
                      <Pressable
                        hitSlop={8}
                        onPress={handleGeneratePassword}
                        style={styles.generateBtn}>
                        <RefreshCw
                          size={12}
                          color={OwnerTheme.colors.primary}
                        />
                        <Text style={styles.generateBtnText}>
                          Auto-Generate
                        </Text>
                      </Pressable>
                    </View>
                    <View style={styles.passwordInputWrap}>
                      <TextInput
                        style={[styles.textInput, { flex: 1, borderWidth: 0 }]}
                        placeholder="At least 6 characters"
                        placeholderTextColor={OwnerTheme.colors.textMuted}
                        value={temporaryPassword}
                        onChangeText={(val) => {
                          setTemporaryPassword(val);
                          if (errorMessage) setErrorMessage(null);
                        }}
                        secureTextEntry={!showPassword}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      <Pressable
                        hitSlop={8}
                        style={styles.eyeBtn}
                        onPress={() => setShowPassword(!showPassword)}>
                        {showPassword ? (
                          <EyeOff
                            size={18}
                            color={OwnerTheme.colors.textSecondary}
                          />
                        ) : (
                          <Eye
                            size={18}
                            color={OwnerTheme.colors.textSecondary}
                          />
                        )}
                      </Pressable>
                    </View>
                  </View>

                  <View style={styles.step2Actions}>
                    <SecondaryButton
                      label="Back"
                      onPress={() => setCurrentStep(1)}
                      style={{ flex: 1, marginRight: 8 }}
                    />
                    <PrimaryButton
                      label="Create Resident"
                      onPress={handleSaveResident}
                      loading={saving}
                      style={{ flex: 2 }}
                    />
                  </View>
                </View>
              )}
            </>
          )}

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
    maxWidth: 600,
    width: '100%',
    alignSelf: 'center',
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  progressStep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  progressStepActive: {},
  progressStepText: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#E2E8F0',
    color: OwnerTheme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 24,
  },
  progressStepTextActive: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: OwnerTheme.colors.primary,
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 24,
  },
  progressStepLabel: {
    fontSize: 13,
    color: OwnerTheme.colors.textSecondary,
    fontWeight: '500',
  },
  progressStepLabelActive: {
    fontSize: 13,
    color: OwnerTheme.colors.primary,
    fontWeight: '700',
  },
  progressDivider: {
    width: 32,
    height: 2,
    backgroundColor: OwnerTheme.colors.border,
    marginHorizontal: 12,
  },
  formCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 20,
  },
  formSectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
    marginBottom: 4,
  },
  formSectionSubtitle: {
    fontSize: 13,
    color: OwnerTheme.colors.textSecondary,
    marginBottom: 16,
    lineHeight: 18,
  },
  inputGroup: {
    marginBottom: 16,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
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
  passwordInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: OwnerTheme.radius.md,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    backgroundColor: '#FFFFFF',
    paddingRight: 12,
  },
  eyeBtn: {
    padding: 6,
  },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
  },
  generateBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: OwnerTheme.colors.primary,
  },
  step2Actions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  successCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 24,
    alignItems: 'center',
  },
  successIconWrap: {
    marginBottom: 12,
  },
  successHeading: {
    fontSize: 20,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
    marginBottom: 6,
  },
  successSubheading: {
    fontSize: 13,
    color: OwnerTheme.colors.textSecondary,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 18,
  },
  summaryDetailsBox: {
    width: '100%',
    backgroundColor: '#F8FAFC',
    borderRadius: OwnerTheme.radius.md,
    padding: 14,
    gap: 10,
    marginBottom: 20,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 13,
    color: OwnerTheme.colors.textSecondary,
  },
  summaryValue: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  successActions: {
    width: '100%',
  },
});
