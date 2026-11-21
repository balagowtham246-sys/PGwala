import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { AlertTriangle, Check, Clock, X } from 'lucide-react-native';

import {
  MealEditorSavePayload,
  MealEditorSheet,
} from '@/components/food-menu/MealEditorSheet';
import { WeeklyMenuEditor } from '@/components/food-menu/WeeklyMenuEditor';
import { RoleBottomNav } from '@/components/ui/bottom-nav';
import { OwnerHeader } from '@/components/ui/owner';
import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useProperty } from '@/context/property-context';
import { extractErrorMessage } from '@/lib/error-utils';
import { triggerSuccessHaptic } from '@/lib/haptics';
import {
  formatHhMmTo12h,
  parseDishList,
  serializeDishList,
} from '@/lib/ux-utils';
import {
  createEmptyMealMenuMap,
  deleteFoodMenu,
  fetchActiveOwnerProperty,
  fetchFoodMenusForDate,
  FoodMenuRecord,
  getCachedFoodMenus,
  loadWeeklyMenuTemplate,
  MEAL_CONFIG,
  MEAL_ORDER,
  MealMenuMap,
  MealType,
  PropertyInfo,
  saveFoodMenu,
  saveWeeklyMenuTemplate,
  toggleFoodMenuPublish,
  upsertMealsForDate,
  WeeklyTemplateEntry,
} from '@/services/food-menu.service';

export type { FoodMenuRecord, MealType };

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const WEEKDAYS_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
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

function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDisplayDate(date: Date): string {
  return `${WEEKDAYS_SHORT[date.getDay()]}, ${date.getDate()} ${MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()}`;
}

function formatSheetDate(date: Date): string {
  return `${WEEKDAYS_SHORT[date.getDay()]}, ${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
}

function formatDayMonth(date: Date): string {
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
}

function isSameDay(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

export default function FoodMenuScreen() {
  const { user } = useAuth();
  const { selectedProperty } = useProperty();
  const ownerId = user?.id;

  const [loadingProperty, setLoadingProperty] = useState(true);
  const [property, setProperty] = useState<PropertyInfo | null>(null);
  const propertyId = property?.id;

  // Date selection state
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const selectedDateStr = toIsoDate(selectedDate);

  // Menu data for selected date
  const [loadingMenus, setLoadingMenus] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [menus, setMenus] = useState<MealMenuMap>(createEmptyMealMenuMap);

  // Bottom-sheet editor state
  const [editingMeal, setEditingMeal] = useState<MealType | null>(null);
  const [savingMeal, setSavingMeal] = useState(false);
  const [applyingBulk, setApplyingBulk] = useState(false);

  // Status feedback
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [tableMissingNotice, setTableMissingNotice] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const showToast = useCallback((message: string) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setToastMessage(message);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  }, []);

  // 1. Fetch active property owned by authenticated user
  const loadOwnerProperty = useCallback(async () => {
    try {
      setErrorMessage(null);
      setLoadingProperty(true);

      if (selectedProperty) {
        setProperty({ id: selectedProperty.id, name: selectedProperty.name });
        return;
      }

      if (!ownerId) {
        return;
      }

      const result = await fetchActiveOwnerProperty(ownerId);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      if (!result.data) {
        setProperty(null);
        setErrorMessage('No active PG property found. Please register a property first.');
      } else {
        setProperty(result.data);
      }
    } catch (err: unknown) {
      const msg = extractErrorMessage(err, 'Operation failed. Please try again.');
      console.error('[FoodMenu] Error loading property:', err);
      setErrorMessage(msg);
    } finally {
      setLoadingProperty(false);
    }
  }, [ownerId, selectedProperty]);

  // 2. Fetch food menus for the selected property and date (with query-cache SWR)
  const loadMenusForDate = useCallback(
    async (propId: string, dateStr: string, forceNetwork = false) => {
      try {
        setErrorMessage(null);
        setTableMissingNotice(false);

        let hadCache = false;
        if (!forceNetwork) {
          const cached = await getCachedFoodMenus(propId, dateStr);
          if (cached) {
            hadCache = true;
            setMenus(cached);
            setLoadingMenus(false);
          }
        }

        if (!hadCache && !forceNetwork) {
          setLoadingMenus(true);
        }

        const result = await fetchFoodMenusForDate(propId, dateStr, { forceNetwork });
        if (!result.ok) {
          throw new Error(result.error.message);
        }

        if (result.data.tableMissing) {
          setTableMissingNotice(true);
          setMenus(createEmptyMealMenuMap());
          return;
        }

        setMenus(result.data.menus);
      } catch (err: unknown) {
        const msg = extractErrorMessage(err, 'Operation failed. Please try again.');
        console.error('[FoodMenu] Error fetching menus:', err);
        setErrorMessage(`Failed to load menus: ${msg}`);
      } finally {
        setLoadingMenus(false);
        setRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) {
        void loadOwnerProperty();
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [loadOwnerProperty]);

  useEffect(() => {
    if (!propertyId) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) {
        void loadMenusForDate(propertyId, selectedDateStr);
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [propertyId, selectedDateStr, loadMenusForDate]);

  useFocusEffect(
    useCallback(() => {
      if (propertyId) {
        void loadMenusForDate(propertyId, selectedDateStr);
      }
    }, [propertyId, selectedDateStr, loadMenusForDate])
  );

  const handleRefresh = () => {
    setRefreshing(true);
    if (propertyId) {
      void loadMenusForDate(propertyId, selectedDateStr, true);
    } else {
      void loadOwnerProperty();
    }
  };

  // Date Navigation
  const changeDateByDays = (delta: number) => {
    setSelectedDate((prev) => {
      const next = new Date(prev);
      next.setDate(next.getDate() + delta);
      return next;
    });
    setEditingMeal(null);
  };

  const openEditForm = (mealType: MealType) => {
    setErrorMessage(null);
    setEditingMeal(mealType);
  };

  const closeEditForm = () => {
    setEditingMeal(null);
  };

  // Save Menu from Bottom Sheet (Create or Update - strictly online)
  const handleSaveMenu = async (payload: MealEditorSavePayload) => {
    if (!property?.id) {
      Alert.alert('Error', 'Property context missing.');
      return;
    }

    if (!editingMeal) return;

    const normalizedItems = serializeDishList(parseDishList(payload.items));
    if (!normalizedItems) {
      Alert.alert('Missing Dishes', 'Please add at least one dish.');
      return;
    }

    setSavingMeal(true);
    setErrorMessage(null);

    const targetMeal = editingMeal;
    const existing = menus[targetMeal];

    try {
      const result = await saveFoodMenu({
        propertyId: property.id,
        menuDate: selectedDateStr,
        mealType: targetMeal,
        items: normalizedItems,
        notes: payload.notes,
        isPublished: payload.isPublished,
        meal_time: payload.mealTime,
        existingId: existing?.id,
      });

      if (!result.ok) {
        throw new Error(result.error.message);
      }

      const mealTitle = MEAL_CONFIG[targetMeal].title;
      const shortDate = formatDayMonth(selectedDate);
      triggerSuccessHaptic();
      showToast(
        payload.isPublished
          ? `${mealTitle} published for ${shortDate}`
          : `${mealTitle} draft saved for ${shortDate}`
      );

      setEditingMeal(null);
      await loadMenusForDate(property.id, selectedDateStr, true);
    } catch (err: unknown) {
      const msg = extractErrorMessage(err, 'Operation failed. Please try again.');
      console.error('[FoodMenu] Save error:', err);
      Alert.alert('Save Failed', msg);
      setErrorMessage(`Save Failed: ${msg}`);
    } finally {
      setSavingMeal(false);
    }
  };

  // Toggle Publish / Draft
  const handleTogglePublish = async (menu: FoodMenuRecord) => {
    if (!property?.id) return;
    try {
      const nextStatus = !menu.is_published;
      const result = await toggleFoodMenuPublish({
        id: menu.id,
        propertyId: property.id,
        nextPublished: nextStatus,
      });

      if (!result.ok) {
        throw new Error(result.error.message);
      }

      const mealTitle = MEAL_CONFIG[menu.meal_type].title;
      const shortDate = formatDayMonth(selectedDate);
      triggerSuccessHaptic();
      showToast(
        nextStatus
          ? `${mealTitle} published for ${shortDate}`
          : `${mealTitle} moved to draft (hidden from residents)`
      );

      await loadMenusForDate(property.id, selectedDateStr, true);
    } catch (err: unknown) {
      const msg = extractErrorMessage(err, 'Operation failed. Please try again.');
      Alert.alert('Status Update Failed', msg);
    }
  };

  // Delete Menu with Confirmation
  const handleDeleteMenu = (menu: FoodMenuRecord) => {
    Alert.alert(
      `Delete ${MEAL_CONFIG[menu.meal_type].title} Menu?`,
      `Are you sure you want to delete the ${menu.meal_type} menu for ${formatDisplayDate(selectedDate)}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Menu',
          style: 'destructive',
          onPress: async () => {
            if (!property?.id) return;
            try {
              const result = await deleteFoodMenu({
                id: menu.id,
                propertyId: property.id,
                menuDate: menu.menu_date,
                mealType: menu.meal_type,
              });

              if (!result.ok) {
                throw new Error(result.error.message);
              }

              showToast(
                `Deleted ${MEAL_CONFIG[menu.meal_type].title} menu for ${formatDayMonth(selectedDate)}`
              );
              await loadMenusForDate(property.id, selectedDateStr, true);
            } catch (err: unknown) {
              const msg = extractErrorMessage(err, 'Operation failed. Please try again.');
              Alert.alert('Delete Failed', msg);
            }
          },
        },
      ]
    );
  };

  const upsertMealsForSelectedDate = async (entries: WeeklyTemplateEntry[]) => {
    if (!property?.id) return;
    const result = await upsertMealsForDate({
      propertyId: property.id,
      menuDate: selectedDateStr,
      existingMenus: menus,
      entries,
    });
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    await loadMenusForDate(property.id, selectedDateStr, true);
  };

  const handleSaveWeeklyTemplate = async () => {
    if (!property?.id) return;
    const configured = MEAL_ORDER.filter((m) => Boolean(menus[m]));
    if (configured.length === 0) {
      Alert.alert(
        'No Meals Set',
        'Add at least one meal for this day before saving it as a template.'
      );
      return;
    }
    try {
      setApplyingBulk(true);
      const weekday = String(selectedDate.getDay());
      const entries: WeeklyTemplateEntry[] = configured.map((m) => ({
        meal_type: m,
        items:
          serializeDishList(parseDishList(menus[m]!.items)) || menus[m]!.items,
        notes: menus[m]!.notes,
        is_published: menus[m]!.is_published,
        meal_time: menus[m]!.meal_time ?? null,
      }));
      const result = await saveWeeklyMenuTemplate(property.id, weekday, entries);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      const dayName = WEEKDAYS_LONG[selectedDate.getDay()];
      triggerSuccessHaptic();
      showToast(`Saved ${dayName} menu as weekly template`);
    } catch (err: unknown) {
      const msg = extractErrorMessage(err, 'Operation failed. Please try again.');
      Alert.alert('Template Save Failed', msg);
    } finally {
      setApplyingBulk(false);
    }
  };

  const handleApplyWeeklyTemplate = async () => {
    if (!property?.id) return;
    try {
      setApplyingBulk(true);
      setErrorMessage(null);
      const weekday = String(selectedDate.getDay());
      const dayName = WEEKDAYS_LONG[selectedDate.getDay()];

      const result = await loadWeeklyMenuTemplate(property.id, weekday);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      if (!result.data) {
        Alert.alert(
          'No Template Found',
          `No weekly template saved for ${dayName} yet. Set meals for a ${dayName} and tap "Save as Template".`
        );
        return;
      }

      await upsertMealsForSelectedDate(result.data);
      triggerSuccessHaptic();
      showToast(`Applied ${dayName} template for ${formatDayMonth(selectedDate)}`);
    } catch (err: unknown) {
      const msg = extractErrorMessage(err, 'Operation failed. Please try again.');
      Alert.alert('Apply Template Failed', msg);
    } finally {
      setApplyingBulk(false);
    }
  };

  const today = new Date();
  const isToday = isSameDay(selectedDate, today);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const isTomorrow = isSameDay(selectedDate, tomorrow);

  const configuredMealTimes = MEAL_ORDER.flatMap((meal) => {
    const formatted = formatHhMmTo12h(menus[meal]?.meal_time);
    if (!formatted) return [];
    return [{ meal, title: MEAL_CONFIG[meal].title, timeLabel: formatted }];
  });

  const topNotice = (
    <>
      {configuredMealTimes.length > 0 && (
        <View style={styles.mealTimesStrip}>
          <View style={styles.mealTimesHeaderRow}>
            <Clock size={13} color="#0284C7" />
            <Text style={styles.mealTimesHeaderText}>Serving times</Text>
          </View>
          <View style={styles.mealTimesChipsRow}>
            {configuredMealTimes.map((item) => (
              <Pressable
                key={item.meal}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${item.title} serving time ${item.timeLabel}`}
                style={({ pressed }) => [
                  styles.mealTimeChip,
                  pressed && styles.mealTimeChipPressed,
                ]}
                onPress={() => openEditForm(item.meal)}>
                <Text style={styles.mealTimeChipText}>
                  {item.title} · {item.timeLabel}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {tableMissingNotice && (
        <View style={styles.migrationNoticeBox}>
          <View style={styles.migrationTitleRow}>
            <AlertTriangle size={15} color="#B45309" />
            <Text style={styles.migrationNoticeTitle}>
              Database Setup Required
            </Text>
          </View>
          <Text style={styles.migrationNoticeText}>
            The <Text style={{ fontWeight: '700' }}>food_menus</Text> table has
            not been created in Supabase yet.
          </Text>
          <Text style={styles.migrationNoticeSub}>
            Run the script in{' '}
            <Text
              style={{
                fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                fontWeight: '700',
              }}>
              supabase/food_menus_migration.sql
            </Text>{' '}
            in your Supabase SQL Editor to enable food menus.
          </Text>
        </View>
      )}

      {errorMessage && (
        <View style={styles.errorBanner}>
          <AlertTriangle size={16} color="#DC2626" />
          <Text style={styles.errorText}>{errorMessage}</Text>
          <Pressable hitSlop={8} onPress={() => setErrorMessage(null)}>
            <X size={16} color="#DC2626" />
          </Pressable>
        </View>
      )}
    </>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <OwnerHeader
        title="Food Menu"
        subtitle={
          property
            ? property.name
            : loadingProperty
              ? 'Loading property...'
              : 'Daily Meals Management'
        }
        showBack
      />

      <View style={styles.contentArea}>
        <WeeklyMenuEditor
          displayDate={formatDisplayDate(selectedDate)}
          selectedDateStr={selectedDateStr}
          isToday={isToday}
          isTomorrow={isTomorrow}
          loadingMenus={loadingMenus}
          refreshing={refreshing}
          menus={menus}
          applyingBulk={applyingBulk}
          topNotice={topNotice}
          onRefresh={handleRefresh}
          onChangeDateByDays={changeDateByDays}
          onApplyWeeklyTemplate={handleApplyWeeklyTemplate}
          onSaveWeeklyTemplate={handleSaveWeeklyTemplate}
          onOpenEditForm={openEditForm}
          onTogglePublish={handleTogglePublish}
          onDeleteMenu={handleDeleteMenu}
        />

        {toastMessage && (
          <View style={styles.toastBanner} accessibilityLiveRegion="polite">
            <View style={styles.toastIconCircle}>
              <Check size={13} color="#FFFFFF" strokeWidth={2.8} />
            </View>
            <Text style={styles.toastText} numberOfLines={2}>
              {toastMessage}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss notification"
              hitSlop={8}
              onPress={() => setToastMessage(null)}>
              <X size={15} color="#CBD5E1" />
            </Pressable>
          </View>
        )}
      </View>

      <MealEditorSheet
        visible={Boolean(editingMeal)}
        mealType={editingMeal}
        propertyId={property?.id}
        dateLabel={formatSheetDate(selectedDate)}
        existingMenu={editingMeal ? menus[editingMeal] : null}
        saving={savingMeal}
        onClose={closeEditForm}
        onSave={handleSaveMenu}
      />

      <RoleBottomNav activeTab="menu" roleOverride="owner" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  contentArea: {
    flex: 1,
    position: 'relative',
  },
  mealTimesStrip: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 10,
    gap: 7,
  },
  mealTimesHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  mealTimesHeaderText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  mealTimesChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  mealTimeChip: {
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  mealTimeChipPressed: {
    backgroundColor: '#E0F2FE',
  },
  mealTimeChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0369A1',
  },
  migrationNoticeBox: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FCD34D',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
  },
  migrationTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  migrationNoticeTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#B45309',
  },
  migrationNoticeText: {
    fontSize: 13,
    color: '#78350F',
    lineHeight: 18,
  },
  migrationNoticeSub: {
    fontSize: 12,
    color: '#92400E',
    marginTop: 6,
    lineHeight: 16,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: '#DC2626',
    fontWeight: '500',
  },
  toastBanner: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 14,
    backgroundColor: '#0F172A',
    borderRadius: OwnerTheme.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    ...OwnerTheme.shadowElevated,
  },
  toastIconCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toastText: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
});
