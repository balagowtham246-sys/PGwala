import {
  evaluateNavigationRedirect,
  OWNER_ROUTES,
  STUDENT_ROUTES,
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
});

