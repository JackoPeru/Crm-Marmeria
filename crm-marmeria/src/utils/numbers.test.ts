import { describe, expect, it } from 'vitest';
import { parseLocaleNumber } from './numbers';

describe('parseLocaleNumber', () => {
  it('preserva i decimali provenienti dagli input HTML', () => {
    expect(parseLocaleNumber('12.34')).toBeCloseTo(12.34);
    expect(parseLocaleNumber(12.34)).toBeCloseTo(12.34);
  });

  it('interpreta il formato italiano', () => {
    expect(parseLocaleNumber('1.234,56')).toBeCloseTo(1234.56);
    expect(parseLocaleNumber('12,34')).toBeCloseTo(12.34);
  });

  it('interpreta il formato internazionale', () => {
    expect(parseLocaleNumber('1,234.56')).toBeCloseTo(1234.56);
  });

  it('gestisce valori vuoti o non validi', () => {
    expect(parseLocaleNumber('')).toBe(0);
    expect(parseLocaleNumber('non-numero')).toBe(0);
  });
});
