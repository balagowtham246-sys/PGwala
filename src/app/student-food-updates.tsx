import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { AlertTriangle, BellOff, CheckCircle2, XCircle } from 'lucide-react-native';
import * as Notifications from 'expo-notifications';

import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/lib/supabase';
import { registerForPushNotifications } from '@/lib/push-notifications';
import { extractErrorMessage } from '@/lib/error-utils';
import { OwnerHeader } from '@/components/ui/owner';
import { RoleBottomNav } from '@/components/ui/bottom-nav';
import {
  FoodAlertStatus,
  FoodMealType,
  alertHeadline,
  formatAlertTime,
} from '@/lib/food-alert-utils';

interface FoodUpdate {
  id: string;
  meal_type: FoodMealType;
  status: FoodAlertStatus;
  message: string | null;
  created_at: string;
  properties: { name: string } | { name: string }[] | null;
}

const COLORS: Record<FoodAlertStatus, { bg: string; fg: string; border: string }> = {
  ready: { bg: '#DCFCE7', fg: '#166534', border: '#86EFAC' },
  delayed: { bg: '#FEF3C7', fg: '#92400E', border: '#FCD34D' },
  cancelled: { bg: '#FEE2E2', fg: '#991B1B', border: '#FCA5A5' },
};

function propertyName(p: FoodUpdate['properties']): string {
  if (!p) return '';
  return Array.isArray(p) ? (p[0]?.name ?? '') : p.name;
}

export default function StudentFoodUpdatesScreen() {
  const { user } = useAuth();
  const [updates, setUpdates] = useState<FoodUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [optIn, setOptIn] = useState(true);
  const [savingOptIn, setSavingOptIn] = useState(false);
  const [pushState, setPushState] = useState<'unknown' | 'granted' | 'denied'>('unknown');

  const load = useCallback(async () => {
    setErrorMessage(null);
    try {
      const [updatesRes, residentRes, perms] = await Promise.all([
        supabase
          .from('food_alerts')
          .select('id, meal_type, status, message, created_at, properties(name)')
          .order('created_at', { ascending: false })
          .limit(50),
        user?.id
          ? supabase.from('residents').select('meal_opt_in').eq('profile_id', user.id).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        Platform.OS === 'web' ? Promise.resolve(null) : Notifications.getPermissionsAsync(),
      ]);
      if (updatesRes.error) throw updatesRes.error;
      setUpdates((updatesRes.data ?? []) as unknown as FoodUpdate[]);
      if (residentRes.data && typeof (residentRes.data as any).meal_opt_in === 'boolean') {
        setOptIn((residentRes.data as any).meal_opt_in);
      }
      setPushState(perms ? (perms.granted ? 'granted' : 'denied') : 'unknown');
    } catch (err) {
      setErrorMessage(extractErrorMessage(err, 'Could not load food updates.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const toggleOptIn = async (value: boolean) => {
    if (savingOptIn) return;
    setSavingOptIn(true);
    setOptIn(value);
    const { error } = await supabase.rpc('set_my_meal_opt_in', { p_value: value });
    if (error) {
      setOptIn(!value);
      setErrorMessage(extractErrorMessage(error, 'Could not update your preference.'));
    }
    setSavingOptIn(false);
  };

  const enableNotifications = async () => {
    const res = await registerForPushNotifications({ askPermission: true });
    if (res.status === 'registered') setPushState('granted');
    else if (res.status === 'denied') Linking.openSettings().catch(() => {});
    await load();
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <OwnerHeader title="Food Updates" subtitle="Meal announcements from your warden" showBack />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
          />
        }>
        {pushState === 'denied' && (
          <Pressable style={styles.noticeBox} onPress={enableNotifications}>
            <BellOff size={18} color="#92400E" />
            <View style={{ flex: 1 }}>
              <Text style={styles.noticeTitle}>Notifications are off</Text>
              <Text style={styles.noticeText}>
                You will still see every update here. Tap to turn notifications on.
              </Text>
            </View>
          </Pressable>
        )}

        <View style={styles.optRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.optTitle}>Get meal alerts</Text>
            <Text style={styles.optText}>Turn off if you do not eat at the PG.</Text>
          </View>
          <Switch value={optIn} onValueChange={toggleOptIn} disabled={savingOptIn} />
        </View>

        {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}

        {loading ? (
          <ActivityIndicator style={{ marginTop: 32 }} color={OwnerTheme.colors.primary} />
        ) : updates.length === 0 ? (
          <Text style={styles.emptyText}>No food updates yet.</Text>
        ) : (
          updates.map((u) => {
            const c = COLORS[u.status];
            const highlight = u.status !== 'ready';
            return (
              <View
                key={u.id}
                style={[
                  styles.card,
                  highlight && { backgroundColor: c.bg, borderColor: c.border },
                ]}>
                {u.status === 'ready' ? (
                  <CheckCircle2 size={20} color={c.fg} />
                ) : u.status === 'delayed' ? (
                  <AlertTriangle size={20} color={c.fg} />
                ) : (
                  <XCircle size={20} color={c.fg} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, highlight && { color: c.fg }]}>
                    {alertHeadline(u.meal_type, u.status)}
                  </Text>
                  {u.message ? (
                    <Text style={[styles.cardMessage, highlight && { color: c.fg }]}>{u.message}</Text>
                  ) : null}
                  <Text style={[styles.cardMeta, highlight && { color: c.fg }]}>
                    {propertyName(u.properties)}
                    {propertyName(u.properties) ? ' • ' : ''}
                    {formatAlertTime(u.created_at)}
                  </Text>
                </View>
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
  safeArea: { flex: 1, backgroundColor: OwnerTheme.colors.background },
  content: { padding: 16, paddingBottom: 120, gap: 10 },
  noticeBox: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    backgroundColor: OwnerTheme.colors.warningLight,
    borderRadius: 12,
    padding: 12,
  },
  noticeTitle: { fontSize: 14, fontWeight: '700', color: '#92400E' },
  noticeText: { fontSize: 12, color: '#92400E', marginTop: 2 },
  optRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.borderLight,
    padding: 14,
    minHeight: 60,
  },
  optTitle: { fontSize: 15, fontWeight: '600', color: OwnerTheme.colors.textPrimary },
  optText: { fontSize: 12, color: OwnerTheme.colors.textSecondary, marginTop: 2 },
  errorText: { color: OwnerTheme.colors.danger, fontSize: 13 },
  emptyText: { textAlign: 'center', color: OwnerTheme.colors.textMuted, marginTop: 32, fontSize: 14 },
  card: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.borderLight,
    padding: 14,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: OwnerTheme.colors.textPrimary },
  cardMessage: { fontSize: 14, color: OwnerTheme.colors.textPrimary, marginTop: 3 },
  cardMeta: { fontSize: 12, color: OwnerTheme.colors.textSecondary, marginTop: 6 },
});
