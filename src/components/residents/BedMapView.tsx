import React, { memo, useCallback, useMemo } from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { BedDouble, Plus, Share2, UserPlus } from 'lucide-react-native';

import { EmptyState, LoadingState } from '@/components/ui/owner';
import { OwnerTheme } from '@/constants/theme';
import { formatPaiseToRupees } from '@/lib/billing-utils';
import { triggerSelectionHaptic } from '@/lib/haptics';
import {
  BedReservation,
  buildBedSlotKey,
} from '@/services/bed-reservations.service';
import {
  ResidentDirectoryItem,
  RoomWithOccupancy,
} from '@/services/residents.service';

export type BedTileStatus = 'free' | 'paid' | 'dues' | 'vacating' | 'reserved';

interface BedTileStyle {
  bg: string;
  border: string;
  dot: string;
  labelColor: string;
  subColor: string;
  badgeText: string;
}

const BED_TILE_STYLES: Record<BedTileStatus, BedTileStyle> = {
  free: {
    bg: '#ECFDF5',
    border: '#86EFAC',
    dot: '#16A34A',
    labelColor: '#14532D',
    subColor: '#15803D',
    badgeText: 'Free',
  },
  paid: {
    bg: '#EFF6FF',
    border: '#93C5FD',
    dot: '#2563EB',
    labelColor: '#1E3A8A',
    subColor: '#1D4ED8',
    badgeText: 'Paid',
  },
  dues: {
    bg: '#FEF2F2',
    border: '#FCA5A5',
    dot: '#DC2626',
    labelColor: '#7F1D1D',
    subColor: '#B91C1C',
    badgeText: 'Dues',
  },
  vacating: {
    bg: '#FFFBEB',
    border: '#FCD34D',
    dot: '#D97706',
    labelColor: '#78350F',
    subColor: '#B45309',
    badgeText: 'Vacating',
  },
  reserved: {
    bg: '#F5F3FF',
    border: '#C4B5FD',
    dot: '#7C3AED',
    labelColor: '#4C1D95',
    subColor: '#6D28D9',
    badgeText: 'Reserved',
  },
};

const SHORT_MONTHS = [
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
];

function formatShortJoinDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso || '').trim());
  if (!m) return iso;
  const monthIdx = Number(m[2]) - 1;
  const day = Number(m[3]);
  const month = SHORT_MONTHS[monthIdx] ?? m[2];
  return `${day} ${month}`;
}

interface ResolvedBedItem {
  bedLabel: string;
  status: BedTileStatus;
  primaryText: string;
  secondaryText: string;
  residentId?: string;
  reservation?: BedReservation;
}

interface ResolvedRoomCard {
  roomNumber: string;
  totalBeds: number;
  occupiedOrReservedCount: number;
  freeCount: number;
  beds: ResolvedBedItem[];
}

interface BedMapViewProps {
  rooms: RoomWithOccupancy[];
  residents: ResidentDirectoryItem[];
  reservations: BedReservation[];
  searchQuery: string;
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onPressFreeBed: (roomNumber: string, bedLabel: string) => void;
  onPressOccupiedBed: (residentId: string) => void;
  onPressReservedBed: (reservation: BedReservation) => void;
  onPressAddResident: () => void;
  onPressShareVacancy?: (summary: {
    freeBedsCount: number;
    vacatingBedsCount: number;
    roomHighlights: string[];
  }) => void;
}

const RoomBedCard = memo(function RoomBedCard({
  room,
  onPressFreeBed,
  onPressOccupiedBed,
  onPressReservedBed,
}: {
  room: ResolvedRoomCard;
  onPressFreeBed: (roomNumber: string, bedLabel: string) => void;
  onPressOccupiedBed: (residentId: string) => void;
  onPressReservedBed: (reservation: BedReservation) => void;
}) {
  return (
    <View style={styles.roomCard}>
      <View style={styles.roomHeader}>
        <View style={styles.roomTitleWrap}>
          <Text style={styles.roomTitle}>Room {room.roomNumber}</Text>
          <Text style={styles.roomMeta}>
            {room.occupiedOrReservedCount}/{room.totalBeds} filled
            {room.freeCount > 0 ? ` · ${room.freeCount} free` : ' · Full'}
          </Text>
        </View>
      </View>

      <View style={styles.bedsGrid}>
        {room.beds.map((bed) => {
          const palette = BED_TILE_STYLES[bed.status];
          return (
            <Pressable
              key={`${room.roomNumber}-${bed.bedLabel}`}
              accessibilityRole="button"
              accessibilityLabel={`Room ${room.roomNumber} ${bed.bedLabel}, ${palette.badgeText}, ${bed.primaryText}`}
              style={({ pressed }) => [
                styles.bedTile,
                {
                  backgroundColor: palette.bg,
                  borderColor: palette.border,
                },
                pressed && styles.bedTilePressed,
              ]}
              onPress={() => {
                triggerSelectionHaptic();
                if (bed.status === 'free') {
                  onPressFreeBed(room.roomNumber, bed.bedLabel);
                } else if (bed.status === 'reserved' && bed.reservation) {
                  onPressReservedBed(bed.reservation);
                } else if (bed.residentId) {
                  onPressOccupiedBed(bed.residentId);
                }
              }}>
              <View style={styles.bedTileTop}>
                <View style={styles.bedLabelRow}>
                  <View
                    style={[styles.statusDot, { backgroundColor: palette.dot }]}
                  />
                  <Text
                    style={[styles.bedLabel, { color: palette.labelColor }]}
                    numberOfLines={1}>
                    {bed.bedLabel}
                  </Text>
                </View>
                {bed.status === 'free' ? (
                  <Plus size={13} color={palette.dot} />
                ) : (
                  <Text
                    style={[styles.bedMiniTag, { color: palette.subColor }]}>
                    {palette.badgeText}
                  </Text>
                )}
              </View>

              <Text
                style={[styles.bedPrimaryText, { color: palette.labelColor }]}
                numberOfLines={1}>
                {bed.primaryText}
              </Text>
              <Text
                style={[styles.bedSecondaryText, { color: palette.subColor }]}
                numberOfLines={1}>
                {bed.secondaryText}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
});

export function BedMapView({
  rooms,
  residents,
  reservations,
  searchQuery,
  loading,
  refreshing,
  onRefresh,
  onPressFreeBed,
  onPressOccupiedBed,
  onPressReservedBed,
  onPressAddResident,
  onPressShareVacancy,
}: BedMapViewProps) {
  const { resolvedRooms, statusCounts } = useMemo(() => {
    const residentById = new Map<string, ResidentDirectoryItem>();
    for (const r of residents) {
      residentById.set(r.id, r);
    }

    const reservationBySlot = new Map<string, BedReservation>();
    for (const res of reservations) {
      if (res.status === 'reserved') {
        reservationBySlot.set(
          buildBedSlotKey(res.room_number, res.bed_label),
          res
        );
      }
    }

    const counts: Record<BedTileStatus, number> = {
      free: 0,
      paid: 0,
      dues: 0,
      vacating: 0,
      reserved: 0,
    };

    const q = searchQuery.trim().toLowerCase();
    const digitsQ = searchQuery.replace(/\D/g, '');

    const mapped: ResolvedRoomCard[] = [];

    for (const room of rooms) {
      const resolvedBeds: ResolvedBedItem[] = room.beds.map((slot) => {
        if (!slot.isFree && slot.occupiedBy) {
          const dirItem = residentById.get(slot.occupiedBy.id);
          const pendingPaise = dirItem?.pendingDuesPaise ?? 0;
          const isVacating = Boolean(
            (dirItem as (ResidentDirectoryItem & { vacatingDate?: string | null }) | undefined)
              ?.vacatingDate
          );

          let status: BedTileStatus = 'paid';
          let secondaryText = 'Paid';

          if (isVacating) {
            status = 'vacating';
            secondaryText = 'Vacating';
          } else if (pendingPaise > 0) {
            status = 'dues';
            secondaryText = `${formatPaiseToRupees(pendingPaise)} due`;
          }

          counts[status] += 1;
          return {
            bedLabel: slot.bedLabel,
            status,
            primaryText: dirItem?.fullName ?? slot.occupiedBy.fullName,
            secondaryText,
            residentId: slot.occupiedBy.id,
          };
        }

        const slotKey = buildBedSlotKey(room.roomNumber, slot.bedLabel);
        const reservation = reservationBySlot.get(slotKey);
        if (reservation) {
          counts.reserved += 1;
          const advPart =
            reservation.token_advance_paise > 0
              ? ` · ${formatPaiseToRupees(reservation.token_advance_paise)}`
              : '';
          return {
            bedLabel: slot.bedLabel,
            status: 'reserved',
            primaryText: reservation.prospect_name,
            secondaryText: `Join ${formatShortJoinDate(reservation.expected_join_date)}${advPart}`,
            reservation,
          };
        }

        counts.free += 1;
        return {
          bedLabel: slot.bedLabel,
          status: 'free',
          primaryText: 'Available',
          secondaryText: 'Add or reserve',
        };
      });

      if (q) {
        const roomMatches = room.roomNumber.toLowerCase().includes(q);
        const matchingBeds = resolvedBeds.filter((b) => {
          if (roomMatches) return true;
          if (b.primaryText.toLowerCase().includes(q)) return true;
          if (b.bedLabel.toLowerCase().includes(q)) return true;
          if (b.reservation && digitsQ && b.reservation.phone_number.replace(/\D/g, '').includes(digitsQ)) {
            return true;
          }
          if (b.residentId) {
            const res = residentById.get(b.residentId);
            if (res?.phoneNumber && digitsQ && res.phoneNumber.replace(/\D/g, '').includes(digitsQ)) {
              return true;
            }
          }
          return false;
        });

        if (matchingBeds.length === 0) continue;

        const freeCount = matchingBeds.filter((b) => b.status === 'free').length;
        mapped.push({
          roomNumber: room.roomNumber,
          totalBeds: room.beds.length,
          occupiedOrReservedCount: room.beds.length - resolvedBeds.filter((b) => b.status === 'free').length,
          freeCount,
          beds: matchingBeds,
        });
      } else {
        const freeCount = resolvedBeds.filter((b) => b.status === 'free').length;
        mapped.push({
          roomNumber: room.roomNumber,
          totalBeds: resolvedBeds.length,
          occupiedOrReservedCount: resolvedBeds.length - freeCount,
          freeCount,
          beds: resolvedBeds,
        });
      }
    }

    return { resolvedRooms: mapped, statusCounts: counts };
  }, [rooms, residents, reservations, searchQuery]);

  const renderRoomCard = useCallback(
    ({ item }: { item: ResolvedRoomCard }) => (
      <RoomBedCard
        room={item}
        onPressFreeBed={onPressFreeBed}
        onPressOccupiedBed={onPressOccupiedBed}
        onPressReservedBed={onPressReservedBed}
      />
    ),
    [onPressFreeBed, onPressOccupiedBed, onPressReservedBed]
  );

  const keyExtractor = useCallback((item: ResolvedRoomCard) => item.roomNumber, []);

  const vacancyRoomHighlights = useMemo(() => {
    return resolvedRooms
      .filter((r) => r.freeCount > 0)
      .map((r) => `Room ${r.roomNumber} (${r.freeCount} free)`);
  }, [resolvedRooms]);

  const hasVacancy = statusCounts.free + statusCounts.vacating > 0;

  const listHeader = useMemo(
    () => (
      <View style={styles.headerStack}>
        <View style={styles.legendRow}>
          {(
            [
              { key: 'free', label: `Free (${statusCounts.free})` },
              { key: 'paid', label: `Paid (${statusCounts.paid})` },
              { key: 'dues', label: `Dues (${statusCounts.dues})` },
              { key: 'vacating', label: `Vacating (${statusCounts.vacating})` },
              { key: 'reserved', label: `Reserved (${statusCounts.reserved})` },
            ] as { key: BedTileStatus; label: string }[]
          ).map((item) => {
            const p = BED_TILE_STYLES[item.key];
            return (
              <View key={item.key} style={styles.legendChip}>
                <View style={[styles.legendDot, { backgroundColor: p.dot }]} />
                <Text style={styles.legendText}>{item.label}</Text>
              </View>
            );
          })}
        </View>

        {hasVacancy && onPressShareVacancy && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Share available beds on WhatsApp"
            style={({ pressed }) => [
              styles.shareVacancyPill,
              pressed && { opacity: 0.8 },
            ]}
            onPress={() => {
              triggerSelectionHaptic();
              onPressShareVacancy({
                freeBedsCount: statusCounts.free,
                vacatingBedsCount: statusCounts.vacating,
                roomHighlights: vacancyRoomHighlights,
              });
            }}>
            <Share2 size={13} color="#15803D" />
            <Text style={styles.shareVacancyText}>
              Share Vacancy ({statusCounts.free} free
              {statusCounts.vacating > 0
                ? ` · ${statusCounts.vacating} vacating`
                : ''}
              )
            </Text>
          </Pressable>
        )}
      </View>
    ),
    [statusCounts, hasVacancy, onPressShareVacancy, vacancyRoomHighlights]
  );

  const listEmpty = useMemo(() => {
    if (loading && rooms.length === 0) {
      return <LoadingState message="Loading bed map..." style={styles.stateWrap} />;
    }
    if (rooms.length === 0) {
      return (
        <EmptyState
          icon={BedDouble}
          title="No rooms set up yet"
          description="Add your first resident and room to build your visual bed map."
          actionLabel="Add Resident & Room"
          onAction={onPressAddResident}
          style={styles.stateWrap}
        />
      );
    }
    return (
      <EmptyState
        icon={UserPlus}
        title="No matching rooms or beds"
        description="Try a different name, room number, or phone."
        style={styles.stateWrap}
      />
    );
  }, [loading, rooms.length, onPressAddResident]);

  return (
    <FlatList
      data={loading && rooms.length === 0 ? [] : resolvedRooms}
      keyExtractor={keyExtractor}
      renderItem={renderRoomCard}
      ListHeaderComponent={rooms.length > 0 ? listHeader : undefined}
      ListEmptyComponent={listEmpty}
      contentContainerStyle={styles.listContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      initialNumToRender={10}
      maxToRenderPerBatch={10}
      windowSize={7}
      removeClippedSubviews={Platform.OS === 'android'}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          colors={[OwnerTheme.colors.primary]}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  listContent: {
    paddingHorizontal: OwnerTheme.spacing.lg,
    paddingTop: 4,
    paddingBottom: 96,
  },
  headerStack: {
    marginBottom: 12,
    gap: 8,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  shareVacancyPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#86EFAC',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  shareVacancyText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#15803D',
  },
  legendChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: OwnerTheme.colors.surface,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.borderLight,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  legendDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 11,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  roomCard: {
    backgroundColor: OwnerTheme.colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.borderLight,
    padding: 14,
    marginBottom: 12,
  },
  roomHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  roomTitleWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  roomTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: OwnerTheme.colors.textPrimary,
  },
  roomMeta: {
    fontSize: 12,
    fontWeight: '600',
    color: OwnerTheme.colors.textMuted,
  },
  bedsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  bedTile: {
    width: '48.5%',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  bedTilePressed: {
    opacity: 0.78,
    transform: [{ scale: 0.985 }],
  },
  bedTileTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  bedLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexShrink: 1,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  bedLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  bedMiniTag: {
    fontSize: 10,
    fontWeight: '700',
  },
  bedPrimaryText: {
    fontSize: 13,
    fontWeight: '700',
  },
  bedSecondaryText: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  stateWrap: {
    marginTop: 32,
  },
});
