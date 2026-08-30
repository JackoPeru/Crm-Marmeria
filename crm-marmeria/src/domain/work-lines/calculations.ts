import { parseLocaleNumber } from '../../utils/numbers';
import type {
  EdgeKey,
  EdgeSelection,
  WorkLine,
  WorkLineCalculation,
  WorkLinesSummary,
} from './types';

export const roundMoney = (value: number): number => (
  Math.round((Number(value) + Number.EPSILON) * 100) / 100
);

export const numberValue = (value: unknown): number => parseLocaleNumber(value);

const edgeLengthMeters = (edge: EdgeSelection | undefined): number => {
  if (!edge) return 0;
  if (edge.lengthCm != null) return numberValue(edge.lengthCm) / 100;
  return numberValue(edge.lengthMeters);
};

const edgeUnitPrice = (edge: EdgeSelection | undefined): number => (
  numberValue(edge?.unitPrice ?? edge?.priceSnapshot)
);

export const calculateEdge = (
  edge: EdgeSelection | undefined,
  quantity: unknown,
): number => {
  if (!edge?.active) return 0;
  return numberValue(quantity) * edgeLengthMeters(edge) * edgeUnitPrice(edge);
};

export const calculateWorkLine = (line: Partial<WorkLine>): WorkLineCalculation => {
  const quantity = numberValue(line.quantity || 0);
  const unitPrice = numberValue(line.unitPrice);
  const extraCost = numberValue(line.extraCost);
  let squareMeters = 0;
  let linearMeters = 0;
  let materialCost = 0;

  if (line.type === 'surface') {
    const singleSquareMeters = (numberValue(line.lengthCm) / 100)
      * (numberValue(line.widthCm) / 100);
    squareMeters = quantity * singleSquareMeters;
    materialCost = squareMeters * unitPrice;
  } else if (line.type === 'linear') {
    linearMeters = quantity * numberValue(line.linearMeters);
    materialCost = linearMeters * unitPrice;
  } else {
    materialCost = quantity * unitPrice;
  }

  const edgeCost = (Object.keys(line.edges || {}) as EdgeKey[])
    .reduce((sum, key) => sum + calculateEdge(line.edges?.[key], quantity), 0);

  return {
    squareMeters,
    linearMeters,
    materialCost,
    edgeCost,
    extraCost,
    total: materialCost + edgeCost + extraCost,
  };
};

export const withCalculatedWorkLine = (line: WorkLine): WorkLine => {
  const calculation = calculateWorkLine(line);
  return {
    ...line,
    squareMeters: line.type === 'surface' ? calculation.squareMeters : undefined,
    materialCost: calculation.materialCost,
    edgeCost: calculation.edgeCost,
    total: roundMoney(calculation.total),
  };
};

export const summarizeWorkLines = (lines: WorkLine[] = []): WorkLinesSummary => {
  const result = lines.reduce((summary, line) => {
    const calculation = calculateWorkLine(line);
    const isManual = line.type === 'manual';
    return {
      surfaceSquareMeters: summary.surfaceSquareMeters + calculation.squareMeters,
      linearMeters: summary.linearMeters + calculation.linearMeters,
      materialCost: summary.materialCost + (isManual ? 0 : calculation.materialCost),
      edgeCost: summary.edgeCost + calculation.edgeCost,
      manualOther: summary.manualOther + (isManual ? calculation.total : 0),
      subtotal: summary.subtotal + calculation.total,
      total: summary.total + calculation.total,
    };
  }, {
    surfaceSquareMeters: 0,
    linearMeters: 0,
    materialCost: 0,
    edgeCost: 0,
    manualOther: 0,
    subtotal: 0,
    total: 0,
  });

  return {
    surfaceSquareMeters: Number(result.surfaceSquareMeters.toFixed(4)),
    linearMeters: Number(result.linearMeters.toFixed(4)),
    materialCost: roundMoney(result.materialCost),
    edgeCost: roundMoney(result.edgeCost),
    manualOther: roundMoney(result.manualOther),
    subtotal: roundMoney(result.subtotal),
    total: roundMoney(result.total),
  };
};
