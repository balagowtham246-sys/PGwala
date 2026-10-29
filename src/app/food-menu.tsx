import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';

import { BottomTabInset } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/lib/supabase';

export type MealType = 'breakfast' | 'lunch' | 'dinner';

export interface FoodMenuRecord {
  id: string;
  property_id: string;
  menu_date: string; // ISO date 'YYYY-MM-DD'
  meal_type: MealType;
  items: string;
  notes: string | null;
  is_published: boolean;
  created_at?: string;
  updated_at?: string;
}

interface PropertyInfo {
  id: string;
  name: string;
}

const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner'];

const MEAL_CONFIG: Record<
  MealType,
  { title: string; icon: string; timeHint: string; defaultPlaceholder: string }
> = {
  breakfast: {
    title: 'Breakfast',
    icon: '🍳',
    timeHint: 'Morning (e.g. 7:30 AM – 9:30 AM)',
    defaultPlaceholder: 'e.g., Idli, Sambar, Coconut Chutney, Tea / Coffee',
  },
  lunch: {
    title: 'Lunch',
    icon: '🍛',
    timeHint: 'Afternoon (e.g. 12:30 PM – 2:30 PM)',
    defaultPlaceholder: 'e.g., Rice, Dal Tadka, Paneer Butter Masala, Roti, Curd',
  },
  dinner: {
    title: 'Dinner',
    icon: '🍲',
    timeHint: 'Night (e.g. 8:00 PM – 10:00 PM)',
    defaultPlaceholder: 'e.g., Chapati, Mixed Veg Curry, Jeera Rice, Dal, Gulab Jamun',
  },
};

// Date helpers
function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDisplayDate(date: Date): string {
  return date.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
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

  const [loadingProperty, setLoadingProperty] = useState(true);
  const [property, setProperty] = useState<PropertyInfo | null>(null);

  // Date selection state
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const selectedDateStr = toIsoDate(selectedDate);

  // Menu data for selected date
  const [loadingMenus, setLoadingMenus] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [menus, setMenus] = useState<Record<MealType, FoodMenuRecord | null>>({
    breakfast: null,
    lunch: null,
    dinner: null,
  });

  // Inline editor / modal state
  const [editingMeal, setEditingMeal] = useState<MealType | null>(null);
  const [formItems, setFormItems] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formPublished, setFormPublished] = useState(true);
  const [savingMeal, setSavingMeal] = useState(false);

  // Status feedback
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [tableMissingNotice, setTableMissingNotice] = useState(false);

  // 1. Fetch active property owned by authenticated user
  const loadOwnerProperty = useCallback(async () => {
    try {
      setErrorMessage(null);
      setLoadingProperty(true);

      let query = supabase
        .from('properties')
        .select('id, name')
        .eq('is_active', true);

      if (user?.id) {
        query = query.eq('owner_id', user.id);
      }

      const { data, error } = await query.limit(1);

      if (error) throw error;

      if (!data || data.length === 0) {
        setProperty(null);
        setErrorMessage('No active PG property found. Please register a property first.');
      } else {
        setProperty(data[0]);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[FoodMenu] Error loading property:', err);
      setErrorMessage(msg);
    } finally {
      setLoadingProperty(false);
    }
  }, [user?.id]);

  // 2. Fetch food menus for the selected property and date
  const loadMenusForDate = useCallback(
    async (propId: string, dateStr: string) => {
      try {
        setErrorMessage(null);
        setTableMissingNotice(false);
        setLoadingMenus(true);

        const { data, error } = await supabase
          .from('food_menus')
          .select('id, property_id, menu_date, meal_type, items, notes, is_published, created_at, updated_at')
          .eq('property_id', propId)
          .eq('menu_date', dateStr);

        if (error) {
          // Detect if the food_menus table has not yet been executed in Supabase SQL editor
          if (
            error.code === '42P01' ||
            error.message.toLowerCase().includes('relation') ||
            error.message.toLowerCase().includes('does not exist')
          ) {
            setTableMissingNotice(true);
            setMenus({ breakfast: null, lunch: null, dinner: null });
            return;
          }
          throw error;
        }

        const menuMap: Record<MealType, FoodMenuRecord | null> = {
          breakfast: null,
          lunch: null,
          dinner: null,
        };

        if (data && data.length > 0) {
          for (const item of data as FoodMenuRecord[]) {
            if (MEAL_ORDER.includes(item.meal_type)) {
              menuMap[item.meal_type] = item;
            }
          }
        }

        setMenus(menuMap);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
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
    loadOwnerProperty();
  }, [loadOwnerProperty]);

  useEffect(() => {
    if (property?.id) {
      loadMenusForDate(property.id, selectedDateStr);
    }
  }, [property?.id, selectedDateStr, loadMenusForDate]);

  useFocusEffect(
    useCallback(() => {
      if (property?.id) {
        loadMenusForDate(property.id, selectedDateStr);
      }
    }, [property?.id, selectedDateStr, loadMenusForDate])
  );

  const handleRefresh = () => {
    setRefreshing(true);
    if (property?.id) {
      loadMenusForDate(property.id, selectedDateStr);
    } else {
      loadOwnerProperty();
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

  const setRelativeDay = (offsetDays: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    setSelectedDate(d);
    setEditingMeal(null);
  };

  // Open Form for a Meal
  const openEditForm = (mealType: MealType) => {
    const existing = menus[mealType];
    setEditingMeal(mealType);
    setFormItems(existing ? existing.items : '');
    setFormNotes(existing?.notes ? existing.notes : '');
    setFormPublished(existing ? existing.is_published : true);
    setErrorMessage(null);
  };

  const closeEditForm = () => {
    setEditingMeal(null);
    setFormItems('');
    setFormNotes('');
    setErrorMessage(null);
  };

  // Save Menu (Create or Update)
  const handleSaveMenu = async () => {
    if (!property?.id) {
      Alert.alert('Error', 'Property context missing.');
      return;
    }

    if (!editingMeal) return;

    const trimmedItems = formItems.trim();
    const trimmedNotes = formNotes.trim();

    if (!trimmedItems) {
      setErrorMessage('Please enter the food items for this meal.');
      return;
    }

    setSavingMeal(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const existing = menus[editingMeal];

    try {
      if (existing) {
        // UPDATE existing menu
        const { data, error } = await supabase
          .from('food_menus')
          .update({
            items: trimmedItems,
            notes: trimmedNotes || null,
            is_published: formPublished,
          })
          .eq('id', existing.id)
          .eq('property_id', property.id)
          .select('id, property_id, menu_date, meal_type, items, notes, is_published')
          .single();

        if (error) throw error;
        if (!data || !data.id) throw new Error('Database did not return updated menu row.');

        setSuccessMessage(`Updated ${MEAL_CONFIG[editingMeal].title} menu successfully!`);
      } else {
        // INSERT new menu
        const { data, error } = await supabase
          .from('food_menus')
          .insert({
            property_id: property.id,
            menu_date: selectedDateStr,
            meal_type: editingMeal,
            items: trimmedItems,
            notes: trimmedNotes || null,
            is_published: formPublished,
          })
          .select('id, property_id, menu_date, meal_type, items, notes, is_published')
          .single();

        if (error) throw error;
        if (!data || !data.id) throw new Error('Database did not return inserted menu row.');

        setSuccessMessage(`Saved ${MEAL_CONFIG[editingMeal].title} menu successfully!`);
      }

      closeEditForm();
      await loadMenusForDate(property.id, selectedDateStr);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[FoodMenu] Save error:', err);
      Alert.alert('Save Failed', msg);
      setErrorMessage(`Save Failed: ${msg}`);
    } finally {
      setSavingMeal(false);
    }
  };

  // Toggle Publish / Draft
  const handleTogglePublish = async (menu: FoodMenuRecord) => {
    try {
      const nextStatus = !menu.is_published;
      const { data, error } = await supabase
        .from('food_menus')
        .update({ is_published: nextStatus })
        .eq('id', menu.id)
        .eq('property_id', property?.id)
        .select('id, is_published')
        .single();

      if (error) throw error;
      if (!data) throw new Error('No response from database.');

      setSuccessMessage(
        `${MEAL_CONFIG[menu.meal_type].title} is now ${nextStatus ? 'Published' : 'Draft (Hidden from students)'}`
      );

      if (property?.id) {
        await loadMenusForDate(property.id, selectedDateStr);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert('Status Update Failed', msg);
    }
  };

  // Delete Menu with Confirmation
  const handleDeleteMenu = (menu: FoodMenuRecord) => {
    Alert.alert(
      `Delete ${MEAL_CONFIG[menu.meal_type].title} Menu?`,
      `Are you sure you want to remove the ${menu.meal_type} menu for ${formatDisplayDate(selectedDate)}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase
                .from('food_menus')
                .delete()
                .eq('id', menu.id)
                .eq('property_id', property?.id);

              if (error) throw error;

              setSuccessMessage(`Removed ${MEAL_CONFIG[menu.meal_type].title} menu.`);
              if (property?.id) {
                await loadMenusForDate(property.id, selectedDateStr);
              }
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              Alert.alert('Delete Failed', msg);
            }
          },
        },
      ]
    );
  };

  const today = new Date();
  const isToday = isSameDay(selectedDate, today);
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  const isTomorrow = isSameDay(selectedDate, tomorrow);

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.keyboardContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={['#0284C7']}
            />
          }>

          {/* Top Bar with Back Button */}
          <View style={styles.topBar}>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.backButton,
                pressed && styles.backButtonPressed,
              ]}
              onPress={() => router.back()}>
              <Text style={styles.backButtonText}>‹ Back</Text>
            </Pressable>
            <View style={styles.titleWrapper}>
              <Text style={styles.screenTitle}>Food Menu</Text>
              <Text style={styles.screenSubtitle}>Daily Meals Management</Text>
            </View>
          </View>

          {/* Property Context Badge */}
          {loadingProperty ? (
            <View style={styles.propertyLoadingBox}>
              <ActivityIndicator size="small" color="#0284C7" />
              <Text style={styles.propertyLoadingText}>Loading property...</Text>
            </View>
          ) : property ? (
            <View style={styles.propertyBadge}>
              <Text style={styles.propertyBadgeIcon}>🏢</Text>
              <View style={styles.propertyBadgeDetails}>
                <Text style={styles.propertyBadgeLabel}>Active Property</Text>
                <Text style={styles.propertyBadgeName}>{property.name}</Text>
              </View>
            </View>
          ) : null}

          {/* Table Missing Notice (Guides owner to run migration if not yet deployed) */}
          {tableMissingNotice && (
            <View style={styles.migrationNoticeBox}>
              <Text style={styles.migrationNoticeTitle}>⚠️ Database Setup Required</Text>
              <Text style={styles.migrationNoticeText}>
                The <Text style={{ fontWeight: '700' }}>food_menus</Text> table has not been created in Supabase yet.
              </Text>
              <Text style={styles.migrationNoticeSub}>
                Run the script in <Text style={{ fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontWeight: '700' }}>supabase/food_menus_migration.sql</Text> in your Supabase SQL Editor to enable food menus.
              </Text>
            </View>
          )}

          {/* Feedback Banners */}
          {successMessage && (
            <View style={styles.successBanner}>
              <Text style={styles.successIcon}>✓</Text>
              <Text style={styles.successText}>{successMessage}</Text>
              <Pressable hitSlop={8} onPress={() => setSuccessMessage(null)}>
                <Text style={styles.bannerDismiss}>✕</Text>
              </Pressable>
            </View>
          )}

          {errorMessage && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorIcon}>⚠️</Text>
              <Text style={styles.errorText}>{errorMessage}</Text>
              <Pressable hitSlop={8} onPress={() => setErrorMessage(null)}>
                <Text style={styles.bannerDismiss}>✕</Text>
              </Pressable>
            </View>
          )}

          {/* Date Selector Card */}
          <View style={styles.dateSelectorCard}>
            <View style={styles.dateNavRow}>
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.dateNavBtn,
                  pressed && styles.dateNavBtnPressed,
                ]}
                onPress={() => changeDateByDays(-1)}>
                <Text style={styles.dateNavBtnText}>‹ Prev</Text>
              </Pressable>

              <View style={styles.dateCenterDisplay}>
                <Text style={styles.dateDisplayTitle}>
                  {formatDisplayDate(selectedDate)}
                </Text>
                {isToday ? (
                  <View style={styles.todayPill}>
                    <Text style={styles.todayPillText}>Today</Text>
                  </View>
                ) : isTomorrow ? (
                  <View style={styles.tomorrowPill}>
                    <Text style={styles.tomorrowPillText}>Tomorrow</Text>
                  </View>
                ) : null}
              </View>

              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.dateNavBtn,
                  pressed && styles.dateNavBtnPressed,
                ]}
                onPress={() => changeDateByDays(1)}>
                <Text style={styles.dateNavBtnText}>Next ›</Text>
              </Pressable>
            </View>

            {/* Quick Date Shortcut Pills */}
            <View style={styles.dateShortcutsRow}>
              <Pressable
                style={[
                  styles.shortcutPill,
                  isToday && styles.shortcutPillActive,
                ]}
                onPress={() => setRelativeDay(0)}>
                <Text
                  style={[
                    styles.shortcutPillText,
                    isToday && styles.shortcutPillTextActive,
                  ]}>
                  Today
                </Text>
              </Pressable>

              <Pressable
                style={[
                  styles.shortcutPill,
                  isTomorrow && styles.shortcutPillActive,
                ]}
                onPress={() => setRelativeDay(1)}>
                <Text
                  style={[
                    styles.shortcutPillText,
                    isTomorrow && styles.shortcutPillTextActive,
                  ]}>
                  Tomorrow
                </Text>
              </Pressable>

              <Pressable
                style={styles.shortcutPill}
                onPress={() => setRelativeDay(2)}>
                <Text style={styles.shortcutPillText}>Day After</Text>
              </Pressable>
            </View>
          </View>

          {/* Section: Meals */}
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Daily Meals</Text>
            <Text style={styles.sectionMeta}>{selectedDateStr}</Text>
          </View>

          {loadingMenus ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="small" color="#0284C7" />
              <Text style={styles.loadingText}>Fetching meals for this date...</Text>
            </View>
          ) : (
            MEAL_ORDER.map((mealType) => {
              const menu = menus[mealType];
              const config = MEAL_CONFIG[mealType];
              const isEditingThis = editingMeal === mealType;

              return (
                <View key={mealType} style={styles.mealCard}>
                  {/* Meal Header */}
                  <View style={styles.mealHeaderRow}>
                    <View style={styles.mealHeaderLeft}>
                      <Text style={styles.mealIcon}>{config.icon}</Text>
                      <View>
                        <Text style={styles.mealTitle}>{config.title}</Text>
                        <Text style={styles.mealTimeHint}>{config.timeHint}</Text>
                      </View>
                    </View>

                    {/* Status Pill Badge */}
                    {menu ? (
                      <Pressable
                        hitSlop={6}
                        onPress={() => handleTogglePublish(menu)}
                        style={[
                          styles.publishedBadge,
                          menu.is_published
                            ? styles.publishedBadgeActive
                            : styles.publishedBadgeDraft,
                        ]}>
                        <View
                          style={[
                            styles.statusDot,
                            {
                              backgroundColor: menu.is_published
                                ? '#16A34A'
                                : '#94A3B8',
                            },
                          ]}
                        />
                        <Text
                          style={[
                            styles.publishedBadgeText,
                            {
                              color: menu.is_published ? '#15803D' : '#475569',
                            },
                          ]}>
                          {menu.is_published ? 'Published' : 'Draft'}
                        </Text>
                      </Pressable>
                    ) : (
                      <View style={styles.notSetBadge}>
                        <Text style={styles.notSetBadgeText}>Not set</Text>
                      </View>
                    )}
                  </View>

                  {/* Inline Edit Form when active */}
                  {isEditingThis ? (
                    <View style={styles.editFormBox}>
                      <Text style={styles.formSectionTitle}>
                        {menu ? `Edit ${config.title} Menu` : `Add ${config.title} Menu`}
                      </Text>

                      {/* Items Input */}
                      <Text style={styles.inputLabel}>
                        Food Items <Text style={{ color: '#EF4444' }}>*</Text>
                      </Text>
                      <TextInput
                        style={[styles.textInput, styles.textInputMultiline]}
                        placeholder={config.defaultPlaceholder}
                        placeholderTextColor="#94A3B8"
                        value={formItems}
                        onChangeText={setFormItems}
                        multiline
                        numberOfLines={3}
                        textAlignVertical="top"
                        editable={!savingMeal}
                      />

                      {/* Notes Input */}
                      <Text style={styles.inputLabel}>
                        Special Notes / Timings <Text style={{ color: '#94A3B8' }}>(Optional)</Text>
                      </Text>
                      <TextInput
                        style={styles.textInput}
                        placeholder="e.g., Special dessert or timing note"
                        placeholderTextColor="#94A3B8"
                        value={formNotes}
                        onChangeText={setFormNotes}
                        editable={!savingMeal}
                      />

                      {/* Publish Switch */}
                      <View style={styles.switchRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.switchTitle}>Publish Immediately</Text>
                          <Text style={styles.switchSubtitle}>
                            Visible to students on their portal
                          </Text>
                        </View>
                        <Switch
                          value={formPublished}
                          onValueChange={setFormPublished}
                          trackColor={{ false: '#CBD5E1', true: '#BAE6FD' }}
                          thumbColor={formPublished ? '#0284C7' : '#94A3B8'}
                          disabled={savingMeal}
                        />
                      </View>

                      {/* Form Action Buttons */}
                      <View style={styles.formBtnRow}>
                        <Pressable
                          style={styles.cancelBtn}
                          disabled={savingMeal}
                          onPress={closeEditForm}>
                          <Text style={styles.cancelBtnText}>Cancel</Text>
                        </Pressable>

                        <Pressable
                          style={[
                            styles.saveBtn,
                            savingMeal && styles.saveBtnDisabled,
                          ]}
                          disabled={savingMeal}
                          onPress={handleSaveMenu}>
                          {savingMeal ? (
                            <View style={styles.savingRow}>
                              <ActivityIndicator size="small" color="#FFFFFF" />
                              <Text style={styles.saveBtnText}>Saving...</Text>
                            </View>
                          ) : (
                            <Text style={styles.saveBtnText}>
                              {menu ? 'Save Changes' : '+ Save Menu'}
                            </Text>
                          )}
                        </Pressable>
                      </View>
                    </View>
                  ) : menu ? (
                    /* Display Menu Card */
                    <View style={styles.menuDisplayBox}>
                      <View style={styles.menuItemsList}>
                        <Text style={styles.menuItemsText}>{menu.items}</Text>
                      </View>

                      {menu.notes && (
                        <View style={styles.notesBox}>
                          <Text style={styles.notesIcon}>📝</Text>
                          <Text style={styles.notesText}>{menu.notes}</Text>
                        </View>
                      )}

                      {/* Actions Toolbar */}
                      <View style={styles.menuActionToolbar}>
                        <Pressable
                          accessibilityRole="button"
                          style={styles.editMenuBtn}
                          onPress={() => openEditForm(mealType)}>
                          <Text style={styles.editMenuBtnText}>✏️ Edit Menu</Text>
                        </Pressable>

                        <Pressable
                          accessibilityRole="button"
                          style={styles.deleteMenuBtn}
                          onPress={() => handleDeleteMenu(menu)}>
                          <Text style={styles.deleteMenuBtnText}>Delete</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    /* Empty State: Prompt to configure */
                    <View style={styles.emptyMealBox}>
                      <Text style={styles.emptyMealText}>
                        No menu configured for this meal yet.
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        style={styles.addMealBtn}
                        onPress={() => openEditForm(mealType)}>
                        <Text style={styles.addMealBtnText}>
                          + Add {config.title}
                        </Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            })
          )}

          {/* Bottom spacing */}
          <View style={{ height: BottomTabInset + 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  keyboardContainer: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 40,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  backButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginRight: 12,
    minHeight: 40,
    justifyContent: 'center',
  },
  backButtonPressed: {
    backgroundColor: '#F1F5F9',
  },
  backButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  titleWrapper: {
    flex: 1,
  },
  screenTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  screenSubtitle: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
    marginTop: 1,
  },
  propertyLoadingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    marginBottom: 16,
    gap: 8,
  },
  propertyLoadingText: {
    fontSize: 13,
    color: '#0284C7',
    fontWeight: '500',
  },
  propertyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    gap: 10,
  },
  propertyBadgeIcon: {
    fontSize: 20,
  },
  propertyBadgeDetails: {
    flex: 1,
  },
  propertyBadgeLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  propertyBadgeName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0369A1',
    marginTop: 1,
  },
  migrationNoticeBox: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FCD34D',
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
  },
  migrationNoticeTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#B45309',
    marginBottom: 4,
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
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
  },
  successIcon: {
    fontSize: 14,
    color: '#059669',
    fontWeight: '800',
    marginRight: 8,
  },
  successText: {
    flex: 1,
    fontSize: 13,
    color: '#065F46',
    fontWeight: '600',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  errorIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: '#DC2626',
    fontWeight: '500',
  },
  bannerDismiss: {
    fontSize: 14,
    color: '#64748B',
    fontWeight: '700',
    paddingHorizontal: 4,
  },
  dateSelectorCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 16,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 3,
      },
      android: {
        elevation: 1,
      },
    }),
  },
  dateNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  dateNavBtn: {
    backgroundColor: '#F1F5F9',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  dateNavBtnPressed: {
    backgroundColor: '#E2E8F0',
  },
  dateNavBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  dateCenterDisplay: {
    alignItems: 'center',
  },
  dateDisplayTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  todayPill: {
    marginTop: 4,
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  todayPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#15803D',
  },
  tomorrowPill: {
    marginTop: 4,
    backgroundColor: '#E0F2FE',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  tomorrowPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0369A1',
  },
  dateShortcutsRow: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
  },
  shortcutPill: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  shortcutPillActive: {
    backgroundColor: '#0284C7',
    borderColor: '#0284C7',
  },
  shortcutPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  shortcutPillTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  sectionMeta: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  loadingBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
    color: '#64748B',
  },
  mealCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 14,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 3,
      },
      android: {
        elevation: 1,
      },
    }),
  },
  mealHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    backgroundColor: '#FAFAFA',
  },
  mealHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  mealIcon: {
    fontSize: 22,
  },
  mealTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  mealTimeHint: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  publishedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 6,
  },
  publishedBadgeActive: {
    backgroundColor: '#DCFCE7',
  },
  publishedBadgeDraft: {
    backgroundColor: '#F1F5F9',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  publishedBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  notSetBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  notSetBadgeText: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '600',
  },
  menuDisplayBox: {
    padding: 16,
  },
  menuItemsList: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  menuItemsText: {
    fontSize: 14,
    color: '#1E293B',
    lineHeight: 22,
    fontWeight: '500',
  },
  notesBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FEF3C7',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 10,
    gap: 6,
  },
  notesIcon: {
    fontSize: 14,
  },
  notesText: {
    fontSize: 12,
    color: '#92400E',
    flex: 1,
  },
  menuActionToolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  editMenuBtn: {
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  editMenuBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0284C7',
  },
  deleteMenuBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  deleteMenuBtnText: {
    fontSize: 12,
    color: '#DC2626',
    fontWeight: '600',
  },
  emptyMealBox: {
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyMealText: {
    fontSize: 13,
    color: '#94A3B8',
    marginBottom: 12,
  },
  addMealBtn: {
    backgroundColor: '#0284C7',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  addMealBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  editFormBox: {
    padding: 16,
    backgroundColor: '#FFFFFF',
  },
  formSectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 12,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
    marginTop: 8,
  },
  textInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0F172A',
  },
  textInputMultiline: {
    minHeight: 72,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingVertical: 8,
  },
  switchTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
  },
  switchSubtitle: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  formBtnRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 16,
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  saveBtn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
    backgroundColor: '#0284C7',
    minWidth: 110,
    alignItems: 'center',
  },
  saveBtnDisabled: {
    backgroundColor: '#94A3B8',
  },
  saveBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  savingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
});

