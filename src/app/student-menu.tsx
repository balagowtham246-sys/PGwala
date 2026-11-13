import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/lib/supabase';
import { OwnerHeader, EmptyState } from '@/components/ui/owner';
import { RoleBottomNav } from '@/components/ui/bottom-nav';

type MealType = 'breakfast' | 'lunch' | 'dinner';

interface StudentFoodMenuItem {
  id: string;
  meal_type: MealType;
  items: string;
  notes: string | null;
}

const MEAL_META: Record<MealType, { title: string; icon: string; timeHint: string }> = {
  breakfast: { title: 'Breakfast', icon: '🍳', timeHint: '7:30 AM – 9:30 AM' },
  lunch: { title: 'Lunch', icon: '🍛', timeHint: '12:30 PM – 2:30 PM' },
  dinner: { title: 'Dinner', icon: '🍲', timeHint: '8:00 PM – 10:00 PM' },
};

function getTodayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function StudentMenuScreen() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [propertyName, setPropertyName] = useState('Mess Menu');
  const [menus, setMenus] = useState<Record<MealType, StudentFoodMenuItem | null>>({
    breakfast: null,
    lunch: null,
    dinner: null,
  });

  const loadMenu = useCallback(async () => {
    if (!user?.id) return;
    try {
      const { data: resData } = await supabase
        .from('residents')
        .select('property_id, property:properties(name)')
        .eq('profile_id', user.id)
        .eq('is_active', true)
        .maybeSingle();

      if (!resData?.property_id) {
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const propObj = Array.isArray(resData.property) ? resData.property[0] : resData.property;
      if (propObj?.name) setPropertyName(propObj.name);

      const { data: menuData } = await supabase
        .from('food_menus')
        .select('id, meal_type, items, notes')
        .eq('property_id', resData.property_id)
        .eq('menu_date', getTodayIso())
        .eq('is_published', true);

      const map: Record<MealType, StudentFoodMenuItem | null> = {
        breakfast: null,
        lunch: null,
        dinner: null,
      };
      if (menuData) {
        for (const item of menuData as StudentFoodMenuItem[]) {
          if (['breakfast', 'lunch', 'dinner'].includes(item.meal_type)) {
            map[item.meal_type] = item;
          }
        }
      }
      setMenus(map);
    } catch (err) {
      console.warn('[StudentMenu] Load error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadMenu();
  }, [loadMenu]);

  const hasAnyMenu = Boolean(menus.breakfast || menus.lunch || menus.dinner);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <OwnerHeader title="Today's Mess Menu" subtitle={propertyName} />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              loadMenu();
            }}
            colors={[OwnerTheme.colors.primary]}
          />
        }>
        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color={OwnerTheme.colors.primary} />
          </View>
        ) : !hasAnyMenu ? (
          <EmptyState
            title="Menu Not Published Yet"
            description="Your PG owner hasn't published today's meals yet. Check back shortly."
          />
        ) : (
          (['breakfast', 'lunch', 'dinner'] as MealType[]).map((mealKey) => {
            const meta = MEAL_META[mealKey];
            const entry = menus[mealKey];
            return (
              <View key={mealKey} style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.mealIcon}>{meta.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.mealTitle}>{meta.title}</Text>
                    <Text style={styles.mealTime}>{meta.timeHint}</Text>
                  </View>
                </View>
                <Text style={styles.mealItems}>
                  {entry ? entry.items : 'Not published yet'}
                </Text>
                {entry?.notes ? <Text style={styles.mealNotes}>{entry.notes}</Text> : null}
              </View>
            );
          })
        )}
      </ScrollView>
      <RoleBottomNav activeTab="menu" roleOverride="student" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: OwnerTheme.colors.background,
  },
  scrollContent: {
    padding: OwnerTheme.spacing.lg,
    gap: OwnerTheme.spacing.md,
  },
  loadingBox: {
    padding: OwnerTheme.spacing.xxxl,
    alignItems: 'center',
  },
  card: {
    backgroundColor: OwnerTheme.colors.card,
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: OwnerTheme.spacing.lg,
    gap: OwnerTheme.spacing.sm,
    ...OwnerTheme.shadow,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: OwnerTheme.spacing.md,
  },
  mealIcon: {
    fontSize: 24,
  },
  mealTitle: {
    ...OwnerTheme.typography.cardHeading,
  },
  mealTime: {
    ...OwnerTheme.typography.supporting,
  },
  mealItems: {
    ...OwnerTheme.typography.bodyMedium,
    lineHeight: 20,
  },
  mealNotes: {
    ...OwnerTheme.typography.supporting,
    fontStyle: 'italic',
  },
});
