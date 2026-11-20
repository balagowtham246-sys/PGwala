import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Bell, MessageCircle, Settings } from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';

interface ResidentStatusHeaderProps {
  showChat: boolean;
  hasUnreadChat: boolean;
  unreadNoticesCount?: number;
  onPressChat: () => void;
  onPressNotices: () => void;
  onPressSettings: () => void;
}

export function ResidentStatusHeader({
  showChat,
  hasUnreadChat,
  unreadNoticesCount = 0,
  onPressChat,
  onPressNotices,
  onPressSettings,
}: ResidentStatusHeaderProps) {
  return (
    <View style={styles.headerRow}>
      <Text style={styles.brandTitle}>PGwala</Text>

      <View style={styles.headerActionsRow}>
        {showChat && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="PG Community Chat"
            style={({ pressed }) => [styles.settingsBtn, pressed && styles.btnPressed]}
            onPress={onPressChat}>
            <MessageCircle size={18} color={OwnerTheme.colors.primary} />
            {hasUnreadChat && <View style={styles.chatUnreadDot} />}
          </Pressable>
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Notices and Announcements"
          hitSlop={4}
          style={({ pressed }) => [styles.settingsBtn, pressed && styles.btnPressed]}
          onPress={onPressNotices}>
          <Bell size={18} color={OwnerTheme.colors.primary} />
          {unreadNoticesCount > 0 && (
            <View style={styles.noticesBadge}>
              <Text style={styles.noticesBadgeText}>
                {unreadNoticesCount > 9 ? '9+' : String(unreadNoticesCount)}
              </Text>
            </View>
          )}
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Resident Settings"
          style={({ pressed }) => [styles.settingsBtn, pressed && styles.btnPressed]}
          onPress={onPressSettings}>
          <Settings size={18} color={OwnerTheme.colors.primary} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: OwnerTheme.colors.border,
    gap: 10,
  },
  brandTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: OwnerTheme.colors.primary,
    letterSpacing: -0.5,
  },
  headerActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  settingsBtn: {
    width: 38,
    height: 38,
    borderRadius: OwnerTheme.radius.full,
    backgroundColor: OwnerTheme.colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  chatUnreadDot: {
    position: 'absolute',
    top: 7,
    right: 7,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: OwnerTheme.colors.danger,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  noticesBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: '#DC2626',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  noticesBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFFFFF',
    lineHeight: 12,
    includeFontPadding: false,
  },
  btnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
});
