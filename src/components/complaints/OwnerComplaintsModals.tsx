import React, { memo } from 'react';
import {
  ActivityIndicator,
  Image,
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
import { Href, router } from 'expo-router';
import {
  Armchair,
  Camera,
  Check,
  Droplets,
  Sparkles,
  Utensils,
  Wifi,
  Wrench,
  X,
  Zap,
} from 'lucide-react-native';

import { OwnerSharedStyles } from '@/components/ui/owner';
import { OwnerTheme } from '@/constants/theme';
import { toSentenceCaseStatus } from '@/lib/ux-utils';

export type ComplaintCategory =
  | 'plumbing'
  | 'electrical'
  | 'wifi_internet'
  | 'cleaning'
  | 'food_mess'
  | 'carpentry_furniture'
  | 'other';

export type ComplaintPriority = 'low' | 'medium' | 'high' | 'urgent';
export type ComplaintStatus = 'open' | 'in_progress' | 'resolved' | 'rejected';

export interface ActiveResidentOption {
  id: string;
  full_name: string;
  room_number: string;
}

export interface OwnerComplaintItem {
  id: string;
  property_id: string;
  resident_id: string;
  category: ComplaintCategory;
  priority: ComplaintPriority;
  status: ComplaintStatus;
  title: string;
  description: string;
  photo_url: string | null;
  owner_notes: string | null;
  resolved_at: string | null;
  created_at: string;
  resident?: {
    full_name: string;
    room_number: string;
    phone_number: string | null;
  };
}

export const COMPLAINT_CATEGORY_CONFIG: Record<
  ComplaintCategory,
  { label: string; Icon: React.ComponentType<{ size?: number; color?: string }> }
> = {
  plumbing: { label: 'Plumbing', Icon: Droplets },
  electrical: { label: 'Electrical', Icon: Zap },
  wifi_internet: { label: 'Wi-Fi / Internet', Icon: Wifi },
  cleaning: { label: 'Cleaning', Icon: Sparkles },
  food_mess: { label: 'Food & Mess', Icon: Utensils },
  carpentry_furniture: { label: 'Furniture', Icon: Armchair },
  other: { label: 'Other', Icon: Wrench },
};

export const COMPLAINT_PRIORITY_CONFIG: Record<
  ComplaintPriority,
  { label: string; color: string; bgColor: string }
> = {
  urgent: { label: toSentenceCaseStatus('urgent'), color: '#DC2626', bgColor: '#FEE2E2' },
  high: { label: toSentenceCaseStatus('high'), color: '#EA580C', bgColor: '#FFEDD5' },
  medium: { label: toSentenceCaseStatus('medium'), color: '#D97706', bgColor: '#FEF3C7' },
  low: { label: toSentenceCaseStatus('low'), color: '#64748B', bgColor: '#F1F5F9' },
};

export const COMPLAINT_STATUS_CONFIG: Record<
  ComplaintStatus,
  { label: string; color: string; bgColor: string }
> = {
  open: { label: toSentenceCaseStatus('open'), color: '#0284C7', bgColor: '#E0F2FE' },
  in_progress: { label: toSentenceCaseStatus('in_progress'), color: '#D97706', bgColor: '#FEF3C7' },
  resolved: { label: toSentenceCaseStatus('resolved'), color: '#16A34A', bgColor: '#DCFCE7' },
  rejected: { label: toSentenceCaseStatus('rejected'), color: '#DC2626', bgColor: '#FEE2E2' },
};

export const OwnerComplaintRow = memo(function OwnerComplaintRow({
  item,
  onViewPhoto,
  onOpenActionModal,
}: {
  item: OwnerComplaintItem;
  onViewPhoto: (photoUrl: string) => void;
  onOpenActionModal: (complaint: OwnerComplaintItem) => void;
}) {
  const catInfo = COMPLAINT_CATEGORY_CONFIG[item.category] || COMPLAINT_CATEGORY_CONFIG.other;
  const prioInfo = COMPLAINT_PRIORITY_CONFIG[item.priority] || COMPLAINT_PRIORITY_CONFIG.medium;
  const statusInfo = COMPLAINT_STATUS_CONFIG[item.status] || COMPLAINT_STATUS_CONFIG.open;

  const formattedDate = new Date(item.created_at).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <View style={styles.complaintCard}>
      <View style={styles.cardTopRow}>
        <View style={{ flex: 1, paddingRight: 8 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View profile for ${item.resident?.full_name || 'Resident'}`}
            hitSlop={6}
            style={({ pressed }) => [
              styles.residentNameBtn,
              pressed && { opacity: 0.7 },
            ]}
            onPress={() => {
              if (!item.resident_id) return;
              router.push({
                pathname: '/resident-profile',
                params: { id: item.resident_id },
              } as Href);
            }}>
            <Text style={styles.residentName}>
              {item.resident?.full_name || 'Resident'}
            </Text>
          </Pressable>
          <Text style={styles.roomMeta}>
            Room {item.resident?.room_number || 'N/A'}{' '}
            {item.resident?.phone_number ? `• ${item.resident.phone_number}` : ''}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          <View style={[styles.prioBadge, { backgroundColor: prioInfo.bgColor }]}>
            <Text style={[styles.prioText, { color: prioInfo.color }]}>
              {prioInfo.label}
            </Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusInfo.bgColor }]}>
            <Text style={[styles.statusText, { color: statusInfo.color }]}>
              {statusInfo.label}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.catRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <catInfo.Icon size={14} color="#475569" />
          <Text style={styles.catText}>{catInfo.label}</Text>
        </View>
        <Text style={styles.dateMeta}>{formattedDate}</Text>
      </View>

      <Text style={styles.complaintTitle}>{item.title}</Text>
      <Text style={styles.complaintDesc}>{item.description}</Text>

      {item.photo_url && (
        <Pressable
          style={[
            styles.photoViewBtn,
            { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
          ]}
          onPress={() => onViewPhoto(item.photo_url!)}>
          <Camera size={14} color="#0284C7" />
          <Text style={styles.photoViewBtnText}>View Resident Photo Attachment</Text>
        </Pressable>
      )}

      {item.owner_notes && (
        <View style={styles.ownerNotesBox}>
          <Text style={styles.ownerNotesTitle}>Management Note:</Text>
          <Text style={styles.ownerNotesText}>{item.owner_notes}</Text>
        </View>
      )}

      <Pressable style={styles.actionBtn} onPress={() => onOpenActionModal(item)}>
        <Text style={styles.actionBtnText}>Update Status & Add Notes ›</Text>
      </Pressable>
    </View>
  );
});

export function ComplaintFilterSheetModal({
  visible,
  categoryFilter,
  priorityFilter,
  filteredCount,
  onSelectCategory,
  onSelectPriority,
  onReset,
  onClose,
}: {
  visible: boolean;
  categoryFilter: 'all' | ComplaintCategory;
  priorityFilter: 'all' | ComplaintPriority;
  filteredCount: number;
  onSelectCategory: (cat: 'all' | ComplaintCategory) => void;
  onSelectPriority: (prio: 'all' | ComplaintPriority) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={OwnerSharedStyles.sheetOverlay}>
        <Pressable style={OwnerSharedStyles.sheetBackdrop} onPress={onClose} />
        <View style={OwnerSharedStyles.sheetCard}>
          <View style={OwnerSharedStyles.sheetHandle} />
          <View style={styles.sheetHeaderRow}>
            <Text style={styles.sheetTitle}>Filter Issues</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close filters"
              hitSlop={8}
              onPress={onClose}>
              <X size={20} color="#64748B" />
            </Pressable>
          </View>

          <ScrollView style={styles.sheetScroll} showsVerticalScrollIndicator={false}>
            <Text style={styles.sheetSectionLabel}>Category</Text>
            <View style={styles.wrappedChipsContainer}>
              <Pressable
                accessibilityRole="button"
                style={[
                  OwnerSharedStyles.pillChip,
                  categoryFilter === 'all' && OwnerSharedStyles.pillChipActive,
                ]}
                onPress={() => onSelectCategory('all')}>
                <Text
                  style={[
                    OwnerSharedStyles.pillText,
                    categoryFilter === 'all' && OwnerSharedStyles.pillTextActive,
                  ]}>
                  All Categories
                </Text>
              </Pressable>
              {(Object.keys(COMPLAINT_CATEGORY_CONFIG) as ComplaintCategory[]).map((catKey) => {
                const config = COMPLAINT_CATEGORY_CONFIG[catKey];
                const isActive = categoryFilter === catKey;
                return (
                  <Pressable
                    key={catKey}
                    accessibilityRole="button"
                    style={[
                      OwnerSharedStyles.pillChip,
                      isActive && OwnerSharedStyles.pillChipActive,
                    ]}
                    onPress={() => onSelectCategory(catKey)}>
                    <config.Icon size={14} color={isActive ? '#FFFFFF' : '#475569'} />
                    <Text
                      style={[
                        OwnerSharedStyles.pillText,
                        isActive && OwnerSharedStyles.pillTextActive,
                      ]}>
                      {config.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[styles.sheetSectionLabel, { marginTop: 18 }]}>Priority</Text>
            <View style={styles.wrappedChipsContainer}>
              <Pressable
                accessibilityRole="button"
                style={[
                  OwnerSharedStyles.pillChip,
                  priorityFilter === 'all' && OwnerSharedStyles.pillChipActive,
                ]}
                onPress={() => onSelectPriority('all')}>
                <Text
                  style={[
                    OwnerSharedStyles.pillText,
                    priorityFilter === 'all' && OwnerSharedStyles.pillTextActive,
                  ]}>
                  All Priorities
                </Text>
              </Pressable>
              {(['urgent', 'high', 'medium', 'low'] as ComplaintPriority[]).map((prioKey) => {
                const pConfig = COMPLAINT_PRIORITY_CONFIG[prioKey];
                const isActive = priorityFilter === prioKey;
                return (
                  <Pressable
                    key={prioKey}
                    accessibilityRole="button"
                    style={[
                      OwnerSharedStyles.pillChip,
                      isActive && {
                        backgroundColor: pConfig.bgColor,
                        borderColor: pConfig.color,
                      },
                    ]}
                    onPress={() => onSelectPriority(prioKey)}>
                    <Text
                      style={[
                        OwnerSharedStyles.pillText,
                        isActive && { color: pConfig.color, fontWeight: '700' },
                      ]}>
                      {pConfig.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>

          <View style={styles.sheetFooter}>
            <Pressable
              accessibilityRole="button"
              style={styles.sheetResetBtn}
              onPress={onReset}>
              <Text style={styles.sheetResetBtnText}>Reset</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={styles.sheetApplyBtn}
              onPress={onClose}>
              <Text style={styles.sheetApplyBtnText}>
                Show {filteredCount} issue{filteredCount === 1 ? '' : 's'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function ComplaintActionModal({
  selectedComplaint,
  newStatus,
  notes,
  updating,
  onChangeStatus,
  onChangeNotes,
  onSave,
  onClose,
}: {
  selectedComplaint: OwnerComplaintItem | null;
  newStatus: ComplaintStatus;
  notes: string;
  updating: boolean;
  onChangeStatus: (status: ComplaintStatus) => void;
  onChangeNotes: (text: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={!!selectedComplaint}
      transparent
      animationType="slide"
      onRequestClose={() => {
        if (!updating) onClose();
      }}>
      <View style={OwnerSharedStyles.modalOverlay}>
        <View style={OwnerSharedStyles.modalCard}>
          <Text style={OwnerSharedStyles.modalTitle}>Update Maintenance Ticket</Text>
          <Text style={OwnerSharedStyles.modalSub}>
            {selectedComplaint?.resident?.full_name} • Room{' '}
            {selectedComplaint?.resident?.room_number}
          </Text>

          <View style={styles.ticketSummaryBox}>
            <Text style={styles.ticketSummaryTitle}>{selectedComplaint?.title}</Text>
            <Text style={styles.ticketSummaryDesc}>{selectedComplaint?.description}</Text>
          </View>

          <Text style={OwnerSharedStyles.inputLabel}>Set Ticket Status</Text>
          <View style={styles.statusSelectRow}>
            {(['open', 'in_progress', 'resolved', 'rejected'] as ComplaintStatus[]).map(
              (stKey) => {
                const isSelected = newStatus === stKey;
                const sConfig = COMPLAINT_STATUS_CONFIG[stKey];
                return (
                  <Pressable
                    key={stKey}
                    style={[
                      styles.statusSelectBtn,
                      isSelected && {
                        backgroundColor: sConfig.bgColor,
                        borderColor: sConfig.color,
                      },
                    ]}
                    onPress={() => onChangeStatus(stKey)}>
                    <Text
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.85}
                      style={[
                        styles.statusSelectText,
                        isSelected && { color: sConfig.color, fontWeight: '700' },
                      ]}>
                      {sConfig.label}
                    </Text>
                  </Pressable>
                );
              }
            )}
          </View>

          <Text style={[OwnerSharedStyles.inputLabel, { marginTop: 14 }]}>
            Resolution / Vendor Notes (Visible to Resident)
          </Text>
          <TextInput
            style={OwnerSharedStyles.textArea}
            placeholder="e.g. Electrician scheduled for tomorrow 11 AM..."
            placeholderTextColor="#94A3B8"
            value={notes}
            onChangeText={onChangeNotes}
            multiline
            numberOfLines={3}
          />

          <View style={styles.modalBtnRow}>
            <Pressable
              disabled={updating}
              style={styles.modalCancelBtn}
              onPress={onClose}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              disabled={updating}
              style={[styles.modalSaveBtn, updating && styles.btnDisabled]}
              onPress={onSave}>
              {updating ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.modalSaveText}>Save Update</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function LogComplaintModal({
  visible,
  propertyName,
  activeResidents,
  modalFilteredResidents,
  residentSearch,
  createResidentId,
  createCategory,
  createPriority,
  createTitle,
  createDescription,
  creatingComplaint,
  onChangeResidentSearch,
  onSelectResident,
  onSelectCategory,
  onSelectPriority,
  onChangeTitle,
  onChangeDescription,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  propertyName: string;
  activeResidents: ActiveResidentOption[];
  modalFilteredResidents: ActiveResidentOption[];
  residentSearch: string;
  createResidentId: string;
  createCategory: ComplaintCategory;
  createPriority: ComplaintPriority;
  createTitle: string;
  createDescription: string;
  creatingComplaint: boolean;
  onChangeResidentSearch: (text: string) => void;
  onSelectResident: (id: string) => void;
  onSelectCategory: (cat: ComplaintCategory) => void;
  onSelectPriority: (prio: ComplaintPriority) => void;
  onChangeTitle: (text: string) => void;
  onChangeDescription: (text: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={() => {
        if (!creatingComplaint) onClose();
      }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={OwnerSharedStyles.modalOverlay}>
        <View style={styles.createModalContent}>
          <View style={styles.createModalHeader}>
            <View style={{ flex: 1 }}>
              <Text style={OwnerSharedStyles.modalTitle}>Log Maintenance Issue</Text>
              <Text style={OwnerSharedStyles.modalSub}>{propertyName}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close log complaint modal"
              hitSlop={8}
              disabled={creatingComplaint}
              onPress={onClose}>
              <X size={20} color="#64748B" />
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            style={styles.createModalScroll}>
            <Text style={OwnerSharedStyles.inputLabel}>Resident *</Text>
            {activeResidents.length === 0 ? (
              <View style={styles.noResidentsNotice}>
                <Text style={styles.noResidentsNoticeText}>
                  No active residents found in this property. Add a resident first.
                </Text>
              </View>
            ) : (
              <>
                {activeResidents.length > 5 && (
                  <TextInput
                    style={styles.residentSearchInput}
                    placeholder="Filter resident by name or room..."
                    placeholderTextColor="#94A3B8"
                    value={residentSearch}
                    onChangeText={onChangeResidentSearch}
                    autoCorrect={false}
                  />
                )}
                <ScrollView
                  nestedScrollEnabled
                  style={styles.residentPickerList}
                  showsVerticalScrollIndicator={false}>
                  {modalFilteredResidents.length === 0 ? (
                    <Text style={styles.noResidentsNoticeText}>No matching residents.</Text>
                  ) : (
                    modalFilteredResidents.map((res) => {
                      const isSelected = createResidentId === res.id;
                      return (
                        <Pressable
                          key={res.id}
                          accessibilityRole="button"
                          style={[
                            styles.residentPickerRow,
                            isSelected && styles.residentPickerRowSelected,
                          ]}
                          onPress={() => onSelectResident(res.id)}>
                          <View style={{ flex: 1 }}>
                            <Text
                              style={[
                                styles.residentPickerName,
                                isSelected && styles.residentPickerNameSelected,
                              ]}>
                              {res.full_name}
                            </Text>
                            <Text style={styles.residentPickerRoom}>
                              Room {res.room_number}
                            </Text>
                          </View>
                          {isSelected && (
                            <Check size={16} color={OwnerTheme.colors.primary} />
                          )}
                        </Pressable>
                      );
                    })
                  )}
                </ScrollView>
              </>
            )}

            <Text style={[OwnerSharedStyles.inputLabel, { marginTop: 14 }]}>Category</Text>
            <View style={styles.wrappedChipsContainer}>
              {(Object.keys(COMPLAINT_CATEGORY_CONFIG) as ComplaintCategory[]).map((catKey) => {
                const config = COMPLAINT_CATEGORY_CONFIG[catKey];
                const isActive = createCategory === catKey;
                return (
                  <Pressable
                    key={catKey}
                    accessibilityRole="button"
                    style={[
                      OwnerSharedStyles.pillChip,
                      isActive && OwnerSharedStyles.pillChipActive,
                    ]}
                    onPress={() => onSelectCategory(catKey)}>
                    <config.Icon size={13} color={isActive ? '#FFFFFF' : '#475569'} />
                    <Text
                      style={[
                        OwnerSharedStyles.pillText,
                        isActive && OwnerSharedStyles.pillTextActive,
                      ]}>
                      {config.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[OwnerSharedStyles.inputLabel, { marginTop: 14 }]}>Priority</Text>
            <View style={styles.statusSelectRow}>
              {(['low', 'medium', 'high', 'urgent'] as ComplaintPriority[]).map((prioKey) => {
                const pConfig = COMPLAINT_PRIORITY_CONFIG[prioKey];
                const isSelected = createPriority === prioKey;
                return (
                  <Pressable
                    key={prioKey}
                    accessibilityRole="button"
                    style={[
                      styles.statusSelectBtn,
                      isSelected && {
                        backgroundColor: pConfig.bgColor,
                        borderColor: pConfig.color,
                      },
                    ]}
                    onPress={() => onSelectPriority(prioKey)}>
                    <Text
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.85}
                      style={[
                        styles.statusSelectText,
                        isSelected && { color: pConfig.color, fontWeight: '700' },
                      ]}>
                      {pConfig.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[OwnerSharedStyles.inputLabel, { marginTop: 10 }]}>Title *</Text>
            <TextInput
              style={styles.createTitleInput}
              placeholder="e.g. Bathroom tap leaking"
              placeholderTextColor="#94A3B8"
              value={createTitle}
              onChangeText={onChangeTitle}
              maxLength={120}
            />

            <Text style={[OwnerSharedStyles.inputLabel, { marginTop: 12 }]}>
              Description *
            </Text>
            <TextInput
              style={OwnerSharedStyles.textArea}
              placeholder="Describe the issue and room/area details..."
              placeholderTextColor="#94A3B8"
              value={createDescription}
              onChangeText={onChangeDescription}
              multiline
              numberOfLines={3}
            />
          </ScrollView>

          <View style={styles.modalBtnRow}>
            <Pressable
              disabled={creatingComplaint}
              style={styles.modalCancelBtn}
              onPress={onClose}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              disabled={creatingComplaint || activeResidents.length === 0}
              style={[
                styles.modalSaveBtn,
                (creatingComplaint || activeResidents.length === 0) && styles.btnDisabled,
              ]}
              onPress={onSubmit}>
              {creatingComplaint ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.modalSaveText}>Log Complaint</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function ComplaintPhotoPreviewModal({
  fullImageUrl,
  loadingFullImage,
  onClose,
}: {
  fullImageUrl: string | null;
  loadingFullImage: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={Boolean(fullImageUrl || loadingFullImage)}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <View style={OwnerSharedStyles.fullImageOverlay}>
        <Pressable
          style={[
            OwnerSharedStyles.fullImageCloseBtn,
            { flexDirection: 'row', alignItems: 'center', gap: 6 },
          ]}
          onPress={onClose}>
          <Text style={OwnerSharedStyles.fullImageCloseText}>Close</Text>
          <X size={16} color="#FFFFFF" />
        </Pressable>
        {loadingFullImage ? (
          <ActivityIndicator size="large" color="#FFFFFF" />
        ) : fullImageUrl ? (
          <Image
            source={{ uri: fullImageUrl }}
            style={styles.fullImageView}
            resizeMode="contain"
          />
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  complaintCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 12,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  residentNameBtn: { alignSelf: 'flex-start' },
  residentName: { fontSize: 15, fontWeight: '700', color: '#0F172A' },
  roomMeta: { fontSize: 12, color: '#64748B', marginTop: 1 },
  prioBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 9999 },
  prioText: { fontSize: 11, fontWeight: '700' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 9999 },
  statusText: { fontSize: 11, fontWeight: '700' },
  catRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  catText: { fontSize: 11, fontWeight: '700', color: '#0284C7' },
  dateMeta: { fontSize: 11, color: '#94A3B8' },
  complaintTitle: { fontSize: 14, fontWeight: '700', color: '#0F172A', marginBottom: 4 },
  complaintDesc: { fontSize: 13, color: '#475569', lineHeight: 18 },
  photoViewBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  photoViewBtnText: { fontSize: 12, fontWeight: '700', color: '#0284C7' },
  ownerNotesBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 8,
    marginTop: 8,
  },
  ownerNotesTitle: { fontSize: 11, fontWeight: '700', color: '#334155' },
  ownerNotesText: { fontSize: 12, color: '#475569', marginTop: 2 },
  actionBtn: {
    marginTop: 10,
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: '#F0F9FF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  actionBtnText: { fontSize: 12, fontWeight: '700', color: '#0284C7' },
  sheetHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: '#0F172A' },
  sheetScroll: { maxHeight: 380 },
  sheetSectionLabel: { fontSize: 13, fontWeight: '700', color: '#334155', marginBottom: 10 },
  wrappedChipsContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sheetFooter: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  sheetResetBtn: {
    flex: 1,
    height: 46,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetResetBtnText: { fontSize: 14, fontWeight: '600', color: '#475569' },
  sheetApplyBtn: {
    flex: 2,
    height: 46,
    borderRadius: 10,
    backgroundColor: OwnerTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetApplyBtnText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  ticketSummaryBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 10,
    marginBottom: 14,
  },
  ticketSummaryTitle: { fontSize: 13, fontWeight: '700', color: '#0F172A', marginBottom: 2 },
  ticketSummaryDesc: { fontSize: 12, color: '#64748B', lineHeight: 16 },
  statusSelectRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  statusSelectBtn: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 4,
    backgroundColor: '#F8FAFC',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
  },
  statusSelectText: { fontSize: 11, fontWeight: '600', color: '#64748B' },
  modalBtnRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    alignItems: 'center',
  },
  modalCancelText: { fontSize: 13, fontWeight: '700', color: '#475569' },
  modalSaveBtn: {
    flex: 2,
    paddingVertical: 12,
    backgroundColor: '#0284C7',
    borderRadius: 8,
    alignItems: 'center',
  },
  modalSaveText: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
  btnDisabled: { opacity: 0.6 },
  createModalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    padding: 20,
    maxHeight: '88%',
  },
  createModalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  createModalScroll: { maxHeight: 460 },
  residentSearchInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: OwnerTheme.radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: '#0F172A',
    marginBottom: 8,
  },
  residentPickerList: {
    maxHeight: 135,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: OwnerTheme.radius.sm,
    backgroundColor: '#F8FAFC',
    padding: 4,
  },
  residentPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: OwnerTheme.radius.sm,
  },
  residentPickerRowSelected: { backgroundColor: OwnerTheme.colors.primaryLight },
  residentPickerName: { fontSize: 13, fontWeight: '600', color: '#0F172A' },
  residentPickerNameSelected: { color: OwnerTheme.colors.primary, fontWeight: '700' },
  residentPickerRoom: { fontSize: 11, color: '#64748B' },
  noResidentsNotice: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: OwnerTheme.radius.sm,
    padding: 10,
  },
  noResidentsNoticeText: { fontSize: 12, color: '#92400E', padding: 6 },
  createTitleInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: OwnerTheme.radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: '#0F172A',
  },
  fullImageView: { width: '92%', height: '80%' },
});
