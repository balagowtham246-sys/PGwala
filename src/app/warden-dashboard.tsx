import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { AlertTriangle, Check, ChevronDown, ChevronUp, Megaphone, Send, Settings, X } from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import {
  useSendWardenFoodAlertMutation,
  useWardenDashboardQuery,
} from '@/hooks/use-dashboards';
import { extractErrorMessage } from '@/lib/error-utils';
import { triggerSelectionHaptic } from '@/lib/haptics';
import {
  AlertSendSummary,
  FoodAlertStatus,
  FoodAudienceType,
  FoodMealType,
  MAX_ALERT_MESSAGE_LENGTH,
  MEAL_OPTIONS,
  STATUS_OPTIONS,
  alertHeadline,
  countTargeted,
  createIdempotencyKey,
  describeSendResult,
  formatAlertTime,
  statusLabel,
  uniqueRooms,
  validateAlertForm,
} from '@/lib/food-alert-utils';
import { OwnerHeader } from '@/components/ui/owner';

const STATUS_COLORS: Record<FoodAlertStatus, { bg: string; fg: string; border: string }> = {
  ready: { bg: '#DCFCE7', fg: '#166534', border: '#86EFAC' },
  delayed: { bg: '#FEF3C7', fg: '#92400E', border: '#FCD34D' },
  cancelled: { bg: '#FEE2E2', fg: '#991B1B', border: '#FCA5A5' },
};

function defaultMealForNow(): FoodMealType {
  const h = new Date().getHours();
  if (h < 11) return 'breakfast';
  if (h < 17) return 'lunch';
  return 'dinner';
}

export default function WardenDashboardScreen() {
  const { profile, user } = useAuth();
  const userId = user?.id;
  const colors = OwnerTheme.colors;

  const [refreshing, setRefreshing] = useState(false);

  const [meal, setMeal] = useState<FoodMealType>(defaultMealForNow());
  const [status, setStatus] = useState<FoodAlertStatus>('ready');
  const [audience, setAudience] = useState<FoodAudienceType>('all');
  const [rooms, setRooms] = useState<string[]>([]);
  const [residentIds, setResidentIds] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');

  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<AlertSendSummary | null>(null);
  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const [dismissedTempBanner, setDismissedTempBanner] = useState(false);

  const sendingRef = useRef(false);
  const keyRef = useRef<string | null>(null);

  const wardenQuery = useWardenDashboardQuery(userId);
  const sendAlertMutation = useSendWardenFoodAlertMutation();

  const property = wardenQuery.data?.property ?? null;
  const audienceList = useMemo(
    () => wardenQuery.data?.audienceList ?? [],
    [wardenQuery.data?.audienceList]
  );
  const recent = useMemo(
    () => wardenQuery.data?.recent ?? [],
    [wardenQuery.data?.recent]
  );
  const loading = Boolean(userId) && wardenQuery.isPending && !wardenQuery.data;
  const loadError = wardenQuery.isError
    ? extractErrorMessage(wardenQuery.error, 'Could not load your property.')
    : null;
  const sending = sendAlertMutation.isPending;

  // A different payload must use a different idempotency key; a retry of the same payload keeps it.
  useEffect(() => {
    keyRef.current = null;
  }, [meal, status, audience, rooms, residentIds, message]);

  const mustChangePassword = Boolean(
    profile?.must_change_password || user?.user_metadata?.must_change_password
  );

  const roomList = useMemo(() => uniqueRooms(audienceList), [audienceList]);
  const targeted = useMemo(
    () => countTargeted(audienceList, audience, rooms, residentIds),
    [audienceList, audience, rooms, residentIds]
  );
  const filteredResidents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return audienceList;
    return audienceList.filter(
      (r) => r.full_name.toLowerCase().includes(q) || r.room_number.toLowerCase().includes(q)
    );
  }, [audienceList, search]);

  const toggleRoom = (room: string) => {
    triggerSelectionHaptic();
    setRooms((prev) => (prev.includes(room) ? prev.filter((r) => r !== room) : [...prev, room]));
  };
  const toggleResident = useCallback((id: string) => {
    triggerSelectionHaptic();
    setResidentIds((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]));
  }, []);

  const doSend = async () => {
    if (sendingRef.current || sendAlertMutation.isPending || !property) return;
    const validation = validateAlertForm({ meal, status, audience, rooms, residentIds, message });
    if (validation) {
      setFormError(validation);
      return;
    }
    if (targeted === 0) {
      setFormError('No eligible residents match this selection.');
      return;
    }

    sendingRef.current = true;
    setFormError(null);
    setResult(null);
    if (!keyRef.current) keyRef.current = createIdempotencyKey();

    try {
      const res = await sendAlertMutation.mutateAsync({
        userId,
        meal_type: meal,
        status,
        audience_type: audience,
        rooms: audience === 'rooms' ? rooms : undefined,
        resident_ids: audience === 'residents' ? residentIds : undefined,
        message: message.trim() || undefined,
        idempotency_key: keyRef.current,
      });
      setResult(res);
      keyRef.current = null;
      setMessage('');
    } catch (err) {
      setFormError(extractErrorMessage(err, 'Could not send the alert. Tap Send to retry safely.'));
    } finally {
      sendingRef.current = false;
    }
  };

  const handleSendPress = () => {
    // Cancelled alerts are important and wide: confirm before sending
    if (status === 'cancelled') {
      Alert.alert('Send cancellation?', `${targeted} resident${targeted === 1 ? '' : 's'} will be told this meal is cancelled.`, [
        { text: 'Back', style: 'cancel' },
        { text: 'Send', style: 'destructive', onPress: doSend },
      ]);
      return;
    }
    doSend();
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await wardenQuery.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const headerActions = (
    <Pressable
      accessibilityLabel="Warden Settings"
      hitSlop={8}
      style={styles.headerIconBtn}
      onPress={() => router.push('/warden-settings')}>
      <Settings size={20} color={colors.textPrimary} />
    </Pressable>
  );

  const renderAudienceResident = useCallback(
    ({ item: r }: { item: (typeof filteredResidents)[number] }) => {
      const active = residentIds.includes(r.resident_id);
      return (
        <Pressable
          style={[styles.residentRow, active && styles.residentRowActive]}
          onPress={() => toggleResident(r.resident_id)}>
          <View style={{ flex: 1 }}>
            <Text style={styles.residentName}>{r.full_name}</Text>
            <Text style={styles.residentRoom}>Room {r.room_number}</Text>
          </View>
          <View style={[styles.checkbox, active && styles.checkboxActive]}>
            {active && <Check size={14} color="#FFFFFF" />}
          </View>
        </Pressable>
      );
    },
    [residentIds, toggleResident]
  );

  const audienceKeyExtractor = useCallback(
    (item: (typeof filteredResidents)[number]) => item.resident_id,
    []
  );

  if (loading) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <OwnerHeader title="Food Alerts" rightAction={headerActions} />
        <ActivityIndicator style={{ marginTop: 48 }} size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (!property) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <OwnerHeader title="Food Alerts" rightAction={headerActions} />
        <View style={styles.emptyWrap}>
          <Megaphone size={36} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>No property assigned</Text>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            {loadError ?? 'Ask the PG owner to assign you to a property. Pull down to refresh after that.'}
          </Text>
          <Pressable
            style={[styles.retryBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={handleRefresh}>
            <Text style={[styles.retryText, { color: colors.textPrimary }]}>Refresh</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <OwnerHeader title="Food Alerts" subtitle={property.name} rightAction={headerActions} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          data={showMoreOptions && audience === 'residents' ? filteredResidents : []}
          keyExtractor={audienceKeyExtractor}
          renderItem={renderAudienceResident}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          ListHeaderComponent={
            <View>
              {mustChangePassword && !dismissedTempBanner && (
                <View style={styles.banner}>
                  <Pressable
                    style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}
                    onPress={() => router.push('/resident-profile-edit')}>
                    <AlertTriangle size={18} color="#B45309" />
                    <Text style={styles.bannerText}>Using temporary password. Tap to change.</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Dismiss password reminder"
                    hitSlop={8}
                    onPress={() => setDismissedTempBanner(true)}>
                    <X size={16} color="#92400E" />
                  </Pressable>
                </View>
              )}

              {/* Meal */}
              <Text style={styles.label}>1. Choose Meal</Text>
              <View style={styles.row}>
                {MEAL_OPTIONS.map((m) => {
                  const active = meal === m.key;
                  return (
                    <Pressable
                      key={m.key}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      style={[styles.bigChip, active && styles.bigChipActive]}
                      onPress={() => {
                        triggerSelectionHaptic();
                        setMeal(m.key);
                      }}>
                      <Text style={[styles.bigChipText, active && styles.bigChipTextActive]}>{m.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Status */}
              <Text style={styles.label}>2. Food Status</Text>
              <View style={styles.row}>
                {STATUS_OPTIONS.map((s) => {
                  const active = status === s.key;
                  const c = STATUS_COLORS[s.key];
                  return (
                    <Pressable
                      key={s.key}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      style={[
                        styles.bigChip,
                        active && { backgroundColor: c.bg, borderColor: c.border },
                      ]}
                      onPress={() => {
                        triggerSelectionHaptic();
                        setStatus(s.key);
                      }}>
                      <Text style={[styles.bigChipText, active && { color: c.fg }]}>{s.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.targetedText}>
                Sending to {audience === 'all' ? 'all' : targeted}{' '}
                {targeted === 1 ? 'resident' : `residents (${targeted})`}
              </Text>

              {/* Collapsible Advanced Options (Rooms / Specific Residents / Custom Message) */}
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: showMoreOptions }}
                style={styles.moreOptionsBtn}
                onPress={() => {
                  triggerSelectionHaptic();
                  setShowMoreOptions((prev) => !prev);
                }}>
                <Text style={styles.moreOptionsText}>
                  {showMoreOptions
                    ? 'Hide extra options'
                    : 'More options (specific rooms or message)'}
                </Text>
                {showMoreOptions ? (
                  <ChevronUp size={16} color={OwnerTheme.colors.textSecondary} />
                ) : (
                  <ChevronDown size={16} color={OwnerTheme.colors.textSecondary} />
                )}
              </Pressable>

              {showMoreOptions && (
                <>
                  {/* Recipients */}
                  <Text style={styles.label}>Send to</Text>
                  <View style={styles.row}>
                    {(
                      [
                        ['all', 'Everyone'],
                        ['rooms', 'Rooms'],
                        ['residents', 'Residents'],
                      ] as [FoodAudienceType, string][]
                    ).map(([key, label]) => {
                      const active = audience === key;
                      return (
                        <Pressable
                          key={key}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          style={[styles.segment, active && styles.segmentActive]}
                          onPress={() => {
                            triggerSelectionHaptic();
                            setAudience(key);
                          }}>
                          <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  {audience === 'rooms' && (
                    <View style={styles.wrap}>
                      {roomList.length === 0 ? (
                        <Text style={styles.hint}>No eligible residents yet.</Text>
                      ) : (
                        roomList.map((room) => {
                          const active = rooms.includes(room);
                          return (
                            <Pressable
                              key={room}
                              style={[styles.pill, active && styles.pillActive]}
                              onPress={() => toggleRoom(room)}>
                              <Text style={[styles.pillText, active && styles.pillTextActive]}>Room {room}</Text>
                            </Pressable>
                          );
                        })
                      )}
                    </View>
                  )}

                  {audience === 'residents' && (
                    <View>
                      <TextInput
                        style={styles.search}
                        placeholder="Search name or room"
                        value={search}
                        onChangeText={setSearch}
                        autoCapitalize="none"
                      />
                      {filteredResidents.length === 0 && (
                        <Text style={styles.hint}>No residents found.</Text>
                      )}
                    </View>
                  )}
                </>
              )}
            </View>
          }
          ListFooterComponent={
            <View>
              {showMoreOptions && (
                <>
                  {/* Message */}
                  <Text style={styles.label}>Message (optional)</Text>
                  <TextInput
                    style={styles.messageInput}
                    placeholder={status === 'delayed' ? 'e.g. Dinner delayed by 20 minutes' : 'Short announcement'}
                    value={message}
                    onChangeText={setMessage}
                    maxLength={MAX_ALERT_MESSAGE_LENGTH}
                    multiline
                  />
                  <Text style={styles.counter}>
                    {message.length}/{MAX_ALERT_MESSAGE_LENGTH}
                  </Text>
                </>
              )}

              {formError && (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{formError}</Text>
                </View>
              )}

              {result && (
                <View style={styles.resultBox}>
                  <Check size={20} color="#166534" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.resultTitle}>{describeSendResult(result).title}</Text>
                    <Text style={styles.resultText}>{describeSendResult(result).detail}</Text>
                  </View>
                </View>
              )}

              {/* Recent */}
              {recent.length > 0 && (
                <>
                  <Text style={[styles.label, { marginTop: 24 }]}>Recent alerts</Text>
                  {recent.map((a) => {
                    const c = STATUS_COLORS[a.status];
                    return (
                      <Pressable
                        key={a.id}
                        style={styles.recentRow}
                        onPress={() => {
                          setMeal(a.meal_type);
                          setStatus(a.status === 'ready' ? 'delayed' : 'ready');
                          setResult(null);
                        }}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.recentTitle}>{alertHeadline(a.meal_type, a.status)}</Text>
                          <Text style={styles.recentMeta}>
                            {formatAlertTime(a.created_at)} • {a.recipients_count} resident
                            {a.recipients_count === 1 ? '' : 's'}
                          </Text>
                        </View>
                        <View style={[styles.statusPill, { backgroundColor: c.bg }]}>
                          <Text style={[styles.statusPillText, { color: c.fg }]}>{statusLabel(a.status)}</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                  <Text style={styles.hint}>Tap a recent alert to prepare a follow-up for that meal.</Text>
                </>
              )}
            </View>
          }
        />

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            disabled={sending}
            style={({ pressed }) => [styles.sendBtn, (sending || pressed) && styles.sendBtnPressed]}
            onPress={handleSendPress}>
            {sending ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <Send size={20} color="#FFFFFF" />
                <Text style={styles.sendText}>Send Food Alert</Text>
              </>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OwnerTheme.colors.background },
  content: { padding: 16, paddingBottom: 24 },
  headerIconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 13, fontWeight: '700', color: OwnerTheme.colors.textSecondary, marginTop: 18, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.4 },
  row: { flexDirection: 'row', gap: 10 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  bigChip: {
    flex: 1,
    minHeight: 56,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: OwnerTheme.colors.border,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigChipActive: { backgroundColor: OwnerTheme.colors.primary, borderColor: OwnerTheme.colors.primary },
  bigChipText: { fontSize: 15, fontWeight: '700', color: OwnerTheme.colors.textPrimary },
  bigChipTextActive: { color: '#FFFFFF' },
  segment: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentActive: { backgroundColor: OwnerTheme.colors.primaryLight, borderColor: OwnerTheme.colors.primary },
  segmentText: { fontSize: 14, fontWeight: '600', color: OwnerTheme.colors.textSecondary },
  segmentTextActive: { color: OwnerTheme.colors.primaryDark },
  pill: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
  },
  pillActive: { backgroundColor: OwnerTheme.colors.primary, borderColor: OwnerTheme.colors.primary },
  pillText: { fontSize: 14, fontWeight: '600', color: OwnerTheme.colors.textPrimary },
  pillTextActive: { color: '#FFFFFF' },
  search: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    marginTop: 12,
    marginBottom: 6,
    fontSize: 15,
  },
  residentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.borderLight,
    backgroundColor: '#FFFFFF',
    marginTop: 6,
  },
  residentRowActive: { borderColor: OwnerTheme.colors.primary, backgroundColor: OwnerTheme.colors.primarySoft },
  residentName: { fontSize: 15, fontWeight: '600', color: OwnerTheme.colors.textPrimary },
  residentRoom: { fontSize: 13, color: OwnerTheme.colors.textSecondary, marginTop: 1 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: OwnerTheme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxActive: { backgroundColor: OwnerTheme.colors.primary, borderColor: OwnerTheme.colors.primary },
  targetedText: { fontSize: 13, color: OwnerTheme.colors.textSecondary, marginTop: 14, fontWeight: '500' },
  moreOptionsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    backgroundColor: '#FFFFFF',
  },
  moreOptionsText: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  messageInput: {
    minHeight: 76,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    backgroundColor: '#FFFFFF',
    padding: 14,
    fontSize: 15,
    textAlignVertical: 'top',
    color: OwnerTheme.colors.textPrimary,
  },
  counter: { alignSelf: 'flex-end', fontSize: 12, color: OwnerTheme.colors.textMuted, marginTop: 4 },
  hint: { fontSize: 13, color: OwnerTheme.colors.textMuted, marginTop: 8 },
  errorBox: { backgroundColor: OwnerTheme.colors.dangerLight, borderRadius: 12, padding: 12, marginTop: 12 },
  errorText: { color: '#991B1B', fontSize: 14, fontWeight: '500' },
  resultBox: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: OwnerTheme.colors.successLight,
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
  },
  resultTitle: { fontSize: 15, fontWeight: '700', color: '#166534' },
  resultText: { fontSize: 13, color: '#166534', marginTop: 2 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: OwnerTheme.colors.warningLight,
    borderRadius: 12,
    padding: 12,
  },
  bannerText: { flex: 1, fontSize: 13, color: '#92400E', fontWeight: '500' },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.borderLight,
    padding: 12,
    marginTop: 8,
    minHeight: 56,
  },
  recentTitle: { fontSize: 15, fontWeight: '600', color: OwnerTheme.colors.textPrimary },
  recentMeta: { fontSize: 12, color: OwnerTheme.colors.textSecondary, marginTop: 2 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusPillText: { fontSize: 12, fontWeight: '700' },
  footer: {
    padding: 16,
    paddingBottom: 20,
    backgroundColor: OwnerTheme.colors.background,
    borderTopWidth: 1,
    borderTopColor: OwnerTheme.colors.borderLight,
  },
  sendBtn: {
    height: 58,
    borderRadius: 16,
    backgroundColor: OwnerTheme.colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  sendBtnPressed: { opacity: 0.8 },
  sendText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: OwnerTheme.colors.textPrimary },
  emptyText: { fontSize: 14, color: OwnerTheme.colors.textSecondary, textAlign: 'center' },
  retryBtn: { marginTop: 8, paddingHorizontal: 24, height: 48, borderRadius: 12, borderWidth: 1, borderColor: OwnerTheme.colors.border, justifyContent: 'center', backgroundColor: '#FFFFFF' },
  retryText: { fontWeight: '600', color: OwnerTheme.colors.textPrimary },
});
