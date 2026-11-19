import React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { SwipeableTabsShell } from '@/components/swipeable-tabs-shell';
import StudentComplaintsScreen from './student-complaints';
import StudentMenuScreen from './student-menu';
import ResidentDashboardScreen from './student-dashboard';
import ResidentGateHistoryScreen from './student-gate-history';
import StudentBillingScreen from './student-billing';

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
