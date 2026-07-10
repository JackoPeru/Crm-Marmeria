import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { authService, User, LoginCredentials, ProfileUpdate } from '../services/auth';
import toast from 'react-hot-toast';

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
          if (mounted) setUser(valid ? authService.getUser() : null);
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

    initialize();
    return () => {
      mounted = false;
    };
  }, []);

  const login = async (credentials: LoginCredentials): Promise<void> => {
    setIsLoading(true);
    try {
      const response = await authService.login(credentials);
      setUser(response.user);
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
      await authService.logout();
      setUser(null);
      toast.success('Logout effettuato con successo');
    } finally {
      setIsLoading(false);
    }
  };

  const updateUser = async (profile: ProfileUpdate): Promise<User> => {
    const updated = await authService.updateProfile(profile);
    setUser(updated);
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
      hasPermission: (permission) => authService.hasPermission(permission),
      hasRole: (role) => authService.hasRole(role),
      hasAnyRole: (roles) => authService.hasAnyRole(roles),
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
