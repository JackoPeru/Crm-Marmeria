import { describe, expect, it } from 'vitest';
import { calculateWorkLine } from './calculations';

describe('lunghezze bordi', () => {
  it('usa la lunghezza in cm aggiornata invece di un vecchio valore lengthMeters', () => {
    const result = calculateWorkLine({
      type: 'surface',
      quantity: 1,
      lengthCm: 200,
      widthCm: 60,
      unitPrice: 0,
      extraCost: 0,
      edges: {
        front: {
          active: true,
          lengthCm: 200,
          lengthMeters: 1,
          unitPrice: 10,
        },
      },
    });

    expect(result.edgeCost).toBe(20);
  });
});
