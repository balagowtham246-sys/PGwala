import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { Href, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  X,
} from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useProperty } from '@/context/property-context';
import { useToast } from '@/context/toast-context';
import {
  useActiveResidentPeersQuery,
  useCheckoutResidentMutation,
  useResidentProfileQuery,
  useUpdateResidentWithLockMutation,
} from '@/hooks/use-residents';
import { extractErrorMessage } from '@/lib/error-utils';
import { queryKeys } from '@/lib/query-keys';
import { supabase } from '@/lib/supabase';
import {
  formatLocalIsoDate,
  getIstCalendarParts,
  inferPropertyGender,
  isValidIsoDate,
  normalizeIndianPhoneDigits,
  PropertyGenderType,
  ResidentGender,
  validateIndianPhone,
} from '@/lib/ux-utils';
import { ResidentUpdatePatch } from '@/services/residents.service';
import {
  EditResidentDangerZone,
  EditResidentPortalSection,
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
  StatusBadge,
} from '@/components/ui/owner';

interface ResidentData {
  id: string;
  property_id: string;
  propertyName: string;
  propertyGender: PropertyGenderType;
  profile_id: string | null;
  full_name: string;
  phone_number: string | null;
  room_number: string;
  bed_label: string | null;
  gender: ResidentGender | null;
  joining_date: string | null;
  monthly_rent_paise: number;
  deposit_paise: number;
  emergency_contact: string | null;
  notes: string | null;
  is_active: boolean;
  profile?: {
    id: string;
    full_name: string;
  } | null;
}

interface LoadedFormValues {
  fullName: string;
  gender: ResidentGender;
  roomNumber: string;
  bedLabel: string;
  phoneNumber: string;
  joiningDate: string;
  monthlyRent: string;
  depositAmount: string;
  emergencyContact: string;
  notes: string;
}

interface RpcResponse {
  success: boolean;
  message?: string;
  error?: string;
  resident_id?: string;
  profile_id?: string;
}

const getTodayIsoDate = formatLocalIsoDate;

function parseRupeesToPaise(raw: string): { valid: boolean; paise: number } {
  const trimmed = raw.trim();
  if (!trimmed) return { valid: true, paise: 0 };
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num < 0) {
    return { valid: false, paise: 0 };
  }
  return { valid: true, paise: Math.round(num * 100) };
}

function paiseToRupeesInput(paise: number): string {
  if (!Number.isFinite(paise) || paise <= 0) return '';
  const rupees = paise / 100;
  return Number.isInteger(rupees) ? String(rupees) : rupees.toFixed(2);
}

export default function EditResidentScreen() {
  const { user } = useAuth();
  const { properties, selectedPropertyId } = useProperty();
  const { showToast } = useToast();
  const { id } = useLocalSearchParams<{ id?: string }>();

  const qc = useQueryClient();

  const [formDraft, setFormDraft] = useState<{
    residentId: string;
    edits: Partial<LoadedFormValues>;
  }>({ residentId: '', edits: {} });
  const [savedUpdatedAtOverride, setSavedUpdatedAtOverride] = useState<{
    residentId: string;
    updatedAt: string | null;
  } | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [studentEmail, setStudentEmail] = useState('');
  const [roomRefreshSignal, setRoomRefreshSignal] = useState(0);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoadError, setIsLoadError] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const clearError = useCallback(() => {
    setIsLoadError(false);
    setErrorMessage(null);
  }, []);

  const showFormError = useCallback((msg: string) => {
    setIsLoadError(false);
    setErrorMessage(msg);
  }, []);

  const profileQuery = useResidentProfileQuery(user?.id ? id : undefined);
  const linkedProfileQuery = useQuery<{ id: string; full_name: string } | null>({
    queryKey: ['residents', 'linkedProfile', profileQuery.data?.profileId ?? ''],
    enabled: Boolean(profileQuery.data?.profileId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('id', profileQuery.data!.profileId!)
        .maybeSingle();
      if (error) throw error;
      return (data as { id: string; full_name: string } | null) ?? null;
    },
  });
  const updatedAtFallbackQuery = useQuery<string | null>({
    queryKey: ['residents', 'updatedAtFallback', profileQuery.data?.id ?? ''],
    enabled: Boolean(profileQuery.data?.id && !profileQuery.data?.updatedAt),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('residents')
        .select('id, updated_at')
        .eq('id', profileQuery.data!.id)
        .maybeSingle();
      if (error) throw error;
      return (data as { updated_at?: string | null } | null)?.updated_at ?? null;
    },
  });
  const peersQuery = useActiveResidentPeersQuery(profileQuery.data?.propertyId);

  const updateResidentMutation = useUpdateResidentWithLockMutation();
  const checkoutMutation = useCheckoutResidentMutation();

  const linkStudentMutation = useMutation({
    mutationFn: async (input: { residentId: string; email: string }) => {
      const { data, error } = await supabase.rpc('link_resident_profile', {
        p_resident_id: input.residentId,
        p_student_email: input.email,
      });
      if (error) throw error;
      const res = data as RpcResponse | null;
      if (!res?.success) {
        throw new Error(res?.error || 'Failed to link resident account.');
      }
      return res;
    },
    onSuccess: () => {
      setSavedUpdatedAtOverride(null);
      void qc.invalidateQueries({ queryKey: queryKeys.residents.all });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    },
  });

  const unlinkStudentMutation = useMutation({
    mutationFn: async (residentId: string) => {
      const { data, error } = await supabase.rpc('unlink_resident_profile', {
        p_resident_id: residentId,
      });
      if (error) throw error;
      const res = data as RpcResponse | null;
      if (!res?.success) {
        throw new Error(res?.error || 'Failed to unlink resident account.');
      }
      return res;
    },
    onSuccess: () => {
      setSavedUpdatedAtOverride(null);
      void qc.invalidateQueries({ queryKey: queryKeys.residents.all });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    },
  });

  const saving = updateResidentMutation.isPending;
  const deactivating = checkoutMutation.isPending;
  const linking = linkStudentMutation.isPending;
  const unlinking = unlinkStudentMutation.isPending;
  const loading = Boolean(id) && (!user?.id || profileQuery.isLoading);

  const resident: ResidentData | null = useMemo(() => {
    const data = profileQuery.data;
    if (!data) return null;
    const ctxProp = properties.find((p) => p.id === data.propertyId);
    const resolvedPropGender =
      ctxProp?.gender_type ??
      inferPropertyGender(data.propertyName, data.propertyGender);

    return {
      id: data.id,
      property_id: data.propertyId,
      propertyName: data.propertyName,
      propertyGender: resolvedPropGender,
      profile_id: data.profileId,
      full_name: data.fullName,
      phone_number: data.phoneNumber,
      room_number: data.roomNumber,
      bed_label: data.bedLabel,
      gender: data.gender,
      joining_date: data.joiningDate,
      monthly_rent_paise: data.monthlyRentPaise,
      deposit_paise: data.depositPaise,
      emergency_contact: data.emergencyContact,
      notes: data.notes,
      is_active: data.isActive,
      profile: data.profileId ? (linkedProfileQuery.data ?? null) : null,
    };
  }, [profileQuery.data, properties, linkedProfileQuery.data]);

  const loadedUpdatedAt = useMemo(() => {
    if (!profileQuery.data) return null;
    if (
      savedUpdatedAtOverride &&
      savedUpdatedAtOverride.residentId === profileQuery.data.id
    ) {
      return savedUpdatedAtOverride.updatedAt;
    }
    return profileQuery.data.updatedAt ?? updatedAtFallbackQuery.data ?? null;
  }, [profileQuery.data, savedUpdatedAtOverride, updatedAtFallbackQuery.data]);

  const loadedForm: LoadedFormValues | null = useMemo(() => {
    if (!resident) return null;
    const initialGender: ResidentGender =
      resident.gender ?? (resident.propertyGender === 'girls' ? 'female' : 'male');
    const normalizedPhone = normalizeIndianPhoneDigits(resident.phone_number);
    const initialPhone = normalizedPhone || (resident.phone_number || '').trim();
    const initialJoining = resident.joining_date || getTodayIsoDate();

    return {
      fullName: resident.full_name.trim(),
      gender: initialGender,
      roomNumber: resident.room_number.trim(),
      bedLabel: (resident.bed_label || '').trim(),
      phoneNumber: initialPhone,
      joiningDate: initialJoining,
      monthlyRent: paiseToRupeesInput(resident.monthly_rent_paise),
      depositAmount: paiseToRupeesInput(resident.deposit_paise),
      emergencyContact: (resident.emergency_contact || '').trim(),
      notes: (resident.notes || '').trim(),
    };
  }, [resident]);

  const activeEdits = useMemo(
    () => (formDraft.residentId === (resident?.id ?? '') ? formDraft.edits : {}),
    [formDraft, resident?.id]
  );

  const fullName = activeEdits.fullName ?? loadedForm?.fullName ?? '';
  const gender = activeEdits.gender ?? loadedForm?.gender ?? 'male';
  const roomNumber = activeEdits.roomNumber ?? loadedForm?.roomNumber ?? '';
  const bedLabel = activeEdits.bedLabel ?? loadedForm?.bedLabel ?? '';
  const phoneNumber = activeEdits.phoneNumber ?? loadedForm?.phoneNumber ?? '';
  const joiningDate =
    activeEdits.joiningDate ?? loadedForm?.joiningDate ?? getTodayIsoDate();
  const monthlyRent = activeEdits.monthlyRent ?? loadedForm?.monthlyRent ?? '';
  const depositAmount =
    activeEdits.depositAmount ?? loadedForm?.depositAmount ?? '';
  const emergencyContact =
    activeEdits.emergencyContact ?? loadedForm?.emergencyContact ?? '';
  const notes = activeEdits.notes ?? loadedForm?.notes ?? '';

  const setField = useCallback(
    <K extends keyof LoadedFormValues>(key: K, value: LoadedFormValues[K]) => {
      const targetId = resident?.id ?? '';
      setFormDraft((prev) => ({
        residentId: targetId,
        edits: {
          ...(prev.residentId === targetId ? prev.edits : {}),
          [key]: value,
        },
      }));
    },
    [resident?.id]
  );

  const setFullName = useCallback(
    (val: string) => setField('fullName', val),
    [setField]
  );
  const setGender = useCallback(
    (val: ResidentGender) => setField('gender', val),
    [setField]
  );
  const setRoomNumber = useCallback(
    (val: string) => setField('roomNumber', val),
    [setField]
  );
  const setBedLabel = useCallback(
    (val: string) => setField('bedLabel', val),
    [setField]
  );
  const setPhoneNumber = useCallback(
    (val: string) => setField('phoneNumber', val),
    [setField]
  );
  const setJoiningDate = useCallback(
    (val: string) => setField('joiningDate', val),
    [setField]
  );
  const setMonthlyRent = useCallback(
    (val: string) => setField('monthlyRent', val),
    [setField]
  );
  const setDepositAmount = useCallback(
    (val: string) => setField('depositAmount', val),
    [setField]
  );
  const setEmergencyContact = useCallback(
    (val: string) => setField('emergencyContact', val),
    [setField]
  );
  const setNotes = useCallback(
    (val: string) => setField('notes', val),
    [setField]
  );

  // Refs used exclusively inside effects/callbacks (never read/written during render)
  const isScreenFocusedRef = useRef(false);
  const initialResidentPropertyIdRef = useRef<string | null>(null);
  const initialSelectedPropertyIdRef = useRef<string | null>(null);
  const prevSelectedPropertyIdRef = useRef<string | null>(null);
  const hasExitedForPropertySwitchRef = useRef(false);

  useEffect(() => {
    if (resident?.property_id && !initialResidentPropertyIdRef.current) {
      initialResidentPropertyIdRef.current = resident.property_id;
    }
  }, [resident?.property_id]);

  useFocusEffect(
    useCallback(() => {
      isScreenFocusedRef.current = true;
      const initialPropId = initialResidentPropertyIdRef.current;
      const startSelectedId = initialSelectedPropertyIdRef.current;
      if (
        initialPropId &&
        selectedPropertyId &&
        startSelectedId &&
        selectedPropertyId !== startSelectedId &&
        selectedPropertyId !== initialPropId &&
        !hasExitedForPropertySwitchRef.current
      ) {
        hasExitedForPropertySwitchRef.current = true;
        router.replace('/residents-directory' as unknown as Href);
      }
      return () => {
        isScreenFocusedRef.current = false;
      };
    }, [selectedPropertyId])
  );

  // Property-switch discard guard: discard unsaved edits & exit if active property changes while open
  useEffect(() => {
    if (!selectedPropertyId) return;

    if (!initialSelectedPropertyIdRef.current) {
      initialSelectedPropertyIdRef.current = selectedPropertyId;
    }

    const prevPropId = prevSelectedPropertyIdRef.current;
    prevSelectedPropertyIdRef.current = selectedPropertyId;

    const residentPropId = initialResidentPropertyIdRef.current ?? resident?.property_id ?? null;
    if (!residentPropId) return;
    if (!isScreenFocusedRef.current || hasExitedForPropertySwitchRef.current) return;

    if (
      prevPropId &&
      prevPropId !== selectedPropertyId &&
      selectedPropertyId !== residentPropId
    ) {
      hasExitedForPropertySwitchRef.current = true;
      router.replace('/residents-directory' as unknown as Href);
    }
  }, [selectedPropertyId, resident?.property_id]);

  // Check if form has unsaved changes
  const hasChanges = useMemo(() => {
    if (!resident || !loadedForm) return false;
    return (
      fullName.trim() !== loadedForm.fullName ||
      gender !== loadedForm.gender ||
      roomNumber.trim() !== loadedForm.roomNumber ||
      bedLabel.trim() !== loadedForm.bedLabel ||
      phoneNumber.trim() !== loadedForm.phoneNumber ||
      joiningDate.trim() !== loadedForm.joiningDate ||
      monthlyRent.trim() !== loadedForm.monthlyRent ||
      depositAmount.trim() !== loadedForm.depositAmount ||
      emergencyContact.trim() !== loadedForm.emergencyContact ||
      notes.trim() !== loadedForm.notes
    );
  }, [
    resident,
    loadedForm,
    fullName,
    gender,
    roomNumber,
    bedLabel,
    phoneNumber,
    joiningDate,
    monthlyRent,
    depositAmount,
    emergencyContact,
    notes,
  ]);

  const activePropertyGender: PropertyGenderType = useMemo(() => {
    if (!resident) return 'coed';
    const ctxProp = properties.find((p) => p.id === resident.property_id);
    return (
      ctxProp?.gender_type ??
      inferPropertyGender(resident.propertyName, resident.propertyGender)
    );
  }, [properties, resident]);

  const duplicatePhoneResident = useMemo(() => {
    if (!resident) return null;
    const normalized = normalizeIndianPhoneDigits(phoneNumber);
    if (!normalized) return null;
    const peers = peersQuery.data ?? [];
    return (
      peers.find(
        (r) =>
          r.id !== resident.id &&
          normalizeIndianPhoneDigits(r.phone_number) === normalized
      ) ?? null
    );
  }, [peersQuery.data, phoneNumber, resident]);

  const refetchProfile = profileQuery.refetch;
  const refetchPeers = peersQuery.refetch;

  const handleReloadLatest = useCallback(() => {
    clearError();
    setSuccessMessage(null);
    setFormDraft({ residentId: '', edits: {} });
    setSavedUpdatedAtOverride(null);
    setRoomRefreshSignal((n) => n + 1);
    void Promise.all([refetchProfile(), refetchPeers()]);
  }, [clearError, refetchPeers, refetchProfile]);

  // Back navigation with unsaved changes confirmation
  const handleBack = () => {
    const exit = () => {
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/residents-directory' as unknown as Href);
      }
    };

    if (hasChanges) {
      Alert.alert(
        'Unsaved Changes',
        'You have unsaved changes. Are you sure you want to discard them?',
        [
          { text: 'Stay Here', style: 'cancel' },
          {
            text: 'Discard & Exit',
            style: 'destructive',
            onPress: exit,
          },
        ]
      );
    } else {
      exit();
    }
  };

  // 2. Handle Edit / Update Resident Details with Optimistic Concurrency Lock
  const handleSave = async () => {
    if (!user?.id) {
      Alert.alert('Authentication Required', 'You must be signed in as an owner.');
      return;
    }

    if (!resident) {
      Alert.alert('Error', 'Resident details not loaded.');
      return;
    }

    // Defense-in-depth property-switch guard
    const startSelectedId = initialSelectedPropertyIdRef.current;
    if (
      selectedPropertyId &&
      startSelectedId &&
      selectedPropertyId !== startSelectedId &&
      selectedPropertyId !== resident.property_id
    ) {
      router.replace('/residents-directory' as unknown as Href);
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
    const trimmedNotes = notes.trim();

    if (!trimmedName) {
      showFormError('Full name cannot be empty.');
      return;
    }

    if (!trimmedRoom) {
      showFormError('Please select a room and bed.');
      return;
    }

    if (trimmedRoom !== resident.room_number && !trimmedBed) {
      showFormError('Please select a free bed in the chosen room.');
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

    if (updateResidentMutation.isPending) return;

    clearError();
    setSuccessMessage(null);

    try {
      const patch: ResidentUpdatePatch = {
        full_name: trimmedName,
        room_number: trimmedRoom,
        bed_label: trimmedBed || null,
        phone_number: phoneValidation.normalized10,
        gender,
        joining_date: trimmedJoiningDate,
        monthly_rent_paise: rentParsed.paise,
        deposit_paise: depositParsed.paise,
        emergency_contact: trimmedEmergency || null,
        notes: trimmedNotes || null,
      };

      const outcome = await updateResidentMutation.mutateAsync({
        residentId: resident.id,
        propertyId: resident.property_id,
        loadedUpdatedAt,
        patch,
      });

      if (outcome.status === 'stale') {
        Alert.alert(
          'Updated Elsewhere',
          outcome.message ||
            'This resident was updated on another device. Reload the latest details before saving.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Reload Latest',
              onPress: handleReloadLatest,
            },
          ]
        );
        return;
      }

      if (outcome.status === 'bed_taken' || outcome.status === 'gender_mismatch') {
        setRoomRefreshSignal((n) => n + 1);
        showFormError(outcome.message);
        Alert.alert(
          outcome.status === 'bed_taken'
            ? 'Bed No Longer Available'
            : 'Gender Policy Mismatch',
          outcome.message
        );
        return;
      }

      setSavedUpdatedAtOverride({
        residentId: resident.id,
        updatedAt: outcome.updatedAt,
      });
      setFormDraft({ residentId: resident.id, edits: {} });
      setSuccessMessage('Resident details updated successfully.');

      showToast(`${trimmedName}'s details updated.`);
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/residents-directory' as unknown as Href);
      }
    } catch (err: unknown) {
      const msg = extractErrorMessage(err, 'Operation failed. Please try again.');
      console.error('[EditResident] Update error:', err);
      showFormError(`Update Failed: ${msg}`);
    }
  };

  // 3. Handle Link Student Account (Owner RPC)
  const handleLinkStudent = async () => {
    if (!user?.id || !resident || linkStudentMutation.isPending) return;

    const trimmedEmail = studentEmail.trim().toLowerCase();
    if (!trimmedEmail) {
      showFormError('Please enter the resident account email address.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      showFormError('Please enter a valid email address.');
      return;
    }

    clearError();
    setSuccessMessage(null);

    try {
      const res = await linkStudentMutation.mutateAsync({
        residentId: resident.id,
        email: trimmedEmail,
      });

      const successMsg = res.message || 'Resident account linked successfully.';
      setSuccessMessage(successMsg);
      setStudentEmail('');
      showToast(successMsg);
    } catch (err: unknown) {
      const msg = extractErrorMessage(err, 'Operation failed. Please try again.');
      showFormError(msg);
    }
  };

  // 4. Handle Unlink Student Account (with confirmation)
  const handleConfirmUnlink = () => {
    if (!resident) return;

    Alert.alert(
      'Unlink Resident Account?',
      `Are you sure you want to unlink the resident account from ${resident.full_name} (Room ${resident.room_number})?\n\n• The resident will no longer have access to this room in their portal.\n• Historical billing and gate logs remain untouched.`,
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
    if (!user?.id || !resident || unlinkStudentMutation.isPending) return;

    clearError();
    setSuccessMessage(null);

    try {
      const res = await unlinkStudentMutation.mutateAsync(resident.id);

      const successMsg = res.message || 'Resident account unlinked successfully.';
      setSuccessMessage(successMsg);
      showToast(successMsg);
    } catch (err: unknown) {
      const msg = extractErrorMessage(err, 'Operation failed. Please try again.');
      showFormError(msg);
    }
  };

  // 5. Handle Deactivate Resident (Soft Deactivation: is_active = false + cleanup)
  const handleConfirmDeactivate = () => {
    if (!resident) return;

    Alert.alert(
      'Deactivate Resident?',
      `Are you sure you want to deactivate ${resident.full_name} (Room ${resident.room_number})?\n\n• They will no longer appear in active attendance lists and any active washing machine session is released.\n• All previous payments, receipts, unpaid bills, and gate history are strictly preserved.\n• This action does NOT delete any historical data.`,
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
    if (!resident || !user?.id || checkoutMutation.isPending) return;

    clearError();
    setSuccessMessage(null);

    try {
      await checkoutMutation.mutateAsync({
        residentId: resident.id,
        propertyId: resident.property_id,
        leavingDateIso: getIstCalendarParts().isoDate,
        generateFinalBill: false,
        finalBillPaise: 0,
      });

      showToast(`${resident.full_name} deactivated. Historical records preserved.`);
      router.replace('/(tabs)');
    } catch (err: unknown) {
      const msg = extractErrorMessage(err, 'Operation failed. Please try again.');
      showFormError(`Deactivation Failed: ${msg}`);
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

  const displayErrorMessage =
    errorMessage ??
    (!id
      ? 'No resident ID provided.'
      : profileQuery.error
        ? `Failed to load resident: ${profileQuery.error.message}`
        : null);
  const displayIsLoadError =
    isLoadError || (Boolean(id) && Boolean(profileQuery.error));

  const isLinked = Boolean(resident?.profile_id);

  return (
    <SafeAreaView style={styles.safeArea}>
      <OwnerHeader
        title="Edit Resident"
        subtitle={
          resident
            ? `${resident.full_name} • Room ${resident.room_number}${
                resident.bed_label ? ` (${resident.bed_label})` : ''
              }`
            : ''
        }
        showBack
        onBack={handleBack}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
        style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled">
          {displayErrorMessage && (
            displayIsLoadError || (!resident && Boolean(id)) ? (
              <ErrorState
                message={displayErrorMessage}
                onRetry={handleReloadLatest}
              />
            ) : (
              <View style={styles.validationErrorBanner}>
                <AlertCircle
                  size={18}
                  color={OwnerTheme.colors.danger}
                  style={{ marginRight: 8, marginTop: 1 }}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.validationErrorText}>
                    {displayErrorMessage}
                  </Text>
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

          {successMessage && (
            <View style={styles.successBanner}>
              <CheckCircle2 size={16} color={OwnerTheme.colors.success} />
              <Text style={styles.successBannerText}>{successMessage}</Text>
            </View>
          )}

          {resident ? (
            <>
              {/* Section A: Resident Information */}
              <View style={styles.sectionCard}>
                <View style={styles.sectionHeader}>
                  <View>
                    <Text style={styles.sectionTitle}>Resident Information</Text>
                    <Text style={styles.sectionSubtitle}>
                      {resident.propertyName}
                    </Text>
                  </View>
                  <StatusBadge
                    label={resident.is_active ? 'ACTIVE' : 'INACTIVE'}
                    variant={resident.is_active ? 'success' : 'neutral'}
                    size="sm"
                  />
                </View>

                {/* Full Name */}
                <View style={styles.fieldGroup}>
                  <Text style={OwnerSharedStyles.inputLabel}>Full Name *</Text>
                  <TextInput
                    style={OwnerSharedStyles.textInput}
                    value={fullName}
                    onChangeText={(val) => {
                      setFullName(val);
                      setErrorMessage(null);
                      setSuccessMessage(null);
                    }}
                    placeholder="e.g. Arun Kumar"
                    placeholderTextColor={OwnerTheme.colors.textMuted}
                    autoCapitalize="words"
                  />
                </View>

                <ResidentGenderField
                  gender={gender}
                  onSelect={(val) => {
                    setGender(val);
                    setErrorMessage(null);
                    setSuccessMessage(null);
                  }}
                />

                {/* Unified Room & Bed Picker */}
                <View style={styles.pickerGroup}>
                  <RoomBedPicker
                    propertyId={resident.property_id}
                    propertyGender={activePropertyGender}
                    residentGender={gender}
                    selectedRoomNumber={roomNumber}
                    selectedBedLabel={bedLabel}
                    excludeResidentId={resident.id}
                    refreshSignal={roomRefreshSignal}
                    onSelect={(room, bed) => {
                      setRoomNumber(room);
                      setBedLabel(bed);
                      setErrorMessage(null);
                      setSuccessMessage(null);
                    }}
                  />
                </View>

                <ResidentPhoneField
                  value={phoneNumber}
                  onChangeText={(val) => {
                    setPhoneNumber(val);
                    setErrorMessage(null);
                    setSuccessMessage(null);
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
                    setErrorMessage(null);
                    setSuccessMessage(null);
                  }}
                  onChangeDeposit={(val) => {
                    setDepositAmount(val);
                    setErrorMessage(null);
                    setSuccessMessage(null);
                  }}
                />

                {/* Emergency Contact */}
                <View style={styles.fieldGroup}>
                  <Text style={OwnerSharedStyles.inputLabel}>Emergency Contact</Text>
                  <TextInput
                    style={OwnerSharedStyles.textInput}
                    value={emergencyContact}
                    onChangeText={(val) => {
                      setEmergencyContact(val);
                      setErrorMessage(null);
                      setSuccessMessage(null);
                    }}
                    placeholder="Parent / guardian phone or name (optional)"
                    placeholderTextColor={OwnerTheme.colors.textMuted}
                  />
                </View>

                {/* Private Owner Notes */}
                <View style={styles.fieldGroup}>
                  <Text style={OwnerSharedStyles.inputLabel}>Private Owner Notes</Text>
                  <TextInput
                    style={styles.notesInput}
                    value={notes}
                    onChangeText={(val) => {
                      setNotes(val);
                      setErrorMessage(null);
                      setSuccessMessage(null);
                    }}
                    placeholder="Internal remarks, ID verification details, rent concessions..."
                    placeholderTextColor={OwnerTheme.colors.textMuted}
                    multiline
                    numberOfLines={3}
                    textAlignVertical="top"
                  />
                  <Text style={styles.helperText}>
                    Private to PG owners — never visible to the resident.
                  </Text>
                </View>

                <PrimaryButton
                  label="Save Changes"
                  onPress={handleSave}
                  loading={saving}
                  disabled={!hasChanges || saving}
                  style={{ marginTop: 6 }}
                />
              </View>

              <EditResidentPortalSection
                isLinked={isLinked}
                linkedProfileName={resident.profile?.full_name}
                studentEmail={studentEmail}
                unlinking={unlinking}
                linking={linking}
                onChangeEmail={(val) => {
                  setStudentEmail(val);
                  setErrorMessage(null);
                }}
                onUnlink={handleConfirmUnlink}
                onLink={handleLinkStudent}
              />

              <EditResidentDangerZone
                isActive={resident.is_active}
                deactivating={deactivating}
                onDeactivate={handleConfirmDeactivate}
              />
            </>
          ) : null}

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      <CalendarDatePickerModal
        visible={showDatePicker}
        value={joiningDate}
        title="Select Joining Date"
        onSelect={(iso) => {
          setJoiningDate(iso);
          setErrorMessage(null);
          setSuccessMessage(null);
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
  sectionSubtitle: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 2,
  },
  fieldGroup: {
    marginBottom: 14,
  },
  pickerGroup: {
    marginBottom: 14,
  },
  notesInput: {
    minHeight: 88,
    borderRadius: OwnerTheme.radius.md,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: OwnerTheme.colors.textPrimary,
    backgroundColor: '#FFFFFF',
  },
  helperText: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 6,
  },
});
