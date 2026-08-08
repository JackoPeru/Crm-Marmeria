import { calculateWorkLine, numberValue } from './calculations';
import { normalizeWorkLines } from './normalize';
import type { WorkLine } from './types';

export interface WorkLineValidationError {
  index: number;
  field: string;
  message: string;
}

export const validateWorkLine = (
  line: WorkLine,
  index: number,
): WorkLineValidationError[] => {
  const errors: WorkLineValidationError[] = [];
  if (!Number.isFinite(numberValue(line.quantity)) || numberValue(line.quantity) <= 0) {
    errors.push({ index, field: 'quantity', message: 'La quantità deve essere maggiore di zero' });
  }
  if (line.type === 'surface') {
    if (numberValue(line.lengthCm) <= 0) errors.push({ index, field: 'lengthCm', message: 'Inserire una lunghezza valida' });
    if (numberValue(line.widthCm) <= 0) errors.push({ index, field: 'widthCm', message: 'Inserire una larghezza valida' });
  }
  if (line.type === 'linear' && numberValue(line.linearMeters) <= 0) {
    errors.push({ index, field: 'linearMeters', message: 'Inserire metri lineari validi' });
  }
  if (line.type === 'manual' && !String(line.description || '').trim()) {
    errors.push({ index, field: 'description', message: 'Descrizione voce richiesta' });
  }
  if (numberValue(line.unitPrice) < 0 || numberValue(line.extraCost) < 0) {
    errors.push({ index, field: 'price', message: 'I prezzi non possono essere negativi' });
  }
  if (line.edges) Object.entries(line.edges).forEach(([field, edge]) => {
    if (!edge?.active) return;
    if (numberValue(edge.lengthMeters ?? numberValue(edge.lengthCm) / 100) <= 0) {
      errors.push({ index, field, message: 'Lunghezza bordo non valida' });
    }
    if (numberValue(edge.unitPrice ?? edge.priceSnapshot) < 0) {
      errors.push({ index, field, message: 'Prezzo bordo non valido' });
    }
  });
  const calculation = calculateWorkLine(line);
  if (!Number.isFinite(calculation.total) || calculation.total < 0) {
    errors.push({ index, field: 'total', message: 'Totale riga non valido' });
  }
  return errors;
};

export const validateWorkLines = (raw: unknown): WorkLineValidationError[] => {
  const lines = normalizeWorkLines(raw);
  return lines.flatMap((line, index) => validateWorkLine(line, index));
};

export const assertValidWorkLines = (raw: unknown): WorkLine[] => {
  const lines = normalizeWorkLines(raw);
  const errors = lines.flatMap((line, index) => validateWorkLine(line, index));
  if (errors.length) throw new Error(errors.map((error) => error.message).join('; '));
  return lines;
};
