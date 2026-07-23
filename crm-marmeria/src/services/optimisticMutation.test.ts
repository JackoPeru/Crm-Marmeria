import { describe, expect, it } from 'vitest';
import {
  buildOptimisticMutation,
  mergeOptimisticEntity,
  mutationResourceId,
} from './optimisticMutation';

describe('optimistic offline mutations', () => {
  it('uses the order id instead of the status suffix', () => {
    expect(mutationResourceId('/orders/ordine-123/status', { status: 'Completato' }))
      .toBe('ordine-123');
    expect(buildOptimisticMutation('/orders/ordine-123/status', { status: 'Completato' }))
      .toMatchObject({ id: 'ordine-123', status: 'Completato', _queued: true });
  });

  it('keeps a client-generated id for offline creates', () => {
    expect(mutationResourceId('/orders', { id: 'ordine-locale', title: 'Scala' }))
      .toBe('ordine-locale');
  });

  it('merges a queued patch without deleting existing fields', () => {
    const merged = mergeOptimisticEntity(
      { id: '1', title: 'Piano cucina', clientName: 'Rossi', version: 3 },
      { status: 'Completato' },
      { status: 'Completato', _queued: true },
      '1',
    );
    expect(merged).toEqual({
      id: '1',
      title: 'Piano cucina',
      clientName: 'Rossi',
      version: 3,
      status: 'Completato',
      _queued: true,
    });
  });
});
