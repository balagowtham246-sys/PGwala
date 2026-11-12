import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, router, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as Sentry from '@sentry/react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { UpdateGuard } from '@/components/update-guard';
import { AuthProvider, useAuth } from '@/context/auth-context';
import { PropertyProvider } from '@/context/property-context';
import { evaluateNavigationRedirect } from '@/lib/navigation-guards';

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
      <Stack.Screen name="student-dashboard" />
      <Stack.Screen name="student-in-out" />
      <Stack.Screen name="add-resident" />
      <Stack.Screen name="edit-resident" />
      <Stack.Screen name="food-menu" />
      <Stack.Screen name="billing-management" />
      <Stack.Screen name="eb-billing" />
      <Stack.Screen name="student-billing" />
      <Stack.Screen name="receipt-detail" />
      <Stack.Screen name="owner-complaints" />
      <Stack.Screen name="student-complaints" />
      <Stack.Screen name="student-gate-history" />
      <Stack.Screen name="student-settings" />
      <Stack.Screen name="student-profile-edit" />
      <Stack.Screen name="student-accommodation" />
      <Stack.Screen name="student-chat" />
      <Stack.Screen name="owner-settings" />
      <Stack.Screen name="owner-profile-edit" />
      <Stack.Screen name="owner-properties" />
      <Stack.Screen name="owner-notifications" />
    </Stack>
  );
}

function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthProvider>
        <PropertyProvider>
          <AnimatedSplashOverlay />
          <UpdateGuard />
          <RootNavigationLayout />
        </PropertyProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default Sentry.wrap(RootLayout);

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
  },
});
