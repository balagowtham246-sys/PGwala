import { Stack } from 'expo-router';

// Layout for the "(tabs)" route group without bottom tab bar.
// Owner dashboard renders full-screen with top-header settings navigation,
// identical to the student portal architecture.
export default function TabsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
