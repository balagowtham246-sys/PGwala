import Constants from 'expo-constants';
import PostHog from 'posthog-react-native';

const extra = Constants.expoConfig?.extra as
  | {
      posthogProjectToken?: string;
      posthogHost?: string;
    }
  | undefined;
const projectToken = extra?.posthogProjectToken?.trim();
const host = extra?.posthogHost?.trim();

export const isPostHogConfigured = Boolean(projectToken && host);

if (__DEV__) {
  if (!projectToken) {
    console.error(
      new Error(
        'EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN is configured',
      ),
    );
  }
  if (!host) {
    console.error(
      new Error(
        'EXPO_PUBLIC_POSTHOG_HOST variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once EXPO_PUBLIC_POSTHOG_HOST is configured',
      ),
    );
  }
}

export const posthog =
  projectToken && host
    ? new PostHog(projectToken, {
        host,
        captureAppLifecycleEvents: true,
        errorTracking: {
          autocapture: {
            uncaughtExceptions: true,
            unhandledRejections: true,
            // AppErrorBoundary already logs render errors in development.
            console: [],
          },
        },
        preloadFeatureFlags: true,
        logs: {
          serviceName: 'pgwala-mobile',
          environment: __DEV__ ? 'development' : 'production',
          serviceVersion: Constants.expoConfig?.version,
        },
      })
    : undefined;

// This SDK-native logger is the dedicated PostHog log export channel. Existing
// console output intentionally remains local and is not forwarded.
export const posthogLog = posthog?.logger;
