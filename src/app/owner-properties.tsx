import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  BedDouble,
  Building2,
  CheckCircle2,
  MapPin,
  Pencil,
  Users,
  X,
} from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';
import { extractErrorMessage } from '@/lib/error-utils';
import { PropertyItem, useProperty } from '@/context/property-context';
import { useToast } from '@/context/toast-context';
import {
  formatPropertyGenderLabel,
  inferPropertyGender,
  PropertyGenderType,
} from '@/lib/ux-utils';
import {
  OwnerHeader,
  PrimaryButton,
  SecondaryButton,
  ErrorState,
} from '@/components/ui/owner';

const GENDER_OPTIONS: { value: PropertyGenderType; label: string }[] = [
  { value: 'coed', label: 'Co-ed' },
  { value: 'girls', label: 'Girls' },
  { value: 'boys', label: 'Boys' },
];

function parseTotalBeds(raw: string): number {
  const digits = raw.replace(/[^0-9]/g, '');
  if (!digits) return 0;
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

interface GenderSelectorProps {
  value: PropertyGenderType;
  onChange: (next: PropertyGenderType) => void;
  disabled?: boolean;
}

function GenderSelector({ value, onChange, disabled }: GenderSelectorProps) {
  return (
    <View style={styles.genderRow}>
      {GENDER_OPTIONS.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: active, disabled: Boolean(disabled) }}
            disabled={disabled}
            onPress={() => onChange(opt.value)}
            style={[
              styles.genderChip,
              active && styles.genderChipActive,
              disabled && { opacity: 0.6 },
            ]}>
            <Text
              style={[
                styles.genderChipText,
                active && styles.genderChipTextActive,
              ]}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

interface PropertyEditFormProps {
  property: PropertyItem;
  onSave: (
    id: string,
    name: string,
    address: string | undefined,
    meta: { gender_type: PropertyGenderType; total_beds: number }
  ) => Promise<void>;
  onValidationError: (msg: string) => void;
}

function PropertyEditForm({
  property,
  onSave,
  onValidationError,
}: PropertyEditFormProps) {
  const [propName, setPropName] = useState(property.name);
  const [propAddress, setPropAddress] = useState(property.address || '');
  const [genderType, setGenderType] = useState<PropertyGenderType>(() =>
    inferPropertyGender(property.name, property.gender_type)
  );
  const [totalBeds, setTotalBeds] = useState(() =>
    typeof property.total_beds === 'number' && property.total_beds > 0
      ? String(property.total_beds)
      : ''
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const trimmed = propName.trim();
    if (!trimmed) {
      onValidationError('Property name cannot be empty.');
      return;
    }

    try {
      setSaving(true);
      await onSave(property.id, trimmed, propAddress.trim() || undefined, {
        gender_type: genderType,
        total_beds: parseTotalBeds(totalBeds),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Pencil size={16} color={OwnerTheme.colors.primary} />
        <Text style={styles.cardTitle}>
          Edit &ldquo;{property.name}&rdquo; Details
        </Text>
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>PG Name *</Text>
        <TextInput
          style={styles.textInput}
          value={propName}
          onChangeText={setPropName}
          placeholder="e.g. Shalom Boys PG"
          placeholderTextColor={OwnerTheme.colors.textMuted}
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Property Gender Type</Text>
        <GenderSelector
          value={genderType}
          onChange={setGenderType}
          disabled={saving}
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Total Beds</Text>
        <TextInput
          style={styles.textInput}
          value={totalBeds}
          onChangeText={(val) => setTotalBeds(val.replace(/[^0-9]/g, ''))}
          placeholder="e.g. 40"
          placeholderTextColor={OwnerTheme.colors.textMuted}
          keyboardType="number-pad"
          maxLength={5}
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Address / Location</Text>
        <TextInput
          style={[styles.textInput, styles.textArea]}
          value={propAddress}
          onChangeText={setPropAddress}
          placeholder="e.g. No. 12, Near University Campus, Main Road"
          placeholderTextColor={OwnerTheme.colors.textMuted}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
        />
      </View>

      <PrimaryButton
        label="Save Property Details"
        onPress={handleSave}
        loading={saving}
        style={{ marginTop: 14 }}
      />
    </View>
  );
}

export default function OwnerPropertiesScreen() {
  const { properties, selectedProperty, addProperty, updateProperty } =
    useProperty();
  const { showToast } = useToast();

  const [editingPropertyId, setEditingPropertyId] = useState<string | null>(
    null
  );

  // New PG Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [newPgName, setNewPgName] = useState('');
  const [newPgAddress, setNewPgAddress] = useState('');
  const [newPgGender, setNewPgGender] = useState<PropertyGenderType>('coed');
  const [newPgTotalBeds, setNewPgTotalBeds] = useState('');
  const [creating, setCreating] = useState(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const editingProperty =
    properties.find((p) => p.id === editingPropertyId) ??
    selectedProperty ??
    properties[0] ??
    null;

  const handleSelectForEdit = (id: string) => {
    setEditingPropertyId(id);
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const handleSaveProperty = async (
    id: string,
    name: string,
    address: string | undefined,
    meta: { gender_type: PropertyGenderType; total_beds: number }
  ) => {
    try {
      setErrorMessage(null);
      setSuccessMessage(null);

      await updateProperty(id, name, address, meta);

      setSuccessMessage('Property details saved successfully.');
      showToast(`"${name}" updated.`);
    } catch (err: unknown) {
      const msg = extractErrorMessage(err, 'Failed to update property details.');
      setErrorMessage(msg);
    }
  };

  const resetAddModal = () => {
    setNewPgName('');
    setNewPgAddress('');
    setNewPgGender('coed');
    setNewPgTotalBeds('');
  };

  const closeAddModal = () => {
    if (creating) return;
    setShowAddModal(false);
  };

  const handleAddNewProperty = async () => {
    const trimmed = newPgName.trim();
    if (!trimmed) {
      Alert.alert('Required', 'Please enter a PG name.');
      return;
    }

    try {
      setCreating(true);
      setErrorMessage(null);
      const created = await addProperty(
        trimmed,
        newPgAddress.trim() || undefined,
        {
          gender_type: newPgGender,
          total_beds: parseTotalBeds(newPgTotalBeds),
        }
      );
      setShowAddModal(false);
      resetAddModal();
      setEditingPropertyId(created.id);
      setSuccessMessage(`Added "${created.name}".`);
      showToast(`"${created.name}" has been added.`);
    } catch (err: unknown) {
      const msg = extractErrorMessage(err, 'Could not add property.');
      Alert.alert('Failed', msg);
    } finally {
      setCreating(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <OwnerHeader
        title="PG Properties"
        subtitle="Edit details & capacity"
        showBack
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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

          {/* Properties List (Select to Edit) */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Building2 size={18} color={OwnerTheme.colors.primary} />
              <Text style={styles.cardTitle}>Your PG Properties</Text>
            </View>
            <Text style={styles.cardDescription}>
              Select a property below to edit its details, gender type, and bed
              capacity.
            </Text>

            <View style={styles.propertyList}>
              {properties.map((prop) => {
                const isEditing = prop.id === editingProperty?.id;
                const resolvedGender = inferPropertyGender(
                  prop.name,
                  prop.gender_type
                );
                const genderLabel = formatPropertyGenderLabel(resolvedGender);
                const bedsCount =
                  typeof prop.total_beds === 'number' && prop.total_beds > 0
                    ? prop.total_beds
                    : 0;
                const occupiedCount = prop.active_resident_count ?? 0;

                return (
                  <Pressable
                    key={prop.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${prop.name}`}
                    style={({ pressed }) => [
                      styles.propertyRow,
                      isEditing && styles.propertyRowSelected,
                      pressed && styles.cardPressed,
                    ]}
                    onPress={() => handleSelectForEdit(prop.id)}>
                    <View
                      style={[
                        styles.propertyIconWrap,
                        isEditing && styles.propertyIconWrapSelected,
                      ]}>
                      <Building2
                        size={18}
                        color={
                          isEditing
                            ? OwnerTheme.colors.primary
                            : OwnerTheme.colors.textSecondary
                        }
                      />
                    </View>

                    <View style={styles.propertyInfo}>
                      <Text
                        style={[
                          styles.propertyName,
                          isEditing && styles.propertyNameSelected,
                        ]}>
                        {prop.name}
                      </Text>

                      <View style={styles.metaRow}>
                        <View style={styles.metaItem}>
                          <Users
                            size={11}
                            color={OwnerTheme.colors.textSecondary}
                          />
                          <Text style={styles.metaText}>{genderLabel}</Text>
                        </View>
                        <Text style={styles.metaDot}>•</Text>
                        <View style={styles.metaItem}>
                          <BedDouble
                            size={11}
                            color={OwnerTheme.colors.textSecondary}
                          />
                          <Text style={styles.metaText}>
                            {bedsCount > 0
                              ? `${occupiedCount}/${bedsCount} beds`
                              : `${occupiedCount} ${occupiedCount === 1 ? 'resident' : 'residents'}`}
                          </Text>
                        </View>
                      </View>

                      {prop.address ? (
                        <View style={styles.addressRow}>
                          <MapPin
                            size={12}
                            color={OwnerTheme.colors.textMuted}
                          />
                          <Text
                            style={styles.propertyAddress}
                            numberOfLines={1}>
                            {prop.address}
                          </Text>
                        </View>
                      ) : null}
                    </View>

                    <View
                      style={[
                        styles.editPill,
                        isEditing && styles.editPillActive,
                      ]}>
                      <Pencil
                        size={12}
                        color={isEditing ? '#FFFFFF' : OwnerTheme.colors.primary}
                      />
                      <Text
                        style={[
                          styles.editPillText,
                          isEditing && styles.editPillTextActive,
                        ]}>
                        {isEditing ? 'Editing' : 'Edit'}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <SecondaryButton
              label="+ Add Another PG Property"
              onPress={() => {
                resetAddModal();
                setShowAddModal(true);
              }}
              style={{ marginTop: 12 }}
            />
          </View>

          {/* Edit Details of Selected Property */}
          {editingProperty && (
            <PropertyEditForm
              key={editingProperty.id}
              property={editingProperty}
              onSave={handleSaveProperty}
              onValidationError={(msg) => {
                setSuccessMessage(null);
                setErrorMessage(msg);
              }}
            />
          )}

          <View style={{ height: 32 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Add New Property Modal */}
      <Modal
        visible={showAddModal}
        transparent
        animationType="fade"
        onRequestClose={closeAddModal}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityLabel="Close add property modal"
            onPress={closeAddModal}
          />
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add New PG Property</Text>
              <Pressable hitSlop={8} onPress={closeAddModal}>
                <X size={20} color={OwnerTheme.colors.textSecondary} />
              </Pressable>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: 460 }}>
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>PG Name *</Text>
                <TextInput
                  style={styles.textInput}
                  value={newPgName}
                  onChangeText={setNewPgName}
                  placeholder="e.g. Shalom Girls PG"
                  placeholderTextColor={OwnerTheme.colors.textMuted}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Property Gender Type</Text>
                <GenderSelector
                  value={newPgGender}
                  onChange={setNewPgGender}
                  disabled={creating}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Total Beds</Text>
                <TextInput
                  style={styles.textInput}
                  value={newPgTotalBeds}
                  onChangeText={(val) =>
                    setNewPgTotalBeds(val.replace(/[^0-9]/g, ''))
                  }
                  placeholder="e.g. 40"
                  placeholderTextColor={OwnerTheme.colors.textMuted}
                  keyboardType="number-pad"
                  maxLength={5}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Address / Location (Optional)</Text>
                <TextInput
                  style={[styles.textInput, styles.textArea]}
                  value={newPgAddress}
                  onChangeText={setNewPgAddress}
                  placeholder="e.g. 45 Green Avenue, Anna Nagar, Chennai"
                  placeholderTextColor={OwnerTheme.colors.textMuted}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />
              </View>
            </ScrollView>

            <View style={styles.modalBtnRow}>
              <Pressable
                style={styles.modalCancelBtn}
                disabled={creating}
                onPress={closeAddModal}>
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.modalConfirmBtn,
                  creating && { opacity: 0.6 },
                ]}
                disabled={creating}
                onPress={handleAddNewProperty}>
                {creating ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalConfirmBtnText}>Create PG</Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
    gap: 8,
    marginBottom: 6,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  cardDescription: {
    fontSize: 13,
    color: OwnerTheme.colors.textSecondary,
    marginBottom: 12,
  },
  propertyList: {
    gap: 8,
  },
  propertyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: OwnerTheme.radius.sm,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    backgroundColor: '#FAFAFA',
    gap: 10,
  },
  propertyRowSelected: {
    borderColor: OwnerTheme.colors.primary,
    backgroundColor: OwnerTheme.colors.primaryLight,
  },
  propertyIconWrap: {
    width: 36,
    height: 36,
    borderRadius: OwnerTheme.radius.sm,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  propertyIconWrapSelected: {
    backgroundColor: '#FFFFFF',
  },
  propertyInfo: {
    flex: 1,
    minWidth: 0,
  },
  propertyName: {
    fontSize: 14,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  propertyNameSelected: {
    color: OwnerTheme.colors.primary,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 3,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 11,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  metaDot: {
    fontSize: 11,
    color: OwnerTheme.colors.textMuted,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  propertyAddress: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
    flex: 1,
  },
  editPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: OwnerTheme.colors.primary,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: OwnerTheme.radius.full,
  },
  editPillActive: {
    backgroundColor: OwnerTheme.colors.primary,
    borderColor: OwnerTheme.colors.primary,
  },
  editPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  editPillTextActive: {
    color: '#FFFFFF',
  },
  fieldGroup: {
    marginTop: 10,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
    marginBottom: 6,
  },
  textInput: {
    height: 50,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    borderRadius: OwnerTheme.radius.md,
    paddingHorizontal: 14,
    fontSize: 15,
    color: OwnerTheme.colors.textPrimary,
    backgroundColor: '#FAFAFA',
  },
  textArea: {
    height: undefined,
    minHeight: 84,
    paddingTop: 12,
    paddingBottom: 12,
  },
  genderRow: {
    flexDirection: 'row',
    gap: 8,
  },
  genderChip: {
    flex: 1,
    height: 42,
    borderRadius: OwnerTheme.radius.md,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    backgroundColor: '#FAFAFA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  genderChipActive: {
    borderColor: OwnerTheme.colors.primary,
    backgroundColor: OwnerTheme.colors.primaryLight,
  },
  genderChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  genderChipTextActive: {
    color: OwnerTheme.colors.primary,
    fontWeight: '700',
  },
  cardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: OwnerTheme.colors.successLight,
    borderWidth: 1,
    borderColor: '#86EFAC',
    borderRadius: OwnerTheme.radius.md,
    padding: 12,
  },
  successBannerText: {
    fontSize: 13,
    color: OwnerTheme.colors.success,
    fontWeight: '600',
    flex: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    padding: 20,
    width: '100%',
    maxWidth: 420,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  modalBtnRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 18,
  },
  modalCancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: OwnerTheme.radius.md,
    backgroundColor: '#F1F5F9',
  },
  modalCancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  modalConfirmBtn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: OwnerTheme.radius.md,
    backgroundColor: OwnerTheme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalConfirmBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
