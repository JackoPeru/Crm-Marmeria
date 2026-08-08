import React, { useEffect } from 'react';
import { Settings, X } from 'lucide-react';
import CatalogManager, { CatalogRecord } from './CatalogManager';
import type { MaterialPriceLike } from '../../domain/work-lines/types';

interface EdgeCatalogOverlayProps {
  open: boolean;
  items: CatalogRecord[];
  materials?: MaterialPriceLike[];
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  showPrices?: boolean;
  onItemsChange: (items: CatalogRecord[]) => void;
  onClose: () => void;
}

const EdgeCatalogOverlay: React.FC<EdgeCatalogOverlayProps> = ({
  open,
  items,
  materials = [],
  canCreate = false,
  canEdit = false,
  canDelete = false,
  showPrices = false,
  onItemsChange,
  onClose,
}) => {
  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open, onClose]);

  if (!open) return null;
  return <div className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="edge-catalog-overlay-title">
    <div className="my-8 w-full max-w-4xl rounded-lg bg-white p-5 shadow-2xl dark:bg-dark-card" onClick={(event) => event.stopPropagation()}>
      <div className="mb-4 flex items-start justify-between gap-3"><div><h2 id="edge-catalog-overlay-title" className="flex items-center gap-2 text-xl font-semibold"><Settings size={21} /> Impostazioni bordi e angoli</h2><p className="mt-1 text-sm text-gray-500">Modifica qui i prezzi usati dal selettore bordi del preventivo corrente. Il preventivo già salvato mantiene i propri snapshot.</p></div><button type="button" onClick={onClose} className="rounded p-1 text-gray-500" aria-label="Chiudi impostazioni bordi"><X size={22} /></button></div>
      <CatalogManager kind="edge" endpoint="/edge-types" title="Catalogo bordi e angoli" description="Questi valori alimentano la scelta automatica nelle righe a superficie." items={items} materials={materials} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} showPrices={showPrices} onItemsChange={onItemsChange} />
      <div className="mt-4 flex justify-end"><button type="button" onClick={onClose} className="rounded border px-4 py-2">Chiudi</button></div>
    </div>
  </div>;
};

export default EdgeCatalogOverlay;
