import { describe, expect, it } from 'vitest';
import { canMutateCachedEntity, mutationVersionFor } from './businessDataMutation';

describe('mutazioni BusinessData offline', () => {
  it('permette di modificare o eliminare un record creato offline senza versione server', () => {
    const queued = { id: 'offline-1', _queued: true };
    expect(canMutateCachedEntity(queued)).toBe(true);
    expect(mutationVersionFor(queued)).toBeUndefined();
  });

  it('continua a richiedere la versione per i record già sincronizzati', () => {
    const synced = { id: 'server-1', version: 3 };
    expect(canMutateCachedEntity(synced)).toBe(true);
    expect(mutationVersionFor(synced)).toBe(3);
  });

  it('rifiuta record non in coda privi di versione', () => {
    expect(canMutateCachedEntity({ id: 'stale' })).toBe(false);
  });
});
