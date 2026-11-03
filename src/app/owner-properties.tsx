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
  Building2,
  Check,
  Plus,
  X,
  MapPin,
  CheckCircle2,
} from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';
import { useProperty } from '@/context/property-context';
import {
  OwnerHeader,
  PrimaryButton,
  SecondaryButton,
  ErrorState,
} from '@/components/ui/owner';

export default function OwnerPropertiesScreen() {
  const {
    properties,
    selectedProperty,
    selectedPropertyId,
    selectProperty,
    addProperty,
    updateProperty,
  } = useProperty();

  const [propName, setPropName] = useState(selectedProperty?.name || '');
  const [propAddress, setPropAddress] = useState(
    selectedProperty?.address || ''
  );
  const [savingCurrent, setSavingCurrent] = useState(false);

  // New PG Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [newPgName, setNewPgName] = useState('');
  const [newPgAddress, setNewPgAddress] = useState('');
  const [creating, setCreating] = useState(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleSwitchProperty = async (id: string) => {
    try {
      await selectProperty(id);
      const chosen = properties.find((p) => p.id === id);
      if (chosen) {
        setPropName(chosen.name);
        setPropAddress(chosen.address || '');
      }
      setSuccessMessage(`Switched active PG to "${chosen?.name || 'Selected'}".`);
    } catch (err: any) {
      setErrorMessage(err.message || 'Could not switch property.');
    }
  };

  const handleSaveCurrent = async () => {
    if (!selectedProperty?.id) return;
    const trimmed = propName.trim();
    if (!trimmed) {
      setErrorMessage('Property name cannot be empty.');
      return;
    }

    try {
      setSavingCurrent(true);
      setErrorMessage(null);
      setSuccessMessage(null);

      await updateProperty(
        selectedProperty.id,
        trimmed,
        propAddress.trim() || undefined
      );

      setSuccessMessage('Property details saved successfully.');
      Alert.alert('Saved', `"${trimmed}" updated.`);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to update property details.');
    } finally {
      setSavingCurrent(false);
    }
  };

  const handleAddNewProperty = async () => {
    const trimmed = newPgName.trim();
    if (!trimmed) {
      Alert.alert('Required', 'Please enter a PG name.');
      return;
    }

    try {
      setCreating(true);
      const created = await addProperty(
        trimmed,
        newPgAddress.trim() || undefined
      );
      setShowAddModal(false);
      setNewPgName('');
      setNewPgAddress('');
      setPropName(created.name);
      setPropAddress(created.address || '');
      setSuccessMessage(`Created and switched to "${created.name}".`);
      Alert.alert('Success', `"${created.name}" is now your active property.`);
    } catch (err: any) {
      Alert.alert('Failed', err.message || 'Could not add property.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <OwnerHeader
        title="PG Properties"
        subtitle="Manage your accommodations and switch active PG"
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

          {/* Properties List */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Building2 size={18} color={OwnerTheme.colors.primary} />
              <Text style={styles.cardTitle}>Your PG Properties</Text>
            </View>
            <Text style={styles.cardDescription}>
              Tap any property to set it as active across the app.
            </Text>

            <View style={styles.propertyList}>
              {properties.map((prop) => {
                const isActive = prop.id === selectedPropertyId;
                return (
                  <Pressable
                    key={prop.id}
                    style={({ pressed }) => [
                      styles.propertyRow,
                      isActive && styles.propertyRowActive,
                      pressed && styles.cardPressed,
                    ]}
                    onPress={() => handleSwitchProperty(prop.id)}>
                    <View
                      style={[
                        styles.propertyIconWrap,
                        isActive && styles.propertyIconWrapActive,
                      ]}>
                      <Building2
                        size={18}
                        color={
                          isActive
                            ? OwnerTheme.colors.primary
                            : OwnerTheme.colors.textSecondary
                        }
                      />
                    </View>

                    <View style={styles.propertyInfo}>
                      <Text
                        style={[
                          styles.propertyName,
                          isActive && styles.propertyNameActive,
                        ]}>
                        {prop.name}
                      </Text>
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

                    {isActive ? (
                      <View style={styles.activeBadge}>
                        <Check size={14} color="#FFFFFF" />
                        <Text style={styles.activeBadgeText}>ACTIVE</Text>
                      </View>
                    ) : (
                      <Text style={styles.switchTapText}>Tap to switch</Text>
                    )}
                  </Pressable>
                );
              })}
            </View>

            <SecondaryButton
              label="+ Add Another PG Property"
              onPress={() => setShowAddModal(true)}
              style={{ marginTop: 12 }}
            />
          </View>

          {/* Edit Details of Current Active Property */}
          {selectedProperty && (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>
                  Edit "{selectedProperty.name}" Details
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
                <Text style={styles.label}>Address / Location</Text>
                <TextInput
                  style={styles.textInput}
                  value={propAddress}
                  onChangeText={setPropAddress}
                  placeholder="e.g. Near University Campus, Main Road"
                  placeholderTextColor={OwnerTheme.colors.textMuted}
                />
              </View>

              <PrimaryButton
                label="Save Property Details"
                onPress={handleSaveCurrent}
                loading={savingCurrent}
                style={{ marginTop: 12 }}
              />
            </View>
          )}

          <View style={{ height: 32 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Add New Property Modal */}
      <Modal
        visible={showAddModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAddModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add New PG Property</Text>
              <Pressable hitSlop={8} onPress={() => setShowAddModal(false)}>
                <X size={20} color={OwnerTheme.colors.textSecondary} />
              </Pressable>
            </View>

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
              <Text style={styles.label}>Address / Location (Optional)</Text>
              <TextInput
                style={styles.textInput}
                value={newPgAddress}
                onChangeText={setNewPgAddress}
                placeholder="e.g. 45 Green Avenue, Chennai"
                placeholderTextColor={OwnerTheme.colors.textMuted}
              />
            </View>

            <View style={styles.modalBtnRow}>
              <Pressable
                style={styles.modalCancelBtn}
                onPress={() => setShowAddModal(false)}>
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
        </View>
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
  propertyRowActive: {
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
  propertyIconWrapActive: {
    backgroundColor: '#FFFFFF',
  },
  propertyInfo: {
    flex: 1,
  },
  propertyName: {
    fontSize: 14,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  propertyNameActive: {
    color: OwnerTheme.colors.primary,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  propertyAddress: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
  },
  activeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: OwnerTheme.colors.primary,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: OwnerTheme.radius.full,
  },
  activeBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  switchTapText: {
    fontSize: 12,
    color: OwnerTheme.colors.textMuted,
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
    marginBottom: 12,
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
