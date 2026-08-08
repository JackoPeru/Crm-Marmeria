import { describe, expect, it } from 'vitest';
import { edgeSelectionFromCatalog, refreshCatalogEdgePrices, selectEdgeCatalogItem, uniqueEdgeCatalogItems } from './edgeSelector';

describe('edge catalog specificity', () => {
  const catalog = [
    { id: 'wrong-material', name: 'Lucido', materialId: 'marmo-2', thickness: '9', unitPrice: 99 },
    { id: 'generic', name: 'Lucido', unitPrice: 10 },
    { id: 'thickness', name: 'Lucido', thickness: '3', unitPrice: 12 },
    { id: 'material', name: 'Lucido', materialId: 'marmo-1', unitPrice: 14 },
    { id: 'exact', name: 'Lucido', materialId: 'marmo-1', thickness: '3', unitPrice: 18 },
  ];

  it('prefers material plus thickness, then material, thickness and generic', () => {
    expect(selectEdgeCatalogItem(catalog, { type: 'Lucido', materialId: 'marmo-1', thickness: '3' })?.id).toBe('exact');
    expect(selectEdgeCatalogItem(catalog, { type: 'Lucido', materialId: 'marmo-1', thickness: '5' })?.id).toBe('material');
    expect(selectEdgeCatalogItem(catalog, { type: 'Lucido', materialId: 'marmo-2', thickness: '3' })?.id).toBe('thickness');
    expect(selectEdgeCatalogItem(catalog, { type: 'Lucido', materialId: 'marmo-2', thickness: '5' })?.id).toBe('generic');
  });

  it('ignora il materiale incompatibile anche quando precede il generico', () => {
    expect(selectEdgeCatalogItem(catalog.slice(0, 2), { type: 'Lucido', materialId: 'marmo-1', thickness: '5' })?.id).toBe('generic');
  });

  it('mostra un solo tipo per nome', () => {
    expect(uniqueEdgeCatalogItems(catalog).map((item) => item.name)).toEqual(['Lucido']);
  });

  it('salva lo snapshot del match piu specifico', () => {
    expect(edgeSelectionFromCatalog(catalog, { type: 'Lucido', materialId: 'marmo-1', thickness: '3' })).toMatchObject({ catalogId: 'exact', type: 'Lucido', nameSnapshot: 'Lucido', unitPrice: 18, priceSnapshot: 18 });
  });

  it('simula la scelta del nome e ignora il primo record incompatibile', () => {
    const selectedName = uniqueEdgeCatalogItems(catalog)[0].name;
    expect(edgeSelectionFromCatalog(catalog, { type: selectedName, materialId: 'marmo-1', thickness: '3' })).toMatchObject({
      catalogId: 'exact',
      type: selectedName,
      unitPrice: 18,
      priceSnapshot: 18,
    });
  });

  it('aggiorna solo gli edge collegati al catalogo nel draft corrente', () => {
    const lines = [{
      id: 'line-1',
      type: 'surface' as const,
      quantity: 1,
      lengthCm: 100,
      widthCm: 50,
      unitPrice: 100,
      total: 0,
      edges: {
        front: { active: true, catalogId: 'exact', unitPrice: 18, priceSnapshot: 18, lengthCm: 100 },
        back: { active: true, unitPrice: 7, priceSnapshot: 7, lengthCm: 100 },
      },
      sortOrder: 0,
    }];
    const refreshed = refreshCatalogEdgePrices(lines, catalog.map((item) => item.id === 'exact' ? { ...item, unitPrice: 25 } : item));
    expect(refreshed[0].edges?.front?.unitPrice).toBe(25);
    expect(refreshed[0].edges?.front?.priceSnapshot).toBe(25);
    expect(refreshed[0].edges?.back?.unitPrice).toBe(7);
  });
});
