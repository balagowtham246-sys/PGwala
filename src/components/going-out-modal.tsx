import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  AlertTriangle,
  Calendar,
  Clock,
  Home,
  Utensils,
} from 'lucide-react-native';

import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { CalendarDatePickerModal } from '@/components/ui/calendar-date-picker-modal';
import { OwnerTheme } from '@/constants/theme';
import { useModalBackHandler } from '@/hooks/use-modal-back-handler';
import { triggerSelectionHaptic } from '@/lib/haptics';
import { formatShortReturnDate } from '@/lib/movement-utils';
import {
  addDaysToIsoDate,
  formatHhMmTo12h,
  formatIsoDateDisplay,
  formatLocalIsoDate,
  isReturnAfterCurfew,
  isValidIsoDate,
} from '@/lib/ux-utils';

const DAY_PURPOSE_OPTIONS = ['College', 'Outing', 'Home', 'Other'];
const LEAVE_PURPOSE_OPTIONS = [
  'Home Visit',
  'Semester Break',
  'Festival / Holiday',
  'Other',
];
const RETURN_TIME_OPTIONS = [
  'Evening (~8:00 pm)',
  'Night (~10:00 pm)',
  'Late Night (~11:30 pm)',
  'Tomorrow morning',
  'Custom',
];

export interface GoingOutSubmitPayload {
  purpose: string;
  expectedReturnTime: string;
  expectedReturnDate?: string | null;
  foodRequired: boolean;
  note?: string;
}

interface GoingOutModalProps {
  visible: boolean;
  saving?: boolean;
  curfewTime?: string | null;
  mode?: 'create' | 'update_leave';
  initialReturnDate?: string | null;
  initialPurpose?: string | null;
  onClose: () => void;
  onConfirm: (payload: GoingOutSubmitPayload) => Promise<void> | void;
}

function getSmartDefaultReturnTime(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour >= 22 || hour < 5) return 'Tomorrow morning';
  if (hour >= 20) return 'Late Night (~11:30 pm)';
  if (hour >= 18) return 'Night (~10:00 pm)';
  return 'Evening (~8:00 pm)';
}

function getNextMondayIso(now: Date = new Date()): string {
  const todayIso = formatLocalIsoDate(now);
  const day = now.getDay(); // 0 = Sun, 1 = Mon, ...
  const daysUntilMon = day === 1 ? 7 : (8 - day) % 7;
  return addDaysToIsoDate(todayIso, daysUntilMon);
}

/**
 * Shared Going Out / Multi-Day Home Leave bottom sheet used by Student Home and Gate tabs.
 */
export function GoingOutModal({
  visible,
  saving = false,
  curfewTime = null,
  mode = 'create',
  initialReturnDate = null,
  initialPurpose = null,
  onClose,
  onConfirm,
}: GoingOutModalProps) {
  const isUpdateMode = mode === 'update_leave';
  const [selectedTab, setSelectedTab] = useState<'day' | 'leave'>('day');
  const activeTab: 'day' | 'leave' = isUpdateMode ? 'leave' : selectedTab;

  const [dayPurpose, setDayPurpose] = useState('College');
  const [leavePurposeOverride, setLeavePurposeOverride] = useState<string | null>(null);
  const [customPurpose, setCustomPurpose] = useState('');
  const [selectedReturnTime, setSelectedReturnTime] = useState<string | null>(null);
  const [customReturnTime, setCustomReturnTime] = useState('');
  const [foodRequired, setFoodRequired] = useState(true);

  const defaultLeaveDate = useMemo(() => {
    const todayIso = formatLocalIsoDate();
    if (initialReturnDate && isValidIsoDate(initialReturnDate)) {
      return initialReturnDate;
    }
    return addDaysToIsoDate(todayIso, 2);
  }, [initialReturnDate]);

  const [leaveDateOverride, setLeaveDateOverride] = useState<string | null>(null);
  const [datePickerVisible, setDatePickerVisible] = useState(false);

  const leaveReturnDate = leaveDateOverride ?? defaultLeaveDate;
  const leavePurpose =
    leavePurposeOverride ??
    (initialPurpose && LEAVE_PURPOSE_OPTIONS.includes(initialPurpose)
      ? initialPurpose
      : 'Home Visit');

  const returnTime = selectedReturnTime ?? getSmartDefaultReturnTime();

  const quickLeaveDates = useMemo(() => {
    const todayIso = formatLocalIsoDate();
    const tomorrowIso = addDaysToIsoDate(todayIso, 1);
    const nextMonIso = getNextMondayIso();
    const weekIso = addDaysToIsoDate(todayIso, 7);
    return [
      { label: 'Tomorrow', iso: tomorrowIso },
      { label: 'Next Mon', iso: nextMonIso },
      { label: '+7 Days', iso: weekIso },
    ];
  }, []);

  const handleClose = () => {
    setSelectedReturnTime(null);
    setSelectedTab('day');
    setLeaveDateOverride(null);
    setLeavePurposeOverride(null);
    setDatePickerVisible(false);
    onClose();
  };

  const effectiveReturn =
    returnTime === 'Custom' ? customReturnTime.trim() : returnTime;
  const formattedCurfew = curfewTime ? formatHhMmTo12h(curfewTime) : '';
  const showCurfewWarning =
    activeTab === 'day' &&
    Boolean(curfewTime && formattedCurfew) &&
    isReturnAfterCurfew(effectiveReturn, curfewTime);

  useModalBackHandler(visible && !datePickerVisible, handleClose, saving);

  const handleConfirmPress = () => {
    if (activeTab === 'leave') {
      const finalPurpose =
        leavePurpose === 'Other'
          ? customPurpose.trim() || 'Home Visit'
          : leavePurpose;
      const safeDate = isValidIsoDate(leaveReturnDate)
        ? leaveReturnDate
        : addDaysToIsoDate(formatLocalIsoDate(), 2);
      setLeaveDateOverride(null);
      setLeavePurposeOverride(null);
      setSelectedTab('day');
      void onConfirm({
        purpose: finalPurpose,
        expectedReturnTime: `Returns ${formatShortReturnDate(safeDate)}`,
        expectedReturnDate: safeDate,
        foodRequired: false,
        note: isUpdateMode ? 'Updated return date' : undefined,
      });
      return;
    }

    const finalPurpose =
      dayPurpose === 'Other'
        ? customPurpose.trim() || 'Personal / Other'
        : dayPurpose;
    const finalReturn =
      returnTime === 'Custom' ? customReturnTime.trim() || 'Later' : returnTime;
    setSelectedReturnTime(null);
    void onConfirm({
      purpose: finalPurpose,
      expectedReturnTime: finalReturn,
      expectedReturnDate: null,
      foodRequired,
    });
  };

  const modalTitle = isUpdateMode
    ? 'Update Return Date'
    : activeTab === 'leave'
      ? 'Home Visit / Leave'
      : 'Going Out of PG';
  const modalSubtitle = isUpdateMode
    ? 'Update when you expect to return to the PG'
    : activeTab === 'leave'
      ? 'Meals & daily meal alerts pause until you check back in'
      : 'Share your return estimate and dinner plan';

  return (
    <>
      <BottomSheetModal
        visible={visible}
        onClose={handleClose}
        title={modalTitle}
        subtitle={modalSubtitle}
        disabled={saving}
        maxHeight="88%">
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scrollBody}>
          {!isUpdateMode && (
            <View style={styles.modeToggleRow}>
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: activeTab === 'day' }}
                style={[
                  styles.modeToggleBtn,
                  activeTab === 'day' && styles.modeToggleBtnActive,
                ]}
                onPress={() => {
                  triggerSelectionHaptic();
                  setSelectedTab('day');
                }}>
                <Clock
                  size={14}
                  color={
                    activeTab === 'day'
                      ? '#FFFFFF'
                      : OwnerTheme.colors.textSecondary
                  }
                />
                <Text
                  style={[
                    styles.modeToggleText,
                    activeTab === 'day' && styles.modeToggleTextActive,
                  ]}>
                  Day Outing
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: activeTab === 'leave' }}
                style={[
                  styles.modeToggleBtn,
                  activeTab === 'leave' && styles.modeToggleBtnLeaveActive,
                ]}
                onPress={() => {
                  triggerSelectionHaptic();
                  setSelectedTab('leave');
                }}>
                <Home
                  size={14}
                  color={
                    activeTab === 'leave'
                      ? '#FFFFFF'
                      : OwnerTheme.colors.textSecondary
                  }
                />
                <Text
                  style={[
                    styles.modeToggleText,
                    activeTab === 'leave' && styles.modeToggleTextActive,
                  ]}>
                  Home / Leave
                </Text>
              </Pressable>
            </View>
          )}

          {activeTab === 'day' ? (
            <>
              <Text style={styles.sectionLabel}>Purpose</Text>
              <View style={styles.chipWrap}>
                {DAY_PURPOSE_OPTIONS.map((opt) => {
                  const selected = dayPurpose === opt;
                  return (
                    <Pressable
                      key={opt}
                      style={[styles.chip, selected && styles.chipSelected]}
                      onPress={() => {
                        triggerSelectionHaptic();
                        setDayPurpose(opt);
                      }}>
                      <Text
                        style={[
                          styles.chipText,
                          selected && styles.chipTextSelected,
                        ]}>
                        {opt}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {dayPurpose === 'Other' && (
                <TextInput
                  style={styles.input}
                  placeholder="Specify purpose (e.g., Doctor visit)"
                  placeholderTextColor={OwnerTheme.colors.textMuted}
                  value={customPurpose}
                  onChangeText={setCustomPurpose}
                  maxLength={60}
                />
              )}

              <View style={styles.labelRow}>
                <Clock size={14} color={OwnerTheme.colors.textSecondary} />
                <Text style={styles.sectionLabel}>Expected Return</Text>
              </View>
              <View style={styles.chipWrap}>
                {RETURN_TIME_OPTIONS.map((opt) => {
                  const selected = returnTime === opt;
                  return (
                    <Pressable
                      key={opt}
                      style={[styles.chip, selected && styles.chipSelected]}
                      onPress={() => {
                        triggerSelectionHaptic();
                        setSelectedReturnTime(opt);
                      }}>
                      <Text
                        style={[
                          styles.chipText,
                          selected && styles.chipTextSelected,
                        ]}>
                        {opt}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {returnTime === 'Custom' && (
                <TextInput
                  style={styles.input}
                  placeholder="e.g., Around 9:15 pm"
                  placeholderTextColor={OwnerTheme.colors.textMuted}
                  value={customReturnTime}
                  onChangeText={setCustomReturnTime}
                  maxLength={40}
                />
              )}

              {showCurfewWarning && (
                <View style={styles.curfewBanner}>
                  <AlertTriangle size={16} color="#B45309" />
                  <Text style={styles.curfewBannerText}>
                    Expected return is past PG curfew ({formattedCurfew}).
                  </Text>
                </View>
              )}

              <View style={styles.dinnerCard}>
                <View style={styles.dinnerIconWrap}>
                  <Utensils size={18} color={OwnerTheme.colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.dinnerTitle}>Need dinner tonight?</Text>
                  <Text style={styles.dinnerSub}>
                    Helps the kitchen avoid food waste
                  </Text>
                </View>
                <Switch
                  value={foodRequired}
                  onValueChange={setFoodRequired}
                  trackColor={{
                    false: '#E2E8F0',
                    true: OwnerTheme.colors.primary,
                  }}
                  thumbColor="#FFFFFF"
                />
              </View>
            </>
          ) : (
            <>
              <Text style={styles.sectionLabel}>Reason</Text>
              <View style={styles.chipWrap}>
                {LEAVE_PURPOSE_OPTIONS.map((opt) => {
                  const selected = leavePurpose === opt;
                  return (
                    <Pressable
                      key={opt}
                      style={[
                        styles.chip,
                        selected && styles.chipLeaveSelected,
                      ]}
                      onPress={() => {
                        triggerSelectionHaptic();
                        setLeavePurposeOverride(opt);
                      }}>
                      <Text
                        style={[
                          styles.chipText,
                          selected && styles.chipTextSelected,
                        ]}>
                        {opt}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {leavePurpose === 'Other' && (
                <TextInput
                  style={styles.input}
                  placeholder="Specify reason (e.g., Industrial visit)"
                  placeholderTextColor={OwnerTheme.colors.textMuted}
                  value={customPurpose}
                  onChangeText={setCustomPurpose}
                  maxLength={60}
                />
              )}

              <View style={styles.labelRow}>
                <Calendar size={14} color={OwnerTheme.colors.textSecondary} />
                <Text style={styles.sectionLabel}>Expected Return Date</Text>
              </View>

              <View style={styles.chipWrap}>
                {quickLeaveDates.map((item) => {
                  const selected = leaveReturnDate === item.iso;
                  return (
                    <Pressable
                      key={item.label}
                      style={[
                        styles.chip,
                        selected && styles.chipLeaveSelected,
                      ]}
                      onPress={() => {
                        triggerSelectionHaptic();
                        setLeaveDateOverride(item.iso);
                      }}>
                      <Text
                        style={[
                          styles.chipText,
                          selected && styles.chipTextSelected,
                        ]}>
                        {item.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Pick expected return date"
                style={styles.datePickerTrigger}
                onPress={() => {
                  triggerSelectionHaptic();
                  setDatePickerVisible(true);
                }}>
                <Calendar size={16} color="#6D28D9" />
                <Text style={styles.datePickerText}>
                  {formatIsoDateDisplay(leaveReturnDate)}
                </Text>
                <Text style={styles.datePickerChange}>Change</Text>
              </Pressable>

              <View style={styles.leaveInfoCard}>
                <View style={styles.leaveInfoIconWrap}>
                  <Utensils size={16} color="#6D28D9" />
                </View>
                <Text style={styles.leaveInfoText}>
                  Meals, dinner headcount & daily meal alerts pause automatically
                  until you mark Inside PG.
                </Text>
              </View>
            </>
          )}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            style={styles.cancelBtn}
            onPress={handleClose}
            disabled={saving}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
          <Pressable
            style={[
              styles.confirmBtn,
              activeTab === 'leave' && styles.confirmBtnLeave,
              saving && { opacity: 0.65 },
            ]}
            onPress={handleConfirmPress}
            disabled={saving}>
            {saving ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.confirmText}>
                {isUpdateMode
                  ? 'Save Return Date'
                  : activeTab === 'leave'
                    ? 'Mark On Leave'
                    : 'Going Out'}
              </Text>
            )}
          </Pressable>
        </View>
      </BottomSheetModal>

      <CalendarDatePickerModal
        visible={datePickerVisible}
        value={leaveReturnDate}
        title="Expected Return Date"
        onSelect={(iso) => {
          setLeaveDateOverride(iso);
          setDatePickerVisible(false);
        }}
        onClose={() => setDatePickerVisible(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  modeToggleRow: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 14,
    padding: 4,
    gap: 4,
    marginBottom: 4,
  },
  modeToggleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 11,
  },
  modeToggleBtnActive: {
    backgroundColor: OwnerTheme.colors.primary,
  },
  modeToggleBtnLeaveActive: {
    backgroundColor: '#6D28D9',
  },
  modeToggleText: {
    fontSize: 13,
    fontWeight: '700',
    color: OwnerTheme.colors.textSecondary,
  },
  modeToggleTextActive: {
    color: '#FFFFFF',
  },
  scrollBody: {
    gap: 12,
    paddingBottom: 8,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  chipSelected: {
    backgroundColor: OwnerTheme.colors.primary,
    borderColor: OwnerTheme.colors.primary,
  },
  chipLeaveSelected: {
    backgroundColor: '#6D28D9',
    borderColor: '#6D28D9',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  chipTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  input: {
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    paddingHorizontal: 14,
    fontSize: 14,
    color: OwnerTheme.colors.textPrimary,
    backgroundColor: '#F8FAFC',
  },
  curfewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FCD34D',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  curfewBannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: '#92400E',
    lineHeight: 17,
  },
  datePickerTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DDD6FE',
    backgroundColor: '#FAF5FF',
    paddingHorizontal: 14,
  },
  datePickerText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  datePickerChange: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6D28D9',
  },
  leaveInfoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F5F3FF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#DDD6FE',
    padding: 12,
  },
  leaveInfoIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#EDE9FE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaveInfoText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: '#4C1D95',
    lineHeight: 17,
  },
  dinnerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    marginTop: 4,
  },
  dinnerIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: OwnerTheme.colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dinnerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  dinnerSub: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 1,
  },
  footer: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  cancelBtn: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  cancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  confirmBtn: {
    flex: 2,
    height: 48,
    borderRadius: 14,
    backgroundColor: OwnerTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnLeave: {
    backgroundColor: '#6D28D9',
  },
  confirmText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
