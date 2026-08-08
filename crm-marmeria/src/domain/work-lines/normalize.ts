import { createId } from '../../utils/ids';
import { calculateWorkLine, numberValue, withCalculatedWorkLine } from './calculations';
import type {
  EdgeKey,
  EdgeSelection,
  ImportSource,
  MaterialPriceLike,
  WorkLine,
  WorkLineType,
} from './types';

const asText = (value: unknown): string => String(value ?? '').trim();

const stableId = (raw: any, index: number): string => (
  raw?.id == null || raw.id === '' ? `work-line-${index + 1}` : String(raw.id)
);

export const edgeDefaults = (
  lengthCm = 0,
  widthCm = 0,
): Partial<Record<EdgeKey, EdgeSelection>> => ({
  front: { active: false, lengthCm },
  back: { active: false, lengthCm },
  left: { active: false, lengthCm: widthCm },
  right: { active: false, lengthCm: widthCm },
  cornerRight: { active: false, lengthCm: 4 },
  cornerLeft: { active: false, lengthCm: 4 },
});

const normalizeEdge = (value: any, fallbackLength: number): EdgeSelection => ({
  active: Boolean(value?.active),
  catalogId: value?.catalogId == null || value.catalogId === '' ? undefined : String(value.catalogId),
  type: asText(value?.type),
  nameSnapshot: asText(value?.nameSnapshot || value?.name),
  lengthCm: value?.lengthCm != null
    ? numberValue(value.lengthCm)
    : value?.lengthMeters != null
      ? numberValue(value.lengthMeters) * 100
      : fallbackLength,
  lengthMeters: value?.lengthMeters == null ? undefined : numberValue(value.lengthMeters),
  unitPrice: value?.unitPrice == null && value?.priceSnapshot == null
    ? undefined
    : numberValue(value?.unitPrice ?? value?.priceSnapshot),
  priceSnapshot: value?.priceSnapshot == null && value?.unitPrice == null
    ? undefined
    : numberValue(value?.priceSnapshot ?? value?.unitPrice),
  materialId: value?.materialId == null || value.materialId === '' ? undefined : String(value.materialId),
});

const normalizeEdges = (raw: any, lengthCm: number, widthCm: number) => {
  const defaults = edgeDefaults(lengthCm, widthCm);
  const source = raw && typeof raw === 'object' ? raw : {};
  return Object.fromEntries((Object.keys(defaults) as EdgeKey[]).map((key) => [
    key,
    normalizeEdge(source[key], defaults[key]?.lengthCm || 0),
  ])) as Partial<Record<EdgeKey, EdgeSelection>>;
};

export const legacyItemToWorkLine = (item: any, index = 0): WorkLine => {
  const line: WorkLine = {
    id: stableId(item, index),
    type: 'manual',
    description: asText(item?.description || item?.name || 'Voce legacy'),
    quantity: Math.max(numberValue(item?.quantity ?? 1), 0),
    unit: asText(item?.unit || 'pz'),
    unitPrice: Math.max(numberValue(item?.unitPrice ?? item?.price), 0),
    extraCost: 0,
    total: 0,
    notes: asText(item?.notes),
    sortOrder: Number.isFinite(Number(item?.sortOrder)) ? Number(item.sortOrder) : index,
    taxRate: numberValue(item?.taxRate),
    taxNature: asText(item?.taxNature).toUpperCase(),
    materialId: item?.materialId == null || item.materialId === '' ? undefined : String(item.materialId),
    materialNameSnapshot: asText(item?.materialNameSnapshot || item?.materialName),
    importSource: item?.importSource,
  };
  return withCalculatedWorkLine(line);
};

export const normalizeWorkLine = (raw: any, index = 0): WorkLine => {
  const type: WorkLineType = ['surface', 'linear', 'manual'].includes(String(raw?.type))
    ? String(raw.type) as WorkLineType
    : 'manual';
  const lengthCm = Math.max(numberValue(raw?.lengthCm), 0);
  const widthCm = Math.max(numberValue(raw?.widthCm), 0);
  const line: WorkLine = {
    id: stableId(raw, index),
    type,
    description: asText(raw?.description || raw?.linearItemNameSnapshot || raw?.materialNameSnapshot || 'Voce lavorazione'),
    quantity: Math.max(numberValue(raw?.quantity ?? 1), 0),
    lengthCm: type === 'surface' ? lengthCm : undefined,
    widthCm: type === 'surface' ? widthCm : undefined,
    linearMeters: type === 'linear' ? Math.max(numberValue(raw?.linearMeters), 0) : undefined,
    squareMeters: type === 'surface' ? Math.max(numberValue(raw?.squareMeters), 0) : undefined,
    linearItemId: type === 'linear' && (raw?.linearItemId ?? raw?.linearCatalogId) != null
      && (raw?.linearItemId ?? raw?.linearCatalogId) !== ''
      ? String(raw.linearItemId ?? raw.linearCatalogId) : undefined,
    linearItemNameSnapshot: type === 'linear' ? asText(raw?.linearItemNameSnapshot || raw?.linearItemName) : undefined,
    materialId: raw?.materialId == null || raw.materialId === '' ? undefined : String(raw.materialId),
    materialNameSnapshot: asText(raw?.materialNameSnapshot || raw?.materialName),
    thickness: raw?.thickness == null || raw.thickness === '' ? undefined : raw.thickness,
    variant: asText(raw?.variant),
    unit: asText(raw?.unit || (type === 'surface' ? 'm²' : type === 'linear' ? 'ml' : 'pz')),
    unitPrice: Math.max(numberValue(raw?.unitPrice ?? raw?.price), 0),
    materialCost: Math.max(numberValue(raw?.materialCost), 0),
    edgeCost: Math.max(numberValue(raw?.edgeCost), 0),
    extraCost: Math.max(numberValue(raw?.extraCost), 0),
    total: Math.max(numberValue(raw?.total), 0),
    edges: type === 'surface' ? normalizeEdges(raw?.edges, lengthCm, widthCm) : undefined,
    notes: asText(raw?.notes),
    sortOrder: Number.isFinite(Number(raw?.sortOrder)) ? Number(raw.sortOrder) : index,
    taxRate: numberValue(raw?.taxRate),
    taxNature: asText(raw?.taxNature).toUpperCase(),
    importSource: raw?.importSource as ImportSource | undefined,
  };
  return withCalculatedWorkLine(line);
};

export const normalizeWorkLines = (raw: unknown, legacyItems?: unknown): WorkLine[] => {
  const source = Array.isArray(raw)
    ? raw
    : Array.isArray(legacyItems)
      ? legacyItems
      : [];
  return source
    .map((line, index) => normalizeWorkLine(line, index))
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((line, index) => ({ ...line, sortOrder: index }));
};

export const createWorkLine = (
  type: WorkLineType,
  material?: MaterialPriceLike,
  linearItem?: MaterialPriceLike,
): WorkLine => {
  const base: WorkLine = {
    id: createId(),
    type,
    description: type === 'manual' ? '' : asText(type === 'linear' ? linearItem?.name : material?.name),
    quantity: 1,
    lengthCm: type === 'surface' ? 0 : undefined,
    widthCm: type === 'surface' ? 0 : undefined,
    linearMeters: type === 'linear' ? 1 : undefined,
    linearItemId: type === 'linear' && linearItem?.id != null ? String(linearItem.id) : undefined,
    linearItemNameSnapshot: type === 'linear' ? asText(linearItem?.name) : undefined,
    materialId: material?.id == null ? undefined : String(material.id),
    materialNameSnapshot: asText(material?.name),
    thickness: material?.thickness,
    variant: asText(material?.variant),
    unit: type === 'surface' ? 'm²' : type === 'linear' ? asText(linearItem?.unit || 'ml') : 'pz',
    unitPrice: numberValue(type === 'linear' ? linearItem?.unitPrice ?? linearItem?.price : material?.unitPrice ?? material?.price),
    extraCost: 0,
    total: 0,
    edges: type === 'surface' ? edgeDefaults() : undefined,
    notes: '',
    sortOrder: 0,
  };
  return withCalculatedWorkLine(base);
};

export const workLineDescription = (line: WorkLine): string => {
  if (line.type === 'surface') {
    const dimensions = `${numberValue(line.lengthCm)} × ${numberValue(line.widthCm)} cm`;
    const area = `${numberValue(calculateWorkLine(line).squareMeters).toFixed(2)} m²`;
    return `${line.description || 'Lavorazione a superficie'} (${line.quantity} pz × ${dimensions}, ${area})`;
  }
  if (line.type === 'linear') {
    return `${line.description || 'Lavorazione lineare'} (${line.quantity} × ${numberValue(line.linearMeters)} ml)`;
  }
  return line.description || 'Voce manuale';
};

export const workLinesToDocumentItems = (
  lines: WorkLine[],
  invoice = false,
  existingItems: any[] = [],
) => normalizeWorkLines(lines).map((line, index) => ({
  description: workLineDescription(line),
  quantity: 1,
  unitPrice: numberValue(calculateWorkLine(line).total),
  taxRate: invoice ? numberValue(existingItems[index]?.taxRate ?? line.taxRate ?? 22) : 0,
  taxNature: invoice ? asText(existingItems[index]?.taxNature || line.taxNature).toUpperCase() : '',
  materialId: line.materialId || null,
  workLineId: line.id,
  workLineType: line.type,
  workLine: line,
}));
