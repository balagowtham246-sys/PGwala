import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

if (!supabaseUrl || !supabasePublishableKey) {
  console.warn(
    '[Supabase] Warning: EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing. Check your .env file.'
  );
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Auto-refresh auth tokens only when the app is in the foreground
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});

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

