import { describe, expect, it } from 'vitest';
import { bindRequestToScope, queueScopesEqual, scopeFingerprint } from './requestScope';

const oldScope = {
  userId: 'utente-a',
  apiBaseUrl: 'http://192.168.1.10:3001/api',
  serverId: 'server-a',
  dataEpoch: 'epoch-a',
};

describe('offline replay request scope', () => {
  it('mantiene il server catturato dalla coda durante il replay', () => {
    const binding = bindRequestToScope(
      oldScope,
      { ...oldScope },
      'http://192.168.1.99:3001/api',
      'fingerprint-corrente',
    );
    expect(binding.baseURL).toBe(oldScope.apiBaseUrl);
    expect(binding.fingerprint).toBe(scopeFingerprint(oldScope));
  });

  it('blocca l’invio se account, server o generazione cambiano', () => {
    for (const changed of [
      { ...oldScope, userId: 'utente-b' },
      { ...oldScope, serverId: 'server-b' },
      { ...oldScope, dataEpoch: 'epoch-b' },
      { ...oldScope, apiBaseUrl: 'http://192.168.1.11:3001/api' },
    ]) {
      expect(() => bindRequestToScope(oldScope, changed, changed.apiBaseUrl, 'nuovo'))
        .toThrow(/contesto della coda offline è cambiato/);
    }
  });

  it('confronta tutte le parti dello scope', () => {
    expect(queueScopesEqual(oldScope, { ...oldScope })).toBe(true);
    expect(queueScopesEqual(oldScope, null)).toBe(false);
  });
});
