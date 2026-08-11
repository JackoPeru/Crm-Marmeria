import { parseLocaleNumber } from './numbers';

export interface AuditItem {
  id: string;
  entityType?: string;
  username?: string;
  action: string;
  previous?: Record<string, any> | null;
  next?: Record<string, any> | null;
  createdAt: string;
}

export interface AuditChange {
  label: string;
  before?: string;
  after?: string;
}

export interface FormattedAuditItem {
  summary: string;
  changes: AuditChange[];
}

const euro = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const number = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 3 });
const date = new Intl.DateTimeFormat('it-IT');

const entityLabels: Record<string, string> = {
  client: 'cliente',
  supplier: 'fornitore',
  material: 'materiale',
  edge_type: 'voce del catalogo bordi',
  linear_item: 'voce del catalogo lavorazioni lineari',
  project: 'progetto',
  quote: 'preventivo',
  quote_template: 'modello preventivo',
  invoice: 'fattura',
  payment: 'incasso',
  order: 'ordine di lavorazione',
  purchase_order: 'ordine fornitore',
  delivery_note: 'DDT',
  service_case: 'caso assistenza',
  message_draft: 'bozza messaggio',
  appointment: 'appuntamento',
  database: 'archivio',
};

const actionLabels: Record<string, string> = {
  create: 'ha creato',
  update: 'ha modificato',
  delete: 'ha eliminato',
  'import.excel': 'ha importato',
  'attachment.add': 'ha aggiunto un allegato a',
  'attachment.update': 'ha modificato un allegato di',
  'attachment.delete': 'ha eliminato un allegato da',
  'restore.json': 'ha ripristinato',
  'restore.snapshot': 'ha ripristinato',
};

const fieldLabels: Record<string, string> = {
  name: 'Nome',
  title: 'Titolo',
  description: 'Descrizione',
  date: 'Data',
  dueDate: 'Scadenza pagamento',
  validityDays: 'Validità preventivo',
  status: 'Stato',
  notes: 'Note',
  customerId: 'Cliente',
  clientId: 'Cliente',
  supplierId: 'Fornitore',
  projectId: 'Progetto',
  quoteId: 'Preventivo collegato',
  templateId: 'Modello Word',
  quoteNumber: 'Numero preventivo',
  invoiceNumber: 'Numero fattura',
  paymentMethod: 'Metodo pagamento',
  paymentDetails: 'Dettagli pagamento',
  category: 'Categoria',
  supplier: 'Fornitore',
  unit: 'Unità',
  stockQuantity: 'Quantità in stock',
  minStockLevel: 'Livello minimo',
  thickness: 'Spessore',
  variant: 'Variante / finitura',
  unitPrice: 'Prezzo unitario',
  price: 'Prezzo',
  taxRate: 'IVA',
  taxNature: 'Natura IVA',
  active: 'Attivo',
  extraCost: 'Extra prodotti esterni / posa / manodopera',
};

const edgeLabels: Record<string, string> = {
  front: 'Fronte',
  back: 'Retro',
  left: 'Sinistra',
  right: 'Destra',
  cornerRight: 'Angolo destro',
  cornerLeft: 'Angolo sinistro',
};

const lineFieldLabels: Record<string, string> = {
  description: 'Descrizione',
  type: 'Tipo lavorazione',
  quantity: 'Quantità',
  materialNameSnapshot: 'Materiale',
  materialId: 'Materiale',
  thickness: 'Spessore',
  variant: 'Variante / finitura',
  unit: 'Unità',
  unitPrice: 'Prezzo unitario',
  extraCost: 'Extra prodotti esterni / posa / manodopera',
  notes: 'Note',
  taxRate: 'IVA',
  taxNature: 'Natura IVA',
};

const ignoredKeys = new Set([
  'id',
  'entityType',
  'type',
  'version',
  'sortOrder',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'timestamp',
  'items',
  'workLines',
  'catalogId',
  'priceSnapshot',
  'subtotal',
  'amount',
  'taxTotal',
  'materialCost',
  'edgeCost',
  'squareMeters',
  'nameSnapshot',
  'linearItemNameSnapshot',
  'importSource',
]);

const moneyKeys = new Set([
  'unitPrice',
  'price',
  'priceSnapshot',
  'extraCost',
  'subtotal',
  'amount',
  'taxTotal',
  'total',
]);

const dateKeys = new Set(['date', 'dueDate', 'validUntil', 'deadline', 'endDate', 'startAt', 'endAt', 'startedAt', 'completedAt', 'importedAt']);
const referenceKeys = new Set(['customerId', 'clientId', 'supplierId', 'projectId', 'quoteId', 'templateId', 'materialId', 'linearItemId']);

const sameValue = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const present = (value: unknown): boolean => value !== undefined && value !== null && String(value).trim() !== '';

const prettyKey = (key: string): string => key
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .replace(/[_-]+/g, ' ')
  .replace(/^./, (value) => value.toUpperCase());

export const labelForAuditField = (key: string): string => fieldLabels[key] || prettyKey(key);

const formatDateValue = (value: unknown): string => {
  if (!present(value)) return 'vuoto';
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
    ? new Date(String(value) + 'T00:00:00')
    : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : date.format(parsed);
};

export const formatAuditValue = (value: unknown, key = ''): string => {
  if (key === 'validityDays') {
    const days = Number(value);
    return Number.isInteger(days) && days > 0 ? String(days) + ' giorni' : 'Senza scadenza';
  }
  if (!present(value)) return 'vuoto';
  if (referenceKeys.has(key)) return 'collegato';
  if (dateKeys.has(key)) return formatDateValue(value);
  if (typeof value === 'boolean') return value ? 'Sì' : 'No';
  if (moneyKeys.has(key)) return euro.format(parseLocaleNumber(value));
  if (typeof value === 'number') return number.format(value);
  if (Array.isArray(value)) return value.length ? String(value.length) + ' elementi' : 'vuoto';
  if (typeof value === 'object') return 'dati strutturati';
  return String(value);
};

const referenceChange = (label: string, before: unknown, after: unknown): AuditChange => ({
  label: label + ' collegato modificato',
  before: present(before) ? 'collegamento precedente' : 'vuoto',
  after: present(after) ? 'nuovo collegamento' : 'vuoto',
});

const lineTypeValue = (value: unknown): string => ({
  surface: 'Superficie (m²)',
  linear: 'Lavorazione lineare',
  manual: 'Manuale',
}[String(value)] || formatAuditValue(value, 'type'));

const lineMaterial = (line: Record<string, any>): unknown => (
  present(line.materialNameSnapshot) ? line.materialNameSnapshot : line.materialId
);

const lineDimensions = (line: Record<string, any>): string => {
  const length = formatAuditValue(line.lengthCm);
  const width = formatAuditValue(line.widthCm);
  return length === 'vuoto' && width === 'vuoto'
    ? 'vuoto'
    : String(length) + ' × ' + String(width) + ' cm';
};

const lineFieldValue = (line: Record<string, any>, key: string): string => {
  if (key === 'type') return lineTypeValue(line[key]);
  if (key === 'materialNameSnapshot' || key === 'materialId') {
    return present(line.materialNameSnapshot)
      ? formatAuditValue(line.materialNameSnapshot, 'materialNameSnapshot')
      : formatAuditValue(line.materialId, 'materialId');
  }
  return formatAuditValue(line[key], key);
};

const pushChange = (changes: AuditChange[], label: string, before: unknown, after: unknown, key = '') => {
  const oldValue = formatAuditValue(before, key);
  const newValue = formatAuditValue(after, key);
  if (oldValue !== newValue) changes.push({ label, before: oldValue, after: newValue });
};

const edgeValue = (edge: Record<string, any> | undefined, key: string): unknown => {
  if (!edge) return undefined;
  if (key === 'type') return edge.nameSnapshot || edge.type;
  if (key === 'length') {
    if (edge.lengthMeters != null) return Number(edge.lengthMeters);
    if (edge.lengthCm != null) return Number(edge.lengthCm) / 100;
  }
  if (key === 'price') return edge.unitPrice ?? edge.priceSnapshot;
  return edge[key];
};

const edgeValueFormatted = (edge: Record<string, any> | undefined, key: string): string => {
  if (key === 'type') {
    if (edge?.catalogId && !present(edge.nameSnapshot)) return 'collegato';
    return formatAuditValue(edgeValue(edge, key), 'nameSnapshot');
  }
  if (key === 'length') {
    const value = edgeValue(edge, key);
    return present(value) ? number.format(Number(value)) + ' m' : 'vuoto';
  }
  if (key === 'price') {
    const value = edgeValue(edge, key);
    return present(value) ? euro.format(Number(value)) + '/ml' : 'vuoto';
  }
  return formatAuditValue(edgeValue(edge, key), key);
};

const edgeChanges = (
  changes: AuditChange[],
  previous: Record<string, any> | undefined,
  next: Record<string, any> | undefined,
  lineNumber: number,
  edgeKey: string,
) => {
  const edgeName = edgeLabels[edgeKey] || 'Bordo';
  const prefix = 'Riga ' + lineNumber + ' · ' + edgeName;
  if (!previous && next) {
    changes.push({ label: prefix + ' · bordo aggiunto', after: edgeSummary(next) });
    return;
  }
  if (previous && !next) {
    changes.push({ label: prefix + ' · bordo rimosso', before: edgeSummary(previous) });
    return;
  }
  if (!previous && !next) return;
  const fields: Array<[string, string]> = [['active', 'Attivo'], ['type', 'Tipo'], ['length', 'Lunghezza'], ['price', 'Prezzo']];
  fields.forEach(([key, label]) => {
    const oldValue = edgeValueFormatted(previous, key);
    const newValue = edgeValueFormatted(next, key);
    if (oldValue !== newValue) changes.push({ label: prefix + ' · ' + label, before: oldValue, after: newValue });
  });
};

const edgeSummary = (edge: Record<string, any>): string => [
  'attivo: ' + edgeValueFormatted(edge, 'active'),
  'tipo: ' + edgeValueFormatted(edge, 'type'),
  'lunghezza: ' + edgeValueFormatted(edge, 'length'),
  'prezzo: ' + edgeValueFormatted(edge, 'price'),
].join('; ');

const workLineKey = (line: Record<string, any> | undefined, index: number): string => (
  line?.id == null || line.id === '' ? 'index:' + index : 'id:' + String(line.id)
);

const workLineSummary = (line: Record<string, any>): string => {
  const description = String(line.description || line.linearItemNameSnapshot || line.materialNameSnapshot || 'Senza descrizione');
  return description + ' · ' + lineTypeValue(line.type);
};

const workLineChanges = (
  changes: AuditChange[],
  previousLines: Record<string, any>[],
  nextLines: Record<string, any>[],
) => {
  const previousByKey = new Map(previousLines.map((line, index) => [workLineKey(line, index), { line, index }]));
  const nextByKey = new Map(nextLines.map((line, index) => [workLineKey(line, index), { line, index }]));
  const keys = [...new Set([...previousByKey.keys(), ...nextByKey.keys()])];
  keys.forEach((key) => {
    const before = previousByKey.get(key);
    const after = nextByKey.get(key);
    const lineNumber = (after || before)?.index == null ? 1 : (after || before)!.index + 1;
    if (!before && after) {
      changes.push({ label: 'Riga ' + lineNumber + ' aggiunta', after: workLineSummary(after.line) });
    } else if (before && !after) {
      changes.push({ label: 'Riga ' + lineNumber + ' rimossa', before: workLineSummary(before.line) });
    }
    if (!before || !after) {
      const line = after?.line || before?.line;
      if (line) {
        const detailKeys = ['description', 'type', 'quantity', 'materialNameSnapshot', 'thickness', 'variant', 'unit', 'unitPrice', 'extraCost', 'notes'];
        detailKeys.forEach((field) => {
          if (field === 'materialNameSnapshot' && present(line.materialNameSnapshot) === false && !present(line.materialId)) return;
          const label = 'Riga ' + lineNumber + ' · ' + lineFieldLabels[field];
          changes.push(after
            ? { label, after: lineFieldValue(line, field) }
            : { label, before: lineFieldValue(line, field) });
        });
        if (line.type === 'surface' || 'lengthCm' in line || 'widthCm' in line) {
          changes.push(after
            ? { label: 'Riga ' + lineNumber + ' · Dimensioni', after: lineDimensions(line) }
            : { label: 'Riga ' + lineNumber + ' · Dimensioni', before: lineDimensions(line) });
        }
        if (line.type === 'linear' || 'linearMeters' in line) {
          changes.push(after
            ? { label: 'Riga ' + lineNumber + ' · Metri lineari', after: formatAuditValue(line.linearMeters) }
            : { label: 'Riga ' + lineNumber + ' · Metri lineari', before: formatAuditValue(line.linearMeters) });
        }
        Object.entries(line.edges || {}).forEach(([edgeKey, edge]) => {
          if (edge) {
            const label = 'Riga ' + lineNumber + ' · ' + (edgeLabels[edgeKey] || 'Bordo') + ' · dettaglio';
            changes.push(after ? { label, after: edgeSummary(edge) } : { label, before: edgeSummary(edge) });
          }
        });
      }
      return;
    }
    const dimensionChanged = !sameValue(before.line.lengthCm, after.line.lengthCm)
      || !sameValue(before.line.widthCm, after.line.widthCm);
    if (dimensionChanged) changes.push({ label: 'Riga ' + lineNumber + ' · Dimensioni', before: lineDimensions(before.line), after: lineDimensions(after.line) });
    const fields = ['description', 'type', 'quantity', 'linearMeters', 'linearItemId', 'materialNameSnapshot', 'materialId', 'thickness', 'variant', 'unit', 'unitPrice', 'extraCost', 'notes', 'taxRate', 'taxNature'];
    fields.forEach((field) => {
      if (field === 'materialId' && (present(before.line.materialNameSnapshot) || present(after.line.materialNameSnapshot))) return;
      if (field === 'materialNameSnapshot' && !present(lineMaterial(before.line)) && !present(lineMaterial(after.line))) return;
      const beforeValue = field === 'materialNameSnapshot' ? lineMaterial(before.line) : before.line[field];
      const afterValue = field === 'materialNameSnapshot' ? lineMaterial(after.line) : after.line[field];
      if (!sameValue(beforeValue, afterValue)) {
        const label = 'Riga ' + lineNumber + ' · ' + (field === 'linearMeters' ? 'Metri lineari' : field === 'linearItemId' ? 'Voce lavorazione' : lineFieldLabels[field]);
        changes.push(referenceKeys.has(field)
          ? referenceChange(label, beforeValue, afterValue)
          : { label, before: lineFieldValue(before.line, field), after: lineFieldValue(after.line, field) });
      }
    });
    const edgeKeys = [...new Set([...Object.keys(before.line.edges || {}), ...Object.keys(after.line.edges || {})])];
    edgeKeys.forEach((edgeKey) => edgeChanges(changes, before.line.edges?.[edgeKey], after.line.edges?.[edgeKey], lineNumber, edgeKey));
  });
};

const itemChanges = (changes: AuditChange[], previousItems: Record<string, any>[], nextItems: Record<string, any>[]) => {
  const size = Math.max(previousItems.length, nextItems.length);
  for (let index = 0; index < size; index += 1) {
    const before = previousItems[index];
    const after = nextItems[index];
    const prefix = 'Voce ' + (index + 1);
    const detailFields = ['description', 'quantity', 'unitPrice', 'taxRate'];
    if (!before && after) {
      changes.push({ label: prefix + ' aggiunta', after: String(after.description || 'Senza descrizione') });
      detailFields.forEach((key) => {
        if (present(after[key])) changes.push({ label: prefix + ' · ' + labelForAuditField(key), after: formatAuditValue(after[key], key) });
      });
    }
    if (before && !after) {
      changes.push({ label: prefix + ' rimossa', before: String(before.description || 'Senza descrizione') });
      detailFields.forEach((key) => {
        if (present(before[key])) changes.push({ label: prefix + ' · ' + labelForAuditField(key), before: formatAuditValue(before[key], key) });
      });
    }
    if (!before || !after) continue;
    [['description', 'Descrizione'], ['quantity', 'Quantità'], ['unitPrice', 'Prezzo unitario'], ['taxRate', 'IVA']].forEach(([key, label]) => {
      if (!sameValue(before[key], after[key])) changes.push({ label: prefix + ' · ' + label, before: formatAuditValue(before[key], key), after: formatAuditValue(after[key], key) });
    });
  }
};

const ordinaryChanges = (previous: Record<string, any>, next: Record<string, any>, includeAll = false): AuditChange[] => {
  const changes: AuditChange[] = [];
  const direction = includeAll && Object.keys(next).length === 0 ? 'before' : 'after';
  const source = direction === 'before' ? previous : next;
  const keys = includeAll ? Object.keys(source) : [...new Set([...Object.keys(previous), ...Object.keys(next)])];
  const hasWorkLines = Array.isArray(previous.workLines) || Array.isArray(next.workLines);
  keys.forEach((key) => {
    if (ignoredKeys.has(key) || (key === 'total' && hasWorkLines)) return;
    if (!includeAll && !sameValue(previous[key], next[key])) {
      changes.push(referenceKeys.has(key)
        ? referenceChange(labelForAuditField(key), previous[key], next[key])
        : { label: labelForAuditField(key), before: formatAuditValue(previous[key], key), after: formatAuditValue(next[key], key) });
    } else if (includeAll && present(source[key]) && !Array.isArray(source[key]) && typeof source[key] !== 'object') {
      const formatted = formatAuditValue(source[key], key);
      changes.push(direction === 'before'
        ? { label: labelForAuditField(key), before: formatted }
        : { label: labelForAuditField(key), after: formatted });
    }
  });
  if (!hasWorkLines && (Array.isArray(previous.items) || Array.isArray(next.items))) {
    itemChanges(changes, previous.items || [], next.items || []);
  }
  if (hasWorkLines) workLineChanges(changes, previous.workLines || [], next.workLines || []);
  return changes;
};

export const formatAuditItem = (item: AuditItem): FormattedAuditItem => {
  const entity = entityLabels[item.entityType || ''] || 'record';
  const actor = item.username || 'Sistema';
  const verb = actionLabels[item.action] || ('ha eseguito ' + item.action);
  const summary = actor + ' ' + verb + ' ' + entity;
  if (item.action === 'update') {
    const changes = ordinaryChanges(item.previous || {}, item.next || {});
    return { summary, changes };
  }
  if (item.action === 'create') {
    return { summary, changes: ordinaryChanges({}, item.next || {}, true) };
  }
  if (item.action === 'delete') {
    return { summary, changes: ordinaryChanges(item.previous || {}, {}, true) };
  }
  return { summary, changes: [] };
};
