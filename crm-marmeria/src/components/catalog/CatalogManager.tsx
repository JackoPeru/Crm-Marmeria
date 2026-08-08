import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Edit, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { formatEuro, parseLocaleNumber } from '../../utils/numbers';
import type { MaterialPriceLike } from '../../domain/work-lines/types';

export type CatalogKind = 'edge' | 'linear';
export type CatalogRecord = {
  id: string | number;
  name?: string;
  unitPrice?: number | string;
  price?: number | string;
  unit?: string;
  materialId?: string | number;
  thickness?: string | number;
  variant?: string;
  active?: boolean;
  version?: number;
};

interface CatalogManagerProps {
  kind: CatalogKind;
  endpoint: string;
  title: string;
  description?: string;
  items?: CatalogRecord[];
  materials?: MaterialPriceLike[];
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  showPrices?: boolean;
  onItemsChange?: (items: CatalogRecord[]) => void;
  className?: string;
}

const inputClass = 'w-full rounded border p-2 bg-light-bg dark:bg-dark-input';

const emptyEditor = (kind: CatalogKind): CatalogRecord => ({
  id: '',
  name: '',
  unitPrice: '',
  materialId: '',
  thickness: '',
  variant: '',
  unit: kind === 'linear' ? 'ml' : 'ml',
  active: true,
});

const metadata = (item: CatalogRecord, materials: MaterialPriceLike[]) => [
  item.materialId
    ? `materiale ${materials.find((material) => String(material.id) === String(item.materialId))?.name || item.materialId}`
    : 'generico',
  item.thickness ? `${item.thickness} mm` : '',
  item.variant ? String(item.variant) : '',
  item.unit && item.unit !== 'ml' ? item.unit : '',
  item.active === false ? 'disattivo' : '',
].filter(Boolean).join(' · ');

const CatalogManager: React.FC<CatalogManagerProps> = ({
  kind,
  endpoint,
  title,
  description,
  items,
  materials = [],
  canCreate = false,
  canEdit = false,
  canDelete = false,
  showPrices = false,
  onItemsChange,
  className = '',
}) => {
  const controlled = Array.isArray(items);
  const [localItems, setLocalItems] = useState<CatalogRecord[]>([]);
  const [editor, setEditor] = useState<CatalogRecord | null>(null);
  const [busy, setBusy] = useState(false);

  const visibleItems = controlled ? items || [] : localItems;
  const setLoadedItems = useCallback((next: CatalogRecord[]) => {
    setLocalItems(next);
    onItemsChange?.(next);
  }, [onItemsChange]);

  const load = useCallback(async () => {
    try {
      const response = await apiClient.get(endpoint);
      const next = Array.isArray(response.data) ? response.data : [];
      setLoadedItems(next);
      return next;
    } catch (error: any) {
      toast.error(error.response?.data?.error || `Caricamento ${title.toLowerCase()} non riuscito`);
      return [];
    }
  }, [endpoint, setLoadedItems, title]);

  useEffect(() => {
    if (!controlled) void load();
  }, [controlled, load]);

  const save = async () => {
    if (!editor?.name?.trim() || (editor.id && !canEdit) || (!editor.id && !canCreate)) return;
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        name: editor.name.trim(),
        materialId: editor.materialId ? String(editor.materialId) : null,
        thickness: editor.thickness === '' || editor.thickness == null ? null : editor.thickness,
        active: editor.active !== false,
      };
      if (kind === 'linear') {
        payload.unit = String(editor.unit || 'ml').trim() || 'ml';
        payload.variant = String(editor.variant || '').trim();
      } else {
        payload.unit = 'ml';
      }
      if (showPrices) {
        payload.unitPrice = parseLocaleNumber(editor.unitPrice);
        payload.price = payload.unitPrice;
      }
      if (editor.id) {
        await apiClient.patch(`${endpoint}/${encodeURIComponent(String(editor.id))}`, payload, {
          headers: editor.version == null ? undefined : { 'If-Match': String(editor.version) },
        });
        toast.success('Voce catalogo aggiornata');
      } else {
        await apiClient.post(endpoint, payload);
        toast.success('Voce catalogo aggiunta');
      }
      setEditor(null);
      await load();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Salvataggio catalogo non riuscito');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item: CatalogRecord) => {
    if (!canDelete || !window.confirm(`Eliminare ${item.name || 'questa voce'}?`)) return;
    setBusy(true);
    try {
      await apiClient.delete(`${endpoint}/${encodeURIComponent(String(item.id))}`, {
        headers: item.version == null ? undefined : { 'If-Match': String(item.version) },
      });
      toast.success('Voce catalogo eliminata');
      await load();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Eliminazione catalogo non riuscita');
    } finally {
      setBusy(false);
    }
  };

  const editorFields = useMemo(() => {
    if (!editor) return null;
    return (
      <div className="rounded border border-light-border bg-light-bg p-3 dark:border-dark-border dark:bg-dark-bg">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h4 className="font-semibold">{editor.id ? 'Modifica voce' : 'Nuova voce'}</h4>
          <button type="button" onClick={() => setEditor(null)} className="rounded p-1 text-gray-500" aria-label="Chiudi editor catalogo"><X size={18} /></button>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="md:col-span-2"><span className="mb-1 block text-xs font-medium">Nome / tipo *</span><input autoFocus required value={editor.name || ''} onChange={(event) => setEditor({ ...editor, name: event.target.value })} className={inputClass} /></label>
          {showPrices && <label><span className="mb-1 block text-xs font-medium">Prezzo €/ml *</span><input required inputMode="decimal" value={editor.unitPrice ?? ''} onChange={(event) => setEditor({ ...editor, unitPrice: event.target.value })} className={inputClass} /></label>}
          <label><span className="mb-1 block text-xs font-medium">Materiale specifico</span><select value={editor.materialId || ''} onChange={(event) => setEditor({ ...editor, materialId: event.target.value })} className={inputClass}><option value="">Generico</option>{materials.map((material) => <option key={String(material.id)} value={String(material.id)}>{material.name}{material.thickness ? ` · ${material.thickness} mm` : ''}{material.variant ? ` · ${material.variant}` : ''}</option>)}</select></label>
          <label><span className="mb-1 block text-xs font-medium">Spessore</span><input value={editor.thickness ?? ''} onChange={(event) => setEditor({ ...editor, thickness: event.target.value })} placeholder="mm" className={inputClass} /></label>
          {kind === 'linear' && <>
            <label><span className="mb-1 block text-xs font-medium">Variante / finitura</span><input value={editor.variant || ''} onChange={(event) => setEditor({ ...editor, variant: event.target.value })} className={inputClass} /></label>
            <label><span className="mb-1 block text-xs font-medium">Unità</span><input value={editor.unit || 'ml'} onChange={(event) => setEditor({ ...editor, unit: event.target.value })} className={inputClass} /></label>
          </>}
          <label className="flex items-center gap-2"><input type="checkbox" checked={editor.active !== false} onChange={(event) => setEditor({ ...editor, active: event.target.checked })} /> Catalogo attivo</label>
        </div>
        <div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setEditor(null)} className="rounded border px-3 py-2">Annulla</button><button type="button" disabled={busy || !editor.name?.trim()} onClick={() => void save()} className="rounded bg-light-primary px-3 py-2 text-white disabled:opacity-50">{busy ? 'Salvataggio...' : 'Salva'}</button></div>
      </div>
    );
  }, [editor, kind, materials, showPrices, busy]);

  return (
    <section className={`rounded-lg border bg-white p-4 shadow-sm dark:bg-dark-card ${className}`} aria-label={title}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="font-semibold">{title}</h3>{description && <p className="mt-1 text-sm text-gray-500">{description}</p>}</div>
        <div className="flex items-center gap-2 text-xs text-gray-500"><span>{visibleItems.length} voci</span><button type="button" onClick={() => void load()} className="rounded border p-1.5" title="Aggiorna catalogo" aria-label={`Aggiorna ${title}`}><RefreshCw size={15} /></button></div>
      </div>
      {canCreate && <button type="button" onClick={() => setEditor(emptyEditor(kind))} className="mb-3 flex items-center gap-1 rounded bg-light-primary px-3 py-2 text-sm text-white"><Plus size={16} /> Aggiungi voce</button>}
      {editorFields}
      <div className="mt-3 space-y-2">
        {visibleItems.map((item) => <div key={String(item.id)} className="flex flex-wrap items-center justify-between gap-3 rounded border p-2 text-sm">
          <span><b>{item.name || 'Voce senza nome'}</b>{showPrices && <span className="ml-2 text-gray-500">{formatEuro(item.unitPrice ?? item.price)}</span>}<span className="ml-2 text-xs text-gray-500">{metadata(item, materials)}</span></span>
          <span className="flex gap-2">{canEdit && <button type="button" onClick={() => setEditor({ ...item, unitPrice: item.unitPrice ?? item.price ?? '' })} className="rounded p-1.5 text-amber-600" title="Modifica" aria-label={`Modifica ${item.name || 'voce'}`}><Edit size={16} /></button>}{canDelete && <button type="button" disabled={busy} onClick={() => void remove(item)} className="rounded p-1.5 text-red-600 disabled:opacity-50" title="Elimina" aria-label={`Elimina ${item.name || 'voce'}`}><Trash2 size={16} /></button>}</span>
        </div>)}
        {!visibleItems.length && <p className="rounded border border-dashed p-3 text-sm text-gray-500">Catalogo vuoto.</p>}
      </div>
    </section>
  );
};

export default CatalogManager;
