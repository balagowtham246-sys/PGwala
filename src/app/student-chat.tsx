import { router } from 'expo-router';
import {
  ArrowLeft,
  Ban,
  Lock,
  MessageCircle,
  Send,
  Users,
} from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAuth } from '@/context/auth-context';
import { getChatLastSeenStorageKey } from '@/lib/resident-home-utils';
import { formatMovementDayLabel, getLocalDateKey } from '@/lib/movement-utils';
import {
  formatSenderRoomSubtitle,
  getChatSenderDisplayName,
} from '@/lib/chat-utils';
import { supabase } from '@/lib/supabase';

export interface ChatMessage {
  id: string;
  property_id: string;
  resident_id: string;
  message: string;
  is_deleted: boolean;
  created_at: string;
  sender_name?: string | null;
  sender_room?: string | null;
  resident?: {
    full_name: string;
    room_number: string;
  };
}

interface CurrentResident {
  id: string;
  property_id: string;
  full_name: string;
  room_number: string;
  propertyName: string;
}

export default function StudentChatScreen() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [resident, setResident] = useState<CurrentResident | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);

  const flatListRef = useRef<FlatList<ChatMessage>>(null);

  // Load active resident profile & initial chat messages
  const initChat = useCallback(async () => {
    if (!user?.id) return;
    try {
      setLoading(true);

      // 1. Fetch current active resident info
      const { data: resData, error: resError } = await supabase
        .from('residents')
        .select(`
          id,
          property_id,
          full_name,
          room_number,
          property:properties (
            name
          )
        `)
        .eq('profile_id', user.id)
        .eq('is_active', true)
        .maybeSingle();

      if (resError) throw resError;
      if (!resData) {
        setResident(null);
        setLoading(false);
        return;
      }

      const propName = Array.isArray(resData.property)
        ? resData.property[0]?.name || 'PG'
        : (resData.property as { name?: string } | null)?.name || 'PG';

      const curResident: CurrentResident = {
        id: resData.id,
        property_id: resData.property_id,
        full_name: resData.full_name,
        room_number: resData.room_number,
        propertyName: propName,
      };
      setResident(curResident);
      AsyncStorage.setItem(
        getChatLastSeenStorageKey(curResident.property_id),
        new Date().toISOString()
      ).catch(() => {});

      // 2. Fetch recent chat history
      const { data: msgData, error: msgError } = await supabase
        .from('property_chat_messages')
        .select(`
          id,
          property_id,
          resident_id,
          message,
          is_deleted,
          created_at,
          sender_name,
          sender_room,
          resident:residents (
            full_name,
            room_number
          )
        `)
        .eq('property_id', curResident.property_id)
        .order('created_at', { ascending: true })
        .limit(100);

      if (msgError) {
        console.warn('[StudentChat] History fetch warning:', msgError.message);
        setMessages([]);
      } else {
        const formatted: ChatMessage[] = (msgData || []).map((m: any) => {
          const resObj = Array.isArray(m.resident) ? m.resident[0] : m.resident;
          const sName = getChatSenderDisplayName(m.sender_name, resObj?.full_name);
          const sRoom = m.sender_room || resObj?.room_number || '';
          return {
            id: m.id,
            property_id: m.property_id,
            resident_id: m.resident_id,
            message: m.message,
            is_deleted: m.is_deleted,
            created_at: m.created_at,
            sender_name: sName,
            sender_room: sRoom,
            resident: {
              full_name: sName,
              room_number: sRoom,
            },
          };
        });
        setMessages(formatted);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[StudentChat] Initialization error:', msg);
      Alert.alert('Chat Unavailable', 'Could not connect to resident chat room.');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    initChat();
  }, [initChat]);

  // Realtime channel subscription for instant incoming messages
  useEffect(() => {
    if (!resident?.property_id) return;

    const channel = supabase
      .channel(`property-chat:${resident.property_id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'property_chat_messages',
          filter: `property_id=eq.${resident.property_id}`,
        },
        async (payload) => {
          if (payload.eventType === 'INSERT') {
            const newRow = payload.new as any;

            // Sender attribution directly from message payload (safe from RLS recursion)
            let sName = newRow.sender_name;
            let sRoom = newRow.sender_room;

            if (newRow.resident_id === resident.id) {
              sName = resident.full_name;
              sRoom = resident.room_number;
            } else if (!sName) {
              sName = 'Resident';
              sRoom = '';
            }

            const incoming: ChatMessage = {
              id: newRow.id,
              property_id: newRow.property_id,
              resident_id: newRow.resident_id,
              message: newRow.message,
              is_deleted: newRow.is_deleted,
              created_at: newRow.created_at,
              sender_name: sName,
              sender_room: sRoom,
              resident: {
                full_name: sName,
                room_number: sRoom || '',
              },
            };

            setMessages((prev) => {
              if (prev.some((m) => m.id === incoming.id)) return prev;
              return [...prev, incoming];
            });

            // Scroll to bottom
            setTimeout(() => {
              flatListRef.current?.scrollToEnd({ animated: true });
            }, 100);
          } else if (payload.eventType === 'UPDATE') {
            const updatedRow = payload.new as any;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === updatedRow.id
                  ? { ...m, is_deleted: updatedRow.is_deleted, message: updatedRow.message }
                  : m
              )
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [resident]);

  // Handle Send Message
  const handleSendMessage = async () => {
    const text = inputText.trim();
    if (!text || !resident || sending) return;

    setSending(true);
    setInputText('');

    try {
      const { error } = await supabase.from('property_chat_messages').insert({
        property_id: resident.property_id,
        resident_id: resident.id,
        message: text,
        sender_name: resident.full_name,
        sender_room: resident.room_number,
      });

      if (error) throw error;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[StudentChat] Send error:', msg);
      Alert.alert('Send Error', msg || 'Could not deliver your message.');
      setInputText(text); // restore failed input
    } finally {
      setSending(false);
    }
  };

  // Handle Soft-Delete Message
  const handlePromptDelete = (msg: ChatMessage) => {
    if (msg.resident_id !== resident?.id || msg.is_deleted) return;

    Alert.alert(
      'Delete Message',
      'Are you sure you want to delete this message? It will be marked as deleted for everyone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase
                .from('property_chat_messages')
                .update({ is_deleted: true })
                .eq('id', msg.id);

              if (error) throw error;

              setMessages((prev) =>
                prev.map((m) => (m.id === msg.id ? { ...m, is_deleted: true } : m))
              );
            } catch (err: unknown) {
              const errMsg = err instanceof Error ? err.message : String(err);
              Alert.alert('Error', errMsg || 'Could not delete message.');
            }
          },
        },
      ]
    );
  };

  const renderMessageItem = ({ item, index }: { item: ChatMessage; index: number }) => {
    const isMe = item.resident_id === resident?.id;
    const senderName = getChatSenderDisplayName(item.sender_name, item.resident?.full_name);
    const senderRoom = formatSenderRoomSubtitle(item.sender_room || item.resident?.room_number);
    const initials = senderName
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() || '')
      .join('');
    const currentDayKey = getLocalDateKey(item.created_at);
    const prevDayKey = index > 0 ? getLocalDateKey(messages[index - 1].created_at) : null;
    const showDayDivider = index === 0 || currentDayKey !== prevDayKey;
    const timeFormatted = new Date(item.created_at).toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
    });

    return (
      <View>
        {showDayDivider && (
          <View style={styles.dayDividerWrap}>
            <View style={styles.dayDividerPill}>
              <Text style={styles.dayDividerText}>
                {formatMovementDayLabel(item.created_at)}
              </Text>
            </View>
          </View>
        )}
        <View style={[styles.messageRow, isMe ? styles.messageRowMe : styles.messageRowThem]}>
          {!isMe && (
            <View style={styles.senderAvatar}>
              <Text style={styles.senderAvatarText}>{initials || 'R'}</Text>
            </View>
          )}
          <Pressable
            onLongPress={() => {
              if (isMe && !item.is_deleted) {
                handlePromptDelete(item);
              }
            }}
            delayLongPress={350}
            style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
            {/* Sender Header for other residents */}
            {!isMe && (
              <View style={styles.senderHeader}>
                <Text style={styles.senderNameText}>
                  {senderName}
                  {senderRoom ? ` • ${senderRoom}` : ''}
                </Text>
              </View>
            )}

            {/* Message Content */}
            {item.is_deleted ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Ban size={12} color={isMe ? 'rgba(255,255,255,0.7)' : '#94A3B8'} />
                <Text style={[styles.deletedMessageText, isMe && styles.deletedMessageTextMe]}>
                  This message was deleted
                </Text>
              </View>
            ) : (
              <Text style={[styles.messageText, isMe ? styles.messageTextMe : styles.messageTextThem]}>
                {item.message}
              </Text>
            )}

            {/* Footer: Timestamp */}
            <View style={styles.bubbleFooter}>
              <Text style={[styles.timeText, isMe ? styles.timeTextMe : styles.timeTextThem]}>
                {timeFormatted}
              </Text>
            </View>
          </Pressable>
        </View>
      </View>
    );
  };

  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      flatListRef.current?.scrollToEnd({ animated: true });
    });
    return () => sub.remove();
  }, []);

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#0284C7" />
          <Text style={styles.loadingText}>Opening PG Chat...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!resident) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
            <ArrowLeft size={22} color="#0F172A" />
          </Pressable>
          <Text style={styles.headerTitle}>PG Community Chat</Text>
        </View>

        <View style={styles.centerContainer}>
          <Users size={48} color="#94A3B8" />
          <Text style={styles.unlinkedTitle}>Room Not Assigned</Text>
          <Text style={styles.unlinkedSub}>
            You must be assigned to an active PG room to join the resident community chat.
          </Text>
          <Pressable style={styles.backHomeBtn} onPress={() => router.back()}>
            <Text style={styles.backHomeBtnText}>Back to Dashboard</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      {/* Screen Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <ArrowLeft size={22} color="#0F172A" />
        </Pressable>

        <View style={styles.headerTextWrap}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {resident.propertyName} Chat
          </Text>
          <View style={styles.securityBadge}>
            <Lock size={11} color="#059669" />
            <Text style={styles.securityText}>Private to Residents • Owner Excluded</Text>
          </View>
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
        {/* Messages List */}
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessageItem}
          contentContainerStyle={styles.listContent}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <MessageCircle size={36} color="#0284C7" style={{ marginBottom: 10 }} />
              <Text style={styles.emptyTitle}>Welcome to {resident.propertyName} Chat</Text>
              <Text style={styles.emptySub}>
                Say hello to your flatmates. Discuss maintenance issues, EB bill splits, food
                updates, and daily PG coordination in complete privacy.
              </Text>
            </View>
          }
        />

        {/* Input Bar */}
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.textInput}
            placeholder="Type a message to your flatmates..."
            placeholderTextColor="#94A3B8"
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={1000}
          />
          <Pressable
            style={[
              styles.sendBtn,
              (!inputText.trim() || sending) && styles.sendBtnDisabled,
            ]}
            onPress={handleSendMessage}
            disabled={!inputText.trim() || sending}>
            {sending ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Send size={18} color="#FFFFFF" />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  keyboardView: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    fontSize: 14,
    color: '#64748B',
    marginTop: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  backBtn: {
    padding: 6,
    marginRight: 10,
  },
  headerTextWrap: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  securityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  securityText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#059669',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    flexGrow: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    marginTop: 80,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 6,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 19,
    textAlign: 'center',
  },
  messageRow: {
    flexDirection: 'row',
    marginVertical: 4,
  },
  messageRowMe: {
    justifyContent: 'flex-end',
  },
  messageRowThem: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '82%',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  bubbleMe: {
    backgroundColor: '#0284C7',
    borderBottomRightRadius: 2,
  },
  bubbleThem: {
    backgroundColor: '#FFFFFF',
    borderBottomLeftRadius: 2,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  dayDividerWrap: {
    alignItems: 'center',
    marginVertical: 10,
  },
  dayDividerPill: {
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
  },
  dayDividerText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  senderAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#E0F2FE',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
    alignSelf: 'flex-end',
  },
  senderAvatarText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0284C7',
  },
  senderHeader: {
    marginBottom: 4,
  },
  senderNameText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0284C7',
  },
  messageText: {
    fontSize: 14,
    lineHeight: 20,
  },
  messageTextMe: {
    color: '#FFFFFF',
  },
  messageTextThem: {
    color: '#0F172A',
  },
  deletedMessageText: {
    fontSize: 13,
    fontStyle: 'italic',
    color: '#94A3B8',
  },
  deletedMessageTextMe: {
    color: 'rgba(255,255,255,0.7)',
  },
  bubbleFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    marginTop: 4,
  },
  timeText: {
    fontSize: 10,
  },
  timeTextMe: {
    color: 'rgba(255,255,255,0.75)',
  },
  timeTextThem: {
    color: '#94A3B8',
  },
  deleteBtn: {
    padding: 2,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    gap: 8,
  },
  textInput: {
    flex: 1,
    backgroundColor: '#F1F5F9',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    fontSize: 14,
    color: '#0F172A',
    maxHeight: 100,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#0284C7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: '#94A3B8',
    opacity: 0.6,
  },
  unlinkedTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 14,
    marginBottom: 6,
  },
  unlinkedSub: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 20,
  },
  backHomeBtn: {
    backgroundColor: '#0284C7',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  backHomeBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});

