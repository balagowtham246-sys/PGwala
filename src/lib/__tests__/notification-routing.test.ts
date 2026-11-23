import { resolveNotificationRoute } from '../notification-routing';

describe('notification-routing', () => {
  it('routes typed notifications to role-appropriate screens', () => {
    expect(resolveNotificationRoute({ type: 'food_alert' }, 'student')).toBe(
      '/resident-menu'
    );
    expect(resolveNotificationRoute({ type: 'food_alert' }, 'warden')).toBe(
      '/warden-dashboard'
    );
    expect(resolveNotificationRoute({ type: 'announcement' }, 'student')).toBe(
      '/resident-announcements'
    );
    expect(resolveNotificationRoute({ type: 'announcement' }, 'owner')).toBe(
      '/owner-announcements'
    );
    expect(resolveNotificationRoute({ type: 'bill' }, 'student')).toBe(
      '/resident-billing'
    );
    expect(resolveNotificationRoute({ type: 'payment_proof' }, 'owner')).toBe(
      '/billing-management'
    );
    expect(resolveNotificationRoute({ type: 'complaint' }, 'student')).toBe(
      '/resident-complaints'
    );
    expect(resolveNotificationRoute({ type: 'complaint' }, 'owner')).toBe(
      '/owner-complaints'
    );
    expect(resolveNotificationRoute({ type: 'washing_machine' }, 'student')).toBe(
      '/resident-dashboard'
    );
    expect(resolveNotificationRoute({ type: 'return_reminder' }, 'student')).toBe(
      '/resident-gate-history'
    );
    expect(resolveNotificationRoute({ type: 'chat' }, 'student')).toBe(
      '/resident-chat'
    );
  });

  it('honors safe whitelisted route/url overrides and rejects unsafe external links', () => {
    expect(
      resolveNotificationRoute(
        { route: '/resident-billing?highlight=rent' },
        'student'
      )
    ).toBe('/resident-billing?highlight=rent');
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
