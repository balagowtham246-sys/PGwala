import AppTabs from '@/components/app-tabs';

// Layout for the "(tabs)" route group.
// The parentheses mean the folder name is NOT part of the URL,
// so (tabs)/index.tsx is still the "/" route and (tabs)/explore.tsx is "/explore".
// AppTabs renders the existing bottom tab bar (NativeTabs on Android/iOS).
export default function TabsLayout() {
  return <AppTabs />;
}

