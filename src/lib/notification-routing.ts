export type NotificationUserRole = 'owner' | 'student' | 'warden';

const SAFE_ROUTE_WHITELIST = new Set<string>([
  '/(tabs)',
  '/resident-dashboard',
  '/warden-dashboard',
  '/resident-billing',
  '/billing-management',
  '/resident-complaints',
  '/owner-complaints',
  '/resident-announcements',
  '/owner-announcements',
  '/resident-menu',
  '/food-menu',
  '/resident-gate-history',
  '/resident-in-out',
  '/resident-chat',
  '/notification-center',
  '/resident-notifications',
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
      return '/resident-menu';

    case 'announcement':
    case 'notice':
      return role === 'owner' ? '/owner-announcements' : '/resident-announcements';

    case 'bill':
    case 'billing':
    case 'payment':
    case 'payment_proof':
    case 'rent':
      return role === 'owner' ? '/billing-management' : '/resident-billing';

    case 'complaint':
    case 'maintenance':
      return role === 'owner' ? '/owner-complaints' : '/resident-complaints';

    case 'washing_machine':
    case 'wm_queue':
    case 'wm_free':
      return role === 'owner' ? '/(tabs)' : '/resident-dashboard';

    case 'gate':
    case 'movement':
    case 'return_reminder':
      return role === 'owner' ? '/resident-in-out' : '/resident-gate-history';

    case 'chat':
      return '/resident-chat';

    default:
      return null;
  }
}
