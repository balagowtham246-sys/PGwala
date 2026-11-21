import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { DefaultTheme, Stack, ThemeProvider, router, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as Sentry from '@sentry/react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { UpdateGuard } from '@/components/update-guard';
import { AuthProvider, useAuth } from '@/context/auth-context';
import { PropertyProvider } from '@/context/property-context';
import { ResidentProvider } from '@/context/resident-context';
import { ToastProvider } from '@/context/toast-context';
import { evaluateNavigationRedirect } from '@/lib/navigation-guards';
import { registerForPushNotifications, subscribeToPushTokenChanges } from '@/lib/push-notifications';

// Initialize Sentry crash monitoring if DSN is provided
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    debug: false,
    tracesSampleRate: 0.2,
  });
}

SplashScreen.preventAutoHideAsync();

function RootNavigationLayout() {
  const { session, profile, isLoading } = useAuth();
  const segments = useSegments();
  const pushRole = profile?.role;

  // Register this device for food-alert pushes (residents and wardens only).
  // Permission denial is fine: announcements remain available inside the app.
  useEffect(() => {
    if (!session || (pushRole !== 'student' && pushRole !== 'warden')) return;
    registerForPushNotifications().catch(() => {});
    return subscribeToPushTokenChanges();
  }, [session, pushRole]);

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
      <Stack.Screen name="student-dashboard" />
      <Stack.Screen name="student-in-out" />
      <Stack.Screen name="add-resident" />
      <Stack.Screen name="edit-resident" />
      <Stack.Screen name="residents-directory" />
      <Stack.Screen name="resident-profile" />
      <Stack.Screen name="owner-announcements" />
      <Stack.Screen name="notification-center" />
      <Stack.Screen name="food-menu" />
      <Stack.Screen name="billing-management" />
      <Stack.Screen name="student-billing" />
      <Stack.Screen name="receipt-detail" />
      <Stack.Screen name="owner-complaints" />
      <Stack.Screen name="student-complaints" />
      <Stack.Screen name="student-gate-history" />
      <Stack.Screen name="student-menu" />
      <Stack.Screen name="student-settings" />
      <Stack.Screen name="student-profile-edit" />
      <Stack.Screen name="student-accommodation" />
      <Stack.Screen name="student-chat" />
      <Stack.Screen name="owner-settings" />
      <Stack.Screen name="owner-profile-edit" />
      <Stack.Screen name="owner-properties" />
      <Stack.Screen name="owner-notifications" />
      <Stack.Screen name="owner-wardens" />
      <Stack.Screen name="warden-dashboard" />
      <Stack.Screen name="warden-settings" />
      <Stack.Screen name="student-announcements" />
      <Stack.Screen name="student-notifications" />
    </Stack>
  );
}

function RootLayout() {
  return (
    <ThemeProvider value={DefaultTheme}>
      <StatusBar style="dark" />
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
    </ThemeProvider>
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
