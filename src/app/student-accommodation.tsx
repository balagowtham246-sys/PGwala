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
import { router } from 'expo-router';
import {
  BedDouble,
  Building2,
  CheckCircle2,
  Clock,
  Edit3,
  Mail,
  MapPin,
  Phone,
  Shield,
  User,
} from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/context/toast-context';
import { formatPaiseToRupees } from '@/lib/billing-utils';
import { triggerSelectionHaptic, triggerSuccessHaptic } from '@/lib/haptics';
import {
  formatIsoDateDisplay,
  formatRoomLabel,
  toSentenceCaseStatus,
} from '@/lib/ux-utils';
import {
  EmptyState,
  ErrorState,
  OwnerHeader,
  PrimaryButton,
  SecondaryButton,
} from '@/components/ui/owner';
import {
  fetchResidentAccommodation,
  ResidentAccommodationDetails,
  updateResidentEmergencyContact,
} from '@/services/resident-portal.service';

export default function ResidentAccommodationScreen() {
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const userId = user?.id;

  const [loading, setLoading] = useState(true);
  const [accommodation, setAccommodation] = useState<ResidentAccommodationDetails | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [isEditingEmergency, setIsEditingEmergency] = useState(false);
  const [emergencyDraft, setEmergencyDraft] = useState('');
  const [savingEmergency, setSavingEmergency] = useState(false);

  const loadAccommodation = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    setErrorMessage(null);
    const res = await fetchResidentAccommodation(userId);
    if (res.ok) {
      setAccommodation(res.data);
      setErrorMessage(null);
    } else {
      setErrorMessage(res.error.message || 'Could not load accommodation details.');
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      if (active) {
        void loadAccommodation();
      }
    }, 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [loadAccommodation]);

  const handleStartEditEmergency = () => {
    triggerSelectionHaptic();
    setEmergencyDraft(accommodation?.emergencyContact ?? '');
    setIsEditingEmergency(true);
  };

  const handleCancelEditEmergency = () => {
    setIsEditingEmergency(false);
    setEmergencyDraft('');
  };

  const handleSaveEmergency = async () => {
    if (!accommodation || savingEmergency) return;
    setSavingEmergency(true);
    try {
      const res = await updateResidentEmergencyContact(
        accommodation.residentId,
        emergencyDraft
      );
      if (!res.ok) {
        Alert.alert(
          'Update Failed',
          res.error.message || 'Could not save emergency contact.'
        );
        return;
      }
      setAccommodation((prev) =>
        prev ? { ...prev, emergencyContact: res.data.emergencyContact } : prev
      );
      setIsEditingEmergency(false);
      triggerSuccessHaptic();
      showToast('Emergency contact updated');
    } finally {
      setSavingEmergency(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <OwnerHeader
        title="My Information"
        subtitle="Resident profile and PG details"
        showBack
        onBack={() =>
          router.canGoBack() ? router.back() : router.replace('/student-dashboard')
        }
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled">
          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="small" color={OwnerTheme.colors.primary} />
              <Text style={styles.loadingText}>Loading accommodation...</Text>
            </View>
          ) : errorMessage ? (
            <ErrorState
              message={errorMessage}
              onRetry={() => {
                setLoading(true);
                void loadAccommodation();
              }}
            />
          ) : !accommodation ? (
            <EmptyState
              title="Awaiting Room Allocation"
              description="Your resident profile has not yet been linked to a room by your PG owner."
            />
          ) : (
            <>
              {/* Resident Personal Info Card */}
              <View style={styles.card}>
                <Text style={styles.sectionLabel}>Resident Details</Text>
                <View style={styles.infoRow}>
                  <User size={16} color={OwnerTheme.colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.infoLabel}>Full Name</Text>
                    <Text style={styles.infoValue}>{profile?.full_name || 'Resident'}</Text>
                  </View>
                </View>
                <View style={styles.infoRow}>
                  <Mail size={16} color={OwnerTheme.colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.infoLabel}>Login Email</Text>
                    <Text style={styles.infoValue}>{user?.email || '—'}</Text>
                  </View>
                </View>
                <View style={styles.infoRow}>
                  <Phone size={16} color={OwnerTheme.colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.infoLabel}>Contact Phone</Text>
                    <Text style={styles.infoValue}>{profile?.phone_number || 'Not added yet'}</Text>
                  </View>
                </View>
                <Pressable
                  style={styles.editLinkBtn}
                  onPress={() => router.push('/student-profile-edit')}>
                  <Text style={styles.editLinkText}>Edit Phone or Password ›</Text>
                </Pressable>
              </View>

              {/* Primary Room Card */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Building2 size={20} color={OwnerTheme.colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.propertyName}>{accommodation.propertyName}</Text>
                    {accommodation.propertyAddress ? (
                      <View style={styles.addressRow}>
                        <MapPin size={13} color={OwnerTheme.colors.textMuted} />
                        <Text style={styles.addressText} numberOfLines={1}>
                          {accommodation.propertyAddress}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <View style={styles.activeBadge}>
                    <CheckCircle2 size={13} color="#FFFFFF" />
                    <Text style={styles.activeBadgeText}>
                      {toSentenceCaseStatus('active')}
                    </Text>
                  </View>
                </View>

                <View style={styles.divider} />

                <View style={styles.detailsGrid}>
                  <View style={styles.detailCol}>
                    <Text style={styles.detailLabel}>Assigned Room</Text>
                    <Text style={styles.detailValue}>
                      {formatRoomLabel(accommodation.roomNumber)}
                    </Text>
                  </View>
                  <View style={styles.detailCol}>
                    <Text style={styles.detailLabel}>Resident Status</Text>
                    <Text style={[styles.detailValue, { color: OwnerTheme.colors.success }]}>
                      Enrolled Resident
                    </Text>
                  </View>
                </View>
              </View>

              {/* Stay & Bed Details Card */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <BedDouble size={18} color={OwnerTheme.colors.primary} />
                  <Text style={styles.cardTitle}>Stay & Bed Details</Text>
                </View>

                <View style={styles.stayRow}>
                  <Text style={styles.contactLabel}>Room & Bed</Text>
                  <Text style={styles.contactValue}>
                    {formatRoomLabel(accommodation.roomNumber)} ·{' '}
                    {accommodation.bedLabel || 'Not assigned'}
                  </Text>
                </View>

                <View style={styles.stayRow}>
                  <Text style={styles.contactLabel}>Joining Date</Text>
                  <Text style={styles.contactValue}>
                    {formatIsoDateDisplay(accommodation.joiningDate)}
                  </Text>
                </View>

                <View style={styles.stayRow}>
                  <Text style={styles.contactLabel}>Monthly Rent</Text>
                  <Text style={styles.contactValue}>
                    {accommodation.monthlyRentPaise > 0
                      ? formatPaiseToRupees(accommodation.monthlyRentPaise)
                      : 'Set by PG owner'}
                  </Text>
                </View>

                <View style={styles.stayRow}>
                  <Text style={styles.contactLabel}>Security Deposit</Text>
                  <Text style={styles.contactValue}>
                    {accommodation.depositPaise > 0
                      ? formatPaiseToRupees(accommodation.depositPaise)
                      : '₹0'}
                  </Text>
                </View>

                <View style={[styles.emergencyBlock, isEditingEmergency && styles.emergencyBlockEditing]}>
                  <View style={styles.emergencyHeaderRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.contactLabel}>Emergency Contact</Text>
                      {!isEditingEmergency && (
                        <Text
                          style={[
                            styles.emergencyValue,
                            !accommodation.emergencyContact && styles.emergencyEmpty,
                          ]}>
                          {accommodation.emergencyContact || 'Not added yet'}
                        </Text>
                      )}
                    </View>
                    {!isEditingEmergency && (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Edit emergency contact"
                        hitSlop={8}
                        onPress={handleStartEditEmergency}
                        style={({ pressed }) => [
                          styles.inlineEditBtn,
                          pressed && styles.inlineEditBtnPressed,
                        ]}>
                        <Edit3 size={13} color={OwnerTheme.colors.primary} />
                        <Text style={styles.inlineEditText}>Edit</Text>
                      </Pressable>
                    )}
                  </View>

                  {isEditingEmergency && (
                    <View style={styles.emergencyEditForm}>
                      <TextInput
                        style={styles.emergencyInput}
                        value={emergencyDraft}
                        onChangeText={setEmergencyDraft}
                        keyboardType="phone-pad"
                        placeholder="Name or 10-digit contact"
                        placeholderTextColor={OwnerTheme.colors.textMuted}
                        editable={!savingEmergency}
                        maxLength={60}
                        autoFocus
                      />
                      <View style={styles.emergencyActionsRow}>
                        <SecondaryButton
                          label="Cancel"
                          onPress={handleCancelEditEmergency}
                          disabled={savingEmergency}
                          style={styles.emergencyActionBtn}
                        />
                        <PrimaryButton
                          label="Save"
                          onPress={() => void handleSaveEmergency()}
                          loading={savingEmergency}
                          style={styles.emergencyActionBtn}
                        />
                      </View>
                    </View>
                  )}
                </View>
              </View>

              {/* Management Contact Card */}
              {accommodation.ownerName ? (
                <View style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Shield size={18} color={OwnerTheme.colors.primary} />
                    <Text style={styles.cardTitle}>PG Management & Warden</Text>
                  </View>

                  <View style={styles.contactRow}>
                    <Text style={styles.contactLabel}>Administrator:</Text>
                    <Text style={styles.contactValue}>{accommodation.ownerName}</Text>
                  </View>
                  {accommodation.ownerPhone ? (
                    <View style={[styles.contactRow, styles.lastContactRow]}>
                      <Text style={styles.contactLabel}>Phone:</Text>
                      <Text style={styles.contactValue}>{accommodation.ownerPhone}</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              {/* Resident Guidelines Card */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Clock size={18} color={OwnerTheme.colors.textPrimary} />
                  <Text style={styles.cardTitle}>Resident Guidelines</Text>
                </View>

                <View style={styles.ruleItem}>
                  <Text style={styles.ruleBullet}>•</Text>
                  <Text style={styles.ruleText}>
                    <Text style={styles.ruleBold}>Gate Attendance:</Text> Mark Going Out whenever you leave the PG premises and confirm your dinner requirement.
                  </Text>
                </View>

                <View style={styles.ruleItem}>
                  <Text style={styles.ruleBullet}>•</Text>
                  <Text style={styles.ruleText}>
                    <Text style={styles.ruleBold}>Washing Machine:</Text> Please mark the machine as FREE once your wash cycle completes so fellow residents can use it.
                  </Text>
                </View>

                <View style={styles.ruleItem}>
                  <Text style={styles.ruleBullet}>•</Text>
                  <Text style={styles.ruleText}>
                    <Text style={styles.ruleBold}>Maintenance:</Text> Report room issues promptly via the Complaints tab for rapid resolution.
                  </Text>
                </View>
              </View>
            </>
          )}

          <View style={{ height: 32 }} />
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
    padding: 16,
    gap: 14,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
  },
  loadingBox: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 8,
    fontSize: 13,
    color: OwnerTheme.colors.textSecondary,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  propertyName: {
    fontSize: 16,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  addressText: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
  },
  activeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: OwnerTheme.colors.success,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: OwnerTheme.radius.full,
  },
  activeBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  divider: {
    height: 1,
    backgroundColor: OwnerTheme.colors.borderLight,
    marginVertical: 14,
  },
  detailsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  detailCol: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 12,
    color: OwnerTheme.colors.textMuted,
  },
  detailValue: {
    fontSize: 15,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
    marginTop: 4,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  stayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: OwnerTheme.colors.borderLight,
    gap: 12,
  },
  emergencyBlock: {
    paddingTop: 12,
    gap: 10,
  },
  emergencyBlockEditing: {
    paddingBottom: 2,
  },
  emergencyHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  emergencyValue: {
    fontSize: 14,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
    marginTop: 3,
  },
  emergencyEmpty: {
    color: OwnerTheme.colors.textMuted,
    fontWeight: '500',
  },
  inlineEditBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: OwnerTheme.radius.full,
    backgroundColor: OwnerTheme.colors.primaryLight,
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  inlineEditBtnPressed: {
    opacity: 0.78,
  },
  inlineEditText: {
    fontSize: 12,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  emergencyEditForm: {
    gap: 10,
  },
  emergencyInput: {
    height: 46,
    borderRadius: OwnerTheme.radius.md,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    backgroundColor: OwnerTheme.colors.surfaceElevated,
    paddingHorizontal: 12,
    fontSize: 14,
    color: OwnerTheme.colors.textPrimary,
  },
  emergencyActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  emergencyActionBtn: {
    flex: 1,
    height: 44,
  },
  contactRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: OwnerTheme.colors.borderLight,
  },
  lastContactRow: {
    borderBottomWidth: 0,
    paddingBottom: 2,
  },
  contactLabel: {
    fontSize: 13,
    color: OwnerTheme.colors.textSecondary,
  },
  contactValue: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  ruleItem: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  ruleBullet: {
    fontSize: 14,
    color: OwnerTheme.colors.primary,
    fontWeight: '800',
  },
  ruleText: {
    flex: 1,
    fontSize: 13,
    color: OwnerTheme.colors.textSecondary,
    lineHeight: 18,
  },
  ruleBold: {
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: OwnerTheme.colors.textSecondary,
    marginBottom: 8,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: OwnerTheme.colors.borderLight,
  },
  infoLabel: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
  },
  infoValue: {
    fontSize: 15,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
    marginTop: 2,
  },
  editLinkBtn: {
    paddingTop: 12,
    alignItems: 'flex-end',
  },
  editLinkText: {
    fontSize: 13,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
});

