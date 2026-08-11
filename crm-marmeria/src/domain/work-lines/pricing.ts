import { parseLocaleNumber } from '../../utils/numbers';
import type { MaterialPriceLike } from './types';

/** Il listino contiene il costo acquisto; il nuovo prezzo cliente parte da costo x 2. */
export const MATERIAL_CUSTOMER_MARKUP = 2;

export const materialListPrice = (material?: MaterialPriceLike): number => (
  Math.max(parseLocaleNumber(material?.unitPrice ?? material?.price), 0)
);

export const customerMaterialUnitPrice = (material?: MaterialPriceLike): number => (
  Math.round((materialListPrice(material) * MATERIAL_CUSTOMER_MARKUP + Number.EPSILON) * 100) / 100
);
