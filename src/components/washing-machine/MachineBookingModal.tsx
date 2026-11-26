import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { useModalBackHandler } from '@/hooks/use-modal-back-handler';
import {
  WashingMachineRequestStatus,
  WashingMachineUnitData,
} from '@/services/washing-machine.service';
import { MachineSlotRow } from '@/components/washing-machine/MachineSlotRow';

export interface MachineBookingModalProps {
  visible: boolean;
  loading: boolean;
  activeMachines: WashingMachineUnitData[];
  freeCount: number;
  inUseCount: number;
  userRole: 'owner' | 'student';
  currentResidentId?: string | null;
  residentEnabled: boolean;
  hasActiveSession?: boolean;
  requestStatus: WashingMachineRequestStatus;
  requestingAccess: boolean;
  actionLoading: boolean;
  actionUnitId: string | null;
  nowMs: number;
  notifyMap: Record<string, string>;
  inQueue?: boolean;
  queueActionLoading?: boolean;
  earliestWaitLabel?: string | null;
  onClose: () => void;
  onRequestAccess: () => void;
  onStartUsing: (machineId: string) => void;
  onMarkFree: (machineId: string) => void;
  onToggleNotify: (unit: WashingMachineUnitData) => void;
  onJoinQueue?: () => void;
  onLeaveQueue?: () => void;
}

export function MachineBookingModal({
  visible,
  loading,
  activeMachines,
  freeCount,
  inUseCount,
  userRole,
  currentResidentId,
  residentEnabled,
  hasActiveSession = false,
  requestStatus,
  requestingAccess,
  actionLoading,
  actionUnitId,
  nowMs,
  notifyMap,
  inQueue = false,
  queueActionLoading = false,
  earliestWaitLabel = null,
  onClose,
  onRequestAccess,
  onStartUsing,
  onMarkFree,
  onToggleNotify,
  onJoinQueue,
  onLeaveQueue,
}: MachineBookingModalProps) {
  const isUserWashing = Boolean(
    currentResidentId &&
      activeMachines.some((m) => m.current_resident_id === currentResidentId)
  );
  const showQueueBanner =
    !loading &&
    userRole === 'student' &&
    residentEnabled &&
    activeMachines.length > 0 &&
    freeCount === 0 &&
    !isUserWashing;

  const isBusy = Boolean(requestingAccess || actionLoading || queueActionLoading);
  useModalBackHandler(visible, onClose, isBusy);

  return (
    <BottomSheetModal
      visible={visible}
      onClose={onClose}
      title="Washing Machine Units"
      subtitle={
        loading
          ? 'Loading units...'
          : `${activeMachines.length} units • ${freeCount} free, ${inUseCount} in use · Auto-free after 60m`
      }
      disabled={isBusy}
      maxHeight="88%">
          {/* Un-enabled Resident Notice */}
          {userRole === 'student' && !residentEnabled && (
            <View style={styles.modalGatingBanner}>
              <Text style={styles.modalGatingTitle}>Access Not Enabled</Text>
              <Text style={styles.modalGatingSub}>
                Washing machine service is ₹500/month added to your monthly bill. Request access from your owner to start using machines.
              </Text>
              {requestStatus === 'pending' ? (
                <View style={styles.modalPendingCard}>
                  <Text style={styles.modalPendingText}>
                    ⏳ Access request pending owner approval
                  </Text>
                </View>
              ) : (
                <Pressable
                  style={({ pressed }) => [
                    styles.modalRequestBtn,
                    pressed && styles.btnPressed,
                    requestingAccess && styles.btnDisabled,
                  ]}
                  disabled={requestingAccess}
                  onPress={onRequestAccess}>
                  {requestingAccess ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.modalRequestBtnText}>
                      Request Access from Owner
                    </Text>
                  )}
                </Pressable>
              )}
            </View>
          )}

          {/* All-busy Queue Banner */}
          {showQueueBanner && (
            <View
              style={[
                styles.modalQueueBanner,
                inQueue && styles.modalQueueBannerActive,
              ]}>
              <View style={styles.modalQueueTextWrap}>
                <Text
                  style={[
                    styles.modalQueueTitle,
                    inQueue && styles.modalQueueTitleActive,
                  ]}>
                  {inQueue ? 'In washing queue' : 'All machines are busy'}
                </Text>
                <Text
                  style={[
                    styles.modalQueueSub,
                    inQueue && styles.modalQueueSubActive,
                  ]}>
                  {inQueue
                    ? earliestWaitLabel === 'Finishing soon'
                      ? 'Earliest machine is finishing soon. We will notify you when a machine is free.'
                      : earliestWaitLabel
                      ? `We will notify you when a machine is free (earliest ${earliestWaitLabel}).`
                      : 'We will notify you as soon as a machine is free.'
                    : earliestWaitLabel === 'Finishing soon'
                    ? 'Earliest machine is finishing soon. Join the queue to get notified when free.'
                    : earliestWaitLabel
                    ? `Earliest machine has ${earliestWaitLabel}. Join the queue to get notified when free.`
                    : 'Join the queue to get notified when a machine is free.'}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={inQueue ? 'Leave queue' : 'Join queue'}
                disabled={queueActionLoading}
                style={({ pressed }) => [
                  styles.modalQueueBtn,
                  inQueue ? styles.modalLeaveQueueBtn : styles.modalJoinQueueBtn,
                  pressed && styles.btnPressed,
                  queueActionLoading && styles.btnDisabled,
                ]}
                onPress={inQueue ? onLeaveQueue : onJoinQueue}>
                {queueActionLoading ? (
                  <ActivityIndicator
                    size="small"
                    color={inQueue ? '#B45309' : '#FFFFFF'}
                  />
                ) : (
                  <Text
                    style={[
                      styles.modalQueueBtnText,
                      inQueue && styles.modalLeaveQueueBtnText,
                    ]}>
                    {inQueue ? 'Leave queue' : 'Join queue'}
                  </Text>
                )}
              </Pressable>
            </View>
          )}

          {/* Unit List */}
          <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
            {activeMachines.length === 0 ? (
              <View style={styles.modalEmptyBox}>
                <Text style={styles.modalEmptyText}>
                  {loading
                    ? 'Checking available units...'
                    : 'No washing machine units configured.'}
                </Text>
              </View>
            ) : (
              activeMachines.map((unit) => (
                <MachineSlotRow
                  key={unit.id}
                  unit={unit}
                  variant="modal"
                  userRole={userRole}
                  currentResidentId={currentResidentId}
                  residentEnabled={residentEnabled}
                  hasActiveSession={hasActiveSession}
                  actionLoading={actionLoading}
                  actionUnitId={actionUnitId}
                  nowMs={nowMs}
                  isNotified={Boolean(notifyMap[unit.id])}
                  onStartUsing={onStartUsing}
                  onMarkFree={onMarkFree}
                  onToggleNotify={onToggleNotify}
                  onRequestAccess={onRequestAccess}
                />
              ))
            )}
          </ScrollView>

          {/* Footer */}
          <View style={styles.modalFooter}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close dialog"
              style={styles.modalDismissBtn}
              onPress={onClose}>
              <Text style={styles.modalDismissBtnText}>Close</Text>
            </Pressable>
          </View>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
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
  modalQueueBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: '#F0F9FF',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#BAE6FD',
    marginBottom: 12,
  },
  modalQueueBannerActive: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  modalQueueTextWrap: {
    flex: 1,
    gap: 2,
  },
  modalQueueTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0369A1',
  },
  modalQueueTitleActive: {
    color: '#15803D',
  },
  modalQueueSub: {
    fontSize: 11,
    color: '#0C4A6E',
    lineHeight: 15,
  },
  modalQueueSubActive: {
    color: '#166534',
  },
  modalQueueBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 88,
  },
  modalJoinQueueBtn: {
    backgroundColor: '#0284C7',
  },
  modalLeaveQueueBtn: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  modalQueueBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalLeaveQueueBtnText: {
    color: '#B45309',
  },
  btnPressed: {
    opacity: 0.8,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  modalEmptyBox: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  modalEmptyText: {
    fontSize: 13,
    color: '#64748B',
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
