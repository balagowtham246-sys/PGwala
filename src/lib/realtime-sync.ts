import type { RealtimeChannel } from '@supabase/supabase-js';
import type { QueryClient } from '@tanstack/react-query';

import { invalidatePrefix } from '@/lib/query-cache';
import { queryKeys } from '@/lib/query-keys';

export type SyncDomain =
  | 'billing'
  | 'food'
  | 'complaints'
  | 'movement'
  | 'residents'
  | 'washingMachine'
  | 'joinRequests'
  | 'settings'
  | 'chat';

export type LiveConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';

export interface DomainSyncCallbacks {
  refreshResident?: () => void;
  refreshProperties?: () => void;
  refreshProfile?: () => void;
}

export interface BroadcastSyncPayload {
  domain: SyncDomain;
  senderId: string;
  ts: number;
}

type StatusListener = (status: LiveConnectionStatus) => void;

const CLIENT_SENDER_ID = `pgwala-${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

let activeChannel: RealtimeChannel | null = null;
let activeChannelPropertyId: string | null = null;
let connectionStatus: LiveConnectionStatus = 'connected';
const statusListeners = new Set<StatusListener>();

export function getRealtimeSenderId(): string {
  return CLIENT_SENDER_ID;
}

export function getLiveConnectionStatus(): LiveConnectionStatus {
  return connectionStatus;
}

export function setLiveConnectionStatus(next: LiveConnectionStatus): void {
  if (connectionStatus === next) return;
  connectionStatus = next;
  for (const listener of statusListeners) {
    listener(next);
  }
}

export function subscribeLiveConnectionStatus(
  listener: StatusListener
): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

export function registerActiveRealtimeChannel(
  channel: RealtimeChannel | null,
  propertyId: string | null
): void {
  activeChannel = channel;
  activeChannelPropertyId = propertyId;
}

/**
 * Fires a sub-100ms Supabase Broadcast event on the active property channel
 * so all other connected Owner, Resident, and Warden devices refresh immediately
 * without waiting for Postgres WAL + RLS evaluation.
 */
export function broadcastPropertySync(
  domain: SyncDomain,
  propertyId?: string | null
): void {
  if (process.env.NODE_ENV === 'test' && !activeChannel) {
    return;
  }
  if (!activeChannel) return;
  if (propertyId && activeChannelPropertyId && propertyId !== activeChannelPropertyId) {
    return;
  }

  const payload: BroadcastSyncPayload = {
    domain,
    senderId: CLIENT_SENDER_ID,
    ts: Date.now(),
  };

  try {
    void activeChannel.send({
      type: 'broadcast',
      event: 'domain_sync',
      payload,
    });
  } catch {
    // Non-fatal: Postgres Realtime postgres_changes acts as the authoritative safety net
  }
}

/**
 * Awaits local SWR AsyncStorage/memory cache invalidation FIRST (preventing
 * stale 60s cache reads during TanStack refetches), then invalidates all
 * affected TanStack Query keys and triggers Context refreshes where needed.
 */
export async function invalidateDomainCaches(
  qc: QueryClient,
  domain: SyncDomain,
  callbacks?: DomainSyncCallbacks
): Promise<void> {
  switch (domain) {
    case 'billing':
      await Promise.all([
        invalidatePrefix('billing:'),
        invalidatePrefix('residents:'),
        invalidatePrefix('dashboard:'),
      ]);
      void qc.invalidateQueries({ queryKey: queryKeys.billing.all });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
      void qc.invalidateQueries({ queryKey: queryKeys.residents.all });
      void qc.invalidateQueries({ queryKey: ['expenses'] });
      break;

    case 'food':
      await Promise.all([
        invalidatePrefix('food-menu:'),
        invalidatePrefix('resident-notices:'),
        invalidatePrefix('announcements:'),
        invalidatePrefix('dashboard:'),
      ]);
      void qc.invalidateQueries({ queryKey: queryKeys.foodMenus.all });
      void qc.invalidateQueries({ queryKey: queryKeys.announcements.all });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
      break;

    case 'complaints':
      await Promise.all([
        invalidatePrefix('dashboard:'),
        invalidatePrefix('notification-center:'),
      ]);
      void qc.invalidateQueries({ queryKey: queryKeys.complaints.all });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
      break;

    case 'movement':
      await Promise.all([
        invalidatePrefix('dashboard:'),
        invalidatePrefix('residents:'),
        invalidatePrefix('notification-center:'),
      ]);
      void qc.invalidateQueries({ queryKey: queryKeys.movement.all });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
      void qc.invalidateQueries({ queryKey: queryKeys.residents.all });
      break;

    case 'residents':
      await Promise.all([
        invalidatePrefix('residents:'),
        invalidatePrefix('resident-ctx:'),
        invalidatePrefix('billing:'),
        invalidatePrefix('dashboard:'),
      ]);
      void qc.invalidateQueries({ queryKey: queryKeys.residents.all });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
      void qc.invalidateQueries({ queryKey: queryKeys.billing.all });
      callbacks?.refreshResident?.();
      callbacks?.refreshProperties?.();
      break;

    case 'washingMachine':
      await invalidatePrefix('dashboard:');
      void qc.invalidateQueries({ queryKey: queryKeys.washingMachine.all });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
      break;

    case 'joinRequests':
      await Promise.all([
        invalidatePrefix('residents:'),
        invalidatePrefix('dashboard:'),
      ]);
      void qc.invalidateQueries({ queryKey: ['join-requests-pending-count'] });
      void qc.invalidateQueries({ queryKey: ['join-requests'] });
      void qc.invalidateQueries({ queryKey: queryKeys.residents.all });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
      break;

    case 'settings':
      await Promise.all([
        invalidatePrefix('resident-ctx:'),
        invalidatePrefix('dashboard:'),
        invalidatePrefix('residents:'),
      ]);
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
      void qc.invalidateQueries({ queryKey: queryKeys.wardens.all });
      void qc.invalidateQueries({ queryKey: queryKeys.residents.all });
      callbacks?.refreshResident?.();
      callbacks?.refreshProperties?.();
      callbacks?.refreshProfile?.();
      break;

    case 'chat':
      await invalidatePrefix('dashboard:');
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
      break;
  }
}

/**
 * Helper to determine if a postgres_changes event for a domain should be skipped
 * because a Broadcast event for that same domain already synced within `windowMs`.
 */
export function shouldSkipPostgresAfterBroadcast(
  lastBroadcastAtMs: number | undefined,
  nowMs: number,
  windowMs: number = 1500
): boolean {
  if (!lastBroadcastAtMs) return false;
  return nowMs - lastBroadcastAtMs < windowMs;
}
