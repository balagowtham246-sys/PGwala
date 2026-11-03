import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

if (!supabaseUrl || !supabasePublishableKey) {
  console.warn(
    '[Supabase] Warning: EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing. Check your .env file.'
  );
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

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    storage: ExpoSafeStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
});

// Auto-refresh auth tokens only when the app is in the foreground
if (Platform.OS !== 'web') {
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
 * Resolves a private or public payment proof storage path/URL into a secure signed URL.
 * Handles:
 * - relative storage paths (e.g. "resident_id/1234_abc.jpg")
 * - full legacy public URLs ("https://.../storage/v1/object/public/payment-proofs/...")
 * - existing signed URLs or null values
 */
export async function getSignedPaymentProofUrl(
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

  // If it's a full Supabase storage URL, extract the relative path inside 'payment-proofs'
  if (trimmed.includes('/storage/v1/object/public/payment-proofs/')) {
    const parts = trimmed.split('/storage/v1/object/public/payment-proofs/');
    relativePath = parts[1]
      ? decodeURIComponent(parts[1].split('?')[0])
      : trimmed;
  } else if (trimmed.includes('/storage/v1/object/sign/payment-proofs/')) {
    const parts = trimmed.split('/storage/v1/object/sign/payment-proofs/');
    relativePath = parts[1]
      ? decodeURIComponent(parts[1].split('?')[0])
      : trimmed;
  }

  try {
    const { data, error } = await supabase.storage
      .from('payment-proofs')
      .createSignedUrl(relativePath, expiresInSeconds);

    if (error) {
      console.warn('[Storage] createSignedUrl error:', error.message);
      return trimmed;
    }

    return data?.signedUrl || trimmed;
  } catch (err) {
    console.warn('[Storage] Failed to create signed URL:', err);
    return trimmed;
  }
}

