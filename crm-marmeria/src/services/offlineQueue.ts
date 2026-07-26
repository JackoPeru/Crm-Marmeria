import { openDB, DBSchema, IDBPDatabase } from 'idb';

export interface QueueScope {
  userId: string;
  apiBaseUrl: string;
  serverId?: string;
  dataEpoch?: string;
}

export interface QueuedRequest {
  id: string;
  method: 'post' | 'put' | 'patch' | 'delete';
  url: string;
  resourceKey?: string;
  data?: unknown;
  headers?: Record<string, string>;
  createdAt: string;
  attempts: number;
  lastError?: string;
  blocked?: boolean;
  conflictVersion?: number;
  ownerUserId: string;
  apiBaseUrl: string;
  serverId?: string;
  dataEpoch?: string;
}

interface QueueDatabase extends DBSchema {
  requests: {
    key: string;
    value: QueuedRequest;
    indexes: { 'by-created': string };
  };
}

const normalizeBaseUrl = (value: string) => {
  const trimmed = value.trim().replace(/\/$/, '');
  try {
    const parsed = new URL(trimmed);
    parsed.hash = '';
    parsed.search = '';
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.pathname = parsed.pathname.replace(/\/$/, '');
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return trimmed;
  }
};

const isObject = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const currentUserId = (): string => {
  try {
    const user = JSON.parse(localStorage.getItem('crm_user_data') || 'null');
    return user?.id == null ? '' : String(user.id);
  } catch {
    return '';
  }
};

const cleanRelativeUrl = (value: string) => String(value || '').split(/[?#]/, 1)[0].replace(/\/$/, '');

export const queueResourceKey = (
  method: string,
  url: string,
  data?: unknown,
): string => {
  const clean = cleanRelativeUrl(url);
  const createMatch = clean.match(/^\/(clients|orders|projects|materials|quotes|invoices)$/);
  if (String(method).toLowerCase() === 'post' && createMatch && isObject(data) && data.id) {
    return `${clean}/${String(data.id)}`;
  }
  return clean.replace(/^(\/orders\/[^/]+)\/status$/, '$1');
};

export const getCurrentQueueScope = (): QueueScope | null => {
  const userId = currentUserId();
  const apiBaseUrl = normalizeBaseUrl(
    localStorage.getItem('crm_api_base_url')
      || import.meta.env.VITE_API_BASE_URL
      || (['http:', 'https:'].includes(window.location.protocol) && window.location.port === '3001'
        ? `${window.location.origin}/api`
        : 'http://127.0.0.1:3001/api'),
  );
  const serverId = String(localStorage.getItem('crm_server_id') || '').trim() || undefined;
  const dataEpoch = String(localStorage.getItem('crm_data_epoch') || '').trim() || undefined;
  return userId && apiBaseUrl ? {
    userId,
    apiBaseUrl,
    serverId,
    dataEpoch,
  } : null;
};

class OfflineQueue {
  private database: Promise<IDBPDatabase<QueueDatabase>> | null = null;

  private getDatabase() {
    if (!this.database) {
      this.database = openDB<QueueDatabase>('crm-marmeria-offline', 1, {
        upgrade(db) {
          if (!db.objectStoreNames.contains('requests')) {
            const store = db.createObjectStore('requests', { keyPath: 'id' });
            store.createIndex('by-created', 'createdAt');
          }
        },
      });
    }
    return this.database;
  }

  private notify() {
    window.dispatchEvent(new CustomEvent('crm-offline-queue-changed'));
  }

  private matchesScope(request: QueuedRequest, scope: QueueScope): boolean {
    if (request.ownerUserId !== String(scope.userId)) return false;
    if (scope.serverId) {
      if (request.serverId !== scope.serverId) return false;
    } else if (request.serverId) {
      return false;
    } else if (normalizeBaseUrl(request.apiBaseUrl || '') !== normalizeBaseUrl(scope.apiBaseUrl)) {
      return false;
    }

    if (scope.dataEpoch) return request.dataEpoch === scope.dataEpoch;
    return !request.dataEpoch;
  }

  async add(
    request: Omit<
      QueuedRequest,
      'createdAt' | 'attempts' | 'blocked' | 'ownerUserId' | 'apiBaseUrl' | 'serverId' | 'dataEpoch' | 'resourceKey'
    >,
    scope: QueueScope | null = getCurrentQueueScope(),
  ): Promise<QueuedRequest> {
    if (!scope) throw new Error('Impossibile accodare la modifica senza un utente autenticato');
    if (!scope.serverId || !scope.dataEpoch) {
      throw new Error('Il server deve essere identificato prima di accodare modifiche offline');
    }

    const db = await this.getDatabase();
    const resourceKey = queueResourceKey(request.method, request.url, request.data);
    const current = await this.list(scope);
    const sameResource = current.filter((item) => (
      (item.resourceKey || queueResourceKey(item.method, item.url, item.data)) === resourceKey
      && !item.blocked
    ));
    const queuedCreate = sameResource.find((item) => item.method === 'post');
    const previousUpdate = [...sameResource].reverse().find(
      (item) => ['put', 'patch'].includes(item.method),
    );

    if (request.method === 'delete' && queuedCreate) {
      const transaction = db.transaction('requests', 'readwrite');
      await Promise.all(sameResource.map((item) => transaction.store.delete(item.id)));
      await transaction.done;
      this.notify();
      return {
        ...queuedCreate,
        method: 'delete',
        url: resourceKey,
        resourceKey,
        blocked: false,
      };
    }

    if (['put', 'patch'].includes(request.method) && queuedCreate) {
      const mergedCreate: QueuedRequest = {
        ...queuedCreate,
        data: isObject(queuedCreate.data) && isObject(request.data)
          ? { ...queuedCreate.data, ...request.data }
          : request.data,
        attempts: 0,
        blocked: false,
        lastError: undefined,
        conflictVersion: undefined,
      };
      await db.put('requests', mergedCreate);
      for (const item of sameResource) {
        if (item.id !== queuedCreate.id) await db.delete('requests', item.id);
      }
      this.notify();
      return mergedCreate;
    }

    const canonicalUrl = /\/orders\/[^/]+\/status$/.test(cleanRelativeUrl(request.url))
      ? resourceKey
      : cleanRelativeUrl(request.url);
    const canonicalMethod = canonicalUrl !== cleanRelativeUrl(request.url)
      ? 'patch'
      : request.method;

    if (['put', 'patch'].includes(canonicalMethod) && previousUpdate) {
      const merged: QueuedRequest = {
        ...previousUpdate,
        method: 'patch',
        url: resourceKey,
        resourceKey,
        data: isObject(previousUpdate.data) && isObject(request.data)
          ? { ...previousUpdate.data, ...request.data }
          : request.data,
        headers: {
          ...(request.headers || {}),
          ...(previousUpdate.headers?.['If-Match']
            ? { 'If-Match': previousUpdate.headers['If-Match'] }
            : {}),
          'X-Operation-Id': previousUpdate.id,
        },
        attempts: 0,
        blocked: false,
        lastError: undefined,
        conflictVersion: undefined,
      };
      await db.put('requests', merged);
      this.notify();
      return merged;
    }

    if (request.method === 'delete') {
      for (const item of sameResource.filter((entry) => ['put', 'patch'].includes(entry.method))) {
        await db.delete('requests', item.id);
      }
    }

    const value: QueuedRequest = {
      ...request,
      method: canonicalMethod,
      url: canonicalUrl,
      resourceKey,
      ownerUserId: String(scope.userId),
      apiBaseUrl: normalizeBaseUrl(scope.apiBaseUrl),
      serverId: scope.serverId,
      dataEpoch: scope.dataEpoch,
      createdAt: new Date().toISOString(),
      attempts: 0,
      blocked: false,
    };
    await db.put('requests', value);
    this.notify();
    return value;
  }

  async list(scope: QueueScope | null = getCurrentQueueScope()): Promise<QueuedRequest[]> {
    if (!scope) return [];
    const requests = await (await this.getDatabase()).getAllFromIndex('requests', 'by-created');
    return requests.filter((request) => this.matchesScope(request, scope));
  }

  async updateServerAddress(serverId: string, apiBaseUrl: string): Promise<void> {
    const userId = currentUserId();
    const normalizedId = String(serverId || '').trim();
    if (!userId || !normalizedId) return;

    const db = await this.getDatabase();
    const transaction = db.transaction('requests', 'readwrite');
    const requests = await transaction.store.index('by-created').getAll();
    for (const request of requests) {
      if (request.ownerUserId !== userId || request.serverId !== normalizedId) continue;
      await transaction.store.put({
        ...request,
        apiBaseUrl: normalizeBaseUrl(apiBaseUrl),
      });
    }
    await transaction.done;
    this.notify();
  }

  async removeStaleGenerations(serverId: string, currentDataEpoch: string): Promise<number> {
    const normalizedId = String(serverId || '').trim();
    const normalizedEpoch = String(currentDataEpoch || '').trim();
    if (!normalizedId || !normalizedEpoch) return 0;

    const db = await this.getDatabase();
    const transaction = db.transaction('requests', 'readwrite');
    const requests = await transaction.store.index('by-created').getAll();
    let removed = 0;
    for (const request of requests) {
      if (request.serverId !== normalizedId) continue;
      if (request.dataEpoch === normalizedEpoch) continue;
      await transaction.store.delete(request.id);
      removed += 1;
    }
    await transaction.done;
    if (removed) this.notify();
    return removed;
  }

  async count(scope: QueueScope | null = getCurrentQueueScope()): Promise<number> {
    return (await this.list(scope)).length;
  }

  async remove(id: string): Promise<void> {
    await (await this.getDatabase()).delete('requests', id);
    this.notify();
  }

  async markFailure(
    id: string,
    error: string,
    blocked = false,
    conflictVersion?: number,
  ): Promise<void> {
    const db = await this.getDatabase();
    const request = await db.get('requests', id);
    if (!request) return;
    await db.put('requests', {
      ...request,
      attempts: request.attempts + 1,
      lastError: error,
      blocked,
      conflictVersion: Number.isFinite(conflictVersion) ? conflictVersion : request.conflictVersion,
    });
    this.notify();
  }

  async unblock(id: string, useLatestVersion = true): Promise<void> {
    const db = await this.getDatabase();
    const request = await db.get('requests', id);
    if (!request) return;

    const nextHeaders = { ...(request.headers || {}) };
    let nextData = request.data;
    if (useLatestVersion && Number.isFinite(request.conflictVersion)) {
      nextHeaders['If-Match'] = String(request.conflictVersion);
      if (isObject(nextData)) {
        nextData = {
          ...nextData,
          expectedVersion: request.conflictVersion,
          version: request.conflictVersion,
        };
      }
    }

    await db.put('requests', {
      ...request,
      headers: nextHeaders,
      data: nextData,
      blocked: false,
      lastError: undefined,
    });
    this.notify();
  }

  async clearCurrent(scope: QueueScope | null = getCurrentQueueScope()): Promise<void> {
    const requests = await this.list(scope);
    const db = await this.getDatabase();
    const transaction = db.transaction('requests', 'readwrite');
    await Promise.all(requests.map((request) => transaction.store.delete(request.id)));
    await transaction.done;
    this.notify();
  }
}

export const offlineQueue = new OfflineQueue();
