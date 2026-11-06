import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabasePublishableKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'placeholder-publishable-key';

if (
  !process.env.EXPO_PUBLIC_SUPABASE_URL ||
  !process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
) {
  if (process.env.NODE_ENV !== 'test') {
    console.warn(
      '[Supabase] Warning: EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing. Check your .env file.'
    );
  }
}

// Cross-platform safe storage wrapper for Native and Web (SSR-safe)
const ExpoSafeStorage = {
  getItem: async (key: string): Promise<string | null> => {
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined' || !window.localStorage) return null;
      return window.localStorage.getItem(key);
    }
    return AsyncStorage.getItem(key);
  },
  setItem: async (key: string, value: string): Promise<void> => {
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined' || !window.localStorage) return;
      window.localStorage.setItem(key, value);
      return;
    }
    return AsyncStorage.setItem(key, value);
  },
  removeItem: async (key: string): Promise<void> => {
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined' || !window.localStorage) return;
      window.localStorage.removeItem(key);
      return;
    }
    return AsyncStorage.removeItem(key);
  },
};

const isTestEnv = process.env.NODE_ENV === 'test';

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    storage: ExpoSafeStorage,
    autoRefreshToken: !isTestEnv,
    persistSession: !isTestEnv,
    detectSessionInUrl: Platform.OS === 'web' && !isTestEnv,
  },
});

// Auto-refresh auth tokens only when the app is in the foreground
if (Platform.OS !== 'web' && !isTestEnv) {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}

/**
 * Safe, development-only connectivity test.
 * Calls a lightweight endpoint to verify reachability without requiring existing tables
 * or modifying data.
 */
export async function testSupabaseConnection(): Promise<{
  connected: boolean;
  message: string;
  details?: unknown;
}> {
  try {
    if (!supabaseUrl || !supabasePublishableKey) {
      return {
        connected: false,
        message: 'Missing Supabase environment variables.',
      };
    }

    // Checking authentication session / health via auth API endpoint
    // This connects to the remote Supabase gateway without requiring tables or RLS permissions.
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      return {
        connected: false,
        message: `Supabase reached, but Auth API returned an error: ${error.message}`,
        details: error,
      };
    }

    return {
      connected: true,
      message: 'Successfully reached Supabase backend service.',
      details: data,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      connected: false,
      message: `Failed to connect to Supabase: ${errorMsg}`,
      details: err,
    };
  }
}

/**
 * Lightweight base64 string to Uint8Array converter (SSR-safe, React Native compatible)
 */
export function decodeBase64ToBytes(input: string): Uint8Array {
  const clean = input.replace(/[^A-Za-z0-9+/]/g, '');
  const len = clean.length;
  const bytes = new Uint8Array((len * 3) >> 2);
  const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  let u = 0;
  for (let i = 0; i < len; i += 4) {
    const enc1 = B64_CHARS.indexOf(clean.charAt(i));
    const enc2 = B64_CHARS.indexOf(clean.charAt(i + 1));
    const enc3 = B64_CHARS.indexOf(clean.charAt(i + 2));
    const enc4 = B64_CHARS.indexOf(clean.charAt(i + 3));

    const chr1 = (enc1 << 2) | (enc2 >> 4);
    const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
    const chr3 = ((enc3 & 3) << 6) | enc4;

    bytes[u++] = chr1;
    if (enc3 !== -1 && enc3 !== 64) bytes[u++] = chr2;
    if (enc4 !== -1 && enc4 !== 64) bytes[u++] = chr3;
  }
  return bytes.subarray(0, u);
}

/**
 * Resolves a private storage path or full public/signed URL into a time-limited signed URL.
 */
export async function getSignedStorageUrl(
  bucket: string,
  pathOrUrl: string | null | undefined,
  expiresInSeconds = 3600
): Promise<string | null> {
  if (!pathOrUrl) return null;
  const trimmed = pathOrUrl.trim();
  if (!trimmed) return null;

  // If it's already a signed URL with token, return as-is
  if (trimmed.includes('token=') && trimmed.startsWith('http')) {
    return trimmed;
  }

  // If it's a local file URL or unsupported scheme, don't attempt storage signing
  if (
    trimmed.startsWith('file:') ||
    trimmed.startsWith('ph:') ||
    trimmed.startsWith('content:')
  ) {
    return trimmed;
  }

  let relativePath = trimmed;

  const publicPrefix = `/storage/v1/object/public/${bucket}/`;
  const signPrefix = `/storage/v1/object/sign/${bucket}/`;

  if (trimmed.includes(publicPrefix)) {
    const parts = trimmed.split(publicPrefix);
    relativePath = parts[1] ? decodeURIComponent(parts[1].split('?')[0]) : trimmed;
  } else if (trimmed.includes(signPrefix)) {
    const parts = trimmed.split(signPrefix);
    relativePath = parts[1] ? decodeURIComponent(parts[1].split('?')[0]) : trimmed;
  }

  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(relativePath, expiresInSeconds);

    if (error) {
      console.warn(`[Storage:${bucket}] createSignedUrl error:`, error.message);
      return trimmed;
    }

    return data?.signedUrl || trimmed;
  } catch (err) {
    console.warn(`[Storage:${bucket}] Failed to create signed URL:`, err);
    return trimmed;
  }
}

/**
 * Resolves a payment proof storage path/URL into a secure signed URL.
 */
export async function getSignedPaymentProofUrl(
  pathOrUrl: string | null | undefined,
  expiresInSeconds = 3600
): Promise<string | null> {
  return getSignedStorageUrl('payment-proofs', pathOrUrl, expiresInSeconds);
}

/**
 * Resolves a complaint photo storage path/URL into a secure signed URL.
 */
export async function getSignedComplaintPhotoUrl(
  pathOrUrl: string | null | undefined,
  expiresInSeconds = 3600
): Promise<string | null> {
  return getSignedStorageUrl('complaint-photos', pathOrUrl, expiresInSeconds);
}

