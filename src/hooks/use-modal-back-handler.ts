import { useEffect } from 'react';
import { BackHandler } from 'react-native';

export function createModalBackPressHandler(
  onClose: () => void,
  disabled = false
): () => boolean {
  return () => {
    if (!disabled) {
      onClose();
    }
    return true;
  };
}

/**
 * Intercepts Android hardware Back button presses while a modal is open
 * so pressing Back dismisses the modal cleanly (or blocks while busy)
 * instead of navigating away or exiting the app underneath.
 */
export function useModalBackHandler(
  visible: boolean,
  onClose: () => void,
  disabled = false
) {
  useEffect(() => {
    if (!visible) return;
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      createModalBackPressHandler(onClose, disabled)
    );
    return () => subscription.remove();
  }, [visible, onClose, disabled]);
}
