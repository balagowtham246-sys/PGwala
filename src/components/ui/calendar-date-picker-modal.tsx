import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ChevronLeft, ChevronRight, X } from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';

interface CalendarDatePickerModalProps {
  visible: boolean;
  value: string; // 'YYYY-MM-DD'
  title?: string;
  onSelect: (isoDate: string) => void;
  onClose: () => void;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function parseIsoParts(iso: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso || '').trim());
  if (match) {
    const y = Number(match[1]);
    const m = Number(match[2]) - 1;
    const d = Number(match[3]);
    if (m >= 0 && m <= 11 && d >= 1 && d <= 31) {
      return { year: y, month: m, day: d };
    }
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
}

function toIsoString(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function CalendarDatePickerModal({
  visible,
  value,
  title = 'Select Date',
  onSelect,
  onClose,
}: CalendarDatePickerModalProps) {
  const initial = useMemo(() => parseIsoParts(value), [value]);
  const [viewYear, setViewYear] = useState(initial.year);
  const [viewMonth, setViewMonth] = useState(initial.month);

  const today = new Date();
  const todayIso = toIsoString(today.getFullYear(), today.getMonth(), today.getDate());

  const handleOpenSync = () => {
    const parsed = parseIsoParts(value);
    setViewYear(parsed.year);
    setViewMonth(parsed.month);
  };

  const goPrevMonth = () => {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const goNextMonth = () => {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const cells = useMemo(() => {
    const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const grid: ({ day: number; iso: string } | null)[] = [];

    for (let i = 0; i < firstDayOfWeek; i++) {
      grid.push(null);
    }
    for (let d = 1; d <= daysInMonth; d++) {
      grid.push({ day: d, iso: toIsoString(viewYear, viewMonth, d) });
    }
    while (grid.length % 7 !== 0) {
      grid.push(null);
    }
    return grid;
  }, [viewYear, viewMonth]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onShow={handleOpenSync}
      onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable
          accessibilityLabel="Close calendar"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />

        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>{title}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close date picker"
              hitSlop={10}
              onPress={onClose}
              style={styles.closeBtn}>
              <X size={18} color={OwnerTheme.colors.textSecondary} />
            </Pressable>
          </View>

          <View style={styles.monthBar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous month"
              onPress={goPrevMonth}
              style={styles.navBtn}>
              <ChevronLeft size={18} color={OwnerTheme.colors.textPrimary} />
            </Pressable>

            <Text style={styles.monthTitle}>
              {MONTH_NAMES[viewMonth]} {viewYear}
            </Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next month"
              onPress={goNextMonth}
              style={styles.navBtn}>
              <ChevronRight size={18} color={OwnerTheme.colors.textPrimary} />
            </Pressable>
          </View>

          <View style={styles.weekdayRow}>
            {WEEKDAYS.map((wd) => (
              <Text key={wd} style={styles.weekdayLabel}>
                {wd}
              </Text>
            ))}
          </View>

          <View style={styles.grid}>
            {cells.map((cell, idx) => {
              if (!cell) {
                return <View key={`blank-${idx}`} style={styles.dayCell} />;
              }
              const isSelected = cell.iso === value;
              const isToday = cell.iso === todayIso;
              return (
                <Pressable
                  key={cell.iso}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  style={[
                    styles.dayCell,
                    isToday && !isSelected && styles.dayCellToday,
                    isSelected && styles.dayCellSelected,
                  ]}
                  onPress={() => {
                    onSelect(cell.iso);
                    onClose();
                  }}>
                  <Text
                    style={[
                      styles.dayText,
                      isToday && !isSelected && styles.dayTextToday,
                      isSelected && styles.dayTextSelected,
                    ]}>
                    {cell.day}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.footerRow}>
            <Pressable
              accessibilityRole="button"
              style={styles.todayBtn}
              onPress={() => {
                onSelect(todayIso);
                onClose();
              }}>
              <Text style={styles.todayBtnText}>Select Today</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.lg,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  navBtn: {
    width: 34,
    height: 34,
    borderRadius: OwnerTheme.radius.sm,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
  },
  monthTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  weekdayRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  weekdayLabel: {
    width: '14.285%',
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '700',
    color: OwnerTheme.colors.textMuted,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: '14.285%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  dayCellToday: {
    borderWidth: 1,
    borderColor: OwnerTheme.colors.primary,
  },
  dayCellSelected: {
    backgroundColor: OwnerTheme.colors.primary,
  },
  dayText: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  dayTextToday: {
    color: OwnerTheme.colors.primary,
    fontWeight: '700',
  },
  dayTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  footerRow: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: OwnerTheme.colors.borderLight,
    paddingTop: 10,
    alignItems: 'flex-end',
  },
  todayBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: OwnerTheme.radius.sm,
    backgroundColor: OwnerTheme.colors.primaryLight,
  },
  todayBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
});
