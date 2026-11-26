import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { Building2, Check, Clock, Disc3, Plus, User, X } from 'lucide-react-native';

import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { OwnerSharedStyles } from '@/components/ui/owner';
import { OwnerTheme } from '@/constants/theme';
import { PropertyItem } from '@/context/property-context';
import { triggerSelectionHaptic } from '@/lib/haptics';
import {
  formatPropertyGenderLabel,
  inferPropertyGender,
  PropertyGenderType,
  toSentenceCaseStatus,
} from '@/lib/ux-utils';
import { DashboardWmUnit, OwnerWmSummary } from '@/services/dashboard.service';

function getGenderPillStyle(genderType: PropertyGenderType) {
  if (genderType === 'girls') return { bg: '#FCE7F3', text: '#BE185D' };
  if (genderType === 'boys') return { bg: '#DBEAFE', text: '#1D4ED8' };
  return { bg: '#E0E7FF', text: '#4338CA' };
}

function formatCycleStartTime(startedAtIso: string | null): string {
  if (!startedAtIso) return '';
  try {
    const startMs = new Date(startedAtIso).getTime();
    if (Number.isNaN(startMs)) return '';
    return new Date(startMs).toLocaleTimeString('en-IN', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '';
  }
}

export function PropertySwitcherModal({
  visible,
  properties,
  selectedPropertyId,
  activePropertyResidentsCount,
  onSelectProperty,
  onOpenAddProperty,
  onClose,
}: {
  visible: boolean;
  properties: PropertyItem[];
  selectedPropertyId: string | null;
  activePropertyResidentsCount: number;
  onSelectProperty: (id: string) => Promise<void>;
  onOpenAddProperty: () => void;
  onClose: () => void;
}) {
  return (
    <BottomSheetModal
      visible={visible}
      onClose={onClose}
      title="Switch PG Property"
      subtitle="Select which accommodation to view and manage"
      maxHeight="80%">
          <ScrollView style={{ maxHeight: 280 }}>
            {properties.map((prop) => {
              const isSelected = prop.id === selectedPropertyId;
              const occupied =
                typeof prop.active_resident_count === 'number'
                  ? prop.active_resident_count
                  : isSelected
                    ? activePropertyResidentsCount
                    : 0;
              const totalBeds =
                typeof prop.total_beds === 'number' ? prop.total_beds : 0;
              const occupancyText =
                totalBeds > 0
                  ? `${occupied}/${totalBeds} beds`
                  : `${occupied} residents`;
              const genderType = inferPropertyGender(
                prop.name,
                prop.gender_type ?? null
              );
              const genderLabel = formatPropertyGenderLabel(genderType);
              const genderStyle = getGenderPillStyle(genderType);

              return (
                <Pressable
                  key={prop.id}
                  style={[
                    styles.propertyItemRow,
                    isSelected && styles.propertyItemRowSelected,
                  ]}
                  onPress={async () => {
                    triggerSelectionHaptic();
                    await onSelectProperty(prop.id);
                    onClose();
                  }}>
                  <Building2
                    size={18}
                    color={
                      isSelected
                        ? OwnerTheme.colors.primary
                        : OwnerTheme.colors.textSecondary
                    }
                    style={{ marginRight: 10 }}
                  />
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        styles.propertyNameItem,
                        isSelected && styles.propertyNameItemSelected,
                      ]}>
                      {prop.name}
                    </Text>
                    <View style={styles.propertyMetaRow}>
                      <Text style={styles.propertyOccupancyText}>{occupancyText}</Text>
                      <View
                        style={[
                          styles.propertyGenderPill,
                          { backgroundColor: genderStyle.bg },
                        ]}>
                        <Text
                          style={[
                            styles.propertyGenderText,
                            { color: genderStyle.text },
                          ]}>
                          {genderLabel}
                        </Text>
                      </View>
                    </View>
                  </View>
                  {isSelected && (
                    <Check size={18} color={OwnerTheme.colors.primary} />
                  )}
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable style={styles.addPropertyBtn} onPress={onOpenAddProperty}>
            <Plus size={16} color={OwnerTheme.colors.primary} />
            <Text style={styles.addPropertyBtnText}>Add Another PG Property</Text>
          </Pressable>
    </BottomSheetModal>
  );
}

export function AddPropertyModal({
  visible,
  propName,
  propAddress,
  creating,
  onChangeName,
  onChangeAddress,
  onCreate,
  onClose,
}: {
  visible: boolean;
  propName: string;
  propAddress: string;
  creating: boolean;
  onChangeName: (v: string) => void;
  onChangeAddress: (v: string) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  return (
    <BottomSheetModal
      visible={visible}
      onClose={onClose}
      title="Add New PG Property"
      disabled={creating}>
          <Text style={[OwnerSharedStyles.inputLabel, styles.fieldSpacing]}>PG Name *</Text>
          <TextInput
            style={[OwnerSharedStyles.textInput, styles.inputSpacing]}
            placeholder="e.g. Shalom Girls PG"
            placeholderTextColor={OwnerTheme.colors.textMuted}
            value={propName}
            onChangeText={onChangeName}
          />

          <Text style={[OwnerSharedStyles.inputLabel, styles.fieldSpacing]}>
            Address (Optional)
          </Text>
          <TextInput
            style={[OwnerSharedStyles.textInput, styles.inputSpacing]}
            placeholder="e.g. Street 4, College Road"
            placeholderTextColor={OwnerTheme.colors.textMuted}
            value={propAddress}
            onChangeText={onChangeAddress}
          />

          <View style={styles.modalActions}>
            <Pressable style={styles.modalCancelBtn} onPress={onClose}>
              <Text style={styles.modalCancelBtnText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.modalConfirmBtn, creating && { opacity: 0.6 }]}
              disabled={creating}
              onPress={onCreate}>
              {creating ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.modalConfirmBtnText}>Create PG</Text>
              )}
            </Pressable>
          </View>
    </BottomSheetModal>
  );
}

export function WmUnitsModal({
  visible,
  propertyName,
  wmSummary,
  wmUnits,
  outOfOrderCount,
  busyMachineId,
  onRelease,
  onSetOutOfOrder,
  onClose,
}: {
  visible: boolean;
  propertyName: string;
  wmSummary: OwnerWmSummary;
  wmUnits: DashboardWmUnit[];
  outOfOrderCount: number;
  busyMachineId: string | null;
  onRelease: (unitId: string, machineName: string) => void;
  onSetOutOfOrder: (
    unitId: string,
    machineName: string,
    outOfOrder: boolean,
    isInUse: boolean
  ) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlayCentered}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close washing machine modal"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
        <View style={styles.wmModalContent}>
          <View style={styles.wmModalHeader}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Disc3 size={18} color="#0284C7" />
                <Text style={styles.wmModalTitle}>Washing Machine Units</Text>
              </View>
              <Text style={styles.wmModalSubtitle} numberOfLines={1}>
                {propertyName} • {wmSummary.inUseCount} in use, {wmSummary.freeCount} free
                {outOfOrderCount > 0 ? `, ${outOfOrderCount} out of order` : ''}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close modal"
              hitSlop={8}
              onPress={onClose}>
              <X size={20} color={OwnerTheme.colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
            {wmUnits.length === 0 ? (
              <View style={styles.wmModalEmpty}>
                <Text style={styles.wmModalEmptyText}>
                  No active washing machines configured.
                </Text>
                <Pressable
                  style={styles.configureWmBtn}
                  onPress={() => {
                    onClose();
                    router.push('/owner-settings');
                  }}>
                  <Text style={styles.configureWmBtnText}>Configure in Settings ›</Text>
                </Pressable>
              </View>
            ) : (
              wmUnits.map((unit, idx) => {
                const isInUse = unit.status === 'in_use';
                const isOutOfOrder = unit.status === 'out_of_order';
                const isBusy = busyMachineId === unit.id;
                const statusLabel = toSentenceCaseStatus(unit.status);
                const badgeStyle = isInUse
                  ? styles.wmStatusInUse
                  : isOutOfOrder
                    ? styles.wmStatusOutOfOrder
                    : styles.wmStatusFree;
                const dotColor = isInUse
                  ? '#DC2626'
                  : isOutOfOrder
                    ? '#D97706'
                    : '#16A34A';
                const textColor = isInUse
                  ? '#B91C1C'
                  : isOutOfOrder
                    ? '#B45309'
                    : '#15803D';
                const cycleStartText = isInUse
                  ? formatCycleStartTime(unit.started_at)
                  : '';

                return (
                  <View
                    key={unit.id}
                    style={[
                      styles.wmUnitRow,
                      idx === wmUnits.length - 1 && { borderBottomWidth: 0 },
                    ]}>
                    <View style={styles.wmUnitTopRow}>
                      <Text style={styles.wmUnitName}>{unit.machine_name}</Text>
                      <View style={[styles.wmStatusBadge, badgeStyle]}>
                        <View
                          style={[styles.wmStatusDot, { backgroundColor: dotColor }]}
                        />
                        <Text style={[styles.wmStatusText, { color: textColor }]}>
                          {statusLabel}
                        </Text>
                      </View>
                    </View>

                    {isInUse && (
                      <View style={styles.wmInUseDetails}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                          <User size={12} color="#1E293B" />
                          <Text style={styles.wmOccupantText}>
                            {unit.current_resident_name || 'Resident'}
                            {unit.current_resident_room
                              ? ` (Room ${unit.current_resident_room})`
                              : ''}
                          </Text>
                        </View>
                        {cycleStartText ? (
                          <View
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: 4,
                              marginTop: 2,
                            }}>
                            <Clock size={12} color="#64748B" />
                            <Text style={styles.wmDurationText}>{cycleStartText}</Text>
                          </View>
                        ) : null}
                      </View>
                    )}

                    <View style={styles.wmUnitActionsRow}>
                      {isInUse && (
                        <Pressable
                          accessibilityRole="button"
                          style={[
                            styles.forceFreeBtn,
                            isBusy && styles.forceFreeBtnDisabled,
                          ]}
                          disabled={isBusy}
                          onPress={() => onRelease(unit.id, unit.machine_name)}>
                          {isBusy ? (
                            <ActivityIndicator size="small" color="#DC2626" />
                          ) : (
                            <Text style={styles.forceFreeBtnText}>Free up</Text>
                          )}
                        </Pressable>
                      )}

                      {isOutOfOrder ? (
                        <Pressable
                          accessibilityRole="button"
                          style={[
                            styles.markAvailableBtn,
                            isBusy && styles.forceFreeBtnDisabled,
                          ]}
                          disabled={isBusy}
                          onPress={() =>
                            onSetOutOfOrder(unit.id, unit.machine_name, false, false)
                          }>
                          {isBusy ? (
                            <ActivityIndicator size="small" color="#15803D" />
                          ) : (
                            <Text style={styles.markAvailableBtnText}>
                              Mark available
                            </Text>
                          )}
                        </Pressable>
                      ) : (
                        <Pressable
                          accessibilityRole="button"
                          style={[
                            styles.markOutOfOrderBtn,
                            isBusy && styles.forceFreeBtnDisabled,
                          ]}
                          disabled={isBusy}
                          onPress={() =>
                            onSetOutOfOrder(unit.id, unit.machine_name, true, isInUse)
                          }>
                          <Text style={styles.markOutOfOrderBtnText}>
                            Mark out of order
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlayCentered: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  switcherModalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    padding: 20,
    ...OwnerTheme.shadow,
  },
  switcherModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  switcherModalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  switcherModalSub: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
    marginBottom: 14,
  },
  propertyItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: OwnerTheme.radius.sm,
    marginBottom: 6,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: OwnerTheme.colors.borderLight,
  },
  propertyItemRowSelected: {
    backgroundColor: OwnerTheme.colors.primaryLight,
    borderColor: OwnerTheme.colors.primary,
  },
  propertyNameItem: {
    fontSize: 14,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  propertyNameItemSelected: { color: OwnerTheme.colors.primary },
  propertyMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 3,
  },
  propertyOccupancyText: {
    fontSize: 11,
    fontWeight: '500',
    color: OwnerTheme.colors.textSecondary,
  },
  propertyGenderPill: {
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: OwnerTheme.radius.full,
  },
  propertyGenderText: { fontSize: 10, fontWeight: '700' },
  addPropertyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: OwnerTheme.radius.md,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.primary,
    borderStyle: 'dashed',
  },
  addPropertyBtnText: { fontSize: 13, fontWeight: '600', color: OwnerTheme.colors.primary },
  fieldSpacing: { marginTop: 8, marginBottom: 4 },
  inputSpacing: { marginBottom: 8 },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 12,
  },
  modalCancelBtn: {
    height: 40,
    paddingHorizontal: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCancelBtnText: { fontSize: 13, fontWeight: '600', color: OwnerTheme.colors.textSecondary },
  modalConfirmBtn: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: OwnerTheme.radius.md,
    backgroundColor: OwnerTheme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalConfirmBtnText: { fontSize: 13, fontWeight: '600', color: '#FFFFFF' },
  wmModalContent: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    padding: 18,
    ...OwnerTheme.shadowElevated,
  },
  wmModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  wmModalTitle: { fontSize: 16, fontWeight: '700', color: OwnerTheme.colors.textPrimary },
  wmModalSubtitle: { fontSize: 12, color: OwnerTheme.colors.textSecondary, marginTop: 2 },
  wmModalEmpty: { alignItems: 'center', paddingVertical: 20, gap: 10 },
  wmModalEmptyText: { fontSize: 13, color: OwnerTheme.colors.textSecondary },
  configureWmBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: OwnerTheme.radius.md,
    backgroundColor: OwnerTheme.colors.primaryLight,
  },
  configureWmBtnText: { fontSize: 13, fontWeight: '700', color: OwnerTheme.colors.primary },
  wmUnitRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: OwnerTheme.colors.borderLight,
  },
  wmUnitTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  wmUnitName: { fontSize: 14, fontWeight: '700', color: OwnerTheme.colors.textPrimary },
  wmStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: OwnerTheme.radius.full,
  },
  wmStatusFree: { backgroundColor: '#DCFCE7' },
  wmStatusInUse: { backgroundColor: '#FEE2E2' },
  wmStatusOutOfOrder: { backgroundColor: '#FEF3C7' },
  wmStatusDot: { width: 6, height: 6, borderRadius: 3 },
  wmStatusText: { fontSize: 11, fontWeight: '700' },
  wmInUseDetails: {
    marginTop: 6,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: OwnerTheme.radius.sm,
  },
  wmOccupantText: { fontSize: 12, fontWeight: '600', color: '#1E293B' },
  wmDurationText: { fontSize: 11, color: '#64748B' },
  wmUnitActionsRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  forceFreeBtn: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  forceFreeBtnDisabled: { opacity: 0.6 },
  forceFreeBtnText: { fontSize: 11, fontWeight: '700', color: '#DC2626' },
  markOutOfOrderBtn: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  markOutOfOrderBtnText: { fontSize: 11, fontWeight: '700', color: '#B45309' },
  markAvailableBtn: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#86EFAC',
  },
  markAvailableBtnText: { fontSize: 11, fontWeight: '700', color: '#15803D' },
});
