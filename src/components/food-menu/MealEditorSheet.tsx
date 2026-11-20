import React, { ComponentRef, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronRight, Clock, X } from 'lucide-react-native';

import {
  HIGH_CONTRAST_SWITCH_COLORS,
  SWITCH_THUMB_COLOR,
} from '@/components/ui/owner';
import { OwnerTheme } from '@/constants/theme';
import { triggerSelectionHaptic } from '@/lib/haptics';
import {
  formatHhMmTo12h,
  normalizeDishName,
  parseDishList,
  serializeDishList,
} from '@/lib/ux-utils';
import {
  addCustomDish,
  fetchActiveResidentCount,
  FoodMenuRecord,
  getCustomDishes,
  MEAL_CHIP_SUGGESTIONS,
  MEAL_CONFIG,
  MealType,
  removeCustomDish,
} from '@/services/food-menu.service';

export interface MealEditorSavePayload {
  items: string;
  notes: string | null;
  isPublished: boolean;
  mealTime: string | null;
}

const MEAL_TIME_PRESETS: Record<MealType, string[]> = {
  breakfast: ['07:30', '08:00', '08:30'],
  lunch: ['12:30', '13:00', '13:30'],
  dinner: ['19:30', '20:00', '20:30'],
};

const HH_MM_24H_REGEX = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function normalizeHhMm24(raw: string | null | undefined): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  const match = HH_MM_24H_REGEX.exec(trimmed);
  if (!match) return null;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

export interface MealEditorSheetProps {
  visible: boolean;
  mealType: MealType | null;
  propertyId?: string;
  dateLabel: string;
  existingMenu: FoodMenuRecord | null;
  saving: boolean;
  onClose: () => void;
  onSave: (payload: MealEditorSavePayload) => Promise<void> | void;
}

function appendUniqueDishes(existing: string[], additions: string[]): string[] {
  const seen = new Set(existing.map((d) => d.toLowerCase()));
  const next = [...existing];
  for (const raw of additions) {
    const normalized = normalizeDishName(raw);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      next.push(normalized);
    }
  }
  return next;
}

interface MealEditorSheetBodyProps {
  mealType: MealType;
  propertyId?: string;
  dateLabel: string;
  existingMenu: FoodMenuRecord | null;
  saving: boolean;
  onClose: () => void;
  onSave: (payload: MealEditorSavePayload) => Promise<void> | void;
}

function MealEditorSheetBody({
  mealType,
  propertyId,
  dateLabel,
  existingMenu,
  saving,
  onClose,
  onSave,
}: MealEditorSheetBodyProps) {
  const insets = useSafeAreaInsets();
  const quickAddScrollRef = useRef<ComponentRef<typeof ScrollView>>(null);

  const initialDishes = useMemo(
    () => (existingMenu ? parseDishList(existingMenu.items) : []),
    [existingMenu]
  );
  const initialNotes = existingMenu?.notes?.trim() ?? '';
  const initialPublished = existingMenu ? existingMenu.is_published : false;
  const initialMealTime = useMemo(
    () =>
      normalizeHhMm24(existingMenu?.meal_time) ??
      (existingMenu?.meal_time?.trim() || null),
    [existingMenu]
  );

  const [dishes, setDishes] = useState<string[]>(() => initialDishes);
  const [dishInputText, setDishInputText] = useState('');
  const [notes, setNotes] = useState(() => initialNotes);
  const [mealTimeInput, setMealTimeInput] = useState<string>(
    () => initialMealTime ?? ''
  );
  const [mealTimeError, setMealTimeError] = useState<string | null>(null);
  const [isPublished, setIsPublished] = useState(() => initialPublished);

  const [customDishes, setCustomDishes] = useState<string[]>([]);
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customDishInput, setCustomDishInput] = useState('');
  const [savingCustom, setSavingCustom] = useState(false);

  const [residentCount, setResidentCount] = useState<number | null>(null);

  useEffect(() => {
    if (!propertyId) return;
    let cancelled = false;

    const loadMetadata = async () => {
      const [customRes, countRes] = await Promise.all([
        getCustomDishes(propertyId, mealType),
        fetchActiveResidentCount(propertyId),
      ]);
      if (cancelled) return;
      if (customRes.ok) {
        setCustomDishes(customRes.data);
      }
      if (countRes.ok) {
        setResidentCount(countRes.data);
      }
    };

    void loadMetadata();
    return () => {
      cancelled = true;
    };
  }, [propertyId, mealType]);

  const builtInSuggestions = useMemo(
    () => MEAL_CHIP_SUGGESTIONS[mealType].map((item) => normalizeDishName(item)),
    [mealType]
  );

  const builtInKeySet = useMemo(
    () => new Set(builtInSuggestions.map((d) => d.toLowerCase())),
    [builtInSuggestions]
  );

  const quickAddDishes = useMemo(
    () => appendUniqueDishes(customDishes, builtInSuggestions),
    [customDishes, builtInSuggestions]
  );

  const isDirty = useMemo(() => {
    const currentSerialized = serializeDishList(dishes);
    const initialSerialized = serializeDishList(initialDishes);
    const currentTimeKey =
      normalizeHhMm24(mealTimeInput) ?? mealTimeInput.trim();
    const initialTimeKey =
      normalizeHhMm24(initialMealTime) ?? (initialMealTime ?? '');
    return (
      currentSerialized !== initialSerialized ||
      notes.trim() !== initialNotes ||
      currentTimeKey !== initialTimeKey ||
      isPublished !== initialPublished ||
      dishInputText.trim().length > 0 ||
      customDishInput.trim().length > 0
    );
  }, [
    dishes,
    initialDishes,
    notes,
    initialNotes,
    mealTimeInput,
    initialMealTime,
    isPublished,
    initialPublished,
    dishInputText,
    customDishInput,
  ]);

  const selectedKeySet = useMemo(
    () => new Set(dishes.map((d) => d.toLowerCase())),
    [dishes]
  );

  const handleToggleQuickChip = (dish: string) => {
    if (saving) return;
    triggerSelectionHaptic();
    const normalized = normalizeDishName(dish);
    if (!normalized) return;
    const key = normalized.toLowerCase();
    setDishes((prev) => {
      if (prev.some((d) => d.toLowerCase() === key)) {
        return prev.filter((d) => d.toLowerCase() !== key);
      }
      return appendUniqueDishes(prev, [normalized]);
    });
  };

  const handleLongPressQuickChip = (dish: string) => {
    if (saving || !propertyId) return;
    const normalized = normalizeDishName(dish);
    if (!normalized || builtInKeySet.has(normalized.toLowerCase())) return;

    Alert.alert(
      'Remove Custom Dish?',
      `Remove "${normalized}" from your saved ${MEAL_CONFIG[mealType].title.toLowerCase()} quick-add list?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const res = await removeCustomDish(propertyId, mealType, normalized);
            if (res.ok) {
              setCustomDishes(res.data);
            }
          },
        },
      ]
    );
  };

  const handleSaveCustomDish = async () => {
    const normalized = normalizeDishName(customDishInput);
    if (!normalized || saving || savingCustom) return;

    triggerSelectionHaptic();
    setSavingCustom(true);
    try {
      if (propertyId) {
        const res = await addCustomDish(propertyId, mealType, normalized);
        if (res.ok) {
          setCustomDishes(res.data);
        } else {
          setCustomDishes((prev) => appendUniqueDishes(prev, [normalized]));
        }
      } else {
        setCustomDishes((prev) => appendUniqueDishes(prev, [normalized]));
      }
      setDishes((prev) => appendUniqueDishes(prev, [normalized]));
      setCustomDishInput('');
      setShowCustomInput(false);
    } finally {
      setSavingCustom(false);
    }
  };

  const handleRemoveDish = (dish: string) => {
    if (saving) return;
    triggerSelectionHaptic();
    const targetKey = dish.toLowerCase();
    setDishes((prev) => prev.filter((d) => d.toLowerCase() !== targetKey));
  };

  const handleDishInputChange = (text: string) => {
    if (text.includes(',') || text.includes('\n')) {
      const endsWithSeparator = /[,\n]\s*$/.test(text);
      const parts = text.split(/[,\n]/);
      const toCommit = endsWithSeparator ? parts : parts.slice(0, -1);
      const remainder = endsWithSeparator ? '' : (parts[parts.length - 1] ?? '').trimStart();

      const validAdditions = toCommit
        .map((part) => normalizeDishName(part))
        .filter(Boolean);

      if (validAdditions.length > 0) {
        triggerSelectionHaptic();
        setDishes((prev) => appendUniqueDishes(prev, validAdditions));
      }
      setDishInputText(remainder);
      return;
    }

    setDishInputText(text);
  };

  const handleCommitDishInput = () => {
    if (saving) return;
    const additions = parseDishList(dishInputText);
    if (additions.length === 0) {
      setDishInputText('');
      return;
    }
    triggerSelectionHaptic();
    setDishes((prev) => appendUniqueDishes(prev, additions));
    setDishInputText('');
  };

  const handleAttemptClose = () => {
    if (saving) return;
    if (!isDirty) {
      onClose();
      return;
    }

    Alert.alert(
      'Discard unsaved changes?',
      'Your edits to this meal will not be saved.',
      [
        { text: 'Keep Editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: onClose },
      ]
    );
  };

  const validateMealTime = (raw: string): boolean => {
    const trimmed = raw.trim();
    if (!trimmed) {
      setMealTimeError(null);
      return true;
    }
    if (!normalizeHhMm24(trimmed)) {
      setMealTimeError('Enter 24-hour time as HH:mm (e.g. 08:00)');
      return false;
    }
    setMealTimeError(null);
    return true;
  };

  const handleMealTimeChange = (next: string) => {
    setMealTimeInput(next);
    if (mealTimeError) {
      const trimmed = next.trim();
      if (!trimmed || normalizeHhMm24(trimmed)) {
        setMealTimeError(null);
      }
    }
  };

  const handleSavePress = () => {
    if (saving || dishes.length === 0) return;
    if (!validateMealTime(mealTimeInput)) return;

    const pendingDishes = parseDishList(dishInputText);
    const normalizedItems = serializeDishList([...dishes, ...pendingDishes]);
    if (!normalizedItems) return;

    const payload: MealEditorSavePayload = {
      items: normalizedItems,
      notes: notes.trim() || null,
      isPublished,
      mealTime: normalizeHhMm24(mealTimeInput),
    };

    if (isPublished) {
      const confirmationMessage =
        residentCount !== null
          ? `This will be visible to ${residentCount} ${residentCount === 1 ? 'resident' : 'residents'}.`
          : 'This will be visible to residents on their portal.';

      Alert.alert('Publish Menu?', confirmationMessage, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Publish',
          onPress: () => {
            void onSave(payload);
          },
        },
      ]);
      return;
    }

    void onSave(payload);
  };

  const canSave = dishes.length > 0 && !saving;
  const canAddTypedDish = normalizeDishName(dishInputText).length > 0 && !saving;
  const canAddCustomDish = normalizeDishName(customDishInput).length > 0 && !saving && !savingCustom;
  const normalizedSelectedTime = normalizeHhMm24(mealTimeInput);
  const mealTimePreview = mealTimeInput.trim()
    ? formatHhMmTo12h(mealTimeInput.trim())
    : '';
  const timePresets = MEAL_TIME_PRESETS[mealType];

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={handleAttemptClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}>
        <Pressable
          accessibilityLabel="Close editor backdrop"
          style={styles.backdrop}
          onPress={handleAttemptClose}
        />

        <View style={styles.sheet}>
          <View style={styles.handleBar} />

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleWrap}>
              <Text style={styles.title} numberOfLines={1}>
                {MEAL_CONFIG[mealType].title} · {dateLabel}
              </Text>
              <View
                style={[
                  styles.statusBadge,
                  isDirty ? styles.statusBadgeDirty : styles.statusBadgeEditing,
                ]}>
                <Text
                  style={[
                    styles.statusBadgeText,
                    isDirty
                      ? styles.statusBadgeTextDirty
                      : styles.statusBadgeTextEditing,
                  ]}>
                  {isDirty ? 'Unsaved changes' : 'Editing'}
                </Text>
              </View>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close editor"
              hitSlop={10}
              style={styles.closeBtn}
              disabled={saving}
              onPress={handleAttemptClose}>
              <X size={18} color={OwnerTheme.colors.textSecondary} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollBody}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {/* Quick Add Dishes */}
            <View style={styles.quickAddHeaderRow}>
              <Text style={styles.sectionLabel}>Quick Add Dishes</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Scroll more dishes"
                hitSlop={6}
                style={styles.scrollCueHeaderBtn}
                onPress={() =>
                  quickAddScrollRef.current?.scrollToEnd({ animated: true })
                }>
                <Text style={styles.scrollCueText}>Swipe</Text>
                <ChevronRight size={13} color="#64748B" />
              </Pressable>
            </View>

            <View style={styles.quickAddRowWrap}>
              <ScrollView
                ref={quickAddScrollRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.quickAddScrollContent}>
                <Pressable
                  accessibilityRole="button"
                  disabled={saving}
                  style={[
                    styles.customTriggerChip,
                    showCustomInput && styles.customTriggerChipActive,
                  ]}
                  onPress={() => {
                    triggerSelectionHaptic();
                    setShowCustomInput((prev) => !prev);
                  }}>
                  <Text
                    style={[
                      styles.customTriggerChipText,
                      showCustomInput && styles.customTriggerChipTextActive,
                    ]}>
                    + Custom
                  </Text>
                </Pressable>

                {quickAddDishes.map((dish) => {
                  const isAdded = selectedKeySet.has(dish.toLowerCase());
                  return (
                    <Pressable
                      key={dish}
                      accessibilityRole="button"
                      disabled={saving}
                      style={[
                        styles.quickChip,
                        isAdded && styles.quickChipSelected,
                      ]}
                      onPress={() => handleToggleQuickChip(dish)}
                      onLongPress={() => handleLongPressQuickChip(dish)}>
                      <Text
                        style={[
                          styles.quickChipText,
                          isAdded && styles.quickChipTextSelected,
                        ]}>
                        {isAdded ? `✓ ${dish}` : `+ ${dish}`}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Scroll right for more dishes"
                style={styles.quickAddArrowCue}
                onPress={() =>
                  quickAddScrollRef.current?.scrollToEnd({ animated: true })
                }>
                <ChevronRight size={15} color="#475569" />
              </Pressable>
            </View>

            {/* + Custom Inline Input */}
            {showCustomInput && (
              <View style={styles.customInputRow}>
                <TextInput
                  style={styles.customInput}
                  placeholder="Enter custom dish (e.g., Masala Dosa)"
                  placeholderTextColor="#94A3B8"
                  value={customDishInput}
                  onChangeText={setCustomDishInput}
                  onSubmitEditing={() => {
                    void handleSaveCustomDish();
                  }}
                  returnKeyType="done"
                  autoFocus
                  editable={!saving && !savingCustom}
                  maxLength={50}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={!canAddCustomDish}
                  style={[
                    styles.inlineAddBtn,
                    !canAddCustomDish && styles.inlineAddBtnDisabled,
                  ]}
                  onPress={() => {
                    void handleSaveCustomDish();
                  }}>
                  <Text style={styles.inlineAddBtnText}>Add</Text>
                </Pressable>
              </View>
            )}

            {/* Food Items Chip Input */}
            <Text style={styles.sectionLabel}>
              Food Items <Text style={{ color: '#EF4444' }}>*</Text>
            </Text>
            <View style={styles.chipInputBox}>
              <View style={styles.selectedChipsWrap}>
                {dishes.map((dish) => (
                  <Pressable
                    key={dish}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${dish}`}
                    hitSlop={4}
                    disabled={saving}
                    style={({ pressed }) => [
                      styles.selectedDishChip,
                      pressed && styles.selectedDishChipPressed,
                    ]}
                    onPress={() => handleRemoveDish(dish)}>
                    <Text style={styles.selectedDishChipText}>{dish} ×</Text>
                  </Pressable>
                ))}
              </View>

              <View style={styles.inlineDishEntryRow}>
                <TextInput
                  style={styles.inlineDishInput}
                  placeholder={
                    dishes.length === 0
                      ? 'Type a dish and tap Add...'
                      : 'Add another dish...'
                  }
                  placeholderTextColor="#94A3B8"
                  value={dishInputText}
                  onChangeText={handleDishInputChange}
                  onSubmitEditing={handleCommitDishInput}
                  returnKeyType="done"
                  blurOnSubmit={false}
                  editable={!saving}
                  maxLength={60}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add dish"
                  disabled={!canAddTypedDish}
                  style={[
                    styles.inlineAddBtn,
                    !canAddTypedDish && styles.inlineAddBtnDisabled,
                  ]}
                  onPress={handleCommitDishInput}>
                  <Text style={styles.inlineAddBtnText}>Add</Text>
                </Pressable>
              </View>
            </View>
            <Text
              style={[
                styles.helperText,
                dishes.length === 0 && styles.helperTextHighlight,
              ]}>
              Add at least one dish
            </Text>

            {/* Special Notes */}
            <Text style={styles.sectionLabel}>
              Special Notes{' '}
              <Text style={styles.optionalTag}>(Optional)</Text>
            </Text>
            <TextInput
              style={styles.notesInput}
              placeholder="e.g., Special dessert or Sunday sweet"
              placeholderTextColor="#94A3B8"
              value={notes}
              onChangeText={setNotes}
              editable={!saving}
              maxLength={140}
            />

            {/* Serving Time */}
            <View style={styles.servingTimeLabelRow}>
              <Clock size={13} color="#475569" />
              <Text style={[styles.sectionLabel, { marginBottom: 0 }]}>
                Serving Time{' '}
                <Text style={styles.optionalTag}>(Optional)</Text>
              </Text>
            </View>
            <View style={styles.timePresetRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{
                  selected: mealTimeInput.trim() === '',
                  disabled: saving,
                }}
                disabled={saving}
                style={[
                  styles.quickChip,
                  mealTimeInput.trim() === '' && styles.quickChipSelected,
                ]}
                onPress={() => {
                  triggerSelectionHaptic();
                  setMealTimeInput('');
                  setMealTimeError(null);
                }}>
                <Text
                  style={[
                    styles.quickChipText,
                    mealTimeInput.trim() === '' && styles.quickChipTextSelected,
                  ]}>
                  No time
                </Text>
              </Pressable>

              {timePresets.map((preset24) => {
                const isSelected = normalizedSelectedTime === preset24;
                const label = formatHhMmTo12h(preset24);
                return (
                  <Pressable
                    key={preset24}
                    accessibilityRole="button"
                    accessibilityState={{
                      selected: isSelected,
                      disabled: saving,
                    }}
                    disabled={saving}
                    style={[
                      styles.quickChip,
                      isSelected && styles.quickChipSelected,
                    ]}
                    onPress={() => {
                      triggerSelectionHaptic();
                      setMealTimeInput(preset24);
                      setMealTimeError(null);
                    }}>
                    <Text
                      style={[
                        styles.quickChipText,
                        isSelected && styles.quickChipTextSelected,
                      ]}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.customTimeRow}>
              <TextInput
                style={[
                  styles.customTimeInput,
                  mealTimeError ? styles.customTimeInputError : null,
                ]}
                placeholder={`Custom HH:mm (e.g. ${timePresets[1]})`}
                placeholderTextColor="#94A3B8"
                value={mealTimeInput}
                onChangeText={handleMealTimeChange}
                onBlur={() => validateMealTime(mealTimeInput)}
                keyboardType={
                  Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'
                }
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={5}
                editable={!saving}
              />
              {mealTimePreview ? (
                <View style={styles.timePreviewBadge}>
                  <Text style={styles.timePreviewBadgeText}>
                    {mealTimePreview}
                  </Text>
                </View>
              ) : null}
            </View>
            {mealTimeError ? (
              <Text style={styles.timeErrorText}>{mealTimeError}</Text>
            ) : null}

            {/* Publish Toggle */}
            <View style={styles.publishCard}>
              <View style={styles.publishCopy}>
                <Text style={styles.publishTitle}>Publish Menu</Text>
                <Text style={styles.publishSubtitle}>
                  Visible to residents on their portal
                </Text>
              </View>
              <Switch
                value={isPublished}
                onValueChange={(next) => {
                  triggerSelectionHaptic();
                  setIsPublished(next);
                }}
                trackColor={HIGH_CONTRAST_SWITCH_COLORS}
                thumbColor={SWITCH_THUMB_COLOR}
                disabled={saving}
              />
            </View>
          </ScrollView>

          {/* Sticky Footer */}
          <View
            style={[
              styles.stickyFooter,
              { paddingBottom: Math.max(insets.bottom, 16) },
            ]}>
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              hitSlop={8}
              style={styles.cancelLinkBtn}
              onPress={handleAttemptClose}>
              <Text style={styles.cancelLinkText}>Cancel</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              disabled={!canSave}
              style={({ pressed }) => [
                styles.primaryCtaBtn,
                !canSave && styles.primaryCtaBtnDisabled,
                pressed && canSave && styles.primaryCtaBtnPressed,
              ]}
              onPress={handleSavePress}>
              {saving ? (
                <View style={styles.savingRow}>
                  <ActivityIndicator size="small" color="#FFFFFF" />
                  <Text style={styles.primaryCtaText}>Saving...</Text>
                </View>
              ) : (
                <Text style={styles.primaryCtaText}>
                  {isPublished ? 'Save & Publish' : 'Save draft'}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function MealEditorSheet({
  visible,
  mealType,
  propertyId,
  dateLabel,
  existingMenu,
  saving,
  onClose,
  onSave,
}: MealEditorSheetProps) {
  if (!visible || !mealType) {
    return null;
  }

  const sheetKey = `${mealType}:${dateLabel}:${existingMenu?.id ?? 'new'}:${existingMenu?.items ?? ''}:${existingMenu?.notes ?? ''}:${existingMenu?.meal_time ?? ''}:${String(existingMenu?.is_published ?? false)}`;

  return (
    <MealEditorSheetBody
      key={sheetKey}
      mealType={mealType}
      propertyId={propertyId}
      dateLabel={dateLabel}
      existingMenu={existingMenu}
      saving={saving}
      onClose={onClose}
      onSave={onSave}
    />
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    paddingTop: 10,
    ...OwnerTheme.shadowElevated,
  },
  handleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
    marginBottom: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    gap: 12,
  },
  headerTitleWrap: {
    flex: 1,
    gap: 5,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: OwnerTheme.colors.textPrimary,
    letterSpacing: -0.2,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  statusBadgeEditing: {
    backgroundColor: '#E0F2FE',
  },
  statusBadgeDirty: {
    backgroundColor: '#FEF3C7',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  statusBadgeTextEditing: {
    color: '#0369A1',
  },
  statusBadgeTextDirty: {
    color: '#B45309',
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollArea: {
    flexGrow: 0,
  },
  scrollBody: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 16,
  },
  quickAddHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
  },
  optionalTag: {
    fontWeight: '500',
    color: '#94A3B8',
  },
  scrollCueHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  scrollCueText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  quickAddRowWrap: {
    position: 'relative',
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  quickAddScrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 34,
  },
  quickAddArrowCue: {
    position: 'absolute',
    right: 0,
    top: 2,
    bottom: 2,
    width: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(248, 250, 252, 0.92)',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  customTriggerChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#7DD3FC',
    borderStyle: 'dashed',
  },
  customTriggerChipActive: {
    backgroundColor: '#0284C7',
    borderColor: '#0284C7',
    borderStyle: 'solid',
  },
  customTriggerChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0284C7',
  },
  customTriggerChipTextActive: {
    color: '#FFFFFF',
  },
  quickChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  quickChipSelected: {
    backgroundColor: '#E0F2FE',
    borderColor: '#0284C7',
  },
  quickChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  quickChipTextSelected: {
    color: '#0369A1',
    fontWeight: '700',
  },
  customInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  customInput: {
    flex: 1,
    height: 40,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 13,
    color: '#0F172A',
  },
  inlineAddBtn: {
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#0284C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineAddBtnDisabled: {
    backgroundColor: '#CBD5E1',
  },
  inlineAddBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  chipInputBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    padding: 10,
    gap: 8,
  },
  selectedChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  selectedDishChip: {
    backgroundColor: '#E0F2FE',
    borderWidth: 1,
    borderColor: '#7DD3FC',
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  selectedDishChipPressed: {
    opacity: 0.75,
  },
  selectedDishChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0369A1',
  },
  inlineDishEntryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inlineDishInput: {
    flex: 1,
    height: 40,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    color: '#0F172A',
  },
  helperText: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 5,
    marginBottom: 14,
  },
  helperTextHighlight: {
    color: '#475569',
    fontWeight: '500',
  },
  notesInput: {
    height: 44,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    color: '#0F172A',
    marginBottom: 14,
  },
  servingTimeLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 8,
  },
  timePresetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  customTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  customTimeInput: {
    flex: 1,
    height: 42,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    color: '#0F172A',
  },
  customTimeInputError: {
    borderColor: '#DC2626',
    backgroundColor: '#FEF2F2',
  },
  timePreviewBadge: {
    height: 42,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#E0F2FE',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timePreviewBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0369A1',
  },
  timeErrorText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#DC2626',
    marginTop: -8,
    marginBottom: 14,
  },
  publishCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  publishCopy: {
    flex: 1,
  },
  publishTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  publishSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  stickyFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  cancelLinkBtn: {
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  cancelLinkText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#64748B',
  },
  primaryCtaBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    backgroundColor: OwnerTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  primaryCtaBtnDisabled: {
    backgroundColor: '#94A3B8',
  },
  primaryCtaBtnPressed: {
    backgroundColor: OwnerTheme.colors.primaryDark,
  },
  primaryCtaText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  savingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
