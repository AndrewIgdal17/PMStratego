import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import {
  AUTH_TOKEN_STORAGE_KEY,
  callFunction,
  setAuthTokenGetter,
} from '../lib/supabaseClient.ts';

const USERNAME_STORAGE_KEY = 'stratego:username';

export interface AuthState {
  token: string | null;
  username: string | null;
}

interface AuthContextValue {
  auth: AuthState;
  isLoggedIn: boolean;
  login: (username: string, password: string) => Promise<void>;
  signup: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readAuthState(): AuthState {
  try {
    return {
      token: localStorage.getItem(AUTH_TOKEN_STORAGE_KEY),
      username: localStorage.getItem(USERNAME_STORAGE_KEY),
    };
  } catch {
    return { token: null, username: null };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>(readAuthState);
  const tokenRef = useRef<string | null>(auth.token);
  tokenRef.current = auth.token;
  setAuthTokenGetter(() => tokenRef.current);

  function persist(token: string, username: string): void {
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
    localStorage.setItem(USERNAME_STORAGE_KEY, username);
    tokenRef.current = token;
    setAuth({ token, username });
  }

  async function login(username: string, password: string): Promise<void> {
    const data = await callFunction('login', { username, password });
    persist(data.token, data.username);
  }

  async function signup(username: string, password: string): Promise<void> {
    const data = await callFunction('signup', { username, password });
    persist(data.token, data.username);
  }

  function logout(): void {
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    localStorage.removeItem(USERNAME_STORAGE_KEY);
    tokenRef.current = null;
    setAuth({ token: null, username: null });
  }

  const value: AuthContextValue = {
    auth,
    isLoggedIn: !!auth.token,
    login,
    signup,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
}
