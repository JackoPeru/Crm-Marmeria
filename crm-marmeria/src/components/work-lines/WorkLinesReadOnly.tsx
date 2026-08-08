import React from 'react';
import { formatEuro } from '../../utils/numbers';
import { calculateWorkLine } from '../../domain/work-lines/calculations';
import { normalizeWorkLines } from '../../domain/work-lines/normalize';
import type { WorkLine } from '../../domain/work-lines/types';

const WorkLinesReadOnly: React.FC<{ value?: WorkLine[]; showPrices?: boolean }> = ({ value = [], showPrices = true }) => {
  const lines = normalizeWorkLines(value);
  return <div className="space-y-2">{lines.map((line, index) => {
    const calculation = calculateWorkLine(line);
    return <div key={line.id || index} className="rounded border p-3 text-sm"><div className="flex justify-between gap-3"><span><strong>{index + 1}. {line.description || 'Voce lavorazione'}</strong> · {line.type === 'surface' ? `${line.quantity} pz · ${line.lengthCm} × ${line.widthCm} cm` : line.type === 'linear' ? `${line.quantity} × ${line.linearMeters} ml` : `${line.quantity} ${line.unit || 'pz'}`}</span>{showPrices && <strong>{formatEuro(calculation.total)}</strong>}</div>{showPrices && <p className="mt-1 text-xs text-gray-500">Materiale {formatEuro(calculation.materialCost)} · Bordi {formatEuro(calculation.edgeCost)}</p>}{line.notes && <p className="mt-1 whitespace-pre-wrap text-xs text-gray-600">{line.notes}</p>}</div>;
  })}{!lines.length && <p className="text-sm text-gray-500">Nessuna lavorazione strutturata.</p>}</div>;
};

export default WorkLinesReadOnly;
