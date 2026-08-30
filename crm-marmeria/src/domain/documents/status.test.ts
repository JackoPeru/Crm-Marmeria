import { describe, expect, it } from 'vitest';
import { documentStatusIsEditable, paymentStatusLabel } from './status';

describe('document status controls', () => {
  it('keeps quote status editable but invoice payment status read-only', () => {
    expect(documentStatusIsEditable('quote')).toBe(true);
    expect(documentStatusIsEditable('invoice')).toBe(false);
  });

  it('exposes a safe payment-state label for invoices', () => {
    expect(paymentStatusLabel('Pagata')).toBe('Pagata');
    expect(paymentStatusLabel('Pagata Parzialmente')).toBe('Pagata Parzialmente');
    expect(paymentStatusLabel('Scaduta')).toBe('Non Pagata');
    expect(paymentStatusLabel('')).toBe('Non Pagata');
  });
});
