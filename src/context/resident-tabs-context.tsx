import React, { createContext, useContext } from 'react';
import type { BottomNavTab } from '@/components/ui/bottom-nav';

interface ResidentTabsContextValue {
  isInsidePager: boolean;
  activeTab: BottomNavTab;
  navigateToTab: (tab: BottomNavTab) => void;
}

export const ResidentTabsContext = createContext<ResidentTabsContextValue>({
  isInsidePager: false,
  activeTab: 'home',
  navigateToTab: () => {},
});

export function useResidentTabs() {
  return useContext(ResidentTabsContext);
}
