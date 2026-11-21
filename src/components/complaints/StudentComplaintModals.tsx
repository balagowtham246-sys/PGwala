import React, { memo } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  Armchair,
  Camera,
  Check,
  Droplets,
  Sparkles,
  Utensils,
  Wifi,
  Wrench,
  Zap,
} from 'lucide-react-native';

import {
  COMPLAINT_PRIORITY_CONFIG,
  COMPLAINT_STATUS_CONFIG,
  ComplaintCategory,
  ComplaintPriority,
  ComplaintStatus,
} from '@/components/complaints/OwnerComplaintsModals';
import { OwnerSharedStyles } from '@/components/ui/owner';

export interface StudentComplaintItem {
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
}

export const STUDENT_COMPLAINT_CATEGORY_CONFIG: Record<
  ComplaintCategory,
  { label: string; Icon: React.ComponentType<{ size?: number; color?: string }> }
> = {
  plumbing: { label: 'Plumbing / Water', Icon: Droplets },
  electrical: { label: 'Electrical / Lights', Icon: Zap },
  wifi_internet: { label: 'Wi-Fi & Internet', Icon: Wifi },
  cleaning: { label: 'Room & Washroom Cleaning', Icon: Sparkles },
  food_mess: { label: 'Food & Mess Quality', Icon: Utensils },
  carpentry_furniture: { label: 'Bed & Furniture', Icon: Armchair },
  other: { label: 'Other Issues', Icon: Wrench },
};

export const StudentComplaintCard = memo(function StudentComplaintCard({
  item,
  onViewPhoto,
}: {
  item: StudentComplaintItem;
  onViewPhoto: (photoUrl: string) => void;
}) {
  const catInfo =
    STUDENT_COMPLAINT_CATEGORY_CONFIG[item.category] ||
    STUDENT_COMPLAINT_CATEGORY_CONFIG.other;
  const prioInfo =
    COMPLAINT_PRIORITY_CONFIG[item.priority] || COMPLAINT_PRIORITY_CONFIG.medium;
  const statusInfo =
    COMPLAINT_STATUS_CONFIG[item.status] || COMPLAINT_STATUS_CONFIG.open;

  const formattedDate = new Date(item.created_at).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <View style={styles.complaintCard}>
      <View style={styles.cardHeaderRow}>
        <View style={styles.catBadge}>
          <catInfo.Icon size={14} color="#475569" />
          <Text style={styles.catText}>{catInfo.label}</Text>
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

      <Text style={styles.cardTitle}>{item.title}</Text>
      <Text style={styles.cardDesc}>{item.description}</Text>

      <Text style={styles.cardDate}>Reported on {formattedDate}</Text>

      {item.photo_url && (
        <Pressable
          style={[
            styles.cardPhotoBtn,
            { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
          ]}
          onPress={() => onViewPhoto(item.photo_url!)}>
          <Camera size={14} color="#0284C7" />
          <Text style={styles.cardPhotoBtnText}>View Attached Photo</Text>
        </Pressable>
      )}

      {item.owner_notes && (
        <View style={styles.ownerResponseBox}>
          <Text style={styles.ownerResponseTitle}>Owner / Management Update:</Text>
          <Text style={styles.ownerResponseText}>{item.owner_notes}</Text>
          {item.resolved_at && (
            <Text style={styles.resolvedDateText}>
              Resolved on{' '}
              {new Date(item.resolved_at).toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </Text>
          )}
        </View>
      )}
    </View>
  );
});

export function RaiseComplaintModal({
  visible,
  submitting,
  category,
  priority,
  title,
  description,
  selectedPhotoUri,
  onSelectCategory,
  onSelectPriority,
  onChangeTitle,
  onChangeDescription,
  onPickImage,
  onRemovePhoto,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  submitting: boolean;
  category: ComplaintCategory;
  priority: ComplaintPriority;
  title: string;
  description: string;
  selectedPhotoUri: string | null;
  onSelectCategory: (cat: ComplaintCategory) => void;
  onSelectPriority: (prio: ComplaintPriority) => void;
  onChangeTitle: (val: string) => void;
  onChangeDescription: (val: string) => void;
  onPickImage: () => void;
  onRemovePhoto: () => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={() => {
        if (!submitting) onClose();
      }}>
      <View style={OwnerSharedStyles.modalOverlay}>
        <View style={[OwnerSharedStyles.modalCard, { maxHeight: '88%' }]}>
          <Text style={OwnerSharedStyles.modalTitle}>Raise Complaint / Request</Text>
          <Text style={OwnerSharedStyles.modalSub}>
            Let your PG owner know what needs maintenance or repair in your room.
          </Text>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={OwnerSharedStyles.inputLabel}>Select Category</Text>
            <View style={styles.categoryWrap}>
              {(Object.keys(STUDENT_COMPLAINT_CATEGORY_CONFIG) as ComplaintCategory[]).map(
                (catKey) => {
                  const isSelected = category === catKey;
                  const cConfig = STUDENT_COMPLAINT_CATEGORY_CONFIG[catKey];
                  return (
                    <Pressable
                      key={catKey}
                      style={[
                        styles.categoryChip,
                        isSelected && styles.categoryChipActive,
                      ]}
                      onPress={() => onSelectCategory(catKey)}>
                      <cConfig.Icon
                        size={14}
                        color={isSelected ? '#FFFFFF' : '#475569'}
                      />
                      <Text
                        style={[
                          styles.categoryChipText,
                          isSelected && styles.categoryChipTextActive,
                        ]}>
                        {cConfig.label}
                      </Text>
                    </Pressable>
                  );
                }
              )}
            </View>

            <Text style={[OwnerSharedStyles.inputLabel, { marginTop: 12 }]}>
              Urgency / Priority
            </Text>
            <View style={styles.prioToggleRow}>
              {(['low', 'medium', 'high', 'urgent'] as ComplaintPriority[]).map(
                (prioKey) => {
                  const isSelected = priority === prioKey;
                  const pConfig = COMPLAINT_PRIORITY_CONFIG[prioKey];
                  return (
                    <Pressable
                      key={prioKey}
                      style={[
                        styles.prioToggleBtn,
                        isSelected && {
                          backgroundColor: pConfig.bgColor,
                          borderColor: pConfig.color,
                        },
                      ]}
                      onPress={() => onSelectPriority(prioKey)}>
                      <Text
                        style={[
                          styles.prioToggleText,
                          isSelected && { color: pConfig.color, fontWeight: '800' },
                        ]}>
                        {pConfig.label}
                      </Text>
                    </Pressable>
                  );
                }
              )}
            </View>

            <Text style={[OwnerSharedStyles.inputLabel, { marginTop: 12 }]}>Title *</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. Geyser not heating water"
              placeholderTextColor="#94A3B8"
              value={title}
              onChangeText={onChangeTitle}
              maxLength={120}
            />

            <Text style={[OwnerSharedStyles.inputLabel, { marginTop: 12 }]}>
              Description *
            </Text>
            <TextInput
              style={[styles.modalInput, styles.descInput]}
              placeholder="Describe the issue in detail (e.g. location, when it started)..."
              placeholderTextColor="#94A3B8"
              value={description}
              onChangeText={onChangeDescription}
              multiline
              numberOfLines={4}
            />

            <Text style={[OwnerSharedStyles.inputLabel, { marginTop: 14 }]}>
              Photo of Issue (Optional)
            </Text>
            {selectedPhotoUri ? (
              <View style={styles.photoPreviewCard}>
                <Image source={{ uri: selectedPhotoUri }} style={styles.photoPreviewImg} />
                <View style={styles.photoPreviewMeta}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <Check size={14} color="#059669" />
                    <Text style={styles.photoAttachedText}>Photo Attached</Text>
                  </View>
                  <Pressable style={styles.photoRemoveBtn} onPress={onRemovePhoto}>
                    <Text style={styles.photoRemoveBtnText}>Remove Photo</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable style={styles.photoUploadBtn} onPress={onPickImage}>
                <Camera size={22} color="#64748B" />
                <Text style={styles.photoUploadTitle}>Attach Photo</Text>
                <Text style={styles.photoUploadSub}>
                  Take a photo or choose from gallery
                </Text>
              </Pressable>
            )}
          </ScrollView>

          <View style={styles.modalBtnRow}>
            <Pressable
              disabled={submitting}
              style={styles.modalCancelBtn}
              onPress={onClose}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              disabled={submitting}
              style={[styles.modalSubmitBtn, submitting && styles.btnDisabled]}
              onPress={onSubmit}>
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.modalSubmitText}>Submit Complaint</Text>
              )}
            </Pressable>
          </View>
        </View>
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
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  catBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  catText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  prioBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 9999,
  },
  prioText: {
    fontSize: 10,
    fontWeight: '700',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 9999,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4,
  },
  cardDesc: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 18,
  },
  cardDate: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 8,
  },
  cardPhotoBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  cardPhotoBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0284C7',
  },
  ownerResponseBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 10,
    marginTop: 10,
  },
  ownerResponseTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 2,
  },
  ownerResponseText: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 16,
  },
  resolvedDateText: {
    fontSize: 11,
    color: '#16A34A',
    fontWeight: '600',
    marginTop: 4,
  },
  categoryWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 4,
  },
  categoryChipActive: {
    backgroundColor: '#087FAF',
    borderColor: '#087FAF',
  },
  categoryChipText: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '600',
  },
  categoryChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  prioToggleRow: {
    flexDirection: 'row',
    gap: 6,
  },
  prioToggleBtn: {
    flex: 1,
    paddingVertical: 7,
    backgroundColor: '#F8FAFC',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
  },
  prioToggleText: {
    fontSize: 10,
    color: '#64748B',
    fontWeight: '700',
  },
  modalInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0F172A',
  },
  descInput: {
    height: 90,
    textAlignVertical: 'top',
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    alignItems: 'center',
  },
  modalCancelText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  modalSubmitBtn: {
    flex: 2,
    paddingVertical: 12,
    backgroundColor: '#0284C7',
    borderRadius: 8,
    alignItems: 'center',
  },
  modalSubmitText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  btnDisabled: {
    opacity: 0.6,
  },
  photoUploadBtn: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#BAE6FD',
    borderStyle: 'dashed',
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  photoUploadTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0284C7',
    marginTop: 3,
  },
  photoUploadSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  photoPreviewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 8,
    padding: 10,
    marginTop: 6,
    gap: 12,
  },
  photoPreviewImg: {
    width: 56,
    height: 56,
    borderRadius: 6,
  },
  photoPreviewMeta: {
    flex: 1,
  },
  photoAttachedText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#15803D',
  },
  photoRemoveBtn: {
    marginTop: 4,
  },
  photoRemoveBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#DC2626',
  },
});
