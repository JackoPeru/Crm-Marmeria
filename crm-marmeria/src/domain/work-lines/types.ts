export type WorkLineType = 'surface' | 'linear' | 'manual';

export type EdgeKey =
  | 'front'
  | 'back'
  | 'left'
  | 'right'
  | 'cornerRight'
  | 'cornerLeft';

export const EDGE_KEYS: EdgeKey[] = [
  'front',
  'back',
  'left',
  'right',
  'cornerRight',
  'cornerLeft',
];

export const EDGE_LABELS: Record<EdgeKey, string> = {
  front: 'Fronte',
  back: 'Retro',
  left: 'Sinistra',
  right: 'Destra',
  cornerRight: 'Angolo destro',
  cornerLeft: 'Angolo sinistro',
};

export interface ImportSource {
  sourceType: 'quote' | 'project' | 'invoice';
  sourceId: string;
  sourceVersion?: number;
  importedAt: string;
}

export interface EdgeSelection {
  active: boolean;
  catalogId?: string;
  type?: string;
  nameSnapshot?: string;
  lengthCm?: number;
  lengthMeters?: number;
  unitPrice?: number;
  priceSnapshot?: number;
  materialId?: string;
}

export interface WorkLine {
  id: string;
  type: WorkLineType;
  description?: string;
  quantity: number;
  lengthCm?: number;
  widthCm?: number;
  linearMeters?: number;
  squareMeters?: number;
  linearItemId?: string;
  linearItemNameSnapshot?: string;
  materialId?: string;
  materialNameSnapshot?: string;
  thickness?: number | string;
  variant?: string;
  unit?: string;
  unitPrice: number;
  materialCost?: number;
  edgeCost?: number;
  extraCost?: number;
  total: number;
  edges?: Partial<Record<EdgeKey, EdgeSelection>>;
  notes?: string;
  sortOrder: number;
  taxRate?: number;
  taxNature?: string;
  importSource?: ImportSource;
}

export interface WorkLineCalculation {
  squareMeters: number;
  linearMeters: number;
  materialCost: number;
  edgeCost: number;
  extraCost: number;
  total: number;
}

export interface WorkLinesSummary {
  surfaceSquareMeters: number;
  linearMeters: number;
  materialCost: number;
  edgeCost: number;
  manualOther: number;
  subtotal: number;
  total: number;
}

export interface MaterialPriceLike {
  id?: string | number;
  name?: string;
  unit?: string;
  unitPrice?: number | string;
  price?: number | string;
  thickness?: number | string;
  variant?: string;
}

export interface EdgeCatalogItem {
  id: string;
  name: string;
  unitPrice?: number;
  price?: number;
  materialId?: string;
  thickness?: number | string;
  active?: boolean;
  version?: number;
}

export interface LinearCatalogItem {
  id: string;
  name: string;
  unit?: string;
  unitPrice?: number;
  price?: number;
  materialId?: string;
  thickness?: number | string;
  variant?: string;
  active?: boolean;
  version?: number;
}
