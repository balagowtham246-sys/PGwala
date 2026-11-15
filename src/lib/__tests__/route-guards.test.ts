import {
  evaluateNavigationRedirect,
  OWNER_ROUTES,
  STUDENT_ROUTES,
  WARDEN_ROUTES,
} from '../navigation-guards';

describe('navigation-guards', () => {
  describe('unauthenticated users', () => {
    it('redirects unauthenticated users to /login if they attempt to access protected routes', () => {
      expect(
        evaluateNavigationRedirect({
          hasSession: false,
          role: null,
          currentSegment: '(tabs)',
        })
      ).toBe('/login');

      expect(
        evaluateNavigationRedirect({
          hasSession: false,
          role: null,
          currentSegment: 'student-dashboard',
        })
      ).toBe('/login');

      expect(
        evaluateNavigationRedirect({
          hasSession: false,
          role: null,
          currentSegment: 'receipt-detail',
        })
      ).toBe('/login');
    });

    it('does not redirect unauthenticated users if they are already on /login', () => {
      expect(
        evaluateNavigationRedirect({
          hasSession: false,
          role: null,
          currentSegment: 'login',
        })
      ).toBeNull();
    });
  });

  describe('owner persona', () => {
    it('redirects an authenticated owner away from /login to /(tabs)', () => {
      expect(
        evaluateNavigationRedirect({
          hasSession: true,
          role: 'owner',
          currentSegment: 'login',
        })
      ).toBe('/(tabs)');
    });

    it('redirects an authenticated owner away from student routes to /(tabs)', () => {
      for (const studentRoute of STUDENT_ROUTES) {
        expect(
          evaluateNavigationRedirect({
            hasSession: true,
            role: 'owner',
            currentSegment: studentRoute,
          })
        ).toBe('/(tabs)');
      }
    });

    it('permits an authenticated owner on owner routes and shared routes', () => {
      for (const ownerRoute of OWNER_ROUTES) {
        expect(
          evaluateNavigationRedirect({
            hasSession: true,
            role: 'owner',
            currentSegment: ownerRoute,
          })
        ).toBeNull();
      }

      // Shared routes like receipt-detail
      expect(
        evaluateNavigationRedirect({
          hasSession: true,
          role: 'owner',
          currentSegment: 'receipt-detail',
        })
      ).toBeNull();
    });
  });

  describe('student persona', () => {
    it('redirects an authenticated student away from /login to /student-dashboard', () => {
      expect(
        evaluateNavigationRedirect({
          hasSession: true,
          role: 'student',
          currentSegment: 'login',
        })
      ).toBe('/student-dashboard');
    });

    it('redirects an authenticated student away from owner routes to /student-dashboard', () => {
      for (const ownerRoute of OWNER_ROUTES) {
        expect(
          evaluateNavigationRedirect({
            hasSession: true,
            role: 'student',
            currentSegment: ownerRoute,
          })
        ).toBe('/student-dashboard');
      }
    });

    it('permits an authenticated student on student routes and shared routes', () => {
      for (const studentRoute of STUDENT_ROUTES) {
        expect(
          evaluateNavigationRedirect({
            hasSession: true,
            role: 'student',
            currentSegment: studentRoute,
          })
        ).toBeNull();
      }

      // Shared routes like receipt-detail
      expect(
        evaluateNavigationRedirect({
          hasSession: true,
          role: 'student',
          currentSegment: 'receipt-detail',
        })
      ).toBeNull();
    });
  });

  describe('warden role', () => {
    it('keeps wardens on warden routes and sends them away from everything else', () => {
      for (const route of WARDEN_ROUTES) {
        expect(
          evaluateNavigationRedirect({ hasSession: true, role: 'warden', currentSegment: route })
        ).toBeNull();
      }
      for (const route of [...OWNER_ROUTES, ...STUDENT_ROUTES.filter((r) => r !== 'student-profile-edit'), 'login']) {
        expect(
          evaluateNavigationRedirect({ hasSession: true, role: 'warden', currentSegment: route })
        ).toBe('/warden-dashboard');
      }
    });

    it('blocks owners and students from the warden dashboard', () => {
      expect(
        evaluateNavigationRedirect({ hasSession: true, role: 'owner', currentSegment: 'warden-dashboard' })
      ).toBe('/(tabs)');
      expect(
        evaluateNavigationRedirect({ hasSession: true, role: 'student', currentSegment: 'warden-dashboard' })
      ).toBe('/student-dashboard');
    });

    it('lets owners reach warden management and residents reach food updates', () => {
      expect(
        evaluateNavigationRedirect({ hasSession: true, role: 'owner', currentSegment: 'owner-wardens' })
      ).toBeNull();
      expect(
        evaluateNavigationRedirect({ hasSession: true, role: 'student', currentSegment: 'student-food-updates' })
      ).toBeNull();
      expect(
        evaluateNavigationRedirect({ hasSession: true, role: 'student', currentSegment: 'owner-wardens' })
      ).toBe('/student-dashboard');
    });
  });
});