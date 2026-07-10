import { openDB, DBSchema, IDBPDatabase } from 'idb';

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
}
interface QueueDatabase extends DBSchema {
  requests: {
    key: string;
    value: QueuedRequest;
    indexes: { 'by-created': string };
  };
}

class OfflineQueue {
  private database: Promise<IDBPDatabase<QueueDatabase>> | null = null;

  private getDatabase() {
    if (!this.database) {
      this.database = openDB<QueueDatabase>('crm-marmeria-offline', 1, {
        upgrade(db) {
          const store = db.createObjectStore('requests', { keyPath: 'id' });
          store.createIndex('by-created', 'createdAt');
        },
      });
    }
    return this.database;
  }

  private notify() {
    window.dispatchEvent(new CustomEvent('crm-offline-queue-changed'));
  }

  async add(request: Omit<QueuedRequest, 'createdAt' | 'attempts'>): Promise<QueuedRequest> {
    const value: QueuedRequest = {
      ...request,
      createdAt: new Date().toISOString(),
      attempts: 0,
      blocked: false,
    };
    await (await this.getDatabase()).put('requests', value);
    this.notify();
    return value;
  }

  async list(): Promise<QueuedRequest[]> {
    return (await this.getDatabase()).getAllFromIndex('requests', 'by-created');
  }

  async count(): Promise<number> {
    return (await this.getDatabase()).count('requests');
  }

  async remove(id: string): Promise<void> {
    await (await this.getDatabase()).delete('requests', id);
    this.notify();
  }

  async markFailure(id: string, error: string, blocked = false): Promise<void> {
    const db = await this.getDatabase();
    const request = await db.get('requests', id);
    if (!request) return;
    await db.put('requests', {
      ...request,
      attempts: request.attempts + 1,
      lastError: error,
      blocked,
    });
    this.notify();
  }

  async unblock(id: string): Promise<void> {
    const db = await this.getDatabase();
    const request = await db.get('requests', id);
    if (!request) return;
    await db.put('requests', {
      ...request,
      blocked: false,
      lastError: undefined,
    });
    this.notify();
  }

  async clear(): Promise<void> {
    await (await this.getDatabase()).clear('requests');
    this.notify();
  }
}

export const offlineQueue = new OfflineQueue();
