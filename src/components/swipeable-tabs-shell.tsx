import { useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import PagerView from 'react-native-pager-view';

import { BottomNavTab, RoleBottomNav } from '@/components/ui/bottom-nav';
import { ResidentTabsContext } from '@/context/resident-tabs-context';

const TAB_ORDER: BottomNavTab[] = ['maintenance', 'menu', 'home', 'gate', 'bill'];
export const HOME_TAB_INDEX = 2;

export function createTabsBackPressHandler(
  getActiveIndex: () => number,
  onReturnHome: () => void
): () => boolean {
  return () => {
    if (getActiveIndex() !== HOME_TAB_INDEX) {
      onReturnHome();
      return true;
    }
    return false;
  };
}

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
 * Native ViewPager2/UIPageViewController 5-tab swipe shell (Instagram-style)
 * shared by both Resident and Owner portals.
 */
export function SwipeableTabsShell({
  role,
  initialTab,
  pages,
}: SwipeableTabsShellProps) {
  const initialIndex = useMemo(() => tabToIndex(initialTab), [initialTab]);
  const pagerRef = useRef<PagerView>(null);

  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const activeIndexRef = useRef(initialIndex);

  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  const [mountedIndices, setMountedIndices] = useState<Set<number>>(
    () => new Set([initialIndex])
  );

  const activeTab = TAB_ORDER[activeIndex] ?? 'home';

  const markMounted = useCallback((idx: number) => {
    setMountedIndices((prev) => {
      if (prev.has(idx)) return prev;
      const next = new Set(prev);
      next.add(idx);
      return next;
    });
  }, []);

  const navigateToTab = useCallback(
    (tab: BottomNavTab) => {
      const idx = TAB_ORDER.indexOf(tab);
      if (idx < 0) return;
      markMounted(idx);
      activeIndexRef.current = idx;
      setActiveIndex(idx);
      pagerRef.current?.setPage(idx);
    },
    [markMounted]
  );

  // Android hardware back returns to the Home tab before exiting the shell.
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener(
        'hardwareBackPress',
        createTabsBackPressHandler(
          () => activeIndexRef.current,
          () => navigateToTab('home')
        )
      );
      return () => subscription.remove();
    }, [navigateToTab])
  );

  // Preload adjacent pages silently after Home settles so cold start stays snappy
  useEffect(() => {
    const timer = setTimeout(() => {
      setMountedIndices((prev) => {
        const next = new Set(prev);
        if (activeIndex > 0) next.add(activeIndex - 1);
        if (activeIndex < TAB_ORDER.length - 1) next.add(activeIndex + 1);
        return next.size === prev.size ? prev : next;
      });
    }, 1200);
    return () => clearTimeout(timer);
  }, [activeIndex]);

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
        <PagerView
          ref={pagerRef}
          style={styles.pager}
          initialPage={initialIndex}
          offscreenPageLimit={1}
          onPageSelected={(e) => {
            const idx = e.nativeEvent.position;
            markMounted(idx);
            setActiveIndex(idx);
          }}>
          {TAB_ORDER.map((tabKey, idx) => (
            <View key={tabKey} style={styles.page}>
              {mountedIndices.has(idx) ? pages[idx] : null}
            </View>
          ))}
        </PagerView>

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
