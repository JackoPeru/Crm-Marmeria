import { apiClient } from '../services/api';

export interface ServerScope {
  serverId: string;
  dataEpoch: string;
  fallbackUrl: string;
}

export const readServerScope = (): ServerScope => ({
  serverId: String(localStorage.getItem('crm_server_id') || '').trim(),
  dataEpoch: String(localStorage.getItem('crm_data_epoch') || '').trim(),
  fallbackUrl: apiClient.getBaseURL(),
});

export const stableServerKey = (includeDataEpoch = false): string => {
  const scope = readServerScope();
  const identity = scope.serverId || `url:${scope.fallbackUrl}`;
  return includeDataEpoch && scope.dataEpoch
    ? `${identity}|epoch:${scope.dataEpoch}`
    : identity;
};

export const observeServerScope = (listener: () => void): (() => void) => {
  window.addEventListener('crm-server-identity-changed', listener);
  window.addEventListener('crm-api-url-changed', listener);
  return () => {
    window.removeEventListener('crm-server-identity-changed', listener);
    window.removeEventListener('crm-api-url-changed', listener);
  };
};
