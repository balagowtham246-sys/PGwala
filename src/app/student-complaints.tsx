import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';

import { useAuth } from '@/context/auth-context';
import { supabase, decodeBase64ToBytes, getSignedComplaintPhotoUrl } from '@/lib/supabase';

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

export interface ComplaintRecord {
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

interface StudentResident {
  id: string;
  property_id: string;
  full_name: string;
  room_number: string;
  property?: {
    name: string;
  };
}

const CATEGORY_CONFIG: Record<ComplaintCategory, { label: string; icon: string }> = {
  plumbing: { label: 'Plumbing / Water', icon: '🚿' },
  electrical: { label: 'Electrical / Lights', icon: '⚡' },
  wifi_internet: { label: 'Wi-Fi & Internet', icon: '📶' },
  cleaning: { label: 'Room & Washroom Cleaning', icon: '🧹' },
  food_mess: { label: 'Food & Mess Quality', icon: '🍲' },
  carpentry_furniture: { label: 'Bed & Furniture', icon: '🪑' },
  other: { label: 'Other Issues', icon: '📋' },
};

const PRIORITY_CONFIG: Record<
  ComplaintPriority,
  { label: string; color: string; bgColor: string }
> = {
  urgent: { label: 'URGENT', color: '#DC2626', bgColor: '#FEE2E2' },
  high: { label: 'HIGH', color: '#EA580C', bgColor: '#FFEDD5' },
  medium: { label: 'MEDIUM', color: '#D97706', bgColor: '#FEF3C7' },
  low: { label: 'LOW', color: '#64748B', bgColor: '#F1F5F9' },
};

const STATUS_CONFIG: Record<
  ComplaintStatus,
  { label: string; color: string; bgColor: string }
> = {
  open: { label: 'OPEN', color: '#0284C7', bgColor: '#E0F2FE' },
  in_progress: { label: 'IN PROGRESS', color: '#D97706', bgColor: '#FEF3C7' },
  resolved: { label: 'RESOLVED', color: '#16A34A', bgColor: '#DCFCE7' },
  rejected: { label: 'REJECTED', color: '#DC2626', bgColor: '#FEE2E2' },
};

export default function StudentComplaintsScreen() {
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [resident, setResident] = useState<StudentResident | null>(null);
  const [complaints, setComplaints] = useState<ComplaintRecord[]>([]);

  // Filter: 'all' | 'active' | 'resolved'
  const [filter, setFilter] = useState<'all' | 'active' | 'resolved'>('active');

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [category, setCategory] = useState<ComplaintCategory>('plumbing');
  const [priority, setPriority] = useState<ComplaintPriority>('medium');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedPhoto, setSelectedPhoto] = useState<{
    uri: string;
    base64?: string | null;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Full Screen Image Viewer Modal
  const [fullImageUrl, setFullImageUrl] = useState<string | null>(null);
  const [loadingFullImage, setLoadingFullImage] = useState(false);

  const handlePickImage = async () => {
    Alert.alert('Attach Issue Photo', 'Choose how you want to add a photo of the maintenance issue:', [
      {
        text: 'Take Photo (Camera)',
        onPress: handleLaunchCamera,
      },
      {
        text: 'Choose from Gallery',
        onPress: handleLaunchGallery,
      },
      {
        text: 'Cancel',
        style: 'cancel',
      },
    ]);
  };

  const handleLaunchCamera = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission Required', 'Camera permission is needed to photograph the issue.');
        return;
      }
      const res = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.7,
        base64: true,
      });
      if (!res.canceled && res.assets && res.assets.length > 0) {
        setSelectedPhoto({
          uri: res.assets[0].uri,
          base64: res.assets[0].base64,
        });
      }
    } catch (err) {
      console.warn('[StudentComplaints] Camera launch error:', err);
      Alert.alert('Camera Error', 'Could not access the camera.');
    }
  };

  const handleLaunchGallery = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission Required', 'Photo library permission is needed to choose an image.');
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.7,
        base64: true,
      });
      if (!res.canceled && res.assets && res.assets.length > 0) {
        setSelectedPhoto({
          uri: res.assets[0].uri,
          base64: res.assets[0].base64,
        });
      }
    } catch (err) {
      console.warn('[StudentComplaints] Gallery launch error:', err);
      Alert.alert('Gallery Error', 'Could not open photo gallery.');
    }
  };

  const handleViewPhoto = async (rawUrlOrPath: string) => {
    try {
      setLoadingFullImage(true);
      const signed = await getSignedComplaintPhotoUrl(rawUrlOrPath);
      setFullImageUrl(signed || rawUrlOrPath);
    } catch (err) {
      console.warn('[StudentComplaints] Signed photo error:', err);
      setFullImageUrl(rawUrlOrPath);
    } finally {
      setLoadingFullImage(false);
    }
  };

  const loadData = useCallback(async () => {
    if (!user?.id) return;
    try {
      setLoading(true);

      // 1. Fetch linked resident
      const { data: resData, error: resError } = await supabase
        .from('residents')
        .select(`
          id,
          property_id,
          full_name,
          room_number,
          property:properties (
            name
          )
        `)
        .eq('profile_id', user.id)
        .eq('is_active', true)
        .maybeSingle();

      if (resError) throw resError;
      if (!resData) {
        setResident(null);
        setLoading(false);
        return;
      }

      const resObj: StudentResident = {
        id: resData.id,
        property_id: resData.property_id,
        full_name: resData.full_name,
        room_number: resData.room_number,
        property: Array.isArray(resData.property) ? resData.property[0] : resData.property,
      };
      setResident(resObj);

      // 2. Fetch complaints for this resident
      const { data: compData, error: compError } = await supabase
        .from('complaints')
        .select('*')
        .eq('resident_id', resObj.id)
        .order('created_at', { ascending: false });

      if (compError) {
        // Table not yet migrated or soft error
        console.warn('[StudentComplaints] Complaints query warning:', compError.message);
        setComplaints([]);
      } else {
        setComplaints(compData || []);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[StudentComplaints] Load error:', err);
      Alert.alert('Load Error', msg || 'Could not load your complaints.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Submit new complaint
  const handleSubmitComplaint = async () => {
    if (!resident || submitting) return;

    const trimmedTitle = title.trim();
    const trimmedDesc = description.trim();

    if (trimmedTitle.length < 3) {
      Alert.alert('Title Required', 'Please provide a descriptive title (at least 3 characters).');
      return;
    }
    if (trimmedDesc.length < 5) {
      Alert.alert(
        'Description Required',
        'Please describe the issue in detail so the owner can address it.'
      );
      return;
    }

    setSubmitting(true);
    try {
      let uploadedPhotoPath: string | null = null;

      // 1. Upload photo if selected
      if (selectedPhoto?.base64) {
        try {
          const fileExt =
            selectedPhoto.uri.split('.').pop()?.toLowerCase() || 'jpg';
          const fileName = `${resident.id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${fileExt}`;
          const bytes = decodeBase64ToBytes(selectedPhoto.base64);

          const { error: uploadError } = await supabase.storage
            .from('complaint-photos')
            .upload(fileName, bytes, {
              contentType: `image/${fileExt === 'png' ? 'png' : 'jpeg'}`,
              upsert: false,
            });

          if (uploadError) {
            throw new Error(`Photo upload failed: ${uploadError.message}`);
          }
          uploadedPhotoPath = fileName;
        } catch (photoErr: unknown) {
          const pMsg = photoErr instanceof Error ? photoErr.message : String(photoErr);
          Alert.alert('Photo Upload Error', pMsg || 'Could not upload attachment.');
          setSubmitting(false);
          return;
        }
      }

      // 2. Insert complaint record
      const { error } = await supabase.from('complaints').insert({
        property_id: resident.property_id,
        resident_id: resident.id,
        category,
        priority,
        title: trimmedTitle,
        description: trimmedDesc,
        photo_url: uploadedPhotoPath,
      });

      if (error) throw error;

      Alert.alert(
        'Complaint Submitted',
        'Your request has been forwarded to your PG owner. You can track progress right here.'
      );

      setShowModal(false);
      setTitle('');
      setDescription('');
      setSelectedPhoto(null);
      setCategory('plumbing');
      setPriority('medium');
      setFilter('active');
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[StudentComplaints] Submit error:', err);
      Alert.alert('Submission Failed', msg || 'Could not submit your complaint.');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredComplaints = useMemo(() => {
    if (filter === 'all') return complaints;
    if (filter === 'active') {
      return complaints.filter((c) => c.status === 'open' || c.status === 'in_progress');
    }
    if (filter === 'resolved') {
      return complaints.filter((c) => c.status === 'resolved' || c.status === 'rejected');
    }
    return complaints;
  }, [complaints, filter]);

  const activeCount = complaints.filter(
    (c) => c.status === 'open' || c.status === 'in_progress'
  ).length;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              loadData();
            }}
            colors={['#0284C7']}
          />
        }>
        {/* Top Header */}
        <View style={styles.topBar}>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
            onPress={() => router.back()}>
            <Text style={styles.backButtonText}>‹ Back</Text>
          </Pressable>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.screenTitle}>Complaints & Requests</Text>
            <Text style={styles.screenSubtitle}>
              {resident?.property?.name || 'PG Accommodation'} • Room {resident?.room_number}
            </Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color="#0284C7" />
            <Text style={styles.loadingText}>Loading complaints & requests...</Text>
          </View>
        ) : !resident ? (
          <View style={styles.unlinkedCard}>
            <Text style={styles.unlinkedTitle}>Room Not Linked</Text>
            <Text style={styles.unlinkedSub}>
              Your account has not yet been linked to an active room.
            </Text>
          </View>
        ) : (
          <>
            {/* Action Bar */}
            <View style={styles.actionBanner}>
              <View style={{ flex: 1 }}>
                <Text style={styles.actionBannerTitle}>Facing an issue in your room?</Text>
                <Text style={styles.actionBannerSub}>
                  Report repairs or requests directly to your PG owner.
                </Text>
              </View>
              <Pressable
                style={styles.raiseBtn}
                onPress={() => setShowModal(true)}>
                <Text style={styles.raiseBtnText}>+ Raise Issue</Text>
              </Pressable>
            </View>

            {/* Filter Tabs */}
            <View style={styles.filterRow}>
              <Pressable
                style={[styles.filterBtn, filter === 'active' && styles.filterBtnActive]}
                onPress={() => setFilter('active')}>
                <Text
                  style={[
                    styles.filterBtnText,
                    filter === 'active' && styles.filterBtnTextActive,
                  ]}>
                  Active ({activeCount})
                </Text>
              </Pressable>
              <Pressable
                style={[styles.filterBtn, filter === 'resolved' && styles.filterBtnActive]}
                onPress={() => setFilter('resolved')}>
                <Text
                  style={[
                    styles.filterBtnText,
                    filter === 'resolved' && styles.filterBtnTextActive,
                  ]}>
                  Resolved ({complaints.length - activeCount})
                </Text>
              </Pressable>
              <Pressable
                style={[styles.filterBtn, filter === 'all' && styles.filterBtnActive]}
                onPress={() => setFilter('all')}>
                <Text
                  style={[
                    styles.filterBtnText,
                    filter === 'all' && styles.filterBtnTextActive,
                  ]}>
                  All ({complaints.length})
                </Text>
              </Pressable>
            </View>

            {/* Complaints List */}
            {filteredComplaints.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyIcon}>🎉</Text>
                <Text style={styles.emptyTitle}>No Issues Found</Text>
                <Text style={styles.emptySub}>
                  {filter === 'active'
                    ? 'You have no open complaints or pending maintenance requests!'
                    : 'No complaints match the selected filter.'}
                </Text>
              </View>
            ) : (
              filteredComplaints.map((item) => {
                const catInfo = CATEGORY_CONFIG[item.category] || CATEGORY_CONFIG.other;
                const prioInfo = PRIORITY_CONFIG[item.priority] || PRIORITY_CONFIG.medium;
                const statusInfo = STATUS_CONFIG[item.status] || STATUS_CONFIG.open;

                const formattedDate = new Date(item.created_at).toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                });

                return (
                  <View key={item.id} style={styles.complaintCard}>
                    {/* Top Row: Category & Badges */}
                    <View style={styles.cardHeaderRow}>
                      <View style={styles.catBadge}>
                        <Text style={styles.catIcon}>{catInfo.icon}</Text>
                        <Text style={styles.catText}>{catInfo.label}</Text>
                      </View>

                      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                        <View
                          style={[
                            styles.prioBadge,
                            { backgroundColor: prioInfo.bgColor },
                          ]}>
                          <Text style={[styles.prioText, { color: prioInfo.color }]}>
                            {prioInfo.label}
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.statusBadge,
                            { backgroundColor: statusInfo.bgColor },
                          ]}>
                          <Text style={[styles.statusText, { color: statusInfo.color }]}>
                            {statusInfo.label}
                          </Text>
                        </View>
                      </View>
                    </View>

                    {/* Title & Description */}
                    <Text style={styles.cardTitle}>{item.title}</Text>
                    <Text style={styles.cardDesc}>{item.description}</Text>

                    <Text style={styles.cardDate}>Reported on {formattedDate}</Text>

                    {/* Attached Photo View */}
                    {item.photo_url && (
                      <Pressable
                        style={styles.cardPhotoBtn}
                        onPress={() => handleViewPhoto(item.photo_url!)}>
                        <Text style={styles.cardPhotoBtnText}>📷 View Attached Photo</Text>
                      </Pressable>
                    )}

                    {/* Owner Resolution Box */}
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
              })
            )}
          </>
        )}
      </ScrollView>

      {/* MODAL: Raise New Complaint */}
      <Modal
        visible={showModal}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!submitting) setShowModal(false);
        }}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Raise Complaint / Request</Text>
            <Text style={styles.modalSub}>
              Let your PG owner know what needs maintenance or repair in your room.
            </Text>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Category Selection */}
              <Text style={styles.inputLabel}>Select Category</Text>
              <View style={styles.categoryWrap}>
                {(
                  Object.keys(CATEGORY_CONFIG) as ComplaintCategory[]
                ).map((catKey) => {
                  const isSelected = category === catKey;
                  const cConfig = CATEGORY_CONFIG[catKey];
                  return (
                    <Pressable
                      key={catKey}
                      style={[
                        styles.categoryChip,
                        isSelected && styles.categoryChipActive,
                      ]}
                      onPress={() => setCategory(catKey)}>
                      <Text style={styles.categoryChipIcon}>{cConfig.icon}</Text>
                      <Text
                        style={[
                          styles.categoryChipText,
                          isSelected && styles.categoryChipTextActive,
                        ]}>
                        {cConfig.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Priority Toggle */}
              <Text style={[styles.inputLabel, { marginTop: 12 }]}>Urgency / Priority</Text>
              <View style={styles.prioToggleRow}>
                {(['low', 'medium', 'high', 'urgent'] as ComplaintPriority[]).map(
                  (prioKey) => {
                    const isSelected = priority === prioKey;
                    const pConfig = PRIORITY_CONFIG[prioKey];
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
                        onPress={() => setPriority(prioKey)}>
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

              {/* Title Input */}
              <Text style={[styles.inputLabel, { marginTop: 12 }]}>Title *</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="e.g. Geyser not heating water"
                placeholderTextColor="#94A3B8"
                value={title}
                onChangeText={setTitle}
                maxLength={120}
              />

              {/* Description Input */}
              <Text style={[styles.inputLabel, { marginTop: 12 }]}>Description *</Text>
              <TextInput
                style={[styles.modalInput, styles.descInput]}
                placeholder="Describe the issue in detail (e.g. location, when it started)..."
                placeholderTextColor="#94A3B8"
                value={description}
                onChangeText={setDescription}
                multiline
                numberOfLines={4}
              />

              {/* Photo Attachment Section */}
              <Text style={[styles.inputLabel, { marginTop: 14 }]}>Photo of Issue (Optional)</Text>
              {selectedPhoto ? (
                <View style={styles.photoPreviewCard}>
                  <Image source={{ uri: selectedPhoto.uri }} style={styles.photoPreviewImg} />
                  <View style={styles.photoPreviewMeta}>
                    <Text style={styles.photoAttachedText}>✓ Photo Attached</Text>
                    <Pressable
                      style={styles.photoRemoveBtn}
                      onPress={() => setSelectedPhoto(null)}>
                      <Text style={styles.photoRemoveBtnText}>Remove Photo</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Pressable style={styles.photoUploadBtn} onPress={handlePickImage}>
                  <Text style={styles.photoUploadIcon}>📷</Text>
                  <Text style={styles.photoUploadTitle}>Attach Photo</Text>
                  <Text style={styles.photoUploadSub}>Take a photo or choose from gallery</Text>
                </Pressable>
              )}
            </ScrollView>

            {/* Modal Buttons */}
            <View style={styles.modalBtnRow}>
              <Pressable
                disabled={submitting}
                style={styles.modalCancelBtn}
                onPress={() => setShowModal(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                disabled={submitting}
                style={[styles.modalSubmitBtn, submitting && styles.btnDisabled]}
                onPress={handleSubmitComplaint}>
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

      {/* Full-Screen Image Viewer Modal */}
      <Modal
        visible={Boolean(fullImageUrl || loadingFullImage)}
        transparent
        animationType="fade"
        onRequestClose={() => setFullImageUrl(null)}>
        <View style={styles.fullImageOverlay}>
          <Pressable
            style={styles.fullImageCloseBtn}
            onPress={() => setFullImageUrl(null)}>
            <Text style={styles.fullImageCloseText}>Close ✕</Text>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 40,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  backButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginRight: 10,
  },
  backButtonPressed: {
    backgroundColor: '#F1F5F9',
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0284C7',
  },
  headerTitleWrap: {
    flex: 1,
  },
  screenTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
  },
  screenSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
  },
  loadingBox: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 8,
  },
  unlinkedCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  unlinkedTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  unlinkedSub: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 4,
    textAlign: 'center',
  },
  actionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 14,
  },
  actionBannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  actionBannerSub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  raiseBtn: {
    backgroundColor: '#0284C7',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    marginLeft: 12,
  },
  raiseBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  filterRow: {
    flexDirection: 'row',
    backgroundColor: '#E2E8F0',
    borderRadius: 8,
    padding: 2,
    marginBottom: 16,
  },
  filterBtn: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    borderRadius: 6,
  },
  filterBtnActive: {
    backgroundColor: '#FFFFFF',
  },
  filterBtnText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  filterBtnTextActive: {
    color: '#0F172A',
    fontWeight: '700',
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 30,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  emptyIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E293B',
  },
  emptySub: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 18,
  },
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
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 4,
  },
  catIcon: {
    fontSize: 12,
  },
  catText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  prioBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  prioText: {
    fontSize: 9,
    fontWeight: '800',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '800',
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
    lineHeight: 19,
  },
  cardDate: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 8,
  },
  ownerResponseBox: {
    backgroundColor: '#F0FDF4',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    padding: 10,
    marginTop: 10,
  },
  ownerResponseTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#166534',
    marginBottom: 2,
  },
  ownerResponseText: {
    fontSize: 12,
    color: '#15803D',
    lineHeight: 18,
  },
  resolvedDateText: {
    fontSize: 10,
    color: '#166534',
    marginTop: 4,
    fontStyle: 'italic',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    maxHeight: '90%',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalSub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 4,
    marginBottom: 14,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
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
    backgroundColor: '#E0F2FE',
    borderColor: '#0284C7',
  },
  categoryChipIcon: {
    fontSize: 12,
  },
  categoryChipText: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '600',
  },
  categoryChipTextActive: {
    color: '#0284C7',
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
  photoUploadIcon: {
    fontSize: 26,
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
  fullImageOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullImageCloseBtn: {
    position: 'absolute',
    top: 50,
    right: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    zIndex: 10,
  },
  fullImageCloseText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  fullImageView: {
    width: '92%',
    height: '80%',
  },
});

