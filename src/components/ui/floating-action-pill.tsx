import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { LucideIcon } from 'lucide-react-native';

import { BottomTabInset, OwnerTheme } from '@/constants/theme';
import { triggerSelectionHaptic } from '@/lib/haptics';

export interface FloatingActionPillProps {
  label: string;
  icon: LucideIcon;
  onPress: () => void;
  hasBottomNav?: boolean;
  color?: string;
  accessibilityLabel?: string;
}

export function FloatingActionPill({
  label,
  icon: Icon,
  onPress,
  hasBottomNav = false,
  color = OwnerTheme.colors.primary,
  accessibilityLabel,
}: FloatingActionPillProps) {
  const insets = useSafeAreaInsets();
  const bottomOffset = hasBottomNav
    ? BottomTabInset + 14
    : Math.max(insets.bottom, 14) + 10;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: color, bottom: bottomOffset },
        pressed && styles.pressed,
      ]}
      onPress={() => {
        triggerSelectionHaptic();
        onPress();
      }}>
      <Icon size={16} color="#FFFFFF" />
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    right: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 999,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 8,
  },
  pressed: {
    opacity: 0.82,
    transform: [{ scale: 0.98 }],
  },
  label: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});
