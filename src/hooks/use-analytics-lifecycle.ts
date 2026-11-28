import { useEffect, useRef } from 'react';
import { usePathname } from 'expo-router';

import { useAuth } from '@/context/auth-context';
import { useProperty } from '@/context/property-context';
import { useResident } from '@/context/resident-context';
import {
  identifyAnalyticsUser,
  resetAnalyticsUser,
  trackScreen,
} from '@/lib/analytics';

/**
 * Automatically tracks Expo Router screen transitions and syncs privacy-first
 * user/property identification (userId + role + propertyId, zero PII) with PostHog.
 */
export function useAnalyticsLifecycle(): void {
  const pathname = usePathname();
  const { session, user, profile } = useAuth();
  const { selectedProperty, selectedPropertyId } = useProperty();
  const { resident } = useResident();

  const userId = user?.id ?? null;
  const role = profile?.role ?? null;
  const displayName =
    profile?.full_name?.trim() || resident?.fullName?.trim() || null;
  const activePropertyId =
    role === 'owner'
      ? selectedPropertyId
      : role === 'student'
        ? resident?.propertyId ?? null
        : null;
  const activePropertyName =
    role === 'owner'
      ? selectedProperty?.name?.trim() ?? null
      : role === 'student'
        ? resident?.propertyName?.trim() ?? null
        : null;

  const wasSignedInRef = useRef(false);
  const lastTrackedPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (session && userId) {
      wasSignedInRef.current = true;
      identifyAnalyticsUser({
        userId,
        role,
        name: displayName,
        propertyId: activePropertyId,
        propertyName: activePropertyName,
      });
    } else if (wasSignedInRef.current) {
      wasSignedInRef.current = false;
      resetAnalyticsUser();
    }
  }, [session, userId, role, displayName, activePropertyId, activePropertyName]);

  useEffect(() => {
    if (!pathname || pathname === lastTrackedPathRef.current) return;
    lastTrackedPathRef.current = pathname;
    trackScreen(pathname, role ? { role } : undefined);
  }, [pathname, role]);
}
