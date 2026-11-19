import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Bell } from 'lucide-react-native';

import {
  formatCountdown,
  WashingMachineUnitData,
} from '@/services/washing-machine.service';
import { MachineTimerBadge } from '@/components/washing-machine/MachineTimerBadge';

export interface MachineSlotRowProps {
  unit: WashingMachineUnitData;
  variant: 'modal' | 'full';
  userRole: 'owner' | 'student';
  currentResidentId?: string | null;
  residentEnabled: boolean;
  actionLoading: boolean;
  actionUnitId: string | null;
  nowMs: number;
  isNotified: boolean;
  onStartUsing: (machineId: string) => void;
  onMarkFree: (machineId: string) => void;
  onToggleNotify: (unit: WashingMachineUnitData) => void;
  onRequestAccess: () => void;
}

export function MachineSlotRow({
  unit,
  variant,
  userRole,
  currentResidentId,
  residentEnabled,
  actionLoading,
  actionUnitId,
  nowMs,
  isNotified,
  onStartUsing,
  onMarkFree,
  onToggleNotify,
  onRequestAccess,
}: MachineSlotRowProps) {
  const isUnitFree = unit.status === 'free';
  const isMySession = Boolean(
    currentResidentId && unit.current_resident_id === currentResidentId
  );
  const isThisLoading = actionLoading && actionUnitId === unit.id;

  if (variant === 'full') {
    return (
      <View style={styles.fullUnitRow}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={styles.selectedMachineTitle}>{unit.machine_name}</Text>
            <MachineTimerBadge
              variant="full"
              isMySession={isMySession}
              isUnitFree={isUnitFree}
            />
          </View>
          <Text style={styles.infoText}>
            {isUnitFree
              ? 'Available'
              : `Used by ${unit.current_resident_name || 'Resident'}${
                  unit.current_resident_room
                    ? ` (${unit.current_resident_room})`
                    : ''
                } • ${formatCountdown(unit.started_at, nowMs).label}`}
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
            onPress={() => onMarkFree(unit.id)}>
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
            onPress={() => onStartUsing(unit.id)}>
            {isThisLoading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.actionBtnText}>Start Wash</Text>
            )}
          </Pressable>
        ) : !isUnitFree ? (
          <Pressable
            style={[styles.notifyBtn, isNotified && styles.notifyBtnActive]}
            onPress={() => onToggleNotify(unit)}>
            <Bell size={12} color={isNotified ? '#0284C7' : '#475569'} />
            <Text
              style={[
                styles.notifyBtnText,
                isNotified && styles.notifyBtnTextActive,
              ]}>
              {isNotified ? 'Notified' : 'Notify me when done'}
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View
      style={[
        styles.modalUnitRow,
        isMySession && styles.modalUnitRowMySession,
      ]}>
      <View style={{ flex: 1, marginRight: 10 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}>
          <Text style={styles.modalUnitName}>{unit.machine_name}</Text>
          <MachineTimerBadge
            variant="modal"
            isMySession={isMySession}
            isUnitFree={isUnitFree}
          />
        </View>

        {isUnitFree ? (
          <Text style={styles.modalUnitSubFree}>Available</Text>
        ) : (
          <View style={{ marginTop: 3 }}>
            <Text style={styles.modalUnitOccupant} numberOfLines={1}>
              {unit.current_resident_name || 'Resident'}
              {unit.current_resident_room
                ? ` (Room ${unit.current_resident_room})`
                : ''}
            </Text>
            <MachineTimerBadge
              mode="countdown"
              startedAt={unit.started_at}
              nowMs={nowMs}
            />
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
            onPress={() => onMarkFree(unit.id)}>
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
                    { text: 'Request Access', onPress: onRequestAccess },
                  ]
                );
                return;
              }
              onStartUsing(unit.id);
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
          <Pressable
            accessibilityRole="button"
            onPress={() => onToggleNotify(unit)}
            style={[styles.notifyBtn, isNotified && styles.notifyBtnActive]}>
            <Bell size={12} color={isNotified ? '#0284C7' : '#475569'} />
            <Text
              style={[
                styles.notifyBtnText,
                isNotified && styles.notifyBtnTextActive,
              ]}>
              {isNotified ? 'Notified' : 'Notify me'}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
  btnPressed: {
    opacity: 0.8,
  },
  btnDisabled: {
    opacity: 0.5,
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
  notifyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  notifyBtnActive: {
    backgroundColor: '#E0F2FE',
    borderColor: '#7DD3FC',
  },
  notifyBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  notifyBtnTextActive: {
    color: '#0284C7',
  },
});
