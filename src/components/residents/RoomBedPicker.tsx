import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { BedDouble, Check, Plus, X } from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';
import {
  formatPropertyGenderLabel,
  PropertyGenderType,
  ResidentGender,
} from '@/lib/ux-utils';
import {
  createRoom,
  fetchRoomsWithOccupancy,
  RoomWithOccupancy,
} from '@/services/residents.service';

interface RoomBedPickerProps {
  propertyId: string;
  propertyGender?: PropertyGenderType;
  residentGender: ResidentGender;
  selectedRoomNumber: string;
  selectedBedLabel: string;
  excludeResidentId?: string;
  refreshSignal?: number;
  onSelect: (roomNumber: string, bedLabel: string) => void;
}

export function RoomBedPicker({
  propertyId,
  propertyGender = 'coed',
  residentGender,
  selectedRoomNumber,
  selectedBedLabel,
  excludeResidentId,
  refreshSignal = 0,
  onSelect,
}: RoomBedPickerProps) {
  const [rooms, setRooms] = useState<RoomWithOccupancy[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedRoom, setExpandedRoom] = useState<string>(selectedRoomNumber);

  // Create room modal
  const [createVisible, setCreateVisible] = useState(false);
  const [newRoomNumber, setNewRoomNumber] = useState('');
  const [newTotalBeds, setNewTotalBeds] = useState(2);
  const [newRoomGender, setNewRoomGender] = useState<PropertyGenderType>(propertyGender);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const loadRooms = useCallback(async () => {
    if (!propertyId) {
      setRooms([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    const res = await fetchRoomsWithOccupancy(propertyId, {
      residentGender,
      propertyGender,
      excludeResidentId,
    });
    if (res.ok) {
      setRooms(res.data);
      if (!expandedRoom && res.data.length > 0) {
        const firstAllowed = res.data.find((r) => r.isGenderAllowed && r.freeBeds > 0) ?? res.data[0];
        if (firstAllowed) setExpandedRoom(firstAllowed.roomNumber);
      }
    } else {
      setLoadError(res.error.message);
    }
    setLoading(false);
  }, [propertyId, residentGender, propertyGender, excludeResidentId, expandedRoom]);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      if (active) void loadRooms();
    }, 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [loadRooms, refreshSignal]);

  const handleCreateRoom = async () => {
    const clean = newRoomNumber.trim();
    if (!clean) {
      setCreateError('Please enter a room number or code.');
      return;
    }
    setCreatingRoom(true);
    setCreateError(null);
    const res = await createRoom(propertyId, {
      roomNumber: clean,
      totalBeds: newTotalBeds,
      genderType: newRoomGender,
    });
    setCreatingRoom(false);

    if (!res.ok) {
      setCreateError(res.error.message);
      return;
    }

    setCreateVisible(false);
    setNewRoomNumber('');
    setExpandedRoom(res.data.room_number);
    onSelect(res.data.room_number, 'Bed 1');
    await loadRooms();
  };

  const openCreateModal = () => {
    const defaultGender: PropertyGenderType =
      propertyGender !== 'coed'
        ? propertyGender
        : residentGender === 'female'
        ? 'girls'
        : residentGender === 'male'
        ? 'boys'
        : 'coed';
    setNewRoomGender(defaultGender);
    setNewTotalBeds(2);
    setCreateError(null);
    setCreateVisible(true);
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>Room & Bed *</Text>
        <Pressable
          accessibilityRole="button"
          style={styles.createBtn}
          onPress={openCreateModal}>
          <Plus size={14} color={OwnerTheme.colors.primary} />
          <Text style={styles.createBtnText}>Create room</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={OwnerTheme.colors.primary} />
          <Text style={styles.hintText}>Loading rooms & free beds...</Text>
        </View>
      ) : loadError ? (
        <Text style={styles.errorText}>{loadError}</Text>
      ) : rooms.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No rooms configured yet</Text>
          <Text style={styles.hintText}>
            Tap &quot;Create room&quot; above to add a room and select a free bed.
          </Text>
        </View>
      ) : (
        <View style={styles.roomList}>
          {rooms.map((room) => {
            const isExpanded = expandedRoom === room.roomNumber;
            const isSelectedRoom = selectedRoomNumber === room.roomNumber;
            const disabledRoom = !room.isGenderAllowed;

            return (
              <View
                key={room.roomNumber}
                style={[
                  styles.roomCard,
                  isSelectedRoom && styles.roomCardSelected,
                  disabledRoom && styles.roomCardDisabled,
                ]}>
                <Pressable
                  accessibilityRole="button"
                  disabled={disabledRoom}
                  onPress={() => setExpandedRoom(isExpanded ? '' : room.roomNumber)}
                  style={styles.roomHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.roomTitle, disabledRoom && styles.mutedText]}>
                      Room {room.roomNumber}
                    </Text>
                    <Text
                      style={[
                        styles.occupancyText,
                        room.freeBeds === 0 && styles.occupancyFullText,
                      ]}>
                      {disabledRoom
                        ? `Reserved for ${formatPropertyGenderLabel(room.genderType)}`
                        : room.freeBeds === 0
                        ? `Full (${room.occupiedBeds}/${room.totalBeds} occupied)`
                        : `${room.freeBeds} of ${room.totalBeds} beds free`}
                    </Text>
                  </View>
                  <View style={styles.roomRightRow}>
                    <View style={styles.genderBadge}>
                      <Text style={styles.genderBadgeText}>
                        {formatPropertyGenderLabel(room.genderType)}
                      </Text>
                    </View>
                    {isSelectedRoom && selectedBedLabel ? (
                      <View style={styles.selectedPill}>
                        <Text style={styles.selectedPillText}>{selectedBedLabel}</Text>
                      </View>
                    ) : null}
                  </View>
                </Pressable>

                {(isExpanded || isSelectedRoom) && !disabledRoom && (
                  <View style={styles.bedsGrid}>
                    {room.beds.map((bed) => {
                      const isBedSelected =
                        isSelectedRoom && selectedBedLabel === bed.bedLabel;
                      return (
                        <Pressable
                          key={bed.bedLabel}
                          accessibilityRole="button"
                          disabled={!bed.isFree}
                          onPress={() => onSelect(room.roomNumber, bed.bedLabel)}
                          style={[
                            styles.bedChip,
                            !bed.isFree && styles.bedChipTaken,
                            isBedSelected && styles.bedChipSelected,
                          ]}>
                          <BedDouble
                            size={14}
                            color={
                              isBedSelected
                                ? '#FFFFFF'
                                : bed.isFree
                                ? OwnerTheme.colors.primary
                                : '#94A3B8'
                            }
                          />
                          <View>
                            <Text
                              style={[
                                styles.bedChipLabel,
                                !bed.isFree && styles.bedChipLabelTaken,
                                isBedSelected && styles.bedChipLabelSelected,
                              ]}>
                              {bed.bedLabel}
                            </Text>
                            <Text
                              style={[
                                styles.bedChipSub,
                                isBedSelected && styles.bedChipSubSelected,
                              ]}
                              numberOfLines={1}>
                              {bed.isFree
                                ? 'Free'
                                : bed.occupiedBy?.fullName || 'Occupied'}
                            </Text>
                          </View>
                          {isBedSelected && <Check size={14} color="#FFFFFF" />}
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      <Modal
        visible={createVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCreateVisible(false)}>
        <View style={styles.modalOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setCreateVisible(false)}
          />
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create Room</Text>
              <Pressable
                hitSlop={10}
                onPress={() => setCreateVisible(false)}
                style={styles.modalCloseBtn}>
                <X size={18} color={OwnerTheme.colors.textSecondary} />
              </Pressable>
            </View>

            <Text style={styles.inputLabel}>Room Number / Code *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 101 or Room D"
              placeholderTextColor="#94A3B8"
              value={newRoomNumber}
              onChangeText={setNewRoomNumber}
              autoCapitalize="characters"
            />

            <Text style={[styles.inputLabel, { marginTop: 12 }]}>Total Beds *</Text>
            <View style={styles.stepperRow}>
              <Pressable
                style={styles.stepBtn}
                onPress={() => setNewTotalBeds((b) => Math.max(1, b - 1))}>
                <Text style={styles.stepBtnText}>−</Text>
              </Pressable>
              <Text style={styles.stepVal}>{newTotalBeds} beds</Text>
              <Pressable
                style={styles.stepBtn}
                onPress={() => setNewTotalBeds((b) => Math.min(12, b + 1))}>
                <Text style={styles.stepBtnText}>+</Text>
              </Pressable>
            </View>

            <Text style={[styles.inputLabel, { marginTop: 12 }]}>Room Gender</Text>
            <View style={styles.genderRow}>
              {(['coed', 'girls', 'boys'] as PropertyGenderType[]).map((g) => {
                const active = newRoomGender === g;
                const lockedByProperty =
                  propertyGender !== 'coed' && g !== propertyGender;
                return (
                  <Pressable
                    key={g}
                    disabled={lockedByProperty}
                    style={[
                      styles.genderChoice,
                      active && styles.genderChoiceActive,
                      lockedByProperty && { opacity: 0.4 },
                    ]}
                    onPress={() => setNewRoomGender(g)}>
                    <Text
                      style={[
                        styles.genderChoiceText,
                        active && styles.genderChoiceTextActive,
                      ]}>
                      {formatPropertyGenderLabel(g)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {createError ? <Text style={styles.errorText}>{createError}</Text> : null}

            <Pressable
              disabled={creatingRoom}
              style={[styles.saveRoomBtn, creatingRoom && { opacity: 0.6 }]}
              onPress={handleCreateRoom}>
              <Text style={styles.saveRoomBtnText}>
                {creatingRoom ? 'Saving...' : 'Create & Select Bed 1'}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: OwnerTheme.radius.full,
    backgroundColor: OwnerTheme.colors.primaryLight,
  },
  createBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  hintText: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
  },
  errorText: {
    fontSize: 12,
    color: OwnerTheme.colors.danger,
    marginTop: 8,
    fontWeight: '500',
  },
  emptyCard: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: OwnerTheme.colors.border,
    borderRadius: OwnerTheme.radius.md,
    padding: 14,
    backgroundColor: '#F8FAFC',
    gap: 4,
  },
  emptyTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  roomList: {
    gap: 8,
  },
  roomCard: {
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    borderRadius: OwnerTheme.radius.md,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  roomCardSelected: {
    borderColor: OwnerTheme.colors.primary,
    backgroundColor: '#F8FAFC',
  },
  roomCardDisabled: {
    opacity: 0.55,
    backgroundColor: '#F1F5F9',
  },
  roomHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    gap: 8,
  },
  roomTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  mutedText: {
    color: OwnerTheme.colors.textSecondary,
  },
  occupancyText: {
    fontSize: 12,
    color: OwnerTheme.colors.success,
    fontWeight: '600',
    marginTop: 2,
  },
  occupancyFullText: {
    color: OwnerTheme.colors.danger,
  },
  roomRightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  genderBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: OwnerTheme.radius.full,
  },
  genderBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  selectedPill: {
    backgroundColor: OwnerTheme.colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: OwnerTheme.radius.full,
  },
  selectedPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  bedsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 12,
    paddingTop: 2,
  },
  bedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: OwnerTheme.radius.sm,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.primary,
    backgroundColor: OwnerTheme.colors.primaryLight,
    minWidth: '45%',
    flexGrow: 1,
  },
  bedChipTaken: {
    borderColor: OwnerTheme.colors.border,
    backgroundColor: '#F1F5F9',
  },
  bedChipSelected: {
    backgroundColor: OwnerTheme.colors.primary,
    borderColor: OwnerTheme.colors.primary,
  },
  bedChipLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  bedChipLabelTaken: {
    color: '#64748B',
  },
  bedChipLabelSelected: {
    color: '#FFFFFF',
  },
  bedChipSub: {
    fontSize: 11,
    color: OwnerTheme.colors.textSecondary,
  },
  bedChipSubSelected: {
    color: '#E0F2FE',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.lg,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 18,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  modalCloseBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
    marginBottom: 6,
  },
  input: {
    height: 46,
    borderRadius: OwnerTheme.radius.md,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    paddingHorizontal: 12,
    fontSize: 15,
    color: OwnerTheme.colors.textPrimary,
    backgroundColor: '#F8FAFC',
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    borderRadius: OwnerTheme.radius.md,
    padding: 8,
    backgroundColor: '#F8FAFC',
  },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: OwnerTheme.radius.sm,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: {
    fontSize: 18,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  stepVal: {
    fontSize: 15,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  genderRow: {
    flexDirection: 'row',
    gap: 8,
  },
  genderChoice: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: OwnerTheme.radius.md,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
  },
  genderChoiceActive: {
    borderColor: OwnerTheme.colors.primary,
    backgroundColor: OwnerTheme.colors.primaryLight,
  },
  genderChoiceText: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  genderChoiceTextActive: {
    color: OwnerTheme.colors.primary,
    fontWeight: '700',
  },
  saveRoomBtn: {
    marginTop: 16,
    height: 46,
    borderRadius: OwnerTheme.radius.md,
    backgroundColor: OwnerTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveRoomBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
