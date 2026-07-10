import { apiClient } from './api';

export interface User {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  permissions: string[];
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface ProfileUpdate {
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

class AuthService {
  private readonly TOKEN_KEY = 'crm_auth_token';
  private readonly USER_KEY = 'crm_user_data';
  private validationPromise: Promise<boolean> | null = null;

  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    try {
      const response = await apiClient.post('/auth/login', credentials);
      const data: AuthResponse = response.data;
      this.setToken(data.token);
      this.setUser(data.user);
      return data;
    } catch (error: any) {
      const message = error?.response?.data?.error
        || error?.message
        || 'Errore durante il login';
      throw new Error(message);
    }
  }

  async logout(): Promise<void> {
    try {
      if (this.getToken()) await apiClient.post('/auth/logout');
    } catch (error) {
      console.error('Errore logout:', error);
    } finally {
      this.clearAuth();
    }
  }

  async updateProfile(profile: ProfileUpdate): Promise<User> {
    try {
      const response = await apiClient.put('/auth/profile', profile);
      const user: User = response.data.user;
      this.setUser(user);
      return user;
    } catch (error: any) {
      const message = error?.response?.data?.error
        || error?.message
        || 'Errore durante l’aggiornamento del profilo';
      throw new Error(message);
    }
  }

  isAuthenticated(): boolean {
    return Boolean(this.getToken() && this.getUser());
  }

  getToken(): string | null {
    return localStorage.getItem(this.TOKEN_KEY);
  }

  setToken(token: string): void {
    localStorage.setItem(this.TOKEN_KEY, token);
  }

  getUser(): User | null {
    const userData = localStorage.getItem(this.USER_KEY);
    if (!userData) return null;
    try {
      return JSON.parse(userData);
    } catch (error) {
      console.error('Errore parsing userData:', error);
      return null;
    }
  }

  setUser(user: User): void {
    localStorage.setItem(this.USER_KEY, JSON.stringify(user));
  }

  clearAuth(): void {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
    this.validationPromise = null;
  }

  hasPermission(permission: string): boolean {
    return this.getUser()?.permissions.includes(permission) ?? false;
  }

  hasRole(role: string): boolean {
    return this.getUser()?.role === role;
  }

  hasAnyRole(roles: string[]): boolean {
    const role = this.getUser()?.role;
    return Boolean(role && roles.includes(role));
  }

  getAuthHeaders(): Record<string, string> {
    const token = this.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async validateToken(): Promise<boolean> {
    if (this.validationPromise) return this.validationPromise;
    this.validationPromise = this.performTokenValidation();
    try {
      return await this.validationPromise;
    } finally {
      window.setTimeout(() => {
        this.validationPromise = null;
      }, 1000);
    }
  }

  private async performTokenValidation(): Promise<boolean> {
    if (!this.getToken()) return false;
    try {
      const response = await apiClient.get('/auth/me');
      if (!response.data?.user) return false;
      this.setUser(response.data.user);
      return true;
    } catch (error: any) {
      if (error?.response?.status === 401 || error?.response?.status === 403) {
        this.clearAuth();
        return false;
      }
      if (
        error?.code === 'ERR_NETWORK'
        || error?.code === 'ECONNABORTED'
        || !error?.response
      ) {
        return Boolean(this.getUser());
      }
      return false;
    }
  }
}

export const authService = new AuthService();
export default authService;
