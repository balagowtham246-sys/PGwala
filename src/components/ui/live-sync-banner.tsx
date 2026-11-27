import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WifiOff } from 'lucide-react-native';

import {
  getLiveConnectionStatus,
  LiveConnectionStatus,
  subscribeLiveConnectionStatus,
} from '@/lib/realtime-sync';

const SHOW_DELAY_MS = 3000;

/**
 * Non-intrusive live-sync status pill. Completely invisible while connected;
 * only surfaces if the realtime socket stays disconnected for >3 seconds.
 */
export function LiveSyncBanner() {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<LiveConnectionStatus>(() =>
    getLiveConnectionStatus()
  );
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    return subscribeLiveConnectionStatus(setStatus);
  }, []);

  useEffect(() => {
    if (status === 'connected') {
      const hideTimer = setTimeout(() => setVisible(false), 0);
      return () => clearTimeout(hideTimer);
    }
    const timer = setTimeout(() => {
      setVisible(true);
    }, SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [status]);

  if (!visible || status === 'connected') return null;

  return (
    <View
      pointerEvents="none"
      style={[styles.container, { top: Math.max(insets.top, 12) + 4 }]}>
      <View style={styles.pill}>
        <WifiOff size={13} color="#FEF3C7" />
        <Text style={styles.text}>Reconnecting to live updates…</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 999,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.45)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FEF3C7',
  },
});
