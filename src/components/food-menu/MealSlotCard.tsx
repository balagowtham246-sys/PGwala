import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { FileText, Pencil, Trash2, Utensils } from 'lucide-react-native';

import { toSentenceCaseStatus } from '@/lib/ux-utils';
import {
  FoodMenuRecord,
  MEAL_CONFIG,
  MealType,
} from '@/services/food-menu.service';

export interface MealSlotCardProps {
  mealType: MealType;
  menu: FoodMenuRecord | null;
  onOpenEditForm: (mealType: MealType) => void;
  onTogglePublish: (menu: FoodMenuRecord) => void;
  onDeleteMenu: (menu: FoodMenuRecord) => void;
}

export function MealSlotCard({
  mealType,
  menu,
  onOpenEditForm,
  onTogglePublish,
  onDeleteMenu,
}: MealSlotCardProps) {
  const config = MEAL_CONFIG[mealType];
  const statusLabel = menu
    ? toSentenceCaseStatus(menu.is_published ? 'published' : 'draft')
    : 'Not set';

  return (
    <View style={styles.mealCard}>
      {/* Compact Header */}
      <View style={styles.mealHeaderRow}>
        <View style={styles.mealHeaderLeft}>
          <Utensils size={16} color="#0284C7" />
          <Text style={styles.mealTitle}>{config.title}</Text>
        </View>

        {menu ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${config.title} status ${statusLabel}. Tap to toggle publish status`}
            hitSlop={6}
            onPress={() => onTogglePublish(menu)}
            style={[
              styles.statusBadge,
              menu.is_published
                ? styles.statusBadgePublished
                : styles.statusBadgeDraft,
            ]}>
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor: menu.is_published ? '#16A34A' : '#94A3B8',
                },
              ]}
            />
            <Text
              style={[
                styles.statusBadgeText,
                {
                  color: menu.is_published ? '#15803D' : '#475569',
                },
              ]}>
              {statusLabel}
            </Text>
          </Pressable>
        ) : (
          <View style={styles.notSetBadge}>
            <Text style={styles.notSetBadgeText}>{statusLabel}</Text>
          </View>
        )}
      </View>

      {/* Compact Body */}
      {menu ? (
        <View style={styles.menuDisplayBox}>
          <Text style={styles.menuItemsText} numberOfLines={2}>
            {menu.items}
          </Text>

          {menu.notes ? (
            <View style={styles.notesRow}>
              <FileText size={12} color="#92400E" />
              <Text style={styles.notesText} numberOfLines={1}>
                {menu.notes}
              </Text>
            </View>
          ) : null}

          <View style={styles.menuActionToolbar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Edit ${config.title} Menu`}
              style={({ pressed }) => [
                styles.editMenuBtn,
                pressed && styles.editMenuBtnPressed,
              ]}
              onPress={() => onOpenEditForm(mealType)}>
              <Pencil size={13} color="#0284C7" />
              <Text style={styles.editMenuBtnText}>Edit Menu</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Delete ${config.title} Menu`}
              hitSlop={6}
              style={({ pressed }) => [
                styles.deleteMenuBtn,
                pressed && styles.deleteMenuBtnPressed,
              ]}
              onPress={() => onDeleteMenu(menu)}>
              <Trash2 size={13} color="#DC2626" />
              <Text style={styles.deleteMenuBtnText}>Delete Menu</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.emptyMealRow}>
          <Text style={styles.emptyMealText}>No menu set yet</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Add ${config.title} Menu`}
            style={({ pressed }) => [
              styles.addMealBtn,
              pressed && styles.addMealBtnPressed,
            ]}
            onPress={() => onOpenEditForm(mealType)}>
            <Text style={styles.addMealBtnText}>+ Add Menu</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  mealCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 10,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.04,
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
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    backgroundColor: '#FAFAFA',
  },
  mealHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mealTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    gap: 5,
  },
  statusBadgePublished: {
    backgroundColor: '#DCFCE7',
  },
  statusBadgeDraft: {
    backgroundColor: '#F1F5F9',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  notSetBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  notSetBadgeText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  menuDisplayBox: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  menuItemsText: {
    fontSize: 13.5,
    color: '#1E293B',
    lineHeight: 19,
    fontWeight: '500',
  },
  notesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FFFBEB',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginTop: 7,
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
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  editMenuBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    borderRadius: 8,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  editMenuBtnPressed: {
    backgroundColor: '#E0F2FE',
  },
  editMenuBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0284C7',
  },
  deleteMenuBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
  },
  deleteMenuBtnPressed: {
    backgroundColor: '#FEF2F2',
  },
  deleteMenuBtnText: {
    fontSize: 12,
    color: '#DC2626',
    fontWeight: '600',
  },
  emptyMealRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 10,
  },
  emptyMealText: {
    fontSize: 13,
    color: '#94A3B8',
    fontWeight: '500',
  },
  addMealBtn: {
    backgroundColor: '#0284C7',
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 8,
  },
  addMealBtnPressed: {
    backgroundColor: '#0369A1',
  },
  addMealBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
});
