import { describe, expect, it } from 'vitest';
import { normalizeWorkLines, workLinesToDocumentItems } from './normalize';

describe('IVA nelle conversioni in fattura', () => {
  it('applica il 22% a una riga proveniente da preventivo senza natura IVA', () => {
    const lines = normalizeWorkLines([{
      id: 'quote-line',
      type: 'manual',
      description: 'Piano cucina',
      quantity: 1,
      unitPrice: 100,
      taxRate: 0,
      taxNature: '',
    }]);

    const [item] = workLinesToDocumentItems(lines, true, []);
    expect(item.taxRate).toBe(22);
    expect(item.taxNature).toBe('');
  });

  it('conserva IVA 0 quando la riga ha una natura IVA esplicita', () => {
    const lines = normalizeWorkLines([{
      id: 'exempt-line',
      type: 'manual',
      description: 'Operazione non imponibile',
      quantity: 1,
      unitPrice: 100,
      taxRate: 0,
      taxNature: 'N2.2',
    }]);

    const [item] = workLinesToDocumentItems(lines, true, []);
    expect(item.taxRate).toBe(0);
    expect(item.taxNature).toBe('N2.2');
  });

  it('mantiene l’aliquota già impostata sulla fattura', () => {
    const lines = normalizeWorkLines([{
      id: 'invoice-line',
      type: 'manual',
      description: 'Voce fattura',
      quantity: 1,
      unitPrice: 100,
      taxRate: 0,
      taxNature: '',
    }]);

    const [item] = workLinesToDocumentItems(lines, true, [{ taxRate: 10, taxNature: '' }]);
    expect(item.taxRate).toBe(10);
  });
});
