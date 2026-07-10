const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const ENTITY_TYPES = ['client', 'order', 'project', 'material', 'quote', 'invoice'];
const now = () => new Date().toISOString();
const clone = (value) => JSON.parse(JSON.stringify(value ?? null));

class CrmDatabase {
  constructor({ dataDir, backupDir, attachmentsDir }) {
    this.dataDir = dataDir;
    this.backupDir = backupDir;
    this.attachmentsDir = attachmentsDir;
    this.dbPath = path.join(dataDir, 'crm-marmeria.db');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(backupDir, { recursive: true });
    fs.mkdirSync(attachmentsDir, { recursive: true });
    this.open();
  }

  open() {
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        entity_type TEXT NOT NULL,
        id TEXT NOT NULL,
        data_json TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (entity_type, id)
      );
      CREATE INDEX IF NOT EXISTS idx_entities_type_updated
        ON entities(entity_type, updated_at DESC);

      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        username TEXT,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        action TEXT NOT NULL,
        previous_json TEXT,
        next_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_entity
        ON audit_log(entity_type, entity_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS operations (
        operation_id TEXT PRIMARY KEY,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        original_name TEXT NOT NULL,
        stored_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        created_by TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_attachments_entity
        ON attachments(entity_type, entity_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    this.cleanupOperations();
  }

  close() {
    if (this.db?.open) this.db.close();
  }

  assertType(type) {
    if (!ENTITY_TYPES.includes(type)) {
      const error = new Error(`Tipo entità non supportato: ${type}`);
      error.status = 400;
      throw error;
    }
  }

  decode(row) {
    if (!row) return null;
    const data = JSON.parse(row.data_json);
    return {
      ...data,
      id: String(row.id),
      type: data.type || row.entity_type,
      version: Number(row.version),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  list(type) {
    this.assertType(type);
    return this.db.prepare(
      'SELECT * FROM entities WHERE entity_type = ? ORDER BY updated_at DESC'
    ).all(type).map((row) => this.decode(row));
  }

  get(type, id) {
    this.assertType(type);
    return this.decode(this.db.prepare(
      'SELECT * FROM entities WHERE entity_type = ? AND id = ?'
    ).get(type, String(id)));
  }

  getOperation(operationId) {
    if (!operationId) return null;
    const row = this.db.prepare(
      'SELECT response_json FROM operations WHERE operation_id = ?'
    ).get(String(operationId));
    return row ? JSON.parse(row.response_json) : null;
  }

  storeOperation(operationId, response) {
    if (!operationId) return;
    this.db.prepare(`
      INSERT OR REPLACE INTO operations(operation_id, response_json, created_at)
      VALUES (?, ?, ?)
    `).run(String(operationId), JSON.stringify(response), now());
  }

  cleanupOperations() {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    this.db.prepare('DELETE FROM operations WHERE created_at < ?').run(cutoff);
  }

  writeAudit({ user, type, id, action, previous, next }) {
    this.db.prepare(`
      INSERT INTO audit_log(
        id, user_id, username, entity_type, entity_id,
        action, previous_json, next_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      user?.id ? String(user.id) : null,
      user?.username || null,
      type,
      String(id),
      action,
      previous == null ? null : JSON.stringify(previous),
      next == null ? null : JSON.stringify(next),
      now(),
    );
  }

  create(type, input, user, operationId) {
    this.assertType(type);
    const replay = this.getOperation(operationId);
    if (replay) return { ...replay, replayed: true };

    return this.db.transaction(() => {
      const timestamp = now();
      const id = String(input.id || crypto.randomUUID());
      if (this.get(type, id)) {
        const error = new Error('Esiste già un elemento con questo ID');
        error.status = 409;
        throw error;
      }
      const data = {
        ...clone(input), id, type, version: 1,
        createdAt: timestamp, updatedAt: timestamp,
      };
      this.db.prepare(`
        INSERT INTO entities(entity_type, id, data_json, version, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?)
      `).run(type, id, JSON.stringify(data), timestamp, timestamp);
      this.writeAudit({ user, type, id, action: 'create', previous: null, next: data });
      const response = { item: data };
      this.storeOperation(operationId, response);
      return response;
    })();
  }

  update(type, id, patch, expectedVersion, user, operationId) {
    this.assertType(type);
    const replay = this.getOperation(operationId);
    if (replay) return { ...replay, replayed: true };

    return this.db.transaction(() => {
      const current = this.get(type, id);
      if (!current) {
        const error = new Error('Elemento non trovato');
        error.status = 404;
        throw error;
      }
      if (expectedVersion != null && Number(expectedVersion) !== Number(current.version)) {
        const error = new Error('Il record è stato modificato da un altro utente');
        error.status = 409;
        error.current = current;
        throw error;
      }
      const timestamp = now();
      const nextVersion = current.version + 1;
      const next = {
        ...current,
        ...clone(patch),
        id: current.id,
        type,
        version: nextVersion,
        createdAt: current.createdAt,
        updatedAt: timestamp,
      };
      this.db.prepare(`
        UPDATE entities
        SET data_json = ?, version = ?, updated_at = ?
        WHERE entity_type = ? AND id = ?
      `).run(JSON.stringify(next), nextVersion, timestamp, type, String(id));
      this.writeAudit({ user, type, id, action: 'update', previous: current, next });
      const response = { item: next };
      this.storeOperation(operationId, response);
      return response;
    })();
  }

  delete(type, id, expectedVersion, user, operationId) {
    this.assertType(type);
    const replay = this.getOperation(operationId);
    if (replay) return { ...replay, replayed: true };

    return this.db.transaction(() => {
      const current = this.get(type, id);
      if (!current) {
        const error = new Error('Elemento non trovato');
        error.status = 404;
        throw error;
      }
      if (expectedVersion != null && Number(expectedVersion) !== Number(current.version)) {
        const error = new Error('Il record è stato modificato da un altro utente');
        error.status = 409;
        error.current = current;
        throw error;
      }
      this.db.prepare(
        'DELETE FROM entities WHERE entity_type = ? AND id = ?'
      ).run(type, String(id));
      this.writeAudit({ user, type, id, action: 'delete', previous: current, next: null });
      const response = { deleted: true, id: String(id) };
      this.storeOperation(operationId, response);
      return response;
    })();
  }

  importEntity(type, input) {
    this.assertType(type);
    const timestamp = input.updatedAt || input.createdAt || now();
    const createdAt = input.createdAt || timestamp;
    const version = Math.max(Number(input.version || 1), 1);
    const id = String(input.id || crypto.randomUUID());
    const data = { ...clone(input), id, type, version, createdAt, updatedAt: timestamp };
    this.db.prepare(`
      INSERT INTO entities(entity_type, id, data_json, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(entity_type, id) DO UPDATE SET
        data_json = excluded.data_json,
        version = excluded.version,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `).run(type, id, JSON.stringify(data), version, createdAt, timestamp);
    return data;
  }

  migrateLegacy(dataDir) {
    const marker = this.db.prepare(
      "SELECT value FROM metadata WHERE key = 'legacy_json_migrated'"
    ).get();
    if (marker) return;

    const mapping = [
      ['clients.json', 'client'],
      ['materials.json', 'material'],
      ['projects.json', 'project'],
      ['quotes.json', 'quote'],
      ['invoices.json', 'invoice'],
    ];

    this.db.transaction(() => {
      for (const [filename, type] of mapping) {
        const filePath = path.join(dataDir, filename);
        if (!fs.existsSync(filePath)) continue;
        try {
          const items = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          if (Array.isArray(items)) items.forEach((item) => this.importEntity(type, item));
        } catch (error) {
          console.error(`Migrazione ${filename} fallita:`, error);
        }
      }
      const ordersPath = path.join(dataDir, 'orders.json');
      if (fs.existsSync(ordersPath)) {
        try {
          const items = JSON.parse(fs.readFileSync(ordersPath, 'utf8'));
          if (Array.isArray(items)) {
            items.forEach((item) => {
              const type = ENTITY_TYPES.includes(item.type) ? item.type : 'order';
              this.importEntity(type, item);
            });
          }
        } catch (error) {
          console.error('Migrazione orders.json fallita:', error);
        }
      }
      this.db.prepare(
        "INSERT OR REPLACE INTO metadata(key, value) VALUES ('legacy_json_migrated', ?)"
      ).run(now());
    })();
  }

  listAudit({ type, id, limit = 100 }) {
    const conditions = [];
    const values = [];
    if (type) { conditions.push('entity_type = ?'); values.push(type); }
    if (id) { conditions.push('entity_id = ?'); values.push(String(id)); }
    values.push(Math.min(Math.max(Number(limit) || 100, 1), 500));
    return this.db.prepare(`
      SELECT * FROM audit_log
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY created_at DESC LIMIT ?
    `).all(...values).map((row) => ({
      id: row.id,
      userId: row.user_id,
      username: row.username,
      entityType: row.entity_type,
      entityId: row.entity_id,
      action: row.action,
      previous: row.previous_json ? JSON.parse(row.previous_json) : null,
      next: row.next_json ? JSON.parse(row.next_json) : null,
      createdAt: row.created_at,
    }));
  }

  attachmentDirectory(entityType, entityId) {
    this.assertType(entityType);
    return path.join(this.attachmentsDir, entityType, String(entityId));
  }

  addAttachment({ entityType, entityId, originalName, storedName, mimeType, sizeBytes, user }) {
    this.assertType(entityType);
    const record = {
      id: crypto.randomUUID(),
      entityType,
      entityId: String(entityId),
      originalName,
      storedName,
      mimeType: mimeType || 'application/octet-stream',
      sizeBytes: Number(sizeBytes || 0),
      createdBy: user?.id ? String(user.id) : null,
      createdAt: now(),
    };
    this.db.prepare(`
      INSERT INTO attachments(
        id, entity_type, entity_id, original_name, stored_name,
        mime_type, size_bytes, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id, record.entityType, record.entityId, record.originalName,
      record.storedName, record.mimeType, record.sizeBytes,
      record.createdBy, record.createdAt,
    );
    this.writeAudit({ user, type: entityType, id: entityId, action: 'attachment.add', previous: null, next: record });
    return record;
  }

  listAttachments(entityType, entityId) {
    this.assertType(entityType);
    return this.db.prepare(`
      SELECT * FROM attachments
      WHERE entity_type = ? AND entity_id = ?
      ORDER BY created_at DESC
    `).all(entityType, String(entityId)).map((row) => ({
      id: row.id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      originalName: row.original_name,
      storedName: row.stored_name,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      createdBy: row.created_by,
      createdAt: row.created_at,
    }));
  }

  getAttachment(id) {
    const row = this.db.prepare('SELECT * FROM attachments WHERE id = ?').get(String(id));
    if (!row) return null;
    const absolutePath = path.join(
      this.attachmentDirectory(row.entity_type, row.entity_id),
      row.stored_name,
    );
    return {
      id: row.id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      originalName: row.original_name,
      storedName: row.stored_name,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      createdBy: row.created_by,
      createdAt: row.created_at,
      absolutePath,
    };
  }

  deleteAttachment(id, user) {
    const record = this.getAttachment(id);
    if (!record) return null;
    this.db.prepare('DELETE FROM attachments WHERE id = ?').run(String(id));
    if (fs.existsSync(record.absolutePath)) fs.unlinkSync(record.absolutePath);
    this.writeAudit({ user, type: record.entityType, id: record.entityId, action: 'attachment.delete', previous: record, next: null });
    return record;
  }

  exportJson() {
    const data = {};
    for (const type of ENTITY_TYPES) data[type] = this.list(type);
    return {
      version: '3.0',
      exportedAt: now(),
      data,
      audit: this.listAudit({ limit: 500 }),
    };
  }

  restoreJson(backup, user) {
    if (!backup?.data || typeof backup.data !== 'object') {
      const error = new Error('Backup JSON non valido');
      error.status = 400;
      throw error;
    }
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM entities').run();
      for (const type of ENTITY_TYPES) {
        const items = Array.isArray(backup.data[type]) ? backup.data[type] : [];
        items.forEach((item) => this.importEntity(type, item));
      }
      this.writeAudit({ user, type: 'database', id: 'all', action: 'restore.json', previous: null, next: { exportedAt: backup.exportedAt } });
    })();
  }

  snapshotName(label) {
    const safe = String(label || 'backup').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 40);
    return `${new Date().toISOString().replace(/[:.]/g, '-')}_${safe}`;
  }

  async createSnapshot(label = 'manuale') {
    const name = this.snapshotName(label);
    const destination = path.join(this.backupDir, name);
    fs.mkdirSync(destination, { recursive: true });
    const dbDestination = path.join(destination, 'crm-marmeria.db');
    await this.db.backup(dbDestination);
    const attachmentDestination = path.join(destination, 'attachments');
    if (fs.existsSync(this.attachmentsDir)) {
      fs.cpSync(this.attachmentsDir, attachmentDestination, { recursive: true });
    }
    const metadata = { name, label, createdAt: now() };
    fs.writeFileSync(path.join(destination, 'metadata.json'), JSON.stringify(metadata, null, 2));
    this.pruneSnapshots(30);
    return metadata;
  }

  listSnapshots() {
    if (!fs.existsSync(this.backupDir)) return [];
    return fs.readdirSync(this.backupDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const directory = path.join(this.backupDir, entry.name);
        const metadataPath = path.join(directory, 'metadata.json');
        try {
          const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
          return { ...metadata, sizeBytes: this.directorySize(directory) };
        } catch {
          const stats = fs.statSync(directory);
          return { name: entry.name, label: 'backup', createdAt: stats.mtime.toISOString(), sizeBytes: this.directorySize(directory) };
        }
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  directorySize(directory) {
    let total = 0;
    if (!fs.existsSync(directory)) return total;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      total += entry.isDirectory() ? this.directorySize(fullPath) : fs.statSync(fullPath).size;
    }
    return total;
  }

  pruneSnapshots(keep = 30) {
    const snapshots = this.listSnapshots();
    snapshots.slice(keep).forEach((snapshot) => {
      fs.rmSync(path.join(this.backupDir, snapshot.name), { recursive: true, force: true });
    });
  }

  restoreSnapshot(name) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(String(name))) {
      const error = new Error('Nome backup non valido');
      error.status = 400;
      throw error;
    }
    const source = path.join(this.backupDir, String(name));
    const dbSource = path.join(source, 'crm-marmeria.db');
    if (!fs.existsSync(dbSource)) {
      const error = new Error('Backup non trovato');
      error.status = 404;
      throw error;
    }

    this.close();
    fs.copyFileSync(dbSource, this.dbPath);
    for (const suffix of ['-wal', '-shm']) {
      const stale = `${this.dbPath}${suffix}`;
      if (fs.existsSync(stale)) fs.rmSync(stale, { force: true });
    }
    const attachmentSource = path.join(source, 'attachments');
    fs.rmSync(this.attachmentsDir, { recursive: true, force: true });
    fs.mkdirSync(this.attachmentsDir, { recursive: true });
    if (fs.existsSync(attachmentSource)) {
      fs.cpSync(attachmentSource, this.attachmentsDir, { recursive: true });
    }
    this.open();
    return this.listSnapshots().find((snapshot) => snapshot.name === name) || { name };
  }
}

module.exports = { CrmDatabase, ENTITY_TYPES };
