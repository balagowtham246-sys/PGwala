import { AppState, type AppStateStatus, Platform } from 'react-native';
import { focusManager, QueryClient } from '@tanstack/react-query';

/**
 * Shared TanStack QueryClient configured with mobile-friendly defaults:
 * - 30s staleTime so rapid tab/screen switches reuse fresh data without extra round-trips
 * - 24h gcTime to align with MMKV persisted cache maxAge for instant cold starts
 * - retry: 1 on queries, 0 on mutations to avoid duplicate writes
 * - refetchOnWindowFocus enabled via React Native AppState focusManager
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      gcTime: 24 * 60 * 60_000,
      retry: 1,
      refetchOnMount: true,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0,
    },
  },
});

/**
 * Connects React Native AppState changes to TanStack Query's focusManager
 * so queries marked stale refetch cleanly when the app returns to foreground.
 * Returns an unsubscribe callback for cleanup.
 */
export function setupReactNativeFocusManager(): () => void {
  if (Platform.OS === 'web') {
    return () => {};
  }

  const subscription = AppState.addEventListener(
    'change',
    (status: AppStateStatus) => {
      focusManager.setFocused(status === 'active');
    }
  );

  return () => {
    subscription.remove();
  };
}
