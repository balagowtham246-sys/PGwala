import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RoleBottomNav } from '@/components/ui/bottom-nav';
import { DarkSlateHeroCard } from '@/components/ui/dark-slate-hero-card';
import { FloatingActionPill } from '@/components/ui/floating-action-pill';
import { OwnerHeader } from '@/components/ui/owner';
import { router, useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { CheckCircle2, Plus } from 'lucide-react-native';

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
import {
  PhotoUploadError,
  useStudentComplaintsQuery,
  useStudentCreateComplaintMutation,
} from '@/hooks/use-complaints';
import { extractErrorMessage } from '@/lib/error-utils';
import { compressPickedImage } from '@/lib/image-upload';
import {
  enqueueOfflineMutation,
  flushOfflineQueue,
  getPendingCount,
} from '@/lib/offline-queue';
import { isLikelyNetworkError } from '@/lib/service-result';
import { getSignedComplaintPhotoUrl, supabase } from '@/lib/supabase';
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
  const {
    resident: sharedResident,
    loadingResident,
    refreshResident,
  } = useResident();
  const { showToast } = useToast();
  const userId = user?.id;

  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [fallbackResident, setFallbackResident] = useState<StudentResident | null>(null);
  const [pendingOfflineCount, setPendingOfflineCount] = useState(0);
  const lastErrorAtRef = useRef(0);

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
  const submittingRef = useRef(false);

  // Full Screen Image Viewer Modal
  const [fullImageUrl, setFullImageUrl] = useState<string | null>(null);
  const [loadingFullImage, setLoadingFullImage] = useState(false);

  const resident = useMemo<StudentResident | null>(() => {
    if (sharedResident) {
      return {
        id: sharedResident.residentId,
        property_id: sharedResident.propertyId,
        full_name: sharedResident.fullName,
        room_number: sharedResident.roomNumber,
        property: { name: sharedResident.propertyName },
      };
    }
    return fallbackResident;
  }, [sharedResident, fallbackResident]);

  const complaintsQuery = useStudentComplaintsQuery(resident?.id);
  const createComplaintMutation = useStudentCreateComplaintMutation();

  const loading =
    (!resident && Boolean(userId) && loadingResident) ||
    (Boolean(resident?.id) && complaintsQuery.isLoading && !complaintsQuery.data);
  const refreshing = manualRefreshing;
  const loadingMore = complaintsQuery.isFetchingNextPage;
  const hasMore = Boolean(complaintsQuery.hasNextPage);
  const submitting = createComplaintMutation.isPending;

  const complaints = useMemo(() => {
    const pages = complaintsQuery.data?.pages ?? [];
    const seen = new Set<string>();
    const combined: ComplaintRecord[] = [];
    for (const page of pages) {
      for (const item of page.complaints) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          combined.push(item);
        }
      }
    }
    return combined;
  }, [complaintsQuery.data?.pages]);

  useEffect(() => {
    if (
      complaintsQuery.isError &&
      complaintsQuery.errorUpdatedAt > lastErrorAtRef.current &&
      (!complaintsQuery.data || manualRefreshing)
    ) {
      lastErrorAtRef.current = complaintsQuery.errorUpdatedAt;
      Alert.alert(
        'Load Error',
        complaintsQuery.error.message || 'Could not load your complaints.'
      );
    }
  }, [
    complaintsQuery.isError,
    complaintsQuery.error,
    complaintsQuery.errorUpdatedAt,
    complaintsQuery.data,
    manualRefreshing,
  ]);

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
        allowsEditing: false,
        quality: 0.7,
        base64: false,
      });
      if (!res.canceled && res.assets && res.assets.length > 0) {
        const compressed = await compressPickedImage(res.assets[0]);
        if (!compressed.ok) {
          Alert.alert('Image Too Large', compressed.error);
          return;
        }
        setSelectedPhoto({
          uri: compressed.data.uri,
          base64: compressed.data.base64,
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
        allowsEditing: false,
        quality: 0.7,
        base64: false,
      });
      if (!res.canceled && res.assets && res.assets.length > 0) {
        const compressed = await compressPickedImage(res.assets[0]);
        if (!compressed.ok) {
          Alert.alert('Image Too Large', compressed.error);
          return;
        }
        setSelectedPhoto({
          uri: compressed.data.uri,
          base64: compressed.data.base64,
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

  const refetchComplaints = complaintsQuery.refetch;

  const loadData = useCallback(async () => {
    if (!userId) return;
    if (!sharedResident) {
      const activeRes = await refreshResident(false);
      if (activeRes) {
        setFallbackResident({
          id: activeRes.residentId,
          property_id: activeRes.propertyId,
          full_name: activeRes.fullName,
          room_number: activeRes.roomNumber,
          property: { name: activeRes.propertyName },
        });
      }
      return;
    }
    await refetchComplaints();
  }, [userId, sharedResident, refreshResident, refetchComplaints]);

  const loadMoreComplaints = () => {
    if (!hasMore || loadingMore) return;
    void complaintsQuery.fetchNextPage();
  };

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (!sharedResident && userId) {
        void loadData();
      }
      void getPendingCount().then((pending) => {
        if (active) setPendingOfflineCount(pending);
      });
      void flushOfflineQueue(defaultOfflineExecutors).then(async (summary) => {
        if (!active) return;
        setPendingOfflineCount(await getPendingCount());
        if (summary.succeeded > 0) {
          await refetchComplaints();
        }
      });
      return () => {
        active = false;
      };
    }, [sharedResident, userId, loadData, refetchComplaints])
  );

  // Submit new complaint (optimistic update + rollback on error + server-row replacement on success)
  const handleSubmitComplaint = async () => {
    if (!resident || submitting || submittingRef.current) return;

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

    const photoToUpload = selectedPhoto;
    const chosenCategory = category;
    const chosenPriority = priority;

    submittingRef.current = true;
    try {
      await createComplaintMutation.mutateAsync({
        propertyId: resident.property_id,
        residentId: resident.id,
        category: chosenCategory,
        priority: chosenPriority,
        title: trimmedTitle,
        description: trimmedDesc,
        selectedPhoto: photoToUpload,
      });

      showToast('Complaint submitted to PG owner');
      setShowModal(false);
      setTitle('');
      setDescription('');
      setSelectedPhoto(null);
      setCategory('plumbing');
      setPriority('medium');
      setFilter('active');
    } catch (err: unknown) {
      if (err instanceof PhotoUploadError) {
        const pMsg = extractErrorMessage(err, 'Could not upload attachment.');
        Alert.alert('Photo Upload Error', pMsg || 'Could not upload attachment.');
        return;
      }

      // Offline queuing is strictly restricted to complaints WITHOUT an attached local photo
      if (!photoToUpload && isLikelyNetworkError(err)) {
        const offlinePayload: ComplaintOfflinePayload & Record<string, unknown> = {
          property_id: resident.property_id,
          resident_id: resident.id,
          category: chosenCategory,
          priority: chosenPriority,
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
      submittingRef.current = false;
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

  const handleDeleteComplaint = useCallback(
    (item: ComplaintRecord) => {
      Alert.alert(
        'Delete Issue?',
        `Remove "${item.title}"? This cannot be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                const { error } = await supabase
                  .from('complaints')
                  .delete()
                  .eq('id', item.id);
                if (error) throw error;
                showToast('Issue deleted');
                await refetchComplaints();
              } catch (err: unknown) {
                Alert.alert(
                  'Delete Failed',
                  extractErrorMessage(err, 'Could not delete this issue.')
                );
              }
            },
          },
        ]
      );
    },
    [refetchComplaints, showToast]
  );

  const renderComplaintItem = useCallback(
    ({ item }: { item: ComplaintRecord }) => (
      <StudentComplaintCard
        item={item}
        onViewPhoto={(url) => void handleViewPhoto(url)}
        onDelete={handleDeleteComplaint}
      />
    ),
    [handleDeleteComplaint]
  );

  const complaintKeyExtractor = useCallback((item: ComplaintRecord) => item.id, []);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <OwnerHeader
        title="Complaints & Requests"
        subtitle={headerSubtitle}
        showBack
        onBack={() =>
          router.canGoBack() ? router.back() : router.replace('/resident-dashboard')
        }
      />

      <FlatList
        data={loading || !resident ? [] : filteredComplaints}
        keyExtractor={complaintKeyExtractor}
        renderItem={renderComplaintItem}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={7}
        onEndReached={loadMoreComplaints}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setManualRefreshing(true);
              void (async () => {
                try {
                  await flushOfflineQueue(defaultOfflineExecutors);
                  setPendingOfflineCount(await getPendingCount());
                  await loadData();
                } finally {
                  setManualRefreshing(false);
                }
              })();
            }}
            colors={['#0284C7']}
          />
        }
        ListHeaderComponent={
          !loading && resident ? (
            <>
              <DarkSlateHeroCard
                eyebrow="MAINTENANCE & ISSUES"
                title={
                  activeCount > 0
                    ? `${activeCount} active ticket${activeCount === 1 ? '' : 's'}`
                    : 'All issues resolved'
                }
                subtitle={resident.property?.name || 'My PG'}
                badgeLabel={activeCount > 0 ? 'In progress' : 'All clear'}
                badgeTone={activeCount > 0 ? 'warning' : 'success'}
                stats={[
                  { label: 'Active', value: activeCount, tone: activeCount > 0 ? 'warning' : 'default' },
                  { label: 'Resolved', value: complaints.length - activeCount, tone: 'success' },
                  { label: 'Total', value: complaints.length, tone: 'info' },
                ]}
              />

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
            </>
          ) : undefined
        }
        ListEmptyComponent={
          loading ? (
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
          )
        }
        ListFooterComponent={
          !loading && resident && hasMore ? (
            <Pressable
              style={styles.loadMoreBtn}
              disabled={loadingMore}
              onPress={() => void loadMoreComplaints()}>
              {loadingMore ? (
                <ActivityIndicator size="small" color="#0284C7" />
              ) : (
                <Text style={styles.loadMoreText}>Load older complaints</Text>
              )}
            </Pressable>
          ) : undefined
        }
      />

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

      {Boolean(resident) && (
        <FloatingActionPill
          label="Raise Issue"
          icon={Plus}
          hasBottomNav
          onPress={() => setShowModal(true)}
        />
      )}

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
    paddingBottom: 96,
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
  loadMoreBtn: {
    marginTop: 8,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
  },
  loadMoreText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0284C7',
  },
});

