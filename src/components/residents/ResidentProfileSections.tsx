import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Href, router } from 'expo-router';
import {
  BedDouble,
  CreditCard,
  DoorOpen,
  Edit3,
  Lock,
  LogOut,
  Receipt,
  Utensils,
  Wrench,
} from 'lucide-react-native';

import {
  DestructiveButton,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  StatusBadgeVariant,
} from '@/components/ui/owner';
import { OwnerTheme } from '@/constants/theme';
import { formatPaiseToRupees } from '@/lib/billing-utils';
import {
  formatGateEventTimestamp,
  formatIsoDateDisplay,
  toSentenceCaseStatus,
} from '@/lib/ux-utils';
import { ResidentProfileData } from '@/services/residents.service';

function getDuesBadgeVariant(
  status: ResidentProfileData['currentMonthDuesStatus']
): StatusBadgeVariant {
  if (status === 'paid') return 'success';
  if (status === 'unpaid') return 'danger';
  return 'neutral';
}

function getComplaintBadgeVariant(status: string): StatusBadgeVariant {
  const normalized = status.toLowerCase();
  if (normalized === 'resolved') return 'success';
  if (normalized === 'in_progress') return 'warning';
  if (normalized === 'rejected') return 'danger';
  return 'info';
}

export function ResidentProfileSections({
  profile,
  roomBedDisplay,
  gateStatusLabel,
  gateStatusVariant,
  editingNotes,
  notesDraft,
  savingNotes,
  onChangeNotesDraft,
  onStartEditNotes,
  onCancelEditNotes,
  onSaveNotes,
  onOpenRoomModal,
  onRecordPaymentPress,
  onOpenCheckoutModal,
}: {
  profile: ResidentProfileData;
  roomBedDisplay: string;
  gateStatusLabel: string;
  gateStatusVariant: StatusBadgeVariant;
  editingNotes: boolean;
  notesDraft: string;
  savingNotes: boolean;
  onChangeNotesDraft: (val: string) => void;
  onStartEditNotes: () => void;
  onCancelEditNotes: () => void;
  onSaveNotes: () => void;
  onOpenRoomModal: () => void;
  onRecordPaymentPress: () => void;
  onOpenCheckoutModal: () => void;
}) {
  return (
    <>
      {/* 1. Stay Section */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleRow}>
            <BedDouble size={16} color={OwnerTheme.colors.primary} />
            <Text style={styles.sectionTitle}>Stay</Text>
          </View>
        </View>

        <View style={styles.kvRow}>
          <Text style={styles.kvLabel}>Joining date</Text>
          <Text style={styles.kvValue}>
            {formatIsoDateDisplay(profile.joiningDate)}
          </Text>
        </View>
        <View style={styles.kvRow}>
          <Text style={styles.kvLabel}>Room & Bed</Text>
          <Text style={styles.kvValue}>{roomBedDisplay}</Text>
        </View>
        <View style={styles.kvRow}>
          <Text style={styles.kvLabel}>Monthly rent</Text>
          <Text style={styles.kvValue}>
            {formatPaiseToRupees(profile.monthlyRentPaise)}
          </Text>
        </View>
        <View style={styles.kvRow}>
          <Text style={styles.kvLabel}>Security deposit</Text>
          <Text style={styles.kvValue}>
            {formatPaiseToRupees(profile.depositPaise)}
          </Text>
        </View>
        <View style={[styles.kvRow, styles.kvRowLast]}>
          <Text style={styles.kvLabel}>Emergency contact</Text>
          <Text style={styles.kvValue} numberOfLines={2}>
            {profile.emergencyContact?.trim() || 'Not set'}
          </Text>
        </View>
      </View>

      {/* 2. Dues Section */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleRow}>
            <Receipt size={16} color={OwnerTheme.colors.primary} />
            <Text style={styles.sectionTitle}>Dues</Text>
          </View>
          <StatusBadge
            label={toSentenceCaseStatus(profile.currentMonthDuesStatus)}
            variant={getDuesBadgeVariant(profile.currentMonthDuesStatus)}
            size="sm"
          />
        </View>

        <View style={styles.kvRow}>
          <Text style={styles.kvLabel}>This month</Text>
          <Text style={styles.kvValue}>
            {toSentenceCaseStatus(profile.currentMonthDuesStatus)}
          </Text>
        </View>
        <View style={[styles.kvRow, styles.kvRowLast]}>
          <Text style={styles.kvLabel}>Outstanding total</Text>
          <Text
            style={[
              styles.kvValue,
              profile.pendingDuesPaise > 0 && { color: OwnerTheme.colors.danger },
            ]}>
            {formatPaiseToRupees(profile.pendingDuesPaise)}
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          style={styles.sectionFooterLink}
          onPress={() =>
            router.push({
              pathname: '/billing-management',
              params: { residentId: profile.id },
            } as Href)
          }>
          <Text style={styles.sectionFooterLinkText}>View in Billing ›</Text>
        </Pressable>
      </View>

      {/* 3. Gate Section */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleRow}>
            <DoorOpen size={16} color={OwnerTheme.colors.primary} />
            <Text style={styles.sectionTitle}>Gate</Text>
          </View>
          <StatusBadge
            label={gateStatusLabel}
            variant={gateStatusVariant}
            size="sm"
          />
        </View>

        <Text style={styles.subLabel}>Last 7 days movements</Text>
        {profile.lastSevenDaysLogs.length === 0 ? (
          <Text style={styles.emptySectionText}>
            No gate movements recorded in the last 7 days.
          </Text>
        ) : (
          <View style={styles.listStack}>
            {profile.lastSevenDaysLogs.slice(0, 6).map((log, index, arr) => (
              <View
                key={log.id}
                style={[
                  styles.timelineRow,
                  index === arr.length - 1 && styles.kvRowLast,
                ]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.timelineTitle}>
                    {log.direction === 'IN' ? 'Checked in' : 'Checked out'}
                    {log.purpose ? ` · ${log.purpose}` : ''}
                  </Text>
                  <Text style={styles.timelineSub}>
                    {formatGateEventTimestamp(log.event_time)}
                  </Text>
                </View>
                <StatusBadge
                  label={toSentenceCaseStatus(log.direction)}
                  variant={log.direction === 'IN' ? 'success' : 'warning'}
                  size="sm"
                />
              </View>
            ))}
          </View>
        )}

        <Pressable
          accessibilityRole="button"
          style={styles.sectionFooterLink}
          onPress={() =>
            router.push({
              pathname: '/student-in-out',
              params: { residentId: profile.id },
            } as Href)
          }>
          <Text style={styles.sectionFooterLinkText}>View in Gate ›</Text>
        </Pressable>
      </View>

      {/* 4. Complaints Section */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleRow}>
            <Wrench size={16} color={OwnerTheme.colors.primary} />
            <Text style={styles.sectionTitle}>Complaints</Text>
          </View>
          <Text style={styles.sectionMeta}>
            {profile.openComplaintsCount} open · {profile.resolvedComplaintsCount}{' '}
            resolved
          </Text>
        </View>

        {profile.recentComplaints.length === 0 ? (
          <Text style={styles.emptySectionText}>
            No complaints logged for this resident.
          </Text>
        ) : (
          <View style={styles.listStack}>
            {profile.recentComplaints.slice(0, 3).map((complaint, idx, arr) => (
              <View
                key={complaint.id}
                style={[
                  styles.timelineRow,
                  idx === arr.length - 1 && styles.kvRowLast,
                ]}>
                <View style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                  <Text style={styles.timelineTitle} numberOfLines={1}>
                    {complaint.title}
                  </Text>
                  <Text style={styles.timelineSub}>
                    {formatIsoDateDisplay(complaint.created_at)} ·{' '}
                    {toSentenceCaseStatus(complaint.priority)}
                  </Text>
                </View>
                <StatusBadge
                  label={toSentenceCaseStatus(complaint.status)}
                  variant={getComplaintBadgeVariant(complaint.status)}
                  size="sm"
                />
              </View>
            ))}
          </View>
        )}

        <Pressable
          accessibilityRole="button"
          style={styles.sectionFooterLink}
          onPress={() =>
            router.push({
              pathname: '/owner-complaints',
              params: { residentId: profile.id },
            } as Href)
          }>
          <Text style={styles.sectionFooterLinkText}>View in Maintenance ›</Text>
        </Pressable>
      </View>

      {/* 5. Meals Section */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleRow}>
            <Utensils size={16} color={OwnerTheme.colors.primary} />
            <Text style={styles.sectionTitle}>Meals</Text>
          </View>
          <StatusBadge
            label={profile.dinnerRegisteredToday ? 'Registered' : 'Not needed'}
            variant={profile.dinnerRegisteredToday ? 'success' : 'neutral'}
            size="sm"
          />
        </View>
        <Text style={styles.mealStatusText}>{profile.dinnerStatusLabel}</Text>
      </View>

      {/* 6. Notes Section (Owner-only) */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleRow}>
            <Lock size={15} color={OwnerTheme.colors.textSecondary} />
            <Text style={styles.sectionTitle}>Notes</Text>
            <View style={styles.privatePill}>
              <Text style={styles.privatePillText}>Only visible to you</Text>
            </View>
          </View>
          {!editingNotes && (
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              onPress={onStartEditNotes}>
              <Text style={styles.editNoteLink}>Edit</Text>
            </Pressable>
          )}
        </View>

        {editingNotes ? (
          <View style={styles.noteEditBox}>
            <TextInput
              style={styles.noteInput}
              value={notesDraft}
              onChangeText={onChangeNotesDraft}
              placeholder="Add private owner notes (ID verification, preferences, remarks)..."
              placeholderTextColor={OwnerTheme.colors.textMuted}
              multiline
              numberOfLines={3}
            />
            <View style={styles.noteBtnRow}>
              <Pressable
                accessibilityRole="button"
                disabled={savingNotes}
                style={styles.noteCancelBtn}
                onPress={onCancelEditNotes}>
                <Text style={styles.noteCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={savingNotes}
                style={[styles.noteSaveBtn, savingNotes && { opacity: 0.6 }]}
                onPress={onSaveNotes}>
                {savingNotes ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.noteSaveText}>Save Note</Text>
                )}
              </Pressable>
            </View>
          </View>
        ) : (
          <Text style={styles.noteBodyText}>
            {profile.notes?.trim() || 'No owner notes added yet.'}
          </Text>
        )}
      </View>

      {/* Action Bar */}
      <View style={styles.actionBarCard}>
        <Text style={styles.actionBarHeading}>Actions</Text>
        <View style={styles.actionGrid}>
          <SecondaryButton
            label="Edit details"
            icon={Edit3}
            onPress={() =>
              router.push({
                pathname: '/edit-resident',
                params: { id: profile.id },
              } as Href)
            }
            style={styles.actionGridBtn}
          />
          <SecondaryButton
            label="Change room"
            icon={BedDouble}
            disabled={!profile.isActive}
            onPress={onOpenRoomModal}
            style={styles.actionGridBtn}
          />
          <PrimaryButton
            label="Record payment"
            icon={CreditCard}
            onPress={onRecordPaymentPress}
            style={styles.actionGridBtn}
          />
          <DestructiveButton
            label={profile.isActive ? 'Check out' : 'Checked out'}
            icon={LogOut}
            disabled={!profile.isActive}
            onPress={onOpenCheckoutModal}
            style={styles.actionGridBtn}
          />
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  sectionCard: {
    backgroundColor: OwnerTheme.colors.card,
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 15,
    ...OwnerTheme.shadow,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 8,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flex: 1,
    flexWrap: 'wrap',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  sectionMeta: {
    fontSize: 12,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  kvRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: OwnerTheme.colors.borderLight,
    gap: 12,
  },
  kvRowLast: {
    borderBottomWidth: 0,
    paddingBottom: 2,
  },
  kvLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: OwnerTheme.colors.textSecondary,
  },
  kvValue: {
    fontSize: 13,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
    textAlign: 'right',
    flexShrink: 1,
  },
  sectionFooterLink: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: OwnerTheme.colors.borderLight,
    alignItems: 'flex-end',
  },
  sectionFooterLinkText: {
    fontSize: 13,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  subLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
    marginBottom: 6,
  },
  emptySectionText: {
    fontSize: 13,
    color: OwnerTheme.colors.textMuted,
    paddingVertical: 4,
  },
  listStack: {
    gap: 2,
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: OwnerTheme.colors.borderLight,
    gap: 8,
  },
  timelineTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  timelineSub: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 1,
  },
  mealStatusText: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  privatePill: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: OwnerTheme.radius.full,
  },
  privatePillText: {
    fontSize: 11,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  editNoteLink: {
    fontSize: 13,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
  noteBodyText: {
    fontSize: 13,
    lineHeight: 19,
    color: OwnerTheme.colors.textSecondary,
  },
  noteEditBox: {
    gap: 10,
  },
  noteInput: {
    backgroundColor: OwnerTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    borderRadius: OwnerTheme.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: OwnerTheme.colors.textPrimary,
    minHeight: 78,
    textAlignVertical: 'top',
  },
  noteBtnRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  noteCancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: OwnerTheme.radius.sm,
    backgroundColor: '#F1F5F9',
  },
  noteCancelText: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  noteSaveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: OwnerTheme.radius.sm,
    backgroundColor: OwnerTheme.colors.primary,
  },
  noteSaveText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  actionBarCard: {
    backgroundColor: OwnerTheme.colors.card,
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 15,
    gap: 10,
    ...OwnerTheme.shadow,
  },
  actionBarHeading: {
    fontSize: 14,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  actionGridBtn: {
    width: '48%',
    flexGrow: 1,
    height: 46,
    paddingHorizontal: 12,
  },
});
