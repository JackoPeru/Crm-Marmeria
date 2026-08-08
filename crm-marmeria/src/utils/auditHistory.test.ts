import { describe, expect, it } from 'vitest';
import { formatAuditItem } from './auditHistory';

describe('formatAuditItem', () => {
  it('descrive campi preventivo e validità senza scadenza in italiano', () => {
    const result = formatAuditItem({
      id: 'audit-1',
      entityType: 'quote',
      action: 'update',
      username: 'mario',
      createdAt: '2026-08-08T10:00:00.000Z',
      previous: { status: 'Bozza', validityDays: '', workLines: [] },
      next: { status: 'Inviato', validityDays: 30, workLines: [] },
    });
    const text = result.changes.map((change) => [change.label, change.before, change.after].join(' ')).join(' ');
    expect(result.summary).toContain('mario ha modificato preventivo');
    expect(text).toContain('Stato');
    expect(text).toContain('Bozza');
    expect(text).toContain('Inviato');
    expect(text).toContain('Senza scadenza');
    expect(text).toContain('30 giorni');
  });

  it('descrive righe, dimensioni, extra e bordi senza chiavi tecniche', () => {
    const result = formatAuditItem({
      id: 'audit-2',
      entityType: 'quote',
      action: 'update',
      createdAt: '2026-08-08T10:00:00.000Z',
      previous: {
        workLines: [{
          id: 'line-1',
          type: 'surface',
          description: 'Top cucina',
          quantity: 1,
          lengthCm: 100,
          widthCm: 50,
          unitPrice: 120,
          extraCost: 10,
          edges: { front: { active: true, type: 'Lucido', lengthCm: 100, unitPrice: 18 } },
        }],
      },
      next: {
        workLines: [{
          id: 'line-1',
          type: 'surface',
          description: 'Top cucina',
          quantity: 1,
          lengthCm: 120,
          widthCm: 50,
          unitPrice: 120,
          extraCost: 25,
          edges: { front: { active: false, type: 'Spazzolato', lengthCm: 120, unitPrice: 20 } },
        }],
      },
    });
    const text = result.changes.map((change) => [change.label, change.before, change.after].join(' ')).join(' ');
    expect(text).toContain('Dimensioni');
    expect(text).toContain('Extra riga');
    expect(text).toContain('Fronte');
    expect(text).toContain('Attivo');
    expect(text).toContain('Tipo');
    expect(text).toContain('Prezzo');
    expect(text).not.toContain('workLines');
    expect(text).not.toContain('subtotal');
  });

  it('riassume creazione con riga aggiunta e sopprime rumore derivato', () => {
    const result = formatAuditItem({
      id: 'audit-3',
      entityType: 'quote',
      action: 'create',
      createdAt: '2026-08-08T10:00:00.000Z',
      next: {
        date: '2026-08-08',
        subtotal: 100,
        amount: 100,
        workLines: [{ id: 'line-1', type: 'linear', description: 'Trasporto', quantity: 1, linearMeters: 2, unitPrice: 100 }],
      },
    });
    const text = result.changes.map((change) => [change.label, change.after].join(' ')).join(' ');
    expect(text).toContain('Data');
    expect(text).toContain('Riga 1 aggiunta');
    expect(text).toContain('Metri lineari');
    expect(text).toContain('2');
    expect(text).not.toContain('subtotal');
    expect(text).not.toContain('amount');
  });

  it('traduce le azioni di import senza mostrare il codice azione', () => {
    const result = formatAuditItem({
      id: 'audit-4',
      entityType: 'material',
      action: 'import.excel',
      username: 'mario',
      createdAt: '2026-08-08T10:00:00.000Z',
      next: { name: 'Carrara', unitPrice: 120 },
    });
    expect(result.summary).toContain('ha importato materiale');
    expect(result.summary).not.toContain('import.excel');
  });
});
