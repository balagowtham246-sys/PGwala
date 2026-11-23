import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Href, router, useFocusEffect } from 'expo-router';
import { AlertTriangle, CheckCircle2, ChevronRight, Megaphone, XCircle } from 'lucide-react-native';
import * as Notifications from 'expo-notifications';

import { OwnerTheme } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import {
  FoodAlertStatus,
  FoodMealType,
  MEAL_OPTIONS,
  alertHeadline,
  formatAlertTime,
  istDateIso,
  latestAlertPerMeal,
} from '@/lib/food-alert-utils';

interface TodayAlert {
  id: string;
  meal_type: FoodMealType;
  status: FoodAlertStatus;
  message: string | null;
  alert_date: string;
  created_at: string;
}

const COLORS: Record<FoodAlertStatus, { bg: string; fg: string; border: string }> = {
  ready: { bg: '#DCFCE7', fg: '#166534', border: '#86EFAC' },
  delayed: { bg: '#FEF3C7', fg: '#92400E', border: '#FCD34D' },
  cancelled: { bg: '#FEE2E2', fg: '#991B1B', border: '#FCA5A5' },
};

function StatusIcon({ status }: { status: FoodAlertStatus }) {
  const color = COLORS[status].fg;
  if (status === 'ready') return <CheckCircle2 size={20} color={color} />;
  if (status === 'delayed') return <AlertTriangle size={20} color={color} />;
  return <XCircle size={20} color={color} />;
}

/** Shows today's latest food status per meal; always links to the Food Updates history. */
export function FoodStatusBanner({ refreshKey = 0 }: { refreshKey?: number }) {
  const [alerts, setAlerts] = useState<TodayAlert[]>([]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('food_alerts')
      .select('id, meal_type, status, message, alert_date, created_at')
      .eq('alert_date', istDateIso())
      .order('created_at', { ascending: false })
      .limit(10);
    setAlerts((data ?? []) as TodayAlert[]);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => {});
    }, [load])
  );

  useEffect(() => {
    if (refreshKey <= 0) return;
    let active = true;
    void (async () => {
      try {
        const { data } = await supabase
          .from('food_alerts')
          .select('id, meal_type, status, message, alert_date, created_at')
          .eq('alert_date', istDateIso())
          .order('created_at', { ascending: false })
          .limit(10);
        if (active) {
          setAlerts((data ?? []) as TodayAlert[]);
        }
      } catch {
        // Silent refresh failure keeps last banner state
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshKey]);

  // Refresh instantly when a push arrives while the app is open
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = Notifications.addNotificationReceivedListener(() => {
      load().catch(() => {});
    });
    return () => sub.remove();
  }, [load]);

  const latest = latestAlertPerMeal(alerts, istDateIso());
  const visible = MEAL_OPTIONS.filter((m) => latest[m.key]);

  if (visible.length === 0) {
    return (
      <Pressable
        style={styles.slimRow}
        onPress={() =>
          router.push({ pathname: '/resident-announcements', params: { tab: 'food' } } as Href)
        }>
        <Megaphone size={16} color={OwnerTheme.colors.textSecondary} />
        <Text style={styles.slimText}>Food updates</Text>
        <ChevronRight size={16} color={OwnerTheme.colors.textMuted} />
      </Pressable>
    );
  }

  return (
    <View style={styles.wrap}>
      {visible.map((m) => {
        const a = latest[m.key]!;
        const c = COLORS[a.status];
        return (
          <Pressable
            key={m.key}
            accessibilityRole="button"
            style={[styles.card, { backgroundColor: c.bg, borderColor: c.border }]}
            onPress={() =>
              router.push({ pathname: '/resident-announcements', params: { tab: 'food' } } as Href)
            }>
            <StatusIcon status={a.status} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: c.fg }]}>{alertHeadline(a.meal_type, a.status)}</Text>
              {a.message ? (
                <Text style={[styles.message, { color: c.fg }]} numberOfLines={2}>
                  {a.message}
                </Text>
              ) : null}
              <Text style={[styles.time, { color: c.fg }]}>{formatAlertTime(a.created_at)}</Text>
            </View>
            <ChevronRight size={16} color={c.fg} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, marginBottom: 12 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  title: { fontSize: 15, fontWeight: '700' },
  message: { fontSize: 13, marginTop: 2 },
  time: { fontSize: 12, marginTop: 4, opacity: 0.8 },
  slimRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: OwnerTheme.colors.borderLight,
    marginBottom: 12,
  },
  slimText: { flex: 1, fontSize: 14, fontWeight: '600', color: OwnerTheme.colors.textSecondary },
});
