import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  Calendar,
  CheckCircle2,
  Eye,
  EyeOff,
  RefreshCw,
  X,
} from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useProperty } from '@/context/property-context';
import { EdgeFunctionError, invokeEdgeFunction } from '@/lib/edge-functions';
import { endTrace, recordRoundTrip, startTrace } from '@/lib/perf-monitor';
import { invalidatePrefix } from '@/lib/query-cache';
import { normalizeAppError } from '@/lib/service-result';
import { supabase } from '@/lib/supabase';
import {
  formatIsoDateDisplay,
  formatPropertyGenderLabel,
  inferPropertyGender,
  isPropertyCompatibleWithGender,
  normalizeIndianPhoneDigits,
  PropertyGenderType,
  ResidentGender,
  validateIndianPhone,
} from '@/lib/ux-utils';
import {
  RESIDENTS_CACHE_PREFIX,
  writeLocalResidentMeta,
} from '@/services/residents.service';
import { RoomBedPicker } from '@/components/residents/RoomBedPicker';
import { CalendarDatePickerModal } from '@/components/ui/calendar-date-picker-modal';
import {
  OwnerHeader,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  ErrorState,
} from '@/components/ui/owner';

interface PropertyOption {
  id: string;
  name: string;
  gender_type?: PropertyGenderType | null;
}

interface ExistingResidentRow {
  id: string;
  room_number: string;
  phone_number: string | null;
  full_name: string;
}

const RESIDENT_GENDER_OPTIONS: { value: ResidentGender; label: string }[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
];

function generateRandomPassword(length = 8): string {
  const chars =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$';
  let res = '';
  for (let i = 0; i < length; i++) {
    res += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return res;
}

function getTodayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [yStr, mStr, dStr] = value.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  const day = Number(dStr);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

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

  // Duplicate-phone lookup for active target property
  const [residentSnapshot, setResidentSnapshot] = useState<{
    propertyId: string;
    rows: ExistingResidentRow[];
  }>({ propertyId: '', rows: [] });

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
  const [saving, setSaving] = useState(false);
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
      const msg = err instanceof Error ? err.message : String(err);
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

  const activePropertyId = activeProperty?.id ?? null;

  const existingResidents = useMemo(
    () =>
      activePropertyId && residentSnapshot.propertyId === activePropertyId
        ? residentSnapshot.rows
        : [],
    [activePropertyId, residentSnapshot]
  );

  const fetchPropertyResidents = useCallback(async (propertyId: string) => {
    try {
      const { data, error } = await supabase
        .from('residents')
        .select('id, room_number, phone_number, full_name')
        .eq('property_id', propertyId)
        .eq('is_active', true);

      if (error) {
        console.warn('[AddResident] Could not fetch residents:', error.message);
        setResidentSnapshot({ propertyId, rows: [] });
        return;
      }

      setResidentSnapshot({
        propertyId,
        rows: (data as ExistingResidentRow[]) ?? [],
      });
    } catch {
      setResidentSnapshot({ propertyId, rows: [] });
    }
  }, []);

  useEffect(() => {
    if (!activePropertyId) return;
    let active = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('residents')
          .select('id, room_number, phone_number, full_name')
          .eq('property_id', activePropertyId)
          .eq('is_active', true);

        if (!active) return;
        if (error) {
          console.warn('[AddResident] Could not fetch rooms:', error.message);
          setResidentSnapshot({ propertyId: activePropertyId, rows: [] });
          return;
        }
        setResidentSnapshot({
          propertyId: activePropertyId,
          rows: (data as ExistingResidentRow[]) ?? [],
        });
      } catch {
        if (active) {
          setResidentSnapshot({ propertyId: activePropertyId, rows: [] });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [activePropertyId]);

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
      void fetchPropertyResidents(activeProperty.id);
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

  // Validate and submit unified resident + auth creation via Edge Function
  const handleSaveResident = async () => {
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

    setSaving(true);
    clearError();
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
        property_id: activeProperty.id,
        full_name: trimmedName,
        room_number: trimmedRoom,
        phone_number: phoneValidation.normalized10,
        email: trimmedEmail,
        temporary_password: trimmedPassword,
        gender,
        joining_date: trimmedJoiningDate,
        monthly_rent_paise: rentParsed.paise,
        deposit_paise: depositParsed.paise,
        ...(trimmedBed ? { bed_label: trimmedBed } : {}),
        ...(trimmedEmergency ? { emergency_contact: trimmedEmergency } : {}),
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
          gender,
          joining_date: trimmedJoiningDate,
          monthly_rent_paise: rentParsed.paise,
          deposit_paise: depositParsed.paise,
          ...(trimmedBed ? { bed_label: trimmedBed } : {}),
          ...(trimmedEmergency ? { emergency_contact: trimmedEmergency } : {}),
        });
        await writeLocalResidentMeta(createdResidentId, {
          bed_label: trimmedBed || null,
          gender,
          joining_date: trimmedJoiningDate,
          deposit_paise: depositParsed.paise,
          emergency_contact: trimmedEmergency || null,
        });
        await Promise.all([
          invalidatePrefix(RESIDENTS_CACHE_PREFIX),
          invalidatePrefix('dashboard:'),
        ]);

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
    } finally {
      endTrace(traceLabel);
      setSaving(false);
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
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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
                  <Text style={styles.summaryLabel}>PG Property</Text>
                  <Text style={styles.summaryValue}>
                    {createdSummary.propertyName}
                  </Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Room & Bed</Text>
                  <Text style={styles.summaryValue}>
                    Room {createdSummary.roomNumber}
                    {createdSummary.bedLabel
                      ? ` · ${createdSummary.bedLabel}`
                      : ''}
                  </Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Joining Date</Text>
                  <Text style={styles.summaryValue}>
                    {formatIsoDateDisplay(createdSummary.joiningDate)}
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
                        pathname: '/resident-profile',
                        params: { id: createdSummary.id },
                      } as unknown as Href);
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

                  {/* Gender Selector */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>Gender *</Text>
                    <View style={styles.chipRow}>
                      {RESIDENT_GENDER_OPTIONS.map((opt) => {
                        const isSelected = gender === opt.value;
                        return (
                          <Pressable
                            key={opt.value}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: isSelected }}
                            onPress={() => handleSelectGender(opt.value)}
                            style={[
                              styles.segmentChip,
                              isSelected && styles.segmentChipActive,
                            ]}>
                            <Text
                              style={[
                                styles.segmentChipText,
                                isSelected && styles.segmentChipTextActive,
                              ]}>
                              {opt.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>

                  {/* Property Selector (filtered by gender) */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>PG Property *</Text>
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

                  {/* Phone Number (Required, +91 prefix) */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>Phone Number *</Text>
                    <View style={styles.prefixedInputWrap}>
                      <View style={styles.prefixBadge}>
                        <Text style={styles.prefixText}>+91</Text>
                      </View>
                      <TextInput
                        style={styles.prefixedTextInput}
                        placeholder="Enter 10-digit mobile number"
                        placeholderTextColor={OwnerTheme.colors.textMuted}
                        value={phoneNumber}
                        onChangeText={(val) => {
                          setPhoneNumber(val);
                          if (errorMessage) setErrorMessage(null);
                        }}
                        keyboardType="phone-pad"
                        maxLength={16}
                      />
                    </View>
                    <Text style={styles.helperText}>
                      Enter any 10-digit mobile number (with or without +91).
                    </Text>

                    {duplicatePhoneResident && (
                      <View style={[styles.warningBox, { marginTop: 8 }]}>
                        <AlertTriangle
                          size={15}
                          color={OwnerTheme.colors.warning}
                          style={{ marginTop: 1 }}
                        />
                        <Text style={styles.warningText}>
                          Duplicate phone warning: Already registered to{' '}
                          {duplicatePhoneResident.full_name} (Room{' '}
                          {duplicatePhoneResident.room_number}) in this
                          property.
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Joining Date */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>Joining Date *</Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Select joining date"
                      onPress={() => setShowDatePicker(true)}
                      style={({ pressed }) => [
                        styles.datePickerBtn,
                        pressed && styles.datePickerBtnPressed,
                      ]}>
                      <View style={styles.datePickerBtnLeft}>
                        <Calendar
                          size={18}
                          color={OwnerTheme.colors.primary}
                        />
                        <Text style={styles.datePickerBtnText}>
                          {formatIsoDateDisplay(joiningDate)}
                        </Text>
                      </View>
                      <Text style={styles.datePickerChangeText}>Select</Text>
                    </Pressable>
                  </View>

                  {/* Monthly Rent & Security Deposit */}
                  <View style={styles.twoColRow}>
                    <View style={[styles.inputGroup, { flex: 1 }]}>
                      <Text style={styles.label}>Monthly Rent (₹)</Text>
                      <View style={styles.prefixedInputWrap}>
                        <View style={styles.prefixBadge}>
                          <Text style={styles.prefixText}>₹</Text>
                        </View>
                        <TextInput
                          style={styles.prefixedTextInput}
                          placeholder="8000"
                          placeholderTextColor={OwnerTheme.colors.textMuted}
                          value={monthlyRent}
                          onChangeText={(val) => {
                            setMonthlyRent(val.replace(/[^0-9.]/g, ''));
                            if (errorMessage) setErrorMessage(null);
                          }}
                          keyboardType="decimal-pad"
                        />
                      </View>
                    </View>

                    <View style={[styles.inputGroup, { flex: 1 }]}>
                      <Text style={styles.label}>Security Deposit (₹)</Text>
                      <View style={styles.prefixedInputWrap}>
                        <View style={styles.prefixBadge}>
                          <Text style={styles.prefixText}>₹</Text>
                        </View>
                        <TextInput
                          style={styles.prefixedTextInput}
                          placeholder="10000"
                          placeholderTextColor={OwnerTheme.colors.textMuted}
                          value={depositAmount}
                          onChangeText={(val) => {
                            setDepositAmount(val.replace(/[^0-9.]/g, ''));
                            if (errorMessage) setErrorMessage(null);
                          }}
                          keyboardType="decimal-pad"
                        />
                      </View>
                    </View>
                  </View>

                  {/* Emergency Contact (Optional) */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>Emergency Contact</Text>
                    <TextInput
                      style={styles.textInput}
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
                /* Step 2: Account Setup */
                <View style={styles.formCard}>
                  <Text style={styles.formSectionTitle}>
                    Resident Portal Login
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
  formSectionSubtitle: {
    fontSize: 13,
    color: OwnerTheme.colors.textSecondary,
    marginBottom: 16,
    lineHeight: 18,
  },
  inputGroup: {
    marginBottom: 16,
  },
  pickerGroup: {
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
  datePickerBtn: {
    height: 50,
    borderRadius: OwnerTheme.radius.md,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    paddingHorizontal: 14,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  datePickerBtnPressed: {
    backgroundColor: '#F8FAFC',
    borderColor: OwnerTheme.colors.primary,
  },
  datePickerBtnLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  datePickerBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  datePickerChangeText: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.primary,
  },
  prefixedInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 50,
    borderRadius: OwnerTheme.radius.md,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  prefixBadge: {
    height: '100%',
    paddingHorizontal: 12,
    backgroundColor: '#F1F5F9',
    borderRightWidth: 1,
    borderRightColor: OwnerTheme.colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  prefixText: {
    fontSize: 14,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  prefixedTextInput: {
    flex: 1,
    height: '100%',
    paddingHorizontal: 12,
    fontSize: 15,
    color: OwnerTheme.colors.textPrimary,
  },
  helperText: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 6,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
  },
  segmentChip: {
    flex: 1,
    height: 42,
    borderRadius: OwnerTheme.radius.md,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    backgroundColor: '#FAFAFA',
    justifyContent: 'center',
    alignItems: 'center',
  },
  segmentChipActive: {
    borderColor: OwnerTheme.colors.primary,
    backgroundColor: OwnerTheme.colors.primaryLight,
  },
  segmentChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  segmentChipTextActive: {
    color: OwnerTheme.colors.primary,
    fontWeight: '700',
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
  twoColRow: {
    flexDirection: 'row',
    gap: 10,
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
