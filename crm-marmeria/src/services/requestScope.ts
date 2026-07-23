import type { QueueScope } from './offlineQueue';

export interface RequestBinding {
  baseURL: string;
  fingerprint: string;
}

const normalizeBaseUrl = (value: string) => value.trim().replace(/\/$/, '');

export const queueScopesEqual = (
  left: QueueScope | null | undefined,
  right: QueueScope | null | undefined,
): boolean => Boolean(
  left
  && right
  && String(left.userId) === String(right.userId)
  && normalizeBaseUrl(left.apiBaseUrl) === normalizeBaseUrl(right.apiBaseUrl)
  && String(left.serverId || '') === String(right.serverId || '')
  && String(left.dataEpoch || '') === String(right.dataEpoch || ''),
);

export const scopeFingerprint = (scope: QueueScope): string => [
  normalizeBaseUrl(scope.apiBaseUrl),
  String(scope.serverId || ''),
  String(scope.dataEpoch || ''),
  String(scope.userId || ''),
].join('|');

export const bindRequestToScope = (
  replayScope: QueueScope | null | undefined,
  currentScope: QueueScope | null | undefined,
  currentBaseUrl: string,
  currentFingerprint: string,
): RequestBinding => {
  if (!replayScope) {
    return {
      baseURL: normalizeBaseUrl(currentBaseUrl),
      fingerprint: currentFingerprint,
    };
  }
  if (!queueScopesEqual(replayScope, currentScope)) {
    const error = new Error('Il contesto della coda offline è cambiato prima dell’invio');
    (error as Error & { code?: string }).code = 'QUEUE_SCOPE_CHANGED';
    throw error;
  }
  return {
    baseURL: normalizeBaseUrl(replayScope.apiBaseUrl),
    fingerprint: scopeFingerprint(replayScope),
  };
};
