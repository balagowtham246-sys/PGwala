import { RoleBottomNav } from '@/components/ui/bottom-nav';
import { router, useLocalSearchParams } from 'expo-router';
import {
  CheckCircle2,
  SlidersHorizontal,
  X,
} from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { OwnerHeader } from '@/components/ui/owner';
import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useProperty } from '@/context/property-context';
import { useToast } from '@/context/toast-context';
import { sortComplaintsByUrgencyThenDate } from '@/lib/complaint-utils';
import { extractErrorMessage } from '@/lib/error-utils';
import { getSignedComplaintPhotoUrl, supabase } from '@/lib/supabase';
import { sortRoomCodes } from '@/lib/ux-utils';
import { ownerCreateComplaint } from '@/services/residents.service';

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

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [propertyName, setPropertyName] = useState('My PG');
  const [complaints, setComplaints] = useState<OwnerComplaintItem[]>([]);
  const [activeResidents, setActiveResidents] = useState<ActiveResidentOption[]>([]);
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
  const [creatingComplaint, setCreatingComplaint] = useState(false);

  // Edit / Action Modal
  const [selectedComplaint, setSelectedComplaint] = useState<OwnerComplaintItem | null>(null);
  const [newStatus, setNewStatus] = useState<ComplaintStatus>('open');
  const [notes, setNotes] = useState('');
  const [updating, setUpdating] = useState(false);

  // Full-Screen Image Viewer
  const [fullImageUrl, setFullImageUrl] = useState<string | null>(null);
  const [loadingFullImage, setLoadingFullImage] = useState(false);

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

  const loadData = useCallback(async () => {
    if (!userId) return;
    try {
      setLoading(true);

      // 1. Resolve active property ID and name
      let activePropId = activeSelectedPropertyId;
      let activePropName = activeSelectedPropertyName;

      if (!activePropId) {
        const { data: propData, error: propError } = await supabase
          .from('properties')
          .select('id, name')
          .eq('owner_id', userId)
          .eq('is_active', true)
          .order('created_at', { ascending: true })
          .limit(1);

        if (propError) throw propError;
        if (!propData || propData.length === 0) {
          setPropertyId(null);
          setComplaints([]);
          setActiveResidents([]);
          setLoading(false);
          return;
        }

        activePropId = propData[0].id;
        activePropName = propData[0].name;
      }

      setPropertyId(activePropId);
      setPropertyName(activePropName || 'My PG');

      // 2. Fetch complaints & active residents in parallel
      const [compRes, residentsRes] = await Promise.all([
        supabase
          .from('complaints')
          .select(`
            id,
            property_id,
            resident_id,
            category,
            priority,
            status,
            title,
            description,
            photo_url,
            owner_notes,
            resolved_at,
            created_at,
            resident:residents (
              full_name,
              room_number,
              phone_number
            )
          `)
          .eq('property_id', activePropId)
          .order('created_at', { ascending: false }),
        supabase
          .from('residents')
          .select('id, full_name, room_number')
          .eq('property_id', activePropId)
          .eq('is_active', true),
      ]);

      if (compRes.error) {
        console.warn('[OwnerComplaints] Could not fetch complaints:', compRes.error.message);
        setComplaints([]);
      } else {
        setComplaints((compRes.data as unknown as OwnerComplaintItem[]) || []);
      }

      if (residentsRes.error) {
        console.warn('[OwnerComplaints] Could not fetch residents:', residentsRes.error.message);
        setActiveResidents([]);
      } else {
        const sortedResidents = [...((residentsRes.data as ActiveResidentOption[]) || [])].sort(
          (a, b) => {
            const roomCmp = sortRoomCodes(a.room_number, b.room_number);
            if (roomCmp !== 0) return roomCmp;
            return a.full_name.localeCompare(b.full_name);
          }
        );
        setActiveResidents(sortedResidents);
      }
    } catch (err: unknown) {
      const msg = extractErrorMessage(err, 'Operation failed. Please try again.');
      console.error('[OwnerComplaints] Load error:', err);
      Alert.alert('Load Error', msg || 'Could not load complaints.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId, activeSelectedPropertyId, activeSelectedPropertyName]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) {
        void loadData();
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [loadData]);

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

    setCreatingComplaint(true);
    const res = await ownerCreateComplaint(propertyId, createResidentId, {
      category: createCategory,
      priority: createPriority,
      title: trimmedTitle,
      description: trimmedDesc,
    });
    setCreatingComplaint(false);

    if (!res.ok) {
      Alert.alert('Could Not Log', res.error.message);
      return;
    }

    setCreateModalVisible(false);
    setCreateTitle('');
    setCreateDescription('');
    showToast('Complaint logged · Maintenance ticket created.');
    await loadData();
  };

  const handleOpenActionModal = (item: OwnerComplaintItem) => {
    setSelectedComplaint(item);
    setNewStatus(item.status);
    setNotes(item.owner_notes || '');
  };

  const handleSaveUpdate = async () => {
    if (!selectedComplaint || updating) return;

    setUpdating(true);
    try {
      const isNowResolved = newStatus === 'resolved';
      const resolvedAtValue = isNowResolved
        ? selectedComplaint.resolved_at || new Date().toISOString()
        : null;

      const { error } = await supabase
        .from('complaints')
        .update({
          status: newStatus,
          owner_notes: notes.trim() || null,
          resolved_at: resolvedAtValue,
        })
        .eq('id', selectedComplaint.id);

      if (error) throw error;

      showToast(`Complaint marked as ${STATUS_CONFIG[newStatus].label}.`);
      setSelectedComplaint(null);
      void loadData();
    } catch (err: unknown) {
      const msg = extractErrorMessage(err, 'Operation failed. Please try again.');
      console.error('[OwnerComplaints] Update error:', err);
      Alert.alert('Update Failed', msg || 'Could not update complaint.');
    } finally {
      setUpdating(false);
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

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <OwnerHeader
        title="Maintenance & Issues"
        subtitle={`${propertyName} • Complaints`}
        showBack
        rightAction={
          propertyId ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Log complaint"
              style={({ pressed }) => [
                styles.headerLogBtn,
                pressed && { opacity: 0.85 },
              ]}
              onPress={handleOpenCreateModal}>
              <Text style={styles.headerLogBtnText}>+ Log</Text>
            </Pressable>
          ) : undefined
        }
      />
      <FlatList
        data={loading || !propertyId ? [] : filteredComplaints}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <OwnerComplaintRow
            item={item}
            onViewPhoto={(url) => void handleViewPhoto(url)}
            onOpenActionModal={handleOpenActionModal}
          />
        )}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        removeClippedSubviews={Platform.OS === 'android'}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void loadData();
            }}
            colors={[OwnerTheme.colors.primary]}
          />
        }
        ListHeaderComponent={
          loading || !propertyId ? undefined : (
            <>
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
    paddingBottom: 40,
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

