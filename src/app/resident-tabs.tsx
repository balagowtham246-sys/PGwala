import React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { SwipeableTabsShell } from '@/components/swipeable-tabs-shell';
import StudentComplaintsScreen from './resident-complaints';
import StudentMenuScreen from './resident-menu';
import ResidentDashboardScreen from './resident-dashboard';
import ResidentGateHistoryScreen from './resident-gate-history';
import StudentBillingScreen from './resident-billing';

export default function ResidentTabsScreen() {
  const params = useLocalSearchParams<{ tab?: string }>();

  return (
    <SwipeableTabsShell
      role="student"
      initialTab={params.tab}
      pages={[
        <StudentComplaintsScreen key="maintenance" />,
        <StudentMenuScreen key="menu" />,
        <ResidentDashboardScreen key="home" />,
        <ResidentGateHistoryScreen key="gate" />,
        <StudentBillingScreen key="bill" />,
      ]}
    />
  );
}
