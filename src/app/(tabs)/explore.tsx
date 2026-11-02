import React from 'react';
import { Redirect } from 'expo-router';

// Explore has been replaced by the dedicated top-level /owner-settings screen.
export default function ExploreScreen() {
  return <Redirect href="/owner-settings" />;
}
