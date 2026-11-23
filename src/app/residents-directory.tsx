import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AppState,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { Href, router, useFocusEffect } from 'expo-router';
import {
  ChevronRight,
  MessageCircle,
  Phone,
  Search,
  SlidersHorizontal,
  Users,
  X,
} from 'lucide-react-native';

import {
  EmptyState,
  ErrorState,
  LoadingState,
  OwnerHeader,
  StatusBadge,
} from '@/components/ui/owner';
import { OwnerTheme } from '@/constants/theme';
import { useProperty } from '@/context/property-context';
import { useResidentsDirectoryQuery } from '@/hooks/use-residents';
import {
  buildWhatsAppReminderUrl,
  formatPaiseToRupees,
} from '@/lib/billing-utils';
import { triggerSelectionHaptic } from '@/lib/haptics';
import { queryKeys } from '@/lib/query-keys';
import {
  ResidentGender,
  sortRoomCodes,
  toSentenceCaseStatus,
} from '@/lib/ux-utils';
import {
  ResidentDirectoryItem,
  subscribePropertyResidentsRealtime,
} from '@/services/residents.service';

type GateStatusFilter = 'all' | 'IN' | 'OUT';
type DuesFilter = 'all' | 'pending' | 'clear';
type GenderFilter = 'all' | ResidentGender;

interface RoomGroup {
  roomNumber: string;
  data: ResidentDirectoryItem[];
}

const ResidentDirectoryRow = memo(function ResidentDirectoryRow({
  resident,
  isFirst,
  isLast,
  onPress,
}: {
  resident: ResidentDirectoryItem;
  isFirst: boolean;
  isLast: boolean;
  onPress: (id: string) => void;
}) {
  const bedPart = resident.bedLabel ? resident.bedLabel : 'Bed unassigned';
  const duesPart =
    resident.pendingDuesPaise > 0
      ? `${formatPaiseToRupees(resident.pendingDuesPaise)} due`
      : 'Paid';
  const subtitleText = `${bedPart} · ${duesPart}`;
  const statusLabel = toSentenceCaseStatus(resident.gateStatus);
  const statusVariant = resident.gateStatus === 'IN' ? 'success' : 'warning';
  const phoneDigits = (resident.phoneNumber ?? '').replace(/\D/g, '');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${resident.fullName}, ${subtitleText}, ${statusLabel}`}
      onPress={() => onPress(resident.id)}
      style={({ pressed }) => [
        styles.residentRow,
        styles.residentRowSectionItem,
        isFirst && styles.residentRowFirst,
        isLast ? styles.residentRowLast : styles.residentRowDivider,
        pressed && styles.residentRowPressed,
      ]}>
      <View style={styles.residentMain}>
        <Text style={styles.residentName} numberOfLines={1}>
          {resident.fullName}
        </Text>
        <Text
          style={[
            styles.residentMeta,
            resident.pendingDuesPaise > 0 && styles.dueText,
          ]}
          numberOfLines={1}>
          {subtitleText}
        </Text>
      </View>

      <View style={styles.residentRight}>
        {phoneDigits.length >= 10 && (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`WhatsApp ${resident.fullName}`}
              hitSlop={6}
              style={({ pressed }) => [
                {
                  width: 30,
                  height: 30,
                  borderRadius: 15,
                  backgroundColor: '#DCFCE7',
                  alignItems: 'center',
                  justifyContent: 'center',
                },
                pressed && { opacity: 0.7 },
              ]}
              onPress={(e) => {
                e.stopPropagation();
                const msg =
                  resident.pendingDuesPaise > 0
                    ? `Hi ${resident.fullName}, friendly reminder regarding your pending PG dues of ${formatPaiseToRupees(resident.pendingDuesPaise)}.`
                    : `Hi ${resident.fullName}, reaching out regarding your PG stay (Room ${resident.roomNumber}).`;
                const url = buildWhatsAppReminderUrl(resident.phoneNumber, msg);
                if (url) {
                  Linking.openURL(url).catch(() => {
                    Alert.alert('WhatsApp Unavailable', 'Could not open WhatsApp.');
                  });
                }
              }}>
              <MessageCircle size={14} color="#15803D" />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Call ${resident.fullName}`}
              hitSlop={6}
              style={({ pressed }) => [
                {
                  width: 30,
                  height: 30,
                  borderRadius: 15,
                  backgroundColor: OwnerTheme.colors.primaryLight,
                  alignItems: 'center',
                  justifyContent: 'center',
                },
                pressed && { opacity: 0.7 },
              ]}
              onPress={(e) => {
                e.stopPropagation();
                Linking.openURL(`tel:${phoneDigits}`).catch(() => {
                  Alert.alert('Unable to Call', 'Could not open the phone dialer.');
                });
              }}>
              <Phone size={14} color={OwnerTheme.colors.primary} />
            </Pressable>
          </>
        )}
        <View style={styles.badgesCol}>
          <StatusBadge label={statusLabel} variant={statusVariant} size="sm" />
        </View>
        <ChevronRight size={16} color={OwnerTheme.colors.textMuted} />
      </View>
    </Pressable>
  );
});

export default function ResidentsDirectoryScreen() {
  const qc = useQueryClient();
  const { selectedProperty, selectedPropertyId, loadingProperties } = useProperty();

  const [manualRefreshing, setManualRefreshing] = useState(false);

  // Search & unified filter modal state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<GateStatusFilter>('all');
  const [duesFilter, setDuesFilter] = useState<DuesFilter>('all');
  const [genderFilter, setGenderFilter] = useState<GenderFilter>('all');
  const [roomFilter, setRoomFilter] = useState<string>('all');
  const [filterSheetVisible, setFilterSheetVisible] = useState(false);

  const directoryQuery = useResidentsDirectoryQuery(selectedPropertyId);
  const residents = useMemo(
    () => directoryQuery.data ?? [],
    [directoryQuery.data]
  );
  const loading =
    Boolean(selectedPropertyId) &&
    directoryQuery.isPending &&
    !directoryQuery.data;
  const refreshing = manualRefreshing;
  const errorMessage = directoryQuery.isError
    ? directoryQuery.error.message
    : null;

  const [isScreenFocused, setIsScreenFocused] = useState(true);
  const [isAppActive, setIsAppActive] = useState(AppState.currentState === 'active');

  useFocusEffect(
    useCallback(() => {
      setIsScreenFocused(true);
      return () => {
        setIsScreenFocused(false);
      };
    }, [])
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      setIsAppActive(nextState === 'active');
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!selectedPropertyId || !isScreenFocused || !isAppActive) return;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribePropertyResidentsRealtime(selectedPropertyId, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void qc.invalidateQueries({
          queryKey: queryKeys.residents.directory(selectedPropertyId),
        });
      }, 300);
    });
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      unsubscribe();
    };
  }, [selectedPropertyId, isScreenFocused, isAppActive, qc]);

  const refetchDirectory = directoryQuery.refetch;

  const handleRefresh = useCallback(() => {
    if (!selectedPropertyId) return;
    setManualRefreshing(true);
    void refetchDirectory().finally(() => {
      setManualRefreshing(false);
    });
  }, [selectedPropertyId, refetchDirectory]);

  const availableRooms = useMemo(() => {
    const rooms = new Set<string>();
    for (const r of residents) {
      if (r.isActive !== false && r.roomNumber) {
        rooms.add(r.roomNumber);
      }
    }
    return Array.from(rooms).sort(sortRoomCodes);
  }, [residents]);

  const effectiveRoomFilter = useMemo(() => {
    if (roomFilter === 'all') return 'all';
    return availableRooms.includes(roomFilter) ? roomFilter : 'all';
  }, [roomFilter, availableRooms]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (statusFilter !== 'all') count += 1;
    if (duesFilter !== 'all') count += 1;
    if (genderFilter !== 'all') count += 1;
    if (effectiveRoomFilter !== 'all') count += 1;
    return count;
  }, [statusFilter, duesFilter, genderFilter, effectiveRoomFilter]);

  const clearFiltersOnly = useCallback(() => {
    triggerSelectionHaptic();
    setStatusFilter('all');
    setDuesFilter('all');
    setGenderFilter('all');
    setRoomFilter('all');
  }, []);

  const clearAllFiltersAndSearch = useCallback(() => {
    triggerSelectionHaptic();
    setSearchQuery('');
    setStatusFilter('all');
    setDuesFilter('all');
    setGenderFilter('all');
    setRoomFilter('all');
  }, []);

  const activeResidents = useMemo(
    () => residents.filter((r) => r.isActive !== false),
    [residents]
  );

  const quickCounts = useMemo(() => {
    let unpaid = 0;
    let outside = 0;
    let inside = 0;
    for (const r of activeResidents) {
      if (r.pendingDuesPaise > 0) unpaid += 1;
      if (r.gateStatus === 'OUT') outside += 1;
      else inside += 1;
    }
    return {
      all: activeResidents.length,
      unpaid,
      outside,
      inside,
    };
  }, [activeResidents]);

  const filteredResidents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const digitsQ = searchQuery.replace(/\D/g, '');

    return activeResidents.filter((resident) => {
      if (statusFilter !== 'all' && resident.gateStatus !== statusFilter) {
        return false;
      }
      if (duesFilter === 'pending' && resident.pendingDuesPaise <= 0) {
        return false;
      }
      if (duesFilter === 'clear' && resident.pendingDuesPaise > 0) {
        return false;
      }
      if (genderFilter !== 'all' && resident.gender !== genderFilter) {
        return false;
      }
      if (effectiveRoomFilter !== 'all' && resident.roomNumber !== effectiveRoomFilter) {
        return false;
      }

      if (q) {
        const nameMatch = resident.fullName.toLowerCase().includes(q);
        const roomMatch = resident.roomNumber.toLowerCase().includes(q);
        const bedMatch = (resident.bedLabel ?? '').toLowerCase().includes(q);
        const phoneLowerMatch = (resident.phoneNumber ?? '').toLowerCase().includes(q);
        const phoneDigitsMatch =
          digitsQ.length > 0 &&
          (resident.phoneNumber ?? '').replace(/\D/g, '').includes(digitsQ);
        if (
          !nameMatch &&
          !roomMatch &&
          !bedMatch &&
          !phoneLowerMatch &&
          !phoneDigitsMatch
        ) {
          return false;
        }
      }

      return true;
    });
  }, [
    activeResidents,
    searchQuery,
    statusFilter,
    duesFilter,
    genderFilter,
    effectiveRoomFilter,
  ]);

  const groupedRooms: RoomGroup[] = useMemo(() => {
    const byRoom = new Map<string, ResidentDirectoryItem[]>();
    for (const resident of filteredResidents) {
      const key = resident.roomNumber || 'Unassigned';
      const list = byRoom.get(key) ?? [];
      list.push(resident);
      byRoom.set(key, list);
    }

    return Array.from(byRoom.keys())
      .sort(sortRoomCodes)
      .map((roomNumber) => {
        const list = [...(byRoom.get(roomNumber) ?? [])].sort((a, b) => {
          if (a.bedLabel && b.bedLabel) {
            const bedCmp = sortRoomCodes(a.bedLabel, b.bedLabel);
            if (bedCmp !== 0) return bedCmp;
          }
          return a.fullName.localeCompare(b.fullName);
        });
        return { roomNumber, data: list };
      });
  }, [filteredResidents]);

  const openResidentProfile = useCallback((residentId: string) => {
    router.push({
      pathname: '/resident-profile',
      params: { id: residentId },
    } as Href);
  }, []);

  const hasSearchOrFilter = searchQuery.trim().length > 0 || activeFilterCount > 0;
  const activeSections =
    loading && activeResidents.length === 0 ? [] : groupedRooms;

  const listEmptyComponent = useMemo(() => {
    if (loading && activeResidents.length === 0) {
      return <LoadingState message="Loading residents..." style={styles.loadingWrap} />;
    }
    if (activeResidents.length === 0) {
      return (
        <EmptyState
          icon={Users}
          title="No residents yet"
          description="Add your first resident to manage rooms, monthly rent dues, and gate attendance."
          actionLabel="Add your first resident"
          onAction={() => router.push('/add-resident')}
          style={styles.emptyWrap}
        />
      );
    }
    return (
      <EmptyState
        icon={Search}
        title="No matching residents"
        description={
          hasSearchOrFilter
            ? 'Try adjusting your search query or clearing your active filters.'
            : 'No residents match the current view.'
        }
        actionLabel="Clear filters"
        onAction={clearAllFiltersAndSearch}
        style={styles.emptyWrap}
      />
    );
  }, [
    loading,
    activeResidents.length,
    hasSearchOrFilter,
    clearAllFiltersAndSearch,
  ]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <OwnerHeader
        title="Residents"
        subtitle={selectedProperty?.name}
        showBack
        rightAction={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add resident"
            style={({ pressed }) => [
              styles.headerAddBtn,
              pressed && styles.pressedFade,
            ]}
            onPress={() => router.push('/add-resident')}>
            <Text style={styles.headerAddBtnText}>+ Add</Text>
          </Pressable>
        }
      />

      {!loadingProperties && !selectedPropertyId ? (
        <View style={styles.statePad}>
          <EmptyState
            icon={Users}
            title="No property selected"
            description="Create or select a PG property to view and manage your residents."
            actionLabel="Manage properties"
            onAction={() => router.push('/owner-properties')}
          />
        </View>
      ) : (
        <View style={styles.directoryBody}>
          {/* Live Search & Filter Toolbar pinned outside SectionList so TextInput keeps focus */}
          <View style={styles.toolbarHeaderWrap}>
            {/* Compact Fintech Occupancy & Dues Strip */}
            <View
              style={{
                flexDirection: 'row',
                backgroundColor: '#0F172A',
                borderRadius: 16,
                paddingVertical: 12,
                paddingHorizontal: 14,
                marginBottom: 10,
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ fontSize: 18, fontWeight: '800', color: '#FFFFFF' }}>
                  {quickCounts.all}
                </Text>
                <Text style={{ fontSize: 11, color: '#94A3B8', fontWeight: '600' }}>
                  Active
                </Text>
              </View>
              <View style={{ width: 1, height: 24, backgroundColor: 'rgba(255,255,255,0.14)' }} />
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ fontSize: 18, fontWeight: '800', color: '#38BDF8' }}>
                  {selectedProperty?.total_beds
                    ? `${quickCounts.all}/${selectedProperty.total_beds}`
                    : `${quickCounts.inside}`}
                </Text>
                <Text style={{ fontSize: 11, color: '#94A3B8', fontWeight: '600' }}>
                  {selectedProperty?.total_beds ? 'Beds' : 'Inside'}
                </Text>
              </View>
              <View style={{ width: 1, height: 24, backgroundColor: 'rgba(255,255,255,0.14)' }} />
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text
                  style={{
                    fontSize: 18,
                    fontWeight: '800',
                    color: quickCounts.unpaid > 0 ? '#FCA5A5' : '#34D399',
                  }}>
                  {quickCounts.unpaid}
                </Text>
                <Text style={{ fontSize: 11, color: '#94A3B8', fontWeight: '600' }}>
                  With Dues
                </Text>
              </View>
            </View>

            <View style={styles.searchBarWrap}>
              <Search size={16} color={OwnerTheme.colors.textMuted} />
              <TextInput
                style={styles.searchInput}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search name, room, or phone..."
                placeholderTextColor={OwnerTheme.colors.textMuted}
                returnKeyType="search"
                autoCorrect={false}
              />
              {searchQuery.length > 0 && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  hitSlop={8}
                  onPress={() => setSearchQuery('')}>
                  <X size={16} color={OwnerTheme.colors.textSecondary} />
                </Pressable>
              )}
            </View>

            {/* 1-Tap Quick-Filter Chips */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.quickChipsRow}
              keyboardShouldPersistTaps="handled">
              {(
                [
                  {
                    key: 'all',
                    label: `All (${quickCounts.all})`,
                    active: statusFilter === 'all' && duesFilter === 'all',
                    onPress: () => {
                      triggerSelectionHaptic();
                      setStatusFilter('all');
                      setDuesFilter('all');
                    },
                  },
                  {
                    key: 'unpaid',
                    label: `Unpaid Dues (${quickCounts.unpaid})`,
                    active: duesFilter === 'pending',
                    onPress: () => {
                      triggerSelectionHaptic();
                      setDuesFilter((prev) => (prev === 'pending' ? 'all' : 'pending'));
                    },
                  },
                  {
                    key: 'outside',
                    label: `Outside (${quickCounts.outside})`,
                    active: statusFilter === 'OUT',
                    onPress: () => {
                      triggerSelectionHaptic();
                      setStatusFilter((prev) => (prev === 'OUT' ? 'all' : 'OUT'));
                    },
                  },
                  {
                    key: 'inside',
                    label: `Inside (${quickCounts.inside})`,
                    active: statusFilter === 'IN',
                    onPress: () => {
                      triggerSelectionHaptic();
                      setStatusFilter((prev) => (prev === 'IN' ? 'all' : 'IN'));
                    },
                  },
                ] as const
              ).map((chip) => (
                <Pressable
                  key={chip.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: chip.active }}
                  style={[
                    styles.quickChip,
                    chip.active && styles.quickChipActive,
                  ]}
                  onPress={chip.onPress}>
                  <Text
                    style={[
                      styles.quickChipText,
                      chip.active && styles.quickChipTextActive,
                    ]}>
                    {chip.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <View style={styles.filterToolbarRow}>
              <View style={styles.filterToolbarLeft}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open resident filters"
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
                        : OwnerTheme.colors.textSecondary
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
                      <Text style={styles.filterCountBadgeText}>{activeFilterCount}</Text>
                    </View>
                  )}
                </Pressable>

                {activeFilterCount > 0 && (
                  <Pressable
                    accessibilityRole="button"
                    hitSlop={8}
                    style={styles.clearAllBtn}
                    onPress={clearFiltersOnly}>
                    <Text style={styles.clearAllText}>Clear all</Text>
                  </Pressable>
                )}
              </View>

              <Text style={styles.countMeta}>
                {filteredResidents.length}{' '}
                {filteredResidents.length === 1 ? 'resident' : 'residents'}
              </Text>
            </View>

            {errorMessage ? (
              <ErrorState
                message={errorMessage}
                onRetry={() => {
                  if (selectedPropertyId) {
                    void directoryQuery.refetch();
                  }
                }}
                style={styles.errorBanner}
              />
            ) : null}
          </View>

          <SectionList
            sections={activeSections}
            keyExtractor={(item) => item.id}
            renderSectionHeader={({ section }) => (
              <View style={styles.roomGroupHeader}>
                <Text style={styles.roomGroupTitle}>Room {section.roomNumber}</Text>
                <Text style={styles.roomGroupCount}>
                  {section.data.length}{' '}
                  {section.data.length === 1 ? 'resident' : 'residents'}
                </Text>
              </View>
            )}
            renderItem={({ item, index, section }) => (
              <ResidentDirectoryRow
                resident={item}
                isFirst={index === 0}
                isLast={index === section.data.length - 1}
                onPress={openResidentProfile}
              />
            )}
            ListEmptyComponent={listEmptyComponent}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            stickySectionHeadersEnabled={false}
            initialNumToRender={15}
            maxToRenderPerBatch={15}
            windowSize={9}
            removeClippedSubviews={Platform.OS === 'android'}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                colors={[OwnerTheme.colors.primary]}
              />
            }
          />
        </View>
      )}

      {/* Unified Filter Bottom Sheet Modal */}
      <Modal
        visible={filterSheetVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setFilterSheetVisible(false)}>
        <View style={styles.sheetOverlay}>
          <Pressable
            accessibilityLabel="Close filters"
            style={styles.sheetBackdrop}
            onPress={() => setFilterSheetVisible(false)}
          />
          <View style={styles.sheetCard}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeaderRow}>
              <Text style={styles.sheetTitle}>Filter Residents</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close filters"
                hitSlop={8}
                onPress={() => setFilterSheetVisible(false)}>
                <X size={20} color={OwnerTheme.colors.textSecondary} />
              </Pressable>
            </View>

            <ScrollView
              style={styles.sheetScroll}
              showsVerticalScrollIndicator={false}>
              {/* Gate Status Filter */}
              <Text style={styles.sheetSectionLabel}>Status</Text>
              <View style={styles.wrappedChipsContainer}>
                {(
                  [
                    { key: 'all', label: 'All' },
                    { key: 'IN', label: 'Inside' },
                    { key: 'OUT', label: 'Outside' },
                  ] as const
                ).map((opt) => {
                  const active = statusFilter === opt.key;
                  return (
                    <Pressable
                      key={opt.key}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      style={[
                        styles.filterChip,
                        active && styles.filterChipActive,
                      ]}
                      onPress={() => {
                        triggerSelectionHaptic();
                        setStatusFilter(opt.key);
                      }}>
                      <Text
                        style={[
                          styles.filterChipText,
                          active && styles.filterChipTextActive,
                        ]}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Dues Filter */}
              <Text style={[styles.sheetSectionLabel, styles.sheetSectionGap]}>
                Dues
              </Text>
              <View style={styles.wrappedChipsContainer}>
                {(
                  [
                    { key: 'all', label: 'All' },
                    { key: 'pending', label: 'Pending' },
                    { key: 'clear', label: 'Clear' },
                  ] as const
                ).map((opt) => {
                  const active = duesFilter === opt.key;
                  return (
                    <Pressable
                      key={opt.key}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      style={[
                        styles.filterChip,
                        active && styles.filterChipActive,
                      ]}
                      onPress={() => {
                        triggerSelectionHaptic();
                        setDuesFilter(opt.key);
                      }}>
                      <Text
                        style={[
                          styles.filterChipText,
                          active && styles.filterChipTextActive,
                        ]}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Gender Filter */}
              <Text style={[styles.sheetSectionLabel, styles.sheetSectionGap]}>
                Gender
              </Text>
              <View style={styles.wrappedChipsContainer}>
                {(
                  [
                    { key: 'all', label: 'All' },
                    { key: 'male', label: 'Male' },
                    { key: 'female', label: 'Female' },
                    { key: 'other', label: 'Other' },
                  ] as const
                ).map((opt) => {
                  const active = genderFilter === opt.key;
                  return (
                    <Pressable
                      key={opt.key}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      style={[
                        styles.filterChip,
                        active && styles.filterChipActive,
                      ]}
                      onPress={() => {
                        triggerSelectionHaptic();
                        setGenderFilter(opt.key);
                      }}>
                      <Text
                        style={[
                          styles.filterChipText,
                          active && styles.filterChipTextActive,
                        ]}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Dynamic Room Filter */}
              <Text style={[styles.sheetSectionLabel, styles.sheetSectionGap]}>
                Room
              </Text>
              <View style={styles.wrappedChipsContainer}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: effectiveRoomFilter === 'all' }}
                  style={[
                    styles.filterChip,
                    effectiveRoomFilter === 'all' && styles.filterChipActive,
                  ]}
                  onPress={() => {
                    triggerSelectionHaptic();
                    setRoomFilter('all');
                  }}>
                  <Text
                    style={[
                      styles.filterChipText,
                      effectiveRoomFilter === 'all' && styles.filterChipTextActive,
                    ]}>
                    All
                  </Text>
                </Pressable>
                {availableRooms.map((roomCode) => {
                  const active = effectiveRoomFilter === roomCode;
                  return (
                    <Pressable
                      key={roomCode}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      style={[
                        styles.filterChip,
                        active && styles.filterChipActive,
                      ]}
                      onPress={() => {
                        triggerSelectionHaptic();
                        setRoomFilter(roomCode);
                      }}>
                      <Text
                        style={[
                          styles.filterChipText,
                          active && styles.filterChipTextActive,
                        ]}>
                        Room {roomCode}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>

            <View style={styles.sheetFooter}>
              <Pressable
                accessibilityRole="button"
                style={styles.sheetResetBtn}
                onPress={clearFiltersOnly}>
                <Text style={styles.sheetResetBtnText}>Clear all</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={styles.sheetApplyBtn}
                onPress={() => setFilterSheetVisible(false)}>
                <Text style={styles.sheetApplyBtnText}>
                  Show {filteredResidents.length}{' '}
                  {filteredResidents.length === 1 ? 'resident' : 'residents'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: OwnerTheme.colors.background,
  },
  headerAddBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: OwnerTheme.radius.full,
    backgroundColor: OwnerTheme.colors.primaryLight,
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  headerAddBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  pressedFade: {
    opacity: 0.78,
  },
  statePad: {
    flex: 1,
    padding: OwnerTheme.spacing.lg,
    justifyContent: 'center',
  },
  scrollContent: {
    paddingHorizontal: OwnerTheme.spacing.lg,
    paddingTop: 2,
    paddingBottom: OwnerTheme.spacing.xxxl,
  },
  searchBarWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: OwnerTheme.colors.surface,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    borderRadius: OwnerTheme.radius.md,
    paddingHorizontal: 12,
    height: 44,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: OwnerTheme.colors.textPrimary,
    paddingVertical: 0,
  },
  quickChipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingRight: 4,
  },
  quickChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: OwnerTheme.radius.full,
    backgroundColor: OwnerTheme.colors.surface,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
  },
  quickChipActive: {
    backgroundColor: OwnerTheme.colors.primary,
    borderColor: OwnerTheme.colors.primary,
  },
  quickChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  quickChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  filterToolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    marginBottom: 14,
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
    backgroundColor: OwnerTheme.colors.surface,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    borderRadius: OwnerTheme.radius.full,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  filtersBtnActive: {
    borderColor: OwnerTheme.colors.primary,
    backgroundColor: OwnerTheme.colors.primaryLight,
  },
  filtersBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  filtersBtnTextActive: {
    color: OwnerTheme.colors.primary,
    fontWeight: '700',
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
  clearAllBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: OwnerTheme.radius.full,
    backgroundColor: '#E2E8F0',
  },
  clearAllText: {
    fontSize: 12,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  countMeta: {
    fontSize: 12,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  errorBanner: {
    marginBottom: 12,
  },
  loadingWrap: {
    marginTop: 28,
  },
  emptyWrap: {
    marginTop: 12,
  },
  groupsContainer: {
    gap: 16,
  },
  roomGroup: {
    gap: 6,
  },
  roomGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginBottom: 6,
  },
  directoryBody: {
    flex: 1,
  },
  toolbarHeaderWrap: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  residentRowSectionItem: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: OwnerTheme.colors.border,
  },
  residentRowFirst: {
    borderTopWidth: 1,
    borderTopLeftRadius: OwnerTheme.radius.card,
    borderTopRightRadius: OwnerTheme.radius.card,
  },
  residentRowLast: {
    borderBottomWidth: 1,
    borderBottomLeftRadius: OwnerTheme.radius.card,
    borderBottomRightRadius: OwnerTheme.radius.card,
    marginBottom: 14,
  },
  roomGroupTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: OwnerTheme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  roomGroupCount: {
    fontSize: 12,
    fontWeight: '500',
    color: OwnerTheme.colors.textMuted,
  },
  roomGroupCard: {
    backgroundColor: OwnerTheme.colors.card,
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    overflow: 'hidden',
    ...OwnerTheme.shadow,
  },
  residentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 10,
    backgroundColor: OwnerTheme.colors.card,
  },
  residentRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: OwnerTheme.colors.borderLight,
  },
  residentRowPressed: {
    backgroundColor: OwnerTheme.colors.surfaceElevated,
  },
  residentMain: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  residentName: {
    fontSize: 15,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  residentMeta: {
    fontSize: 13,
    fontWeight: '500',
    color: OwnerTheme.colors.textSecondary,
  },
  residentRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  badgesCol: {
    alignItems: 'flex-end',
    gap: 4,
  },
  dueText: {
    fontSize: 12,
    fontWeight: '700',
    color: OwnerTheme.colors.danger,
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
    backgroundColor: OwnerTheme.colors.surface,
    borderTopLeftRadius: OwnerTheme.radius.lg,
    borderTopRightRadius: OwnerTheme.radius.lg,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 26,
    maxHeight: '82%',
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
    color: OwnerTheme.colors.textPrimary,
  },
  sheetScroll: {
    maxHeight: 400,
  },
  sheetSectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
    marginBottom: 10,
  },
  sheetSectionGap: {
    marginTop: 18,
  },
  wrappedChipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: OwnerTheme.colors.surfaceElevated,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: OwnerTheme.radius.full,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
  },
  filterChipActive: {
    backgroundColor: OwnerTheme.colors.primary,
    borderColor: OwnerTheme.colors.primary,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
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
    borderTopColor: OwnerTheme.colors.borderLight,
  },
  sheetResetBtn: {
    flex: 1,
    height: 46,
    borderRadius: OwnerTheme.radius.md,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetResetBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  sheetApplyBtn: {
    flex: 2,
    height: 46,
    borderRadius: OwnerTheme.radius.md,
    backgroundColor: OwnerTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetApplyBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
