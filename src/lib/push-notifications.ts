import { Platform } from 'react-native';
import { isRunningInExpoGo } from 'expo';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

import { extractErrorMessage } from '@/lib/error-utils';
import { supabase } from '@/lib/supabase';

export const FOOD_ALERT_CHANNEL_ID = 'food-alerts';
export const PG_NOTICES_CHANNEL_ID = 'pg-notices';

export type PushRegistrationResult =
  | { status: 'registered'; token: string }
  | { status: 'denied' }
  | { status: 'unsupported'; reason: string }
  | { status: 'error'; message: string };

let lastRegisteredToken: string | null = null;
let lastDevicePushToken: string | null = null;
let lastRegistrationAtMs = 0;
let registrationInFlight: Promise<PushRegistrationResult> | null = null;

const TOKEN_REFRESH_COOLDOWN_MS = 60_000;

/** Resets module-level push state (for unit tests only). */
export function resetPushNotificationsStateForTests(): void {
  lastRegisteredToken = null;
  lastDevicePushToken = null;
  lastRegistrationAtMs = 0;
  registrationInFlight = null;
}

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  try {
    await Promise.all([
      Notifications.setNotificationChannelAsync('default', {
        name: 'General PG Alerts',
        importance: 4, // AndroidImportance.HIGH === 4
      }),
      Notifications.setNotificationChannelAsync(FOOD_ALERT_CHANNEL_ID, {
        name: 'Food alerts',
        importance: 4,
      }),
      Notifications.setNotificationChannelAsync(PG_NOTICES_CHANNEL_ID, {
        name: 'PG notices & reminders',
        importance: 4,
      }),
    ]);
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
 * Coalesces concurrent calls and never throws: permission denial or failures just mean alerts
 * stay in-app only.
 */
export async function registerForPushNotifications(
  options: { askPermission?: boolean } = {}
): Promise<PushRegistrationResult> {
  if (registrationInFlight) {
    return registrationInFlight;
  }

  const { askPermission = true } = options;

  const run = (async (): Promise<PushRegistrationResult> => {
    try {
      if (Platform.OS === 'web') {
        return { status: 'unsupported', reason: 'Push is not available on web.' };
      }
      if (isRunningInExpoGo()) {
        return {
          status: 'unsupported',
          reason: 'Remote push requires a development or production build.',
        };
      }
      if (!Device.isDevice) {
        return { status: 'unsupported', reason: 'Push needs a physical device.' };
      }

      await ensureAndroidChannel();

      const existing = await Notifications.getPermissionsAsync();
      let granted = existing.granted;
      if (!granted && askPermission && existing.canAskAgain) {
        const requested = await Notifications.requestPermissionsAsync();
        granted = requested.granted;
      }
      if (!granted) return { status: 'denied' };

      const projectId = resolveProjectId();
      const tokenResponse = await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : undefined
      );
      const token = tokenResponse.data;
      lastRegistrationAtMs = Date.now();

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
      return {
        status: 'error',
        message: extractErrorMessage(err, 'Could not register for push notifications.'),
      };
    }
  })();

  registrationInFlight = run;
  try {
    return await run;
  } finally {
    if (registrationInFlight === run) {
      registrationInFlight = null;
    }
  }
}

/** Removes this device's token for the signed-in user (call before sign out). */
export async function unregisterPushToken(): Promise<void> {
  const token = lastRegisteredToken;
  lastRegisteredToken = null;
  lastDevicePushToken = null;
  lastRegistrationAtMs = 0;
  if (!token) return;
  try {
    await supabase.rpc('unregister_push_token', { p_token: token });
  } catch {
    // best effort: server also invalidates dead tokens on delivery failure
  }
}

/** Re-register if the OS rotates the push token while the app runs (loop-guarded). */
export function subscribeToPushTokenChanges(): () => void {
  if (Platform.OS === 'web' || isRunningInExpoGo() || !Device.isDevice) {
    return () => {};
  }
  const sub = Notifications.addPushTokenListener((event) => {
    const rawData = event?.data;
    const incomingDeviceToken =
      typeof rawData === 'string'
        ? rawData
        : rawData != null
          ? JSON.stringify(rawData)
          : null;

    // On Android, calling getExpoPushTokenAsync() can itself emit addPushTokenListener.
    // Record the token and bail out if registration is already in flight, token is unchanged,
    // or we are still inside the 60s cooldown window.
    if (registrationInFlight) {
      if (incomingDeviceToken) {
        lastDevicePushToken = incomingDeviceToken;
      }
      return;
    }
    if (incomingDeviceToken && incomingDeviceToken === lastDevicePushToken) {
      return;
    }
    if (
      lastRegistrationAtMs > 0 &&
      Date.now() - lastRegistrationAtMs < TOKEN_REFRESH_COOLDOWN_MS
    ) {
      if (incomingDeviceToken) {
        lastDevicePushToken = incomingDeviceToken;
      }
      return;
    }
    if (incomingDeviceToken) {
      lastDevicePushToken = incomingDeviceToken;
    }
    registerForPushNotifications({ askPermission: false }).catch(() => {});
  });
  return () => sub.remove();
}
