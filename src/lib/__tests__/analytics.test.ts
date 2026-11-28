import {
  __setAnalyticsClientForTest,
  AnalyticsClientLike,
  identifyAnalyticsUser,
  normalizeScreenName,
  resetAnalyticsUser,
  trackEvent,
  trackScreen,
} from '@/lib/analytics';

jest.mock('posthog-react-native', () => ({
  __esModule: true,
  default: jest.fn(),
}));

describe('analytics (PostHog privacy-first wrapper)', () => {
  afterEach(() => {
    __setAnalyticsClientForTest(null);
    jest.restoreAllMocks();
  });

  test('normalizeScreenName strips query params, hashes, UUIDs, and numeric IDs', () => {
    expect(normalizeScreenName('/')).toBe('/home');
    expect(normalizeScreenName('/billing-management?residentId=123')).toBe(
      '/billing-management'
    );
    expect(
      normalizeScreenName(
        '/resident-profile/9d8bd4b6-1945-4ea0-a565-7da45c450986#top'
      )
    ).toBe('/resident-profile/:id');
    expect(normalizeScreenName('/receipts/42')).toBe('/receipts/:id');
  });

  test('safely no-ops when PostHog client is not configured', () => {
    __setAnalyticsClientForTest(null);
    expect(() => {
      identifyAnalyticsUser({ userId: 'u-1', role: 'owner', propertyId: 'p-1' });
      trackScreen('/billing-management');
      trackEvent('payment_confirmed', { method: 'upi' });
      resetAnalyticsUser();
    }).not.toThrow();
  });

  test('identifyAnalyticsUser sends userId, role, display name, and property group name and deduplicates', () => {
    const mockClient: AnalyticsClientLike = {
      identify: jest.fn(),
      group: jest.fn(),
      screen: jest.fn(),
      capture: jest.fn(),
      reset: jest.fn(),
    };
    __setAnalyticsClientForTest(mockClient);

    identifyAnalyticsUser({
      userId: 'user-123',
      role: 'owner',
      name: 'Rajesh Kumar',
      propertyId: 'prop-456',
      propertyName: "Sri Lakshmi Men's PG",
    });
    // Duplicate call with identical key is skipped
    identifyAnalyticsUser({
      userId: 'user-123',
      role: 'owner',
      name: 'Rajesh Kumar',
      propertyId: 'prop-456',
      propertyName: "Sri Lakshmi Men's PG",
    });

    expect(mockClient.identify).toHaveBeenCalledTimes(1);
    expect(mockClient.identify).toHaveBeenCalledWith('user-123', {
      role: 'owner',
      name: 'Rajesh Kumar',
    });
    expect(mockClient.group).toHaveBeenCalledTimes(1);
    expect(mockClient.group).toHaveBeenCalledWith('property', 'prop-456', {
      name: "Sri Lakshmi Men's PG",
    });

    resetAnalyticsUser();
    expect(mockClient.reset).toHaveBeenCalledTimes(1);
  });

  test('trackScreen and trackEvent forward normalized screen names and sanitized properties', () => {
    const mockClient: AnalyticsClientLike = {
      identify: jest.fn(),
      group: jest.fn(),
      screen: jest.fn(),
      capture: jest.fn(),
      reset: jest.fn(),
    };
    __setAnalyticsClientForTest(mockClient);

    trackScreen('/resident-profile/9d8bd4b6-1945-4ea0-a565-7da45c450986', {
      role: 'owner',
      ignored: undefined,
    });
    expect(mockClient.screen).toHaveBeenCalledWith('/resident-profile/:id', {
      role: 'owner',
    });

    trackEvent('home_leave_started', { purpose: 'Semester Break' });
    expect(mockClient.capture).toHaveBeenCalledWith('home_leave_started', {
      purpose: 'Semester Break',
    });
  });
});
