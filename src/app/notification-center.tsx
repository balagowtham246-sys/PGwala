import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Href, router, useFocusEffect } from 'expo-router';
import {
  Bell,
  Building2,
  CheckCheck,
  DoorOpen,
  LogIn,
  LogOut,
  Wrench,
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
import { useProperty } from '@/context/property-context';
import { triggerSelectionHaptic } from '@/lib/haptics';
import { formatGateEventTimestamp, toSentenceCaseStatus } from '@/lib/ux-utils';
import {
  fetchOwnerInboxPage,
  InboxFilterTab,
  InboxItem,
  markAllInboxRead,
  markInboxItemRead,
} from '@/services/notification-center.service';

function getPriorityBadgeVariant(priority: string): StatusBadgeVariant {
  const normalized = priority.trim().toLowerCase();
  if (normalized === 'urgent') return 'danger';
  if (normalized === 'high') return 'warning';
  if (normalized === 'medium') return 'info';
  return 'neutral';
}

export default function NotificationCenterScreen() {
  const { user } = useAuth();
  const { selectedProperty, selectedPropertyId, loadingProperties } = useProperty();
  const userId = user?.id ?? null;

  const INBOX_PAGE_SIZE = 30;
  const [items, setItems] = useState<InboxItem[]>([]);
  const [filter, setFilter] = useState<InboxFilterTab>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [pageOffset, setPageOffset] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const requestSeqRef = useRef(0);

  const fetchLatestInbox = useCallback(
    async (forceRefresh: boolean, showSpinner = false) => {
      if (!userId || !selectedPropertyId) {
        setItems([]);
        setHasMore(false);
        setPageOffset(0);
        setErrorMessage(null);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      if (showSpinner) {
        setLoading(true);
      }
      const seq = ++requestSeqRef.current;
      const res = await fetchOwnerInboxPage(userId, selectedPropertyId, {
        forceRefresh,
        pageSize: INBOX_PAGE_SIZE,
        offset: 0,
      });
      if (seq !== requestSeqRef.current) return;

      if (res.ok) {
        setItems(res.data.items);
        setHasMore(res.data.hasMore);
        setPageOffset(INBOX_PAGE_SIZE);
        setErrorMessage(null);
      } else {
        setErrorMessage(res.error.message);
      }
      setLoading(false);
      setRefreshing(false);
    },
    [userId, selectedPropertyId]
  );

  const loadMoreInbox = useCallback(async () => {
    if (!userId || !selectedPropertyId || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const res = await fetchOwnerInboxPage(userId, selectedPropertyId, {
        forceRefresh: true,
        pageSize: INBOX_PAGE_SIZE,
        offset: pageOffset,
      });
      if (res.ok) {
        setItems((prev) => {
          const seen = new Set(prev.map((entry) => entry.id));
          return [...prev, ...res.data.items.filter((entry) => !seen.has(entry.id))];
        });
        setHasMore(res.data.hasMore);
        setPageOffset((prev) => prev + INBOX_PAGE_SIZE);
      }
    } finally {
      setLoadingMore(false);
    }
  }, [userId, selectedPropertyId, loadingMore, hasMore, pageOffset]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const timer = setTimeout(() => {
        if (active) {
          void fetchLatestInbox(false);
        }
      }, 0);
      return () => {
        active = false;
        clearTimeout(timer);
      };
    }, [fetchLatestInbox])
  );

  const handleRefresh = useCallback(() => {
    if (!userId || !selectedPropertyId) return;
    setRefreshing(true);
    void fetchLatestInbox(true);
  }, [userId, selectedPropertyId, fetchLatestInbox]);

  const gateCount = useMemo(
    () => items.filter((i) => i.type === 'gate_entry' || i.type === 'gate_exit').length,
    [items]
  );

  const complaintsCount = useMemo(
    () => items.filter((i) => i.type === 'complaint').length,
    [items]
  );

  const unreadCount = useMemo(
    () => items.filter((i) => !i.isRead).length,
    [items]
  );

  const filterOptions = useMemo<SegmentOption<InboxFilterTab>[]>(
    () => [
      { key: 'all', label: 'All', count: items.length },
      { key: 'gate', label: 'Gate', count: gateCount },
      { key: 'complaints', label: 'Complaints', count: complaintsCount },
    ],
    [items.length, gateCount, complaintsCount]
  );

  const filteredItems = useMemo(() => {
    if (filter === 'gate') {
      return items.filter((i) => i.type === 'gate_entry' || i.type === 'gate_exit');
    }
    if (filter === 'complaints') {
      return items.filter((i) => i.type === 'complaint');
    }
    return items;
  }, [items, filter]);

  const handleMarkAllRead = async () => {
    if (!userId || !selectedPropertyId || unreadCount === 0) return;
    triggerSelectionHaptic();
    const allIds = items.map((i) => i.id);
    setItems((prev) => prev.map((entry) => ({ ...entry, isRead: true })));
    await markAllInboxRead(userId, selectedPropertyId, allIds);
  };

  const handlePressItem = async (item: InboxItem) => {
    triggerSelectionHaptic();
    if (userId && selectedPropertyId && !item.isRead) {
      setItems((prev) =>
        prev.map((entry) => (entry.id === item.id ? { ...entry, isRead: true } : entry))
      );
      void markInboxItemRead(userId, selectedPropertyId, item.id);
    }

    if (item.routeTarget === '/resident-profile' && item.residentId) {
      router.push({
        pathname: '/resident-profile',
        params: { id: item.residentId, residentId: item.residentId },
      } as Href);
      return;
    }

    router.push(item.routeTarget as Href);
  };

  const renderCategoryIcon = (item: InboxItem) => {
    if (item.type === 'gate_exit') {
      return (
        <View
          style={[
            styles.iconCircle,
            { backgroundColor: OwnerTheme.colors.warningLight },
          ]}>
          <LogOut size={17} color={OwnerTheme.colors.warning} />
        </View>
      );
    }
    if (item.type === 'gate_entry') {
      return (
        <View
          style={[
            styles.iconCircle,
            { backgroundColor: OwnerTheme.colors.successLight },
          ]}>
          <LogIn size={17} color={OwnerTheme.colors.success} />
        </View>
      );
    }
    const isUrgentOrHigh =
      item.priority?.toLowerCase() === 'urgent' ||
      item.priority?.toLowerCase() === 'high';
    return (
      <View
        style={[
          styles.iconCircle,
          {
            backgroundColor: isUrgentOrHigh
              ? OwnerTheme.colors.dangerLight
              : OwnerTheme.colors.primaryLight,
          },
        ]}>
        <Wrench
          size={17}
          color={isUrgentOrHigh ? OwnerTheme.colors.danger : OwnerTheme.colors.primary}
        />
      </View>
    );
  };

  const renderEmptyFilterState = () => {
    if (filter === 'gate') {
      return (
        <EmptyState
          icon={DoorOpen}
          title="No gate alerts"
          description="Recent resident check-ins and check-outs will appear here."
          actionLabel="Show all"
          onAction={() => setFilter('all')}
        />
      );
    }
    if (filter === 'complaints') {
      return (
        <EmptyState
          icon={Wrench}
          title="No open complaints"
          description="All resident maintenance issues are resolved right now."
          actionLabel="Show all"
          onAction={() => setFilter('all')}
        />
      );
    }
    return (
      <EmptyState
        icon={Bell}
        title="You're all caught up"
        description="Gate activity and open maintenance requests for this property will appear here."
      />
    );
  };

  const showListRows =
    !loadingProperties &&
    Boolean(selectedPropertyId) &&
    !(loading && items.length === 0) &&
    !(errorMessage && items.length === 0);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <OwnerHeader
        title="Notifications"
        subtitle={selectedProperty?.name}
        showBack
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

      <FlatList
        data={showListRows ? filteredItems : []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const timeLabel = formatGateEventTimestamp(item.timestamp);
          const priorityLabel = item.priority
            ? toSentenceCaseStatus(item.priority)
            : '';

          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.title}${!item.isRead ? ', unread' : ''}`}
              onPress={() => void handlePressItem(item)}
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

                <Text style={styles.itemSubtitle} numberOfLines={2}>
                  {item.subtitle}
                </Text>

                {priorityLabel ? (
                  <View style={styles.badgeRow}>
                    <StatusBadge
                      label={priorityLabel}
                      variant={getPriorityBadgeVariant(priorityLabel)}
                      size="sm"
                    />
                  </View>
                ) : null}
              </View>
            </Pressable>
          );
        }}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        removeClippedSubviews={Platform.OS === 'android'}
        onEndReached={() => void loadMoreInbox()}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={[OwnerTheme.colors.primary]}
          />
        }
        ListHeaderComponent={
          !selectedPropertyId ? undefined : (
            <View style={{ gap: 12, marginBottom: 12 }}>
              <SegmentedFilter
                options={filterOptions}
                activeKey={filter}
                onSelect={(next) => {
                  triggerSelectionHaptic();
                  setFilter(next);
                }}
              />
              {errorMessage && items.length > 0 && (
                <ErrorState
                  message={errorMessage}
                  onRetry={() => void fetchLatestInbox(true)}
                />
              )}
            </View>
          )
        }
        ListEmptyComponent={
          loadingProperties && !selectedPropertyId ? (
            <LoadingState message="Loading property..." />
          ) : !selectedPropertyId ? (
            <EmptyState
              icon={Building2}
              title="No Property Selected"
              description="Select or add a PG property to view gate alerts and complaint notifications."
            />
          ) : loading && items.length === 0 ? (
            <LoadingState message="Loading notifications..." />
          ) : errorMessage && items.length === 0 ? (
            <ErrorState
              message={errorMessage}
              onRetry={() => void fetchLatestInbox(true, true)}
            />
          ) : (
            renderEmptyFilterState()
          )
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={{ paddingVertical: 16, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={OwnerTheme.colors.primary} />
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
    opacity: 0.86,
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
    gap: 4,
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
  itemSubtitle: {
    fontSize: 13,
    color: OwnerTheme.colors.textSecondary,
    lineHeight: 18,
  },
  badgeRow: {
    marginTop: 4,
  },
});
