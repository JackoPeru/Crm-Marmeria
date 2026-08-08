import type { EdgeCatalogItem, EdgeSelection } from './types';

const key = (value: unknown): string => String(value ?? '').trim().toLocaleLowerCase('it-IT');

const same = (left: unknown, right: unknown): boolean => (
  key(left) !== '' && key(left) === key(right)
);

export interface EdgeCatalogMatch {
  type?: string;
  materialId?: string | number;
  thickness?: string | number;
}

const sameType = (item: EdgeCatalogItem, match: EdgeCatalogMatch): boolean => {
  if (!match.type) return true;
  return same(item.id, match.type) || same(item.name, match.type);
};

const compatible = (item: EdgeCatalogItem, match: EdgeCatalogMatch): boolean => {
  const materialMatches = !key(item.materialId) || same(item.materialId, match.materialId);
  const thicknessMatches = !key(item.thickness) || same(item.thickness, match.thickness);
  return materialMatches && thicknessMatches;
};

export const uniqueEdgeCatalogItems = (catalog: EdgeCatalogItem[] = []): EdgeCatalogItem[] => {
  const seen = new Set<string>();
  return catalog.filter((item) => {
    if (item.active === false) return false;
    const identity = key(item.name || item.id);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
};

/** Select the most specific price for one edge type. */
export const selectEdgeCatalogItem = (
  catalog: EdgeCatalogItem[] = [],
  match: EdgeCatalogMatch = {},
): EdgeCatalogItem | undefined => {
  const candidates = catalog
    .filter((item) => item.active !== false && sameType(item, match) && compatible(item, match))
    .map((item, index) => {
      const hasMaterial = same(item.materialId, match.materialId);
      const hasThickness = same(item.thickness, match.thickness);
      const specificity = hasMaterial && hasThickness ? 4 : hasMaterial ? 3 : hasThickness ? 2 : 1;
      return { item, specificity, index };
    });
  return candidates
    .sort((left, right) => right.specificity - left.specificity || left.index - right.index)[0]?.item;
};

export const edgeSelectionFromCatalog = (
  catalog: EdgeCatalogItem[],
  match: EdgeCatalogMatch,
  fallback: Partial<EdgeSelection> = {},
): Partial<EdgeSelection> => {
  const selected = selectEdgeCatalogItem(catalog, match);
  const price = selected?.unitPrice ?? selected?.price ?? fallback.unitPrice ?? fallback.priceSnapshot ?? 0;
  return {
    ...fallback,
    catalogId: selected?.id == null ? undefined : String(selected.id),
    type: selected?.name || match.type || fallback.type,
    nameSnapshot: selected?.name || match.type || fallback.nameSnapshot,
    unitPrice: price,
    priceSnapshot: price,
    materialId: selected?.materialId,
  };
};

export const edgeCatalogLabel = (item: EdgeCatalogItem): string => [
  item.name,
  item.materialId ? `materiale ${item.materialId}` : 'generico',
  item.thickness ? `${item.thickness} mm` : '',
].filter(Boolean).join(' · ');
