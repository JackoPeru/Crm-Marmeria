import { describe, expect, it } from 'vitest';
import {
  progressMatchesAttempt,
  updateAttemptExpired,
  updateAttemptOutcome,
  type UpdateAttempt,
} from './tracking';

const attempt: UpdateAttempt = {
  id: 'update-123',
  startedAt: 1_000,
  confirmed: false,
};

describe('server update tracking', () => {
  it('ignores stale progress from a previous update', () => {
    const progress = { updateId: 'old-update', stage: 'ready', percent: 100 };
    expect(progressMatchesAttempt(progress, attempt)).toBe(false);
    expect(updateAttemptOutcome(progress, attempt)).toBe('waiting');
  });

  it('tracks only the matching update lifecycle', () => {
    expect(updateAttemptOutcome(
      { updateId: attempt.id, stage: 'preflight', percent: 15 },
      attempt,
    )).toBe('active');

    expect(updateAttemptOutcome(
      { updateId: attempt.id, stage: 'error', percent: 0, error: true },
      attempt,
    )).toBe('error');

    expect(updateAttemptOutcome(
      { updateId: attempt.id, stage: 'ready', percent: 100 },
      attempt,
    )).toBe('ready');
  });

  it('expires only requests the server never confirmed', () => {
    expect(updateAttemptExpired(attempt, 62_000, 60_000)).toBe(true);
    expect(updateAttemptExpired({ ...attempt, confirmed: true }, 200_000, 60_000)).toBe(false);
  });
});
