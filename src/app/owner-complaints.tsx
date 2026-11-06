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

import { useAuth } from '@/context/auth-context';
import { useProperty } from '@/context/property-context';
import { supabase, getSignedComplaintPhotoUrl } from '@/lib/supabase';
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

const CATEGORY_CONFIG: Record<ComplaintCategory, { label: string; icon: string }> = {
  plumbing: { label: 'Plumbing', icon: '🚿' },
  electrical: { label: 'Electrical', icon: '⚡' },
  wifi_internet: { label: 'Wi-Fi / Net', icon: '📶' },
  cleaning: { label: 'Cleaning', icon: '🧹' },
  food_mess: { label: 'Food & Mess', icon: '🍲' },
  carpentry_furniture: { label: 'Furniture', icon: '🪑' },
  other: { label: 'Other', icon: '📋' },
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

export default function OwnerComplaintsScreen() {
  const { user } = useAuth();
  const { selectedProperty, selectedPropertyId } = useProperty();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [propertyName, setPropertyName] = useState('My PG');
  const [complaints, setComplaints] = useState<OwnerComplaintItem[]>([]);

  // Filters
  const [statusFilter, setStatusFilter] = useState<'all' | ComplaintStatus>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | ComplaintCategory>('all');

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
    if (!user?.id) return;
    try {
      setLoading(true);

      // 1. Resolve active property ID and name
      let activePropId = selectedPropertyId;
      let activePropName = selectedProperty?.name;

      if (!activePropId) {
        const { data: propData, error: propError } = await supabase
          .from('properties')
          .select('id, name')
          .eq('owner_id', user.id)
          .eq('is_active', true)
          .order('created_at', { ascending: true })
          .limit(1);

        if (propError) throw propError;
        if (!propData || propData.length === 0) {
          setPropertyId(null);
          setComplaints([]);
          setLoading(false);
          return;
        }

        activePropId = propData[0].id;
        activePropName = propData[0].name;
      }

      setPropertyId(activePropId);
      setPropertyName(activePropName || 'My PG');

      // 2. Fetch complaints for this property
      const { data: compData, error: compError } = await supabase
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
        .order('created_at', { ascending: false });

      if (compError) {
        console.warn('[OwnerComplaints] Could not fetch complaints:', compError.message);
        setComplaints([]);
      } else {
        setComplaints((compData as any) || []);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[OwnerComplaints] Load error:', err);
      Alert.alert('Load Error', msg || 'Could not load complaints.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id, selectedPropertyId, selectedProperty?.name]);

  useEffect(() => {
    loadData();
  }, [loadData]);

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
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[OwnerComplaints] Update error:', err);
      Alert.alert('Update Failed', msg || 'Could not update complaint.');
    } finally {
      setUpdating(false);
    }
  };

  const openCount = complaints.filter((c) => c.status === 'open').length;
  const inProgressCount = complaints.filter((c) => c.status === 'in_progress').length;
  const resolvedCount = complaints.filter((c) => c.status === 'resolved').length;

  const filteredComplaints = useMemo(() => {
    return complaints.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (categoryFilter !== 'all' && c.category !== categoryFilter) return false;
      return true;
    });
  }, [complaints, statusFilter, categoryFilter]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <OwnerHeader
        title="Maintenance & Issues"
        subtitle={`${propertyName} • Complaints`}
        showBack
      />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              loadData();
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
            {/* KPI Cards */}
            <View style={styles.kpiRow}>
              <View style={[styles.kpiCard, { borderLeftColor: '#0284C7' }]}>
                <Text style={[styles.kpiValue, { color: '#0284C7' }]}>{openCount}</Text>
                <Text style={styles.kpiLabel}>Open Issues</Text>
              </View>
              <View style={[styles.kpiCard, { borderLeftColor: '#D97706' }]}>
                <Text style={[styles.kpiValue, { color: '#D97706' }]}>{inProgressCount}</Text>
                <Text style={styles.kpiLabel}>In Progress</Text>
              </View>
              <View style={[styles.kpiCard, { borderLeftColor: '#16A34A' }]}>
                <Text style={[styles.kpiValue, { color: '#16A34A' }]}>{resolvedCount}</Text>
                <Text style={styles.kpiLabel}>Resolved</Text>
              </View>
            </View>

            {/* Status Filter */}
            <View style={styles.statusFilterRow}>
              {(['all', 'open', 'in_progress', 'resolved'] as const).map((s) => (
                <Pressable
                  key={s}
                  style={[
                    styles.statusFilterBtn,
                    statusFilter === s && styles.statusFilterBtnActive,
                  ]}
                  onPress={() => setStatusFilter(s)}>
                  <Text
                    style={[
                      styles.statusFilterBtnText,
                      statusFilter === s && styles.statusFilterBtnTextActive,
                    ]}>
                    {s === 'all'
                      ? `ALL (${complaints.length})`
                      : s === 'open'
                      ? `OPEN (${openCount})`
                      : s === 'in_progress'
                      ? `IN PROGRESS (${inProgressCount})`
                      : `RESOLVED (${resolvedCount})`}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Category Filter Scroll */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.catScroll}>
              <Pressable
                style={[
                  styles.catPill,
                  categoryFilter === 'all' && styles.catPillActive,
                ]}
                onPress={() => setCategoryFilter('all')}>
                <Text
                  style={[
                    styles.catPillText,
                    categoryFilter === 'all' && styles.catPillTextActive,
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
                    style={[styles.catPill, isActive && styles.catPillActive]}
                    onPress={() => setCategoryFilter(catKey)}>
                    <Text
                      style={[
                        styles.catPillText,
                        isActive && styles.catPillTextActive,
                      ]}>
                      {config.icon} {config.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Complaints List */}
            {filteredComplaints.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyIcon}>✓</Text>
                <Text style={styles.emptyTitle}>No Complaints Found</Text>
                <Text style={styles.emptySub}>
                  No maintenance issues match the selected filters.
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
                    {/* Header: Resident & Room info */}
                    <View style={styles.cardTopRow}>
                      <View>
                        <Text style={styles.residentName}>
                          {item.resident?.full_name || 'Resident'}
                        </Text>
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
                      <Text style={styles.catText}>
                        {catInfo.icon} {catInfo.label}
                      </Text>
                      <Text style={styles.dateMeta}>{formattedDate}</Text>
                    </View>

                    <Text style={styles.complaintTitle}>{item.title}</Text>
                    <Text style={styles.complaintDesc}>{item.description}</Text>

                    {/* Resident Photo Attachment */}
                    {item.photo_url && (
                      <Pressable
                        style={styles.photoViewBtn}
                        onPress={() => handleViewPhoto(item.photo_url!)}>
                        <Text style={styles.photoViewBtnText}>📷 View Resident Photo Attachment</Text>
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
                        style={[
                          styles.statusSelectText,
                          isSelected && { color: sConfig.color, fontWeight: '800' },
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
              Resolution / Vendor Notes (Visible to Student)
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
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 30,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 10,
  },
  emptyIcon: {
    fontSize: 32,
    marginBottom: 8,
    color: '#16A34A',
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
  kpiRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  kpiCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderLeftWidth: 4,
    alignItems: 'center',
  },
  kpiValue: {
    fontSize: 22,
    fontWeight: '800',
  },
  kpiLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
    marginTop: 2,
  },
  statusFilterRow: {
    flexDirection: 'row',
    backgroundColor: '#E2E8F0',
    borderRadius: 8,
    padding: 2,
    marginBottom: 10,
  },
  statusFilterBtn: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    borderRadius: 6,
  },
  statusFilterBtnActive: {
    backgroundColor: '#FFFFFF',
  },
  statusFilterBtnText: {
    fontSize: 10,
    color: '#64748B',
    fontWeight: '700',
  },
  statusFilterBtnTextActive: {
    color: '#0F172A',
  },
  catScroll: {
    paddingBottom: 8,
    gap: 8,
    marginBottom: 8,
  },
  catPill: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  catPillActive: {
    backgroundColor: '#0284C7',
    borderColor: '#0284C7',
  },
  catPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  catPillTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
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
    borderRadius: 16,
    padding: 20,
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
    backgroundColor: '#F8FAFC',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
  },
  statusSelectText: {
    fontSize: 9,
    fontWeight: '700',
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

