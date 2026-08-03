'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  loginRequest,
  logoutRequest,
  refreshRequest,
  type BrowserSession,
} from '../lib/session';

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated';

export interface AuthContextValue {
  status: AuthStatus;
  session: BrowserSession | null;
  login(
    email: string,
    password: string,
    sharedWorkstation?: boolean,
  ): Promise<void>;
  logout(): Promise<void>;
  /**
   * Re-mints the session from the refresh cookie.
   *
   * Needed because some server-side changes do not reach an already-issued
   * token: accepting an invitation creates the membership but leaves the
   * caller's current token carrying no organization, so without this the
   * person joins and still appears to belong nowhere. It is also how a
   * permission snapshot (ADR 0020) is brought up to date deliberately rather
   * than by waiting out the access-token lifetime.
   */
  refresh(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Holds the session in React state only — a page reload drops the access
 * token on purpose and recovers it through the BFF's httpOnly refresh
 * cookie (silent refresh on mount).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<BrowserSession | null>(null);

  useEffect(() => {
    let cancelled = false;
    refreshRequest()
      .then((recovered) => {
        if (cancelled) {
          return;
        }
        setSession(recovered);
        setStatus(recovered ? 'authenticated' : 'anonymous');
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('anonymous');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(
    async (email: string, password: string, sharedWorkstation?: boolean) => {
      const next = await loginRequest(email, password, sharedWorkstation);
      setSession(next);
      setStatus('authenticated');
    },
    [],
  );

  const refresh = useCallback(async () => {
    const recovered = await refreshRequest();
    setSession(recovered);
    setStatus(recovered ? 'authenticated' : 'anonymous');
  }, []);

  const logout = useCallback(async () => {
    await logoutRequest();
    setSession(null);
    setStatus('anonymous');
  }, []);

  return (
    <AuthContext.Provider value={{ status, session, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return value;
}
