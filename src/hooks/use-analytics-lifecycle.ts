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
  const { selectedPropertyId } = useProperty();
  const { resident } = useResident();

  const userId = user?.id ?? null;
  const role = profile?.role ?? null;
  const activePropertyId =
    role === 'owner'
      ? selectedPropertyId
      : role === 'student'
        ? resident?.propertyId ?? null
        : null;

  const wasSignedInRef = useRef(false);
  const lastTrackedPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (session && userId) {
      wasSignedInRef.current = true;
      identifyAnalyticsUser({
        userId,
        role,
        propertyId: activePropertyId,
      });
    } else if (wasSignedInRef.current) {
      wasSignedInRef.current = false;
      resetAnalyticsUser();
    }
  }, [session, userId, role, activePropertyId]);

  useEffect(() => {
    if (!pathname || pathname === lastTrackedPathRef.current) return;
    lastTrackedPathRef.current = pathname;
    trackScreen(pathname, role ? { role } : undefined);
  }, [pathname, role]);
}
