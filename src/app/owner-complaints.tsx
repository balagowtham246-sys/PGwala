import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
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
import { Href, router, useLocalSearchParams } from 'expo-router';
import { RoleBottomNav } from '@/components/ui/bottom-nav';
import {
  Check,
  CheckCircle2,
  Camera,
  SlidersHorizontal,
  X,
  Droplets,
  Zap,
  Wifi,
  Sparkles,
  Utensils,
  Armchair,
  Wrench,
} from 'lucide-react-native';

import { useAuth } from '@/context/auth-context';
import { useProperty } from '@/context/property-context';
import { supabase, getSignedComplaintPhotoUrl } from '@/lib/supabase';
import { sortComplaintsByUrgencyThenDate } from '@/lib/complaint-utils';
import { sortRoomCodes, toSentenceCaseStatus } from '@/lib/ux-utils';
import { ownerCreateComplaint } from '@/services/residents.service';
import { OwnerHeader } from '@/components/ui/owner';
import { OwnerTheme } from '@/constants/theme';

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

const CATEGORY_CONFIG: Record<
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

const PRIORITY_CONFIG: Record<
  ComplaintPriority,
  { label: string; color: string; bgColor: string }
> = {
  urgent: { label: toSentenceCaseStatus('urgent'), color: '#DC2626', bgColor: '#FEE2E2' },
  high: { label: toSentenceCaseStatus('high'), color: '#EA580C', bgColor: '#FFEDD5' },
  medium: { label: toSentenceCaseStatus('medium'), color: '#D97706', bgColor: '#FEF3C7' },
  low: { label: toSentenceCaseStatus('low'), color: '#64748B', bgColor: '#F1F5F9' },
};

const STATUS_CONFIG: Record<
  ComplaintStatus,
  { label: string; color: string; bgColor: string }
> = {
  open: { label: toSentenceCaseStatus('open'), color: '#0284C7', bgColor: '#E0F2FE' },
  in_progress: { label: toSentenceCaseStatus('in_progress'), color: '#D97706', bgColor: '#FEF3C7' },
  resolved: { label: toSentenceCaseStatus('resolved'), color: '#16A34A', bgColor: '#DCFCE7' },
  rejected: { label: toSentenceCaseStatus('rejected'), color: '#DC2626', bgColor: '#FEE2E2' },
};

export default function OwnerComplaintsScreen() {
  const { user } = useAuth();
  const { selectedProperty, selectedPropertyId } = useProperty();
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
      const msg = err instanceof Error ? err.message : String(err);
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
    Alert.alert('Complaint Logged', 'Maintenance ticket has been created.');
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

      Alert.alert('Updated', `Complaint marked as ${STATUS_CONFIG[newStatus].label}.`);
      setSelectedComplaint(null);
      void loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
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
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void loadData();
            }}
            colors={[OwnerTheme.colors.primary]}
          />
        }>

        {loading ? (
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

            {/* Complaints List */}
            {filteredComplaints.length === 0 ? (
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
                    {/* Header: Resident & Room info */}
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

                    <View style={styles.catRow}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <catInfo.Icon size={14} color="#475569" />
                        <Text style={styles.catText}>{catInfo.label}</Text>
                      </View>
                      <Text style={styles.dateMeta}>{formattedDate}</Text>
                    </View>

                    <Text style={styles.complaintTitle}>{item.title}</Text>
                    <Text style={styles.complaintDesc}>{item.description}</Text>

                    {/* Resident Photo Attachment */}
                    {item.photo_url && (
                      <Pressable
                        style={[styles.photoViewBtn, { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }]}
                        onPress={() => handleViewPhoto(item.photo_url!)}>
                        <Camera size={14} color="#0284C7" />
                        <Text style={styles.photoViewBtnText}>View Resident Photo Attachment</Text>
                      </Pressable>
                    )}

                    {/* Owner Resolution Box */}
                    {item.owner_notes && (
                      <View style={styles.ownerNotesBox}>
                        <Text style={styles.ownerNotesTitle}>Management Note:</Text>
                        <Text style={styles.ownerNotesText}>{item.owner_notes}</Text>
                      </View>
                    )}

                    {/* Action Button */}
                    <Pressable
                      style={styles.actionBtn}
                      onPress={() => handleOpenActionModal(item)}>
                      <Text style={styles.actionBtnText}>Update Status & Add Notes ›</Text>
                    </Pressable>
                  </View>
                );
              })
            )}
          </>
        )}
      </ScrollView>

      {/* Filter Bottom Sheet Modal */}
      <Modal
        visible={filterSheetVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setFilterSheetVisible(false)}>
        <View style={styles.sheetOverlay}>
          <Pressable
            style={styles.sheetBackdrop}
            onPress={() => setFilterSheetVisible(false)}
          />
          <View style={styles.sheetCard}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeaderRow}>
              <Text style={styles.sheetTitle}>Filter Issues</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close filters"
                hitSlop={8}
                onPress={() => setFilterSheetVisible(false)}>
                <X size={20} color="#64748B" />
              </Pressable>
            </View>

            <ScrollView
              style={styles.sheetScroll}
              showsVerticalScrollIndicator={false}>
              <Text style={styles.sheetSectionLabel}>Category</Text>
              <View style={styles.wrappedChipsContainer}>
                <Pressable
                  accessibilityRole="button"
                  style={[
                    styles.filterChip,
                    categoryFilter === 'all' && styles.filterChipActive,
                  ]}
                  onPress={() => setCategoryFilter('all')}>
                  <Text
                    style={[
                      styles.filterChipText,
                      categoryFilter === 'all' && styles.filterChipTextActive,
                    ]}>
                    All Categories
                  </Text>
                </Pressable>
                {(Object.keys(CATEGORY_CONFIG) as ComplaintCategory[]).map((catKey) => {
                  const config = CATEGORY_CONFIG[catKey];
                  const isActive = categoryFilter === catKey;
                  return (
                    <Pressable
                      key={catKey}
                      accessibilityRole="button"
                      style={[
                        styles.filterChip,
                        isActive && styles.filterChipActive,
                      ]}
                      onPress={() => setCategoryFilter(catKey)}>
                      <config.Icon
                        size={14}
                        color={isActive ? '#FFFFFF' : '#475569'}
                      />
                      <Text
                        style={[
                          styles.filterChipText,
                          isActive && styles.filterChipTextActive,
                        ]}>
                        {config.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[styles.sheetSectionLabel, { marginTop: 18 }]}>
                Priority
              </Text>
              <View style={styles.wrappedChipsContainer}>
                <Pressable
                  accessibilityRole="button"
                  style={[
                    styles.filterChip,
                    priorityFilter === 'all' && styles.filterChipActive,
                  ]}
                  onPress={() => setPriorityFilter('all')}>
                  <Text
                    style={[
                      styles.filterChipText,
                      priorityFilter === 'all' && styles.filterChipTextActive,
                    ]}>
                    All Priorities
                  </Text>
                </Pressable>
                {(['urgent', 'high', 'medium', 'low'] as ComplaintPriority[]).map(
                  (prioKey) => {
                    const pConfig = PRIORITY_CONFIG[prioKey];
                    const isActive = priorityFilter === prioKey;
                    return (
                      <Pressable
                        key={prioKey}
                        accessibilityRole="button"
                        style={[
                          styles.filterChip,
                          isActive && {
                            backgroundColor: pConfig.bgColor,
                            borderColor: pConfig.color,
                          },
                        ]}
                        onPress={() => setPriorityFilter(prioKey)}>
                        <Text
                          style={[
                            styles.filterChipText,
                            isActive && { color: pConfig.color, fontWeight: '700' },
                          ]}>
                          {pConfig.label}
                        </Text>
                      </Pressable>
                    );
                  }
                )}
              </View>
            </ScrollView>

            <View style={styles.sheetFooter}>
              <Pressable
                accessibilityRole="button"
                style={styles.sheetResetBtn}
                onPress={resetSecondaryFilters}>
                <Text style={styles.sheetResetBtnText}>Reset</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={styles.sheetApplyBtn}
                onPress={() => setFilterSheetVisible(false)}>
                <Text style={styles.sheetApplyBtnText}>
                  Show {filteredComplaints.length} issue
                  {filteredComplaints.length === 1 ? '' : 's'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Action / Resolution Modal */}
      <Modal
        visible={!!selectedComplaint}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!updating) setSelectedComplaint(null);
        }}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Update Maintenance Ticket</Text>
            <Text style={styles.modalSub}>
              {selectedComplaint?.resident?.full_name} • Room{' '}
              {selectedComplaint?.resident?.room_number}
            </Text>

            <View style={styles.ticketSummaryBox}>
              <Text style={styles.ticketSummaryTitle}>{selectedComplaint?.title}</Text>
              <Text style={styles.ticketSummaryDesc}>{selectedComplaint?.description}</Text>
            </View>

            {/* Status Selector */}
            <Text style={styles.inputLabel}>Set Ticket Status</Text>
            <View style={styles.statusSelectRow}>
              {(['open', 'in_progress', 'resolved', 'rejected'] as ComplaintStatus[]).map(
                (stKey) => {
                  const isSelected = newStatus === stKey;
                  const sConfig = STATUS_CONFIG[stKey];
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
                      onPress={() => setNewStatus(stKey)}>
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

            {/* Management Notes */}
            <Text style={[styles.inputLabel, { marginTop: 14 }]}>
              Resolution / Vendor Notes (Visible to Resident)
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. Electrician scheduled for tomorrow 11 AM..."
              placeholderTextColor="#94A3B8"
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={3}
            />

            <View style={styles.modalBtnRow}>
              <Pressable
                disabled={updating}
                style={styles.modalCancelBtn}
                onPress={() => setSelectedComplaint(null)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                disabled={updating}
                style={[styles.modalSaveBtn, updating && styles.btnDisabled]}
                onPress={handleSaveUpdate}>
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

      {/* Log New Complaint Modal */}
      <Modal
        visible={createModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!creatingComplaint) setCreateModalVisible(false);
        }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}>
          <View style={styles.createModalContent}>
            <View style={styles.createModalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Log Maintenance Issue</Text>
                <Text style={styles.modalSub}>{propertyName}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close log complaint modal"
                hitSlop={8}
                disabled={creatingComplaint}
                onPress={() => setCreateModalVisible(false)}>
                <X size={20} color="#64748B" />
              </Pressable>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              style={styles.createModalScroll}>
              <Text style={styles.inputLabel}>Resident *</Text>
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
                      onChangeText={setResidentSearch}
                      autoCorrect={false}
                    />
                  )}
                  <ScrollView
                    nestedScrollEnabled
                    style={styles.residentPickerList}
                    showsVerticalScrollIndicator={false}>
                    {modalFilteredResidents.length === 0 ? (
                      <Text style={styles.noResidentsNoticeText}>
                        No matching residents.
                      </Text>
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
                            onPress={() => setCreateResidentId(res.id)}>
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

              <Text style={[styles.inputLabel, { marginTop: 14 }]}>Category</Text>
              <View style={styles.wrappedChipsContainer}>
                {(Object.keys(CATEGORY_CONFIG) as ComplaintCategory[]).map((catKey) => {
                  const config = CATEGORY_CONFIG[catKey];
                  const isActive = createCategory === catKey;
                  return (
                    <Pressable
                      key={catKey}
                      accessibilityRole="button"
                      style={[
                        styles.filterChip,
                        isActive && styles.filterChipActive,
                      ]}
                      onPress={() => setCreateCategory(catKey)}>
                      <config.Icon
                        size={13}
                        color={isActive ? '#FFFFFF' : '#475569'}
                      />
                      <Text
                        style={[
                          styles.filterChipText,
                          isActive && styles.filterChipTextActive,
                        ]}>
                        {config.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[styles.inputLabel, { marginTop: 14 }]}>Priority</Text>
              <View style={styles.statusSelectRow}>
                {(['low', 'medium', 'high', 'urgent'] as ComplaintPriority[]).map(
                  (prioKey) => {
                    const pConfig = PRIORITY_CONFIG[prioKey];
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
                        onPress={() => setCreatePriority(prioKey)}>
                        <Text
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.85}
                          style={[
                            styles.statusSelectText,
                            isSelected && {
                              color: pConfig.color,
                              fontWeight: '700',
                            },
                          ]}>
                          {pConfig.label}
                        </Text>
                      </Pressable>
                    );
                  }
                )}
              </View>

              <Text style={[styles.inputLabel, { marginTop: 10 }]}>Title *</Text>
              <TextInput
                style={styles.createTitleInput}
                placeholder="e.g. Bathroom tap leaking"
                placeholderTextColor="#94A3B8"
                value={createTitle}
                onChangeText={setCreateTitle}
                maxLength={120}
              />

              <Text style={[styles.inputLabel, { marginTop: 12 }]}>
                Description *
              </Text>
              <TextInput
                style={styles.modalInput}
                placeholder="Describe the issue and room/area details..."
                placeholderTextColor="#94A3B8"
                value={createDescription}
                onChangeText={setCreateDescription}
                multiline
                numberOfLines={3}
              />
            </ScrollView>

            <View style={styles.modalBtnRow}>
              <Pressable
                disabled={creatingComplaint}
                style={styles.modalCancelBtn}
                onPress={() => setCreateModalVisible(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                disabled={creatingComplaint || activeResidents.length === 0}
                style={[
                  styles.modalSaveBtn,
                  (creatingComplaint || activeResidents.length === 0) &&
                    styles.btnDisabled,
                ]}
                onPress={() => void handleCreateComplaint()}>
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

      {/* Full-Screen Image Viewer Modal */}
      <Modal
        visible={Boolean(fullImageUrl || loadingFullImage)}
        transparent
        animationType="fade"
        onRequestClose={() => setFullImageUrl(null)}>
        <View style={styles.fullImageOverlay}>
          <Pressable
            style={[styles.fullImageCloseBtn, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}
            onPress={() => setFullImageUrl(null)}>
            <Text style={styles.fullImageCloseText}>Close</Text>
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
  // Filter Bottom Sheet Modal
  sheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  sheetBackdrop: {
    flex: 1,
  },
  sheetCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 26,
    maxHeight: '80%',
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
    marginBottom: 12,
  },
  sheetHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
  },
  sheetScroll: {
    maxHeight: 380,
  },
  sheetSectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 10,
  },
  wrappedChipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  filterChipActive: {
    backgroundColor: '#0284C7',
    borderColor: '#0284C7',
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
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
  sheetResetBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
  },
  sheetApplyBtn: {
    flex: 2,
    height: 46,
    borderRadius: 10,
    backgroundColor: OwnerTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetApplyBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
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
  residentNameBtn: {
    alignSelf: 'flex-start',
  },
  residentName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  roomMeta: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
  },
  prioBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 9999,
  },
  prioText: {
    fontSize: 11,
    fontWeight: '700',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 9999,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  catRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  catText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0284C7',
  },
  dateMeta: {
    fontSize: 11,
    color: '#94A3B8',
  },
  complaintTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4,
  },
  complaintDesc: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 18,
  },
  ownerNotesBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 8,
    marginTop: 8,
  },
  ownerNotesTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  ownerNotesText: {
    fontSize: 12,
    color: '#475569',
    marginTop: 2,
  },
  actionBtn: {
    marginTop: 10,
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: '#F0F9FF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0284C7',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    padding: 20,
  },
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
  createModalScroll: {
    maxHeight: 460,
  },
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
  residentPickerRowSelected: {
    backgroundColor: OwnerTheme.colors.primaryLight,
  },
  residentPickerName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0F172A',
  },
  residentPickerNameSelected: {
    color: OwnerTheme.colors.primary,
    fontWeight: '700',
  },
  residentPickerRoom: {
    fontSize: 11,
    color: '#64748B',
  },
  noResidentsNotice: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: OwnerTheme.radius.sm,
    padding: 10,
  },
  noResidentsNoticeText: {
    fontSize: 12,
    color: '#92400E',
    padding: 6,
  },
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
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalSub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
    marginBottom: 12,
  },
  ticketSummaryBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 10,
    marginBottom: 14,
  },
  ticketSummaryTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 2,
  },
  ticketSummaryDesc: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 16,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
  },
  statusSelectRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
  },
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
  statusSelectText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  modalInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: '#0F172A',
    height: 75,
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
  modalSaveBtn: {
    flex: 2,
    paddingVertical: 12,
    backgroundColor: '#0284C7',
    borderRadius: 8,
    alignItems: 'center',
  },
  modalSaveText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  btnDisabled: {
    opacity: 0.6,
  },
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
  photoViewBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0284C7',
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

