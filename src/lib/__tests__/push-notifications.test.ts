import {
  registerForPushNotifications,
  resetPushNotificationsStateForTests,
  subscribeToPushTokenChanges,
} from '@/lib/push-notifications';
import { supabase } from '@/lib/supabase';
import * as Notifications from 'expo-notifications';

let tokenListenerCallback: ((event: { data?: unknown; type?: string }) => void) | null = null;
const mockSubRemove = jest.fn();

jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
}));

jest.mock('expo', () => ({
  isRunningInExpoGo: jest.fn(() => false),
}));

jest.mock('expo-device', () => ({
  isDevice: true,
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { eas: { projectId: 'test-project-id' } } },
  },
}));

jest.mock('expo-notifications', () => ({
  setNotificationChannelAsync: jest.fn(async () => undefined),
  getPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[abc123]' })),
  addPushTokenListener: jest.fn((cb: (event: { data?: unknown; type?: string }) => void) => {
    tokenListenerCallback = cb;
    return { remove: mockSubRemove };
  }),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(async () => ({ error: null })),
  },
}));

const mockedGetExpoPushTokenAsync = Notifications.getExpoPushTokenAsync as jest.Mock;
const mockedRpc = supabase.rpc as jest.Mock;

describe('push-notifications Android OOM loop guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    tokenListenerCallback = null;
    resetPushNotificationsStateForTests();
    mockedGetExpoPushTokenAsync.mockReset();
    mockedGetExpoPushTokenAsync.mockResolvedValue({
      data: 'ExponentPushToken[abc123]',
    });
    mockedRpc.mockReset();
    mockedRpc.mockResolvedValue({ error: null });
  });

  it('coalesces concurrent registerForPushNotifications calls into a single token fetch', async () => {
    let resolveToken: (v: { data: string }) => void = () => {};
    let signalTokenStarted: () => void = () => {};
    const tokenStarted = new Promise<void>((resolve) => {
      signalTokenStarted = resolve;
    });
    mockedGetExpoPushTokenAsync.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveToken = resolve;
          signalTokenStarted();
        })
    );

    const p1 = registerForPushNotifications();
    const p2 = registerForPushNotifications();
    const p3 = registerForPushNotifications({ askPermission: false });

    await tokenStarted;
    resolveToken({ data: 'ExponentPushToken[concurrent-1]' });

    const results = await Promise.all([p1, p2, p3]);
    expect(mockedGetExpoPushTokenAsync).toHaveBeenCalledTimes(1);
    expect(mockedRpc).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      { status: 'registered', token: 'ExponentPushToken[concurrent-1]' },
      { status: 'registered', token: 'ExponentPushToken[concurrent-1]' },
      { status: 'registered', token: 'ExponentPushToken[concurrent-1]' },
    ]);
  });

  it('does not loop when getExpoPushTokenAsync synchronously emits addPushTokenListener on Android', async () => {
    const unsubscribe = subscribeToPushTokenChanges();

    mockedGetExpoPushTokenAsync.mockImplementation(async () => {
      // Simulate Android emitting a device token event while getExpoPushTokenAsync runs
      tokenListenerCallback?.({ data: 'fcm-device-token-1', type: 'android' });
      return { data: 'ExponentPushToken[android-1]' };
    });

    const res = await registerForPushNotifications();
    expect(res).toEqual({ status: 'registered', token: 'ExponentPushToken[android-1]' });
    expect(mockedGetExpoPushTokenAsync).toHaveBeenCalledTimes(1);

    // Subsequent emissions with the same token or inside cooldown are ignored
    tokenListenerCallback?.({ data: 'fcm-device-token-1', type: 'android' });
    tokenListenerCallback?.({ data: 'fcm-device-token-2', type: 'android' });
    await Promise.resolve();
    await Promise.resolve();

    expect(mockedGetExpoPushTokenAsync).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(mockSubRemove).toHaveBeenCalledTimes(1);
  });

  it('re-registers only when a genuinely new device token arrives after the 60s cooldown', async () => {
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000_000);

    const unsubscribe = subscribeToPushTokenChanges();
    await registerForPushNotifications();
    expect(mockedGetExpoPushTokenAsync).toHaveBeenCalledTimes(1);

    // Same token after cooldown -> still ignored
    nowSpy.mockReturnValue(1_000_000 + 70_000);
    tokenListenerCallback?.({ data: 'fcm-token-A', type: 'android' });
    await new Promise((r) => setTimeout(r, 0));
    expect(mockedGetExpoPushTokenAsync).toHaveBeenCalledTimes(2);

    // Repeat same token 'fcm-token-A' even another 70s later -> ignored
    nowSpy.mockReturnValue(1_000_000 + 140_000);
    tokenListenerCallback?.({ data: 'fcm-token-A', type: 'android' });
    await new Promise((r) => setTimeout(r, 0));
    expect(mockedGetExpoPushTokenAsync).toHaveBeenCalledTimes(2);

    // New rotated token 'fcm-token-B' after cooldown -> triggers registration
    tokenListenerCallback?.({ data: 'fcm-token-B', type: 'android' });
    await new Promise((r) => setTimeout(r, 0));
    expect(mockedGetExpoPushTokenAsync).toHaveBeenCalledTimes(3);

    unsubscribe();
    nowSpy.mockRestore();
  });
});
