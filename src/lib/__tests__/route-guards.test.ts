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
    it('redirects an authenticated owner away from /login to /owner-tabs', () => {
      expect(
        evaluateNavigationRedirect({
          hasSession: true,
          role: 'owner',
          currentSegment: 'login',
        })
      ).toBe('/owner-tabs');
    });

    it('redirects an authenticated owner away from student routes to /owner-tabs', () => {
      for (const studentRoute of STUDENT_ROUTES) {
        expect(
          evaluateNavigationRedirect({
            hasSession: true,
            role: 'owner',
            currentSegment: studentRoute,
          })
        ).toBe('/owner-tabs');
      }
    });

    it('permits an authenticated owner on owner routes (except raw /(tabs) which redirects to /owner-tabs) and shared routes', () => {
      for (const ownerRoute of OWNER_ROUTES) {
        expect(
          evaluateNavigationRedirect({
            hasSession: true,
            role: 'owner',
            currentSegment: ownerRoute,
          })
        ).toBe(ownerRoute === '(tabs)' ? '/owner-tabs' : null);
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
    it('redirects an authenticated student away from /login to /resident-tabs', () => {
      expect(
        evaluateNavigationRedirect({
          hasSession: true,
          role: 'student',
          currentSegment: 'login',
        })
      ).toBe('/resident-tabs');
    });

    it('redirects an authenticated student away from owner routes to /resident-tabs', () => {
      for (const ownerRoute of OWNER_ROUTES) {
        expect(
          evaluateNavigationRedirect({
            hasSession: true,
            role: 'student',
            currentSegment: ownerRoute,
          })
        ).toBe('/resident-tabs');
      }
    });

    it('permits an authenticated student on student routes (except raw student-dashboard which redirects to /resident-tabs) and shared routes', () => {
      for (const studentRoute of STUDENT_ROUTES) {
        expect(
          evaluateNavigationRedirect({
            hasSession: true,
            role: 'student',
            currentSegment: studentRoute,
          })
        ).toBe(studentRoute === 'student-dashboard' ? '/resident-tabs' : null);
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

    it('blocks owners and students from the warden dashboard and warden settings', () => {
      expect(
        evaluateNavigationRedirect({ hasSession: true, role: 'owner', currentSegment: 'warden-dashboard' })
      ).toBe('/owner-tabs');
      expect(
        evaluateNavigationRedirect({ hasSession: true, role: 'owner', currentSegment: 'warden-settings' })
      ).toBe('/owner-tabs');
      expect(
        evaluateNavigationRedirect({ hasSession: true, role: 'student', currentSegment: 'warden-dashboard' })
      ).toBe('/resident-tabs');
    });

    it('lets owners reach warden management and residents reach food updates', () => {
      expect(
        evaluateNavigationRedirect({ hasSession: true, role: 'owner', currentSegment: 'owner-wardens' })
      ).toBeNull();
      expect(
        evaluateNavigationRedirect({ hasSession: true, role: 'student', currentSegment: 'student-food-updates' })
      ).toBeNull();
      expect(
        evaluateNavigationRedirect({ hasSession: true, role: 'owner', currentSegment: 'residents-directory' })
      ).toBeNull();
      expect(
        evaluateNavigationRedirect({ hasSession: true, role: 'owner', currentSegment: 'resident-profile' })
      ).toBeNull();
      expect(
        evaluateNavigationRedirect({ hasSession: true, role: 'student', currentSegment: 'residents-directory' })
      ).toBe('/resident-tabs');
      expect(
        evaluateNavigationRedirect({ hasSession: true, role: 'warden', currentSegment: 'resident-profile' })
      ).toBe('/warden-dashboard');
      expect(
        evaluateNavigationRedirect({ hasSession: true, role: 'student', currentSegment: 'owner-wardens' })
      ).toBe('/resident-tabs');
    });
  });
});