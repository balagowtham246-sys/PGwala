import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Utensils } from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';
import { triggerSelectionHaptic } from '@/lib/haptics';
import { formatHhMmTo12h } from '@/lib/ux-utils';
import type { MealType, ResidentFoodMenu } from '@/services/dashboard.service';

const MEAL_CONFIG: Record<MealType, { title: string; timeHint: string }> = {
  breakfast: {
    title: 'Breakfast',
    timeHint: 'Morning (7:30 AM – 9:30 AM)',
  },
  lunch: {
    title: 'Lunch',
    timeHint: 'Afternoon (12:30 PM – 2:30 PM)',
  },
  dinner: {
    title: 'Dinner',
    timeHint: 'Night (8:00 PM – 10:00 PM)',
  },
};

type MenuWithOptionalTime = ResidentFoodMenu & {
  meal_time?: string | null;
};

interface TodaysMenuPreviewProps {
  menus: Record<MealType, MenuWithOptionalTime | null>;
  activeMealTab: MealType;
  onSelectMealTab: (meal: MealType) => void;
  onPressFullMenu: () => void;
}

export function TodaysMenuPreview({
  menus,
  activeMealTab,
  onSelectMealTab,
  onPressFullMenu,
}: TodaysMenuPreviewProps) {
  const activeMenu = menus[activeMealTab];
  const mealTimeLabel = activeMenu?.meal_time
    ? formatHhMmTo12h(activeMenu.meal_time)
    : '';

  return (
    <View style={styles.menuCard}>
      <View style={styles.menuHeader}>
        <View style={styles.menuHeaderLeft}>
          <Utensils size={16} color={OwnerTheme.colors.primary} />
          <Text style={styles.menuTitle}>Today&apos;s Food Menu</Text>
        </View>
        <Pressable accessibilityRole="button" hitSlop={8} onPress={onPressFullMenu}>
          <Text style={styles.menuPublishedHint}>Full Menu ›</Text>
        </Pressable>
      </View>

      {/* 3-Chip Meal Selector */}
      <View style={styles.mealSegmentRow}>
        {(['breakfast', 'lunch', 'dinner'] as MealType[]).map((mealKey) => {
          const cfg = MEAL_CONFIG[mealKey];
          const hasMenu = Boolean(menus[mealKey]);
          const isSelected = activeMealTab === mealKey;

          return (
            <Pressable
              key={mealKey}
              accessibilityRole="button"
              style={[
                styles.mealSegmentChip,
                isSelected && styles.mealSegmentChipSelected,
              ]}
              onPress={() => {
                triggerSelectionHaptic();
                onSelectMealTab(mealKey);
              }}>
              <Text
                style={[
                  styles.mealChipText,
                  isSelected && styles.mealChipTextSelected,
                ]}>
                {cfg.title}
              </Text>
              <View
                style={[
                  styles.mealDot,
                  hasMenu ? styles.mealDotActive : styles.mealDotInactive,
                ]}
              />
            </Pressable>
          );
        })}
      </View>

      {/* In-Place Selected Meal Details */}
      <View style={styles.mealDetailBox}>
        <View style={styles.mealDetailTop}>
          <View style={styles.mealDetailTitleRow}>
            <Text style={styles.mealDetailTitle}>
              {MEAL_CONFIG[activeMealTab].title}
            </Text>
            {mealTimeLabel ? (
              <View style={styles.mealTimePill}>
                <Text style={styles.mealTimeText}>{mealTimeLabel}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {activeMenu ? (
          <View style={styles.mealItemsContainer}>
            <Text style={styles.mealItemsText}>{activeMenu.items}</Text>
            {activeMenu.notes ? (
              <Text style={styles.mealNotesText}>Note: {activeMenu.notes}</Text>
            ) : null}
          </View>
        ) : (
          <View style={styles.emptyMealRow}>
            <View style={styles.emptyMealIcon}>
              <Utensils size={14} color={OwnerTheme.colors.textMuted} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.noMenuText}>
                No menu published for {MEAL_CONFIG[activeMealTab].title.toLowerCase()} yet
              </Text>
              <Pressable hitSlop={6} onPress={onPressFullMenu}>
                <Text style={styles.emptyMealLink}>View full week ›</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  menuCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 12,
  },
  menuHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  menuHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  menuTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  menuPublishedHint: {
    fontSize: 11,
    color: OwnerTheme.colors.textMuted,
  },
  mealSegmentRow: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: OwnerTheme.radius.sm,
    padding: 3,
    gap: 4,
  },
  mealSegmentChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    borderRadius: 6,
    gap: 4,
  },
  mealSegmentChipSelected: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  mealChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  mealChipTextSelected: {
    color: OwnerTheme.colors.textPrimary,
    fontWeight: '700',
  },
  mealDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  mealDotActive: {
    backgroundColor: OwnerTheme.colors.success,
  },
  mealDotInactive: {
    backgroundColor: '#CBD5E1',
  },
  mealDetailBox: {
    marginTop: 10,
    padding: 10,
    backgroundColor: OwnerTheme.colors.surfaceElevated,
    borderRadius: OwnerTheme.radius.sm,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.borderLight,
  },
  mealDetailTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  mealDetailTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  mealDetailTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  mealTimePill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: OwnerTheme.radius.full,
    backgroundColor: OwnerTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  mealTimeText: {
    fontSize: 11,
    fontWeight: '600',
    color: OwnerTheme.colors.primary,
  },
  mealItemsContainer: {
    gap: 4,
  },
  mealItemsText: {
    fontSize: 13,
    color: OwnerTheme.colors.textPrimary,
    lineHeight: 18,
    fontWeight: '500',
  },
  mealNotesText: {
    fontSize: 11,
    color: OwnerTheme.colors.textSecondary,
    fontStyle: 'italic',
  },
  emptyMealRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  emptyMealIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: OwnerTheme.colors.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyMealLink: {
    fontSize: 12,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
    marginTop: 2,
  },
  noMenuText: {
    fontSize: 12,
    color: OwnerTheme.colors.textMuted,
    fontStyle: 'italic',
    paddingVertical: 4,
  },
});
