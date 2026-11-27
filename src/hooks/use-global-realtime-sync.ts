import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/context/auth-context';
import { useProperty } from '@/context/property-context';
import { useResident } from '@/context/resident-context';
import { clearQueryCache } from '@/lib/query-cache';
import {
  BroadcastSyncPayload,
  getRealtimeSenderId,
  invalidateDomainCaches,
  registerActiveRealtimeChannel,
  setLiveConnectionStatus,
  shouldSkipPostgresAfterBroadcast,
  SyncDomain,
} from '@/lib/realtime-sync';
import { supabase } from '@/lib/supabase';

const DOMAIN_DEBOUNCE_MS = 120;
const BASE_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 15_000;

/**
 * App-wide Hybrid Realtime Sync Engine:
 * 1. Fast path (~30-80ms): Supabase Broadcast on the active property channel
 * 2. Authoritative safety net: Postgres Realtime (REPLICA IDENTITY FULL) on all 20 tables
 * 3. Mobile resilience: JWT auth sync, exponential-backoff reconnect, and full catch-up
 *    sync on socket recovery or AppState foreground resume (including Contexts).
 */
export function useGlobalRealtimeSync(): void {
  const qc = useQueryClient();
  const { session, profile, user, refreshProfile } = useAuth();
  const { selectedPropertyId, refreshProperties } = useProperty();
  const { resident, refreshResident } = useResident();

  const [wardenPropertyId, setWardenPropertyId] = useState<string | null>(null);
  const [isAppActive, setIsAppActive] = useState(
    AppState.currentState === 'active'
  );
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  const role = profile?.role;
  const userId = user?.id ?? null;
  const accessToken = session?.access_token ?? null;

  // Keep latest context refresh callbacks in a ref so the channel effect never tears down
  const callbacksRef = useRef({
    refreshResident: () => {
      void refreshResident(true);
    },
    refreshProperties: () => {
      void refreshProperties();
    },
    refreshProfile: () => {
      void refreshProfile();
    },
  });

  useEffect(() => {
    callbacksRef.current = {
      refreshResident: () => {
        void refreshResident(true);
      },
      refreshProperties: () => {
        void refreshProperties();
      },
      refreshProfile: () => {
        void refreshProfile();
      },
    };
  }, [refreshResident, refreshProperties, refreshProfile]);

  // Keep Supabase Realtime WebSocket JWT synchronized across token refreshes
  useEffect(() => {
    if (!accessToken) return;
    try {
      void supabase.realtime.setAuth(accessToken);
    } catch {
      // Non-fatal in test/mock environments
    }
  }, [accessToken]);

  // Resolve active propertyId for Warden sessions
  useEffect(() => {
    if (!session || role !== 'warden' || !userId) {
      return;
    }
    let active = true;
    void (async () => {
      try {
        const { data } = await supabase
          .from('property_wardens')
          .select('property_id')
          .eq('warden_profile_id', userId)
          .eq('is_active', true)
          .maybeSingle();
        if (active) {
          setWardenPropertyId(
            (data as { property_id?: string | null } | null)?.property_id ?? null
          );
        }
      } catch {
        // Non-fatal
      }
    })();
    return () => {
      active = false;
    };
  }, [session, role, userId]);

  const activePropertyId =
    role === 'owner'
      ? selectedPropertyId
      : role === 'student'
        ? resident?.propertyId ?? null
        : role === 'warden'
          ? wardenPropertyId
          : null;

  // Track foreground/background transitions; re-sync active queries & contexts on resume
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      const becameActive = nextState === 'active';
      setIsAppActive(becameActive);
      if (becameActive && session) {
        if (session.access_token) {
          try {
            void supabase.realtime.setAuth(session.access_token);
          } catch {
            // Non-fatal
          }
        }
        void clearQueryCache().finally(() => {
          void qc.invalidateQueries({ refetchType: 'active' });
          callbacksRef.current.refreshResident();
          callbacksRef.current.refreshProperties();
          callbacksRef.current.refreshProfile();
        });
      }
    });
    return () => sub.remove();
  }, [qc, session]);

  const timersRef = useRef<Partial<Record<SyncDomain, ReturnType<typeof setTimeout>>>>({});
  const lastBroadcastAtRef = useRef<Partial<Record<SyncDomain, number>>>({});
  const hadDisconnectRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffAttemptRef = useRef(0);

  useEffect(() => {
    if (!session || !activePropertyId || !isAppActive) {
      registerActiveRealtimeChannel(null, null);
      if (!session) {
        setLiveConnectionStatus('connected');
      }
      return;
    }

    if (session.access_token) {
      try {
        void supabase.realtime.setAuth(session.access_token);
      } catch {
        // Non-fatal
      }
    }

    const scheduleDomainSync = (
      domain: SyncDomain,
      source: 'broadcast' | 'postgres'
    ) => {
      const now = Date.now();
      if (source === 'broadcast') {
        lastBroadcastAtRef.current[domain] = now;
      } else if (
        shouldSkipPostgresAfterBroadcast(lastBroadcastAtRef.current[domain], now)
      ) {
        return;
      }

      const existing = timersRef.current[domain];
      if (existing) clearTimeout(existing);

      timersRef.current[domain] = setTimeout(() => {
        delete timersRef.current[domain];
        void invalidateDomainCaches(qc, domain, callbacksRef.current);
      }, DOMAIN_DEBOUNCE_MS);
    };

    const filter = `property_id=eq.${activePropertyId}`;
    const selfSenderId = getRealtimeSenderId();

    const channel = supabase
      .channel(`pgwala_live_${activePropertyId}`, {
        config: {
          broadcast: { self: false, ack: false },
        },
      })
      .on('broadcast', { event: 'domain_sync' }, ({ payload }) => {
        const typed = payload as Partial<BroadcastSyncPayload> | undefined;
        if (!typed?.domain || typed.senderId === selfSenderId) return;
        scheduleDomainSync(typed.domain, 'broadcast');
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'charges', filter }, () =>
        scheduleDomainSync('billing', 'postgres')
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_allocations' }, () =>
        scheduleDomainSync('billing', 'postgres')
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'student_payment_reports', filter },
        () => scheduleDomainSync('billing', 'postgres')
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'property_expenses', filter },
        () => scheduleDomainSync('billing', 'postgres')
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'food_menus', filter }, () =>
        scheduleDomainSync('food', 'postgres')
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements', filter }, () =>
        scheduleDomainSync('food', 'postgres')
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'food_alerts', filter }, () =>
        scheduleDomainSync('food', 'postgres')
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'complaints', filter }, () =>
        scheduleDomainSync('complaints', 'postgres')
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'movement_logs', filter }, () =>
        scheduleDomainSync('movement', 'postgres')
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'residents', filter }, () =>
        scheduleDomainSync('residents', 'postgres')
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter }, () =>
        scheduleDomainSync('residents', 'postgres')
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bed_reservations', filter },
        () => scheduleDomainSync('residents', 'postgres')
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'washing_machines', filter },
        () => scheduleDomainSync('washingMachine', 'postgres')
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'washing_machine_requests', filter },
        () => scheduleDomainSync('washingMachine', 'postgres')
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'resident_join_requests', filter },
        () => scheduleDomainSync('joinRequests', 'postgres')
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'properties',
          filter: `id=eq.${activePropertyId}`,
        },
        () => scheduleDomainSync('settings', 'postgres')
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'property_wardens', filter },
        () => scheduleDomainSync('settings', 'postgres')
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles' },
        () => scheduleDomainSync('settings', 'postgres')
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'property_chat_messages', filter },
        () => scheduleDomainSync('chat', 'postgres')
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          registerActiveRealtimeChannel(channel, activePropertyId);
          setLiveConnectionStatus('connected');
          backoffAttemptRef.current = 0;

          if (hadDisconnectRef.current) {
            hadDisconnectRef.current = false;
            void clearQueryCache().finally(() => {
              void qc.invalidateQueries({ refetchType: 'active' });
              callbacksRef.current.refreshResident();
              callbacksRef.current.refreshProperties();
              callbacksRef.current.refreshProfile();
            });
          }
          return;
        }

        if (
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT' ||
          status === 'CLOSED'
        ) {
          hadDisconnectRef.current = true;
          registerActiveRealtimeChannel(null, null);
          setLiveConnectionStatus('reconnecting');

          if (!retryTimerRef.current) {
            const delay = Math.min(
              BASE_RECONNECT_DELAY_MS * Math.pow(2, backoffAttemptRef.current),
              MAX_RECONNECT_DELAY_MS
            );
            backoffAttemptRef.current += 1;
            retryTimerRef.current = setTimeout(() => {
              retryTimerRef.current = null;
              setReconnectAttempt((n) => n + 1);
            }, delay);
          }
        }
      });

    const timersSnapshot = timersRef.current;
    return () => {
      registerActiveRealtimeChannel(null, null);
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      for (const key of Object.keys(timersSnapshot) as SyncDomain[]) {
        const t = timersSnapshot[key];
        if (t) clearTimeout(t);
        delete timersSnapshot[key];
      }
      void supabase.removeChannel(channel);
    };
  }, [session, activePropertyId, isAppActive, qc, reconnectAttempt]);
}
