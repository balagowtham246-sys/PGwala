import React, { useCallback, useMemo, useRef, useState } from 'react';
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
import { router } from 'expo-router';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Coffee,
  Megaphone,
  Moon,
  Settings,
  Sun,
  Users,
  X,
} from 'lucide-react-native';

import { OwnerHeader } from '@/components/ui/owner';
import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import {
  useSendWardenFoodAlertMutation,
  useWardenDashboardQuery,
} from '@/hooks/use-dashboards';
import { extractErrorMessage } from '@/lib/error-utils';
import {
  FoodAlertStatus,
  FoodMealType,
  alertHeadline,
  createIdempotencyKey,
  formatAlertTime,
} from '@/lib/food-alert-utils';
import { triggerSelectionHaptic } from '@/lib/haptics';

function currentMealSlot(): FoodMealType {
  const h = new Date().getHours();
  if (h < 11) return 'breakfast';
  if (h < 17) return 'lunch';
  return 'dinner';
}

const MEAL_SLOT_LABEL: Record<FoodMealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
};

const MEAL_BUTTONS: {
  key: FoodMealType;
  label: string;
  accentBg: string;
  accentBorder: string;
  accentText: string;
  iconBg: string;
}[] = [
  {
    key: 'breakfast',
    label: 'Breakfast Ready',
    accentBg: '#FFFBEB',
    accentBorder: '#FDE68A',
    accentText: '#92400E',
    iconBg: '#FEF3C7',
  },
  {
    key: 'lunch',
    label: 'Lunch Ready',
    accentBg: '#ECFDF5',
    accentBorder: '#A7F3D0',
    accentText: '#065F46',
    iconBg: '#D1FAE5',
  },
  {
    key: 'dinner',
    label: 'Dinner Ready',
    accentBg: '#EFF6FF',
    accentBorder: '#BFDBFE',
    accentText: '#1E40AF',
    iconBg: '#DBEAFE',
  },
];

export default function WardenDashboardScreen() {
  const { profile, user } = useAuth();
  const userId = user?.id;
  const colors = OwnerTheme.colors;

  const [refreshing, setRefreshing] = useState(false);
  const [sendingMeal, setSendingMeal] = useState<string | null>(null);
  const [sentMap, setSentMap] = useState<Partial<Record<FoodMealType, string>>>(
    {}
  );
  const [statusError, setStatusError] = useState<string | null>(null);
  const [showResidents, setShowResidents] = useState(false);
  const [dismissedTempBanner, setDismissedTempBanner] = useState(false);

  const sendingRef = useRef(false);
  const activeSlot = useMemo(() => currentMealSlot(), []);

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
    ? extractErrorMessage(wardenQuery.error, 'Could not load your PG.')
    : null;

  const mustChangePassword = Boolean(
    profile?.must_change_password || user?.user_metadata?.must_change_password
  );

  const latestAlert = recent[0] ?? null;

  const triggerFoodAlert = useCallback(
    async (mealType: FoodMealType, alertStatus: FoodAlertStatus) => {
      if (sendingRef.current || sendAlertMutation.isPending || !property) {
        return;
      }
      if (audienceList.length === 0) {
        setStatusError('No active residents in this PG yet.');
        return;
      }

      triggerSelectionHaptic();
      sendingRef.current = true;
      setSendingMeal(`${mealType}:${alertStatus}`);
      setStatusError(null);

      try {
        await sendAlertMutation.mutateAsync({
          userId,
          meal_type: mealType,
          status: alertStatus,
          audience_type: 'all',
          idempotency_key: createIdempotencyKey(),
        });

        const sentTime = new Date().toLocaleTimeString('en-IN', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        });
        if (alertStatus === 'ready') {
          setSentMap((prev) => ({ ...prev, [mealType]: sentTime }));
        }
      } catch (err) {
        setStatusError(
          extractErrorMessage(err, 'Could not send alert. Please tap again.')
        );
      } finally {
        sendingRef.current = false;
        setSendingMeal(null);
      }
    },
    [audienceList.length, property, sendAlertMutation, userId]
  );

  const handleDelayedPress = useCallback(() => {
    const slotLabel = MEAL_SLOT_LABEL[activeSlot];
    Alert.alert(
      `${slotLabel} Delayed?`,
      `Tell all ${audienceList.length} residents that ${slotLabel.toLowerCase()} is running late?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Yes, Send Delay',
          onPress: () => void triggerFoodAlert(activeSlot, 'delayed'),
        },
      ]
    );
  }, [activeSlot, audienceList.length, triggerFoodAlert]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await wardenQuery.refetch();
    } finally {
      setRefreshing(false);
    }
  }, [wardenQuery]);

  const headerActions = (
    <Pressable
      accessibilityLabel="Warden Settings"
      hitSlop={8}
      style={styles.headerIconBtn}
      onPress={() => router.push('/warden-settings')}>
      <Settings size={22} color={colors.textPrimary} />
    </Pressable>
  );

  const renderResidentItem = useCallback(
    ({ item }: { item: (typeof audienceList)[number] }) => (
      <View style={styles.residentRow}>
        <Text style={styles.residentName} numberOfLines={1}>
          {item.full_name}
        </Text>
        <View style={styles.roomBadge}>
          <Text style={styles.roomBadgeText}>Room {item.room_number}</Text>
        </View>
      </View>
    ),
    []
  );

  const residentKeyExtractor = useCallback(
    (item: (typeof audienceList)[number]) => item.resident_id,
    []
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <OwnerHeader title="Kitchen" rightAction={headerActions} />
        <ActivityIndicator
          style={{ marginTop: 64 }}
          size="large"
          color={colors.primary}
        />
      </SafeAreaView>
    );
  }

  if (!property) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <OwnerHeader title="Kitchen" rightAction={headerActions} />
        <View style={styles.emptyWrap}>
          <Megaphone size={40} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No PG Assigned</Text>
          <Text style={styles.emptyText}>
            {loadError ?? 'Ask the PG owner to assign you, then tap Refresh.'}
          </Text>
          <Pressable style={styles.retryBtn} onPress={() => void handleRefresh()}>
            <Text style={styles.retryText}>Refresh</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <OwnerHeader
        title="Kitchen"
        subtitle={property.name}
        rightAction={headerActions}
      />

      <FlatList
        data={showResidents ? audienceList : []}
        keyExtractor={residentKeyExtractor}
        renderItem={renderResidentItem}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        initialNumToRender={15}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void handleRefresh()}
          />
        }
        ListHeaderComponent={
          <View>
            {mustChangePassword && !dismissedTempBanner && (
              <View style={styles.banner}>
                <Pressable
                  style={{
                    flex: 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                  }}
                  onPress={() => router.push('/resident-profile-edit')}>
                  <AlertTriangle size={18} color="#B45309" />
                  <Text style={styles.bannerText}>
                    Temporary password. Tap to change.
                  </Text>
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

            {/* Giant 2-Second Headcount Hero Card */}
            <View style={styles.heroCard}>
              <View style={styles.heroTopRow}>
                <Text style={styles.heroEyebrow}>
                  NOW · {MEAL_SLOT_LABEL[activeSlot].toUpperCase()}
                </Text>
                <View style={styles.heroPgPill}>
                  <Text style={styles.heroPgPillText} numberOfLines={1}>
                    {property.name}
                  </Text>
                </View>
              </View>

              <View style={styles.heroCountRow}>
                <Text style={styles.heroCountNumber}>
                  {audienceList.length}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.heroCountLabel}>
                    {audienceList.length === 1 ? 'Person' : 'People'}
                  </Text>
                  <Text style={styles.heroCountSub}>
                    Active residents in PG
                  </Text>
                </View>
              </View>

              {latestAlert && (
                <View style={styles.heroLastSentStrip}>
                  <Check size={14} color="#34D399" />
                  <Text style={styles.heroLastSentText} numberOfLines={1}>
                    Last sent: {alertHeadline(latestAlert.meal_type, latestAlert.status)} ·{' '}
                    {formatAlertTime(latestAlert.created_at)}
                  </Text>
                </View>
              )}
            </View>

            {/* Giant 1-Tap Food Ready Buttons */}
            <Text style={styles.sectionLabel}>TAP TO CALL RESIDENTS</Text>

            <View style={styles.mealStack}>
              {MEAL_BUTTONS.map((btn) => {
                const isSendingThis = sendingMeal === `${btn.key}:ready`;
                const isActiveSlot = activeSlot === btn.key;
                const sentAt = sentMap[btn.key];
                const IconComp =
                  btn.key === 'breakfast'
                    ? Coffee
                    : btn.key === 'lunch'
                      ? Sun
                      : Moon;

                return (
                  <Pressable
                    key={btn.key}
                    accessibilityRole="button"
                    accessibilityLabel={`Send ${btn.label} alert to all residents`}
                    disabled={Boolean(sendingMeal)}
                    style={({ pressed }) => [
                      styles.mealBtn,
                      {
                        backgroundColor: isActiveSlot ? btn.accentBg : '#FFFFFF',
                        borderColor: isActiveSlot ? btn.accentBorder : '#E2E8F0',
                        borderWidth: isActiveSlot ? 2 : 1,
                      },
                      pressed && { opacity: 0.82 },
                      Boolean(sendingMeal) && !isSendingThis && { opacity: 0.55 },
                    ]}
                    onPress={() => void triggerFoodAlert(btn.key, 'ready')}>
                    <View
                      style={[
                        styles.mealIconCircle,
                        { backgroundColor: btn.iconBg },
                      ]}>
                      {isSendingThis ? (
                        <ActivityIndicator size="small" color={btn.accentText} />
                      ) : (
                        <IconComp size={24} color={btn.accentText} />
                      )}
                    </View>

                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.mealBtnTitle,
                          { color: '#0F172A' },
                        ]}>
                        {btn.label}
                      </Text>
                      <Text style={styles.mealBtnSub}>
                        {sentAt
                          ? `Sent at ${sentAt}`
                          : `Notify all ${audienceList.length} residents`}
                      </Text>
                    </View>

                    {sentAt ? (
                      <View style={styles.sentPill}>
                        <Check size={14} color="#047857" />
                        <Text style={styles.sentPillText}>Sent</Text>
                      </View>
                    ) : isActiveSlot ? (
                      <View
                        style={[
                          styles.nowPill,
                          { backgroundColor: btn.accentText },
                        ]}>
                        <Text style={styles.nowPillText}>CALL</Text>
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>

            {/* Secondary 1-Tap Food Delayed Button */}
            <Pressable
              accessibilityRole="button"
              disabled={Boolean(sendingMeal)}
              style={({ pressed }) => [
                styles.delayBtn,
                pressed && { opacity: 0.8 },
              ]}
              onPress={handleDelayedPress}>
              {sendingMeal === `${activeSlot}:delayed` ? (
                <ActivityIndicator size="small" color="#B45309" />
              ) : (
                <Clock size={18} color="#B45309" />
              )}
              <Text style={styles.delayBtnText}>
                {MEAL_SLOT_LABEL[activeSlot]} Running Late? Tap to Inform
              </Text>
            </Pressable>

            {statusError && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{statusError}</Text>
              </View>
            )}

            {/* Collapsible Residents List */}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showResidents }}
              style={styles.residentsToggleBtn}
              onPress={() => {
                triggerSelectionHaptic();
                setShowResidents((prev) => !prev);
              }}>
              <View style={styles.residentsToggleLeft}>
                <Users size={18} color="#334155" />
                <Text style={styles.residentsToggleText}>
                  Residents List ({audienceList.length})
                </Text>
              </View>
              {showResidents ? (
                <ChevronUp size={20} color="#64748B" />
              ) : (
                <ChevronDown size={20} color="#64748B" />
              )}
            </Pressable>
          </View>
        }
        ListFooterComponent={
          recent.length > 0 ? (
            <View style={{ marginTop: 20 }}>
              <Text style={styles.sectionLabel}>RECENT CALLS</Text>
              <View style={styles.recentCard}>
                {recent.slice(0, 3).map((item, idx) => (
                  <View
                    key={item.id}
                    style={[
                      styles.recentRow,
                      idx > 0 && styles.recentRowDivider,
                    ]}>
                    <Text style={styles.recentTitle}>
                      {alertHeadline(item.meal_type, item.status)}
                    </Text>
                    <Text style={styles.recentTime}>
                      {formatAlertTime(item.created_at)}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : undefined
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  content: {
    padding: 16,
    paddingBottom: 36,
  },
  headerIconBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
  },
  bannerText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#92400E',
  },
  heroCard: {
    backgroundColor: '#0F172A',
    borderRadius: 18,
    padding: 18,
    marginBottom: 18,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 10,
  },
  heroEyebrow: {
    fontSize: 12,
    fontWeight: '700',
    color: '#38BDF8',
    letterSpacing: 0.8,
  },
  heroPgPill: {
    maxWidth: '55%',
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  heroPgPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#E2E8F0',
  },
  heroCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  heroCountNumber: {
    fontSize: 48,
    fontWeight: '800',
    color: '#FFFFFF',
    lineHeight: 54,
  },
  heroCountLabel: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  heroCountSub: {
    fontSize: 13,
    color: '#94A3B8',
    marginTop: 2,
  },
  heroLastSentStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.12)',
  },
  heroLastSentText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: '#A7F3D0',
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.7,
    marginBottom: 10,
    marginLeft: 2,
  },
  mealStack: {
    gap: 12,
  },
  mealBtn: {
    minHeight: 72,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  mealIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mealBtnTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  mealBtnSub: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
  },
  nowPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  nowPillText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  sentPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  sentPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#047857',
  },
  delayBtn: {
    marginTop: 12,
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 14,
  },
  delayBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#92400E',
  },
  errorBox: {
    marginTop: 12,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 12,
    padding: 12,
  },
  errorText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#991B1B',
  },
  residentsToggleBtn: {
    marginTop: 18,
    minHeight: 54,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  residentsToggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  residentsToggleText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  residentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 8,
  },
  residentName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#0F172A',
    marginRight: 10,
  },
  roomBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  roomBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  recentCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 14,
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    gap: 8,
  },
  recentRowDivider: {
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  recentTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  recentTime: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
  },
  emptyText: {
    fontSize: 15,
    color: '#64748B',
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 10,
    paddingHorizontal: 28,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
  },
  retryText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
