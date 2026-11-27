import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { Check, QrCode, UserCheck, X } from 'lucide-react-native';

import { InviteQrModal } from '@/components/residents/InviteQrModal';
import { DarkSlateHeroCard } from '@/components/ui/dark-slate-hero-card';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import {
  EmptyState,
  OwnerHeader,
  SegmentedFilter,
  StatusBadge,
} from '@/components/ui/owner';
import { OwnerTheme } from '@/constants/theme';
import { useProperty } from '@/context/property-context';
import { useToast } from '@/context/toast-context';
import { queryKeys } from '@/lib/query-keys';
import { broadcastPropertySync } from '@/lib/realtime-sync';
import { formatGateEventTimestamp } from '@/lib/ux-utils';
import {
  approveJoinRequest,
  fetchPropertyJoinRequests,
  JoinRequestItem,
  rejectJoinRequest,
} from '@/services/join-requests.service';

type RequestFilter = 'pending' | 'approved' | 'rejected';

export default function OwnerJoinRequestsScreen() {
  const qc = useQueryClient();
  const { selectedProperty, selectedPropertyId } = useProperty();
  const { showToast } = useToast();

  const [requests, setRequests] = useState<JoinRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<RequestFilter>('pending');
  const [qrModalVisible, setQrModalVisible] = useState(false);

  // Approve Modal State
  const [selectedReq, setSelectedReq] = useState<JoinRequestItem | null>(null);
  const [roomInput, setRoomInput] = useState('');
  const [bedInput, setBedInput] = useState('');
  const [rentInput, setRentInput] = useState('6000');
  const [depositInput, setDepositInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadRequests = useCallback(
    async (isRefresh = false) => {
      if (!selectedPropertyId) {
        setRequests([]);
        setLoading(false);
        return;
      }
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        const list = await fetchPropertyJoinRequests(selectedPropertyId);
        setRequests(list);
      } catch (err) {
        Alert.alert(
          'Load Error',
          err instanceof Error ? err.message : 'Could not load join requests.'
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [selectedPropertyId]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadRequests(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [loadRequests]);

  const counts = useMemo(() => {
    let pending = 0;
    let approved = 0;
    let rejected = 0;
    for (const r of requests) {
      if (r.status === 'pending') pending += 1;
      else if (r.status === 'approved') approved += 1;
      else rejected += 1;
    }
    return { pending, approved, rejected };
  }, [requests]);

  const filtered = useMemo(
    () => requests.filter((r) => r.status === filter),
    [requests, filter]
  );

  const openApproveSheet = useCallback((req: JoinRequestItem) => {
    setSelectedReq(req);
    setRoomInput(req.room_hint?.replace(/^room\s*/i, '').trim() || '');
    setBedInput('');
    setRentInput('6000');
    setDepositInput('');
  }, []);

  const handleConfirmApprove = async () => {
    if (!selectedReq || submitting) return;
    const room = roomInput.trim();
    if (!room) {
      Alert.alert('Room Required', 'Please enter a room number to assign.');
      return;
    }
    const rentRs = parseFloat(rentInput.trim());
    if (isNaN(rentRs) || rentRs < 0) {
      Alert.alert('Invalid Rent', 'Please enter a valid monthly rent in Rupees.');
      return;
    }
    const depositRs = depositInput.trim() ? parseFloat(depositInput.trim()) : 0;

    setSubmitting(true);
    try {
      await approveJoinRequest({
        request_id: selectedReq.id,
        room_number: room,
        bed_label: bedInput.trim() || null,
        monthly_rent_paise: Math.round(rentRs * 100),
        deposit_paise:
          !isNaN(depositRs) && depositRs > 0 ? Math.round(depositRs * 100) : 0,
      });

      const name = selectedReq.full_name;
      setSelectedReq(null);
      broadcastPropertySync('joinRequests', selectedPropertyId);
      broadcastPropertySync('residents', selectedPropertyId);
      showToast(`${name} admitted to Room ${room}!`);
      void qc.invalidateQueries({ queryKey: queryKeys.residents.all });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
      await loadRequests(true);
    } catch (err) {
      Alert.alert(
        'Approval Failed',
        err instanceof Error ? err.message : 'Could not approve resident.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = useCallback(
    (req: JoinRequestItem) => {
      Alert.alert(
        'Decline Join Request?',
        `Decline ${req.full_name}'s request to join ${selectedProperty?.name || 'this PG'}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Decline',
            style: 'destructive',
            onPress: async () => {
              try {
                await rejectJoinRequest({
                  request_id: req.id,
                  rejection_reason: 'Declined by PG owner',
                });
                broadcastPropertySync('joinRequests', selectedPropertyId);
                showToast(`Declined ${req.full_name}.`);
                await loadRequests(true);
              } catch (err) {
                Alert.alert(
                  'Error',
                  err instanceof Error ? err.message : 'Could not decline request.'
                );
              }
            },
          },
        ]
      );
    },
    [loadRequests, selectedProperty?.name, selectedPropertyId, showToast]
  );

  const renderItem = useCallback(
    ({ item }: { item: JoinRequestItem }) => {
      const isPending = item.status === 'pending';
      return (
        <View style={styles.card}>
          <View style={styles.cardTopRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.full_name}</Text>
              <Text style={styles.meta}>
                {item.phone_number} · {item.email}
              </Text>
            </View>
            <StatusBadge
              label={
                item.status === 'pending'
                  ? 'Pending'
                  : item.status === 'approved'
                    ? 'Approved'
                    : 'Declined'
              }
              variant={
                item.status === 'pending'
                  ? 'warning'
                  : item.status === 'approved'
                    ? 'success'
                    : 'danger'
              }
              size="sm"
            />
          </View>

          <View style={styles.tagsRow}>
            {item.room_hint ? (
              <View style={styles.hintPill}>
                <Text style={styles.hintPillText}>
                  Requested: {item.room_hint}
                </Text>
              </View>
            ) : null}
            {item.gender ? (
              <View style={styles.neutralPill}>
                <Text style={styles.neutralPillText}>
                  {item.gender.charAt(0).toUpperCase() + item.gender.slice(1)}
                </Text>
              </View>
            ) : null}
            <Text style={styles.timeText}>
              {formatGateEventTimestamp(item.created_at)}
            </Text>
          </View>

          {item.emergency_contact ? (
            <Text style={styles.emergencyText}>
              Emergency: {item.emergency_contact}
            </Text>
          ) : null}

          {isPending && (
            <View style={styles.actionRow}>
              <Pressable
                accessibilityRole="button"
                style={styles.rejectBtn}
                onPress={() => handleReject(item)}>
                <X size={15} color="#B91C1C" />
                <Text style={styles.rejectBtnText}>Decline</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={styles.approveBtn}
                onPress={() => openApproveSheet(item)}>
                <Check size={15} color="#FFFFFF" />
                <Text style={styles.approveBtnText}>Assign Room & Approve</Text>
              </Pressable>
            </View>
          )}
        </View>
      );
    },
    [handleReject, openApproveSheet]
  );

  const keyExtractor = useCallback((item: JoinRequestItem) => item.id, []);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <OwnerHeader
        title="Join Requests"
        subtitle={selectedProperty?.name || 'Self-Onboarding'}
        showBack
        rightAction={
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.headerQrBtn,
              pressed && { opacity: 0.75 },
            ]}
            onPress={() => setQrModalVisible(true)}>
            <QrCode size={15} color={OwnerTheme.colors.primary} />
            <Text style={styles.headerQrText}>Invite QR</Text>
          </Pressable>
        }
      />

      <FlatList
        data={loading ? [] : filtered}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentContainerStyle={styles.content}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadRequests(true)}
            colors={[OwnerTheme.colors.primary]}
          />
        }
        ListHeaderComponent={
          <View>
            <DarkSlateHeroCard
              eyebrow="QR SELF-ONBOARDING"
              title={
                counts.pending > 0
                  ? `${counts.pending} waiting for approval`
                  : 'No pending requests'
              }
              subtitle="Residents scan your QR poster and fill their own details"
              badgeLabel={counts.pending > 0 ? 'Action needed' : 'Up to date'}
              badgeTone={counts.pending > 0 ? 'warning' : 'success'}
              stats={[
                {
                  label: 'Pending',
                  value: counts.pending,
                  tone: counts.pending > 0 ? 'warning' : 'default',
                },
                { label: 'Approved', value: counts.approved, tone: 'success' },
                { label: 'Declined', value: counts.rejected, tone: 'danger' },
              ]}
            />

            <SegmentedFilter
              options={[
                { key: 'pending', label: 'Pending', count: counts.pending },
                { key: 'approved', label: 'Approved', count: counts.approved },
                { key: 'rejected', label: 'Declined', count: counts.rejected },
              ]}
              activeKey={filter}
              onSelect={(k) => setFilter(k as RequestFilter)}
              style={{ marginBottom: 12 }}
            />
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator
              style={{ marginTop: 40 }}
              size="large"
              color={OwnerTheme.colors.primary}
            />
          ) : (
            <EmptyState
              icon={UserCheck}
              title={
                filter === 'pending'
                  ? 'No pending join requests'
                  : `No ${filter} requests`
              }
              description="Share your PG Invite QR poster so residents can self-register in 30 seconds."
              actionLabel="Show Invite QR"
              onAction={() => setQrModalVisible(true)}
            />
          )
        }
      />

      {/* Approve & Assign Room Bottom Sheet */}
      <BottomSheetModal
        visible={Boolean(selectedReq)}
        onClose={() => setSelectedReq(null)}
        title="Approve & Admit Resident"
        subtitle={`${selectedReq?.full_name ?? ''} · ${selectedReq?.phone_number ?? ''}`}
        disabled={submitting}>
            <Text style={styles.inputLabel}>Assign Room Number *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 101 or D"
              placeholderTextColor="#94A3B8"
              value={roomInput}
              onChangeText={setRoomInput}
              editable={!submitting}
            />

            <Text style={styles.inputLabel}>Bed Label (optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Bed 1"
              placeholderTextColor="#94A3B8"
              value={bedInput}
              onChangeText={setBedInput}
              editable={!submitting}
            />

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.inputLabel}>Monthly Rent (₹) *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="6000"
                  placeholderTextColor="#94A3B8"
                  keyboardType="numeric"
                  value={rentInput}
                  onChangeText={setRentInput}
                  editable={!submitting}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.inputLabel}>Deposit (₹)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Optional"
                  placeholderTextColor="#94A3B8"
                  keyboardType="numeric"
                  value={depositInput}
                  onChangeText={setDepositInput}
                  editable={!submitting}
                />
              </View>
            </View>

            <View style={styles.modalActions}>
              <Pressable
                style={styles.cancelBtn}
                disabled={submitting}
                onPress={() => setSelectedReq(null)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.confirmBtn, submitting && { opacity: 0.6 }]}
                disabled={submitting}
                onPress={() => void handleConfirmApprove()}>
                {submitting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.confirmBtnText}>Approve & Admit</Text>
                )}
              </Pressable>
            </View>
      </BottomSheetModal>

      <InviteQrModal
        visible={qrModalVisible}
        propertyId={selectedPropertyId}
        propertyName={selectedProperty?.name || 'My PG'}
        onClose={() => setQrModalVisible(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F8FAFC' },
  content: { padding: 16, paddingBottom: 36 },
  headerQrBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: OwnerTheme.colors.primaryLight,
  },
  headerQrText: {
    fontSize: 12,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  name: { fontSize: 16, fontWeight: '700', color: '#0F172A' },
  meta: { fontSize: 12, color: '#64748B', marginTop: 2 },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  hintPill: {
    backgroundColor: '#E0F2FE',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  hintPillText: { fontSize: 11, fontWeight: '700', color: '#0369A1' },
  neutralPill: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  neutralPillText: { fontSize: 11, fontWeight: '600', color: '#475569' },
  timeText: { fontSize: 11, color: '#94A3B8', marginLeft: 'auto' },
  emergencyText: { fontSize: 12, color: '#475569', marginTop: 8 },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  rejectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  rejectBtnText: { fontSize: 13, fontWeight: '700', color: '#B91C1C' },
  approveBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#0F172A',
  },
  approveBtnText: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
    paddingBottom: 28,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  modalSub: { fontSize: 13, color: '#64748B', marginTop: 2 },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    fontSize: 14,
    color: '#0F172A',
  },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  cancelBtn: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: { fontSize: 14, fontWeight: '700', color: '#475569' },
  confirmBtn: {
    flex: 2,
    height: 46,
    borderRadius: 12,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
});
