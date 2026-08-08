import { describe, expect, it } from 'vitest';
import { edgeSelectionFromCatalog, selectEdgeCatalogItem, uniqueEdgeCatalogItems } from './edgeSelector';

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
});
