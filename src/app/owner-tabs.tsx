import React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { SwipeableTabsShell } from '@/components/swipeable-tabs-shell';
import OwnerComplaintsScreen from './owner-complaints';
import FoodMenuScreen from './food-menu';
import OwnerDashboardScreen from './(tabs)/index';
import StudentInOutScreen from './student-in-out';
import BillingManagementScreen from './billing-management';

export default function OwnerTabsScreen() {
  const params = useLocalSearchParams<{ tab?: string }>();

  return (
    <SwipeableTabsShell
      role="owner"
      initialTab={params.tab}
      pages={[
        <OwnerComplaintsScreen key="maintenance" />,
        <FoodMenuScreen key="menu" />,
        <OwnerDashboardScreen key="home" />,
        <StudentInOutScreen key="gate" />,
        <BillingManagementScreen key="bill" />,
      ]}
    />
  );
}
