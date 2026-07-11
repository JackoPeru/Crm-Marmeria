import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import toast from 'react-hot-toast';
import { getCurrentQueueScope, offlineQueue } from './offlineQueue';

interface ReplayConfig extends AxiosRequestConfig {
  _replay?: boolean;
}

const MUTATING = new Set(['post', 'put', 'patch', 'delete']);
const ENTITY_CREATE = /^\/(clients|orders|projects|materials|quotes|invoices)\/?$/;
const QUEUEABLE_MUTATION = /^\/(clients|orders|projects|materials|quotes|invoices)(\/[^/?]+(\/status)?)?\/?$/;
const AUTH_ACTION = /^\/auth\/(login|logout)\/?$/;
const SERVER_ID_KEY = 'crm_server_id';
const SERVER_URL_KEY = 'crm_server_identity_url';
const DATA_EPOCH_KEY = 'crm_data_epoch';
const operationId = () => crypto.randomUUID();
const normalizeBaseUrl = (value: string) => value.trim().replace(/\/$/, '');

class ApiClient {
  private axiosInstance: AxiosInstance;
  private replaying = false;

  constructor() {
    this.axiosInstance = axios.create({
      baseURL: this.getBaseURL(),
      timeout: 12000,
      headers: { 'Content-Type': 'application/json' },
    });
    this.setupInterceptors();
  }

  getBaseURL(): string {
    return normalizeBaseUrl(
      localStorage.getItem('crm_api_base_url')
        || import.meta.env.VITE_API_BASE_URL
        || 'http://127.0.0.1:3001/api',
    );
  }

  getServerId(): string | null {
    return localStorage.getItem(SERVER_ID_KEY);
  }

  getDataEpoch(): string | null {
    return localStorage.getItem(DATA_EPOCH_KEY);
  }

  setBaseURL(url: string): void {
    const normalized = normalizeBaseUrl(String(url));
    if (!/^https?:\/\//i.test(normalized)) {
      throw new Error('L’indirizzo del server deve iniziare con http:// o https://');
    }
    localStorage.setItem('crm_api_base_url', normalized);
    this.axiosInstance.defaults.baseURL = normalized;
    window.dispatchEvent(new CustomEvent('crm-api-url-changed', { detail: normalized }));
  }

  private setupInterceptors(): void {
    this.axiosInstance.interceptors.request.use((config: any) => {
      config.baseURL = this.getBaseURL();
      config.headers = config.headers || {};
      const token = localStorage.getItem('crm_auth_token');
      if (token) config.headers.Authorization = `Bearer ${token}`;

      const method = String(config.method || 'get').toLowerCase();
      if (MUTATING.has(method)) {
        config.headers['X-Operation-Id'] = config.headers['X-Operation-Id'] || operationId();
        const version = config.data?.expectedVersion ?? config.data?.version;
        if (
          version != null
          && version !== ''
          && config.headers['If-Match'] == null
        ) {
          config.headers['If-Match'] = String(version);
        }
        if (
          method === 'post'
          && ENTITY_CREATE.test(String(config.url || ''))
          && config.data
          && !(config.data instanceof FormData)
        ) {
          config.data = { ...config.data, id: config.data.id || crypto.randomUUID() };
        }
      }
      return config;
    });

    this.axiosInstance.interceptors.response.use(
      (response) => response,
      async (error) => {
        const config = (error.config || {}) as ReplayConfig & { headers?: Record<string, string> };
        const method = String(config.method || 'get').toLowerCase();
        const url = String(config.url || '');
        const status = error.response?.status;
        const hadAuthenticatedSession = Boolean(localStorage.getItem('crm_auth_token'));

        if (status === 401 && hadAuthenticatedSession && !AUTH_ACTION.test(url)) {
          localStorage.removeItem('crm_auth_token');
          localStorage.removeItem('crm_user_data');
          window.dispatchEvent(new CustomEvent('crm-auth-expired'));
        }
        if (status === 409) {
          window.dispatchEvent(new CustomEvent('crm-version-conflict', {
            detail: {
              url,
              current: error.response?.data?.current,
              message: error.response?.data?.error,
            },
          }));
        }

        const isNetworkFailure = error.code === 'ERR_NETWORK'
          || error.code === 'ECONNABORTED'
          || !error.response;
        const canQueue = isNetworkFailure
          && MUTATING.has(method)
          && QUEUEABLE_MUTATION.test(url)
          && !config._replay
          && !(config.data instanceof FormData);

        if (canQueue) {
          let data = config.data;
          if (typeof data === 'string') {
            try {
              data = JSON.parse(data);
            } catch {
              // Mantiene il contenuto originale se non è JSON.
            }
          }

          const scope = getCurrentQueueScope();
          if (scope) {
            const id = String(config.headers?.['X-Operation-Id'] || operationId());
            await offlineQueue.add({
              id,
              method: method as 'post' | 'put' | 'patch' | 'delete',
              url,
              data,
              headers: {
                'X-Operation-Id': id,
                ...(config.headers?.['If-Match']
                  ? { 'If-Match': String(config.headers['If-Match']) }
                  : {}),
              },
            }, scope);
            toast('Modifica salvata in coda: verrà inviata quando il server torna disponibile.', {
              id: 'offline-queued',
            });
            const optimistic = {
              ...(typeof data === 'object' && data ? data : {}),
              id: (data as any)?.id || url.split('/').filter(Boolean).pop(),
              _queued: true,
            };
            return {
              data: optimistic,
              status: 202,
              statusText: 'Queued Offline',
              headers: {},
              config,
            } as AxiosResponse;
          }
        }

        if (isNetworkFailure) {
          const previous = Number(localStorage.getItem('lastNetworkErrorToast') || 0);
          if (Date.now() - previous > 30000) {
            toast.error('Server centrale non raggiungibile. I dati disponibili restano consultabili.', {
              id: 'network-error',
            });
            localStorage.setItem('lastNetworkErrorToast', String(Date.now()));
          }
        }
        return Promise.reject(error);
      },
    );
  }

  async checkHealth(): Promise<boolean> {
    try {
      const currentUrl = this.getBaseURL();
      const response = await this.axiosInstance.get('/health', { timeout: 5000 });
      const serverId = String(response.data?.serverId || '').trim();
      const dataEpoch = String(response.data?.dataEpoch || '').trim();
      if (!serverId || !dataEpoch || response.data?.mode !== 'central-server') return false;

      const previousId = localStorage.getItem(SERVER_ID_KEY);
      const previousEpoch = localStorage.getItem(DATA_EPOCH_KEY);
      const identityChanged = Boolean(previousId && previousId !== serverId);
      const generationChanged = Boolean(
        previousId === serverId
        && previousEpoch
        && previousEpoch !== dataEpoch,
      );

      localStorage.setItem(SERVER_ID_KEY, serverId);
      localStorage.setItem(SERVER_URL_KEY, currentUrl);
      localStorage.setItem(DATA_EPOCH_KEY, dataEpoch);
      window.dispatchEvent(new CustomEvent('crm-server-identity-changed', {
        detail: {
          serverId,
          dataEpoch,
          apiUrl: currentUrl,
          previousId,
          previousEpoch,
        },
      }));

      if (generationChanged) {
        const removed = await offlineQueue.removeStaleGenerations(serverId, dataEpoch);
        if (removed) {
          toast.error(`${removed} modifiche offline precedenti al ripristino sono state eliminate per evitare di riapplicarle.`, {
            id: 'stale-offline-operations',
            duration: 8000,
          });
        }
      }

      if (identityChanged || generationChanged) {
        window.dispatchEvent(new CustomEvent('crm-auth-reset-for-server-change'));
        window.dispatchEvent(new CustomEvent('crm-data-refresh-requested'));
        return true;
      }

      await offlineQueue.updateServerAddress(serverId, currentUrl);
      await this.replayOfflineQueue();
      return true;
    } catch {
      return false;
    }
  }

  async replayOfflineQueue(): Promise<void> {
    if (this.replaying) return;
    const scope = getCurrentQueueScope();
    if (!scope?.serverId || !scope.dataEpoch) return;

    this.replaying = true;
    try {
      for (const request of await offlineQueue.list(scope)) {
        if (request.blocked) continue;
        try {
          const stableServerMatch = request.serverId === scope.serverId
            && request.dataEpoch === scope.dataEpoch;
          if (!stableServerMatch) continue;
          await this.axiosInstance.request({
            method: request.method,
            url: request.url,
            data: request.data,
            headers: request.headers,
            baseURL: scope.apiBaseUrl,
            _replay: true,
          } as ReplayConfig);
          await offlineQueue.remove(request.id);
        } catch (error: any) {
          const responseStatus = error.response?.status;
          if ([400, 403, 404, 409, 428].includes(responseStatus)) {
            const currentVersion = Number(error.response?.data?.current?.version);
            await offlineQueue.markFailure(
              request.id,
              error.response?.data?.error || error.message,
              true,
              Number.isFinite(currentVersion) ? currentVersion : undefined,
            );
            window.dispatchEvent(new CustomEvent('crm-offline-operation-failed', {
              detail: { request, error: error.response?.data },
            }));
            continue;
          }
          await offlineQueue.markFailure(
            request.id,
            error.message || 'Server non raggiungibile',
            false,
          );
          break;
        }
      }
      window.dispatchEvent(new CustomEvent('crm-data-refresh-requested'));
    } finally {
      this.replaying = false;
    }
  }

  resolveUrl(relativePath: string): string {
    const base = this.getBaseURL().replace(/\/api\/?$/, '');
    return `${base}${relativePath.startsWith('/') ? relativePath : `/${relativePath}`}`;
  }

  getInstance(): AxiosInstance { return this.axiosInstance; }
  get(url: string, config?: AxiosRequestConfig) { return this.axiosInstance.get(url, config); }
  post(url: string, data?: unknown, config?: AxiosRequestConfig) { return this.axiosInstance.post(url, data, config); }
  put(url: string, data?: unknown, config?: AxiosRequestConfig) { return this.axiosInstance.put(url, data, config); }
  patch(url: string, data?: unknown, config?: AxiosRequestConfig) { return this.axiosInstance.patch(url, data, config); }
  delete(url: string, config?: AxiosRequestConfig) { return this.axiosInstance.delete(url, config); }
}

export const apiClient = new ApiClient();
export default apiClient.getInstance();
