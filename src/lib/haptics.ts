import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/**
 * Triggers a light tactile haptic feedback on iOS/Android.
 * Safely no-ops on web or unsupported devices.
 */
export function triggerLightHaptic(): void {
  if (Platform.OS === 'web') return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/**
 * Triggers a subtle selection haptic feedback for tab/segment changes.
 */
export function triggerSelectionHaptic(): void {
  if (Platform.OS === 'web') return;
  Haptics.selectionAsync().catch(() => {});
}

/**
 * Triggers a success notification haptic feedback after completing an action.
 */
export function triggerSuccessHaptic(): void {
  if (Platform.OS === 'web') return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}
