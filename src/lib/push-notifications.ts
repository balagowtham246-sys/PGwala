import { Platform } from 'react-native';
import { isRunningInExpoGo } from 'expo';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

import { supabase } from '@/lib/supabase';

export const FOOD_ALERT_CHANNEL_ID = 'food-alerts';

export type PushRegistrationResult =
  | { status: 'registered'; token: string }
  | { status: 'denied' }
  | { status: 'unsupported'; reason: string }
  | { status: 'error'; message: string };

let lastRegisteredToken: string | null = null;

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(FOOD_ALERT_CHANNEL_ID, {
      name: 'Food alerts',
      importance: 6, // AndroidImportance.HIGH === 6
    });
  } catch (err) {
    console.warn('[PushNotifications] Android channel setup skipped:', err);
  }
}

function resolveProjectId(): string | undefined {
  return (
    (Constants.expoConfig?.extra as any)?.eas?.projectId ??
    (Constants as any).easConfig?.projectId ??
    undefined
  );
}

/**
 * Requests permission (if still undetermined), gets the Expo push token and stores it via RPC.
 * Never throws: permission denial or failures just mean alerts stay in-app only.
 */
export async function registerForPushNotifications(
  options: { askPermission?: boolean } = {}
): Promise<PushRegistrationResult> {
  const { askPermission = true } = options;
  try {
    if (Platform.OS === 'web') return { status: 'unsupported', reason: 'Push is not available on web.' };
    if (isRunningInExpoGo()) {
      return { status: 'unsupported', reason: 'Remote push requires a development or production build.' };
    }
    if (!Device.isDevice) return { status: 'unsupported', reason: 'Push needs a physical device.' };

    await ensureAndroidChannel();

    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;
    if (!granted && askPermission && existing.canAskAgain) {
      const requested = await Notifications.requestPermissionsAsync();
      granted = requested.granted;
    }
    if (!granted) return { status: 'denied' };

    const projectId = resolveProjectId();
    const tokenResponse = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    const token = tokenResponse.data;

    if (token !== lastRegisteredToken) {
      const { error } = await supabase.rpc('register_push_token', {
        p_token: token,
        p_platform: Platform.OS,
      });
      if (error) return { status: 'error', message: error.message };
      lastRegisteredToken = token;
    }
    return { status: 'registered', token };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

/** Removes this device's token for the signed-in user (call before sign out). */
export async function unregisterPushToken(): Promise<void> {
  const token = lastRegisteredToken;
  lastRegisteredToken = null;
  if (!token) return;
  try {
    await supabase.rpc('unregister_push_token', { p_token: token });
  } catch {
    // best effort: server also invalidates dead tokens on delivery failure
  }
}

/** Re-register if the OS rotates the push token while the app runs. */
export function subscribeToPushTokenChanges(): () => void {
  if (Platform.OS === 'web' || isRunningInExpoGo()) return () => {};
  const sub = Notifications.addPushTokenListener(() => {
    registerForPushNotifications({ askPermission: false }).catch(() => {});
  });
  return () => sub.remove();
}
