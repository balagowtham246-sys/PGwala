import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { BottomTabInset } from '@/constants/theme';

export interface ToastOptions {
  actionLabel?: string;
  onAction?: () => void;
  durationMs?: number;
}

interface ToastState {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastContextValue {
  showToast: (message: string, options?: ToastOptions) => void;
  hideToast: () => void;
}

const ToastContext = createContext<ToastContextValue>({
  showToast: () => {},
  hideToast: () => {},
});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextIdRef = useRef(0);

  const hideToast = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setToast(null);
  }, []);

  const showToast = useCallback((message: string, options?: ToastOptions) => {
    const clean = message.trim();
    if (!clean) return;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    nextIdRef.current += 1;
    const id = nextIdRef.current;

    setToast({
      id,
      message: clean,
      actionLabel: options?.actionLabel,
      onAction: options?.onAction,
    });

    const duration =
      typeof options?.durationMs === 'number' && options.durationMs > 0
        ? options.durationMs
        : options?.actionLabel
        ? 7500
        : 3200;

    timerRef.current = setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current));
      timerRef.current = null;
    }, duration);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const handleActionPress = () => {
    if (!toast) return;
    const callback = toast.onAction;
    hideToast();
    if (callback) callback();
  };

  return (
    <ToastContext.Provider value={{ showToast, hideToast }}>
      <View style={styles.root}>
        {children}
        {toast ? (
          <View pointerEvents="box-none" style={styles.overlay}>
            <View
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              style={styles.pill}>
              <Text style={styles.messageText} numberOfLines={2}>
                {toast.message}
              </Text>
              {toast.actionLabel && toast.onAction ? (
                <Pressable
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={handleActionPress}>
                  <Text style={styles.actionText}>{toast.actionLabel}</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}
      </View>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
    elevation: 20,
    justifyContent: 'flex-end',
  },
  pill: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: BottomTabInset + 14,
    backgroundColor: '#0F172A',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.24,
        shadowRadius: 12,
      },
      android: {
        elevation: 8,
      },
      web: {
        boxShadow: '0 8px 24px rgba(15, 23, 42, 0.28)',
      },
    }),
  },
  messageText: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  actionText: {
    color: '#38BDF8',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
});
