import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Check, LogIn, LogOut } from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';
import { triggerLightHaptic, triggerSuccessHaptic } from '@/lib/haptics';
import {
  formatShortReturnDate,
  isOnMultiDayLeave,
  isOutOverHours,
} from '@/lib/movement-utils';
import { formatGateEventTimestamp, toSentenceCaseStatus } from '@/lib/ux-utils';
import type {
  MealType,
  ResidentFoodMenu,
  ResidentMovementRecord,
} from '@/services/dashboard.service';

interface ResidentQuickTilesProps {
  residentName?: string;
  roomLabel?: string;
  propertyName?: string;
  pendingDuesPaise: number | null;
  pendingRentPaise?: number | null;
  pendingEbPaise?: number | null;
  pendingReviewPaise?: number | null;
  currentMonthBillGenerated?: boolean;
  menus?: Record<MealType, ResidentFoodMenu | null>;
  latestMovement: ResidentMovementRecord | null;
  savingMovement: boolean;
  washingMachineSlot: React.ReactNode;
  onPressRentDue: () => void;
  onPressUpNextMeal?: () => void;
  onOpenGoingOut: () => void;
  onUpdateReturnDate?: () => void;
  onMarkBackIn: () => void;
}

export function ResidentQuickTiles({
  residentName,
  roomLabel,
  propertyName,
  pendingDuesPaise,
  pendingRentPaise = null,
  pendingEbPaise = null,
  pendingReviewPaise = null,
  currentMonthBillGenerated,
  latestMovement,
  savingMovement,
  washingMachineSlot,
  onPressRentDue,
  onOpenGoingOut,
  onUpdateReturnDate,
  onMarkBackIn,
}: ResidentQuickTilesProps) {
  const isInside = !latestMovement || latestMovement.direction === 'IN';
  const onLeave = isOnMultiDayLeave(latestMovement);
  const outNudge = onLeave
    ? { isOver: false, hoursOut: 0 }
    : isOutOverHours(latestMovement?.direction, latestMovement?.event_time);
  const formattedMovementTime = latestMovement?.event_time
    ? formatGateEventTimestamp(latestMovement.event_time)
    : '';
  const returnDateLabel = onLeave
    ? formatShortReturnDate(latestMovement?.expected_return_date)
    : '';

  const dueKindLabel =
    (pendingRentPaise ?? 0) > 0 && (pendingEbPaise ?? 0) > 0
      ? 'rent & EB due'
      : (pendingEbPaise ?? 0) > 0 && (pendingRentPaise ?? 0) === 0
        ? 'EB bill due'
        : (pendingRentPaise ?? 0) > 0
          ? 'rent due'
          : 'bill due';

  const billingState =
    pendingDuesPaise !== null && pendingDuesPaise > 0
      ? {
          dotColor: '#FB7185',
          title: `₹${(pendingDuesPaise / 100).toLocaleString('en-IN')} ${dueKindLabel}`,
          subtitle: 'Tap to view breakdown & pay',
          cta: 'Pay now ›',
          ctaColor: '#FDA4AF',
        }
      : pendingReviewPaise !== null && pendingReviewPaise > 0
        ? {
            dotColor: '#FBBF24',
            title: `₹${(pendingReviewPaise / 100).toLocaleString('en-IN')} under review`,
            subtitle: 'Proof submitted · Awaiting approval',
            cta: 'Details ›',
            ctaColor: '#FDE68A',
          }
        : currentMonthBillGenerated === false
          ? {
              dotColor: '#94A3B8',
              title: 'Monthly bill not generated yet',
              subtitle: 'Your PG owner will generate it soon',
              cta: 'Bills ›',
              ctaColor: '#CBD5E1',
            }
          : {
              dotColor: '#34D399',
              title: 'All bills settled',
              subtitle: 'View receipts & monthly summary',
              cta: 'Receipts ›',
              ctaColor: '#6EE7B7',
            };

  return (
    <>
      {/* Fintech-Modern Dark-Slate Resident Pass Hero Card */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${billingState.title}. Open monthly bills`}
        style={({ pressed }) => [styles.residentHeroCard, pressed && styles.btnPressed]}
        onPress={onPressRentDue}>
        <View style={styles.residentHeroTopRow}>
          <View style={styles.residentHeroNameCol}>
            <Text style={styles.residentHeroGreeting} numberOfLines={1}>
              {residentName ? `Hi, ${residentName}` : 'Welcome back'}
            </Text>
            {propertyName ? (
              <Text style={styles.residentHeroProp} numberOfLines={1}>
                {propertyName}
              </Text>
            ) : null}
          </View>
          {roomLabel ? (
            <View style={styles.residentHeroRoomPill}>
              <Text style={styles.residentHeroRoomText}>{roomLabel}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.residentHeroBillStrip}>
          <View style={styles.residentHeroBillLeft}>
            <View
              style={[
                styles.residentHeroDot,
                { backgroundColor: billingState.dotColor },
              ]}
            />
            <View style={styles.residentHeroBillTextCol}>
              <Text style={styles.residentHeroBillTitle} numberOfLines={1}>
                {billingState.title}
              </Text>
              <Text style={styles.residentHeroBillSub} numberOfLines={1}>
                {billingState.subtitle}
              </Text>
            </View>
          </View>
          <Text
            style={[
              styles.residentHeroBillCta,
              { color: billingState.ctaColor },
            ]}>
            {billingState.cta}
          </Text>
        </View>
      </Pressable>

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
                isInside
                  ? styles.gatePillIn
                  : onLeave
                    ? { backgroundColor: '#EDE9FE' }
                    : styles.gatePillOut,
              ]}>
              <Text
                style={[
                  styles.gatePillText,
                  isInside
                    ? styles.gateTextIn
                    : onLeave
                      ? { color: '#6D28D9' }
                      : styles.gateTextOut,
                ]}>
                {onLeave
                  ? 'On leave'
                  : toSentenceCaseStatus(isInside ? 'inside' : 'outside')}
              </Text>
            </View>
          </View>

          <Text style={styles.gateTitle}>Gate Attendance</Text>
          <Text style={styles.gateSubtitle} numberOfLines={1}>
            {onLeave
              ? `Returns ${returnDateLabel} · Meals paused`
              : formattedMovementTime
                ? `${isInside ? 'Checked in' : 'Checked out'}: ${formattedMovementTime}`
                : 'Checked in'}
          </Text>
          {!isInside && !onLeave && outNudge.isOver && (
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
              <View style={{ gap: 6 }}>
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
                {onLeave && onUpdateReturnDate && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Update leave return date"
                    disabled={savingMovement}
                    style={({ pressed }) => [
                      {
                        alignItems: 'center',
                        paddingVertical: 4,
                      },
                      pressed && styles.btnPressed,
                    ]}
                    onPress={() => {
                      triggerLightHaptic();
                      onUpdateReturnDate();
                    }}>
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: '700',
                        color: '#6D28D9',
                      }}>
                      Update return date
                    </Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  residentHeroCard: {
    backgroundColor: '#0F172A',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1E293B',
    gap: 14,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 5,
  },
  residentHeroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  residentHeroNameCol: {
    flex: 1,
    minWidth: 0,
  },
  residentHeroGreeting: {
    fontSize: 21,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.4,
  },
  residentHeroProp: {
    fontSize: 12,
    fontWeight: '500',
    color: '#94A3B8',
    marginTop: 2,
  },
  residentHeroRoomPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(56, 189, 248, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
  },
  residentHeroRoomText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#7DD3FC',
  },
  residentHeroBillStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
  },
  residentHeroBillLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  residentHeroDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    flexShrink: 0,
  },
  residentHeroBillTextCol: {
    flex: 1,
    minWidth: 0,
  },
  residentHeroBillTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  residentHeroBillSub: {
    fontSize: 11,
    fontWeight: '500',
    color: '#94A3B8',
    marginTop: 1,
  },
  residentHeroBillCta: {
    fontSize: 12,
    fontWeight: '700',
    flexShrink: 0,
  },
  heroRow: {
    flexDirection: 'row',
    gap: 10,
  },
  gateHeroCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 13,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    justifyContent: 'space-between',
    minHeight: 144,
    ...OwnerTheme.shadow,
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
    letterSpacing: 0.2,
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
