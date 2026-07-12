import { describe, expect, it } from 'vitest';
import { createId } from './ids';

describe('createId', () => {
  it('crea identificativi non vuoti e diversi', () => {
    const first = createId();
    const second = createId();
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
  });
});
