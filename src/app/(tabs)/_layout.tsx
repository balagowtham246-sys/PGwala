import { Stack } from 'expo-router';

// Layout for the "(tabs)" route group.
// Uses animation: 'none' so switching between primary RoleBottomNav tabs feels instant.
export default function TabsLayout() {
  return <Stack screenOptions={{ headerShown: false, animation: 'none' }} />;
}
