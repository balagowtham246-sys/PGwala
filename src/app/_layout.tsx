import { useEffect, useRef } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { DefaultTheme, Href, Stack, ThemeProvider, router, useSegments } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as Updates from 'expo-updates';
import * as Sentry from '@sentry/react-native';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AppErrorBoundary } from '@/components/app-error-boundary';
import { UpdateGuard } from '@/components/update-guard';
import { AuthProvider, useAuth } from '@/context/auth-context';
import { PropertyProvider } from '@/context/property-context';
import { ResidentProvider } from '@/context/resident-context';
import { ToastProvider } from '@/context/toast-context';
import { evaluateNavigationRedirect } from '@/lib/navigation-guards';
import { resolveNotificationRoute } from '@/lib/notification-routing';
import { registerForPushNotifications, subscribeToPushTokenChanges } from '@/lib/push-notifications';
import { queryClient, setupReactNativeFocusManager } from '@/lib/query-client';
import {
  mmkvQueryPersister,
  QUERY_CACHE_BUSTER,
  QUERY_CACHE_MAX_AGE_MS,
} from '@/lib/query-persister';

// Initialize Sentry crash monitoring if DSN is provided
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    debug: false,
    tracesSampleRate: 0.2,
    environment: Updates.channel || (__DEV__ ? 'development' : 'production'),
  });
  if (Updates.updateId) {
    Sentry.setTag('expo_update_id', Updates.updateId);
  }
  if (Updates.runtimeVersion) {
    Sentry.setTag('expo_runtime_version', Updates.runtimeVersion);
  }
}

SplashScreen.preventAutoHideAsync();

function RootNavigationLayout() {
  const { session, profile, isLoading } = useAuth();
  const segments = useSegments();
  const pushRole = profile?.role;
  const handledNotifIdsRef = useRef<Set<string>>(new Set());

  // Register this device for food-alert pushes (residents and wardens only).
  // Permission denial is fine: announcements remain available inside the app.
  useEffect(() => {
    if (!session || (pushRole !== 'student' && pushRole !== 'warden')) return;
    registerForPushNotifications().catch(() => {});
    return subscribeToPushTokenChanges();
  }, [session, pushRole]);

  // Route push & local notification taps (cold start + live) once signed in.
  useEffect(() => {
    if (Platform.OS === 'web' || isLoading || !session || !pushRole) return;

    const handleResponse = (response: Notifications.NotificationResponse | null | undefined) => {
      if (!response) return;
      const notifId = response.notification?.request?.identifier;
      if (notifId && handledNotifIdsRef.current.has(notifId)) return;

      const data = response.notification?.request?.content?.data as
        | Record<string, unknown>
        | undefined;
      const targetRoute = resolveNotificationRoute(data, pushRole);
      if (!targetRoute) return;

      if (notifId) {
        handledNotifIdsRef.current.add(notifId);
      }
      try {
        Notifications.clearLastNotificationResponse();
      } catch {
        // Non-fatal
      }
      router.push(targetRoute as Href);
    };

    try {
      handleResponse(Notifications.getLastNotificationResponse());
    } catch {
      // Safe on unsupported runtimes
    }

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      handleResponse(response);
    });
    return () => {
      sub.remove();
    };
  }, [isLoading, session, pushRole]);

  useEffect(() => {
    if (isLoading) return;

    const currentSegment = segments[0] as string | undefined;
    const redirectTarget = evaluateNavigationRedirect({
      hasSession: Boolean(session),
      role: profile?.role,
      currentSegment,
    });

    if (redirectTarget) {
      router.replace(redirectTarget as any);
    }
  }, [session, profile, isLoading, segments]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#0284C7" />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="owner-tabs" />
      <Stack.Screen name="resident-tabs" />
      <Stack.Screen name="resident-dashboard" />
      <Stack.Screen name="resident-in-out" />
      <Stack.Screen name="add-resident" />
      <Stack.Screen name="edit-resident" />
      <Stack.Screen name="residents-directory" />
      <Stack.Screen name="resident-profile" />
      <Stack.Screen name="owner-announcements" />
      <Stack.Screen name="notification-center" />
      <Stack.Screen name="food-menu" />
      <Stack.Screen name="billing-management" />
      <Stack.Screen name="resident-billing" />
      <Stack.Screen name="receipt-detail" />
      <Stack.Screen name="owner-complaints" />
      <Stack.Screen name="resident-complaints" />
      <Stack.Screen name="resident-gate-history" />
      <Stack.Screen name="resident-menu" />
      <Stack.Screen name="resident-settings" />
      <Stack.Screen name="resident-profile-edit" />
      <Stack.Screen name="resident-accommodation" />
      <Stack.Screen name="resident-chat" />
      <Stack.Screen name="owner-settings" />
      <Stack.Screen name="owner-profile-edit" />
      <Stack.Screen name="owner-properties" />
      <Stack.Screen name="owner-notifications" />
      <Stack.Screen name="owner-wardens" />
      <Stack.Screen name="warden-dashboard" />
      <Stack.Screen name="warden-settings" />
      <Stack.Screen name="resident-announcements" />
      <Stack.Screen name="resident-notifications" />
      <Stack.Screen name="dev-monitor" />
      <Stack.Screen name="join-pg" />
      <Stack.Screen name="pending-approval" />
      <Stack.Screen name="owner-join-requests" />
    </Stack>
  );
}

function RootLayout() {
  useEffect(() => setupReactNativeFocusManager(), []);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: mmkvQueryPersister,
        maxAge: QUERY_CACHE_MAX_AGE_MS,
        buster: QUERY_CACHE_BUSTER,
        dehydrateOptions: {
          shouldDehydrateQuery: (query) =>
            query.state.status === 'success' &&
            query.queryKey[0] !== 'washingMachine',
        },
      }}>
      <ThemeProvider value={DefaultTheme}>
        <StatusBar style="dark" />
        <AppErrorBoundary>
          <AuthProvider>
            <PropertyProvider>
              <ResidentProvider>
                <ToastProvider>
                  <AnimatedSplashOverlay />
                  <UpdateGuard />
                  <RootNavigationLayout />
                </ToastProvider>
              </ResidentProvider>
            </PropertyProvider>
          </AuthProvider>
        </AppErrorBoundary>
      </ThemeProvider>
    </PersistQueryClientProvider>
  );
}

export default SENTRY_DSN ? Sentry.wrap(RootLayout) : RootLayout;

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
  },
});
