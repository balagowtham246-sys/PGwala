/**
 * Role-Based Route Guard & Navigation Evaluation
 */

export const STUDENT_ROUTES = [
  'student-dashboard',
  'student-billing',
  'student-complaints',
  'student-chat',
  'student-gate-history',
  'student-settings',
  'student-profile-edit',
  'student-accommodation',
] as const;

export const OWNER_ROUTES = [
  '(tabs)',
  'student-in-out',
  'add-resident',
  'edit-resident',
  'food-menu',
  'billing-management',
  'eb-billing',
  'owner-complaints',
  'owner-settings',
  'owner-profile-edit',
  'owner-properties',
  'owner-notifications',
] as const;

export interface NavigationGuardState {
  hasSession: boolean;
  role: 'owner' | 'student' | null | undefined;
  currentSegment: string | undefined;
}

/**
 * Evaluates target route redirect based on authentication state, user role, and active segment.
 * Returns the path to redirect to, or null if caller is permitted on current segment.
 */
export function evaluateNavigationRedirect(state: NavigationGuardState): string | null {
  const { hasSession, role, currentSegment } = state;
  const inAuthGroup = currentSegment === 'login';

  // 1. Unauthenticated / missing profile
  if (!hasSession || !role) {
    return inAuthGroup ? null : '/login';
  }

  // 2. Owner Persona
  if (role === 'owner') {
    if (
      inAuthGroup ||
      (currentSegment && (STUDENT_ROUTES as readonly string[]).includes(currentSegment))
    ) {
      return '/(tabs)';
    }
    return null; // Permitted on owner or shared routes
  }

  // 3. Student Persona
  if (role === 'student') {
    if (
      inAuthGroup ||
      (currentSegment && (OWNER_ROUTES as readonly string[]).includes(currentSegment)) ||
      !currentSegment
    ) {
      return '/student-dashboard';
    }
    return null; // Permitted on student or shared routes (e.g. receipt-detail)
  }

  // 4. Unknown / invalid role
  return inAuthGroup ? null : '/login';
}

