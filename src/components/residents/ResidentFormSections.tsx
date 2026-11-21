import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Href, router } from 'expo-router';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Eye,
  EyeOff,
  RefreshCw,
} from 'lucide-react-native';

import {
  DestructiveButton,
  OwnerSharedStyles,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
} from '@/components/ui/owner';
import { OwnerTheme } from '@/constants/theme';
import { formatIsoDateDisplay, ResidentGender } from '@/lib/ux-utils';

export const RESIDENT_GENDER_OPTIONS: {
  value: ResidentGender;
  label: string;
}[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
];

export function ResidentGenderField({
  gender,
  onSelect,
}: {
  gender: ResidentGender;
  onSelect: (val: ResidentGender) => void;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={OwnerSharedStyles.inputLabel}>Gender *</Text>
      <View style={styles.chipRow}>
        {RESIDENT_GENDER_OPTIONS.map((opt) => {
          const isSelected = gender === opt.value;
          return (
            <Pressable
              key={opt.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              onPress={() => onSelect(opt.value)}
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
  );
}

export function ResidentPhoneField({
  value,
  onChangeText,
  duplicatePhoneResident,
}: {
  value: string;
  onChangeText: (val: string) => void;
  duplicatePhoneResident: { full_name: string; room_number: string } | null;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={OwnerSharedStyles.inputLabel}>Phone Number *</Text>
      <View style={styles.prefixedInputWrap}>
        <View style={styles.prefixBadge}>
          <Text style={styles.prefixText}>+91</Text>
        </View>
        <TextInput
          style={styles.prefixedTextInput}
          placeholder="Enter 10-digit mobile number"
          placeholderTextColor={OwnerTheme.colors.textMuted}
          value={value}
          onChangeText={onChangeText}
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
            {duplicatePhoneResident.room_number}) in this property.
          </Text>
        </View>
      )}
    </View>
  );
}

export function ResidentJoiningDateField({
  joiningDate,
  onOpenPicker,
}: {
  joiningDate: string;
  onOpenPicker: () => void;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={OwnerSharedStyles.inputLabel}>Joining Date *</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Select joining date"
        onPress={onOpenPicker}
        style={({ pressed }) => [
          styles.datePickerBtn,
          pressed && styles.datePickerBtnPressed,
        ]}>
        <View style={styles.datePickerBtnLeft}>
          <Calendar size={18} color={OwnerTheme.colors.primary} />
          <Text style={styles.datePickerBtnText}>
            {formatIsoDateDisplay(joiningDate)}
          </Text>
        </View>
        <Text style={styles.datePickerChangeText}>Select</Text>
      </Pressable>
    </View>
  );
}

export function ResidentRentDepositRow({
  monthlyRent,
  depositAmount,
  onChangeRent,
  onChangeDeposit,
}: {
  monthlyRent: string;
  depositAmount: string;
  onChangeRent: (val: string) => void;
  onChangeDeposit: (val: string) => void;
}) {
  return (
    <View style={styles.twoColRow}>
      <View style={[styles.fieldGroup, { flex: 1 }]}>
        <Text style={OwnerSharedStyles.inputLabel}>Monthly Rent (₹)</Text>
        <View style={styles.prefixedInputWrap}>
          <View style={styles.prefixBadge}>
            <Text style={styles.prefixText}>₹</Text>
          </View>
          <TextInput
            style={styles.prefixedTextInput}
            placeholder="8000"
            placeholderTextColor={OwnerTheme.colors.textMuted}
            value={monthlyRent}
            onChangeText={(val) => onChangeRent(val.replace(/[^0-9.]/g, ''))}
            keyboardType="decimal-pad"
          />
        </View>
      </View>

      <View style={[styles.fieldGroup, { flex: 1 }]}>
        <Text style={OwnerSharedStyles.inputLabel}>Security Deposit (₹)</Text>
        <View style={styles.prefixedInputWrap}>
          <View style={styles.prefixBadge}>
            <Text style={styles.prefixText}>₹</Text>
          </View>
          <TextInput
            style={styles.prefixedTextInput}
            placeholder="10000"
            placeholderTextColor={OwnerTheme.colors.textMuted}
            value={depositAmount}
            onChangeText={(val) => onChangeDeposit(val.replace(/[^0-9.]/g, ''))}
            keyboardType="decimal-pad"
          />
        </View>
      </View>
    </View>
  );
}

export function AddResidentSuccessView({
  createdSummary,
  onResetForm,
}: {
  createdSummary: {
    id: string;
    fullName: string;
    propertyName: string;
    roomNumber: string;
    bedLabel?: string;
    joiningDate: string;
    email: string;
  };
  onResetForm: () => void;
}) {
  return (
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
          <Text style={styles.summaryValue}>{createdSummary.fullName}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>PG Property</Text>
          <Text style={styles.summaryValue}>{createdSummary.propertyName}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Room & Bed</Text>
          <Text style={styles.summaryValue}>
            Room {createdSummary.roomNumber}
            {createdSummary.bedLabel ? ` · ${createdSummary.bedLabel}` : ''}
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
          <Text style={styles.summaryValue}>{createdSummary.email}</Text>
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
        <SecondaryButton label="Add Another Resident" onPress={onResetForm} />
      </View>
    </View>
  );
}

export function AddResidentAccountStep({
  email,
  temporaryPassword,
  showPassword,
  saving,
  onChangeEmail,
  onChangePassword,
  onToggleShowPassword,
  onGeneratePassword,
  onBack,
  onSave,
}: {
  email: string;
  temporaryPassword: string;
  showPassword: boolean;
  saving: boolean;
  onChangeEmail: (val: string) => void;
  onChangePassword: (val: string) => void;
  onToggleShowPassword: () => void;
  onGeneratePassword: () => void;
  onBack: () => void;
  onSave: () => void;
}) {
  return (
    <View style={styles.formCard}>
      <Text style={styles.formSectionTitle}>Resident Portal Login</Text>
      <Text style={styles.formSectionSubtitle}>
        Provide the email and temporary password for the resident to log into
        their PG app.
      </Text>

      <View style={styles.fieldGroup}>
        <Text style={OwnerSharedStyles.inputLabel}>Resident Login Email *</Text>
        <TextInput
          style={OwnerSharedStyles.textInput}
          placeholder="resident@example.com"
          placeholderTextColor={OwnerTheme.colors.textMuted}
          value={email}
          onChangeText={onChangeEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <View style={styles.fieldGroup}>
        <View style={styles.labelRow}>
          <Text style={OwnerSharedStyles.inputLabel}>Temporary Password *</Text>
          <Pressable
            hitSlop={8}
            onPress={onGeneratePassword}
            style={styles.generateBtn}>
            <RefreshCw size={12} color={OwnerTheme.colors.primary} />
            <Text style={styles.generateBtnText}>Auto-Generate</Text>
          </Pressable>
        </View>
        <View style={styles.passwordInputWrap}>
          <TextInput
            style={[OwnerSharedStyles.textInput, { flex: 1, borderWidth: 0 }]}
            placeholder="At least 6 characters"
            placeholderTextColor={OwnerTheme.colors.textMuted}
            value={temporaryPassword}
            onChangeText={onChangePassword}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable
            hitSlop={8}
            style={styles.eyeBtn}
            onPress={onToggleShowPassword}>
            {showPassword ? (
              <EyeOff size={18} color={OwnerTheme.colors.textSecondary} />
            ) : (
              <Eye size={18} color={OwnerTheme.colors.textSecondary} />
            )}
          </Pressable>
        </View>
      </View>

      <View style={styles.step2Actions}>
        <SecondaryButton
          label="Back"
          onPress={onBack}
          style={{ flex: 1, marginRight: 8 }}
        />
        <PrimaryButton
          label="Create Resident"
          onPress={onSave}
          loading={saving}
          style={{ flex: 2 }}
        />
      </View>
    </View>
  );
}

export function EditResidentPortalSection({
  isLinked,
  linkedProfileName,
  studentEmail,
  unlinking,
  linking,
  onChangeEmail,
  onUnlink,
  onLink,
}: {
  isLinked: boolean;
  linkedProfileName: string | null | undefined;
  studentEmail: string;
  unlinking: boolean;
  linking: boolean;
  onChangeEmail: (val: string) => void;
  onUnlink: () => void;
  onLink: () => void;
}) {
  return (
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
              {linkedProfileName || 'Linked Student Account'}
            </Text>
            <Text style={styles.linkedAccountSub}>
              Account is active and linked to this resident profile.
            </Text>
          </View>
          <SecondaryButton
            label="Unlink"
            onPress={onUnlink}
            loading={unlinking}
            style={styles.unlinkBtn}
            textStyle={{ color: OwnerTheme.colors.danger, fontSize: 13 }}
          />
        </View>
      ) : (
        <View>
          <Text style={styles.portalExplanation}>
            Link this resident to a registered student account email so they can
            access their personal PG app.
          </Text>
          <View style={styles.fieldGroup}>
            <Text style={OwnerSharedStyles.inputLabel}>Student Login Email</Text>
            <TextInput
              style={OwnerSharedStyles.textInput}
              value={studentEmail}
              onChangeText={onChangeEmail}
              placeholder="student@example.com"
              placeholderTextColor={OwnerTheme.colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>
          <SecondaryButton
            label="Link Student Account"
            onPress={onLink}
            loading={linking}
          />
        </View>
      )}
    </View>
  );
}

export function EditResidentDangerZone({
  isActive,
  deactivating,
  onDeactivate,
}: {
  isActive: boolean;
  deactivating: boolean;
  onDeactivate: () => void;
}) {
  return (
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
        label={isActive ? 'Deactivate Resident' : 'Resident Already Inactive'}
        onPress={onDeactivate}
        loading={deactivating}
        disabled={!isActive || deactivating}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fieldGroup: {
    marginBottom: 14,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
  },
  segmentChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: OwnerTheme.radius.md,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    backgroundColor: OwnerTheme.colors.surfaceElevated,
    alignItems: 'center',
  },
  segmentChipActive: {
    backgroundColor: OwnerTheme.colors.primaryLight,
    borderColor: OwnerTheme.colors.primary,
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
  prefixedInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: OwnerTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    borderRadius: OwnerTheme.radius.md,
    overflow: 'hidden',
  },
  prefixBadge: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#EEF2F6',
    borderRightWidth: 1,
    borderRightColor: OwnerTheme.colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  prefixText: {
    fontSize: 14,
    fontWeight: '700',
    color: OwnerTheme.colors.textSecondary,
  },
  prefixedTextInput: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
    color: OwnerTheme.colors.textPrimary,
  },
  helperText: {
    fontSize: 11,
    color: OwnerTheme.colors.textMuted,
    marginTop: 5,
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: OwnerTheme.colors.warningLight,
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: OwnerTheme.radius.md,
    padding: 10,
  },
  warningText: {
    flex: 1,
    fontSize: 12,
    color: '#92400E',
    lineHeight: 17,
  },
  datePickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: OwnerTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    borderRadius: OwnerTheme.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  datePickerBtnPressed: {
    opacity: 0.78,
  },
  datePickerBtnLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  datePickerBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  datePickerChangeText: {
    fontSize: 13,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  twoColRow: {
    flexDirection: 'row',
    gap: 12,
  },
  formCard: {
    backgroundColor: OwnerTheme.colors.card,
    borderRadius: OwnerTheme.radius.card,
    padding: OwnerTheme.spacing.lg,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    ...OwnerTheme.shadow,
  },
  formSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
    marginBottom: 4,
  },
  formSectionSubtitle: {
    fontSize: 13,
    color: OwnerTheme.colors.textSecondary,
    marginBottom: 14,
    lineHeight: 18,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  generateBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  passwordInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: OwnerTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    borderRadius: OwnerTheme.radius.md,
    paddingRight: 10,
  },
  eyeBtn: {
    padding: 6,
  },
  step2Actions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  successCard: {
    backgroundColor: OwnerTheme.colors.card,
    borderRadius: OwnerTheme.radius.card,
    padding: OwnerTheme.spacing.xl,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    alignItems: 'center',
    ...OwnerTheme.shadow,
  },
  successIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: OwnerTheme.colors.successLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  successHeading: {
    fontSize: 20,
    fontWeight: '800',
    color: OwnerTheme.colors.textPrimary,
    marginBottom: 6,
  },
  successSubheading: {
    fontSize: 13,
    color: OwnerTheme.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 18,
  },
  summaryDetailsBox: {
    width: '100%',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    borderRadius: OwnerTheme.radius.md,
    padding: 14,
    gap: 10,
    marginBottom: 20,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  summaryLabel: {
    fontSize: 13,
    color: OwnerTheme.colors.textSecondary,
    fontWeight: '500',
  },
  summaryValue: {
    fontSize: 13,
    color: OwnerTheme.colors.textPrimary,
    fontWeight: '700',
    flexShrink: 1,
    textAlign: 'right',
  },
  successActions: {
    width: '100%',
  },
  sectionCard: {
    backgroundColor: OwnerTheme.colors.card,
    borderRadius: OwnerTheme.radius.card,
    padding: OwnerTheme.spacing.lg,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    marginBottom: 14,
    ...OwnerTheme.shadow,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  linkedInfoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: OwnerTheme.colors.successLight,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: OwnerTheme.radius.md,
    padding: 12,
  },
  linkedAccountName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#14532D',
  },
  linkedAccountSub: {
    fontSize: 12,
    color: '#166534',
    marginTop: 2,
  },
  unlinkBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 36,
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
  },
  portalExplanation: {
    fontSize: 13,
    color: OwnerTheme.colors.textSecondary,
    lineHeight: 18,
    marginBottom: 12,
  },
  dangerZoneCard: {
    backgroundColor: '#FFF5F5',
    borderRadius: OwnerTheme.radius.card,
    padding: OwnerTheme.spacing.lg,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  dangerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  dangerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: OwnerTheme.colors.danger,
  },
  dangerExplanation: {
    fontSize: 12,
    color: '#7F1D1D',
    lineHeight: 18,
    marginBottom: 12,
  },
});
