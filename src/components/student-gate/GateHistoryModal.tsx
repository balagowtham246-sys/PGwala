import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LogIn, LogOut, X } from 'lucide-react-native';

import { EmptyState, OwnerSharedStyles, StatusBadge } from '@/components/ui/owner';
import { OwnerTheme } from '@/constants/theme';
import { groupLogsByLocalDay } from '@/lib/movement-utils';

export interface GateHistoryLogItem {
  id: string;
  resident_id: string;
  direction: 'IN' | 'OUT';
  event_time: string;
  purpose?: string | null;
  expected_return_time?: string | null;
  food_required?: boolean;
}

export interface GateHistoryResidentLookup {
  full_name: string;
  room_number: string;
}

function formatEventTime(isoString: string): string {
  try {
    return new Date(isoString).toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return isoString;
  }
}

function formatEventDate(isoString: string): string {
  try {
    return new Date(isoString).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
    });
  } catch {
    return '';
  }
}

export function GateHistoryModal<T extends GateHistoryLogItem>({
  visible,
  historyDirectionFilter,
  historyDateFilter,
  filteredHistoryLogs,
  residentMap,
  onSelectDirection,
  onSelectTimeframe,
  onClose,
}: {
  visible: boolean;
  historyDirectionFilter: 'ALL' | 'IN' | 'OUT';
  historyDateFilter: 'ALL' | 'TODAY' | 'WEEK';
  filteredHistoryLogs: T[];
  residentMap: Map<string, GateHistoryResidentLookup>;
  onSelectDirection: (dir: 'ALL' | 'IN' | 'OUT') => void;
  onSelectTimeframe: (tf: 'ALL' | 'TODAY' | 'WEEK') => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.fullModalSafe}>
        <View style={styles.modalHeaderRow}>
          <Text style={styles.modalTitle}>Gate Event History</Text>
          <Pressable hitSlop={8} onPress={onClose} style={styles.modalCloseBtn}>
            <X size={20} color={OwnerTheme.colors.textPrimary} />
          </Pressable>
        </View>

        <View style={styles.modalFiltersBox}>
          <View style={styles.modalFilterRow}>
            <Text style={styles.filterGroupLabel}>Direction:</Text>
            {(['ALL', 'IN', 'OUT'] as const).map((dir) => (
              <Pressable
                key={dir}
                style={[
                  OwnerSharedStyles.pillChip,
                  styles.compactPill,
                  historyDirectionFilter === dir && OwnerSharedStyles.pillChipActive,
                ]}
                onPress={() => onSelectDirection(dir)}>
                <Text
                  style={[
                    OwnerSharedStyles.pillText,
                    styles.compactPillText,
                    historyDirectionFilter === dir && OwnerSharedStyles.pillTextActive,
                  ]}>
                  {dir === 'ALL'
                    ? 'All'
                    : dir === 'IN'
                      ? 'Checked in'
                      : 'Checked out'}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.modalFilterRow}>
            <Text style={styles.filterGroupLabel}>Timeframe:</Text>
            {(['ALL', 'TODAY', 'WEEK'] as const).map((timeOpt) => (
              <Pressable
                key={timeOpt}
                style={[
                  OwnerSharedStyles.pillChip,
                  styles.compactPill,
                  historyDateFilter === timeOpt && OwnerSharedStyles.pillChipActive,
                ]}
                onPress={() => onSelectTimeframe(timeOpt)}>
                <Text
                  style={[
                    OwnerSharedStyles.pillText,
                    styles.compactPillText,
                    historyDateFilter === timeOpt && OwnerSharedStyles.pillTextActive,
                  ]}>
                  {timeOpt === 'ALL'
                    ? 'All'
                    : timeOpt === 'TODAY'
                      ? 'Today'
                      : 'Past 7 Days'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.historyModalScroll}
          showsVerticalScrollIndicator={false}>
          {filteredHistoryLogs.length === 0 ? (
            <EmptyState
              title="No events match this filter"
              description="Try clearing filters to view more gate logs."
            />
          ) : (
            groupLogsByLocalDay(filteredHistoryLogs).map((group) => (
              <View key={group.dateKey}>
                <Text style={styles.modalHistoryDayLabel}>{group.dateTitle}</Text>
                {group.items.map((item) => {
                  const resident = residentMap.get(item.resident_id);
                  const isEntry = item.direction === 'IN';
                  return (
                    <View key={item.id} style={styles.modalHistoryCard}>
                      <View style={styles.modalHistoryHeader}>
                        <View
                          style={[
                            styles.historyItemIcon,
                            {
                              backgroundColor: isEntry
                                ? OwnerTheme.colors.successLight
                                : OwnerTheme.colors.warningLight,
                            },
                          ]}>
                          {isEntry ? (
                            <LogIn size={14} color={OwnerTheme.colors.success} />
                          ) : (
                            <LogOut size={14} color={OwnerTheme.colors.warning} />
                          )}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.modalHistName}>
                            {resident ? resident.full_name : 'Resident'}
                          </Text>
                          <Text style={styles.modalHistRoom}>
                            Room {resident?.room_number || '-'}
                          </Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <StatusBadge
                            label={isEntry ? 'Checked in' : 'Checked out'}
                            variant={isEntry ? 'success' : 'warning'}
                            size="sm"
                          />
                          <Text style={styles.modalHistTime}>
                            {formatEventDate(item.event_time)} •{' '}
                            {formatEventTime(item.event_time)}
                          </Text>
                        </View>
                      </View>

                      {item.purpose ? (
                        <View style={styles.modalDetailSubRow}>
                          <Text style={styles.modalDetailSubLabel}>Purpose: </Text>
                          <Text style={styles.modalDetailSubVal}>
                            {item.purpose}
                          </Text>
                        </View>
                      ) : null}

                      {item.expected_return_time ? (
                        <View style={styles.modalDetailSubRow}>
                          <Text style={styles.modalDetailSubLabel}>
                            Expected return:{' '}
                          </Text>
                          <Text style={styles.modalDetailSubVal}>
                            {item.expected_return_time}
                          </Text>
                        </View>
                      ) : null}

                      {!isEntry && (
                        <View style={styles.modalDetailSubRow}>
                          <Text style={styles.modalDetailSubLabel}>Dinner: </Text>
                          <Text
                            style={[
                              styles.modalDetailSubVal,
                              item.food_required
                                ? { color: OwnerTheme.colors.success }
                                : { color: OwnerTheme.colors.textMuted },
                            ]}>
                            {item.food_required ? 'Required' : 'Not required'}
                          </Text>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fullModalSafe: {
    flex: 1,
    backgroundColor: OwnerTheme.colors.background,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: OwnerTheme.colors.border,
    backgroundColor: '#FFFFFF',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  modalCloseBtn: {
    padding: 6,
  },
  modalFiltersBox: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: OwnerTheme.colors.border,
    gap: 8,
  },
  modalFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterGroupLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
    minWidth: 70,
  },
  compactPill: {
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  compactPillText: {
    fontSize: 12,
    fontWeight: '500',
  },
  historyModalScroll: {
    padding: 16,
    gap: 10,
  },
  modalHistoryDayLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: OwnerTheme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 8,
    marginBottom: 6,
  },
  modalHistoryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.md,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 12,
  },
  modalHistoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  historyItemIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  modalHistName: {
    fontSize: 14,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  modalHistRoom: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
  },
  modalHistTime: {
    fontSize: 11,
    color: OwnerTheme.colors.textMuted,
    marginTop: 2,
  },
  modalDetailSubRow: {
    flexDirection: 'row',
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: OwnerTheme.colors.borderLight,
  },
  modalDetailSubLabel: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
  },
  modalDetailSubVal: {
    fontSize: 12,
    fontWeight: '500',
    color: OwnerTheme.colors.textPrimary,
  },
});
