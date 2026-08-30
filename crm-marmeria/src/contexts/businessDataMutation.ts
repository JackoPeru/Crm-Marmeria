export interface CachedMutationEntity {
  version?: unknown;
  _queued?: boolean;
}

export const mutationVersionFor = (entity?: CachedMutationEntity | null): number | undefined => {
  const version = Number(entity?.version);
  return Number.isInteger(version) && version >= 1 ? version : undefined;
};

export const canMutateCachedEntity = (entity?: CachedMutationEntity | null): boolean => (
  Boolean(entity?._queued) || mutationVersionFor(entity) !== undefined
);
