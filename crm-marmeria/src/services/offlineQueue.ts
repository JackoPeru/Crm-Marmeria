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
}
interface QueueDatabase extends DBSchema {
  requests: { key: string; value: QueuedRequest; indexes: { 'by-created': string } };
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
  async add(request: Omit<QueuedRequest, 'createdAt' | 'attempts'>): Promise<QueuedRequest> {
    const value = { ...request, createdAt: new Date().toISOString(), attempts: 0 };
    await (await this.getDatabase()).put('requests', value);
    window.dispatchEvent(new CustomEvent('crm-offline-queue-changed'));
    return value;
  }
  async list() { return (await this.getDatabase()).getAllFromIndex('requests', 'by-created'); }
  async count() { return (await this.getDatabase()).count('requests'); }
  async remove(id: string) { await (await this.getDatabase()).delete('requests', id); window.dispatchEvent(new CustomEvent('crm-offline-queue-changed')); }
  async markFailure(id: string, error: string) {
    const db = await this.getDatabase();
    const request = await db.get('requests', id);
    if (!request) return;
    await db.put('requests', { ...request, attempts: request.attempts + 1, lastError: error });
    window.dispatchEvent(new CustomEvent('crm-offline-queue-changed'));
  }
  async clear() { await (await this.getDatabase()).clear('requests'); window.dispatchEvent(new CustomEvent('crm-offline-queue-changed')); }
}
export const offlineQueue = new OfflineQueue();
