import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { RealtimeChannel } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

export interface WashingMachineStatusData {
  property_id: string;
  status: 'free' | 'in_use';
  current_resident_id: string | null;
  current_resident_name: string | null;
  current_resident_room: string | null;
  started_at: string | null;
  updated_at: string;
}

interface WashingMachineCardProps {
  propertyId: string | null;
  userRole: 'owner' | 'student';
  currentResidentId?: string | null; // Logged-in resident's resident.id (if student)
  compact?: boolean;
  style?: any;
}

let wmChannelSequence = 0;

function formatDuration(startedAtIso: string | null): string {
  if (!startedAtIso) return '';
  try {
    const started = new Date(startedAtIso).getTime();
    const now = Date.now();
    const diffMinutes = Math.max(0, Math.floor((now - started) / 60000));
    if (diffMinutes < 1) return 'Just started';
    if (diffMinutes < 60) return `${diffMinutes} min${diffMinutes === 1 ? '' : 's'} ago`;
    const hours = Math.floor(diffMinutes / 60);
    const mins = diffMinutes % 60;
    return `${hours}h ${mins}m ago`;
  } catch {
    return '';
  }
}

export function WashingMachineCard({
  propertyId,
  userRole,
  currentResidentId,
  compact = false,
  style,
}: WashingMachineCardProps) {
  const [data, setData] = useState<WashingMachineStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubscribed, setIsSubscribed] = useState(false);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const isMountedRef = useRef(true);

  // Fetch authoritative state from the server
  const fetchStatus = useCallback(async (isInitial = false) => {
    if (!propertyId) {
      if (isMountedRef.current) setLoading(false);
      return;
    }

    if (isInitial && isMountedRef.current) {
      setLoading(true);
    }
    setErrorMessage(null);

    try {
      const { data: rpcRes, error } = await supabase.rpc('get_or_create_wm_status', {
        p_property_id: propertyId,
      });

      if (error) {
        throw new Error(error.message);
      }

      if (rpcRes && rpcRes.success) {
        if (isMountedRef.current) {
          setData({
            property_id: rpcRes.property_id,
            status: rpcRes.status,
            current_resident_id: rpcRes.current_resident_id,
            current_resident_name: rpcRes.current_resident_name,
            current_resident_room: rpcRes.current_resident_room,
            started_at: rpcRes.started_at,
            updated_at: rpcRes.updated_at,
          });
        }
      } else {
        throw new Error(rpcRes?.error || 'Failed to fetch washing machine status.');
      }
    } catch (err: any) {
      console.warn('[WashingMachine] Fetch error:', err.message);
      if (isMountedRef.current) {
        setErrorMessage(err.message || 'Could not load washing machine status.');
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [propertyId]);

  // Set up Realtime subscription scoped to this property
  useEffect(() => {
    isMountedRef.current = true;
    let isEffectActive = true;

    if (!propertyId) {
      return () => {
        isMountedRef.current = false;
        isEffectActive = false;
      };
    }

    // Initial fetch
    fetchStatus(true);

    // Clean up any prior channel ref before creating a fresh channel
    if (channelRef.current) {
      const oldChannel = channelRef.current;
      channelRef.current = null;
      void supabase.removeChannel(oldChannel);
    }

    // Use a unique channel topic per subscription lifecycle so supabase.channel()
    // never returns an already-subscribed channel that is still asynchronously tearing down.
    wmChannelSequence += 1;
    const channelName = `wm_status_${propertyId}_${wmChannelSequence}`;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'washing_machine_status',
          filter: `property_id=eq.${propertyId}`,
        },
        async () => {
          if (!isEffectActive || !isMountedRef.current) return;
          // Refetch authoritative status (including resolved resident display name)
          await fetchStatus(false);
        }
      )
      .subscribe((status) => {
        if (isEffectActive && isMountedRef.current) {
          setIsSubscribed(status === 'SUBSCRIBED');
        }
      });

    channelRef.current = channel;

    return () => {
      isMountedRef.current = false;
      isEffectActive = false;
      setIsSubscribed(false);
      if (channelRef.current === channel) {
        channelRef.current = null;
      }
      void supabase.removeChannel(channel);
    };
  }, [propertyId, fetchStatus]);

  // Action: Start washing machine session
  const handleStartUsing = async () => {
    if (!propertyId || actionLoading) return;

    setActionLoading(true);
    setErrorMessage(null);

    try {
      const { data: res, error } = await supabase.rpc('start_washing_machine', {
        p_property_id: propertyId,
      });

      if (error) {
        throw new Error(error.message);
      }

      if (res && res.success) {
        // Refetch authoritative state immediately
        await fetchStatus(false);
      } else {
        throw new Error(res?.error || 'Could not start washing machine.');
      }
    } catch (err: any) {
      const msg = err.message || 'Failed to start session.';
      setErrorMessage(msg);
      Alert.alert('Unable to Start', msg);
      // Re-synchronize state in case machine was taken by someone else
      fetchStatus(false);
    } finally {
      if (isMountedRef.current) {
        setActionLoading(false);
      }
    }
  };

  // Action: Mark machine free
  const handleMarkFree = async () => {
    if (!propertyId || actionLoading) return;

    Alert.alert(
      'Mark Machine Free',
      'Have you collected your clothes and cleared the washing machine?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Yes, Machine Is Free',
          onPress: async () => {
            setActionLoading(true);
            setErrorMessage(null);

            try {
              const { data: res, error } = await supabase.rpc('release_washing_machine', {
                p_property_id: propertyId,
              });

              if (error) {
                throw new Error(error.message);
              }

              if (res && res.success) {
                await fetchStatus(false);
              } else {
                throw new Error(res?.error || 'Could not release washing machine.');
              }
            } catch (err: any) {
              const msg = err.message || 'Failed to release machine.';
              setErrorMessage(msg);
              Alert.alert('Unable to Release', msg);
              fetchStatus(false);
            } finally {
              if (isMountedRef.current) {
                setActionLoading(false);
              }
            }
          },
        },
      ]
    );
  };

  if (!propertyId) {
    return null;
  }

  const isFree = data?.status === 'free';
  const isInUse = data?.status === 'in_use';
  const isCurrentSessionOwner =
    userRole === 'student' &&
    Boolean(currentResidentId && data?.current_resident_id === currentResidentId);

  if (compact) {
    return (
      <View style={[styles.compactCard, style]}>
        <View style={styles.compactHeaderRow}>
          <View style={[styles.compactIconWrap, isFree ? styles.iconWrapFree : styles.iconWrapInUse]}>
            <Text style={{ fontSize: 18 }}>🫧</Text>
          </View>
          <View style={[styles.compactPill, isFree ? styles.pillFree : styles.pillInUse]}>
            <Text style={[styles.compactPillText, isFree ? styles.textFree : styles.textInUse]}>
              {loading ? '...' : isFree ? 'FREE' : 'IN USE'}
            </Text>
          </View>
        </View>

        <Text style={styles.compactCardTitle}>Washing Machine</Text>
        <Text style={styles.compactCardSubtitle} numberOfLines={1}>
          {loading
            ? 'Checking...'
            : isFree
            ? 'Available to use'
            : isCurrentSessionOwner
            ? 'Used by you'
            : data?.current_resident_name
            ? `${data.current_resident_name}`
            : 'In use'}
        </Text>

        <View style={styles.compactActionArea}>
          {loading ? (
            <ActivityIndicator size="small" color="#0284C7" />
          ) : isFree && userRole === 'student' ? (
            <Pressable
              style={({ pressed }) => [
                styles.compactBtn,
                styles.startBtn,
                pressed && styles.btnPressed,
                actionLoading && styles.btnDisabled,
              ]}
              disabled={actionLoading}
              onPress={handleStartUsing}>
              {actionLoading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.compactBtnText}>Start Using</Text>
              )}
            </Pressable>
          ) : isCurrentSessionOwner ? (
            <Pressable
              style={({ pressed }) => [
                styles.compactBtn,
                styles.releaseBtn,
                pressed && styles.btnPressed,
                actionLoading && styles.btnDisabled,
              ]}
              disabled={actionLoading}
              onPress={handleMarkFree}>
              {actionLoading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.compactBtnText}>Mark Free</Text>
              )}
            </Pressable>
          ) : (
            <View style={styles.compactOccupiedWrap}>
              <Text style={styles.compactOccupiedText} numberOfLines={1}>
                {data?.started_at ? formatDuration(data.started_at) : 'Occupied'}
              </Text>
            </View>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      {/* Header Row */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <View style={[styles.iconWrap, isFree ? styles.iconWrapFree : styles.iconWrapInUse]}>
            <Text style={styles.machineIcon}>🫧</Text>
          </View>
          <View>
            <View style={styles.titleRow}>
              <Text style={styles.cardTitle}>Washing Machine</Text>
              {isSubscribed && <View style={styles.liveDot} />}
            </View>
            <Text style={styles.cardSubtitle}>
              {loading
                ? 'Checking live availability...'
                : isFree
                ? 'Shared PG machine'
                : 'Currently occupied'}
            </Text>
          </View>
        </View>

        {/* Status Pill */}
        {!loading && data && (
          <View style={[styles.statusPill, isFree ? styles.pillFree : styles.pillInUse]}>
            <Text style={[styles.statusPillText, isFree ? styles.textFree : styles.textInUse]}>
              {isFree ? 'FREE' : 'IN USE'}
            </Text>
          </View>
        )}
      </View>

      {/* Content Area */}
      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="small" color="#0284C7" />
          <Text style={styles.loadingText}>Fetching status...</Text>
        </View>
      ) : errorMessage && !data ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{errorMessage}</Text>
          <Pressable style={styles.retryBtn} onPress={() => fetchStatus(true)}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.contentBox}>
          {isFree ? (
            <View style={styles.freeContentRow}>
              <Text style={styles.infoText}>The washing machine is available for use.</Text>
              {userRole === 'student' && (
                <Pressable
                  style={({ pressed }) => [
                    styles.actionBtn,
                    styles.startBtn,
                    pressed && styles.btnPressed,
                    actionLoading && styles.btnDisabled,
                  ]}
                  disabled={actionLoading}
                  onPress={handleStartUsing}>
                  {actionLoading ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.actionBtnText}>Start Using</Text>
                  )}
                </Pressable>
              )}
            </View>
          ) : (
            <View style={styles.inUseContainer}>
              <View style={styles.inUseDetails}>
                <Text style={styles.occupantName}>
                  {data?.current_resident_name || 'A resident'} is using the machine.
                </Text>
                {data?.current_resident_room ? (
                  <Text style={styles.roomText}>Room {data.current_resident_room}</Text>
                ) : null}
                {data?.started_at ? (
                  <Text style={styles.durationText}>Started {formatDuration(data.started_at)}</Text>
                ) : null}
              </View>

              {/* Action for the resident who started this session */}
              {isCurrentSessionOwner ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.actionBtn,
                    styles.releaseBtn,
                    pressed && styles.btnPressed,
                    actionLoading && styles.btnDisabled,
                  ]}
                  disabled={actionLoading}
                  onPress={handleMarkFree}>
                  {actionLoading ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.releaseBtnText}>Machine Is Free</Text>
                  )}
                </Pressable>
              ) : userRole === 'student' ? (
                <View style={styles.waitingBadge}>
                  <Text style={styles.waitingBadgeText}>In use by resident</Text>
                </View>
              ) : null}
            </View>
          )}

          {errorMessage && data ? (
            <Text style={styles.inlineErrorText}>{errorMessage}</Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 16,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 3,
      },
      android: {
        elevation: 1,
      },
    }),
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapFree: {
    backgroundColor: '#F0FDF4',
  },
  iconWrapInUse: {
    backgroundColor: '#FEF3C7',
  },
  machineIcon: {
    fontSize: 22,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  cardSubtitle: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  pillFree: {
    backgroundColor: '#DCFCE7',
  },
  pillInUse: {
    backgroundColor: '#FEF3C7',
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  textFree: {
    color: '#15803D',
  },
  textInUse: {
    color: '#B45309',
  },
  loadingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 8,
  },
  loadingText: {
    fontSize: 12,
    color: '#64748B',
  },
  errorBox: {
    paddingVertical: 10,
    alignItems: 'center',
    gap: 6,
  },
  errorText: {
    fontSize: 12,
    color: '#DC2626',
    textAlign: 'center',
  },
  retryBtn: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: '#F1F5F9',
    borderRadius: 6,
  },
  retryBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#0284C7',
  },
  contentBox: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  freeContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  infoText: {
    fontSize: 13,
    color: '#475569',
    flex: 1,
    lineHeight: 18,
  },
  actionBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startBtn: {
    backgroundColor: '#0284C7',
  },
  actionBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  releaseBtn: {
    backgroundColor: '#16A34A',
  },
  releaseBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  btnPressed: {
    opacity: 0.8,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  inUseContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  inUseDetails: {
    flex: 1,
  },
  occupantName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  roomText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#0284C7',
    marginTop: 2,
  },
  durationText: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  waitingBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  waitingBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  inlineErrorText: {
    fontSize: 11,
    color: '#DC2626',
    marginTop: 8,
  },
  compactCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    justifyContent: 'space-between',
    minHeight: 140,
  },
  compactHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  compactIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactPill: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 9999,
  },
  compactPillText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  compactCardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 6,
  },
  compactCardSubtitle: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  compactActionArea: {
    marginTop: 10,
  },
  compactBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  compactOccupiedWrap: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  compactOccupiedText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
});

