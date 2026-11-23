import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { clearUserSessionState } from '@/lib/session-cleanup';
import { isLikelyNetworkError } from '@/lib/service-result';
import { unregisterPushToken } from '@/lib/push-notifications';

export interface UserProfile {
  id: string;
  full_name: string;
  phone_number: string | null;
  role: 'owner' | 'student' | 'warden';
  must_change_password?: boolean;
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  isLoading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const lastUserIdRef = useRef<string | null>(null);

  // Fetch the role and profile from public.profiles for the authenticated user
  const fetchProfile = useCallback(async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, phone_number, role, must_change_password')
        .eq('id', userId)
        .single();

      if (error) {
        console.warn('[AuthContext] Error fetching profile:', error.message);
        if (!isLikelyNetworkError(error)) {
          setProfile(null);
        }
        return null;
      }

      setProfile(data as UserProfile);
      return data as UserProfile;
    } catch (err) {
      console.error('[AuthContext] Unexpected error fetching profile:', err);
      if (!isLikelyNetworkError(err)) {
        setProfile(null);
      }
      return null;
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    const currentUid = lastUserIdRef.current;
    if (currentUid) {
      await fetchProfile(currentUid);
      try {
        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (!userError && userData?.user) {
          setUser(userData.user);
        }
      } catch (e) {
        console.warn('[AuthContext] Failed to refresh auth user metadata:', e);
      }
    }
  }, [fetchProfile]);

  useEffect(() => {
    // 1. Initial session load
    supabase.auth
      .getSession()
      .then(async ({ data: { session: initialSession }, error }) => {
        if (error) {
          console.warn('[AuthContext] Error retrieving session:', error.message);
        }
        setSession(initialSession);
        setUser(initialSession?.user ?? null);
        lastUserIdRef.current = initialSession?.user?.id ?? null;
        if (initialSession?.user) {
          await fetchProfile(initialSession.user.id);
        }
      })
      .finally(() => {
        setIsLoading(false);
      });

    // 2. Listen for auth state changes (login, logout, token refresh)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (newSession?.user) {
        const prevUid = lastUserIdRef.current;
        const nextUid = newSession.user.id;
        const userChanged = prevUid !== nextUid;
        lastUserIdRef.current = nextUid;
        if (prevUid && prevUid !== nextUid) {
          await clearUserSessionState();
        }
        // Only show loading spinner when switching/signing in a different user;
        // silent TOKEN_REFRESHED events must not unmount the navigation Stack.
        if (userChanged) {
          setIsLoading(true);
        }
        setSession(newSession);
        setUser(newSession.user);
        if (userChanged || event === 'USER_UPDATED') {
          await fetchProfile(newSession.user.id);
        }
        if (userChanged) {
          setIsLoading(false);
        }
      } else if (event === 'SIGNED_OUT') {
        lastUserIdRef.current = null;
        setSession(null);
        setUser(null);
        setProfile(null);
        await clearUserSessionState();
        setIsLoading(false);
      } else {
        setIsLoading(false);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const signOut = useCallback(async () => {
    try {
      await unregisterPushToken();
      await supabase.auth.signOut();
    } catch (err) {
      console.error('[AuthContext] Error during signOut:', err);
    } finally {
      lastUserIdRef.current = null;
      await clearUserSessionState();
      setSession(null);
      setUser(null);
      setProfile(null);
    }
  }, []);

  const contextValue = useMemo<AuthContextType>(
    () => ({
      session,
      user,
      profile,
      isLoading,
      signOut,
      refreshProfile,
    }),
    [session, user, profile, isLoading, signOut, refreshProfile]
  );

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

