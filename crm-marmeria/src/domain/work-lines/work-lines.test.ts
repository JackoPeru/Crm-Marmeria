import { describe, expect, it } from 'vitest';
import { calculateWorkLine, roundMoney, summarizeWorkLines } from './calculations';
import { copyWorkLines, mergeImportedWorkLines } from './import';
import { legacyItemToWorkLine, normalizeWorkLines } from './normalize';
import { validateWorkLines } from './validation';

describe('WorkLine calculations', () => {
  it('calcola superficie, materiale e quattro bordi', () => {
    const line = normalizeWorkLines([{
      type: 'surface', quantity: '3', lengthCm: '120', widthCm: '30', unitPrice: '150',
      edges: {
        front: { active: true, lengthCm: 120, unitPrice: 20 },
        back: { active: true, lengthCm: 120, unitPrice: 20 },
        left: { active: true, lengthCm: 30, unitPrice: 20 },
        right: { active: true, lengthCm: 30, unitPrice: 20 },
      },
    }])[0];
    const result = calculateWorkLine(line);
    expect(result.squareMeters).toBeCloseTo(1.08, 8);
    expect(result.materialCost).toBeCloseTo(162, 8);
    expect(result.edgeCost).toBeCloseTo(180, 8);
    expect(result.total).toBeCloseTo(342, 8);
  });

  it('accetta virgola italiana e linee miste', () => {
    const lines = normalizeWorkLines([
      { type: 'surface', quantity: '2', lengthCm: '120,5', widthCm: '30', unitPrice: '150,00' },
      { type: 'linear', quantity: '2', linearMeters: '1,5', unitPrice: '20' },
      { description: 'Posa', quantity: '1', unitPrice: '50,50' },
    ]);
    const summary = summarizeWorkLines(lines);
    expect(summary.surfaceSquareMeters).toBeCloseTo(0.723, 5);
    expect(summary.linearMeters).toBeCloseTo(3, 8);
    expect(summary.total).toBe(218.95);
  });

  it('normalizza voce legacy come manuale senza inventare misure', () => {
    const line = legacyItemToWorkLine({ description: 'Vecchia voce', quantity: 2, unitPrice: 12.5 });
    expect(line.type).toBe('manual');
    expect(line.lengthCm).toBeUndefined();
    expect(line.total).toBe(25);
  });

  it('calcola un pezzo, solo i bordi attivi e arrotonda il denaro', () => {
    const line = normalizeWorkLines([{
      type: 'surface', quantity: 1, lengthCm: 100, widthCm: 50, unitPrice: 10.005,
      edges: { front: { active: true, lengthCm: 100, unitPrice: 0.1 }, back: { active: false, lengthCm: 100, unitPrice: 50 } },
    }])[0];
    expect(calculateWorkLine(line).edgeCost).toBeCloseTo(0.1, 8);
    expect(line.total).toBe(5.1);
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
  });
});

describe('WorkLine compatibility and import', () => {
  it('normalizza in modo idempotente e copia con provenienza indipendente', () => {
    const source = normalizeWorkLines([{ id: 'a', type: 'manual', description: 'A', quantity: 1, unitPrice: 10 }]);
    const again = normalizeWorkLines(source);
    const copy = copyWorkLines(source, 'quote', 'q-1', 4);
    expect(again).toEqual(source);
    expect(copy[0].id).not.toBe(source[0].id);
    expect(copy[0].importSource).toMatchObject({ sourceType: 'quote', sourceId: 'q-1', sourceVersion: 4 });
    expect(source[0].description).toBe('A');
  });

  it('mantiene separati catalogo lineare e materiale nel round-trip', () => {
    const line = normalizeWorkLines([{
      type: 'linear', quantity: 1, linearMeters: '2,5', linearItemId: 'li-1', linearItemNameSnapshot: 'Alzatina',
      materialId: 'mat-1', materialNameSnapshot: 'Marmo', thickness: '3', variant: 'Lucido', unitPrice: '12,50',
    }])[0];
    const roundTrip = normalizeWorkLines([line])[0];
    expect(roundTrip).toMatchObject({ linearItemId: 'li-1', linearItemNameSnapshot: 'Alzatina', materialId: 'mat-1', materialNameSnapshot: 'Marmo', unitPrice: 12.5 });
  });

  it('duplica senza condividere bordi e conserva il riordino', () => {
    const existing = normalizeWorkLines([
      { id: 'seconda', type: 'surface', quantity: 1, lengthCm: 100, widthCm: 50, unitPrice: 10, sortOrder: 1, edges: { front: { active: true, lengthCm: 100, unitPrice: 2 } } },
      { id: 'prima', type: 'manual', description: 'Prima', quantity: 1, unitPrice: 5, sortOrder: 0 },
    ]);
    const copy = copyWorkLines(existing, 'quote', 'q-2');
    copy[1].edges!.front!.unitPrice = 99;
    expect(existing.map((line) => line.id)).toEqual(['prima', 'seconda']);
    expect(existing[1].edges?.front?.unitPrice).toBe(2);
    expect(copy.map((line) => line.sortOrder)).toEqual([0, 1]);
  });

  it('supporta replace, add e cancel espliciti', () => {
    const existing = normalizeWorkLines([{ id: 'a', description: 'A', quantity: 1, unitPrice: 10 }]);
    const imported = normalizeWorkLines([{ id: 'b', description: 'B', quantity: 1, unitPrice: 20 }]);
    expect(mergeImportedWorkLines(existing, imported, 'replace').map((line) => line.description)).toEqual(['B']);
    expect(mergeImportedWorkLines(existing, imported, 'add').map((line) => line.description)).toEqual(['A', 'B']);
    expect(mergeImportedWorkLines(existing, imported, 'cancel')).toEqual(existing);
  });

  it('segnala misure incomplete', () => {
    expect(validateWorkLines([{ type: 'surface', quantity: 1, lengthCm: 0, widthCm: 20, unitPrice: 10 }])).toHaveLength(1);
  });
});
