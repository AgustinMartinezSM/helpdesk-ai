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

  const logout = useCallback(async () => {
    await logoutRequest();
    setSession(null);
    setStatus('anonymous');
  }, []);

  return (
    <AuthContext.Provider value={{ status, session, login, logout }}>
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
