import PostHog from 'posthog-react-native';

export type AnalyticsEventName =
  | 'bill_generated'
  | 'payment_confirmed'
  | 'partial_payment_recorded'
  | 'payment_proof_submitted'
  | 'gate_marked_out'
  | 'home_leave_started'
  | 'gate_marked_in'
  | 'food_menu_published'
  | 'food_alert_sent'
  | 'complaint_created'
  | 'resident_added'
  | 'bed_reserved';

export type AnalyticsPropertyValue = string | number | boolean | null;
export type AnalyticsProperties = Record<string, AnalyticsPropertyValue | undefined>;

export interface AnalyticsClientLike {
  identify: (distinctId: string, properties?: Record<string, AnalyticsPropertyValue>) => void;
  group: (
    groupType: string,
    groupKey: string,
    groupProperties?: Record<string, AnalyticsPropertyValue>
  ) => void;
  screen: (name: string, properties?: Record<string, AnalyticsPropertyValue>) => void;
  capture: (event: string, properties?: Record<string, AnalyticsPropertyValue>) => void;
  reset: () => void;
}

const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';
const UUID_SEGMENT_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_SEGMENT_RE = /^\d+$/;

let clientInstance: AnalyticsClientLike | null = null;
let initialized = false;
let lastIdentifiedKey: string | null = null;

function sanitizeProperties(
  props?: AnalyticsProperties
): Record<string, AnalyticsPropertyValue> | undefined {
  if (!props) return undefined;
  const clean: Record<string, AnalyticsPropertyValue> = {};
  let hasKeys = false;
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined) {
      clean[key] = value;
      hasKeys = true;
    }
  }
  return hasKeys ? clean : undefined;
}

function getAnalyticsClient(): AnalyticsClientLike | null {
  if (clientInstance) return clientInstance;
  if (initialized) return null;
  initialized = true;

  if (process.env.NODE_ENV === 'test') {
    return null;
  }

  const apiKey = (process.env.EXPO_PUBLIC_POSTHOG_API_KEY || '').trim();
  if (!apiKey) {
    return null;
  }

  const host =
    (process.env.EXPO_PUBLIC_POSTHOG_HOST || '').trim() || DEFAULT_POSTHOG_HOST;

  try {
    clientInstance = new PostHog(apiKey, {
      host,
      enableSessionReplay: false,
      captureAppLifecycleEvents: true,
    }) as unknown as AnalyticsClientLike;
  } catch {
    clientInstance = null;
  }

  return clientInstance;
}

/**
 * Strips query parameters and dynamic UUID / numeric path segments so PostHog
 * screen names stay clean and never leak entity IDs.
 */
export function normalizeScreenName(pathname: string | null | undefined): string {
  const raw = (pathname || '').split('?')[0].split('#')[0].trim();
  if (!raw || raw === '/') return '/home';

  const normalized = raw
    .split('/')
    .map((segment) => {
      if (!segment) return '';
      if (UUID_SEGMENT_RE.test(segment) || NUMERIC_SEGMENT_RE.test(segment)) {
        return ':id';
      }
      return segment;
    })
    .join('/');

  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

/**
 * Privacy-first user & property identification.
 * Sends ONLY userId, role, and propertyId group — zero PII (no name, phone, email).
 */
export function identifyAnalyticsUser(params: {
  userId: string;
  role?: string | null;
  propertyId?: string | null;
}): void {
  const client = getAnalyticsClient();
  if (!client || !params.userId) return;

  const role = params.role ?? 'unknown';
  const propertyId = params.propertyId ?? null;
  const dedupeKey = `${params.userId}:${role}:${propertyId ?? 'none'}`;
  if (lastIdentifiedKey === dedupeKey) return;
  lastIdentifiedKey = dedupeKey;

  try {
    client.identify(params.userId, { role });
    if (propertyId) {
      client.group('property', propertyId);
    }
  } catch {
    // Non-fatal
  }
}

export function resetAnalyticsUser(): void {
  lastIdentifiedKey = null;
  const client = getAnalyticsClient();
  if (!client) return;
  try {
    client.reset();
  } catch {
    // Non-fatal
  }
}

export function trackScreen(
  pathname: string | null | undefined,
  properties?: AnalyticsProperties
): void {
  const client = getAnalyticsClient();
  if (!client) return;
  try {
    client.screen(normalizeScreenName(pathname), sanitizeProperties(properties));
  } catch {
    // Non-fatal
  }
}

export function trackEvent(
  event: AnalyticsEventName,
  properties?: AnalyticsProperties
): void {
  const client = getAnalyticsClient();
  if (!client) return;
  try {
    client.capture(event, sanitizeProperties(properties));
  } catch {
    // Non-fatal
  }
}

/**
 * Test-only hook to inject or clear a mock PostHog client.
 */
export function __setAnalyticsClientForTest(
  client: AnalyticsClientLike | null
): void {
  clientInstance = client;
  initialized = client !== null;
  lastIdentifiedKey = null;
}
