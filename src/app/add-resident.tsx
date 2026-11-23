import React, { useCallback, useMemo, useState } from 'react';
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
import { Href, router, useFocusEffect } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  X,
} from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useProperty } from '@/context/property-context';
import { useActiveResidentPeersQuery } from '@/hooks/use-residents';
import { EdgeFunctionError, invokeEdgeFunction } from '@/lib/edge-functions';
import { extractErrorMessage } from '@/lib/error-utils';
import { endTrace, recordRoundTrip, startTrace } from '@/lib/perf-monitor';
import { queryKeys } from '@/lib/query-keys';
import { normalizeAppError } from '@/lib/service-result';
import { supabase } from '@/lib/supabase';
import {
  formatLocalIsoDate,
  formatPropertyGenderLabel,
  inferPropertyGender,
  isPropertyCompatibleWithGender,
  isValidIsoDate,
  normalizeIndianPhoneDigits,
  PropertyGenderType,
  ResidentGender,
  validateIndianPhone,
} from '@/lib/ux-utils';
import { writeLocalResidentMeta } from '@/services/residents.service';
import {
  AddResidentAccountStep,
  AddResidentSuccessView,
  ResidentGenderField,
  ResidentJoiningDateField,
  ResidentPhoneField,
  ResidentRentDepositRow,
} from '@/components/residents/ResidentFormSections';
import { RoomBedPicker } from '@/components/residents/RoomBedPicker';
import { CalendarDatePickerModal } from '@/components/ui/calendar-date-picker-modal';
import {
  ErrorState,
  OwnerHeader,
  OwnerSharedStyles,
  PrimaryButton,
} from '@/components/ui/owner';

interface PropertyOption {
  id: string;
  name: string;
  gender_type?: PropertyGenderType | null;
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

const getTodayIsoDate = formatLocalIsoDate;

function parseRupeesToPaise(raw: string): { valid: boolean; paise?: number } {
  const trimmed = raw.trim();
  if (!trimmed) return { valid: true, paise: undefined };
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num < 0) {
    return { valid: false };
  }
  return { valid: true, paise: Math.round(num * 100) };
}

function isMissingColumnError(
  err: { code?: string; message?: string } | null
): boolean {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  return (
    err.code === '42703' ||
    err.code === 'PGRST204' ||
    msg.includes('does not exist') ||
    msg.includes('column') ||
    msg.includes('schema cache')
  );
}

async function persistExtendedResidentFields(
  residentId: string,
  fields: Record<string, unknown>
): Promise<void> {
  const entries = Object.entries(fields).filter(
    ([, val]) => val !== undefined
  );
  if (entries.length === 0) return;

  const fullPayload = Object.fromEntries(entries);
  try {
    const { error } = await supabase
      .from('residents')
      .update(fullPayload)
      .eq('id', residentId);

    if (!error) return;
    if (!isMissingColumnError(error)) {
      console.warn(
        '[AddResident] Non-fatal extended fields update error:',
        error.message
      );
      return;
    }

    // Fallback: apply each field independently so existing columns (e.g. monthly_rent_paise) still persist
    for (const [key, value] of entries) {
      try {
        await supabase
          .from('residents')
          .update({ [key]: value })
          .eq('id', residentId);
      } catch {
        // Ignore missing columns on older schemas
      }
    }
  } catch {
    // Non-fatal best-effort persistence
  }
}

export default function AddResidentScreen() {
  const { user, profile } = useAuth();
  const { properties, selectedProperty } = useProperty();
  const ownerId = user?.id;

  const [fallbackProperties, setFallbackProperties] = useState<
    PropertyOption[]
  >([]);

  // Form Step: 1 = Resident Details, 2 = Account Setup, 3 = Success Screen
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);

  // Gender & Property Selection
  const [gender, setGender] = useState<ResidentGender>(() => {
    if (selectedProperty) {
      const pgGender = inferPropertyGender(
        selectedProperty.name,
        selectedProperty.gender_type
      );
      if (pgGender === 'girls') return 'female';
    }
    return 'male';
  });
  const [selectedTargetPropertyId, setSelectedTargetPropertyId] = useState<
    string | null
  >(() => selectedProperty?.id ?? null);

  // Form Fields
  const [fullName, setFullName] = useState('');
  const [roomNumber, setRoomNumber] = useState('');
  const [bedLabel, setBedLabel] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [joiningDate, setJoiningDate] = useState(() => getTodayIsoDate());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [monthlyRent, setMonthlyRent] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');
  const [email, setEmail] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [roomRefreshSignal, setRoomRefreshSignal] = useState(0);

  // Created Resident summary for Step 3
  const [createdSummary, setCreatedSummary] = useState<{
    id: string;
    fullName: string;
    propertyName: string;
    roomNumber: string;
    bedLabel?: string;
    joiningDate: string;
    email: string;
  } | null>(null);

  // Status & Feedback
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoadError, setIsLoadError] = useState(false);

  const clearError = useCallback(() => {
    setIsLoadError(false);
    setErrorMessage(null);
  }, []);

  const showFormError = useCallback((msg: string) => {
    setIsLoadError(false);
    setErrorMessage(msg);
  }, []);

  // Load properties fallback if PropertyContext hasn't populated any
  const loadFallbackProperties = useCallback(async () => {
    if (properties.length > 0) return;

    try {
      let query = supabase
        .from('properties')
        .select('id, name, gender_type')
        .eq('is_active', true);

      if (ownerId) {
        query = query.eq('owner_id', ownerId);
      }

      const richRes = await query;
      if (richRes.error && isMissingColumnError(richRes.error)) {
        let basicQuery = supabase
          .from('properties')
          .select('id, name')
          .eq('is_active', true);
        if (ownerId) {
          basicQuery = basicQuery.eq('owner_id', ownerId);
        }
        const basicRes = await basicQuery;
        if (basicRes.error) {
          throw new Error(`Failed to load property: ${basicRes.error.message}`);
        }
        setIsLoadError(false);
        setFallbackProperties((basicRes.data as PropertyOption[]) ?? []);
        return;
      }

      if (richRes.error) {
        throw new Error(`Failed to load property: ${richRes.error.message}`);
      }

      const rows = (richRes.data as PropertyOption[]) ?? [];
      setIsLoadError(false);
      if (rows.length === 0) {
        setErrorMessage(
          'No active PG property found for your account. Please set up a property first.'
        );
      }
      setFallbackProperties(rows);
    } catch (err: unknown) {
      const msg = extractErrorMessage(err, 'Could not load properties.');
      console.error('[AddResident] Error loading properties:', err);
      setIsLoadError(true);
      setErrorMessage(msg);
    }
  }, [ownerId, properties.length]);

  useFocusEffect(
    useCallback(() => {
      loadFallbackProperties();
      setRoomRefreshSignal((n) => n + 1);
    }, [loadFallbackProperties])
  );

  const allProperties: PropertyOption[] = useMemo(() => {
    if (properties.length > 0) {
      return properties.map((p) => ({
        id: p.id,
        name: p.name,
        gender_type: p.gender_type,
      }));
    }
    return fallbackProperties;
  }, [properties, fallbackProperties]);

  const compatibleProperties = useMemo(
    () =>
      allProperties.filter((p) =>
        isPropertyCompatibleWithGender(
          inferPropertyGender(p.name, p.gender_type),
          gender
        )
      ),
    [allProperties, gender]
  );

  const activeProperty: PropertyOption | null = useMemo(() => {
    if (compatibleProperties.length === 0) return null;
    if (selectedTargetPropertyId) {
      const chosen = compatibleProperties.find(
        (p) => p.id === selectedTargetPropertyId
      );
      if (chosen) return chosen;
    }
    if (selectedProperty) {
      const activeMatch = compatibleProperties.find(
        (p) => p.id === selectedProperty.id
      );
      if (activeMatch) return activeMatch;
    }
    return compatibleProperties[0];
  }, [compatibleProperties, selectedTargetPropertyId, selectedProperty]);

  const qc = useQueryClient();
  const activePropertyId = activeProperty?.id ?? null;

  const peersQuery = useActiveResidentPeersQuery(activePropertyId);
  const existingResidents = useMemo(
    () => (activePropertyId ? (peersQuery.data ?? []) : []),
    [activePropertyId, peersQuery.data]
  );

  const duplicatePhoneResident = useMemo(() => {
    const normalized = normalizeIndianPhoneDigits(phoneNumber);
    if (!normalized) return null;
    return (
      existingResidents.find(
        (r) => normalizeIndianPhoneDigits(r.phone_number) === normalized
      ) ?? null
    );
  }, [existingResidents, phoneNumber]);

  const handleSelectGender = (nextGender: ResidentGender) => {
    if (nextGender === gender) return;
    setGender(nextGender);
    setRoomNumber('');
    setBedLabel('');
    if (errorMessage) setErrorMessage(null);

    const nextCompatible = allProperties.filter((p) =>
      isPropertyCompatibleWithGender(
        inferPropertyGender(p.name, p.gender_type),
        nextGender
      )
    );
    const currentStillValid = nextCompatible.some(
      (p) => p.id === activeProperty?.id
    );
    if (!currentStillValid) {
      setSelectedTargetPropertyId(nextCompatible[0]?.id ?? null);
    }
  };

  const handleSelectProperty = (propId: string) => {
    if (propId === activeProperty?.id) return;
    setSelectedTargetPropertyId(propId);
    setRoomNumber('');
    setBedLabel('');
    if (errorMessage) setErrorMessage(null);
  };

  const resetForm = () => {
    setFullName('');
    setRoomNumber('');
    setBedLabel('');
    setPhoneNumber('');
    setJoiningDate(getTodayIsoDate());
    setMonthlyRent('');
    setDepositAmount('');
    setEmergencyContact('');
    setEmail('');
    setTemporaryPassword('');
    setShowPassword(false);
    setCreatedSummary(null);
    setErrorMessage(null);
    setCurrentStep(1);
    setRoomRefreshSignal((n) => n + 1);
    if (activeProperty?.id) {
      void qc.invalidateQueries({
        queryKey: queryKeys.residents.activePeers(activeProperty.id),
      });
    }
  };

  const handleGeneratePassword = () => {
    const pw = generateRandomPassword(8);
    setTemporaryPassword(pw);
    setShowPassword(true);
  };

  // Validate Step 1 before moving to Step 2
  const handleProceedToStep2 = () => {
    if (!activeProperty?.id) {
      showFormError(
        'Please select a compatible PG property before continuing.'
      );
      return;
    }

    const trimmedName = fullName.trim();
    const trimmedRoom = roomNumber.trim();
    const trimmedBed = bedLabel.trim();
    const trimmedJoiningDate = joiningDate.trim();
    const phoneValidation = validateIndianPhone(phoneNumber);
    const rentParsed = parseRupeesToPaise(monthlyRent);
    const depositParsed = parseRupeesToPaise(depositAmount);

    if (!trimmedName) {
      showFormError("Please enter the resident's full name.");
      return;
    }
    if (!trimmedRoom || !trimmedBed) {
      showFormError('Please select a room and free bed.');
      return;
    }
    if (!phoneValidation.valid) {
      showFormError(
        phoneValidation.error ||
          'Please enter a valid 10-digit mobile number.'
      );
      return;
    }
    if (!isValidIsoDate(trimmedJoiningDate)) {
      showFormError('Please select a valid joining date.');
      return;
    }
    if (!rentParsed.valid) {
      showFormError('Please enter a valid monthly rent amount in ₹.');
      return;
    }
    if (!depositParsed.valid) {
      showFormError('Please enter a valid security deposit amount in ₹.');
      return;
    }

    clearError();
    setCurrentStep(2);
  };

  const createResidentMutation = useMutation({
    mutationFn: async (input: {
      propertyId: string;
      fullName: string;
      roomNumber: string;
      bedLabel: string;
      phoneNumber: string;
      email: string;
      temporaryPassword: string;
      gender: ResidentGender;
      joiningDate: string;
      monthlyRentPaise?: number;
      depositPaise?: number;
      emergencyContact: string;
    }) => {
      const traceLabel = 'add-resident:create';
      startTrace(traceLabel);

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

        // Invoke the protected create-resident Edge Function (strictly online)
        const edgeData = await invokeEdgeFunction<{
          success: boolean;
          resident_id?: string;
          id?: string;
          full_name?: string;
          room_number?: string;
          email?: string;
          error?: string;
        }>('create-resident', {
          property_id: input.propertyId,
          full_name: input.fullName,
          room_number: input.roomNumber,
          phone_number: input.phoneNumber,
          email: input.email,
          temporary_password: input.temporaryPassword,
          gender: input.gender,
          joining_date: input.joiningDate,
          monthly_rent_paise: input.monthlyRentPaise,
          deposit_paise: input.depositPaise,
          ...(input.bedLabel ? { bed_label: input.bedLabel } : {}),
          ...(input.emergencyContact
            ? { emergency_contact: input.emergencyContact }
            : {}),
        });
        recordRoundTrip(traceLabel);

        if (!edgeData || !edgeData.success) {
          throw new Error(
            edgeData?.error || 'Failed to create resident account.'
          );
        }

        const createdResidentId = edgeData.resident_id || edgeData.id || '';

        if (createdResidentId) {
          await persistExtendedResidentFields(createdResidentId, {
            gender: input.gender,
            joining_date: input.joiningDate,
            monthly_rent_paise: input.monthlyRentPaise,
            deposit_paise: input.depositPaise,
            ...(input.bedLabel ? { bed_label: input.bedLabel } : {}),
            ...(input.emergencyContact
              ? { emergency_contact: input.emergencyContact }
              : {}),
          });
          await writeLocalResidentMeta(createdResidentId, {
            bed_label: input.bedLabel || null,
            gender: input.gender,
            joining_date: input.joiningDate,
            deposit_paise: input.depositPaise,
            emergency_contact: input.emergencyContact || null,
          });
        }

        return { edgeData, createdResidentId };
      } finally {
        endTrace(traceLabel);
      }
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.residents.all }),
        qc.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
        qc.invalidateQueries({ queryKey: queryKeys.billing.all }),
        qc.invalidateQueries({ queryKey: queryKeys.movement.all }),
      ]);
    },
  });

  const saving = createResidentMutation.isPending;

  // Validate and submit unified resident + auth creation via Edge Function
  const handleSaveResident = async () => {
    if (createResidentMutation.isPending) return;

    if (!user?.id || profile?.role !== 'owner') {
      Alert.alert(
        'Authorization Required',
        'You must be signed in as a PG owner to add residents.'
      );
      return;
    }

    if (!activeProperty?.id) {
      Alert.alert(
        'Property Required',
        'Cannot add resident without a compatible active PG property.'
      );
      return;
    }

    const trimmedName = fullName.trim();
    const trimmedRoom = roomNumber.trim();
    const trimmedBed = bedLabel.trim();
    const phoneValidation = validateIndianPhone(phoneNumber);
    const trimmedJoiningDate = joiningDate.trim();
    const rentParsed = parseRupeesToPaise(monthlyRent);
    const depositParsed = parseRupeesToPaise(depositAmount);
    const trimmedEmergency = emergencyContact.trim();
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPassword = temporaryPassword.trim();

    if (!phoneValidation.valid) {
      showFormError(
        phoneValidation.error ||
          'Please enter a valid 10-digit mobile number.'
      );
      return;
    }

    if (!trimmedEmail) {
      showFormError("Please enter the resident's login email.");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      showFormError('Please enter a valid email address.');
      return;
    }

    if (!trimmedPassword) {
      showFormError('Please provide a temporary password or tap generate.');
      return;
    }

    if (trimmedPassword.length < 6) {
      showFormError('Temporary password must be at least 6 characters.');
      return;
    }

    clearError();

    try {
      const { edgeData, createdResidentId } =
        await createResidentMutation.mutateAsync({
          propertyId: activeProperty.id,
          fullName: trimmedName,
          roomNumber: trimmedRoom,
          bedLabel: trimmedBed,
          phoneNumber: phoneValidation.normalized10,
          email: trimmedEmail,
          temporaryPassword: trimmedPassword,
          gender,
          joiningDate: trimmedJoiningDate,
          monthlyRentPaise: rentParsed.paise,
          depositPaise: depositParsed.paise,
          emergencyContact: trimmedEmergency,
        });

      if (createdResidentId) {
        router.replace({
          pathname: '/resident-profile',
          params: { id: createdResidentId },
        } as unknown as Href);
        return;
      }

      // Fallback Step 3 summary if Edge Function did not return a resident ID
      setCreatedSummary({
        id: createdResidentId,
        fullName: edgeData.full_name || trimmedName,
        propertyName: activeProperty.name,
        roomNumber: edgeData.room_number || trimmedRoom,
        bedLabel: trimmedBed || undefined,
        joiningDate: trimmedJoiningDate,
        email: edgeData.email || trimmedEmail,
      });

      setCurrentStep(3);
    } catch (err: unknown) {
      let msg: string;
      if (err instanceof EdgeFunctionError) {
        if (err.status === 409) {
          msg =
            err.code === 'DUPLICATE_RESIDENT' && err.message
              ? err.message
              : `A resident or account with email "${trimmedEmail}" already exists.`;
        } else if (err.status === 400) {
          msg =
            err.message && !err.message.startsWith('Request failed (HTTP')
              ? err.message
              : 'Invalid resident details provided (400).';
        } else if (err.status === 404) {
          msg =
            'The resident setup service is currently unavailable. Please contact support.';
        } else if (!err.status) {
          msg =
            err.message ||
            'Network error. Please check your connection and try again.';
        } else {
          msg = err.message || 'Failed to create resident.';
        }
      } else {
        const normalized = normalizeAppError(err, 'Failed to create resident.');
        msg = normalized.isNetworkError
          ? normalized.message ||
            'Network error. Please check your connection and try again.'
          : normalized.message;
      }
      showFormError(msg);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <OwnerHeader
        title="Add Resident"
        subtitle={activeProperty?.name || 'Property'}
        showBack
        onBack={() => {
          if (currentStep === 2) {
            setCurrentStep(1);
          } else if (router.canGoBack()) {
            router.back();
          } else {
            router.replace('/(tabs)');
          }
        }}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
        style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 140 }]}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled">
          {errorMessage && (
            isLoadError && allProperties.length === 0 ? (
              <ErrorState
                message={errorMessage}
                onRetry={() => {
                  clearError();
                  void loadFallbackProperties();
                }}
              />
            ) : (
              <View style={styles.validationErrorBanner}>
                <AlertCircle
                  size={18}
                  color={OwnerTheme.colors.danger}
                  style={{ marginRight: 8, marginTop: 1 }}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.validationErrorText}>{errorMessage}</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss error"
                  hitSlop={8}
                  onPress={clearError}
                  style={styles.dismissErrorBtn}>
                  <X size={14} color={OwnerTheme.colors.danger} />
                  <Text style={styles.dismissErrorText}>Dismiss</Text>
                </Pressable>
              </View>
            )
          )}

          {/* Step 3: Success Screen */}
          {currentStep === 3 && createdSummary ? (
            <AddResidentSuccessView
              createdSummary={createdSummary}
              onResetForm={resetForm}
            />
          ) : (
            <>
              {/* Step Progress Indicator */}
              <View style={styles.progressRow}>
                <View
                  style={[styles.progressStep, styles.progressStepActive]}>
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

                  {/* Full Name */}
                  <View style={styles.inputGroup}>
                    <Text style={OwnerSharedStyles.inputLabel}>Full Name *</Text>
                    <TextInput
                      style={OwnerSharedStyles.textInput}
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

                  <ResidentGenderField
                    gender={gender}
                    onSelect={handleSelectGender}
                  />

                  {/* Property Selector (filtered by gender) */}
                  <View style={styles.inputGroup}>
                    <Text style={OwnerSharedStyles.inputLabel}>PG Property *</Text>
                    {compatibleProperties.length > 0 ? (
                      <View style={styles.propertyChipWrap}>
                        {compatibleProperties.map((prop) => {
                          const isSelected = prop.id === activeProperty?.id;
                          const pgGenderLabel = formatPropertyGenderLabel(
                            inferPropertyGender(prop.name, prop.gender_type)
                          );
                          return (
                            <Pressable
                              key={prop.id}
                              accessibilityRole="radio"
                              accessibilityState={{ selected: isSelected }}
                              onPress={() => handleSelectProperty(prop.id)}
                              style={[
                                styles.propertyChip,
                                isSelected && styles.propertyChipActive,
                              ]}>
                              <Building2
                                size={14}
                                color={
                                  isSelected
                                    ? OwnerTheme.colors.primary
                                    : OwnerTheme.colors.textSecondary
                                }
                              />
                              <Text
                                style={[
                                  styles.propertyChipText,
                                  isSelected && styles.propertyChipTextActive,
                                ]}
                                numberOfLines={1}>
                                {prop.name}
                              </Text>
                              <View style={styles.propertyTag}>
                                <Text style={styles.propertyTagText}>
                                  {pgGenderLabel}
                                </Text>
                              </View>
                            </Pressable>
                          );
                        })}
                      </View>
                    ) : (
                      <View style={styles.warningBox}>
                        <AlertTriangle
                          size={16}
                          color={OwnerTheme.colors.warning}
                          style={{ marginTop: 1 }}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.warningText}>
                            No compatible PG property matches{' '}
                            {gender === 'female'
                              ? 'Female'
                              : gender === 'male'
                                ? 'Male'
                                : 'Other'}{' '}
                            residents. Update a property&apos;s gender type or
                            add a Co-ed property in PG Properties.
                          </Text>
                          <Pressable
                            onPress={() => router.push('/owner-properties')}
                            style={{ marginTop: 6 }}>
                            <Text style={styles.warningActionLink}>
                              Open PG Properties →
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    )}
                  </View>

                  {/* Unified Room & Bed Picker */}
                  {activeProperty ? (
                    <View style={styles.pickerGroup}>
                      <RoomBedPicker
                        propertyId={activeProperty.id}
                        propertyGender={inferPropertyGender(
                          activeProperty.name,
                          activeProperty.gender_type
                        )}
                        residentGender={gender}
                        selectedRoomNumber={roomNumber}
                        selectedBedLabel={bedLabel}
                        refreshSignal={roomRefreshSignal}
                        onSelect={(room, bed) => {
                          setRoomNumber(room);
                          setBedLabel(bed);
                          if (errorMessage) setErrorMessage(null);
                        }}
                      />
                    </View>
                  ) : null}

                  <ResidentPhoneField
                    value={phoneNumber}
                    onChangeText={(val) => {
                      setPhoneNumber(val);
                      if (errorMessage) setErrorMessage(null);
                    }}
                    duplicatePhoneResident={duplicatePhoneResident}
                  />

                  <ResidentJoiningDateField
                    joiningDate={joiningDate}
                    onOpenPicker={() => setShowDatePicker(true)}
                  />

                  <ResidentRentDepositRow
                    monthlyRent={monthlyRent}
                    depositAmount={depositAmount}
                    onChangeRent={(val) => {
                      setMonthlyRent(val);
                      if (errorMessage) setErrorMessage(null);
                    }}
                    onChangeDeposit={(val) => {
                      setDepositAmount(val);
                      if (errorMessage) setErrorMessage(null);
                    }}
                  />

                  {/* Emergency Contact (Optional) */}
                  <View style={styles.inputGroup}>
                    <Text style={OwnerSharedStyles.inputLabel}>Emergency Contact</Text>
                    <TextInput
                      style={OwnerSharedStyles.textInput}
                      placeholder="Parent / guardian phone or name (optional)"
                      placeholderTextColor={OwnerTheme.colors.textMuted}
                      value={emergencyContact}
                      onChangeText={(val) => {
                        setEmergencyContact(val);
                        if (errorMessage) setErrorMessage(null);
                      }}
                    />
                  </View>

                  <PrimaryButton
                    label="Next: Account Setup"
                    onPress={handleProceedToStep2}
                    disabled={!activeProperty}
                    style={{ marginTop: 8 }}
                  />
                </View>
              ) : (
                <AddResidentAccountStep
                  email={email}
                  temporaryPassword={temporaryPassword}
                  showPassword={showPassword}
                  saving={saving}
                  onChangeEmail={(val) => {
                    setEmail(val);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  onChangePassword={(val) => {
                    setTemporaryPassword(val);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  onToggleShowPassword={() => setShowPassword(!showPassword)}
                  onGeneratePassword={handleGeneratePassword}
                  onBack={() => setCurrentStep(1)}
                  onSave={handleSaveResident}
                />
              )}
            </>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      <CalendarDatePickerModal
        visible={showDatePicker}
        value={joiningDate}
        title="Select Joining Date"
        onSelect={(iso) => {
          setJoiningDate(iso);
          if (errorMessage) setErrorMessage(null);
        }}
        onClose={() => setShowDatePicker(false)}
      />
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
  validationErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: OwnerTheme.colors.dangerLight,
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: OwnerTheme.radius.md,
    padding: 12,
    marginVertical: 8,
  },
  validationErrorText: {
    fontSize: 13,
    color: OwnerTheme.colors.danger,
    fontWeight: '500',
  },
  dismissErrorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: OwnerTheme.radius.sm,
    backgroundColor: '#FFFFFF',
  },
  dismissErrorText: {
    fontSize: 12,
    fontWeight: '600',
    color: OwnerTheme.colors.danger,
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
  inputGroup: {
    marginBottom: 16,
  },
  pickerGroup: {
    marginBottom: 16,
  },
  propertyChipWrap: {
    gap: 8,
  },
  propertyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: OwnerTheme.radius.md,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    backgroundColor: '#FAFAFA',
  },
  propertyChipActive: {
    borderColor: OwnerTheme.colors.primary,
    backgroundColor: OwnerTheme.colors.primaryLight,
  },
  propertyChipText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  propertyChipTextActive: {
    color: OwnerTheme.colors.primary,
    fontWeight: '700',
  },
  propertyTag: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    borderRadius: OwnerTheme.radius.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  propertyTagText: {
    fontSize: 11,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: OwnerTheme.radius.md,
    backgroundColor: OwnerTheme.colors.warningLight,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  warningText: {
    flex: 1,
    fontSize: 12,
    color: '#92400E',
    lineHeight: 17,
    fontWeight: '500',
  },
  warningActionLink: {
    fontSize: 12,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
});
