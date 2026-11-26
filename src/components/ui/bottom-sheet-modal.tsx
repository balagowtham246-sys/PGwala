import React from 'react';
import {
  DimensionValue,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';
import { useModalBackHandler } from '@/hooks/use-modal-back-handler';

export interface BottomSheetModalProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  headerBadge?: React.ReactNode;
  disabled?: boolean;
  maxHeight?: DimensionValue;
  children: React.ReactNode;
}

export function BottomSheetModal({
  visible,
  onClose,
  title,
  subtitle,
  headerBadge,
  disabled = false,
  maxHeight = '88%',
  children,
}: BottomSheetModalProps) {
  const insets = useSafeAreaInsets();

  useModalBackHandler(visible, () => {
    if (!disabled) onClose();
  });

  const handleRequestClose = () => {
    if (!disabled) onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={handleRequestClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}>
        <Pressable
          accessibilityLabel="Close modal"
          style={styles.backdrop}
          onPress={handleRequestClose}
        />
        <View
          style={[
            styles.sheet,
            {
              maxHeight,
              paddingBottom: Math.max(insets.bottom, 16) + 8,
            },
          ]}>
          <View style={styles.handle} />

          {title ? (
            <View style={styles.headerRow}>
              <View style={styles.titleCol}>
                <View style={styles.titleInlineRow}>
                  <Text style={styles.title} numberOfLines={1}>
                    {title}
                  </Text>
                  {headerBadge}
                </View>
                {subtitle ? (
                  <Text style={styles.subtitle} numberOfLines={1}>
                    {subtitle}
                  </Text>
                ) : null}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={8}
                disabled={disabled}
                style={styles.closeBtn}
                onPress={handleRequestClose}>
                <X size={18} color={OwnerTheme.colors.textSecondary} />
              </Pressable>
            </View>
          ) : null}

          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.48)',
  },
  backdrop: {
    flex: 1,
  },
  sheet: {
    backgroundColor: OwnerTheme.colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.14,
    shadowRadius: 16,
    elevation: 16,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
    marginBottom: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 14,
  },
  titleCol: {
    flex: 1,
  },
  titleInlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: OwnerTheme.colors.textPrimary,
  },
  subtitle: {
    fontSize: 12,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
