const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const {
  atomicWriteJson,
  recoverInterruptedRestore,
  restorePaths,
  syncDirectory,
  syncFile,
  syncTree,
  validateDatabase,
  validateUsers,
} = require('./restore-safety');

const ENTITY_TYPES = ['client', 'supplier', 'order', 'project', 'material', 'quote', 'invoice', 'payment', 'purchase_order', 'delivery_note', 'service_case', 'message_draft', 'appointment', 'quote_template'];
const DOCUMENT_CONFIG = {
  quote: { field: 'quoteNumber', prefix: 'PREV' },
  invoice: { field: 'invoiceNumber', prefix: 'FATT' },
};
const now = () => new Date().toISOString();
const clone = (value) => JSON.parse(JSON.stringify(value ?? null));
const resolved = (value) => path.resolve(String(value));
const isInside = (parent, child) => {
  const relative = path.relative(resolved(parent), resolved(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};
const numeric = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const compact = String(value ?? '').trim().replace(/[\s€£$']/g, '');
  if (!compact) return 0;
  const comma = compact.lastIndexOf(',');
  const dot = compact.lastIndexOf('.');
  let normalized = compact;
  if (comma >= 0 && dot >= 0) {
    normalized = comma > dot
      ? compact.replace(/\./g, '').replace(',', '.')
      : compact.replace(/,/g, '');
  } else if (comma >= 0) {
    normalized = compact.replace(',', '.');
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

class CrmDatabase {
  constructor({ dataDir, backupDir, attachmentsDir }) {
    this.dataDir = resolved(dataDir);
    this.backupDir = resolved(backupDir);
    this.attachmentsDir = resolved(attachmentsDir);
    this.dbPath = path.join(this.dataDir, 'crm-marmeria.db');
    this.usersPath = path.join(this.dataDir, 'users.json');
    this.snapshotQueue = Promise.resolve();
    this.restorePaths = restorePaths({
      dataDir: this.dataDir,
      dbPath: this.dbPath,
      usersPath: this.usersPath,
      attachmentsDir: this.attachmentsDir,
    });

    if (isInside(this.attachmentsDir, this.backupDir)
      || isInside(this.backupDir, this.attachmentsDir)) {
      throw new Error('Le cartelle backup e allegati non possono contenersi a vicenda');
    }

    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.mkdirSync(this.backupDir, { recursive: true });
    fs.mkdirSync(this.attachmentsDir, { recursive: true });
    recoverInterruptedRestore({
      dataDir: this.dataDir,
      dbPath: this.dbPath,
      usersPath: this.usersPath,
      attachmentsDir: this.attachmentsDir,
    });
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

  normalizeData(type, input) {
    const data = clone(input) || {};

    for (const key of ['id', 'clientId', 'customerId', 'supplierId', 'projectId', 'quoteId', 'invoiceId']) {
      if (data[key] != null && data[key] !== '') data[key] = String(data[key]);
    }

    if (Array.isArray(data.items)) {
      data.items = data.items.map((item) => ({
        ...item,
        materialId: item.materialId == null || item.materialId === ''
          ? null
          : String(item.materialId),
        quantity: numeric(item.quantity),
        unitPrice: numeric(item.unitPrice),
        taxRate: numeric(item.taxRate),
        taxNature: String(item.taxNature || '').trim().toUpperCase(),
      }));
    }

    if (type === 'client') {
      const commercialType = data.clientType
        || (['Azienda', 'Privato'].includes(data.type) ? data.type : 'Privato');
      data.type = commercialType;
      data.clientType = commercialType;
      data.entityType = 'client';
      for (const key of ['name', 'firstName', 'lastName', 'email', 'phone', 'address', 'streetNumber', 'zip', 'city', 'province', 'country', 'vatNumber', 'fiscalCode', 'recipientCode', 'recipientPec', 'notes']) {
        if (data[key] != null) data[key] = String(data[key] || '').trim();
      }
      data.province = String(data.province || '').toUpperCase();
      data.country = String(data.country || 'IT').toUpperCase();
      data.recipientCode = String(data.recipientCode || '').toUpperCase();
      return data;
    }

    if (type === 'material') {
      const unitPrice = numeric(data.unitPrice ?? data.price);
      const stockQuantity = numeric(data.stockQuantity ?? data.quantity ?? data.stock);
      const minStockLevel = numeric(data.minStockLevel ?? data.minQuantity ?? 10);
      return {
        ...data,
        type: 'material',
        entityType: 'material',
        unitPrice,
        price: unitPrice,
        stockQuantity,
        quantity: stockQuantity,
        stock: stockQuantity,
        minStockLevel,
        minQuantity: minStockLevel,
      };
    }

    if (type === 'appointment') {
      return {
        ...data,
        type: 'appointment',
        entityType: 'appointment',
        title: String(data.title || ''),
        startAt: data.startAt ? new Date(data.startAt).toISOString() : '',
        endAt: data.endAt ? new Date(data.endAt).toISOString() : '',
      };
    }

    if (type === 'supplier') {
      return {
        ...data,
        type: 'supplier', entityType: 'supplier',
        name: String(data.name || '').trim(),
        email: String(data.email || '').trim(), phone: String(data.phone || '').trim(),
        address: String(data.address || '').trim(), vatNumber: String(data.vatNumber || '').trim(),
        fiscalCode: String(data.fiscalCode || '').trim(), notes: String(data.notes || '').trim(),
      };
    }

    if (type === 'quote_template') {
      return {
        ...data,
        type: 'quote_template',
        entityType: 'quote_template',
        name: String(data.name || ''),
      };
    }

    if (type === 'payment') {
      return {
        ...data,
        type: 'payment',
        entityType: 'payment',
        date: String(data.date || '').slice(0, 10),
        amount: Number(numeric(data.amount).toFixed(2)),
        method: String(data.method || '').trim(),
        reference: String(data.reference || '').trim(),
        notes: String(data.notes || '').trim(),
        source: String(data.source || 'manual').trim() || 'manual',
      };
    }

    if (type === 'project') {
      const costItems = Array.isArray(data.costItems) ? data.costItems.map((item) => ({
        category: String(item.category || 'Altro').trim(),
        description: String(item.description || '').trim(),
        quantity: numeric(item.quantity ?? 1),
        unitCost: numeric(item.unitCost ?? item.cost),
      })) : [];
      const technicalSheet = data.technicalSheet && typeof data.technicalSheet === 'object'
        ? Object.fromEntries(Object.entries(data.technicalSheet).map(([key, value]) => [key, String(value || '').trim()]))
        : {};
      return {
        ...data,
        type: 'project', entityType: 'project',
        title: data.title ?? data.name ?? '', name: data.name ?? data.title ?? '',
        deadline: data.deadline ?? data.endDate ?? data.estimatedDelivery ?? '',
        endDate: data.endDate ?? data.deadline ?? data.estimatedDelivery ?? '',
        budget: numeric(data.budget), costItems, technicalSheet,
        laborHours: numeric(data.laborHours), laborRate: numeric(data.laborRate),
        transportCost: numeric(data.transportCost), otherCosts: numeric(data.otherCosts),
      };
    }

    if (['purchase_order', 'delivery_note', 'service_case', 'message_draft'].includes(type)) {
      return {
        ...data,
        type,
        entityType: type,
        title: String(data.title || data.subject || '').trim(),
        date: String(data.date || '').slice(0, 10),
        status: String(data.status || '').trim(),
        amount: data.amount == null ? undefined : Number(numeric(data.amount).toFixed(2)),
        items: Array.isArray(data.items) ? data.items.map((item) => ({
          ...item,
          description: String(item.description || '').trim(),
          quantity: numeric(item.quantity),
          unitPrice: numeric(item.unitPrice),
        })) : [],
      };
    }

    if (['order', 'project', 'quote', 'invoice'].includes(type)) {
      data.type = type;
      data.entityType = type;
      if (data.title != null || data.name != null) {
        data.title = data.title ?? data.name ?? '';
        data.name = data.name ?? data.title ?? '';
      }
      if (data.deadline != null || data.endDate != null || data.estimatedDelivery != null) {
        data.deadline = data.deadline ?? data.endDate ?? data.estimatedDelivery ?? '';
        data.endDate = data.endDate ?? data.deadline;
      }
    }

    if (['quote', 'invoice'].includes(type) && Array.isArray(data.items)) {
      const subtotal = data.items.reduce(
        (sum, item) => sum + numeric(item.quantity) * numeric(item.unitPrice),
        0,
      );
      const taxTotal = type === 'invoice'
        ? data.items.reduce((sum, item) => {
          const line = numeric(item.quantity) * numeric(item.unitPrice);
          return sum + line * (numeric(item.taxRate) / 100);
        }, 0)
        : 0;
      data.subtotal = Number(subtotal.toFixed(2));
      data.taxTotal = Number(taxTotal.toFixed(2));
      data.total = Number((subtotal + taxTotal).toFixed(2));
      data.amount = data.total;
    } else if (data.amount != null || data.total != null) {
      data.amount = numeric(data.amount ?? data.total);
      if (data.total != null) data.total = numeric(data.total);
    }

    if (type === 'project' && data.budget != null) data.budget = numeric(data.budget);
    return data;
  }

  decode(row) {
    if (!row) return null;
    const data = this.normalizeData(row.entity_type, JSON.parse(row.data_json));
    return {
      ...data,
      id: String(row.id),
      version: Number(row.version),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  list(type) {
    this.assertType(type);
    return this.db.prepare(
      'SELECT * FROM entities WHERE entity_type = ? ORDER BY updated_at DESC',
    ).all(type).map((row) => this.decode(row));
  }

  get(type, id) {
    this.assertType(type);
    return this.decode(this.db.prepare(
      'SELECT * FROM entities WHERE entity_type = ? AND id = ?',
    ).get(type, String(id)));
  }

  getOperation(operationId) {
    if (!operationId) return null;
    const row = this.db.prepare(
      'SELECT response_json FROM operations WHERE operation_id = ?',
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

  documentNumberExists(type, field, number, excludedId = null) {
    if (!number) return false;
    return this.list(type).some((item) => (
      String(item.id) !== String(excludedId || '')
      && String(item[field] || '').toUpperCase() === String(number).toUpperCase()
    ));
  }

  nextDocumentNumber(type, dateValue) {
    const config = DOCUMENT_CONFIG[type];
    if (!config) return null;
    const parsedDate = new Date(dateValue || Date.now());
    const year = Number.isNaN(parsedDate.getTime())
      ? new Date().getFullYear()
      : parsedDate.getFullYear();
    const expression = new RegExp(`^${config.prefix}-${year}-(\\d+)$`, 'i');
    const highest = this.list(type).reduce((maximum, item) => {
      const match = String(item[config.field] || '').match(expression);
      return match ? Math.max(maximum, Number(match[1]) || 0) : maximum;
    }, 0);
    return `${config.prefix}-${year}-${String(highest + 1).padStart(3, '0')}`;
  }

  prepareDocumentNumber(type, data, excludedId = null, allowRegeneration = true) {
    const config = DOCUMENT_CONFIG[type];
    if (!config) return data;
    const requested = String(data[config.field] || '').trim();
    if (!requested || this.documentNumberExists(type, config.field, requested, excludedId)) {
      if (!allowRegeneration && requested) {
        const error = new Error(`Il numero ${requested} è già utilizzato`);
        error.status = 409;
        throw error;
      }
      return { ...data, [config.field]: this.nextDocumentNumber(type, data.date) };
    }
    return { ...data, [config.field]: requested };
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

      let payload = this.normalizeData(type, input);
      payload = this.prepareDocumentNumber(type, payload, null, true);
      const data = {
        ...payload,
        id,
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
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

  importHistory(operations, user, operationId) {
    const replay = this.getOperation(operationId);
    if (replay) return { ...replay, replayed: true };
    if (!Array.isArray(operations) || !operations.length) {
      const error = new Error('Nessun dato valido da importare');
      error.status = 400;
      throw error;
    }

    return this.db.transaction(() => {
      const imported = [];
      const skipped = [];
      for (const operation of operations) {
        const type = String(operation?.type || '');
        const input = operation?.input;
        this.assertType(type);
        if (!input || typeof input !== 'object') {
          const error = new Error('Riga di importazione non valida');
          error.status = 400;
          throw error;
        }
        const id = String(input.id || crypto.randomUUID());
        if (this.get(type, id)) {
          skipped.push({ type, id });
          continue;
        }
        const timestamp = now();
        let payload = this.normalizeData(type, { ...clone(input), id });
        payload = this.prepareDocumentNumber(type, payload, null, true);
        const data = {
          ...payload,
          id,
          version: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        this.db.prepare(`
          INSERT INTO entities(entity_type, id, data_json, version, created_at, updated_at)
          VALUES (?, ?, ?, 1, ?, ?)
        `).run(type, id, JSON.stringify(data), timestamp, timestamp);
        this.writeAudit({ user, type, id, action: 'import.excel', previous: null, next: data });
        imported.push(data);
      }
      const response = { imported, skipped };
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
      let next = this.normalizeData(type, {
        ...current,
        ...clone(patch),
        id: current.id,
        version: nextVersion,
        createdAt: current.createdAt,
        updatedAt: timestamp,
      });
      next = this.prepareDocumentNumber(type, next, current.id, false);

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

    const result = this.db.transaction(() => {
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

      const attachments = this.listAttachments(type, id);
      this.db.prepare(
        'DELETE FROM attachments WHERE entity_type = ? AND entity_id = ?',
      ).run(type, String(id));
      this.db.prepare(
        'DELETE FROM entities WHERE entity_type = ? AND id = ?',
      ).run(type, String(id));
      this.writeAudit({ user, type, id, action: 'delete', previous: current, next: null });
      const response = { deleted: true, id: String(id) };
      this.storeOperation(operationId, response);
      return { response, attachments };
    })();

    this.removeAttachmentFiles(result.attachments);
    fs.rmSync(this.attachmentDirectory(type, id), { recursive: true, force: true });
    return result.response;
  }

  importEntity(type, input) {
    this.assertType(type);
    const timestamp = input.updatedAt || input.createdAt || now();
    const createdAt = input.createdAt || timestamp;
    const version = Math.max(Number(input.version || 1), 1);
    const id = String(input.id || crypto.randomUUID());
    const data = this.normalizeData(type, {
      ...clone(input),
      id,
      version,
      createdAt,
      updatedAt: timestamp,
    });
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
      "SELECT value FROM metadata WHERE key = 'legacy_json_migrated'",
    ).get();
    if (marker) return true;

    const staged = [];
    let failed = false;
    const stageArray = (filename, mapper) => {
      const filePath = path.join(dataDir, filename);
      if (!fs.existsSync(filePath)) return;
      try {
        const items = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!Array.isArray(items)) throw new Error('il contenuto non è un elenco');
        items.forEach((item) => staged.push(mapper(item)));
      } catch (error) {
        failed = true;
        console.error(`Migrazione ${filename} rinviata:`, error.message);
      }
    };

    for (const [filename, type] of [
      ['clients.json', 'client'],
      ['materials.json', 'material'],
      ['projects.json', 'project'],
      ['quotes.json', 'quote'],
      ['invoices.json', 'invoice'],
    ]) {
      stageArray(filename, (item) => ({ type, item }));
    }
    stageArray('orders.json', (item) => ({
      type: ENTITY_TYPES.includes(item?.type) ? item.type : 'order',
      item,
    }));

    if (failed) return false;
    this.db.transaction(() => {
      staged.forEach(({ type, item }) => this.importEntity(type, item));
      this.db.prepare(
        "INSERT OR REPLACE INTO metadata(key, value) VALUES ('legacy_json_migrated', ?)",
      ).run(now());
    })();
    return true;
  }

  listAudit({ type, id, limit = 100 }) {
    const conditions = [];
    const values = [];
    if (type) {
      conditions.push('entity_type = ?');
      values.push(type);
    }
    if (id) {
      conditions.push('entity_id = ?');
      values.push(String(id));
    }
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
    const safeEntityId = crypto
      .createHash('sha256')
      .update(String(entityId))
      .digest('hex');
    return path.join(this.attachmentsDir, entityType, safeEntityId);
  }

  attachmentRecord(row) {
    if (!row) return null;
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
    };
  }

  addAttachments(records, user) {
    if (!Array.isArray(records) || !records.length) return [];
    return this.db.transaction(() => records.map((input) => {
      this.assertType(input.entityType);
      const record = {
        id: crypto.randomUUID(),
        entityType: input.entityType,
        entityId: String(input.entityId),
        originalName: input.originalName,
        storedName: input.storedName,
        mimeType: input.mimeType || 'application/octet-stream',
        sizeBytes: Number(input.sizeBytes || 0),
        createdBy: user?.id ? String(user.id) : null,
        createdAt: now(),
      };
      this.db.prepare(`
        INSERT INTO attachments(
          id, entity_type, entity_id, original_name, stored_name,
          mime_type, size_bytes, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.id,
        record.entityType,
        record.entityId,
        record.originalName,
        record.storedName,
        record.mimeType,
        record.sizeBytes,
        record.createdBy,
        record.createdAt,
      );
      this.writeAudit({
        user,
        type: record.entityType,
        id: record.entityId,
        action: 'attachment.add',
        previous: null,
        next: record,
      });
      return record;
    }))();
  }

  addAttachment(input) {
    return this.addAttachments([input], input.user)[0];
  }

  listAttachments(entityType, entityId) {
    this.assertType(entityType);
    return this.db.prepare(`
      SELECT * FROM attachments
      WHERE entity_type = ? AND entity_id = ?
      ORDER BY created_at DESC
    `).all(entityType, String(entityId)).map((row) => this.attachmentRecord(row));
  }

  getAttachment(id) {
    const record = this.attachmentRecord(
      this.db.prepare('SELECT * FROM attachments WHERE id = ?').get(String(id)),
    );
    if (!record) return null;
    return {
      ...record,
      absolutePath: path.join(
        this.attachmentDirectory(record.entityType, record.entityId),
        record.storedName,
      ),
    };
  }

  removeAttachmentFiles(records) {
    for (const record of records || []) {
      const absolutePath = path.join(
        this.attachmentDirectory(record.entityType, record.entityId),
        record.storedName,
      );
      if (fs.existsSync(absolutePath)) fs.rmSync(absolutePath, { force: true });
    }
  }

  deleteAttachment(id, user) {
    const record = this.getAttachment(id);
    if (!record) return null;
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM attachments WHERE id = ?').run(String(id));
      this.writeAudit({
        user,
        type: record.entityType,
        id: record.entityId,
        action: 'attachment.delete',
        previous: record,
        next: null,
      });
    })();
    if (fs.existsSync(record.absolutePath)) fs.rmSync(record.absolutePath, { force: true });
    return record;
  }

  exportJson() {
    const data = {};
    for (const type of ENTITY_TYPES) data[type] = this.list(type);
    return {
      version: '3.2',
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

    for (const type of ENTITY_TYPES) {
      if (!Object.prototype.hasOwnProperty.call(backup.data, type) || !Array.isArray(backup.data[type])) {
        const error = new Error(`Il backup deve contenere la sezione completa ${type}`);
        error.status = 400;
        throw error;
      }
      const ids = new Set();
      for (const item of backup.data[type]) {
        if (item?.id == null || item.id === '') continue;
        const id = String(item.id);
        if (ids.has(id)) {
          const error = new Error(`La sezione ${type} contiene ID duplicati`);
          error.status = 400;
          throw error;
        }
        ids.add(id);
      }
    }

    const orphanedAttachments = this.db.transaction(() => {
      this.db.prepare('DELETE FROM operations').run();
      this.db.prepare('DELETE FROM entities').run();
      for (const type of ENTITY_TYPES) {
        backup.data[type].forEach((item) => this.importEntity(type, item));
      }
      // Il formato JSON esporta dati strutturati, non file binari. Conserva
      // gli allegati dei record che restano nel JSON invece di cancellarli
      // silenziosamente durante un normale scambio dati.
      const orphaned = this.db.prepare(`
        SELECT * FROM attachments
        WHERE NOT EXISTS (
          SELECT 1 FROM entities
          WHERE entities.entity_type = attachments.entity_type
            AND entities.id = attachments.entity_id
        )
      `).all().map((row) => this.attachmentRecord(row));
      this.db.prepare(`
        DELETE FROM attachments
        WHERE NOT EXISTS (
          SELECT 1 FROM entities
          WHERE entities.entity_type = attachments.entity_type
            AND entities.id = attachments.entity_id
        )
      `).run();
      this.writeAudit({
        user,
        type: 'database',
        id: 'all',
        action: 'restore.json',
        previous: null,
        next: { exportedAt: backup.exportedAt },
      });
      return orphaned;
    })();

    this.removeAttachmentFiles(orphanedAttachments);
    return { preservedAttachments: this.db.prepare('SELECT COUNT(*) AS count FROM attachments').get().count };
  }

  snapshotName(label) {
    const safe = String(label || 'backup')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .slice(0, 40);
    const suffix = crypto.randomUUID().slice(0, 8);
    return `${new Date().toISOString().replace(/[:.]/g, '-')}_${safe}_${suffix}`;
  }

  createSnapshot(label = 'manuale') {
    const task = this.snapshotQueue.then(() => this.createSnapshotInternal(label));
    this.snapshotQueue = task.catch(() => undefined);
    return task;
  }

  async createSnapshotInternal(label) {
    const name = this.snapshotName(label);
    const temporary = path.join(this.backupDir, `.${name}.tmp`);
    const destination = path.join(this.backupDir, name);
    fs.rmSync(temporary, { recursive: true, force: true });
    fs.mkdirSync(temporary, { recursive: true });

    try {
      await this.db.backup(path.join(temporary, 'crm-marmeria.db'));
      if (fs.existsSync(this.usersPath)) {
        fs.copyFileSync(this.usersPath, path.join(temporary, 'users.json'));
      }
      if (fs.existsSync(this.attachmentsDir)) {
        fs.cpSync(this.attachmentsDir, path.join(temporary, 'attachments'), {
          recursive: true,
        });
      }
      const metadata = {
        name,
        label,
        version: 3,
        createdAt: now(),
      };
      atomicWriteJson(path.join(temporary, 'metadata.json'), metadata);
      syncTree(temporary);
      fs.renameSync(temporary, destination);
      syncDirectory(this.backupDir);
      try {
        this.pruneSnapshots(30);
      } catch (error) {
        console.error('Pulizia vecchi snapshot fallita:', error);
      }
      return metadata;
    } catch (error) {
      fs.rmSync(temporary, { recursive: true, force: true });
      throw error;
    }
  }

  listSnapshots() {
    if (!fs.existsSync(this.backupDir)) return [];
    return fs.readdirSync(this.backupDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => {
        const directory = path.join(this.backupDir, entry.name);
        const metadataPath = path.join(directory, 'metadata.json');
        const databasePath = path.join(directory, 'crm-marmeria.db');
        if (!fs.existsSync(metadataPath) || !fs.existsSync(databasePath)) return null;
        try {
          const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
          return {
            ...metadata,
            name: entry.name,
            sizeBytes: this.directorySize(directory),
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  directorySize(directory) {
    let total = 0;
    if (!fs.existsSync(directory)) return total;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      total += entry.isDirectory()
        ? this.directorySize(fullPath)
        : fs.statSync(fullPath).size;
    }
    return total;
  }

  pruneSnapshots(keep = 30) {
    this.listSnapshots().slice(keep).forEach((snapshot) => {
      fs.rmSync(path.join(this.backupDir, snapshot.name), {
        recursive: true,
        force: true,
      });
    });
  }

  restoreSnapshot(name, user) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(String(name))) {
      const error = new Error('Nome backup non valido');
      error.status = 400;
      throw error;
    }

    const source = path.join(this.backupDir, String(name));
    const dbSource = path.join(source, 'crm-marmeria.db');
    const usersSource = path.join(source, 'users.json');
    const attachmentsSource = path.join(source, 'attachments');
    if (!fs.existsSync(dbSource)) {
      const error = new Error('Backup non trovato');
      error.status = 404;
      throw error;
    }

    const stageRoot = path.join(this.dataDir, `.restore-${crypto.randomUUID()}`);
    const stageDb = path.join(stageRoot, 'crm-marmeria.db');
    const stageUsers = path.join(stageRoot, 'users.json');
    const stageAttachments = path.join(stageRoot, 'attachments');
    const {
      journalPath,
      previousDb,
      previousUsers,
      previousAttachments,
    } = this.restorePaths;
    const journalBase = {
      stageRoot,
      previousDb,
      previousUsers,
      previousAttachments,
      snapshot: String(name),
      startedAt: now(),
    };
    let committed = false;
    fs.mkdirSync(stageRoot, { recursive: true });

    try {
      fs.copyFileSync(dbSource, stageDb);
      if (fs.existsSync(usersSource)) fs.copyFileSync(usersSource, stageUsers);
      else if (fs.existsSync(this.usersPath)) fs.copyFileSync(this.usersPath, stageUsers);
      else {
        const error = new Error('Il backup non contiene account e non esistono account correnti da conservare');
        error.status = 400;
        throw error;
      }

      if (fs.existsSync(attachmentsSource)) {
        fs.cpSync(attachmentsSource, stageAttachments, { recursive: true, verbatimSymlinks: true });
      } else if (fs.existsSync(this.attachmentsDir)) {
        fs.cpSync(this.attachmentsDir, stageAttachments, { recursive: true, verbatimSymlinks: true });
      } else {
        fs.mkdirSync(stageAttachments, { recursive: true });
      }

      validateDatabase(stageDb, stageAttachments);
      validateUsers(stageUsers);
      syncTree(stageRoot);

      this.db.pragma('wal_checkpoint(TRUNCATE)');
      this.close();
      if (fs.existsSync(this.dbPath)) syncFile(this.dbPath);
      if (fs.existsSync(this.usersPath)) syncFile(this.usersPath);
      if (fs.existsSync(this.attachmentsDir)) syncTree(this.attachmentsDir);
      for (const suffix of ['-wal', '-shm']) fs.rmSync(`${this.dbPath}${suffix}`, { force: true });
      fs.rmSync(previousDb, { force: true });
      fs.rmSync(previousUsers, { force: true });
      fs.rmSync(previousAttachments, { recursive: true, force: true });

      atomicWriteJson(journalPath, { ...journalBase, state: 'swapping' });
      if (fs.existsSync(this.dbPath)) fs.renameSync(this.dbPath, previousDb);
      if (fs.existsSync(this.usersPath)) fs.renameSync(this.usersPath, previousUsers);
      if (fs.existsSync(this.attachmentsDir)) fs.renameSync(this.attachmentsDir, previousAttachments);

      fs.renameSync(stageDb, this.dbPath);
      fs.renameSync(stageUsers, this.usersPath);
      fs.renameSync(stageAttachments, this.attachmentsDir);
      syncDirectory(this.dataDir);

      validateDatabase(this.dbPath, this.attachmentsDir);
      validateUsers(this.usersPath);
      this.open();
      this.writeAudit({
        user,
        type: 'database',
        id: 'all',
        action: 'restore.snapshot',
        previous: null,
        next: { snapshot: String(name) },
      });
      this.db.pragma('wal_checkpoint(TRUNCATE)');
      syncFile(this.dbPath);
      syncFile(this.usersPath);
      syncTree(this.attachmentsDir);

      atomicWriteJson(journalPath, { ...journalBase, state: 'committed' });
      committed = true;
      fs.rmSync(previousDb, { force: true });
      fs.rmSync(previousUsers, { force: true });
      fs.rmSync(previousAttachments, { recursive: true, force: true });
      fs.rmSync(journalPath, { force: true });
      syncDirectory(this.dataDir);
    } catch (error) {
      if (this.db?.open) this.close();
      if (!committed) {
        recoverInterruptedRestore({
          dataDir: this.dataDir,
          dbPath: this.dbPath,
          usersPath: this.usersPath,
          attachmentsDir: this.attachmentsDir,
        });
      }
      throw error;
    } finally {
      fs.rmSync(stageRoot, { recursive: true, force: true });
      if (!this.db?.open) this.open();
    }

    return this.listSnapshots().find((snapshot) => snapshot.name === name) || { name };
  }

}

module.exports = { CrmDatabase, ENTITY_TYPES };
