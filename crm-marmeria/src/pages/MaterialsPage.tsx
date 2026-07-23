import React, { useEffect, useMemo, useState } from 'react';
import { Edit, Eye, Plus, Search, Trash, X } from 'lucide-react';
import useUI from '../hooks/useUI';
import { useData } from '../hooks/useData';
import { useAuth } from '../contexts/AuthContext';
import type { Material } from '../store/slices/materialsSlice';
import { formatEuro, parseLocaleNumber } from '../utils/numbers';

type MaterialRecord = Material & {
  version?: number;
  notes?: string;
  price?: number;
  stock?: number;
  _queued?: boolean;
};

const emptyMaterial = {
  name: '',
  description: '',
  unit: '',
  unitPrice: '',
  supplier: '',
  category: '',
  stockQuantity: 0,
  minStockLevel: 0,
  notes: '',
};

const Modal: React.FC<{
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ title, onClose, children }) => (
  <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center p-4 z-50 overflow-y-auto">
    <div className="bg-white dark:bg-dark-card rounded-lg shadow-xl p-6 w-full max-w-lg my-8">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">{title}</h2>
        <button type="button" onClick={onClose} className="p-1 text-gray-500">
          <X className="w-6 h-6" />
        </button>
      </div>
      {children}
    </div>
  </div>
);

const MaterialsPage: React.FC = () => {
  const { isModalOpen, showModal, hideModal, setBreadcrumbs } = useUI();
  const { materials, addMaterial, updateMaterial, deleteMaterial } = useData();
  const { user, hasPermission } = useAuth();
  const [form, setForm] = useState<any>(emptyMaterial);
  const [selected, setSelected] = useState<MaterialRecord | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [saving, setSaving] = useState(false);

  const canCreate = hasPermission('materials.create');
  const canEdit = hasPermission('materials.edit');
  const canDelete = hasPermission('materials.delete');
  const canViewFinancials = ['admin', 'manager'].includes(user?.role || '');
  const operationalOnly = !canViewFinancials;

  useEffect(() => {
    setBreadcrumbs([{ label: 'Materiali' }]);
  }, [setBreadcrumbs]);

  const filteredMaterials = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return (materials as MaterialRecord[]).filter((material) => (
      !query
      || String(material.name || '').toLowerCase().includes(query)
      || String(material.supplier || '').toLowerCase().includes(query)
      || String(material.category || '').toLowerCase().includes(query)
    ));
  }, [materials, searchTerm]);

  const openAdd = () => {
    setForm(emptyMaterial);
    showModal({ id: 'addMaterial', type: 'add' });
  };

  const openEdit = (material: MaterialRecord) => {
    setSelected(material);
    setForm({
      ...material,
      unitPrice: parseLocaleNumber(material.unitPrice ?? material.price),
      stockQuantity: parseLocaleNumber(material.stockQuantity ?? material.stock),
      minStockLevel: parseLocaleNumber(material.minStockLevel),
    });
    showModal({ id: 'editMaterial', type: 'edit' });
  };

  const submitAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const success = await addMaterial({
        ...form,
        unitPrice: parseLocaleNumber(form.unitPrice),
        stockQuantity: parseLocaleNumber(form.stockQuantity),
        minStockLevel: parseLocaleNumber(form.minStockLevel),
      });
      if (success) hideModal('addMaterial');
    } finally {
      setSaving(false);
    }
  };

  const submitEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    try {
      const payload = operationalOnly
        ? {
          stockQuantity: parseLocaleNumber(form.stockQuantity),
          notes: String(form.notes || ''),
          version: selected.version,
        }
        : {
          ...form,
          unitPrice: parseLocaleNumber(form.unitPrice),
          stockQuantity: parseLocaleNumber(form.stockQuantity),
          minStockLevel: parseLocaleNumber(form.minStockLevel),
          version: selected.version,
        };
      const success = await updateMaterial(String(selected.id), payload);
      if (success) {
        hideModal('editMaterial');
        setSelected(null);
      }
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    setSaving(true);
    try {
      const success = await deleteMaterial(deleteId);
      if (success) {
        hideModal('deleteMaterial');
        setDeleteId(null);
      }
    } finally {
      setSaving(false);
    }
  };

  const fullForm = (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
      <label className="block md:col-span-2">
        <span className="block text-sm font-medium mb-1">Nome *</span>
        <input required value={form.name || ''} onChange={(event) => setForm({ ...form, name: event.target.value })} className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input" />
      </label>
      <label className="block md:col-span-2">
        <span className="block text-sm font-medium mb-1">Descrizione</span>
        <textarea rows={3} value={form.description || ''} onChange={(event) => setForm({ ...form, description: event.target.value })} className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input" />
      </label>
      <label className="block">
        <span className="block text-sm font-medium mb-1">Unità *</span>
        <input required value={form.unit || ''} onChange={(event) => setForm({ ...form, unit: event.target.value })} placeholder="m², kg, pz" className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input" />
      </label>
      <label className="block">
        <span className="block text-sm font-medium mb-1">Prezzo unitario (€) *</span>
        <input type="number" min="0" step="0.01" required value={form.unitPrice ?? ''} onChange={(event) => setForm({ ...form, unitPrice: event.target.value })} className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input" />
      </label>
      <label className="block">
        <span className="block text-sm font-medium mb-1">Categoria *</span>
        <input required value={form.category || ''} onChange={(event) => setForm({ ...form, category: event.target.value })} className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input" />
      </label>
      <label className="block">
        <span className="block text-sm font-medium mb-1">Fornitore</span>
        <input value={form.supplier || ''} onChange={(event) => setForm({ ...form, supplier: event.target.value })} className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input" />
      </label>
      <label className="block">
        <span className="block text-sm font-medium mb-1">Quantità in stock</span>
        <input type="number" min="0" step="0.01" value={form.stockQuantity ?? 0} onChange={(event) => setForm({ ...form, stockQuantity: event.target.value })} className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input" />
      </label>
      <label className="block">
        <span className="block text-sm font-medium mb-1">Livello minimo</span>
        <input type="number" min="0" step="0.01" value={form.minStockLevel ?? 0} onChange={(event) => setForm({ ...form, minStockLevel: event.target.value })} className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input" />
      </label>
      <label className="block md:col-span-2">
        <span className="block text-sm font-medium mb-1">Note</span>
        <textarea rows={3} value={form.notes || ''} onChange={(event) => setForm({ ...form, notes: event.target.value })} className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input" />
      </label>
    </div>
  );

  const operationalForm = (
    <div className="space-y-4 mb-5">
      <label className="block">
        <span className="block text-sm font-medium mb-1">Quantità in stock</span>
        <input type="number" min="0" step="0.01" value={form.stockQuantity ?? 0} onChange={(event) => setForm({ ...form, stockQuantity: event.target.value })} className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input" />
      </label>
      <label className="block">
        <span className="block text-sm font-medium mb-1">Note</span>
        <textarea rows={4} value={form.notes || ''} onChange={(event) => setForm({ ...form, notes: event.target.value })} className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input" />
      </label>
    </div>
  );

  return (
    <div className="p-6 bg-light-bg dark:bg-dark-bg text-light-text dark:text-dark-text min-h-screen">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-semibold">Materiali</h1>
        {canCreate && (
          <button onClick={openAdd} className="px-4 py-2 bg-light-primary text-white rounded-md flex items-center gap-2">
            <Plus className="w-5 h-5" /> Nuovo materiale
          </button>
        )}
      </div>

      <div className="bg-white dark:bg-dark-card rounded-lg shadow-sm">
        <div className="p-4 border-b border-light-border dark:border-dark-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              placeholder="Cerca materiale per nome, fornitore o categoria..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="w-full pl-10 pr-4 py-2 border rounded-md bg-light-bg dark:bg-dark-input"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-light-bg dark:bg-dark-bg">
              <tr>
                <th className="px-5 py-3 text-left text-xs uppercase text-gray-500">Nome</th>
                <th className="px-5 py-3 text-left text-xs uppercase text-gray-500">Categoria</th>
                <th className="px-5 py-3 text-left text-xs uppercase text-gray-500">Unità</th>
                <th className="px-5 py-3 text-left text-xs uppercase text-gray-500">Stock</th>
                {canViewFinancials && <th className="px-5 py-3 text-left text-xs uppercase text-gray-500">Prezzo</th>}
                <th className="px-5 py-3 text-left text-xs uppercase text-gray-500">Fornitore</th>
                <th className="px-5 py-3 text-right text-xs uppercase text-gray-500">Azioni</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-light-border dark:divide-dark-border">
              {filteredMaterials.map((material) => (
                <tr key={material.id}>
                  <td className="px-5 py-4 font-medium">{material.name}</td>
                  <td className="px-5 py-4">{material.category || '-'}</td>
                  <td className="px-5 py-4">{material.unit || '-'}</td>
                  <td className="px-5 py-4">{parseLocaleNumber(material.stockQuantity ?? material.stock)}</td>
                  {canViewFinancials && <td className="px-5 py-4">{formatEuro(material.unitPrice ?? material.price)}</td>}
                  <td className="px-5 py-4">{material.supplier || '-'}</td>
                  <td className="px-5 py-4">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => { setSelected(material); showModal({ id: 'viewMaterial', type: 'view' }); }} className="p-1.5 text-blue-600" title="Visualizza"><Eye className="w-5 h-5" /></button>
                      {canEdit && <button onClick={() => openEdit(material)} className="p-1.5 text-yellow-600" title="Modifica"><Edit className="w-5 h-5" /></button>}
                      {canDelete && <button onClick={() => { setDeleteId(String(material.id)); showModal({ id: 'deleteMaterial', type: 'delete' }); }} className="p-1.5 text-red-600" title="Elimina"><Trash className="w-5 h-5" /></button>}
                    </div>
                  </td>
                </tr>
              ))}
              {!filteredMaterials.length && (
                <tr><td colSpan={canViewFinancials ? 7 : 6} className="px-6 py-12 text-center text-gray-500">Nessun materiale trovato.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen('addMaterial') && (
        <Modal title="Nuovo materiale" onClose={() => hideModal('addMaterial')}>
          <form onSubmit={submitAdd}>
            {fullForm}
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => hideModal('addMaterial')} className="px-4 py-2 border rounded-md">Annulla</button>
              <button disabled={saving} className="px-4 py-2 bg-light-primary text-white rounded-md disabled:bg-gray-400">{saving ? 'Salvataggio...' : 'Aggiungi'}</button>
            </div>
          </form>
        </Modal>
      )}

      {isModalOpen('editMaterial') && selected && (
        <Modal title={operationalOnly ? 'Aggiorna stock' : 'Modifica materiale'} onClose={() => hideModal('editMaterial')}>
          <form onSubmit={submitEdit}>
            {operationalOnly ? operationalForm : fullForm}
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => hideModal('editMaterial')} className="px-4 py-2 border rounded-md">Annulla</button>
              <button disabled={saving} className="px-4 py-2 bg-light-primary text-white rounded-md disabled:bg-gray-400">{saving ? 'Salvataggio...' : 'Salva'}</button>
            </div>
          </form>
        </Modal>
      )}

      {isModalOpen('viewMaterial') && selected && (
        <Modal title="Dettagli materiale" onClose={() => hideModal('viewMaterial')}>
          <div className="space-y-2">
            <p><strong>Nome:</strong> {selected.name}</p>
            <p><strong>Descrizione:</strong> {selected.description || '-'}</p>
            <p><strong>Categoria:</strong> {selected.category || '-'}</p>
            <p><strong>Unità:</strong> {selected.unit || '-'}</p>
            {canViewFinancials && <p><strong>Prezzo unitario:</strong> {formatEuro(selected.unitPrice ?? selected.price)}</p>}
            <p><strong>Fornitore:</strong> {selected.supplier || '-'}</p>
            <p><strong>Quantità in stock:</strong> {parseLocaleNumber(selected.stockQuantity ?? selected.stock)}</p>
            <p><strong>Livello minimo:</strong> {parseLocaleNumber(selected.minStockLevel)}</p>
            <p><strong>Note:</strong> {selected.notes || '-'}</p>
          </div>
          <div className="mt-6 flex justify-end"><button onClick={() => hideModal('viewMaterial')} className="px-4 py-2 border rounded-md">Chiudi</button></div>
        </Modal>
      )}

      {isModalOpen('deleteMaterial') && (
        <Modal title="Conferma eliminazione" onClose={() => hideModal('deleteMaterial')}>
          <p className="mb-6">Eliminare definitivamente questo materiale?</p>
          <div className="flex justify-end gap-3">
            <button onClick={() => hideModal('deleteMaterial')} className="px-4 py-2 border rounded-md">Annulla</button>
            <button onClick={() => void confirmDelete()} disabled={saving} className="px-4 py-2 bg-red-600 text-white rounded-md disabled:bg-gray-400">Elimina</button>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default MaterialsPage;
