import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import {
  Bell,
  Building2,
  CheckCircle2,
  ExternalLink,
  Megaphone,
  MessageCircle,
  Send,
  Share2,
  Users,
} from 'lucide-react-native';

import {
  EmptyState,
  ErrorState,
  LoadingState,
  OwnerHeader,
  PrimaryButton,
  SecondaryButton,
  SectionHeader,
  StatusBadge,
} from '@/components/ui/owner';
import { OwnerTheme } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useProperty } from '@/context/property-context';
import { triggerSelectionHaptic, triggerSuccessHaptic } from '@/lib/haptics';
import { formatGateEventTimestamp, formatRoomLabel } from '@/lib/ux-utils';
import {
  AnnouncementAudience,
  AnnouncementChannel,
  AnnouncementItem,
  AnnouncementRecipient,
  AnnouncementRoomOption,
  fetchAnnouncements,
  fetchAnnouncementTargets,
  sendAnnouncement,
  SendAnnouncementResult,
  WhatsAppRecipientLink,
} from '@/services/announcements.service';

interface PushConfirmationBanner {
  title: string;
  recipientCount: number;
  pushDeliveredVia: SendAnnouncementResult['pushDeliveredVia'];
}

interface WhatsAppShareState {
  title: string;
  recipientCount: number;
  whatsappMessage: string;
  whatsappRecipients: WhatsAppRecipientLink[];
}

export default function OwnerAnnouncementsScreen() {
  const { user } = useAuth();
  const { selectedProperty, selectedPropertyId, loadingProperties } = useProperty();

  // Compose state
  const [audience, setAudience] = useState<AnnouncementAudience>('all');
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [channel, setChannel] = useState<AnnouncementChannel>('push');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Post-send feedback state
  const [pushBanner, setPushBanner] = useState<PushConfirmationBanner | null>(null);
  const [whatsappState, setWhatsappState] = useState<WhatsAppShareState | null>(null);

  // Targets & History state
  const [residents, setResidents] = useState<AnnouncementRecipient[]>([]);
  const [rooms, setRooms] = useState<AnnouncementRoomOption[]>([]);
  const [loadingTargets, setLoadingTargets] = useState(false);

  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const targetsSeqRef = useRef(0);
  const historySeqRef = useRef(0);

  const loadTargets = useCallback(async (propertyId: string) => {
    const seq = ++targetsSeqRef.current;
    setLoadingTargets(true);
    const res = await fetchAnnouncementTargets(propertyId);
    if (seq !== targetsSeqRef.current) return;

    if (res.ok) {
      setResidents(res.data.residents);
      setRooms(res.data.rooms);
    }
    setLoadingTargets(false);
  }, []);

  const loadHistory = useCallback(async (propertyId: string, forceRefresh = false) => {
    const seq = ++historySeqRef.current;
    if (!forceRefresh) {
      setLoadingHistory(true);
    }

    const res = await fetchAnnouncements(propertyId, { forceRefresh });
    if (seq !== historySeqRef.current) return;

    if (res.ok) {
      setAnnouncements(res.data);
      setHistoryError(null);
    } else {
      setHistoryError(res.error.message);
    }
    setLoadingHistory(false);
    setRefreshing(false);
  }, []);

  const refreshAll = useCallback(
    async (forceRefresh: boolean) => {
      if (!selectedPropertyId) {
        setResidents([]);
        setRooms([]);
        setAnnouncements([]);
        setHistoryError(null);
        setLoadingTargets(false);
        setLoadingHistory(false);
        setRefreshing(false);
        return;
      }

      await Promise.all([
        loadTargets(selectedPropertyId),
        loadHistory(selectedPropertyId, forceRefresh),
      ]);
    },
    [selectedPropertyId, loadTargets, loadHistory]
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const timer = setTimeout(() => {
        if (active) {
          void refreshAll(false);
        }
      }, 0);
      return () => {
        active = false;
        clearTimeout(timer);
      };
    }, [refreshAll])
  );

  const handleRefresh = useCallback(() => {
    if (!selectedPropertyId) return;
    setRefreshing(true);
    void refreshAll(true);
  }, [selectedPropertyId, refreshAll]);

  const effectiveRoomNumber = useMemo(() => {
    if (audience !== 'room') return null;
    if (selectedRoom && rooms.some((r) => r.roomNumber === selectedRoom)) {
      return selectedRoom;
    }
    return rooms[0]?.roomNumber ?? null;
  }, [audience, rooms, selectedRoom]);

  const recipientCount = useMemo(() => {
    if (audience === 'all') return residents.length;
    if (!effectiveRoomNumber) return 0;
    return rooms.find((r) => r.roomNumber === effectiveRoomNumber)?.residentCount ?? 0;
  }, [audience, residents.length, effectiveRoomNumber, rooms]);

  const whatsappRecipientsWithPhone = useMemo(() => {
    if (!whatsappState) return [];
    return whatsappState.whatsappRecipients.filter((r) => Boolean(r.url));
  }, [whatsappState]);

  const handleSend = async () => {
    if (sending || !selectedPropertyId || !user?.id) return;
    setFormError(null);

    if (!title.trim()) {
      setFormError('Please enter an announcement title.');
      return;
    }
    if (!message.trim()) {
      setFormError('Please write the announcement message.');
      return;
    }
    if (audience === 'room' && !effectiveRoomNumber) {
      setFormError('Please select a room for this announcement.');
      return;
    }

    setSending(true);
    try {
      const res = await sendAnnouncement({
        propertyId: selectedPropertyId,
        propertyName: selectedProperty?.name || 'PGwala Property',
        ownerId: user.id,
        title,
        message,
        audience,
        roomNumber: audience === 'room' ? effectiveRoomNumber : null,
        channel,
      });

      if (!res.ok) {
        setFormError(res.error.message);
        return;
      }

      triggerSuccessHaptic();
      setTitle('');
      setMessage('');

      if (channel === 'push') {
        setWhatsappState(null);
        setPushBanner({
          title: res.data.item.title,
          recipientCount: res.data.item.recipientCount,
          pushDeliveredVia: res.data.pushDeliveredVia,
        });
      } else {
        setPushBanner(null);
        setWhatsappState({
          title: res.data.item.title,
          recipientCount: res.data.item.recipientCount,
          whatsappMessage: res.data.whatsappMessage,
          whatsappRecipients: res.data.whatsappRecipients,
        });

        try {
          await Share.share({ message: res.data.whatsappMessage });
        } catch {
          // User dismissed or share sheet unavailable; action section remains visible below
        }
      }

      await loadHistory(selectedPropertyId, true);
    } finally {
      setSending(false);
    }
  };

  const handleShareBroadcastAgain = async () => {
    if (!whatsappState) return;
    try {
      await Share.share({ message: whatsappState.whatsappMessage });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not open share sheet.';
      Alert.alert('Share Unavailable', msg);
    }
  };

  const handleOpenWhatsAppRecipient = async (recipient: WhatsAppRecipientLink) => {
    if (!recipient.url) return;
    try {
      await Linking.openURL(recipient.url);
    } catch {
      Alert.alert(
        'Could Not Open WhatsApp',
        `Unable to open WhatsApp chat for ${recipient.fullName}.`
      );
    }
  };

  const sendButtonLabel =
    channel === 'push'
      ? `Send Push Notice (${recipientCount} ${recipientCount === 1 ? 'resident' : 'residents'})`
      : `Send via WhatsApp (${recipientCount} ${recipientCount === 1 ? 'resident' : 'residents'})`;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <OwnerHeader
        title="Announcements"
        subtitle={selectedProperty?.name}
        showBack
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={[OwnerTheme.colors.primary]}
            />
          }>
          {loadingProperties && !selectedPropertyId ? (
            <LoadingState message="Loading property..." />
          ) : !selectedPropertyId ? (
            <EmptyState
              icon={Building2}
              title="No Property Selected"
              description="Select or add a PG property to broadcast announcements to your residents."
            />
          ) : (
            <>
              {/* Compose Card */}
              <View style={styles.card}>
                <View style={styles.cardHeaderRow}>
                  <View style={styles.cardHeaderIcon}>
                    <Megaphone size={17} color={OwnerTheme.colors.primary} />
                  </View>
                  <View style={styles.cardHeaderTextWrap}>
                    <Text style={styles.cardTitle}>Broadcast Notice</Text>
                    <Text style={styles.cardSubtitle}>
                      Notify all residents or target a specific room
                    </Text>
                  </View>
                </View>

                {/* Audience Selector */}
                <Text style={styles.fieldLabel}>Audience</Text>
                <View style={styles.toggleRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: audience === 'all' }}
                    onPress={() => {
                      triggerSelectionHaptic();
                      setAudience('all');
                      setFormError(null);
                    }}
                    style={[
                      styles.togglePill,
                      audience === 'all' && styles.togglePillActive,
                    ]}>
                    <Users
                      size={15}
                      color={
                        audience === 'all'
                          ? OwnerTheme.colors.primary
                          : OwnerTheme.colors.textSecondary
                      }
                    />
                    <Text
                      style={[
                        styles.togglePillText,
                        audience === 'all' && styles.togglePillTextActive,
                      ]}>
                      All residents ({residents.length})
                    </Text>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: audience === 'room' }}
                    onPress={() => {
                      triggerSelectionHaptic();
                      setAudience('room');
                      if (!selectedRoom && rooms[0]) {
                        setSelectedRoom(rooms[0].roomNumber);
                      }
                      setFormError(null);
                    }}
                    style={[
                      styles.togglePill,
                      audience === 'room' && styles.togglePillActive,
                    ]}>
                    <Building2
                      size={15}
                      color={
                        audience === 'room'
                          ? OwnerTheme.colors.primary
                          : OwnerTheme.colors.textSecondary
                      }
                    />
                    <Text
                      style={[
                        styles.togglePillText,
                        audience === 'room' && styles.togglePillTextActive,
                      ]}>
                      Single room
                    </Text>
                  </Pressable>
                </View>

                {/* Room Chips when Single room is active */}
                {audience === 'room' && (
                  <View style={styles.roomPickerBox}>
                    <Text style={styles.roomPickerLabel}>Select Room</Text>
                    {loadingTargets && rooms.length === 0 ? (
                      <Text style={styles.inlineHint}>Loading rooms...</Text>
                    ) : rooms.length === 0 ? (
                      <Text style={styles.inlineHint}>
                        No active rooms found for this property yet. Add residents with room
                        numbers to target a specific room.
                      </Text>
                    ) : (
                      <View style={styles.roomChipsWrap}>
                        {rooms.map((room) => {
                          const isSelected = effectiveRoomNumber === room.roomNumber;
                          return (
                            <Pressable
                              key={room.roomNumber}
                              accessibilityRole="button"
                              accessibilityState={{ selected: isSelected }}
                              onPress={() => {
                                triggerSelectionHaptic();
                                setSelectedRoom(room.roomNumber);
                                setFormError(null);
                              }}
                              style={[
                                styles.roomChip,
                                isSelected && styles.roomChipActive,
                              ]}>
                              <Text
                                style={[
                                  styles.roomChipText,
                                  isSelected && styles.roomChipTextActive,
                                ]}>
                                {`${room.label} (${room.residentCount})`}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    )}
                  </View>
                )}

                {/* Channel Selector */}
                <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Delivery Channel</Text>
                <View style={styles.toggleRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: channel === 'push' }}
                    onPress={() => {
                      triggerSelectionHaptic();
                      setChannel('push');
                    }}
                    style={[
                      styles.togglePill,
                      channel === 'push' && styles.togglePillActive,
                    ]}>
                    <Bell
                      size={15}
                      color={
                        channel === 'push'
                          ? OwnerTheme.colors.primary
                          : OwnerTheme.colors.textSecondary
                      }
                    />
                    <Text
                      style={[
                        styles.togglePillText,
                        channel === 'push' && styles.togglePillTextActive,
                      ]}>
                      Push notification
                    </Text>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: channel === 'whatsapp' }}
                    onPress={() => {
                      triggerSelectionHaptic();
                      setChannel('whatsapp');
                    }}
                    style={[
                      styles.togglePill,
                      channel === 'whatsapp' && styles.togglePillActive,
                    ]}>
                    <MessageCircle
                      size={15}
                      color={
                        channel === 'whatsapp'
                          ? OwnerTheme.colors.primary
                          : OwnerTheme.colors.textSecondary
                      }
                    />
                    <Text
                      style={[
                        styles.togglePillText,
                        channel === 'whatsapp' && styles.togglePillTextActive,
                      ]}>
                      WhatsApp
                    </Text>
                  </Pressable>
                </View>

                {/* Title Input */}
                <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Title *</Text>
                <TextInput
                  style={styles.input}
                  value={title}
                  onChangeText={(val) => {
                    setTitle(val);
                    if (formError) setFormError(null);
                  }}
                  placeholder="e.g., Water Tank Cleaning Tomorrow"
                  placeholderTextColor={OwnerTheme.colors.textMuted}
                  maxLength={120}
                  returnKeyType="next"
                  editable={!sending}
                />

                {/* Message Input */}
                <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Message *</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={message}
                  onChangeText={(val) => {
                    setMessage(val);
                    if (formError) setFormError(null);
                  }}
                  placeholder="Write your notice for residents..."
                  placeholderTextColor={OwnerTheme.colors.textMuted}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                  maxLength={1000}
                  editable={!sending}
                />

                {formError && <ErrorState message={formError} style={styles.formError} />}

                <PrimaryButton
                  label={sendButtonLabel}
                  icon={channel === 'push' ? Send : MessageCircle}
                  loading={sending}
                  disabled={sending}
                  onPress={handleSend}
                  style={styles.sendBtn}
                />
              </View>

              {/* Inline Push Confirmation Banner */}
              {pushBanner && (
                <View style={styles.confirmationBanner}>
                  <CheckCircle2
                    size={18}
                    color={OwnerTheme.colors.success}
                    style={{ marginTop: 1 }}
                  />
                  <View style={styles.confirmationTextCol}>
                    <Text style={styles.confirmationTitle}>
                      {`Sent "${pushBanner.title}" to ${pushBanner.recipientCount} ${
                        pushBanner.recipientCount === 1 ? 'resident' : 'residents'
                      }`}
                    </Text>
                    {pushBanner.pushDeliveredVia === 'local_fallback' && (
                      <Text style={styles.fallbackNote}>
                        Saved with local fallback: remote push delivery is unavailable right now,
                        so live device push notifications could not be dispatched.
                      </Text>
                    )}
                  </View>
                </View>
              )}

              {/* WhatsApp Recipients Action Section */}
              {whatsappState && (
                <View style={styles.card}>
                  <View style={styles.whatsappHeaderRow}>
                    <View style={styles.whatsappHeaderLeft}>
                      <MessageCircle size={17} color={OwnerTheme.colors.success} />
                      <Text style={styles.cardTitle}>WhatsApp Recipients</Text>
                    </View>
                    <StatusBadge
                      label={`${whatsappState.recipientCount} matched`}
                      variant="success"
                      size="sm"
                    />
                  </View>

                  <Text style={styles.whatsappSubtext}>
                    Tap any resident below to open their pre-filled WhatsApp message, or share the
                    broadcast text again.
                  </Text>

                  {whatsappRecipientsWithPhone.length > 0 ? (
                    <View style={styles.recipientList}>
                      {whatsappRecipientsWithPhone.map((recipient, idx) => (
                        <View
                          key={recipient.id}
                          style={[
                            styles.recipientRow,
                            idx === whatsappRecipientsWithPhone.length - 1 &&
                              styles.recipientRowLast,
                          ]}>
                          <View style={styles.recipientInfo}>
                            <Text style={styles.recipientName} numberOfLines={1}>
                              {recipient.fullName}
                            </Text>
                            {recipient.phoneNumber && (
                              <Text style={styles.recipientPhone}>{recipient.phoneNumber}</Text>
                            )}
                          </View>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Send WhatsApp to ${recipient.fullName}`}
                            onPress={() => void handleOpenWhatsAppRecipient(recipient)}
                            style={({ pressed }) => [
                              styles.whatsappChipBtn,
                              pressed && { opacity: 0.8 },
                            ]}>
                            <ExternalLink size={13} color={OwnerTheme.colors.success} />
                            <Text style={styles.whatsappChipBtnText}>Message</Text>
                          </Pressable>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.inlineHint}>
                      None of the matched residents have a valid phone number on file for 1-tap
                      WhatsApp links.
                    </Text>
                  )}

                  <SecondaryButton
                    label="Share Broadcast Text"
                    icon={Share2}
                    onPress={handleShareBroadcastAgain}
                    style={styles.shareAgainBtn}
                  />
                </View>
              )}

              {/* Announcement History Section */}
              <SectionHeader
                title="Announcement History"
                meta={announcements.length > 0 ? `${announcements.length}` : undefined}
                style={{ marginTop: 6, marginBottom: 4 }}
              />

              {loadingHistory && announcements.length === 0 ? (
                <LoadingState message="Loading announcement history..." />
              ) : historyError && announcements.length === 0 ? (
                <ErrorState
                  message={historyError}
                  onRetry={() => void loadHistory(selectedPropertyId, true)}
                />
              ) : announcements.length === 0 ? (
                <EmptyState
                  icon={Megaphone}
                  title="No announcements yet"
                  description="Broadcast your first notice above to keep residents informed."
                />
              ) : (
                <View style={styles.historyList}>
                  {historyError && (
                    <ErrorState
                      message={historyError}
                      onRetry={() => void loadHistory(selectedPropertyId, true)}
                    />
                  )}
                  {announcements.map((item) => {
                    const audienceLabel =
                      item.audience === 'room' && item.roomNumber
                        ? formatRoomLabel(item.roomNumber)
                        : 'All residents';
                    const channelLabel = item.channel === 'whatsapp' ? 'WhatsApp' : 'Push';
                    const timeLabel = formatGateEventTimestamp(item.createdAt);

                    return (
                      <View key={item.id} style={styles.historyCard}>
                        <View style={styles.historyTopRow}>
                          <Text style={styles.historyTitle}>{item.title}</Text>
                          {timeLabel ? (
                            <Text style={styles.historyTimestamp}>{timeLabel}</Text>
                          ) : null}
                        </View>

                        <Text style={styles.historyMessage}>{item.message}</Text>

                        <View style={styles.historyMetaRow}>
                          <View style={styles.badgesWrap}>
                            <StatusBadge
                              label={audienceLabel}
                              variant={item.audience === 'room' ? 'info' : 'neutral'}
                              size="sm"
                            />
                            <StatusBadge
                              label={channelLabel}
                              variant={item.channel === 'whatsapp' ? 'success' : 'info'}
                              size="sm"
                            />
                          </View>
                          <Text style={styles.historyRecipientCount}>
                            {`${item.recipientCount} ${
                              item.recipientCount === 1 ? 'recipient' : 'recipients'
                            }`}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: OwnerTheme.colors.background,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    padding: OwnerTheme.spacing.lg,
    gap: 14,
    paddingBottom: 32,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
  },
  card: {
    backgroundColor: OwnerTheme.colors.card,
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: OwnerTheme.spacing.lg,
    ...OwnerTheme.shadow,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  cardHeaderIcon: {
    width: 36,
    height: 36,
    borderRadius: OwnerTheme.radius.sm,
    backgroundColor: OwnerTheme.colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardHeaderTextWrap: {
    flex: 1,
  },
  cardTitle: {
    ...OwnerTheme.typography.cardHeading,
  },
  cardSubtitle: {
    ...OwnerTheme.typography.supporting,
    marginTop: 1,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
    marginBottom: 6,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 8,
  },
  togglePill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: OwnerTheme.radius.md,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    backgroundColor: OwnerTheme.colors.surfaceElevated,
  },
  togglePillActive: {
    borderColor: OwnerTheme.colors.primary,
    backgroundColor: OwnerTheme.colors.primaryLight,
  },
  togglePillText: {
    fontSize: 13,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  togglePillTextActive: {
    color: OwnerTheme.colors.primaryDark,
  },
  roomPickerBox: {
    marginTop: 10,
    padding: 12,
    borderRadius: OwnerTheme.radius.md,
    backgroundColor: OwnerTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.borderLight,
  },
  roomPickerLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  roomChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  roomChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: OwnerTheme.radius.full,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    backgroundColor: OwnerTheme.colors.surface,
  },
  roomChipActive: {
    borderColor: OwnerTheme.colors.primary,
    backgroundColor: OwnerTheme.colors.primaryLight,
  },
  roomChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  roomChipTextActive: {
    color: OwnerTheme.colors.primaryDark,
    fontWeight: '700',
  },
  inlineHint: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
    lineHeight: 17,
  },
  input: {
    backgroundColor: OwnerTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    borderRadius: OwnerTheme.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: OwnerTheme.colors.textPrimary,
  },
  textArea: {
    minHeight: 100,
    paddingTop: 10,
  },
  formError: {
    marginTop: 10,
    marginBottom: 0,
  },
  sendBtn: {
    marginTop: 14,
  },
  confirmationBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: OwnerTheme.colors.successLight,
    borderWidth: 1,
    borderColor: '#86EFAC',
    borderRadius: OwnerTheme.radius.md,
    padding: 12,
  },
  confirmationTextCol: {
    flex: 1,
    gap: 4,
  },
  confirmationTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: OwnerTheme.colors.success,
  },
  fallbackNote: {
    fontSize: 12,
    color: OwnerTheme.colors.textPrimary,
    lineHeight: 17,
  },
  whatsappHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 6,
  },
  whatsappHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  whatsappSubtext: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
    lineHeight: 17,
    marginBottom: 10,
  },
  recipientList: {
    borderTopWidth: 1,
    borderTopColor: OwnerTheme.colors.borderLight,
  },
  recipientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: OwnerTheme.colors.borderLight,
    gap: 10,
  },
  recipientRowLast: {
    borderBottomWidth: 0,
  },
  recipientInfo: {
    flex: 1,
    minWidth: 0,
  },
  recipientName: {
    fontSize: 14,
    fontWeight: '600',
    color: OwnerTheme.colors.textPrimary,
  },
  recipientPhone: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 1,
  },
  whatsappChipBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: OwnerTheme.radius.full,
    backgroundColor: OwnerTheme.colors.successLight,
    borderWidth: 1,
    borderColor: '#86EFAC',
  },
  whatsappChipBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: OwnerTheme.colors.success,
  },
  shareAgainBtn: {
    marginTop: 10,
  },
  historyList: {
    gap: 10,
  },
  historyCard: {
    backgroundColor: OwnerTheme.colors.card,
    borderRadius: OwnerTheme.radius.card,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    padding: 14,
    gap: 8,
    ...OwnerTheme.shadow,
  },
  historyTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  historyTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  historyTimestamp: {
    fontSize: 11,
    fontWeight: '500',
    color: OwnerTheme.colors.textMuted,
    marginTop: 2,
  },
  historyMessage: {
    fontSize: 13,
    lineHeight: 19,
    color: OwnerTheme.colors.textSecondary,
  },
  historyMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 2,
  },
  badgesWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  historyRecipientCount: {
    fontSize: 12,
    fontWeight: '600',
    color: OwnerTheme.colors.textMuted,
  },
});
