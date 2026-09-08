export type UpdateAttempt = {
  id: string;
  startedAt: number;
  confirmed: boolean;
};

export type UpdateProgressLike = {
  updateId?: string;
  stage?: string;
  percent?: number;
  error?: boolean;
};

export type UpdateAttemptOutcome = 'waiting' | 'active' | 'error' | 'ready';

export const progressMatchesAttempt = (
  progress: UpdateProgressLike | null | undefined,
  attempt: UpdateAttempt | null | undefined,
): boolean => Boolean(attempt?.id && progress?.updateId === attempt.id);

export const updateAttemptOutcome = (
  progress: UpdateProgressLike | null | undefined,
  attempt: UpdateAttempt | null | undefined,
): UpdateAttemptOutcome => {
  if (!progressMatchesAttempt(progress, attempt)) return 'waiting';
  if (progress?.error) return 'error';
  if (progress?.stage === 'ready' && Number(progress?.percent) === 100) return 'ready';
  return 'active';
};

export const updateAttemptExpired = (
  attempt: UpdateAttempt | null | undefined,
  now = Date.now(),
  timeoutMs = 60_000,
): boolean => Boolean(
  attempt
  && !attempt.confirmed
  && now - attempt.startedAt >= timeoutMs,
);
