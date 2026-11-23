import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Clock, LogOut, RefreshCw, XCircle } from 'lucide-react-native';

import { DarkSlateHeroCard } from '@/components/ui/dark-slate-hero-card';
import { OwnerHeader } from '@/components/ui/owner';
import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useResident } from '@/context/resident-context';
import { useToast } from '@/context/toast-context';
import {
  fetchMyLatestJoinRequest,
  JoinRequestItem,
} from '@/services/join-requests.service';

export default function PendingApprovalScreen() {
  const { user, signOut } = useAuth();
  const { refreshResident } = useResident();
  const { showToast } = useToast();

  const [request, setRequest] = useState<JoinRequestItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);

  const checkStatus = useCallback(
    async (showFeedback = false) => {
      if (!user?.id) return;
      if (showFeedback) setChecking(true);
      try {
        const [activeRes, latestReq] = await Promise.all([
          refreshResident(true),
          fetchMyLatestJoinRequest(user.id),
        ]);
        if (activeRes) {
          showToast('Welcome! Your PG owner has approved your room.');
          router.replace('/resident-tabs');
          return;
        }
        setRequest(latestReq);
        if (showFeedback) {
          showToast(
            latestReq?.status === 'rejected'
              ? 'Your request was declined by the PG owner.'
              : 'Still awaiting PG owner approval.'
          );
        }
      } finally {
        setLoading(false);
        setChecking(false);
      }
    },
    [refreshResident, showToast, user?.id]
  );

  useEffect(() => {
    void checkStatus(false);
  }, [checkStatus]);

  const handleSignOut = () => {
    Alert.alert('Log Out', 'Sign out of this account?', [
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

  const isRejected = request?.status === 'rejected';
  const pgName = request?.property?.name || 'Your PG';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <OwnerHeader title="Approval Status" subtitle="PGwala Resident" />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={checking}
            onRefresh={() => void checkStatus(true)}
            colors={[OwnerTheme.colors.primary]}
          />
        }>
        {loading ? (
          <ActivityIndicator
            style={{ marginTop: 48 }}
            size="large"
            color={OwnerTheme.colors.primary}
          />
        ) : (
          <>
            <DarkSlateHeroCard
              eyebrow="JOIN REQUEST STATUS"
              title={
                isRejected
                  ? 'Request Declined'
                  : 'Waiting for Owner Approval'
              }
              subtitle={pgName}
              badgeLabel={isRejected ? 'Declined' : 'Pending'}
              badgeTone={isRejected ? 'danger' : 'warning'}
            />

            <View style={styles.infoCard}>
              <View style={styles.iconCircle}>
                {isRejected ? (
                  <XCircle size={28} color="#DC2626" />
                ) : (
                  <Clock size={28} color="#D97706" />
                )}
              </View>
              <Text style={styles.infoTitle}>
                {isRejected
                  ? 'Your request was not approved'
                  : 'Your details have been sent!'}
              </Text>
              <Text style={styles.infoBody}>
                {isRejected
                  ? request?.rejection_reason ||
                    'Please contact your PG owner for more details.'
                  : `Ask the ${pgName} owner to approve your request and assign your room & rent. Once approved, tap Check Status below to enter your resident dashboard.`}
              </Text>

              {request && (
                <View style={styles.summaryBox}>
                  <Text style={styles.summaryLine}>
                    Name: <Text style={styles.summaryBold}>{request.full_name}</Text>
                  </Text>
                  <Text style={styles.summaryLine}>
                    Phone:{' '}
                    <Text style={styles.summaryBold}>{request.phone_number}</Text>
                  </Text>
                  {request.room_hint ? (
                    <Text style={styles.summaryLine}>
                      Room hint:{' '}
                      <Text style={styles.summaryBold}>{request.room_hint}</Text>
                    </Text>
                  ) : null}
                </View>
              )}
            </View>

            <Pressable
              accessibilityRole="button"
              disabled={checking}
              style={({ pressed }) => [
                styles.checkBtn,
                (checking || pressed) && { opacity: 0.8 },
              ]}
              onPress={() => void checkStatus(true)}>
              {checking ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <RefreshCw size={16} color="#FFFFFF" />
                  <Text style={styles.checkBtnText}>Check Approval Status</Text>
                </>
              )}
            </Pressable>

            <Pressable
              accessibilityRole="button"
              style={styles.logoutBtn}
              onPress={handleSignOut}>
              <LogOut size={16} color="#B91C1C" />
              <Text style={styles.logoutBtnText}>Log Out</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F8FAFC' },
  content: { padding: 16, gap: 12, paddingBottom: 36 },
  infoCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 20,
    alignItems: 'center',
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  infoTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
  },
  infoBody: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 6,
  },
  summaryBox: {
    width: '100%',
    marginTop: 14,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    gap: 4,
  },
  summaryLine: { fontSize: 13, color: '#64748B' },
  summaryBold: { fontWeight: '700', color: '#0F172A' },
  checkBtn: {
    height: 50,
    borderRadius: 14,
    backgroundColor: '#0F172A',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  checkBtnText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  logoutBtn: {
    height: 46,
    borderRadius: 14,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  logoutBtnText: { fontSize: 14, fontWeight: '700', color: '#B91C1C' },
});
