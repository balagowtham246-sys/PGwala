import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  Wrench,
  Utensils,
  Home,
  DoorOpen,
  Receipt,
  LucideIcon,
} from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useResidentTabs } from '@/context/resident-tabs-context';
import { triggerSelectionHaptic } from '@/lib/haptics';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';

export type BottomNavTab = 'maintenance' | 'menu' | 'home' | 'gate' | 'bill';

interface BottomNavProps {
  activeTab: BottomNavTab;
  roleOverride?: 'owner' | 'student';
  isPagerShell?: boolean;
  onSelectTab?: (tab: BottomNavTab) => void;
}

interface TabConfig {
  key: BottomNavTab;
  label: string;
  icon: LucideIcon;
  ownerRoute: string;
  studentRoute: string;
}

const TABS: TabConfig[] = [
  {
    key: 'maintenance',
    label: 'Maintenance',
    icon: Wrench,
    ownerRoute: '/owner-complaints',
    studentRoute: '/resident-complaints',
  },
  {
    key: 'menu',
    label: 'Menu',
    icon: Utensils,
    ownerRoute: '/food-menu',
    studentRoute: '/resident-menu',
  },
  {
    key: 'home',
    label: 'Home',
    icon: Home,
    ownerRoute: '/owner-tabs',
    studentRoute: '/resident-tabs',
  },
  {
    key: 'gate',
    label: 'Gate',
    icon: DoorOpen,
    ownerRoute: '/resident-in-out',
    studentRoute: '/resident-gate-history',
  },
  {
    key: 'bill',
    label: 'Bill',
    icon: Receipt,
    ownerRoute: '/billing-management',
    studentRoute: '/resident-billing',
  },
];

export function RoleBottomNav({
  activeTab,
  roleOverride,
  isPagerShell = false,
  onSelectTab,
}: BottomNavProps) {
  const { profile } = useAuth();
  const { isInsidePager } = useResidentTabs();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const effectiveRole = roleOverride ?? (profile?.role === 'owner' ? 'owner' : 'student');

  // Inside the swipeable resident-tabs pager, only the shell renders the pinned bottom bar.
  if (isInsidePager && !isPagerShell) {
    return null;
  }

  const handlePress = (tab: TabConfig) => {
    if (tab.key === activeTab) return;
    triggerSelectionHaptic();
    if (onSelectTab) {
      onSelectTab(tab.key);
      return;
    }
    const target = effectiveRole === 'owner' ? tab.ownerRoute : tab.studentRoute;
    router.replace(target as any);
  };

  return (
    <Animated.View
      entering={reducedMotion ? undefined : FadeIn.duration(OwnerTheme.motion.duration.fast)}
      style={[
        styles.container,
        { paddingBottom: Math.max(insets.bottom, OwnerTheme.spacing.sm) },
      ]}>
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = tab.key === activeTab;
        const isHome = tab.key === 'home';

        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={tab.label}
            hitSlop={6}
            onPress={() => handlePress(tab)}
            style={({ pressed }) => [
              styles.tabItem,
              pressed && styles.tabItemPressed,
            ]}>
            <View
              style={[
                styles.iconWrap,
                isHome && styles.homeIconWrap,
                isActive && (isHome ? styles.homeIconWrapActive : styles.iconWrapActive),
              ]}>
              <Icon
                size={isHome ? 21 : 19}
                color={
                  isActive
                    ? isHome
                      ? '#FFFFFF'
                      : OwnerTheme.colors.primary
                    : isHome
                      ? OwnerTheme.colors.primary
                      : OwnerTheme.colors.textSecondary
                }
                strokeWidth={isActive ? 2.4 : 2}
              />
            </View>
            <Text
              numberOfLines={1}
              style={[
                styles.label,
                isActive && styles.labelActive,
              ]}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: OwnerTheme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: OwnerTheme.colors.border,
    paddingTop: OwnerTheme.spacing.sm,
    paddingHorizontal: OwnerTheme.spacing.xs,
    ...OwnerTheme.shadowElevated,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    gap: 3,
  },
  tabItemPressed: {
    opacity: 0.72,
  },
  iconWrap: {
    width: 38,
    height: 28,
    borderRadius: OwnerTheme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapActive: {
    backgroundColor: OwnerTheme.colors.primaryLight,
  },
  homeIconWrap: {
    width: 44,
    height: 32,
    borderRadius: OwnerTheme.radius.full,
    backgroundColor: OwnerTheme.colors.primarySoft,
  },
  homeIconWrapActive: {
    backgroundColor: OwnerTheme.colors.primary,
  },
  label: {
    fontSize: 11,
    fontWeight: '500',
    color: OwnerTheme.colors.textSecondary,
  },
  labelActive: {
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
});
