import { openDB, DBSchema, IDBPDatabase } from 'idb';

interface CacheEntry<T = unknown> {
  id: string;
  data: T;
  timestamp: number;
  ttl?: number;
}

interface CrmCacheDB extends DBSchema {
  customers: { key: string; value: CacheEntry };
  projects: { key: string; value: CacheEntry };
  orders: { key: string; value: CacheEntry };
  materials: { key: string; value: CacheEntry };
  analytics: { key: string; value: CacheEntry };
}

type CacheStore = 'customers' | 'projects' | 'orders' | 'materials' | 'analytics';

class CacheService {
  private db: IDBPDatabase<CrmCacheDB> | null = null;
  private initPromise: Promise<IDBPDatabase<CrmCacheDB>> | null = null;
  private readonly DB_NAME = 'crmCache';
  private readonly DB_VERSION = 1;
  private readonly DEFAULT_TTL = 5 * 60 * 1000;

  async init(): Promise<void> {
    await this.getDatabase();
  }

  private async getDatabase(): Promise<IDBPDatabase<CrmCacheDB>> {
    if (this.db) return this.db;
    if (!this.initPromise) {
      this.initPromise = openDB<CrmCacheDB>(this.DB_NAME, this.DB_VERSION, {
        upgrade(db) {
          const stores: CacheStore[] = [
            'customers',
            'projects',
            'orders',
            'materials',
            'analytics',
          ];
          for (const store of stores) {
            if (!db.objectStoreNames.contains(store)) {
              db.createObjectStore(store, { keyPath: 'id' });
            }
          }
        },
      });
    }

    try {
      this.db = await this.initPromise;
      return this.db;
    } catch (error) {
      this.initPromise = null;
      throw error;
    }
  }

  private isExpired(entry: CacheEntry): boolean {
    return entry.ttl != null && Date.now() - entry.timestamp > entry.ttl;
  }

  async set<T>(
    store: CacheStore,
    key: string,
    data: T,
    ttl: number = this.DEFAULT_TTL,
  ): Promise<void> {
    const db = await this.getDatabase();
    const entry: CacheEntry<T> = {
      id: key,
      data,
      timestamp: Date.now(),
      ttl,
    };
    await db.put(store, entry as CacheEntry);
  }

  async get<T>(store: CacheStore, key: string): Promise<T | null> {
    const db = await this.getDatabase();
    try {
      const entry = await db.get(store, key);
      if (!entry) return null;
      if (this.isExpired(entry)) {
        await db.delete(store, key);
        return null;
      }
      return entry.data as T;
    } catch (error) {
      console.error(`Errore nel recupero cache ${store}/${key}:`, error);
      return null;
    }
  }

  async getAll<T>(store: CacheStore): Promise<T[]> {
    const db = await this.getDatabase();
    try {
      const entries = await db.getAll(store);
      const transaction = db.transaction(store, 'readwrite');
      const validEntries: T[] = [];
      for (const entry of entries) {
        if (this.isExpired(entry)) {
          await transaction.store.delete(entry.id);
        } else {
          validEntries.push(entry.data as T);
        }
      }
      await transaction.done;
      return validEntries;
    } catch (error) {
      console.error(`Errore nel recupero cache ${store}:`, error);
      return [];
    }
  }

  async delete(store: CacheStore, key: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db.delete(store, key);
    } catch (error) {
      console.error(`Errore nell'eliminazione cache ${store}/${key}:`, error);
    }
  }

  async clear(store: CacheStore): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db.clear(store);
    } catch (error) {
      console.error(`Errore nella pulizia cache ${store}:`, error);
    }
  }

  async clearAll(): Promise<void> {
    const stores: CacheStore[] = [
      'customers',
      'projects',
      'orders',
      'materials',
      'analytics',
    ];
    await Promise.all(stores.map((store) => this.clear(store)));
  }

  async cleanExpired(): Promise<void> {
    const stores: CacheStore[] = [
      'customers',
      'projects',
      'orders',
      'materials',
      'analytics',
    ];
    for (const store of stores) {
      await this.getAll(store);
    }
  }

  async getStats(): Promise<{
    stores: Record<CacheStore, number>;
    totalSize: number;
  }> {
    const db = await this.getDatabase();
    const stores: CacheStore[] = [
      'customers',
      'projects',
      'orders',
      'materials',
      'analytics',
    ];
    const stats = {} as Record<CacheStore, number>;
    let totalSize = 0;

    for (const store of stores) {
      const count = await db.count(store);
      stats[store] = count;
      totalSize += count;
    }
    return { stores: stats, totalSize };
  }
}

export const cacheService = new CacheService();
export default cacheService;
