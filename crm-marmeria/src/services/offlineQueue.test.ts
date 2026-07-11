import { describe, expect, it } from 'vitest';
import { queueResourceKey } from './offlineQueue';

describe('offline queue resource identity', () => {
  it('merges an order status update with the order resource', () => {
    expect(queueResourceKey('patch', '/orders/ordine-1/status', { status: 'Completato' }))
      .toBe('/orders/ordine-1');
    expect(queueResourceKey('put', '/orders/ordine-1', { notes: 'Taglio' }))
      .toBe('/orders/ordine-1');
  });

  it('associates an offline create with its client-generated id', () => {
    expect(queueResourceKey('post', '/projects', { id: 'progetto-1', name: 'Scala' }))
      .toBe('/projects/progetto-1');
  });
});
