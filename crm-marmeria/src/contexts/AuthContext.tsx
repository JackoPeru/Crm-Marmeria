import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import toast from 'react-hot-toast';
import { authService, User, LoginCredentials, ProfileUpdate } from '../services/auth';
import { cacheService } from '../services/cache';
import { realtimeService } from '../services/realtime';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (profile: ProfileUpdate) => Promise<User>;
  hasPermission: (permission: string) => boolean;
  hasRole: (role: string) => boolean;
  hasAnyRole: (roles: string[]) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const clearAccountScopedCaches = async () => {
  await Promise.allSettled([
    cacheService.clear('customers'),
    cacheService.clear('materials'),
  ]);
};

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const initialize = async () => {
      try {
        const localUser = authService.getUser();
        const token = authService.getToken();
        if (mounted && token && localUser) setUser(localUser);

        if (token && localUser) {
          const valid = await authService.validateToken();
          if (mounted) {
            const validatedUser = valid ? authService.getUser() : null;
            setUser(validatedUser);
            if (validatedUser) realtimeService.connectFromStorage();
          }
        } else if (mounted) {
          setUser(null);
        }
      } catch (error) {
        console.error('Errore inizializzazione auth:', error);
        if (mounted) setUser(null);
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    const handleExpiredSession = () => {
      authService.clearAuth();
      realtimeService.disconnect();
      setUser(null);
      void clearAccountScopedCaches();
      window.dispatchEvent(new CustomEvent('crm-auth-changed', { detail: null }));
      toast.error('Sessione scaduta. Accedi nuovamente.', { id: 'session-expired' });
    };

    window.addEventListener('crm-auth-expired', handleExpiredSession);
    void initialize();
    return () => {
      mounted = false;
      window.removeEventListener('crm-auth-expired', handleExpiredSession);
    };
  }, []);

  const login = async (credentials: LoginCredentials): Promise<void> => {
    setIsLoading(true);
    try {
      await clearAccountScopedCaches();
      const response = await authService.login(credentials);
      setUser(response.user);
      realtimeService.connectFromStorage();
      window.dispatchEvent(new CustomEvent('crm-auth-changed', { detail: response.user }));
      toast.success(`Benvenuto, ${response.user.firstName}!`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Errore durante il login';
      toast.error(message);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async (): Promise<void> => {
    setIsLoading(true);
    try {
      realtimeService.disconnect();
      await authService.logout();
      await clearAccountScopedCaches();
      setUser(null);
      window.dispatchEvent(new CustomEvent('crm-auth-changed', { detail: null }));
      toast.success('Logout effettuato con successo');
    } finally {
      setIsLoading(false);
    }
  };

  const updateUser = async (profile: ProfileUpdate): Promise<User> => {
    const updated = await authService.updateProfile(profile);
    setUser(updated);
    window.dispatchEvent(new CustomEvent('crm-auth-changed', { detail: updated }));
    toast.success('Profilo aggiornato con successo');
    return updated;
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: Boolean(user),
      isLoading,
      login,
      logout,
      updateUser,
      hasPermission: (permission) => user?.permissions.includes(permission) ?? false,
      hasRole: (role) => user?.role === role,
      hasAnyRole: (roles) => Boolean(user?.role && roles.includes(user.role)),
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
