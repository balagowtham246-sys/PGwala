import React, { useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Building2, LogOut, Phone, ShieldCheck } from 'lucide-react-native';

import { SettingsComplianceSection } from '@/components/settings-compliance-section';
import { OwnerHeader } from '@/components/ui/owner';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/lib/supabase';

export default function WardenSettingsScreen() {
  const { user, profile, signOut } = useAuth();
  const [propertyName, setPropertyName] = useState<string | null>(null);
  const [ownerPhone, setOwnerPhone] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!user?.id) return;
      const { data } = await supabase
        .from('property_wardens')
        .select('properties(name, owner_id)')
        .eq('warden_profile_id', user.id)
        .eq('is_active', true)
        .maybeSingle();
      if (!active || !data) return;

      const rel = (data as { properties?: { name?: string; owner_id?: string } | { name?: string; owner_id?: string }[] }).properties;
      const prop = Array.isArray(rel) ? rel[0] : rel;
      setPropertyName(prop?.name ?? null);

      if (prop?.owner_id) {
        const { data: ownerProf } = await supabase
          .from('profiles')
          .select('phone_number')
          .eq('id', prop.owner_id)
          .maybeSingle();
        if (active && ownerProf?.phone_number) {
          setOwnerPhone(ownerProf.phone_number);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [user?.id]);

  const handleCallOwner = () => {
    if (!ownerPhone) {
      Alert.alert(
        'Owner Phone Unavailable',
        'Ask the PG owner to add their phone number in Owner Settings.'
      );
      return;
    }
    const cleaned = ownerPhone.replace(/[^\d+]/g, '');
    void Linking.openURL(`tel:${cleaned}`).catch(() => {
      Alert.alert('Cannot Call', `Owner phone: ${ownerPhone}`);
    });
  };

  const handleLogout = async () => {
    if (Platform.OS === 'web') {
      if (
        typeof window === 'undefined' ||
        window.confirm('Log out of PGwala?')
      ) {
        await signOut();
        router.replace('/login');
      }
      return;
    }
    Alert.alert('Log Out', 'Are you sure you want to log out of PGwala?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: async () => {
          await signOut();
          router.replace('/login');
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <OwnerHeader title="Settings" subtitle="Warden" showBack />

      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}>
        {/* 1. Assigned PG Info Card */}
        <View style={styles.pgCard}>
          <View style={styles.pgIconCircle}>
            <Building2 size={24} color="#38BDF8" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.pgEyebrow}>ASSIGNED PG</Text>
            <Text style={styles.pgName} numberOfLines={1}>
              {propertyName || 'Not assigned yet'}
            </Text>
            <Text style={styles.wardenName} numberOfLines={1}>
              {profile?.full_name || 'Warden'}
            </Text>
          </View>
        </View>

        {/* 2. Call Owner (Giant 1-Tap Button) */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Call PG Owner"
          style={({ pressed }) => [
            styles.bigActionCard,
            styles.callOwnerCard,
            pressed && { opacity: 0.82 },
          ]}
          onPress={handleCallOwner}>
          <View style={[styles.actionIconCircle, { backgroundColor: '#D1FAE5' }]}>
            <Phone size={22} color="#047857" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.actionTitle}>Call Owner</Text>
            <Text style={styles.actionSub}>
              {ownerPhone || 'Tap for kitchen or PG help'}
            </Text>
          </View>
        </Pressable>

        {/* Change Password (for temporary password onboarding) */}
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.bigActionCard,
            pressed && { opacity: 0.82 },
          ]}
          onPress={() => router.push('/resident-profile-edit')}>
          <View style={[styles.actionIconCircle, { backgroundColor: '#F1F5F9' }]}>
            <ShieldCheck size={22} color="#334155" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.actionTitle}>Change Password</Text>
            <Text style={styles.actionSub}>Update phone or password</Text>
          </View>
        </Pressable>

        {/* 3. Log Out (Giant Red Button) */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Log Out of PGwala"
          style={({ pressed }) => [
            styles.logoutBtn,
            pressed && { opacity: 0.82 },
          ]}
          onPress={handleLogout}>
          <LogOut size={20} color="#B91C1C" />
          <Text style={styles.logoutText}>Log Out</Text>
        </Pressable>

        <SettingsComplianceSection role="warden" userEmail={user?.email} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  container: {
    padding: 16,
    gap: 14,
    paddingBottom: 40,
  },
  pgCard: {
    backgroundColor: '#0F172A',
    borderRadius: 18,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  pgIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: 'rgba(56, 189, 248, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pgEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.8,
  },
  pgName: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    marginTop: 2,
  },
  wardenName: {
    fontSize: 13,
    color: '#CBD5E1',
    marginTop: 2,
  },
  bigActionCard: {
    minHeight: 68,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  callOwnerCard: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  actionIconCircle: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  actionSub: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
  },
  logoutBtn: {
    minHeight: 58,
    borderRadius: 16,
    backgroundColor: '#FEF2F2',
    borderWidth: 1.5,
    borderColor: '#FECACA',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 4,
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#B91C1C',
  },
});
