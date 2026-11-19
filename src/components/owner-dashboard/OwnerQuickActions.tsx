import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Href, router } from 'expo-router';
import { Users } from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';

interface OwnerQuickActionsProps {
  totalResidents: number;
  studentsInside: number;
  unpaidResidentsCount?: number;
}

export function OwnerQuickActions({
  totalResidents,
  studentsInside,
  unpaidResidentsCount = 0,
}: OwnerQuickActionsProps) {
  return (
    <View style={styles.summaryCard}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="View residents directory"
        style={({ pressed }) => [styles.summaryMainPress, pressed && styles.cardPressed]}
        onPress={() => router.push('/residents-directory' as Href)}>
        <View style={styles.iconWrap}>
          <Users size={18} color={OwnerTheme.colors.primary} />
        </View>
        <View style={styles.textWrap}>
          <Text style={styles.title}>Residents</Text>
          <Text style={styles.subtitle}>
            {`${totalResidents} residents · ${studentsInside} inside · ${unpaidResidentsCount} with dues`}
          </Text>
        </View>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add new resident"
        style={({ pressed }) => [styles.addBtn, pressed && styles.cardPressed]}
        onPress={() => router.push('/add-resident')}>
        <Text style={styles.addBtnText}>+ Add Resident</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    paddingRight: 12,
    gap: 8,
    ...OwnerTheme.shadow,
  },
  summaryMainPress: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingLeft: 12,
    gap: 10,
    minWidth: 0,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: OwnerTheme.radius.sm,
    backgroundColor: OwnerTheme.colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  textWrap: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  subtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: OwnerTheme.colors.textSecondary,
    marginTop: 2,
  },
  addBtn: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: OwnerTheme.radius.full,
    backgroundColor: OwnerTheme.colors.primaryLight,
    borderWidth: 1,
    borderColor: '#BAE6FD',
    flexShrink: 0,
  },
  addBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  cardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
});
