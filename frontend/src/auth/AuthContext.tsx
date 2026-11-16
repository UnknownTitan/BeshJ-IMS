import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { get, post, tokenStore } from '../api/client';

export type Role =
  | 'ADMIN'
  | 'WAREHOUSE_MANAGER'
  | 'STORE_KEEPER'
  | 'SALES_REP'
  | 'DRIVER'
  | 'ACCOUNTANT'
  | 'MANAGEMENT';

export interface User {
  userId: number;
  username: string;
  fullName: string;
  role: Role;
}

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrator',
  WAREHOUSE_MANAGER: 'Warehouse Manager',
  STORE_KEEPER: 'Store Keeper',
  SALES_REP: 'Sales Rep',
  DRIVER: 'Driver',
  ACCOUNTANT: 'Accountant',
  MANAGEMENT: 'Management',
};

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  /** True if the user has one of the roles (Admin can do everything). */
  can: (...roles: Role[]) => boolean;
}

const AuthContext = createContext<AuthState>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // On page load, restore the session if a token is saved.
  useEffect(() => {
    if (!tokenStore.get()) return setLoading(false);
    get<User>('/auth/me')
      .then(setUser)
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false));
  }, []);

  const login = async (username: string, password: string) => {
    const res = await post<{ accessToken: string; user: User }>('/auth/login', { username, password });
    tokenStore.set(res.accessToken);
    setUser(res.user);
  };

  const logout = () => {
    tokenStore.clear();
    setUser(null);
  };

  const can = (...roles: Role[]) => !!user && (user.role === 'ADMIN' || roles.includes(user.role));

  return <AuthContext.Provider value={{ user, loading, login, logout, can }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
