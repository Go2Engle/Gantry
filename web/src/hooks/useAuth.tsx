import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { api, setToken, getToken, AUTH_UNAUTHORIZED_EVENT } from '../lib/api';
import type { User } from '../lib/types';

interface AuthContextValue {
  user: User | null;
  token: string | null;
  login: (username: string, password: string) => Promise<void>;
  loginWithToken: (token: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  token: null,
  login: async () => {},
  loginWithToken: async () => {},
  logout: () => {},
  isAuthenticated: false,
  loading: true,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(getToken());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const existingToken = getToken();
    api
      .getMe()
      .then((me) => {
        setUser(me);
        setTokenState(existingToken);
      })
      .catch(async () => {
        if (existingToken) {
          setToken(null);
          setTokenState(null);
          try {
            const me = await api.getMe();
            setUser(me);
            return;
          } catch {
          }
        }
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => {
      setToken(null);
      setTokenState(null);
      setUser(null);
    };
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const result = await api.login(username, password);
    setToken(result.token);
    setTokenState(result.token);
    if (result.user.permissions && result.user.effectiveRole) {
      setUser(result.user);
      return;
    }
    const me = await api.getMe();
    setUser(me);
  }, []);

  const loginWithToken = useCallback(async (token: string) => {
    setToken(token);
    setTokenState(token);
    try {
      const me = await api.getMe();
      setUser(me);
    } catch {
      setToken(null);
      setTokenState(null);
      setUser(null);
    }
  }, []);

  const logout = useCallback(() => {
    api.logout().catch(() => {});
    setToken(null);
    setTokenState(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        login,
        loginWithToken,
        logout,
        isAuthenticated: !!user,
        loading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
