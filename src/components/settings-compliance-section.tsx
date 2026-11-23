import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import {
  ChevronRight,
  FileText,
  LifeBuoy,
  Mail,
  Trash2,
  X,
} from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useModalBackHandler } from '@/hooks/use-modal-back-handler';
import { invokeEdgeFunction } from '@/lib/edge-functions';
import { extractErrorMessage } from '@/lib/error-utils';

const SUPPORT_EMAIL = 'admin.pgwala@gmail.com';

type ComplianceDialogKind = 'privacy' | 'support' | 'delete' | null;

export function SettingsComplianceSection({
  role,
  userEmail,
}: {
  role: 'owner' | 'student' | 'warden';
  userEmail?: string | null;
}) {
  const { signOut } = useAuth();
  const [dialog, setDialog] = useState<ComplianceDialogKind>(null);
  const [deleting, setDeleting] = useState(false);
  const colors = OwnerTheme.colors;

  useModalBackHandler(dialog !== null && !deleting, () => setDialog(null));

  const handleConfirmDeleteAccount = () => {
    if (deleting) return;
    Alert.alert(
      'Delete Account Permanently?',
      'This will immediately delete your login credentials and cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Permanently',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              const res = await invokeEdgeFunction<{
                success?: boolean;
                error?: string;
              }>('delete-account', {});
              if (!res?.success) {
                throw new Error(res?.error || 'Could not delete account.');
              }
              setDialog(null);
              await signOut();
              router.replace('/login');
            } catch (err: unknown) {
              Alert.alert(
                'Deletion Blocked',
                extractErrorMessage(err, 'Could not delete your account right now.')
              );
            } finally {
              setDeleting(false);
            }
          },
        },
      ]
    );
  };

  const openMail = (subject: string, body: string) => {
    const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
      subject
    )}&body=${encodeURIComponent(body)}`;
    void Linking.openURL(url).catch(() => {});
  };

  return (
    <>
      <View style={styles.section}>
        <Text style={[styles.sectionHeader, { color: colors.textMuted }]}>
          SUPPORT & PRIVACY
        </Text>
        <View
          style={[
            styles.groupedCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.settingsRow,
              { borderBottomWidth: 1, borderBottomColor: colors.borderLight },
              pressed && { backgroundColor: colors.surfaceElevated },
            ]}
            onPress={() => setDialog('privacy')}>
            <View
              style={[styles.iconWrap, { backgroundColor: colors.primaryLight }]}>
              <FileText size={18} color={colors.primary} />
            </View>
            <View style={styles.rowContent}>
              <Text style={[styles.rowTitle, { color: colors.textPrimary }]}>
                Privacy Policy & Permissions
              </Text>
              <Text style={[styles.rowSubtitle, { color: colors.textSecondary }]}>
                How PGwala handles photos, alerts & data
              </Text>
            </View>
            <ChevronRight size={18} color={colors.textMuted} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.settingsRow,
              { borderBottomWidth: 1, borderBottomColor: colors.borderLight },
              pressed && { backgroundColor: colors.surfaceElevated },
            ]}
            onPress={() => setDialog('support')}>
            <View style={[styles.iconWrap, { backgroundColor: '#F1F5F9' }]}>
              <LifeBuoy size={18} color={colors.textPrimary} />
            </View>
            <View style={styles.rowContent}>
              <Text style={[styles.rowTitle, { color: colors.textPrimary }]}>
                Help & Support
              </Text>
              <Text style={[styles.rowSubtitle, { color: colors.textSecondary }]}>
                {SUPPORT_EMAIL}
              </Text>
            </View>
            <ChevronRight size={18} color={colors.textMuted} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.settingsRow,
              pressed && { backgroundColor: colors.surfaceElevated },
            ]}
            onPress={() => setDialog('delete')}>
            <View
              style={[styles.iconWrap, { backgroundColor: colors.dangerLight }]}>
              <Trash2 size={18} color={colors.danger} />
            </View>
            <View style={styles.rowContent}>
              <Text style={[styles.rowTitle, { color: colors.danger }]}>
                Account & Data Deletion
              </Text>
              <Text style={[styles.rowSubtitle, { color: colors.textSecondary }]}>
                Request permanent account removal
              </Text>
            </View>
            <ChevronRight size={18} color={colors.textMuted} />
          </Pressable>
        </View>
      </View>

      <Modal
        visible={dialog !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setDialog(null)}>
        <View style={styles.modalOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setDialog(null)}
          />
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>
                {dialog === 'privacy'
                  ? 'Privacy & Permissions'
                  : dialog === 'support'
                    ? 'PGwala Support'
                    : 'Account & Data Deletion'}
              </Text>
              <Pressable hitSlop={8} onPress={() => setDialog(null)}>
                <X size={20} color={colors.textSecondary} />
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 340 }} showsVerticalScrollIndicator={false}>
              {dialog === 'privacy' ? (
                <View style={styles.bodyStack}>
                  <Text style={[styles.bodyText, { color: colors.textSecondary }]}>
                    PGwala only collects information needed to operate your PG/hostel
                    management workflows: account credentials, room assignment, gate
                    in/out logs, maintenance requests, and rent/EB billing records.
                  </Text>
                  <Text style={[styles.bodyHeading, { color: colors.textPrimary }]}>
                    Device Permissions Used
                  </Text>
                  <Text style={[styles.bodyText, { color: colors.textSecondary }]}>
                    • Camera & Photo Library: Only accessed when you explicitly attach
                    maintenance issue photos or UPI payment screenshots.{'\n'}
                    • Push & Local Notifications: Used for meal alerts, gate curfew
                    reminders, washing machine turns, and owner notices.{'\n'}
                    • Biometric Unlock: Verified strictly on-device via your phone&apos;s
                    secure hardware; biometric data never leaves your device.
                  </Text>
                  <Text style={[styles.bodyText, { color: colors.textSecondary }]}>
                    PGwala does not sell or share personal data with third-party
                    advertisers. Questions: {SUPPORT_EMAIL}.
                  </Text>
                </View>
              ) : dialog === 'support' ? (
                <View style={styles.bodyStack}>
                  <Text style={[styles.bodyText, { color: colors.textSecondary }]}>
                    Need help with billing records, resident onboarding, or app issues?
                    Reach our support team anytime by email and include your registered
                    email ({userEmail || 'your account email'}).
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
                    onPress={() =>
                      openMail(
                        'PGwala Support Request',
                        `Role: ${role}\nAccount: ${userEmail || 'N/A'}\n\nHow can we help?\n`
                      )
                    }>
                    <Mail size={16} color="#FFFFFF" />
                    <Text style={styles.primaryBtnText}>Email {SUPPORT_EMAIL}</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.bodyStack}>
                  <Text style={[styles.bodyText, { color: colors.textSecondary }]}>
                    {role === 'student'
                      ? 'Deleting your account immediately removes your login credentials and push tokens. Your PG owner retains past payment records for property accounting.'
                      : role === 'warden'
                        ? 'Deleting your account immediately removes your warden login and unassigns you from all PGs.'
                        : 'Deleting your owner account permanently removes your login. If you still have active residents, check them out first so no resident is stranded.'}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    disabled={deleting}
                    style={[
                      styles.primaryBtn,
                      { backgroundColor: colors.danger, opacity: deleting ? 0.6 : 1 },
                    ]}
                    onPress={handleConfirmDeleteAccount}>
                    {deleting ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <>
                        <Trash2 size={16} color="#FFFFFF" />
                        <Text style={styles.primaryBtnText}>
                          Delete My Account Permanently
                        </Text>
                      </>
                    )}
                  </Pressable>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  section: { gap: 4 },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginLeft: 4,
  },
  groupedCard: {
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    overflow: 'hidden',
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 12,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: OwnerTheme.radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rowContent: { flex: 1 },
  rowTitle: { fontSize: 14, fontWeight: '600' },
  rowSubtitle: { fontSize: 12, marginTop: 2 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    borderRadius: 18,
    padding: 20,
    maxWidth: 440,
    width: '100%',
    alignSelf: 'center',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalTitle: { fontSize: 17, fontWeight: '700' },
  bodyStack: { gap: 10 },
  bodyHeading: { fontSize: 14, fontWeight: '700', marginTop: 2 },
  bodyText: { fontSize: 13, lineHeight: 20 },
  primaryBtn: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: OwnerTheme.radius.md,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});
