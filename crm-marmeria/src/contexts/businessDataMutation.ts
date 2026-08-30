export interface CachedMutationEntity {
  id?: unknown;
  version?: unknown;
  _queued?: boolean;
  [key: string]: unknown;
}

export const mutationVersionFor = (entity?: CachedMutationEntity | null): number | undefined => {
  const version = Number(entity?.version);
  return Number.isInteger(version) && version >= 1 ? version : undefined;
};

export const canMutateCachedEntity = (entity?: CachedMutationEntity | null): boolean => (
  Boolean(entity?._queued) || mutationVersionFor(entity) !== undefined
);
