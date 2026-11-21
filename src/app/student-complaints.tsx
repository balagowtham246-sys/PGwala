import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RoleBottomNav } from '@/components/ui/bottom-nav';
import { OwnerHeader } from '@/components/ui/owner';
import { router, useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { CheckCircle2 } from 'lucide-react-native';

import {
  ComplaintCategory,
  ComplaintPhotoPreviewModal,
  ComplaintPriority,
  ComplaintStatus,
} from '@/components/complaints/OwnerComplaintsModals';
import {
  RaiseComplaintModal,
  StudentComplaintCard,
  StudentComplaintItem,
} from '@/components/complaints/StudentComplaintModals';
import { useAuth } from '@/context/auth-context';
import { useResident } from '@/context/resident-context';
import { useToast } from '@/context/toast-context';
import { extractErrorMessage } from '@/lib/error-utils';
import {
  enqueueOfflineMutation,
  flushOfflineQueue,
  getPendingCount,
} from '@/lib/offline-queue';
import { isLikelyNetworkError } from '@/lib/service-result';
import { supabase, decodeBase64ToBytes, getSignedComplaintPhotoUrl } from '@/lib/supabase';
import { formatRoomLabel } from '@/lib/ux-utils';
import {
  ComplaintOfflinePayload,
  defaultOfflineExecutors,
} from '@/services/offline-executors';

export type { ComplaintCategory, ComplaintPriority, ComplaintStatus };
export type ComplaintRecord = StudentComplaintItem;

interface StudentResident {
  id: string;
  property_id: string;
  full_name: string;
  room_number: string;
  property?: {
    name: string;
  };
}

export default function StudentComplaintsScreen() {
  const { user } = useAuth();
  const { resident: sharedResident, refreshResident } = useResident();
  const { showToast } = useToast();
  const userId = user?.id;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [resident, setResident] = useState<StudentResident | null>(null);
  const [complaints, setComplaints] = useState<ComplaintRecord[]>([]);
  const [pendingOfflineCount, setPendingOfflineCount] = useState(0);

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
    if (!userId) return;
    try {
      const activeRes = sharedResident ?? (await refreshResident(false));
      if (!activeRes) {
        setResident(null);
        return;
      }

      const resObj: StudentResident = {
        id: activeRes.residentId,
        property_id: activeRes.propertyId,
        full_name: activeRes.fullName,
        room_number: activeRes.roomNumber,
        property: { name: activeRes.propertyName },
      };
      setResident(resObj);

      // Fetch complaints for this resident
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
      const msg = extractErrorMessage(err, 'Could not load your complaints.');
      console.error('[StudentComplaints] Load error:', err);
      Alert.alert('Load Error', msg || 'Could not load your complaints.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId, sharedResident, refreshResident]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        await flushOfflineQueue(defaultOfflineExecutors);
        const pending = await getPendingCount();
        if (active) {
          setPendingOfflineCount(pending);
          await loadData();
        }
      })();
      return () => {
        active = false;
      };
    }, [loadData])
  );

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

      // 1. Upload photo if selected (requires live connection — never queued offline)
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
          const pMsg = extractErrorMessage(photoErr, 'Could not upload attachment.');
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

      showToast('Complaint submitted to PG owner');

      setShowModal(false);
      setTitle('');
      setDescription('');
      setSelectedPhoto(null);
      setCategory('plumbing');
      setPriority('medium');
      setFilter('active');
      await loadData();
    } catch (err: unknown) {
      // Offline queuing is strictly restricted to complaints WITHOUT an attached local photo
      if (!selectedPhoto && isLikelyNetworkError(err)) {
        const offlinePayload: ComplaintOfflinePayload & Record<string, unknown> = {
          property_id: resident.property_id,
          resident_id: resident.id,
          category,
          priority,
          title: trimmedTitle,
          description: trimmedDesc,
          photo_url: null,
        };
        const idempotencyKey = `complaint-${resident.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await enqueueOfflineMutation('complaint_submit', offlinePayload, idempotencyKey);
        setPendingOfflineCount(await getPendingCount());

        showToast('Saved offline — complaint will submit when back online');

        setShowModal(false);
        setTitle('');
        setDescription('');
        setSelectedPhoto(null);
        setCategory('plumbing');
        setPriority('medium');
        setFilter('active');
        return;
      }

      const msg = extractErrorMessage(err, 'Could not submit your complaint.');
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

  const propertyName = resident?.property?.name || 'PG Accommodation';
  const headerSubtitle = resident?.room_number
    ? `${propertyName} · ${formatRoomLabel(resident.room_number)}`
    : propertyName;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <OwnerHeader
        title="Complaints & Requests"
        subtitle={headerSubtitle}
        showBack
        onBack={() =>
          router.canGoBack() ? router.back() : router.replace('/student-dashboard')
        }
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void (async () => {
                await flushOfflineQueue(defaultOfflineExecutors);
                setPendingOfflineCount(await getPendingCount());
                await loadData();
              })();
            }}
            colors={['#0284C7']}
          />
        }>
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

            {pendingOfflineCount > 0 && (
              <View style={styles.offlineBanner}>
                <Text style={styles.offlineBannerText}>
                  {pendingOfflineCount} offline update{pendingOfflineCount > 1 ? 's' : ''} queued — will submit automatically when connected
                </Text>
              </View>
            )}

            {/* Filter Tabs (hide zero-count tabs) */}
            {complaints.length > 0 && (
              <View style={styles.filterRow}>
                {activeCount > 0 && (
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
                )}
                {complaints.length - activeCount > 0 && (
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
                )}
                {activeCount > 0 && complaints.length - activeCount > 0 && (
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
                )}
              </View>
            )}

            {/* Complaints List */}
            {filteredComplaints.length === 0 ? (
              <View style={styles.emptyCard}>
                <View style={styles.emptyIconCircle}>
                  <CheckCircle2 size={26} color="#16A34A" />
                </View>
                <Text style={styles.emptyTitle}>
                  {filter === 'active' ? 'All clear' : 'No matching requests'}
                </Text>
                <Text style={styles.emptySub}>
                  {filter === 'active'
                    ? 'No open maintenance requests. If anything needs attention, tap + to report it.'
                    : 'No maintenance requests match the selected filter.'}
                </Text>
              </View>
            ) : (
              filteredComplaints.map((item) => (
                <StudentComplaintCard
                  key={item.id}
                  item={item}
                  onViewPhoto={(url) => void handleViewPhoto(url)}
                />
              ))
            )}
          </>
        )}
      </ScrollView>

      <RaiseComplaintModal
        visible={showModal}
        submitting={submitting}
        category={category}
        priority={priority}
        title={title}
        description={description}
        selectedPhotoUri={selectedPhoto?.uri ?? null}
        onSelectCategory={setCategory}
        onSelectPriority={setPriority}
        onChangeTitle={setTitle}
        onChangeDescription={setDescription}
        onPickImage={handlePickImage}
        onRemovePhoto={() => setSelectedPhoto(null)}
        onSubmit={handleSubmitComplaint}
        onClose={() => setShowModal(false)}
      />

      <ComplaintPhotoPreviewModal
        fullImageUrl={fullImageUrl}
        loadingFullImage={loadingFullImage}
        onClose={() => setFullImageUrl(null)}
      />

      <RoleBottomNav activeTab="maintenance" roleOverride="student" />
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
  offlineBanner: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 14,
  },
  offlineBannerText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#92400E',
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
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  emptyIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#DCFCE7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
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
});

