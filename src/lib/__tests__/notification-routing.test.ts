import { resolveNotificationRoute } from '../notification-routing';

describe('notification-routing', () => {
  it('routes typed notifications to role-appropriate screens', () => {
    expect(resolveNotificationRoute({ type: 'food_alert' }, 'student')).toBe(
      '/student-menu'
    );
    expect(resolveNotificationRoute({ type: 'food_alert' }, 'warden')).toBe(
      '/warden-dashboard'
    );
    expect(resolveNotificationRoute({ type: 'announcement' }, 'student')).toBe(
      '/student-announcements'
    );
    expect(resolveNotificationRoute({ type: 'announcement' }, 'owner')).toBe(
      '/owner-announcements'
    );
    expect(resolveNotificationRoute({ type: 'bill' }, 'student')).toBe(
      '/student-billing'
    );
    expect(resolveNotificationRoute({ type: 'payment_proof' }, 'owner')).toBe(
      '/billing-management'
    );
    expect(resolveNotificationRoute({ type: 'complaint' }, 'student')).toBe(
      '/student-complaints'
    );
    expect(resolveNotificationRoute({ type: 'complaint' }, 'owner')).toBe(
      '/owner-complaints'
    );
    expect(resolveNotificationRoute({ type: 'washing_machine' }, 'student')).toBe(
      '/student-dashboard'
    );
    expect(resolveNotificationRoute({ type: 'return_reminder' }, 'student')).toBe(
      '/student-gate-history'
    );
    expect(resolveNotificationRoute({ type: 'chat' }, 'student')).toBe(
      '/student-chat'
    );
  });

  it('honors safe whitelisted route/url overrides and rejects unsafe external links', () => {
    expect(
      resolveNotificationRoute(
        { route: '/student-billing?highlight=rent' },
        'student'
      )
    ).toBe('/student-billing?highlight=rent');
    expect(
      resolveNotificationRoute(
        { url: 'https://evil.example.com/phish' },
        'student'
      )
    ).toBeNull();
    expect(
      resolveNotificationRoute({ route: '/unknown-admin-panel' }, 'owner')
    ).toBeNull();
  });

  it('returns null gracefully for empty or unknown payloads', () => {
    expect(resolveNotificationRoute(null, 'student')).toBeNull();
    expect(resolveNotificationRoute(undefined, 'owner')).toBeNull();
    expect(resolveNotificationRoute({}, 'student')).toBeNull();
    expect(resolveNotificationRoute({ type: 'unrecognized_type' }, 'student')).toBeNull();
  });
});
