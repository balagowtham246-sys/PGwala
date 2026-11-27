import { RoleBottomNav } from '@/components/ui/bottom-nav';
import { DarkSlateHeroCard } from '@/components/ui/dark-slate-hero-card';
import { router, useLocalSearchParams } from 'expo-router';
import {
  CheckCircle2,
  Plus,
  SlidersHorizontal,
  X,
} from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  ActiveResidentOption,
  COMPLAINT_STATUS_CONFIG,
  ComplaintActionModal,
  ComplaintCategory,
  ComplaintFilterSheetModal,
  ComplaintPhotoPreviewModal,
  ComplaintPriority,
  ComplaintStatus,
  LogComplaintModal,
  OwnerComplaintItem,
  OwnerComplaintRow,
} from '@/components/complaints/OwnerComplaintsModals';
import { FloatingActionPill } from '@/components/ui/floating-action-pill';
import { OwnerHeader } from '@/components/ui/owner';
import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useProperty } from '@/context/property-context';
import { useToast } from '@/context/toast-context';
import {
  useOwnerComplaintsQuery,
  useOwnerCreateComplaintMutation,
  useOwnerUpdateComplaintMutation,
} from '@/hooks/use-complaints';
import { sortComplaintsByUrgencyThenDate } from '@/lib/complaint-utils';
import { extractErrorMessage } from '@/lib/error-utils';
import { posthog } from '@/lib/posthog';
import { getSignedComplaintPhotoUrl, supabase } from '@/lib/supabase';

export type {
  ActiveResidentOption,
  ComplaintCategory,
  ComplaintPriority,
  ComplaintStatus,
  OwnerComplaintItem,
};

const STATUS_CONFIG = COMPLAINT_STATUS_CONFIG;

export default function OwnerComplaintsScreen() {
  const { user } = useAuth();
  const { selectedProperty, selectedPropertyId } = useProperty();
  const { showToast } = useToast();
  const params = useLocalSearchParams<{ residentId?: string | string[] }>();
  const rawParamResidentId = Array.isArray(params.residentId)
    ? params.residentId[0]
    : params.residentId;
  const paramResidentId = rawParamResidentId?.trim() || null;

  const userId = user?.id;
  const activeSelectedPropertyId = selectedPropertyId;
  const activeSelectedPropertyName = selectedProperty?.name;

  const [manualRefreshing, setManualRefreshing] = useState(false);
  const lastErrorAtRef = useRef(0);
  const [clearedResidentId, setClearedResidentId] = useState<string | null>(null);

  useEffect(() => {
    if (paramResidentId) return;
    const timer = setTimeout(() => {
      setClearedResidentId(null);
    }, 0);
    return () => clearTimeout(timer);
  }, [paramResidentId]);

  const activeResidentFilterId =
    paramResidentId && paramResidentId !== clearedResidentId
      ? paramResidentId
      : null;

  const handleClearResidentFilter = () => {
    setClearedResidentId(paramResidentId);
    try {
      router.setParams({ residentId: undefined });
    } catch {
      // Non-fatal in pager context
    }
  };

  // Filters
  const [statusFilter, setStatusFilter] = useState<'all' | ComplaintStatus>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | ComplaintCategory>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | ComplaintPriority>('all');
  const [filterSheetVisible, setFilterSheetVisible] = useState(false);

  // Log New Complaint Modal
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [createResidentId, setCreateResidentId] = useState('');
  const [residentSearch, setResidentSearch] = useState('');
  const [createCategory, setCreateCategory] = useState<ComplaintCategory>('plumbing');
  const [createPriority, setCreatePriority] = useState<ComplaintPriority>('medium');
  const [createTitle, setCreateTitle] = useState('');
  const [createDescription, setCreateDescription] = useState('');

  // Edit / Action Modal
  const [selectedComplaint, setSelectedComplaint] = useState<OwnerComplaintItem | null>(null);
  const [newStatus, setNewStatus] = useState<ComplaintStatus>('open');
  const [notes, setNotes] = useState('');

  // Full-Screen Image Viewer
  const [fullImageUrl, setFullImageUrl] = useState<string | null>(null);
  const [loadingFullImage, setLoadingFullImage] = useState(false);

  const complaintsQuery = useOwnerComplaintsQuery({
    userId,
    selectedPropertyId: activeSelectedPropertyId,
    selectedPropertyName: activeSelectedPropertyName,
  });
  const createComplaintMutation = useOwnerCreateComplaintMutation();
  const updateComplaintMutation = useOwnerUpdateComplaintMutation();

  const firstPage = complaintsQuery.data?.pages[0];
  const loading = complaintsQuery.isPending && !firstPage;
  const refreshing = manualRefreshing;
  const loadingMore = complaintsQuery.isFetchingNextPage;
  const hasMore = Boolean(complaintsQuery.hasNextPage);
  const propertyId = firstPage?.propertyId ?? activeSelectedPropertyId ?? null;
  const propertyName =
    firstPage?.propertyName ?? activeSelectedPropertyName ?? 'My PG';
  const activeResidents = useMemo(
    () => firstPage?.activeResidents ?? [],
    [firstPage?.activeResidents]
  );
  const complaints = useMemo(() => {
    const pages = complaintsQuery.data?.pages ?? [];
    const seen = new Set<string>();
    const combined: OwnerComplaintItem[] = [];
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

  const creatingComplaint = createComplaintMutation.isPending;
  const updating = updateComplaintMutation.isPending;

  useEffect(() => {
    if (
      complaintsQuery.isError &&
      complaintsQuery.errorUpdatedAt > lastErrorAtRef.current &&
      (!firstPage || manualRefreshing)
    ) {
      lastErrorAtRef.current = complaintsQuery.errorUpdatedAt;
      Alert.alert(
        'Load Error',
        complaintsQuery.error.message || 'Could not load complaints.'
      );
    }
  }, [
    complaintsQuery.isError,
    complaintsQuery.error,
    complaintsQuery.errorUpdatedAt,
    firstPage,
    manualRefreshing,
  ]);

  const loadData = async () => {
    setManualRefreshing(true);
    try {
      await complaintsQuery.refetch();
    } finally {
      setManualRefreshing(false);
    }
  };

  const loadMoreComplaints = () => {
    if (!hasMore || loadingMore) return;
    void complaintsQuery.fetchNextPage();
  };

  const handleViewPhoto = async (rawUrlOrPath: string) => {
    try {
      setLoadingFullImage(true);
      const signed = await getSignedComplaintPhotoUrl(rawUrlOrPath);
      setFullImageUrl(signed || rawUrlOrPath);
    } catch (err) {
      console.warn('[OwnerComplaints] Signed photo error:', err);
      setFullImageUrl(rawUrlOrPath);
    } finally {
      setLoadingFullImage(false);
    }
  };

  const handleOpenCreateModal = () => {
    const defaultResidentId =
      activeResidentFilterId &&
        activeResidents.some((r) => r.id === activeResidentFilterId)
        ? activeResidentFilterId
        : activeResidents[0]?.id || '';
    setCreateResidentId(defaultResidentId);
    setResidentSearch('');
    setCreateCategory('plumbing');
    setCreatePriority('medium');
    setCreateTitle('');
    setCreateDescription('');
    setCreateModalVisible(true);
  };

  const handleCreateComplaint = async () => {
    if (!propertyId || creatingComplaint) return;
    if (!createResidentId) {
      Alert.alert('Resident Required', 'Please select a resident for this issue.');
      return;
    }
    const trimmedTitle = createTitle.trim();
    const trimmedDesc = createDescription.trim();
    if (!trimmedTitle) {
      Alert.alert('Title Required', 'Please enter a short title for this complaint.');
      return;
    }
    if (!trimmedDesc) {
      Alert.alert('Description Required', 'Please describe the issue.');
      return;
    }

    const resOption = activeResidents.find((r) => r.id === createResidentId);
    setCreateModalVisible(false);
    setCreateTitle('');
    setCreateDescription('');
    showToast('Complaint logged · Maintenance ticket created.');

    try {
      await createComplaintMutation.mutateAsync({
        propertyId,
        residentId: createResidentId,
        residentSnapshot: {
          full_name: resOption?.full_name || 'Resident',
          room_number: resOption?.room_number || '',
        },
        category: createCategory,
        priority: createPriority,
        title: trimmedTitle,
        description: trimmedDesc,
      });
    } catch (err: unknown) {
      const msg = extractErrorMessage(err, 'Could not log complaint.');
      Alert.alert('Could Not Log', msg);
    }
  };

  const handleOpenActionModal = (item: OwnerComplaintItem) => {
    setSelectedComplaint(item);
    setNewStatus(item.status);
    setNotes(item.owner_notes || '');
  };

  const handleDeleteComplaint = useCallback(
    (item: OwnerComplaintItem) => {
      Alert.alert(
        'Delete Complaint?',
        `Permanently remove "${item.title}"?`,
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
                showToast('Complaint deleted');
                await complaintsQuery.refetch();
              } catch (err: unknown) {
                Alert.alert(
                  'Delete Failed',
                  extractErrorMessage(err, 'Could not delete complaint.')
                );
              }
            },
          },
        ]
      );
    },
    [complaintsQuery, showToast]
  );

  const handleSaveUpdate = async () => {
    if (!selectedComplaint || updating) return;

    const targetComplaint = selectedComplaint;
    const targetStatus = newStatus;
    const isNowResolved = targetStatus === 'resolved';
    const resolvedAtValue = isNowResolved
      ? targetComplaint.resolved_at || new Date().toISOString()
      : null;
    const trimmedNotes = notes.trim() || null;

    setSelectedComplaint(null);
    showToast(`Complaint marked as ${STATUS_CONFIG[targetStatus].label}.`);

    try {
      await updateComplaintMutation.mutateAsync({
        id: targetComplaint.id,
        status: targetStatus,
        ownerNotes: trimmedNotes,
        resolvedAt: resolvedAtValue,
      });
      posthog?.capture('complaint_status_updated', {
        previous_status: targetComplaint.status,
        status: targetStatus,
        has_owner_notes: Boolean(trimmedNotes),
      });
    } catch (err: unknown) {
      const msg = extractErrorMessage(err, 'Operation failed. Please try again.');
      console.error('[OwnerComplaints] Update error:', err);
      Alert.alert('Update Failed', msg || 'Could not update complaint.');
    }
  };

  const residentScopedComplaints = useMemo(() => {
    if (!activeResidentFilterId) return complaints;
    return complaints.filter((c) => c.resident_id === activeResidentFilterId);
  }, [complaints, activeResidentFilterId]);

  const filteredResidentName = useMemo(() => {
    if (!activeResidentFilterId) return '';
    const fromActive = activeResidents.find((r) => r.id === activeResidentFilterId);
    if (fromActive) return fromActive.full_name;
    const fromComplaint = complaints.find((c) => c.resident_id === activeResidentFilterId);
    if (fromComplaint?.resident?.full_name) return fromComplaint.resident.full_name;
    return 'Resident';
  }, [activeResidentFilterId, activeResidents, complaints]);

  const modalFilteredResidents = useMemo(() => {
    const q = residentSearch.trim().toLowerCase();
    if (!q) return activeResidents;
    return activeResidents.filter(
      (r) =>
        r.full_name.toLowerCase().includes(q) ||
        r.room_number.toLowerCase().includes(q)
    );
  }, [activeResidents, residentSearch]);

  const openCount = residentScopedComplaints.filter((c) => c.status === 'open').length;
  const inProgressCount = residentScopedComplaints.filter(
    (c) => c.status === 'in_progress'
  ).length;
  const resolvedCount = residentScopedComplaints.filter((c) => c.status === 'resolved').length;
  const activeFilterCount =
    (categoryFilter !== 'all' ? 1 : 0) + (priorityFilter !== 'all' ? 1 : 0);

  const resetSecondaryFilters = () => {
    setCategoryFilter('all');
    setPriorityFilter('all');
  };

  const filteredComplaints = useMemo(() => {
    const filtered = residentScopedComplaints.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (categoryFilter !== 'all' && c.category !== categoryFilter) return false;
      if (priorityFilter !== 'all' && c.priority !== priorityFilter) return false;
      return true;
    });
    return sortComplaintsByUrgencyThenDate(filtered);
  }, [residentScopedComplaints, statusFilter, categoryFilter, priorityFilter]);

  const complaintKeyExtractor = useCallback((item: OwnerComplaintItem) => item.id, []);

  const renderComplaintRow = useCallback(
    ({ item }: { item: OwnerComplaintItem }) => (
      <OwnerComplaintRow
        item={item}
        onViewPhoto={(url) => void handleViewPhoto(url)}
        onOpenActionModal={handleOpenActionModal}
        onDelete={handleDeleteComplaint}
      />
    ),
    [handleDeleteComplaint]
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <OwnerHeader
        title="Maintenance & Issues"
        subtitle={propertyName}
      />
      <FlatList
        data={loading || !propertyId ? [] : filteredComplaints}
        keyExtractor={complaintKeyExtractor}
        renderItem={renderComplaintRow}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        removeClippedSubviews={Platform.OS === 'android'}
        onEndReached={() => void loadMoreComplaints()}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          loadingMore ? (
            <View style={{ paddingVertical: 16, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={OwnerTheme.colors.primary} />
            </View>
          ) : undefined
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void loadData();
            }}
            colors={[OwnerTheme.colors.primary]}
          />
        }
        ListHeaderComponent={
          loading || !propertyId ? undefined : (
            <>
              <DarkSlateHeroCard
                eyebrow="MAINTENANCE OVERVIEW"
                title={
                  openCount > 0
                    ? `${openCount} open issue${openCount === 1 ? '' : 's'}`
                    : 'All issues cleared'
                }
                subtitle={propertyName}
                badgeLabel={openCount > 0 ? 'Action needed' : 'All clear'}
                badgeTone={openCount > 0 ? 'warning' : 'success'}
                stats={[
                  { label: 'Open', value: openCount, tone: openCount > 0 ? 'warning' : 'default' },
                  { label: 'In Progress', value: inProgressCount, tone: 'info' },
                  { label: 'Resolved', value: resolvedCount, tone: 'success' },
                ]}
              />

              {/* Resident Filter Banner */}
              {activeResidentFilterId && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Filtered to ${filteredResidentName}. Show all`}
                  style={({ pressed }) => [
                    styles.residentFilterBanner,
                    pressed && { opacity: 0.85 },
                  ]}
                  onPress={handleClearResidentFilter}>
                  <Text style={styles.residentFilterBannerText} numberOfLines={1}>
                    Filtered to {filteredResidentName} ·{' '}
                    <Text style={styles.residentFilterBannerAction}>Show all</Text>
                  </Text>
                  <X size={15} color={OwnerTheme.colors.primary} />
                </Pressable>
              )}

              {/* Unified Sentence-case Status Filter Bar */}
              <View style={styles.statusFilterRow}>
                {(['all', 'open', 'in_progress', 'resolved'] as const).map((s) => {
                  const label =
                    s === 'all'
                      ? `All (${residentScopedComplaints.length})`
                      : s === 'open'
                        ? `Open (${openCount})`
                        : s === 'in_progress'
                          ? `In progress (${inProgressCount})`
                          : `Resolved (${resolvedCount})`;
                  const isActive = statusFilter === s;
                  return (
                    <Pressable
                      key={s}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: isActive }}
                      style={[
                        styles.statusFilterBtn,
                        s === 'in_progress' && styles.statusFilterBtnWide,
                        isActive && styles.statusFilterBtnActive,
                      ]}
                      onPress={() => setStatusFilter(s)}>
                      <Text
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.8}
                        style={[
                          styles.statusFilterBtnText,
                          isActive && styles.statusFilterBtnTextActive,
                        ]}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Compact Filter Trigger Row */}
              <View style={styles.filterToolbarRow}>
                <View style={styles.filterToolbarLeft}>
                  <Pressable
                    accessibilityRole="button"
                    style={[
                      styles.filtersBtn,
                      activeFilterCount > 0 && styles.filtersBtnActive,
                    ]}
                    onPress={() => setFilterSheetVisible(true)}>
                    <SlidersHorizontal
                      size={14}
                      color={
                        activeFilterCount > 0
                          ? OwnerTheme.colors.primary
                          : '#475569'
                      }
                    />
                    <Text
                      style={[
                        styles.filtersBtnText,
                        activeFilterCount > 0 && styles.filtersBtnTextActive,
                      ]}>
                      Filters
                    </Text>
                    {activeFilterCount > 0 && (
                      <View style={styles.filterCountBadge}>
                        <Text style={styles.filterCountBadgeText}>
                          {activeFilterCount}
                        </Text>
                      </View>
                    )}
                  </Pressable>

                  {activeFilterCount > 0 && (
                    <Pressable
                      accessibilityRole="button"
                      hitSlop={8}
                      style={styles.resetFiltersBtn}
                      onPress={resetSecondaryFilters}>
                      <Text style={styles.resetFiltersText}>Reset</Text>
                    </Pressable>
                  )}
                </View>

                <Text style={styles.issueCountMeta}>
                  {filteredComplaints.length} issue
                  {filteredComplaints.length === 1 ? '' : 's'}
                </Text>
              </View>
            </>
          )
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="small" color="#0284C7" />
              <Text style={styles.loadingText}>Loading complaints board...</Text>
            </View>
          ) : !propertyId ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No Property Found</Text>
              <Text style={styles.emptySub}>Please set up a property first.</Text>
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <View style={styles.emptyIconCircle}>
                <CheckCircle2 size={26} color="#16A34A" />
              </View>
              <Text style={styles.emptyTitle}>
                {activeFilterCount === 0 &&
                  (residentScopedComplaints.length === 0 || statusFilter === 'open')
                  ? 'All clear'
                  : 'No matching requests'}
              </Text>
              <Text style={styles.emptySub}>
                {activeFilterCount === 0 &&
                  (residentScopedComplaints.length === 0 || statusFilter === 'open')
                  ? 'Everything at the property is running smoothly.'
                  : 'Try clearing a filter to see other maintenance tickets.'}
              </Text>
              {(activeFilterCount > 0 || activeResidentFilterId) && (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {activeFilterCount > 0 && (
                    <Pressable
                      accessibilityRole="button"
                      style={styles.emptyResetBtn}
                      onPress={resetSecondaryFilters}>
                      <Text style={styles.emptyResetBtnText}>Reset filters</Text>
                    </Pressable>
                  )}
                  {activeResidentFilterId && (
                    <Pressable
                      accessibilityRole="button"
                      style={styles.emptyResetBtn}
                      onPress={handleClearResidentFilter}>
                      <Text style={styles.emptyResetBtnText}>Show all</Text>
                    </Pressable>
                  )}
                </View>
              )}
            </View>
          )
        }
      />

      <ComplaintFilterSheetModal
        visible={filterSheetVisible}
        categoryFilter={categoryFilter}
        priorityFilter={priorityFilter}
        filteredCount={filteredComplaints.length}
        onSelectCategory={setCategoryFilter}
        onSelectPriority={setPriorityFilter}
        onReset={resetSecondaryFilters}
        onClose={() => setFilterSheetVisible(false)}
      />

      <ComplaintActionModal
        selectedComplaint={selectedComplaint}
        newStatus={newStatus}
        notes={notes}
        updating={updating}
        onChangeStatus={setNewStatus}
        onChangeNotes={setNotes}
        onSave={handleSaveUpdate}
        onClose={() => setSelectedComplaint(null)}
      />

      <LogComplaintModal
        visible={createModalVisible}
        propertyName={propertyName}
        activeResidents={activeResidents}
        modalFilteredResidents={modalFilteredResidents}
        residentSearch={residentSearch}
        createResidentId={createResidentId}
        createCategory={createCategory}
        createPriority={createPriority}
        createTitle={createTitle}
        createDescription={createDescription}
        creatingComplaint={creatingComplaint}
        onChangeResidentSearch={setResidentSearch}
        onSelectResident={setCreateResidentId}
        onSelectCategory={setCreateCategory}
        onSelectPriority={setCreatePriority}
        onChangeTitle={setCreateTitle}
        onChangeDescription={setCreateDescription}
        onSubmit={() => void handleCreateComplaint()}
        onClose={() => setCreateModalVisible(false)}
      />

      <ComplaintPhotoPreviewModal
        fullImageUrl={fullImageUrl}
        loadingFullImage={loadingFullImage}
        onClose={() => setFullImageUrl(null)}
      />

      {/* Thumb-Friendly Floating Action Pill */}
      {Boolean(propertyId) && (
        <FloatingActionPill
          label="Log Issue"
          icon={Plus}
          hasBottomNav
          accessibilityLabel="Log Maintenance Issue"
          onPress={handleOpenCreateModal}
        />
      )}

      <RoleBottomNav activeTab="maintenance" roleOverride="owner" />
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
  headerLogBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: OwnerTheme.radius.full,
    backgroundColor: OwnerTheme.colors.primaryLight,
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  headerLogBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  residentFilterBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    backgroundColor: OwnerTheme.colors.primaryLight,
    borderWidth: 1,
    borderColor: '#BAE6FD',
    borderRadius: OwnerTheme.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 10,
  },
  residentFilterBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: OwnerTheme.colors.textPrimary,
  },
  residentFilterBannerAction: {
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
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
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 10,
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
  },
  emptyResetBtn: {
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  emptyResetBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0284C7',
  },
  statusFilterRow: {
    flexDirection: 'row',
    backgroundColor: '#E2E8F0',
    borderRadius: 10,
    padding: 3,
    marginBottom: 10,
  },
  statusFilterBtn: {
    flex: 1,
    paddingVertical: 7,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 7,
  },
  statusFilterBtnWide: {
    flex: 1.25,
  },
  statusFilterBtnActive: {
    backgroundColor: '#FFFFFF',
  },
  statusFilterBtnText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  statusFilterBtnTextActive: {
    color: '#0F172A',
    fontWeight: '700',
  },
  filterToolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  filterToolbarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filtersBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  filtersBtnActive: {
    borderColor: OwnerTheme.colors.primary,
    backgroundColor: OwnerTheme.colors.primaryLight,
  },
  filtersBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  filtersBtnTextActive: {
    color: OwnerTheme.colors.primary,
  },
  filterCountBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: OwnerTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  filterCountBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  resetFiltersBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
  },
  resetFiltersText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  issueCountMeta: {
    fontSize: 12,
    fontWeight: '500',
    color: '#64748B',
  },
});

