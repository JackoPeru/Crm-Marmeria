import { describe, expect, it } from 'vitest';
import { localDateKey } from './dates';

describe('localDateKey', () => {
  it('usa giorno locale, non conversione UTC', () => {
    expect(localDateKey(new Date(2026, 7, 11, 23, 30))).toBe('2026-08-11');
    expect(localDateKey(new Date(2026, 0, 2, 0, 5))).toBe('2026-01-02');
  });
});
