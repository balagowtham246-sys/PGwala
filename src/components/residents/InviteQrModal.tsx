import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import {
  QrCode,
  RefreshCw,
  Share2,
  X,
} from 'lucide-react-native';

import {
  HIGH_CONTRAST_SWITCH_COLORS,
  SWITCH_THUMB_COLOR,
} from '@/components/ui/owner';
import { OwnerTheme } from '@/constants/theme';
import { useToast } from '@/context/toast-context';
import {
  buildInviteWhatsAppMessage,
  buildJoinDeepLink,
  buildQrSvgPath,
  formatInviteCodeDisplay,
} from '@/lib/invite-utils';
import {
  fetchPropertyInviteSettings,
  regeneratePropertyInviteCode,
  togglePropertyInviteEnabled,
} from '@/services/join-requests.service';

export interface InviteQrModalProps {
  visible: boolean;
  propertyId: string | null;
  propertyName: string;
  onClose: () => void;
}

export function InviteQrModal({
  visible,
  propertyId,
  propertyName,
  onClose,
}: InviteQrModalProps) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [inviteEnabled, setInviteEnabled] = useState(true);
  const [busyAction, setBusyAction] = useState<'regen' | 'toggle' | null>(null);

  const loadSettings = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    try {
      const settings = await fetchPropertyInviteSettings(propertyId);
      setInviteCode(settings.invite_code);
      setInviteEnabled(settings.invite_enabled);
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    if (!visible || !propertyId) return;
    const timer = setTimeout(() => {
      void loadSettings();
    }, 0);
    return () => clearTimeout(timer);
  }, [visible, propertyId, loadSettings]);

  const qrMatrix = useMemo(() => {
    if (!inviteCode) return null;
    try {
      return buildQrSvgPath(buildJoinDeepLink(inviteCode));
    } catch {
      return null;
    }
  }, [inviteCode]);

  const handleShare = async () => {
    if (!inviteCode) return;
    const message = buildInviteWhatsAppMessage({ propertyName, inviteCode });
    try {
      await Share.share({
        title: `Join ${propertyName} on PGwala`,
        message,
      });
    } catch {
      Alert.alert('Share Unavailable', 'Could not open share sheet on this device.');
    }
  };

  const handleRegenerate = () => {
    if (!propertyId || busyAction) return;
    Alert.alert(
      'Generate New Invite Code?',
      'Your old QR poster and code will stop working immediately. Already-approved residents are unaffected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Generate New',
          style: 'destructive',
          onPress: async () => {
            setBusyAction('regen');
            try {
              const nextCode = await regeneratePropertyInviteCode(propertyId);
              setInviteCode(nextCode);
              showToast(`New invite code generated: ${nextCode}`);
            } catch (err) {
              Alert.alert(
                'Update Failed',
                err instanceof Error ? err.message : 'Could not generate new code.'
              );
            } finally {
              setBusyAction(null);
            }
          },
        },
      ]
    );
  };

  const handleToggleEnabled = async (nextVal: boolean) => {
    if (!propertyId || busyAction) return;
    const prev = inviteEnabled;
    setInviteEnabled(nextVal);
    setBusyAction('toggle');
    try {
      await togglePropertyInviteEnabled(propertyId, nextVal);
      showToast(nextVal ? 'Self-joining enabled.' : 'Self-joining paused.');
    } catch (err) {
      setInviteEnabled(prev);
      Alert.alert(
        'Update Failed',
        err instanceof Error ? err.message : 'Could not update invite setting.'
      );
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <QrCode size={18} color={OwnerTheme.colors.primary} />
              <Text style={styles.sheetTitle}>PG Invite QR & Code</Text>
            </View>
            <Pressable hitSlop={8} onPress={onClose}>
              <X size={20} color="#64748B" />
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 12 }}>
            {loading ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator size="large" color={OwnerTheme.colors.primary} />
              </View>
            ) : !inviteCode ? (
              <View style={styles.missingWrap}>
                <Text style={styles.missingTitle}>Invite Code Not Ready Yet</Text>
                <Text style={styles.missingSub}>
                  Deploy migration 30 & the resident-join-request Edge Function to
                  activate QR self-onboarding, or tap Generate Code below.
                </Text>
                <Pressable
                  style={styles.shareBtn}
                  disabled={busyAction === 'regen'}
                  onPress={handleRegenerate}>
                  <RefreshCw size={16} color="#FFFFFF" />
                  <Text style={styles.shareBtnText}>Generate Invite Code</Text>
                </Pressable>
              </View>
            ) : (
              <>
                {/* Printable Dark-Slate QR Poster */}
                <View style={styles.posterCard}>
                  <Text style={styles.posterEyebrow}>JOIN MY PG ON PGWALA</Text>
                  <Text style={styles.posterPgName} numberOfLines={2}>
                    {propertyName}
                  </Text>

                  <View
                    style={[
                      styles.qrFrame,
                      !inviteEnabled && { opacity: 0.35 },
                    ]}>
                    {qrMatrix && (
                      <Svg
                        width={184}
                        height={184}
                        viewBox={`-2 -2 ${qrMatrix.size + 4} ${qrMatrix.size + 4}`}>
                        <Rect
                          x={-2}
                          y={-2}
                          width={qrMatrix.size + 4}
                          height={qrMatrix.size + 4}
                          fill="#FFFFFF"
                        />
                        <Path d={qrMatrix.pathData} fill="#0F172A" />
                      </Svg>
                    )}
                  </View>

                  <Text style={styles.posterCodeLabel}>INVITE CODE</Text>
                  <Text style={styles.posterCode}>
                    {formatInviteCodeDisplay(inviteCode)}
                  </Text>
                  <Text style={styles.posterHint}>
                    {inviteEnabled
                      ? 'Scan with phone camera or enter code in PGwala app'
                      : 'Joining is currently paused by PG owner'}
                  </Text>
                </View>

                {/* Primary Share CTA */}
                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.shareBtn,
                    pressed && { opacity: 0.85 },
                  ]}
                  onPress={() => void handleShare()}>
                  <Share2 size={16} color="#FFFFFF" />
                  <Text style={styles.shareBtnText}>
                    Share Invite on WhatsApp
                  </Text>
                </Pressable>

                {/* Owner Controls: Pause + Regenerate */}
                <View style={styles.controlCard}>
                  <View style={styles.controlRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.controlTitle}>
                        Allow New Join Requests
                      </Text>
                      <Text style={styles.controlSub}>
                        Turn off to temporarily pause scanning this QR
                      </Text>
                    </View>
                    <Switch
                      value={inviteEnabled}
                      disabled={busyAction !== null}
                      onValueChange={(val) => void handleToggleEnabled(val)}
                      trackColor={HIGH_CONTRAST_SWITCH_COLORS}
                      thumbColor={SWITCH_THUMB_COLOR}
                      ios_backgroundColor={HIGH_CONTRAST_SWITCH_COLORS.false}
                    />
                  </View>

                  <View style={styles.divider} />

                  <Pressable
                    accessibilityRole="button"
                    disabled={busyAction !== null}
                    style={({ pressed }) => [
                      styles.regenRow,
                      pressed && { opacity: 0.7 },
                    ]}
                    onPress={handleRegenerate}>
                    {busyAction === 'regen' ? (
                      <ActivityIndicator
                        size="small"
                        color={OwnerTheme.colors.primary}
                      />
                    ) : (
                      <RefreshCw size={16} color={OwnerTheme.colors.primary} />
                    )}
                    <Text style={styles.regenText}>
                      Regenerate Invite Code (invalidates old QR)
                    </Text>
                  </Pressable>
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#F8FAFC',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 24,
    maxHeight: '92%',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  loadingWrap: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  missingWrap: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 20,
    alignItems: 'center',
    gap: 10,
  },
  missingTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  missingSub: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 19,
  },
  posterCard: {
    backgroundColor: '#0F172A',
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
    marginBottom: 14,
  },
  posterEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: '#38BDF8',
    letterSpacing: 1,
  },
  posterPgName: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 16,
  },
  qrFrame: {
    backgroundColor: '#FFFFFF',
    padding: 12,
    borderRadius: 16,
    marginBottom: 16,
  },
  posterCodeLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 1.2,
  },
  posterCode: {
    fontSize: 28,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 3,
    marginTop: 2,
  },
  posterHint: {
    fontSize: 12,
    color: '#CBD5E1',
    textAlign: 'center',
    marginTop: 8,
  },
  shareBtn: {
    height: 50,
    borderRadius: 14,
    backgroundColor: OwnerTheme.colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  shareBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  controlCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  controlTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  controlSub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 12,
  },
  regenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  regenText: {
    fontSize: 13,
    fontWeight: '700',
    color: OwnerTheme.colors.primary,
  },
});
