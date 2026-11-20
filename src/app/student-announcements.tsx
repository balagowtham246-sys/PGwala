import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import {
  Building2,
  CheckCheck,
  Megaphone,
  Utensils,
} from 'lucide-react-native';

import {
  EmptyState,
  ErrorState,
  LoadingState,
  OwnerHeader,
  SegmentedFilter,
  SegmentOption,
  StatusBadge,
  StatusBadgeVariant,
} from '@/components/ui/owner';
import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/context/toast-context';
import { extractErrorMessage } from '@/lib/error-utils';
import { FoodAlertStatus, statusLabel } from '@/lib/food-alert-utils';
import { triggerSelectionHaptic } from '@/lib/haptics';
import { supabase } from '@/lib/supabase';
import { formatGateEventTimestamp, formatRoomLabel } from '@/lib/ux-utils';
import {
  fetchResidentNotices,
  markAllResidentNoticesRead,
  markResidentNoticeRead,
  ResidentNoticeItem,
  ResidentNoticesFilter,
} from '@/services/resident-notices.service';

interface LinkedPropertyInfo {
  propertyId: string;
  propertyName: string;
  roomNumber: string;
}

function getFoodBadgeVariant(status?: FoodAlertStatus): StatusBadgeVariant {
  if (status === 'ready') return 'success';
  if (status === 'delayed') return 'warning';
  if (status === 'cancelled') return 'danger';
  return 'info';
}

export default function StudentAnnouncementsScreen() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const userId = user?.id ?? null;

  const [propertyInfo, setPropertyInfo] = useState<LinkedPropertyInfo | null>(null);
  const [items, setItems] = useState<ResidentNoticeItem[]>([]);
  const [filter, setFilter] = useState<ResidentNoticesFilter>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const requestSeqRef = useRef(0);

  const loadNotices = useCallback(
    async (forceRefresh: boolean, showSpinner = false) => {
      if (!userId) {
        setPropertyInfo(null);
        setItems([]);
        setErrorMessage(null);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      if (showSpinner) {
        setLoading(true);
      }
      const seq = ++requestSeqRef.current;

      try {
        const { data: resData, error: resErr } = await supabase
          .from('residents')
          .select('property_id, room_number, property:properties(name)')
          .eq('profile_id', userId)
          .eq('is_active', true)
          .maybeSingle();

        if (seq !== requestSeqRef.current) return;
        if (resErr) {
          throw resErr;
        }

        if (!resData?.property_id) {
          setPropertyInfo(null);
          setItems([]);
          setErrorMessage(null);
          return;
        }

        const propObj = Array.isArray(resData.property)
          ? resData.property[0]
          : resData.property;
        const nextInfo: LinkedPropertyInfo = {
          propertyId: resData.property_id,
          propertyName: propObj?.name || 'My PG',
          roomNumber: resData.room_number || '',
        };
        setPropertyInfo(nextInfo);

        const res = await fetchResidentNotices(
          userId,
          nextInfo.propertyId,
          nextInfo.roomNumber,
          { forceRefresh }
        );
        if (seq !== requestSeqRef.current) return;

        if (res.ok) {
          setItems(res.data);
          setErrorMessage(null);
        } else {
          setErrorMessage(res.error.message || 'Could not load notices.');
        }
      } catch (err) {
        if (seq !== requestSeqRef.current) return;
        setErrorMessage(extractErrorMessage(err, 'Could not load notices.'));
      } finally {
        if (seq === requestSeqRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [userId]
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const timer = setTimeout(() => {
        if (active) {
          void loadNotices(false);
        }
      }, 0);
      return () => {
        active = false;
        clearTimeout(timer);
      };
    }, [loadNotices])
  );

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void loadNotices(true);
  }, [loadNotices]);

  const noticesCount = useMemo(
    () => items.filter((item) => item.type === 'announcement').length,
    [items]
  );

  const foodCount = useMemo(
    () => items.filter((item) => item.type === 'food_alert').length,
    [items]
  );

  const unreadCount = useMemo(
    () => items.filter((item) => !item.isRead).length,
    [items]
  );

  const filterOptions = useMemo<SegmentOption<ResidentNoticesFilter>[]>(
    () => [
      { key: 'all', label: 'All', count: items.length },
      { key: 'notices', label: 'Notices', count: noticesCount },
      { key: 'food', label: 'Food', count: foodCount },
    ],
    [items.length, noticesCount, foodCount]
  );

  const filteredItems = useMemo(() => {
    if (filter === 'notices') {
      return items.filter((item) => item.type === 'announcement');
    }
    if (filter === 'food') {
      return items.filter((item) => item.type === 'food_alert');
    }
    return items;
  }, [items, filter]);

  const handleMarkAllRead = async () => {
    if (!userId || !propertyInfo?.propertyId || unreadCount === 0) return;
    triggerSelectionHaptic();
    const allIds = items.map((i) => i.id);
    setItems((prev) => prev.map((entry) => ({ ...entry, isRead: true })));
    await markAllResidentNoticesRead(userId, propertyInfo.propertyId, allIds);
    showToast('All notices marked as read');
  };

  const handlePressItem = (item: ResidentNoticeItem) => {
    if (!userId || !propertyInfo?.propertyId || item.isRead) return;
    triggerSelectionHaptic();
    setItems((prev) =>
      prev.map((entry) =>
        entry.id === item.id ? { ...entry, isRead: true } : entry
      )
    );
    void markResidentNoticeRead(userId, propertyInfo.propertyId, item.id);
  };

  const renderCategoryIcon = (item: ResidentNoticeItem) => {
    if (item.type === 'announcement') {
      return (
        <View
          style={[
            styles.iconCircle,
            { backgroundColor: OwnerTheme.colors.primaryLight },
          ]}>
          <Megaphone size={17} color={OwnerTheme.colors.primary} />
        </View>
      );
    }

    const bgColor =
      item.mealStatus === 'ready'
        ? OwnerTheme.colors.successLight
        : item.mealStatus === 'delayed'
          ? OwnerTheme.colors.warningLight
          : item.mealStatus === 'cancelled'
            ? OwnerTheme.colors.dangerLight
            : OwnerTheme.colors.primaryLight;

    const iconColor =
      item.mealStatus === 'ready'
        ? OwnerTheme.colors.success
        : item.mealStatus === 'delayed'
          ? OwnerTheme.colors.warning
          : item.mealStatus === 'cancelled'
            ? OwnerTheme.colors.danger
            : OwnerTheme.colors.primary;

    return (
      <View style={[styles.iconCircle, { backgroundColor: bgColor }]}>
        <Utensils size={17} color={iconColor} />
      </View>
    );
  };

  const renderEmptyFilterState = () => {
    if (filter === 'notices') {
      return (
        <EmptyState
          icon={Megaphone}
          title="No owner notices yet"
          description="PG announcements and room broadcasts from management will appear here."
          actionLabel="Show all"
          onAction={() => setFilter('all')}
        />
      );
    }
    if (filter === 'food') {
      return (
        <EmptyState
          icon={Utensils}
          title="No food alerts yet"
          description="Meal ready, delayed, or cancelled updates from your warden will appear here."
          actionLabel="Show all"
          onAction={() => setFilter('all')}
        />
      );
    }
    return (
      <EmptyState
        icon={Megaphone}
        title="You're all caught up"
        description="Announcements and meal alerts from your PG management will appear here."
      />
    );
  };

  const headerSubtitle = propertyInfo
    ? `${propertyInfo.propertyName} · ${formatRoomLabel(propertyInfo.roomNumber)}`
    : 'PG & food updates';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <OwnerHeader
        title="Notices"
        subtitle={headerSubtitle}
        showBack
        onBack={() =>
          router.canGoBack() ? router.back() : router.replace('/student-dashboard')
        }
        rightAction={
          unreadCount > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Mark all read"
              onPress={() => void handleMarkAllRead()}
              style={({ pressed }) => [
                styles.markAllBtn,
                pressed && styles.markAllBtnPressed,
              ]}>
              <CheckCheck size={14} color={OwnerTheme.colors.primary} />
              <Text style={styles.markAllText}>Mark all read</Text>
            </Pressable>
          ) : undefined
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
        {loading && !propertyInfo && items.length === 0 ? (
          <LoadingState message="Loading notices..." />
        ) : errorMessage && !propertyInfo && items.length === 0 ? (
          <ErrorState
            message={errorMessage}
            onRetry={() => void loadNotices(true, true)}
          />
        ) : !propertyInfo ? (
          <EmptyState
            icon={Building2}
            title="Awaiting Room Allocation"
            description="PG notices and food alerts will appear here once your room is assigned."
          />
        ) : (
          <>
            <SegmentedFilter
              options={filterOptions}
              activeKey={filter}
              onSelect={(next) => {
                triggerSelectionHaptic();
                setFilter(next);
              }}
            />

            {loading && items.length === 0 ? (
              <LoadingState message="Loading notices..." />
            ) : errorMessage && items.length === 0 ? (
              <ErrorState
                message={errorMessage}
                onRetry={() => void loadNotices(true, true)}
              />
            ) : (
              <>
                {errorMessage && (
                  <ErrorState
                    message={errorMessage}
                    onRetry={() => void loadNotices(true)}
                  />
                )}

                {filteredItems.length === 0 ? (
                  renderEmptyFilterState()
                ) : (
                  <View style={styles.listContainer}>
                    {filteredItems.map((item) => {
                      const timeLabel = formatGateEventTimestamp(item.timestamp);
                      const badgeLabel =
                        item.type === 'announcement'
                          ? item.audienceLabel || 'All residents'
                          : item.mealStatus
                            ? statusLabel(item.mealStatus)
                            : 'Food update';
                      const badgeVariant: StatusBadgeVariant =
                        item.type === 'announcement'
                          ? badgeLabel !== 'All residents'
                            ? 'info'
                            : 'neutral'
                          : getFoodBadgeVariant(item.mealStatus);

                      return (
                        <Pressable
                          key={item.id}
                          accessibilityRole="button"
                          accessibilityLabel={`${item.title}${!item.isRead ? ', unread' : ''}`}
                          onPress={() => handlePressItem(item)}
                          style={({ pressed }) => [
                            styles.itemCard,
                            !item.isRead && styles.itemCardUnread,
                            pressed && styles.itemCardPressed,
                          ]}>
                          {renderCategoryIcon(item)}

                          <View style={styles.itemBody}>
                            <View style={styles.itemTopRow}>
                              <View style={styles.titleRow}>
                                {!item.isRead && <View style={styles.unreadDot} />}
                                <Text
                                  style={[
                                    styles.itemTitle,
                                    !item.isRead && styles.itemTitleUnread,
                                  ]}
                                  numberOfLines={2}>
                                  {item.title}
                                </Text>
                              </View>
                              {timeLabel ? (
                                <Text style={styles.itemTimestamp}>{timeLabel}</Text>
                              ) : null}
                            </View>

                            <Text style={styles.itemMessage}>{item.message}</Text>

                            <View style={styles.badgeRow}>
                              <StatusBadge
                                label={badgeLabel}
                                variant={badgeVariant}
                                size="sm"
                              />
                            </View>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: OwnerTheme.colors.background,
  },
  scrollContent: {
    padding: OwnerTheme.spacing.lg,
    gap: 12,
    paddingBottom: 32,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
  },
  markAllBtn: {
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
  markAllBtnPressed: {
    opacity: 0.78,
  },
  markAllText: {
    fontSize: 12,
    fontWeight: '600',
    color: OwnerTheme.colors.primary,
  },
  listContainer: {
    gap: 10,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: OwnerTheme.colors.card,
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 14,
    ...OwnerTheme.shadow,
  },
  itemCardUnread: {
    backgroundColor: OwnerTheme.colors.primarySoft,
    borderColor: '#BAE6FD',
  },
  itemCardPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.99 }],
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  itemBody: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  itemTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  titleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minWidth: 0,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: OwnerTheme.colors.primary,
    flexShrink: 0,
  },
  itemTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
    lineHeight: 19,
  },
  itemTitleUnread: {
    fontWeight: '700',
  },
  itemTimestamp: {
    fontSize: 11,
    fontWeight: '500',
    color: OwnerTheme.colors.textMuted,
    marginTop: 2,
    flexShrink: 0,
  },
  itemMessage: {
    fontSize: 13,
    color: OwnerTheme.colors.textSecondary,
    lineHeight: 19,
  },
  badgeRow: {
    flexDirection: 'row',
    marginTop: 3,
  },
});
