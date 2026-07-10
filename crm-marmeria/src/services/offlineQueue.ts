import { openDB, DBSchema, IDBPDatabase } from 'idb';

export interface QueueScope {
  userId: string;
  apiBaseUrl: string;
}

export interface QueuedRequest {
  id: string;
  method: 'post' | 'put' | 'patch' | 'delete';
  url: string;
  data?: unknown;
  headers?: Record<string, string>;
  createdAt: string;
  attempts: number;
  lastError?: string;
  blocked?: boolean;
  conflictVersion?: number;
  ownerUserId: string;
  apiBaseUrl: string;
}

interface QueueDatabase extends DBSchema {
  requests: {
    key: string;
    value: QueuedRequest;
    indexes: { 'by-created': string };
  };
}

const normalizeBaseUrl = (value: string) => value.trim().replace(/\/$/, '').toLowerCase();

export const getCurrentQueueScope = (): QueueScope | null => {
  try {
    const user = JSON.parse(localStorage.getItem('crm_user_data') || 'null');
    const userId = user?.id == null ? '' : String(user.id);
    const apiBaseUrl = normalizeBaseUrl(
      localStorage.getItem('crm_api_base_url')
        || import.meta.env.VITE_API_BASE_URL
        || 'http://127.0.0.1:3001/api',
    );
    return userId && apiBaseUrl ? { userId, apiBaseUrl } : null;
  } catch {
    return null;
  }
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

  async add(
    request: Omit<QueuedRequest, 'createdAt' | 'attempts' | 'blocked' | 'ownerUserId' | 'apiBaseUrl'>,
    scope: QueueScope | null = getCurrentQueueScope(),
  ): Promise<QueuedRequest> {
    if (!scope) throw new Error('Impossibile accodare la modifica senza un utente autenticato');
    const value: QueuedRequest = {
      ...request,
      ownerUserId: String(scope.userId),
      apiBaseUrl: normalizeBaseUrl(scope.apiBaseUrl),
      createdAt: new Date().toISOString(),
      attempts: 0,
      blocked: false,
    };
    await (await this.getDatabase()).put('requests', value);
    this.notify();
    return value;
  }

  async list(scope: QueueScope | null = getCurrentQueueScope()): Promise<QueuedRequest[]> {
    if (!scope) return [];
    const normalizedUrl = normalizeBaseUrl(scope.apiBaseUrl);
    const requests = await (await this.getDatabase()).getAllFromIndex('requests', 'by-created');
    return requests.filter((request) => (
      request.ownerUserId === String(scope.userId)
      && normalizeBaseUrl(request.apiBaseUrl || '') === normalizedUrl
    ));
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
      if (nextData && typeof nextData === 'object' && !Array.isArray(nextData)) {
        nextData = {
          ...(nextData as Record<string, unknown>),
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
