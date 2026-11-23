import React, { useCallback, useMemo, useState } from 'react';
import { DarkSlateHeroCard } from '@/components/ui/dark-slate-hero-card';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { Href, router, useFocusEffect } from 'expo-router';
import { Bell, Megaphone, Utensils } from 'lucide-react-native';

import { RoleBottomNav } from '@/components/ui/bottom-nav';
import {
  EmptyState,
  ErrorState,
  HIGH_CONTRAST_SWITCH_COLORS,
  OwnerHeader,
  SWITCH_THUMB_COLOR,
} from '@/components/ui/owner';
import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useResident } from '@/context/resident-context';
import { useToast } from '@/context/toast-context';
import { useStudentMultiDayMenusQuery } from '@/hooks/use-food-menu';
import { useOfflineMutation } from '@/hooks/use-offline-mutation';
import { triggerSelectionHaptic } from '@/lib/haptics';
import { flushOfflineQueue } from '@/lib/offline-queue';
import { queryKeys } from '@/lib/query-keys';
import { supabase } from '@/lib/supabase';
import { addDaysToIsoDate, formatHhMmTo12h, getIstCalendarParts } from '@/lib/ux-utils';
import type { MealType } from '@/services/dashboard.service';
import { defaultOfflineExecutors } from '@/services/offline-executors';
import { DayMenuMap } from '@/services/resident-portal.service';

const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner'];

const MEAL_META: Record<MealType, { title: string }> = {
  breakfast: { title: 'Breakfast' },
  lunch: { title: 'Lunch' },
  dinner: { title: 'Dinner' },
};

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

interface RollingDayOption {
  iso: string;
  topLabel: string;
  dayNumber: string;
  emptyDayLabel: string;
}

function toLocalIsoDate(date: Date): string {
  return getIstCalendarParts(date).isoDate;
}

function buildRollingSevenDays(anchorIso: string): RollingDayOption[] {
  const result: RollingDayOption[] = [];

  for (let offset = 0; offset < 7; offset += 1) {
    const iso = addDaysToIsoDate(anchorIso, offset);
    const [yStr, mStr, dStr] = iso.split('-');
    const day = new Date(Date.UTC(Number(yStr), Number(mStr) - 1, Number(dStr)));
    const weekday = WEEKDAYS_SHORT[day.getUTCDay()];
    const month = MONTHS_SHORT[day.getUTCMonth()];
    const dayNumber = String(day.getUTCDate());
    const topLabel = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : weekday;
    const emptyDayLabel =
      offset === 0
        ? 'today'
        : offset === 1
          ? 'tomorrow'
          : `${weekday}, ${dayNumber} ${month}`;

    result.push({
      iso,
      topLabel,
      dayNumber,
      emptyDayLabel,
    });
  }

  return result;
}

const EMPTY_DAY_MENU: DayMenuMap = {
  breakfast: null,
  lunch: null,
  dinner: null,
};

export default function StudentMenuScreen() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { resident: sharedResident, refreshResident, patchResident } = useResident();
  const { showToast } = useToast();
  const userId = user?.id;

  const [anchorIso, setAnchorIso] = useState(() => toLocalIsoDate(new Date()));
  const [selectedIso, setSelectedIso] = useState(() => toLocalIsoDate(new Date()));
  const [manualRefreshing, setManualRefreshing] = useState(false);

  const dateStrip = useMemo(() => buildRollingSevenDays(anchorIso), [anchorIso]);
  const stripDates = useMemo(() => dateStrip.map((d) => d.iso), [dateStrip]);

  const activePropertyId = sharedResident?.propertyId ?? null;
  const hasAssignedProperty = !userId || sharedResident === null ? true : Boolean(activePropertyId);
  const propertyName = sharedResident?.propertyName || 'Assigned PG';
  const [optInOverride, setOptInOverride] = useState<boolean | null>(null);
  const mealOptIn = optInOverride ?? sharedResident?.mealOptIn ?? true;

  const menusQuery = useStudentMultiDayMenusQuery(
    activePropertyId,
    anchorIso,
    stripDates
  );

  const loading =
    Boolean(userId) &&
    ((!sharedResident && menusQuery.isPending) ||
      (Boolean(activePropertyId) && menusQuery.isPending && !menusQuery.data));
  const refreshing = manualRefreshing;
  const errorMessage = menusQuery.isError ? menusQuery.error.message : null;
  const menusByDate = useMemo(
    () => menusQuery.data?.byDate ?? {},
    [menusQuery.data?.byDate]
  );
  const publishedSet = useMemo(
    () => new Set(menusQuery.data?.publishedDates ?? []),
    [menusQuery.data?.publishedDates]
  );

  const executeFoodOptIn = useCallback(async (payload: { value: boolean }) => {
    const { error } = await supabase.rpc('set_my_meal_opt_in', {
      p_value: payload.value,
    });
    if (error) throw error;
  }, []);

  const { mutate: mutateFoodOptIn, isMutating: savingOptIn } = useOfflineMutation<
    { value: boolean },
    void
  >({
    operation: 'food_opt_in',
    execute: executeFoodOptIn,
  });

  const refetchMenus = menusQuery.refetch;

  const loadMenu = useCallback(
    async (forceResident = false) => {
      const todayIso = toLocalIsoDate(new Date());
      setAnchorIso(todayIso);
      const strip = buildRollingSevenDays(todayIso);
      setSelectedIso((prev) => (strip.some((d) => d.iso === prev) ? prev : strip[0].iso));

      if (!userId) return;
      if (forceResident || !sharedResident) {
        await refreshResident(forceResident);
      }
      if (activePropertyId) {
        await refetchMenus();
      }
    },
    [userId, sharedResident, refreshResident, activePropertyId, refetchMenus]
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const timer = setTimeout(() => {
        if (!active) return;
        if (!sharedResident && userId) {
          void refreshResident(false);
        }
        void flushOfflineQueue(defaultOfflineExecutors).then((summary) => {
          if (active && summary.succeeded > 0) {
            void qc.invalidateQueries({ queryKey: queryKeys.foodMenus.all });
          }
        });
      }, 0);
      return () => {
        active = false;
        clearTimeout(timer);
      };
    }, [sharedResident, userId, refreshResident, qc])
  );

  const handleRefresh = () => {
    setManualRefreshing(true);
    void (async () => {
      try {
        await flushOfflineQueue(defaultOfflineExecutors);
        await loadMenu(true);
      } finally {
        setManualRefreshing(false);
      }
    })();
  };

  const handleToggleMealAlerts = async (nextValue: boolean) => {
    if (savingOptIn) return;
    setOptInOverride(nextValue);
    patchResident({ mealOptIn: nextValue });
    triggerSelectionHaptic();

    const outcome = await mutateFoodOptIn(
      { value: nextValue },
      `food-opt-in-${userId || 'anon'}-${Date.now()}`
    );

    if (!outcome.ok) {
      setOptInOverride(null);
      patchResident({ mealOptIn: !nextValue });
      Alert.alert(
        'Update Failed',
        outcome.error.message || 'Could not update meal alert preference.'
      );
      return;
    }

    setOptInOverride(null);
    if (outcome.queued) {
      showToast('Meal alert preference queued offline');
      return;
    }

    showToast(nextValue ? 'Meal alerts enabled' : 'Meal alerts turned off');
  };

  const activeDay = useMemo(
    () => dateStrip.find((d) => d.iso === selectedIso) ?? dateStrip[0],
    [dateStrip, selectedIso]
  );

  const selectedDayMenus = menusByDate[activeDay.iso] ?? EMPTY_DAY_MENU;
  const hasAnyMenu = Boolean(
    selectedDayMenus.breakfast || selectedDayMenus.lunch || selectedDayMenus.dinner
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <OwnerHeader
        title="Mess Menu"
        subtitle={propertyName}
        showBack
        onBack={() =>
          router.canGoBack() ? router.back() : router.replace('/resident-dashboard')
        }
        rightAction={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View food and PG notices"
            onPress={() => router.push('/resident-announcements' as Href)}
            style={({ pressed }) => [
              styles.noticesPill,
              pressed && styles.noticesPillPressed,
            ]}>
            <Megaphone size={13} color={OwnerTheme.colors.primary} />
            <Text style={styles.noticesPillText}>Notices ›</Text>
          </Pressable>
        }
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={[OwnerTheme.colors.primary]}
          />
        }>
        {/* Dark-Slate Mess Menu Hero */}
        <DarkSlateHeroCard
          eyebrow="PG MESS MENU"
          title={`${activeDay.topLabel}, ${activeDay.dayNumber}`}
          subtitle={propertyName}
          badgeLabel={hasAnyMenu ? 'Published' : 'Not set'}
          badgeTone={hasAnyMenu ? 'success' : 'warning'}
        />

        {/* Horizontal 7-Day Rolling Date Strip */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.dateStripContent}
          style={styles.dateStripScroll}>
          {dateStrip.map((day) => {
            const isSelected = day.iso === activeDay.iso;
            const isPublished = publishedSet.has(day.iso);
            return (
              <Pressable
                key={day.iso}
                accessibilityRole="tab"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`${day.topLabel} ${day.dayNumber}${isPublished ? ', menu published' : ''}`}
                onPress={() => {
                  triggerSelectionHaptic();
                  setSelectedIso(day.iso);
                }}
                style={({ pressed }) => [
                  styles.dayPill,
                  isSelected && styles.dayPillSelected,
                  pressed && !isSelected && styles.dayPillPressed,
                ]}>
                <Text
                  style={[
                    styles.dayTopLabel,
                    isSelected && styles.dayTopLabelSelected,
                  ]}
                  numberOfLines={1}>
                  {day.topLabel}
                </Text>
                <Text
                  style={[
                    styles.dayNumLabel,
                    isSelected && styles.dayNumLabelSelected,
                  ]}>
                  {day.dayNumber}
                </Text>
                {isPublished ? (
                  <View
                    style={[
                      styles.publishedDot,
                      isSelected && styles.publishedDotOnSelected,
                    ]}
                  />
                ) : (
                  <View style={styles.publishedDotSpacer} />
                )}
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Inline Meal Alerts Opt-In Card */}
        {hasAssignedProperty && (
          <View style={styles.optInCard}>
            <View style={styles.optInIconWrap}>
              <Bell size={18} color={OwnerTheme.colors.primary} />
            </View>
            <View style={styles.optInCopy}>
              <Text style={styles.optInTitle}>Get meal alerts</Text>
              <Text style={styles.optInSubtitle}>
                Notify me when meals are ready, delayed, or cancelled
              </Text>
            </View>
            <Switch
              value={mealOptIn}
              onValueChange={(val) => void handleToggleMealAlerts(val)}
              disabled={savingOptIn}
              trackColor={HIGH_CONTRAST_SWITCH_COLORS}
              thumbColor={SWITCH_THUMB_COLOR}
            />
          </View>
        )}

        {errorMessage && (
          <ErrorState
            message={errorMessage}
            onRetry={() => {
              void loadMenu(true);
            }}
          />
        )}

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color={OwnerTheme.colors.primary} />
          </View>
        ) : !hasAssignedProperty ? (
          <EmptyState
            icon={Utensils}
            title="Awaiting Room Allocation"
            description="You'll see your PG's weekly mess menu here once your room is assigned."
          />
        ) : !hasAnyMenu ? (
          <EmptyState
            icon={Utensils}
            title="Menu Not Published Yet"
            description={
              activeDay.emptyDayLabel === 'today'
                ? "Your PG owner hasn't published today's meals yet. Check back shortly."
                : `Your PG owner hasn't published meals for ${activeDay.emptyDayLabel} yet. Check back shortly.`
            }
          />
        ) : (
          MEAL_ORDER.map((mealKey) => {
            const meta = MEAL_META[mealKey];
            const entry = selectedDayMenus[mealKey];
            const mealTimeLabel = entry?.meal_time
              ? formatHhMmTo12h(entry.meal_time)
              : '';
            return (
              <View key={mealKey} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.mealIconCircle}>
                    <Utensils size={16} color={OwnerTheme.colors.primary} />
                  </View>
                  <View style={styles.mealTitleRow}>
                    <Text style={styles.mealTitle}>{meta.title}</Text>
                    {mealTimeLabel ? (
                      <View style={styles.mealTimePill}>
                        <Text style={styles.mealTimeText}>{mealTimeLabel}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
                <Text
                  style={[
                    styles.mealItems,
                    !entry && styles.mealUnpublished,
                  ]}>
                  {entry ? entry.items : 'Not published yet'}
                </Text>
                {entry?.notes ? <Text style={styles.mealNotes}>{entry.notes}</Text> : null}
              </View>
            );
          })
        )}
      </ScrollView>

      <RoleBottomNav activeTab="menu" roleOverride="student" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: OwnerTheme.colors.background,
  },
  noticesPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: OwnerTheme.radius.full,
    backgroundColor: OwnerTheme.colors.primaryLight,
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  noticesPillPressed: {
    opacity: 0.78,
  },
  noticesPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  scrollContent: {
    padding: OwnerTheme.spacing.lg,
    paddingBottom: 28,
    gap: OwnerTheme.spacing.md,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
  },
  dateStripScroll: {
    marginHorizontal: -OwnerTheme.spacing.lg,
  },
  dateStripContent: {
    paddingHorizontal: OwnerTheme.spacing.lg,
    gap: 8,
  },
  dayPill: {
    minWidth: 70,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: OwnerTheme.radius.md,
    backgroundColor: OwnerTheme.colors.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  dayPillSelected: {
    backgroundColor: OwnerTheme.colors.primary,
    borderColor: OwnerTheme.colors.primary,
  },
  dayPillPressed: {
    backgroundColor: OwnerTheme.colors.surfaceElevated,
  },
  dayTopLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  dayTopLabelSelected: {
    color: '#E0F2FE',
  },
  dayNumLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  dayNumLabelSelected: {
    color: '#FFFFFF',
  },
  publishedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: OwnerTheme.colors.success,
    marginTop: 1,
  },
  publishedDotOnSelected: {
    backgroundColor: '#86EFAC',
  },
  publishedDotSpacer: {
    width: 6,
    height: 6,
    marginTop: 1,
  },
  optInCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: OwnerTheme.colors.card,
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    ...OwnerTheme.shadow,
  },
  optInIconWrap: {
    width: 36,
    height: 36,
    borderRadius: OwnerTheme.radius.sm,
    backgroundColor: OwnerTheme.colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optInCopy: {
    flex: 1,
    minWidth: 0,
  },
  optInTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  optInSubtitle: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 2,
    lineHeight: 16,
  },
  loadingBox: {
    padding: OwnerTheme.spacing.xxxl,
    alignItems: 'center',
  },
  card: {
    backgroundColor: OwnerTheme.colors.card,
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: OwnerTheme.spacing.lg,
    gap: OwnerTheme.spacing.sm,
    ...OwnerTheme.shadow,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: OwnerTheme.spacing.md,
  },
  mealIconCircle: {
    width: 32,
    height: 32,
    borderRadius: OwnerTheme.radius.sm,
    backgroundColor: OwnerTheme.colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mealTitleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  mealTitle: {
    ...OwnerTheme.typography.cardHeading,
  },
  mealTimePill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: OwnerTheme.radius.full,
    backgroundColor: OwnerTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  mealTimeText: {
    fontSize: 11,
    fontWeight: '600',
    color: OwnerTheme.colors.primary,
  },
  mealItems: {
    ...OwnerTheme.typography.bodyMedium,
    lineHeight: 20,
  },
  mealUnpublished: {
    color: OwnerTheme.colors.textMuted,
    fontStyle: 'italic',
  },
  mealNotes: {
    ...OwnerTheme.typography.supporting,
    fontStyle: 'italic',
  },
});
