const cleanMutationUrl = (value: string) => String(value || '').split(/[?#]/, 1)[0].replace(/\/$/, '');

const spreadable = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
);

export const mutationResourceId = (url: string, data?: unknown): string => {
  if (data && typeof data === 'object' && !Array.isArray(data) && (data as any).id != null) {
    return String((data as any).id);
  }
  const segments = cleanMutationUrl(url).split('/').filter(Boolean);
  const lastIndex = segments.length - 1;
  if (segments[lastIndex] === 'status' && segments.length >= 2) {
    return String(segments[lastIndex - 1]);
  }
  return String(segments[lastIndex] || '');
};

export const mutationExpectedVersion = (
  current: unknown,
  requested?: unknown,
): number | undefined | null => {
  const currentData = spreadable(current);
  const requestedData = spreadable(requested);
  const explicit = requestedData.expectedVersion ?? requestedData.version;
  if (explicit != null && explicit !== '' && Number.isInteger(Number(explicit))) return Number(explicit);
  if (currentData._queued === true) return undefined;
  if (currentData.version != null && currentData.version !== '' && Number.isInteger(Number(currentData.version))) {
    return Number(currentData.version);
  }
  return null;
};

export const buildOptimisticMutation = (url: string, data?: unknown) => ({
  ...spreadable(data),
  id: mutationResourceId(url, data),
  _queued: true,
});

export const mergeOptimisticEntity = <T>(
  current: T | Partial<T> | null | undefined,
  requested: unknown,
  response: unknown,
  id: string,
): T => ({
  ...spreadable(current),
  ...spreadable(requested),
  ...spreadable(response),
  id: String(id),
} as unknown as T);
