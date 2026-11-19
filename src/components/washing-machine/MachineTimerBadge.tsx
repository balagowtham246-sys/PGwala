import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Clock } from 'lucide-react-native';

import { formatCountdown } from '@/services/washing-machine.service';

export interface MachineTimerBadgeProps {
  mode?: 'status' | 'countdown';
  variant?: 'modal' | 'full';
  isMySession?: boolean;
  isUnitFree?: boolean;
  startedAt?: string | null;
  nowMs?: number;
}

export function MachineTimerBadge({
  mode = 'status',
  variant = 'modal',
  isMySession = false,
  isUnitFree = true,
  startedAt = null,
  nowMs = 0,
}: MachineTimerBadgeProps) {
  if (mode === 'countdown') {
    return (
      <View style={styles.countdownRow}>
        <Clock size={11} color="#D97706" />
        <Text style={styles.modalUnitDuration}>
          {formatCountdown(startedAt, nowMs).label}
        </Text>
      </View>
    );
  }

  const label = isMySession ? 'Your Wash' : isUnitFree ? 'Free' : 'In Use';

  if (variant === 'full') {
    return (
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
          {label}
        </Text>
      </View>
    );
  }

  return (
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
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  countdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  modalUnitDuration: {
    fontSize: 10,
    color: '#64748B',
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
});
