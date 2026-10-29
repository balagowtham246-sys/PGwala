import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, router, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AuthProvider, useAuth } from '@/context/auth-context';

SplashScreen.preventAutoHideAsync();

function RootNavigationLayout() {
  const { session, profile, isLoading } = useAuth();
  const segments = useSegments();

  useEffect(() => {
    if (isLoading) return;

    const currentSegment = segments[0] as string | undefined;
    const inAuthGroup = currentSegment === 'login';
    const isOwner = session && profile?.role === 'owner';
    const isStudent = session && profile?.role === 'student';

    if (!session || !profile) {
      // User is not logged in -> redirect to /login
      if (!inAuthGroup) {
        router.replace('/login');
      }
      return;
    }

    if (isOwner) {
      // Owner should not be on /login or /student-dashboard
      if (inAuthGroup || currentSegment === 'student-dashboard') {
        router.replace('/(tabs)');
      }
    } else if (isStudent) {
      // Student should not be on /login or any owner route
      const ownerRoutes = [
        '(tabs)',
        'student-in-out',
        'add-resident',
        'edit-resident',
        'food-menu',
      ];
      if (
        inAuthGroup ||
        (currentSegment && ownerRoutes.includes(currentSegment)) ||
        !currentSegment
      ) {
        router.replace('/student-dashboard');
      }
    } else {
      // Unknown role or invalid state -> redirect to /login
      if (!inAuthGroup) {
        router.replace('/login');
      }
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
    </Stack>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthProvider>
        <AnimatedSplashOverlay />
        <RootNavigationLayout />
      </AuthProvider>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
  },
});
