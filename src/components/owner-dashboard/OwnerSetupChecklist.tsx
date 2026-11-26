import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check, ChevronRight, Sparkles } from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';

export interface OwnerSetupChecklistProps {
  hasUpiOrCurfew: boolean;
  hasRooms: boolean;
  hasResidents: boolean;
  onPressUpiCurfew: () => void;
  onPressCreateRooms: () => void;
  onPressAddResident: () => void;
}

export function OwnerSetupChecklist({
  hasUpiOrCurfew,
  hasRooms,
  hasResidents,
  onPressUpiCurfew,
  onPressCreateRooms,
  onPressAddResident,
}: OwnerSetupChecklistProps) {
  const steps = [
    {
      key: 'upi',
      stepNum: 1,
      title: 'Add UPI & Curfew',
      subtitle: 'Enable 1-tap UPI rent & gate rules',
      done: hasUpiOrCurfew,
      onPress: onPressUpiCurfew,
    },
    {
      key: 'rooms',
      stepNum: 2,
      title: 'Create Rooms',
      subtitle: 'Set bed capacity for your Bed Map',
      done: hasRooms,
      onPress: onPressCreateRooms,
    },
    {
      key: 'residents',
      stepNum: 3,
      title: 'Add or Invite Resident',
      subtitle: 'Add manually or share PG Invite QR',
      done: hasResidents,
      onPress: onPressAddResident,
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;

  // Permanently auto-hide once all 3 Day-1 setup steps are complete
  if (completedCount === steps.length) {
    return null;
  }

  const progressPct = Math.round((completedCount / steps.length) * 100);

  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <View style={styles.titleRow}>
          <Sparkles size={15} color={OwnerTheme.colors.primary} />
          <Text style={styles.title}>Quick Setup</Text>
        </View>
        <View style={styles.progressPill}>
          <Text style={styles.progressPillText}>
            {completedCount}/{steps.length} done
          </Text>
        </View>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
      </View>

      <View style={styles.stepsList}>
        {steps.map((step, idx) => (
          <Pressable
            key={step.key}
            accessibilityRole="button"
            accessibilityLabel={`${step.title}, ${step.done ? 'completed' : 'pending'}`}
            style={({ pressed }) => [
              styles.stepRow,
              idx < steps.length - 1 && styles.stepDivider,
              pressed && styles.stepPressed,
            ]}
            onPress={step.onPress}>
            <View
              style={[
                styles.stepBadge,
                step.done ? styles.stepBadgeDone : styles.stepBadgePending,
              ]}>
              {step.done ? (
                <Check size={13} color="#FFFFFF" strokeWidth={3} />
              ) : (
                <Text style={styles.stepBadgeText}>{step.stepNum}</Text>
              )}
            </View>
            <View style={styles.stepTextCol}>
              <Text
                style={[styles.stepTitle, step.done && styles.stepTitleDone]}
                numberOfLines={1}>
                {step.title}
              </Text>
              {!step.done && (
                <Text style={styles.stepSub} numberOfLines={1}>
                  {step.subtitle}
                </Text>
              )}
            </View>
            {!step.done && (
              <ChevronRight size={16} color={OwnerTheme.colors.textMuted} />
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: OwnerTheme.colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#BAE6FD',
    padding: 14,
    marginBottom: 12,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    fontSize: 14,
    fontWeight: '800',
    color: OwnerTheme.colors.textPrimary,
  },
  progressPill: {
    backgroundColor: OwnerTheme.colors.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  progressPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  progressTrack: {
    height: 5,
    borderRadius: 999,
    backgroundColor: '#E2E8F0',
    overflow: 'hidden',
    marginBottom: 10,
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: OwnerTheme.colors.primary,
  },
  stepsList: {
    gap: 2,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  stepDivider: {
    borderBottomWidth: 1,
    borderBottomColor: OwnerTheme.colors.borderLight,
  },
  stepPressed: {
    opacity: 0.72,
  },
  stepBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadgeDone: {
    backgroundColor: OwnerTheme.colors.success,
  },
  stepBadgePending: {
    backgroundColor: OwnerTheme.colors.primaryLight,
    borderWidth: 1,
    borderColor: '#7DD3FC',
  },
  stepBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: OwnerTheme.colors.primary,
  },
  stepTextCol: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  stepTitleDone: {
    color: OwnerTheme.colors.textMuted,
    textDecorationLine: 'line-through',
  },
  stepSub: {
    fontSize: 11,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 1,
  },
});
