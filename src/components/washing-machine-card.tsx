import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { RealtimeChannel } from '@supabase/supabase-js';
import {
  ChevronRight,
  Clock,
  Disc3,
  X,
} from 'lucide-react-native';

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

export interface WashingMachineUnitData {
  id: string;
  property_id: string;
  machine_number: number;
  machine_name: string;
  is_active: boolean;
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
  currentResidentId?: string | null;
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
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
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
  const [machines, setMachines] = useState<WashingMachineUnitData[]>([]);
  const [residentEnabled, setResidentEnabled] = useState(true);
  const [requestStatus, setRequestStatus] = useState<'none' | 'pending' | 'accepted' | 'rejected'>('none');
  const [requestingAccess, setRequestingAccess] = useState(false);
  const [popupVisible, setPopupVisible] = useState(false);

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionUnitId, setActionUnitId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubscribed, setIsSubscribed] = useState(false);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const isMountedRef = useRef(true);

  // Fetch authoritative multi-unit state from the server
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
      // 1. Try multi-unit RPC
      const { data: rpcRes, error } = await supabase.rpc('get_or_create_wm_units', {
        p_property_id: propertyId,
      });

      if (!error && rpcRes && rpcRes.success) {
        if (isMountedRef.current) {
          const unitList: WashingMachineUnitData[] = (rpcRes.machines ?? []).map((m: any) => ({
            id: m.id,
            property_id: m.property_id,
            machine_number: m.machine_number ?? 1,
            machine_name: m.machine_name ?? `Machine ${m.machine_number ?? 1}`,
            is_active: m.is_active ?? true,
            status: m.status ?? 'free',
            current_resident_id: m.current_resident_id,
            current_resident_name: m.current_resident_name,
            current_resident_room: m.current_resident_room,
            started_at: m.started_at,
            updated_at: m.updated_at,
          }));

          setMachines(unitList);
          if (userRole === 'student') {
            setResidentEnabled(rpcRes.resident_enabled ?? true);
            setRequestStatus(rpcRes.request_status ?? 'none');
          }
        }
      } else {
        // Fallback to legacy single-unit RPC if migration not yet applied
        const { data: legacyRes, error: legacyErr } = await supabase.rpc('get_or_create_wm_status', {
          p_property_id: propertyId,
        });

        if (legacyErr) throw new Error(legacyErr.message);

        if (legacyRes && legacyRes.success && isMountedRef.current) {
          setMachines([
            {
              id: legacyRes.property_id,
              property_id: legacyRes.property_id,
              machine_number: 1,
              machine_name: 'Washing Machine 1',
              is_active: true,
              status: legacyRes.status,
              current_resident_id: legacyRes.current_resident_id,
              current_resident_name: legacyRes.current_resident_name,
              current_resident_room: legacyRes.current_resident_room,
              started_at: legacyRes.started_at,
              updated_at: legacyRes.updated_at,
            },
          ]);
        }
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
  }, [propertyId, userRole]);

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

    fetchStatus(true);

    if (channelRef.current) {
      const oldChannel = channelRef.current;
      channelRef.current = null;
      void supabase.removeChannel(oldChannel);
    }

    wmChannelSequence += 1;
    const channelName = `wm_status_${propertyId}_${wmChannelSequence}`;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'washing_machines',
          filter: `property_id=eq.${propertyId}`,
        },
        async () => {
          if (!isEffectActive || !isMountedRef.current) return;
          await fetchStatus(false);
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'washing_machine_requests',
          filter: `property_id=eq.${propertyId}`,
        },
        async () => {
          if (!isEffectActive || !isMountedRef.current) return;
          await fetchStatus(false);
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'resident_opt_ins',
        },
        async () => {
          if (!isEffectActive || !isMountedRef.current) return;
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

  // Request Access from Owner
  const handleRequestAccess = async () => {
    if (!propertyId || requestingAccess) return;
    try {
      setRequestingAccess(true);
      const { data: res, error } = await supabase.rpc('request_wm_access', {
        p_property_id: propertyId,
      });
      if (error) throw error;
      if (res?.success) {
        setRequestStatus('pending');
        Alert.alert(
          'Request Submitted',
          'Your request for washing machine access has been sent to the PG owner. Once approved in your monthly bill, you can use any machine.'
        );
      } else {
        throw new Error(res?.error || 'Could not send request.');
      }
    } catch (err: any) {
      Alert.alert('Request Failed', err.message || 'Could not submit request.');
    } finally {
      setRequestingAccess(false);
    }
  };

  // Action: Start washing machine session
  const handleStartUsing = async (targetMachineId?: string) => {
    if (!propertyId || actionLoading) return;

    if (userRole === 'student' && !residentEnabled) {
      Alert.alert(
        'Access Required',
        'Washing machine access is not enabled for your account. Please request access from the owner.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Request Access', onPress: handleRequestAccess },
        ]
      );
      return;
    }

    try {
      setActionLoading(true);
      if (targetMachineId) setActionUnitId(targetMachineId);
      setErrorMessage(null);

      // Try multi-unit RPC
      const { data: rpcRes, error } = await supabase.rpc('start_washing_machine_unit', {
        p_property_id: propertyId,
        p_machine_id: targetMachineId || null,
      });

      if (!error && rpcRes && rpcRes.success) {
        await fetchStatus(false);
        Alert.alert(
          'Wash Started! 🧺',
          `Session active on ${rpcRes.machine?.machine_name || 'selected machine'}. Please mark it free when your laundry is done.`
        );
        return;
      }

      if (rpcRes?.not_enabled) {
        setResidentEnabled(false);
        Alert.alert('Access Not Enabled', rpcRes.error || 'Please request access from owner.');
        return;
      }

      // Legacy fallback
      const { data: legacyRes, error: legacyErr } = await supabase.rpc('start_washing_machine', {
        p_property_id: propertyId,
      });

      if (legacyErr) throw new Error(legacyErr.message);
      if (!legacyRes?.success) throw new Error(legacyRes?.error || 'Could not start machine.');

      await fetchStatus(false);
      Alert.alert('Wash Started! 🧺', 'Machine is now marked in use. Please mark it free when done.');
    } catch (err: any) {
      console.warn('[WashingMachine] Start error:', err.message);
      Alert.alert('Could Not Start', err.message || 'Washing machine could not be started.');
      await fetchStatus(false);
    } finally {
      if (isMountedRef.current) {
        setActionLoading(false);
        setActionUnitId(null);
      }
    }
  };

  // Action: Release washing machine session
  const handleMarkFree = async (targetMachineId?: string) => {
    if (!propertyId || actionLoading) return;

    Alert.alert(
      'Finish Washing Session',
      'Are you sure your wash is done and the machine is free for others?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark Free',
          style: 'default',
          onPress: async () => {
            try {
              setActionLoading(true);
              if (targetMachineId) setActionUnitId(targetMachineId);
              setErrorMessage(null);

              const { data: rpcRes, error } = await supabase.rpc('release_washing_machine_unit', {
                p_property_id: propertyId,
                p_machine_id: targetMachineId || null,
              });

              if (!error && rpcRes && rpcRes.success) {
                await fetchStatus(false);
                Alert.alert('Session Finished', 'Machine is now marked free for fellow residents.');
                return;
              }

              // Legacy fallback
              const { data: legacyRes, error: legacyErr } = await supabase.rpc('release_washing_machine', {
                p_property_id: propertyId,
              });

              if (legacyErr) throw new Error(legacyErr.message);
              if (!legacyRes?.success) throw new Error(legacyRes?.error || 'Could not mark free.');

              await fetchStatus(false);
              Alert.alert('Session Finished', 'Machine is now marked free for fellow residents.');
            } catch (err: any) {
              console.warn('[WashingMachine] Release error:', err.message);
              Alert.alert('Error', err.message || 'Could not mark machine free.');
              await fetchStatus(false);
            } finally {
              if (isMountedRef.current) {
                setActionLoading(false);
                setActionUnitId(null);
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

  // Active units calculation
  const activeMachines = machines.filter((m) => m.is_active);
  const freeMachines = activeMachines.filter((m) => m.status === 'free');
  const inUseMachines = activeMachines.filter((m) => m.status === 'in_use');
  const myOccupiedMachine = machines.find(
    (m) => currentResidentId && m.current_resident_id === currentResidentId
  );

  // ---------------------------------------------------------------------------
  // INTERACTIVE POPUP MODAL (Shared between Compact and Full modes)
  // ---------------------------------------------------------------------------
  const renderPopupModal = () => (
    <Modal
      visible={popupVisible}
      transparent
      animationType="fade"
      onRequestClose={() => setPopupVisible(false)}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Disc3 size={18} color="#0284C7" />
                <Text style={styles.modalTitle}>Washing Machine Units</Text>
              </View>
              <Text style={styles.modalSubtitle} numberOfLines={1}>
                {loading
                  ? 'Loading units...'
                  : `${activeMachines.length} units • ${freeMachines.length} free, ${inUseMachines.length} in use`}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close washing machine modal"
              hitSlop={8}
              onPress={() => setPopupVisible(false)}
              style={styles.modalCloseBtn}>
              <X size={20} color="#64748B" />
            </Pressable>
          </View>

          {/* Un-enabled Resident Notice */}
          {userRole === 'student' && !residentEnabled && (
            <View style={styles.modalGatingBanner}>
              <Text style={styles.modalGatingTitle}>Access Not Enabled</Text>
              <Text style={styles.modalGatingSub}>
                Washing machine service is ₹500/month added to your monthly bill. Request access from your owner to start using machines.
              </Text>
              {requestStatus === 'pending' ? (
                <View style={styles.modalPendingCard}>
                  <Text style={styles.modalPendingText}>⏳ Access request pending owner approval</Text>
                </View>
              ) : (
                <Pressable
                  style={({ pressed }) => [
                    styles.modalRequestBtn,
                    pressed && styles.btnPressed,
                    requestingAccess && styles.btnDisabled,
                  ]}
                  disabled={requestingAccess}
                  onPress={handleRequestAccess}>
                  {requestingAccess ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.modalRequestBtnText}>Request Access from Owner</Text>
                  )}
                </Pressable>
              )}
            </View>
          )}

          {/* Unit List */}
          <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
            {activeMachines.length === 0 ? (
              <View style={styles.modalEmptyBox}>
                <Text style={styles.modalEmptyText}>
                  {loading ? 'Checking available units...' : 'No washing machine units configured.'}
                </Text>
              </View>
            ) : (
              activeMachines.map((unit) => {
                const isUnitFree = unit.status === 'free';
                const isMySession = Boolean(
                  currentResidentId && unit.current_resident_id === currentResidentId
                );
                const isThisLoading = actionLoading && actionUnitId === unit.id;

                return (
                  <View
                    key={unit.id}
                    style={[
                      styles.modalUnitRow,
                      isMySession && styles.modalUnitRowMySession,
                    ]}>
                    <View style={{ flex: 1, marginRight: 10 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <Text style={styles.modalUnitName}>{unit.machine_name}</Text>
                        <View
                          style={[
                            styles.modalStatusBadge,
                            isMySession
                              ? styles.badgeMySession
                              : isUnitFree
                              ? styles.badgeFree
                              : styles.badgeInUse,
                          ]}>
                          <View
                            style={[
                              styles.modalStatusDot,
                              {
                                backgroundColor: isMySession
                                  ? '#0284C7'
                                  : isUnitFree
                                  ? '#16A34A'
                                  : '#DC2626',
                              },
                            ]}
                          />
                          <Text
                            style={[
                              styles.modalStatusText,
                              {
                                color: isMySession
                                  ? '#0369A1'
                                  : isUnitFree
                                  ? '#15803D'
                                  : '#B91C1C',
                              },
                            ]}>
                            {isMySession
                              ? 'Your Wash'
                              : isUnitFree
                              ? 'Free'
                              : 'In Use'}
                          </Text>
                        </View>
                      </View>

                      {isUnitFree ? (
                        <Text style={styles.modalUnitSubFree}>Clean and ready to use</Text>
                      ) : (
                        <View style={{ marginTop: 3 }}>
                          <Text style={styles.modalUnitOccupant} numberOfLines={1}>
                            👤 {unit.current_resident_name || 'Resident'}
                            {unit.current_resident_room ? ` (Room ${unit.current_resident_room})` : ''}
                          </Text>
                          {unit.started_at ? (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                              <Clock size={11} color="#64748B" />
                              <Text style={styles.modalUnitDuration}>
                                Started {formatDuration(unit.started_at)}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                      )}
                    </View>

                    {/* Action Button */}
                    <View style={{ justifyContent: 'center' }}>
                      {isMySession ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Mark ${unit.machine_name} free`}
                          style={({ pressed }) => [
                            styles.modalRowBtn,
                            styles.modalReleaseBtn,
                            pressed && styles.btnPressed,
                            isThisLoading && styles.btnDisabled,
                          ]}
                          disabled={actionLoading}
                          onPress={() => handleMarkFree(unit.id)}>
                          {isThisLoading ? (
                            <ActivityIndicator size="small" color="#FFFFFF" />
                          ) : (
                            <Text style={styles.modalRowBtnText}>Mark Free</Text>
                          )}
                        </Pressable>
                      ) : isUnitFree && userRole === 'student' ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Start washing on ${unit.machine_name}`}
                          style={({ pressed }) => [
                            styles.modalRowBtn,
                            residentEnabled ? styles.modalStartBtn : styles.modalDisabledBtn,
                            pressed && styles.btnPressed,
                            isThisLoading && styles.btnDisabled,
                          ]}
                          disabled={actionLoading || !residentEnabled}
                          onPress={() => {
                            if (!residentEnabled) {
                              Alert.alert(
                                'Access Required',
                                'Washing machine access is not enabled. Please request access from the owner.',
                                [
                                  { text: 'Cancel', style: 'cancel' },
                                  { text: 'Request Access', onPress: handleRequestAccess },
                                ]
                              );
                              return;
                            }
                            handleStartUsing(unit.id);
                          }}>
                          {isThisLoading ? (
                            <ActivityIndicator size="small" color="#FFFFFF" />
                          ) : (
                            <Text style={styles.modalRowBtnText}>
                              {residentEnabled ? 'Start Wash' : 'Disabled'}
                            </Text>
                          )}
                        </Pressable>
                      ) : !isUnitFree ? (
                        <View style={styles.modalBusyPill}>
                          <Text style={styles.modalBusyText}>Busy</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>

          {/* Footer */}
          <View style={styles.modalFooter}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close dialog"
              style={styles.modalDismissBtn}
              onPress={() => setPopupVisible(false)}>
              <Text style={styles.modalDismissBtnText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );

  // ---------------------------------------------------------------------------
  // COMPACT MODE (e.g. Embedded Side-by-Side in Student Dashboard)
  // ---------------------------------------------------------------------------
  if (compact) {
    const hasFree = freeMachines.length > 0;
    const isUserWashing = Boolean(myOccupiedMachine);

    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Washing machine live usage popup"
        style={({ pressed }) => [
          styles.compactCard,
          style,
          pressed && styles.cardPressed,
        ]}
        onPress={() => setPopupVisible(true)}>
        {/* Top Header Row */}
        <View style={styles.compactHeaderRow}>
          <View
            style={[
              styles.compactIconWrap,
              isUserWashing
                ? styles.iconWrapActiveWash
                : !residentEnabled
                ? styles.iconWrapDisabled
                : hasFree
                ? styles.iconWrapFree
                : styles.iconWrapInUse,
            ]}>
            <Text style={{ fontSize: 18 }}>🫧</Text>
          </View>
          <View
            style={[
              styles.compactPill,
              isUserWashing
                ? styles.pillActiveWash
                : !residentEnabled
                ? styles.pillDisabled
                : hasFree
                ? styles.pillFree
                : styles.pillInUse,
            ]}>
            <Text
              style={[
                styles.compactPillText,
                isUserWashing
                  ? styles.textActiveWash
                  : !residentEnabled
                  ? styles.textDisabled
                  : hasFree
                  ? styles.textFree
                  : styles.textInUse,
              ]}>
              {loading
                ? '...'
                : isUserWashing
                ? 'YOUR WASH'
                : !residentEnabled
                ? 'NOT ENABLED'
                : hasFree
                ? `${freeMachines.length} FREE`
                : 'ALL IN USE'}
            </Text>
          </View>
        </View>

        {/* Card Title & Subtitle */}
        <View style={{ flex: 1, justifyContent: 'center', marginVertical: 4 }}>
          <Text style={styles.compactCardTitle} numberOfLines={1}>
            Washing Machines
          </Text>
          <Text style={styles.compactCardSubtitle} numberOfLines={2}>
            {loading
              ? 'Checking status...'
              : isUserWashing
              ? `In Wash: ${myOccupiedMachine?.machine_name || 'Unit'}`
              : !residentEnabled
              ? requestStatus === 'pending'
                ? 'Request pending approval'
                : 'Owner enablement required'
              : hasFree
              ? `${freeMachines.length} of ${activeMachines.length} available`
              : 'All machines are currently busy'}
          </Text>
        </View>

        {/* Action Button Row */}
        <View style={styles.compactTouchPill}>
          <Text style={styles.compactTouchPillText}>
            {isUserWashing
              ? 'Manage Wash'
              : !residentEnabled
              ? 'Request Access'
              : 'Choose Machine'}
          </Text>
          <ChevronRight size={13} color="#0284C7" />
        </View>

        {/* Attach the interactive popup modal */}
        {renderPopupModal()}
      </Pressable>
    );
  }

  // ---------------------------------------------------------------------------
  // FULL / EXPANDED MODE
  // ---------------------------------------------------------------------------
  return (
    <View style={styles.card}>
      {/* Header Row */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <View
            style={[
              styles.iconWrap,
              !residentEnabled
                ? styles.iconWrapDisabled
                : freeMachines.length > 0
                ? styles.iconWrapFree
                : styles.iconWrapInUse,
            ]}>
            <Text style={styles.machineIcon}>🫧</Text>
          </View>
          <View>
            <View style={styles.titleRow}>
              <Text style={styles.cardTitle}>Washing Machines</Text>
              {isSubscribed && <View style={styles.liveDot} />}
            </View>
            <Text style={styles.cardSubtitle}>
              {loading
                ? 'Checking live availability...'
                : !residentEnabled
                ? 'Access requires owner enablement'
                : `${activeMachines.length} units installed • ${freeMachines.length} free`}
            </Text>
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open washing machines modal"
          style={styles.fullModeModalTrigger}
          onPress={() => setPopupVisible(true)}>
          <Text style={styles.fullModeModalTriggerText}>View All Units ›</Text>
        </Pressable>
      </View>

      {/* Access Control Notice for Un-enabled Residents */}
      {userRole === 'student' && !residentEnabled && !loading && (
        <View style={styles.notEnabledNotice}>
          <Text style={styles.notEnabledTitle}>Washing Machine Access Disabled</Text>
          <Text style={styles.notEnabledSub}>
            Only residents authorized by the PG owner can use the washing machines (fee: ₹500/month added to rent).
          </Text>

          {requestStatus === 'pending' ? (
            <View style={styles.pendingCard}>
              <Text style={styles.pendingText}>
                ⏳ Your access request is currently pending owner approval in billing.
              </Text>
            </View>
          ) : (
            <Pressable
              style={({ pressed }) => [
                styles.requestAccessBtn,
                pressed && styles.btnPressed,
                requestingAccess && styles.btnDisabled,
              ]}
              disabled={requestingAccess}
              onPress={handleRequestAccess}>
              {requestingAccess ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.requestAccessBtnText}>Request Access from Owner</Text>
              )}
            </Pressable>
          )}
        </View>
      )}

      {/* Content Area */}
      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="small" color="#0284C7" />
          <Text style={styles.loadingText}>Fetching status...</Text>
        </View>
      ) : errorMessage && machines.length === 0 ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{errorMessage}</Text>
          <Pressable style={styles.retryBtn} onPress={() => fetchStatus(true)}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.contentBox}>
          {activeMachines.map((m) => {
            const isUnitFree = m.status === 'free';
            const isMySession = Boolean(
              currentResidentId && m.current_resident_id === currentResidentId
            );
            const isThisLoading = actionLoading && actionUnitId === m.id;

            return (
              <View key={m.id} style={styles.fullUnitRow}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.selectedMachineTitle}>{m.machine_name}</Text>
                    <View
                      style={[
                        styles.dropdownItemBadge,
                        isMySession
                          ? styles.badgeMySession
                          : isUnitFree
                          ? styles.badgeFree
                          : styles.badgeInUse,
                      ]}>
                      <Text
                        style={[
                          styles.dropdownItemBadgeText,
                          isMySession
                            ? styles.badgeTextMySession
                            : isUnitFree
                            ? styles.badgeTextFree
                            : styles.badgeTextInUse,
                        ]}>
                        {isMySession ? 'Your Wash' : isUnitFree ? 'Free' : 'In Use'}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.infoText}>
                    {isUnitFree
                      ? 'Clean and ready to use'
                      : `Used by ${m.current_resident_name || 'Resident'} ${
                          m.current_resident_room ? `(${m.current_resident_room})` : ''
                        }`}
                  </Text>
                </View>

                {isMySession ? (
                  <Pressable
                    style={({ pressed }) => [
                      styles.actionBtn,
                      styles.releaseBtn,
                      pressed && styles.btnPressed,
                      isThisLoading && styles.btnDisabled,
                    ]}
                    disabled={actionLoading}
                    onPress={() => handleMarkFree(m.id)}>
                    {isThisLoading ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={styles.actionBtnText}>Mark Free</Text>
                    )}
                  </Pressable>
                ) : isUnitFree && userRole === 'student' && residentEnabled ? (
                  <Pressable
                    style={({ pressed }) => [
                      styles.actionBtn,
                      styles.startBtn,
                      pressed && styles.btnPressed,
                      isThisLoading && styles.btnDisabled,
                    ]}
                    disabled={actionLoading}
                    onPress={() => handleStartUsing(m.id)}>
                    {isThisLoading ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={styles.actionBtnText}>Start Wash</Text>
                    )}
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>
      )}

      {/* Attach Modal to full mode as well */}
      {renderPopupModal()}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    marginVertical: 6,
  },
  compactCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
    justifyContent: 'space-between',
    minHeight: 140,
  },
  cardPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  compactHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  compactIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  compactPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
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
  },
  compactCardSubtitle: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
    lineHeight: 15,
  },
  compactTouchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F0F9FF',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: '#BAE6FD',
    marginTop: 4,
  },
  compactTouchPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0284C7',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconWrapFree: {
    backgroundColor: '#DCFCE7',
  },
  iconWrapInUse: {
    backgroundColor: '#FEF3C7',
  },
  iconWrapActiveWash: {
    backgroundColor: '#E0F2FE',
  },
  iconWrapDisabled: {
    backgroundColor: '#F1F5F9',
  },
  machineIcon: {
    fontSize: 22,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#16A34A',
  },
  cardSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  fullModeModalTrigger: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: '#F0F9FF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  fullModeModalTriggerText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0284C7',
  },
  pillFree: {
    backgroundColor: '#DCFCE7',
  },
  pillInUse: {
    backgroundColor: '#FEF3C7',
  },
  pillActiveWash: {
    backgroundColor: '#E0F2FE',
  },
  pillDisabled: {
    backgroundColor: '#F1F5F9',
  },
  textFree: {
    color: '#16A34A',
  },
  textInUse: {
    color: '#D97706',
  },
  textActiveWash: {
    color: '#0284C7',
  },
  textDisabled: {
    color: '#64748B',
  },
  notEnabledNotice: {
    backgroundColor: '#FFFBEB',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#FDE68A',
    marginBottom: 12,
  },
  notEnabledTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#92400E',
    marginBottom: 4,
  },
  notEnabledSub: {
    fontSize: 11,
    color: '#78350F',
    lineHeight: 16,
    marginBottom: 8,
  },
  requestAccessBtn: {
    backgroundColor: '#D97706',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  requestAccessBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  pendingCard: {
    backgroundColor: '#FEF3C7',
    padding: 8,
    borderRadius: 6,
  },
  pendingText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#B45309',
  },
  contentBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 8,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    gap: 8,
  },
  fullUnitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  selectedMachineTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  infoText: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  actionBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startBtn: {
    backgroundColor: '#16A34A',
  },
  releaseBtn: {
    backgroundColor: '#0284C7',
  },
  actionBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  dropdownItemBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  dropdownItemBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  badgeFree: {
    backgroundColor: '#DCFCE7',
  },
  badgeInUse: {
    backgroundColor: '#FEE2E2',
  },
  badgeMySession: {
    backgroundColor: '#E0F2FE',
  },
  badgeTextFree: {
    color: '#15803D',
  },
  badgeTextInUse: {
    color: '#DC2626',
  },
  badgeTextMySession: {
    color: '#0284C7',
  },
  loadingBox: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 6,
  },
  errorBox: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  errorText: {
    fontSize: 12,
    color: '#DC2626',
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#0284C7',
    borderRadius: 6,
  },
  retryBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  btnPressed: {
    opacity: 0.8,
  },
  btnDisabled: {
    opacity: 0.5,
  },

  // Modal Styles (Matches Owner Dashboard Popup Design)
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  modalCloseBtn: {
    padding: 4,
  },
  modalGatingBanner: {
    backgroundColor: '#FFFBEB',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#FDE68A',
    marginBottom: 14,
  },
  modalGatingTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#92400E',
    marginBottom: 4,
  },
  modalGatingSub: {
    fontSize: 11,
    color: '#78350F',
    lineHeight: 16,
    marginBottom: 10,
  },
  modalPendingCard: {
    backgroundColor: '#FEF3C7',
    padding: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  modalPendingText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#B45309',
  },
  modalRequestBtn: {
    backgroundColor: '#D97706',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalRequestBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalEmptyBox: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  modalEmptyText: {
    fontSize: 13,
    color: '#64748B',
  },
  modalUnitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 8,
  },
  modalUnitRowMySession: {
    backgroundColor: '#F0F9FF',
    borderColor: '#BAE6FD',
  },
  modalUnitName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  modalStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
  modalStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  modalStatusText: {
    fontSize: 10,
    fontWeight: '700',
  },
  modalUnitSubFree: {
    fontSize: 11,
    color: '#15803D',
    marginTop: 2,
  },
  modalUnitOccupant: {
    fontSize: 11,
    color: '#334155',
    fontWeight: '600',
  },
  modalUnitDuration: {
    fontSize: 10,
    color: '#64748B',
  },
  modalRowBtn: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 80,
  },
  modalStartBtn: {
    backgroundColor: '#16A34A',
  },
  modalReleaseBtn: {
    backgroundColor: '#0284C7',
  },
  modalDisabledBtn: {
    backgroundColor: '#94A3B8',
  },
  modalRowBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalBusyPill: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: '#FEE2E2',
  },
  modalBusyText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#DC2626',
  },
  modalFooter: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  modalDismissBtn: {
    backgroundColor: '#F1F5F9',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalDismissBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
});
