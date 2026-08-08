import { createId } from '../../utils/ids';
import { normalizeWorkLines } from './normalize';
import type { ImportSource, WorkLine } from './types';

export type ImportMode = 'replace' | 'add' | 'cancel';

export const copyWorkLines = (
  source: unknown,
  sourceType: ImportSource['sourceType'],
  sourceId: string,
  sourceVersion?: number,
): WorkLine[] => {
  const importedAt = new Date().toISOString();
  const importSource: ImportSource = {
    sourceType,
    sourceId: String(sourceId),
    sourceVersion,
    importedAt,
  };
  return normalizeWorkLines(source).map((line, index) => ({
    ...line,
    id: createId(),
    sortOrder: index,
    importSource,
    edges: line.edges ? Object.fromEntries(
      Object.entries(line.edges).map(([key, edge]) => [key, edge ? { ...edge } : edge]),
    ) : undefined,
  })) as WorkLine[];
};

export const mergeImportedWorkLines = (
  existing: WorkLine[] = [],
  imported: WorkLine[] = [],
  mode: ImportMode,
): WorkLine[] => {
  if (mode === 'cancel') return existing.map((line, index) => ({ ...line, sortOrder: index }));
  const next = mode === 'add' ? [...existing, ...imported] : [...imported];
  return next.map((line, index) => ({ ...line, sortOrder: index }));
};

export const importModeLabel = (mode: ImportMode): string => ({
  replace: 'Sostituisci',
  add: 'Aggiungi',
  cancel: 'Annulla',
}[mode]);
