import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BottomNavTab, RoleBottomNav } from '@/components/ui/bottom-nav';
import { ResidentTabsContext } from '@/context/resident-tabs-context';

const TAB_ORDER: BottomNavTab[] = ['maintenance', 'menu', 'home', 'gate', 'bill'];

function tabToIndex(tab?: string): number {
  const idx = tab ? TAB_ORDER.indexOf(tab as BottomNavTab) : -1;
  return idx >= 0 ? idx : 2; // Default to 'home'
}

interface SwipeableTabsShellProps {
  role: 'owner' | 'student';
  initialTab?: string;
  pages: [
    React.ReactNode,
    React.ReactNode,
    React.ReactNode,
    React.ReactNode,
    React.ReactNode,
  ];
}

/**
 * Web-safe 5-tab shell counterpart to SwipeableTabsShell.
 * Avoids importing react-native-pager-view (which calls codegenNativeCommands
 * unsupported by react-native-web).
 */
export function SwipeableTabsShell({
  role,
  initialTab,
  pages,
}: SwipeableTabsShellProps) {
  const initialIndex = useMemo(() => tabToIndex(initialTab), [initialTab]);
  const [activeIndex, setActiveIndex] = useState(initialIndex);

  const activeTab = TAB_ORDER[activeIndex] ?? 'home';

  const navigateToTab = useCallback((tab: BottomNavTab) => {
    const idx = TAB_ORDER.indexOf(tab);
    if (idx < 0) return;
    setActiveIndex(idx);
  }, []);

  const contextValue = useMemo(
    () => ({
      isInsidePager: true,
      activeTab,
      navigateToTab,
    }),
    [activeTab, navigateToTab]
  );

  return (
    <ResidentTabsContext.Provider value={contextValue}>
      <View style={styles.container}>
        <View style={styles.pager}>
          <View style={styles.page}>{pages[activeIndex]}</View>
        </View>

        <RoleBottomNav
          activeTab={activeTab}
          roleOverride={role}
          isPagerShell
          onSelectTab={navigateToTab}
        />
      </View>
    </ResidentTabsContext.Provider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F7FA',
  },
  pager: {
    flex: 1,
  },
  page: {
    flex: 1,
  },
});
