import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Check, ChevronRight, LogIn, LogOut, Receipt } from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';
import { triggerLightHaptic, triggerSuccessHaptic } from '@/lib/haptics';
import { isOutOverHours } from '@/lib/movement-utils';
import { getNextUpcomingMeal } from '@/lib/resident-home-utils';
import type {
  MealType,
  ResidentFoodMenu,
  ResidentMovementRecord,
} from '@/services/dashboard.service';

const MEAL_TITLES: Record<MealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
};

function formatMovementTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return isoString;
  }
}

interface ResidentQuickTilesProps {
  pendingDuesPaise: number | null;
  menus: Record<MealType, ResidentFoodMenu | null>;
  latestMovement: ResidentMovementRecord | null;
  savingMovement: boolean;
  washingMachineSlot: React.ReactNode;
  onPressRentDue: () => void;
  onPressUpNextMeal: () => void;
  onOpenGoingOut: () => void;
  onMarkBackIn: () => void;
}

export function ResidentQuickTiles({
  pendingDuesPaise,
  menus,
  latestMovement,
  savingMovement,
  washingMachineSlot,
  onPressRentDue,
  onPressUpNextMeal,
  onOpenGoingOut,
  onMarkBackIn,
}: ResidentQuickTilesProps) {
  const isInside = !latestMovement || latestMovement.direction === 'IN';
  const outNudge = isOutOverHours(latestMovement?.direction, latestMovement?.event_time);
  const nextMeal = getNextUpcomingMeal();
  const nextMealMenu = menus[nextMeal];

  return (
    <>
      {/* Lead Hero Card: Pending Rent or Next Upcoming Meal */}
      {pendingDuesPaise !== null && pendingDuesPaise > 0 ? (
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.heroFocusCard,
            styles.heroFocusCardDue,
            pressed && styles.btnPressed,
          ]}
          onPress={onPressRentDue}>
          <View style={styles.heroFocusLeft}>
            <Text style={styles.heroFocusLabelDue}>RENT DUE</Text>
            <Text style={styles.heroFocusTitle}>
              ₹{(pendingDuesPaise / 100).toLocaleString('en-IN')} due
            </Text>
            <Text style={styles.heroFocusSub}>Tap to view breakdown & pay ›</Text>
          </View>
          <Receipt size={24} color={OwnerTheme.colors.danger} />
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.heroFocusCard, pressed && styles.btnPressed]}
          onPress={onPressUpNextMeal}>
          <View style={styles.heroFocusLeft}>
            <Text style={styles.heroFocusLabel}>UP NEXT • RENT ₹0 DUE</Text>
            <Text style={styles.heroFocusTitle}>{MEAL_TITLES[nextMeal]}</Text>
            <Text style={styles.heroFocusSub} numberOfLines={1}>
              {nextMealMenu
                ? nextMealMenu.items
                : 'All rent & dues settled for this month'}
            </Text>
          </View>
          <ChevronRight size={20} color={OwnerTheme.colors.primary} />
        </Pressable>
      )}

      {/* Top 2: 1 x 2 Hero Section (Washing Machine & Gate Attendance Side-by-Side) */}
      <View style={styles.heroRow}>
        {washingMachineSlot}

        {/* Right Column: Gate Attendance Marking System */}
        <View style={styles.gateHeroCard}>
          <View style={styles.gateHeaderRow}>
            <View
              style={[
                styles.gateIconCircle,
                isInside ? styles.gateIconIn : styles.gateIconOut,
              ]}>
              {isInside ? (
                <LogIn size={18} color={OwnerTheme.colors.success} />
              ) : (
                <LogOut size={18} color={OwnerTheme.colors.warning} />
              )}
            </View>
            <View
              style={[
                styles.gatePill,
                isInside ? styles.gatePillIn : styles.gatePillOut,
              ]}>
              <Text
                style={[
                  styles.gatePillText,
                  isInside ? styles.gateTextIn : styles.gateTextOut,
                ]}>
                {isInside ? 'INSIDE' : 'OUTSIDE'}
              </Text>
            </View>
          </View>

          <Text style={styles.gateTitle}>Gate Attendance</Text>
          <Text style={styles.gateSubtitle} numberOfLines={1}>
            {latestMovement?.event_time
              ? `${isInside ? 'In since' : 'Out at'} ${formatMovementTime(latestMovement.event_time)}`
              : 'Present on campus'}
          </Text>
          {!isInside && outNudge.isOver && (
            <Text style={styles.gateOverHoursNudge}>
              Out for {outNudge.hoursOut}+ hrs • Remember to mark Inside
            </Text>
          )}

          <View style={styles.gateActionWrap}>
            {isInside ? (
              <Pressable
                style={({ pressed }) => [
                  styles.gateActionBtn,
                  styles.gateOutBtn,
                  pressed && styles.btnPressed,
                ]}
                onPress={() => {
                  triggerLightHaptic();
                  onOpenGoingOut();
                }}>
                <Text style={styles.gateOutBtnText}>Going Out</Text>
              </Pressable>
            ) : (
              <Pressable
                style={({ pressed }) => [
                  styles.gateActionBtn,
                  styles.gateInBtn,
                  pressed && styles.btnPressed,
                  savingMovement && styles.btnDisabled,
                ]}
                disabled={savingMovement}
                onPress={() => {
                  triggerSuccessHaptic();
                  onMarkBackIn();
                }}>
                {savingMovement ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <Check size={14} color="#FFFFFF" />
                    <Text style={styles.gateInBtnText}>Mark Inside</Text>
                  </View>
                )}
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  heroFocusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    borderLeftWidth: 4,
    borderLeftColor: OwnerTheme.colors.primary,
    padding: 16,
    ...OwnerTheme.shadow,
  },
  heroFocusCardDue: {
    borderLeftColor: OwnerTheme.colors.danger,
    backgroundColor: '#FFFBFB',
  },
  heroFocusLeft: {
    flex: 1,
    gap: 3,
  },
  heroFocusLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
    letterSpacing: 0.6,
  },
  heroFocusLabelDue: {
    fontSize: 11,
    fontWeight: '700',
    color: OwnerTheme.colors.danger,
    letterSpacing: 0.6,
  },
  heroFocusTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: OwnerTheme.colors.textPrimary,
  },
  heroFocusSub: {
    fontSize: 13,
    color: OwnerTheme.colors.textSecondary,
  },
  heroRow: {
    flexDirection: 'row',
    gap: 10,
  },
  gateHeroCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    padding: 12,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    justifyContent: 'space-between',
    minHeight: 140,
  },
  gateHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  gateIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gateIconIn: {
    backgroundColor: OwnerTheme.colors.successLight,
  },
  gateIconOut: {
    backgroundColor: OwnerTheme.colors.warningLight,
  },
  gatePill: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 9999,
  },
  gatePillIn: {
    backgroundColor: OwnerTheme.colors.successLight,
  },
  gatePillOut: {
    backgroundColor: OwnerTheme.colors.warningLight,
  },
  gatePillText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  gateTextIn: {
    color: OwnerTheme.colors.success,
  },
  gateTextOut: {
    color: OwnerTheme.colors.warning,
  },
  gateTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
    marginTop: 6,
  },
  gateSubtitle: {
    fontSize: 11,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 1,
  },
  gateOverHoursNudge: {
    fontSize: 11,
    fontWeight: '700',
    color: OwnerTheme.colors.warning,
    marginTop: 4,
  },
  gateActionWrap: {
    marginTop: 10,
  },
  gateActionBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: OwnerTheme.radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gateOutBtn: {
    backgroundColor: OwnerTheme.colors.warning,
  },
  gateOutBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  gateInBtn: {
    backgroundColor: OwnerTheme.colors.success,
  },
  gateInBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  btnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  btnDisabled: {
    opacity: 0.6,
  },
});
