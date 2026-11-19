import React from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Calendar, Save, Utensils } from 'lucide-react-native';

import { MealSlotCard } from '@/components/food-menu/MealSlotCard';
import { BottomTabInset, OwnerTheme } from '@/constants/theme';
import {
  FoodMenuRecord,
  MEAL_ORDER,
  MealMenuMap,
  MealType,
} from '@/services/food-menu.service';

export interface WeeklyMenuEditorProps {
  displayDate: string;
  selectedDateStr: string;
  isToday: boolean;
  isTomorrow: boolean;
  loadingMenus: boolean;
  refreshing: boolean;
  menus: MealMenuMap;
  applyingBulk: boolean;
  topNotice?: React.ReactNode;
  onRefresh: () => void;
  onChangeDateByDays: (delta: number) => void;
  onApplyWeeklyTemplate: () => void;
  onSaveWeeklyTemplate: () => void;
  onOpenEditForm: (mealType: MealType) => void;
  onTogglePublish: (menu: FoodMenuRecord) => void;
  onDeleteMenu: (menu: FoodMenuRecord) => void;
}

export function WeeklyMenuEditor({
  displayDate,
  selectedDateStr,
  isToday,
  isTomorrow,
  loadingMenus,
  refreshing,
  menus,
  applyingBulk,
  topNotice,
  onRefresh,
  onChangeDateByDays,
  onApplyWeeklyTemplate,
  onSaveWeeklyTemplate,
  onOpenEditForm,
  onTogglePublish,
  onDeleteMenu,
}: WeeklyMenuEditorProps) {
  return (
    <View style={styles.container}>
      {/* Pinned Top Date Navigation Bar */}
      <View style={styles.pinnedDateBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous day"
          style={({ pressed }) => [
            styles.dateNavBtn,
            pressed && styles.dateNavBtnPressed,
          ]}
          onPress={() => onChangeDateByDays(-1)}>
          <Text style={styles.dateNavBtnText}>‹ Prev</Text>
        </Pressable>

        <View style={styles.dateCenterDisplay}>
          <Text style={styles.dateDisplayTitle} numberOfLines={1}>
            {displayDate}
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
          accessibilityLabel="Next day"
          style={({ pressed }) => [
            styles.dateNavBtn,
            pressed && styles.dateNavBtnPressed,
          ]}
          onPress={() => onChangeDateByDays(1)}>
          <Text style={styles.dateNavBtnText}>Next ›</Text>
        </Pressable>
      </View>

      {/* Scrollable Meal Content */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[OwnerTheme.colors.primary]}
          />
        }>
        {topNotice}

        {/* Dinner Not Set Nudge */}
        {isToday && !loadingMenus && !menus.dinner && (
          <Pressable
            accessibilityRole="button"
            style={styles.dinnerNudgeBanner}
            onPress={() => onOpenEditForm('dinner')}>
            <Utensils size={14} color="#92400E" />
            <Text style={styles.dinnerNudgeText}>
              Dinner not set. Add before 5 PM ›
            </Text>
          </Pressable>
        )}

        {/* Weekly Template Bar (clean, unclipped 2-button row) */}
        <View style={styles.templateToolbar}>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.templateBtn,
              applyingBulk && styles.templateBtnDisabled,
              pressed && !applyingBulk && styles.templateBtnPressed,
            ]}
            disabled={applyingBulk}
            onPress={onApplyWeeklyTemplate}>
            <Calendar size={14} color="#0284C7" />
            <Text style={styles.templateBtnText} numberOfLines={1}>
              Apply Template
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.templateBtn,
              applyingBulk && styles.templateBtnDisabled,
              pressed && !applyingBulk && styles.templateBtnPressed,
            ]}
            disabled={applyingBulk}
            onPress={onSaveWeeklyTemplate}>
            <Save size={14} color="#334155" />
            <Text style={styles.templateBtnText} numberOfLines={1}>
              Save as Template
            </Text>
          </Pressable>
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
          MEAL_ORDER.map((mealType) => (
            <MealSlotCard
              key={mealType}
              mealType={mealType}
              menu={menus[mealType]}
              onOpenEditForm={onOpenEditForm}
              onTogglePublish={onTogglePublish}
              onDeleteMenu={onDeleteMenu}
            />
          ))
        )}

        <View style={{ height: BottomTabInset + 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  pinnedDateBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    gap: 8,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.04,
        shadowRadius: 2,
      },
      android: {
        elevation: 1,
      },
    }),
  },
  dateNavBtn: {
    backgroundColor: '#F1F5F9',
    paddingVertical: 7,
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
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
  },
  dateDisplayTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  todayPill: {
    marginTop: 3,
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 1.5,
    borderRadius: 10,
  },
  todayPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#15803D',
  },
  tomorrowPill: {
    marginTop: 3,
    backgroundColor: '#E0F2FE',
    paddingHorizontal: 8,
    paddingVertical: 1.5,
    borderRadius: 10,
  },
  tomorrowPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0369A1',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
  },
  dinnerNudgeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  dinnerNudgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#B45309',
  },
  templateToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  templateBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  templateBtnPressed: {
    backgroundColor: '#F8FAFC',
  },
  templateBtnDisabled: {
    opacity: 0.6,
  },
  templateBtnText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#0F172A',
    flexShrink: 1,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 15,
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
});
