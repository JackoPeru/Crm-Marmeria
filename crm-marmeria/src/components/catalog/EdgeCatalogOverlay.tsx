import React from 'react';
import { Settings } from 'lucide-react';
import CatalogManager, { CatalogRecord } from './CatalogManager';
import type { MaterialPriceLike } from '../../domain/work-lines/types';
import Modal from '../common/Modal';

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
  if (!open) return null;
  return <Modal
    isOpen={open}
    onClose={onClose}
    title={<span className="flex items-center gap-2"><Settings size={21} /> Impostazioni bordi e angoli</span>}
    size="4xl"
    closeLabel="Chiudi impostazioni bordi"
    overlayClassName="z-[80]"
  >
      <p className="mb-4 text-sm text-gray-500">Modifica qui i prezzi usati dal selettore bordi del preventivo corrente. Il preventivo già salvato mantiene i propri snapshot.</p>
      <CatalogManager kind="edge" endpoint="/edge-types" title="Catalogo bordi e angoli" description="Questi valori alimentano la scelta automatica nelle righe a superficie." items={items} materials={materials} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} showPrices={showPrices} onItemsChange={onItemsChange} />
      <div className="mt-4 flex justify-end"><button type="button" onClick={onClose} className="rounded border px-4 py-2">Chiudi</button></div>
  </Modal>;
};

export default EdgeCatalogOverlay;
