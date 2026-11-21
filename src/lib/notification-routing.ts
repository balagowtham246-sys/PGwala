export type NotificationUserRole = 'owner' | 'student' | 'warden';

const SAFE_ROUTE_WHITELIST = new Set<string>([
  '/(tabs)',
  '/student-dashboard',
  '/warden-dashboard',
  '/student-billing',
  '/billing-management',
  '/student-complaints',
  '/owner-complaints',
  '/student-announcements',
  '/owner-announcements',
  '/student-menu',
  '/food-menu',
  '/student-gate-history',
  '/student-in-out',
  '/student-chat',
  '/notification-center',
  '/student-notifications',
]);

function extractSafeRouteCandidate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/')) return null;
  const pathOnly = trimmed.split('?')[0];
  return SAFE_ROUTE_WHITELIST.has(pathOnly) ? trimmed : null;
}

/**
 * Resolves a safe internal Expo Router pathname from a push or local notification's
 * `data` payload, tailored to the signed-in user's role.
 */
export function resolveNotificationRoute(
  data: Record<string, unknown> | null | undefined,
  role?: NotificationUserRole | null
): string | null {
  if (!data || typeof data !== 'object') return null;

  const explicitRoute =
    extractSafeRouteCandidate(data.route) ??
    extractSafeRouteCandidate(data.url);
  if (explicitRoute) {
    return explicitRoute;
  }

  const rawType = typeof data.type === 'string' ? data.type.trim().toLowerCase() : '';
  if (!rawType) return null;

  switch (rawType) {
    case 'food_alert':
    case 'food':
    case 'meal':
      if (role === 'warden') return '/warden-dashboard';
      if (role === 'owner') return '/(tabs)';
      return '/student-menu';

    case 'announcement':
    case 'notice':
      return role === 'owner' ? '/owner-announcements' : '/student-announcements';

    case 'bill':
    case 'billing':
    case 'payment':
    case 'payment_proof':
    case 'rent':
      return role === 'owner' ? '/billing-management' : '/student-billing';

    case 'complaint':
    case 'maintenance':
      return role === 'owner' ? '/owner-complaints' : '/student-complaints';

    case 'washing_machine':
    case 'wm_queue':
    case 'wm_free':
      return role === 'owner' ? '/(tabs)' : '/student-dashboard';

    case 'gate':
    case 'movement':
    case 'return_reminder':
      return role === 'owner' ? '/student-in-out' : '/student-gate-history';

    case 'chat':
      return '/student-chat';

    default:
      return null;
  }
}
