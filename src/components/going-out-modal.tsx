import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Clock, Utensils, X } from 'lucide-react-native';

import { OwnerTheme } from '@/constants/theme';
import { triggerSelectionHaptic } from '@/lib/haptics';

const PURPOSE_OPTIONS = ['College', 'Work', 'Home Visit', 'Outing', 'Other'];
const RETURN_TIME_OPTIONS = [
  'Evening (~8:00 PM)',
  'Night (~10:00 PM)',
  'Late Night (~11:30 PM)',
  'Tomorrow Morning',
  'Custom',
];

export interface GoingOutSubmitPayload {
  purpose: string;
  expectedReturnTime: string;
  foodRequired: boolean;
}

interface GoingOutModalProps {
  visible: boolean;
  saving?: boolean;
  onClose: () => void;
  onConfirm: (payload: GoingOutSubmitPayload) => Promise<void> | void;
}

/**
 * Modern, shared Going Out of PG bottom sheet used by both Home and Gate tabs.
 */
export function GoingOutModal({
  visible,
  saving = false,
  onClose,
  onConfirm,
}: GoingOutModalProps) {
  const [purpose, setPurpose] = useState('College');
  const [customPurpose, setCustomPurpose] = useState('');
  const [returnTime, setReturnTime] = useState('Evening (~8:00 PM)');
  const [customReturnTime, setCustomReturnTime] = useState('');
  const [foodRequired, setFoodRequired] = useState(true);

  const handleConfirmPress = () => {
    const finalPurpose =
      purpose === 'Other' ? customPurpose.trim() || 'Personal / Other' : purpose;
    const finalReturn =
      returnTime === 'Custom' ? customReturnTime.trim() || 'Later' : returnTime;
    void onConfirm({
      purpose: finalPurpose,
      expectedReturnTime: finalReturn,
      foodRequired,
    });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handleBar} />
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Going Out of PG</Text>
              <Text style={styles.subtitle}>
                Share your return estimate and dinner plan
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Close"
              hitSlop={10}
              style={styles.closeBtn}
              onPress={onClose}>
              <X size={18} color={OwnerTheme.colors.textSecondary} />
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.scrollBody}>
            <Text style={styles.sectionLabel}>Purpose</Text>
            <View style={styles.chipWrap}>
              {PURPOSE_OPTIONS.map((opt) => {
                const selected = purpose === opt;
                return (
                  <Pressable
                    key={opt}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => {
                      triggerSelectionHaptic();
                      setPurpose(opt);
                    }}>
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {opt}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {purpose === 'Other' && (
              <TextInput
                style={styles.input}
                placeholder="Specify purpose (e.g., Doctor visit)"
                placeholderTextColor={OwnerTheme.colors.textMuted}
                value={customPurpose}
                onChangeText={setCustomPurpose}
                maxLength={60}
              />
            )}

            <View style={styles.labelRow}>
              <Clock size={14} color={OwnerTheme.colors.textSecondary} />
              <Text style={styles.sectionLabel}>Expected Return</Text>
            </View>
            <View style={styles.chipWrap}>
              {RETURN_TIME_OPTIONS.map((opt) => {
                const selected = returnTime === opt;
                return (
                  <Pressable
                    key={opt}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => {
                      triggerSelectionHaptic();
                      setReturnTime(opt);
                    }}>
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {opt}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {returnTime === 'Custom' && (
              <TextInput
                style={styles.input}
                placeholder="e.g., Around 9:15 PM"
                placeholderTextColor={OwnerTheme.colors.textMuted}
                value={customReturnTime}
                onChangeText={setCustomReturnTime}
                maxLength={40}
              />
            )}

            <View style={styles.dinnerCard}>
              <View style={styles.dinnerIconWrap}>
                <Utensils size={18} color={OwnerTheme.colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.dinnerTitle}>Need dinner tonight?</Text>
                <Text style={styles.dinnerSub}>
                  Helps the kitchen avoid food waste
                </Text>
              </View>
              <Switch
                value={foodRequired}
                onValueChange={setFoodRequired}
                trackColor={{ false: '#E2E8F0', true: OwnerTheme.colors.primary }}
                thumbColor="#FFFFFF"
              />
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              style={styles.cancelBtn}
              onPress={onClose}
              disabled={saving}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.confirmBtn, saving && { opacity: 0.65 }]}
              onPress={handleConfirmPress}
              disabled={saving}>
              {saving ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.confirmText}>Mark Going Out</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(15, 23, 42, 0.48)',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 24,
    maxHeight: '85%',
  },
  handleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: OwnerTheme.colors.textPrimary,
  },
  subtitle: {
    fontSize: 13,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 2,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollBody: {
    gap: 12,
    paddingBottom: 8,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  chipSelected: {
    backgroundColor: OwnerTheme.colors.primary,
    borderColor: OwnerTheme.colors.primary,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  chipTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  input: {
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    paddingHorizontal: 14,
    fontSize: 14,
    color: OwnerTheme.colors.textPrimary,
    backgroundColor: '#F8FAFC',
  },
  dinnerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    marginTop: 4,
  },
  dinnerIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: OwnerTheme.colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dinnerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: OwnerTheme.colors.textPrimary,
  },
  dinnerSub: {
    fontSize: 12,
    color: OwnerTheme.colors.textSecondary,
    marginTop: 1,
  },
  footer: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  cancelBtn: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: OwnerTheme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  cancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: OwnerTheme.colors.textSecondary,
  },
  confirmBtn: {
    flex: 2,
    height: 48,
    borderRadius: 14,
    backgroundColor: OwnerTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
