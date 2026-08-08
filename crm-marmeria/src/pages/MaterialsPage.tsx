import React, { useEffect, useMemo, useState } from 'react';
import { Edit, Eye, FileSpreadsheet, Plus, Search, Trash, X } from 'lucide-react';
import toast from 'react-hot-toast';
import useUI from '../hooks/useUI';
import { useData } from '../hooks/useData';
import { useAuth } from '../contexts/AuthContext';
import type { Material } from '../store/slices/materialsSlice';
import { formatEuro, parseLocaleNumber } from '../utils/numbers';
import { apiClient } from '../services/api';

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
  thickness: '',
  variant: '',
  active: true,
};

const Modal: React.FC<{
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}> = ({ title, onClose, children, wide = false }) => (
  <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center p-4 z-50 overflow-y-auto">
    <div className={`bg-white dark:bg-dark-card rounded-lg shadow-xl p-6 w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} my-8`}>
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

const CatalogPanel: React.FC<{
  title: string;
  endpoint: string;
  items: any[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  showPrices: boolean;
  materials: MaterialRecord[];
  onReload: () => void;
}> = ({ title, endpoint, items, canCreate, canEdit, canDelete, showPrices, materials, onReload }) => {
  const [editor, setEditor] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editor?.name?.trim() || (!editor.id && !canCreate) || (editor.id && !canEdit)) return;
    setBusy(true);
    try {
      const payload = { ...editor, name: editor.name.trim(), unitPrice: parseLocaleNumber(editor.unitPrice), price: parseLocaleNumber(editor.unitPrice), materialId: editor.materialId || null, thickness: editor.thickness || null, variant: String(editor.variant || '').trim(), active: editor.active !== false, unit: editor.unit || 'ml' };
      if (editor.id) await apiClient.patch(`${endpoint}/${encodeURIComponent(editor.id)}`, payload, { headers: { 'If-Match': String(editor.version) } });
      else await apiClient.post(endpoint, payload);
      setEditor(null); onReload();
    }
    finally { setBusy(false); }
  };
  const remove = async (item: any) => {
    if (!canDelete || !window.confirm(`Eliminare ${item.name}?`)) return;
    setBusy(true);
    try { await apiClient.delete(`${endpoint}/${encodeURIComponent(item.id)}`, { headers: { 'If-Match': String(item.version) } }); onReload(); }
    finally { setBusy(false); }
  };
  const fields = editor && <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
    <label className="md:col-span-2"><span className="mb-1 block text-xs font-medium">Nome / tipo *</span><input required value={editor.name || ''} onChange={(event) => setEditor({ ...editor, name: event.target.value })} className="w-full rounded border p-2 dark:bg-dark-input" /></label>
    {showPrices && <label><span className="mb-1 block text-xs font-medium">Prezzo €/ml *</span><input required inputMode="decimal" value={editor.unitPrice ?? ''} onChange={(event) => setEditor({ ...editor, unitPrice: event.target.value })} className="w-full rounded border p-2 dark:bg-dark-input" /></label>}
    <label><span className="mb-1 block text-xs font-medium">Materiale specifico</span><select value={editor.materialId || ''} onChange={(event) => setEditor({ ...editor, materialId: event.target.value })} className="w-full rounded border p-2 dark:bg-dark-input"><option value="">Generico</option>{materials.map((material) => <option key={material.id} value={String(material.id)}>{material.name}{material.thickness ? ` · ${material.thickness} mm` : ''}{material.variant ? ` · ${material.variant}` : ''}</option>)}</select></label>
    <label><span className="mb-1 block text-xs font-medium">Spessore</span><input value={editor.thickness || ''} onChange={(event) => setEditor({ ...editor, thickness: event.target.value })} placeholder="mm" className="w-full rounded border p-2 dark:bg-dark-input" /></label>
    <label><span className="mb-1 block text-xs font-medium">Variante</span><input value={editor.variant || ''} onChange={(event) => setEditor({ ...editor, variant: event.target.value })} className="w-full rounded border p-2 dark:bg-dark-input" /></label>
    <label><span className="mb-1 block text-xs font-medium">Unità</span><input value={editor.unit || 'ml'} onChange={(event) => setEditor({ ...editor, unit: event.target.value })} className="w-full rounded border p-2 dark:bg-dark-input" /></label>
    <label className="flex items-center gap-2"><input type="checkbox" checked={editor.active !== false} onChange={(event) => setEditor({ ...editor, active: event.target.checked })} /> Catalogo attivo</label>
  </div>;
  return <section className="rounded-lg border bg-white p-4 shadow-sm dark:bg-dark-card"><div className="mb-3 flex items-center justify-between gap-3"><h2 className="font-semibold">{title}</h2><span className="text-xs text-gray-500">{items.length} voci</span></div>{canCreate && <button type="button" onClick={() => setEditor({ name: '', unitPrice: '', materialId: '', thickness: '', variant: '', unit: 'ml', active: true })} className="mb-3 rounded bg-light-primary px-3 py-2 text-sm text-white">Aggiungi voce</button>}<div className="space-y-2">{items.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded border p-2 text-sm"><span><b>{item.name}</b>{showPrices && <span className="ml-2 text-gray-500">{formatEuro(item.unitPrice ?? item.price)}</span>}<span className="ml-2 text-xs text-gray-500">{item.materialId ? `materiale ${materials.find((material) => String(material.id) === String(item.materialId))?.name || item.materialId}` : 'generico'}{item.thickness ? ` · ${item.thickness} mm` : ''}{item.variant ? ` · ${item.variant}` : ''}{item.active === false ? ' · disattivo' : ''}</span></span><div className="flex gap-2">{canEdit && <button type="button" onClick={() => setEditor({ ...item, unitPrice: item.unitPrice ?? item.price ?? '' })} className="text-amber-600" title="Modifica"><Edit className="h-4 w-4" /></button>}{canDelete && <button type="button" disabled={busy} onClick={() => void remove(item)} className="text-red-600" title="Elimina"><Trash className="h-4 w-4" /></button>}</div></div>)}{!items.length && <p className="text-sm text-gray-500">Catalogo vuoto.</p>}</div>{editor && <Modal title={`${editor.id ? 'Modifica' : 'Nuova'} voce catalogo`} onClose={() => setEditor(null)}><form onSubmit={save}>{fields}<div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setEditor(null)} className="rounded border px-3 py-2">Annulla</button><button disabled={busy} className="rounded bg-light-primary px-3 py-2 text-white disabled:opacity-50">Salva</button></div></form></Modal>}</section>;
};

const MaterialsPage: React.FC = () => {
  const { isModalOpen, showModal, hideModal, setBreadcrumbs } = useUI();
  const { materials, addMaterial, updateMaterial, deleteMaterial } = useData();
  const { user, hasPermission } = useAuth();
  const [form, setForm] = useState<any>(emptyMaterial);
  const [selected, setSelected] = useState<MaterialRecord | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [saving, setSaving] = useState(false);
  const [edgeTypes, setEdgeTypes] = useState<any[]>([]);
  const [linearItems, setLinearItems] = useState<any[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<any | null>(null);
  const [importMapping, setImportMapping] = useState<Record<string, Record<string, string>>>({});
  const [duplicateMode, setDuplicateMode] = useState<'skip' | 'update'>('skip');
  const [importBusy, setImportBusy] = useState(false);

  const canCreate = hasPermission('materials.create');
  const canEdit = hasPermission('materials.edit');
  const canDelete = hasPermission('materials.delete');
  const canViewFinancials = ['admin', 'manager'].includes(user?.role || '');
  const operationalOnly = !canViewFinancials;
  const canImportCatalog = user?.role === 'admin';

  useEffect(() => {
    setBreadcrumbs([{ label: 'Materiali' }]);
  }, [setBreadcrumbs]);

  const loadCatalogs = async () => {
    if (!hasPermission('materials.view')) return;
    const [edges, linear] = await Promise.all([
      apiClient.get('/edge-types').catch(() => ({ data: [] })),
      apiClient.get('/linear-items').catch(() => ({ data: [] })),
    ]);
    setEdgeTypes(edges.data || []); setLinearItems(linear.data || []);
  };
  useEffect(() => { void loadCatalogs(); }, [hasPermission]);

  const previewMaterialImport = async (file: File | null) => {
    if (!file || !canImportCatalog) return;
    setImportFile(file); setImportBusy(true);
    try {
      const payload = new FormData(); payload.append('file', file);
      const response = await apiClient.post('/imports/materials/preview', payload, { timeout: 60000 });
      setImportPreview(response.data);
      setImportMapping(Object.fromEntries((response.data.sheets || []).map((sheet: any) => [sheet.name, sheet.suggestedMapping || {}])));
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Anteprima listino non riuscita');
      setImportPreview(null);
    } finally { setImportBusy(false); }
  };

  const commitMaterialImport = async () => {
    if (!importFile || !importPreview || !canImportCatalog) return;
    setImportBusy(true);
    try {
      const payload = new FormData();
      payload.append('file', importFile);
      payload.append('mapping', JSON.stringify({ sheets: importMapping }));
      payload.append('duplicateMode', duplicateMode);
      const response = await apiClient.post('/imports/materials/commit', payload, { timeout: 120000 });
      toast.success(`Listino importato: ${response.data.created || 0} nuovi, ${response.data.updated || 0} aggiornati, ${response.data.skipped?.length || 0} saltati`);
      setImportOpen(false); setImportFile(null); setImportPreview(null); setImportMapping({});
      window.dispatchEvent(new CustomEvent('crm-data-refresh-requested'));
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Importazione listino non riuscita');
    } finally { setImportBusy(false); }
  };

  const filteredMaterials = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return (materials as MaterialRecord[]).filter((material) => (
      !query
      || String(material.name || '').toLowerCase().includes(query)
      || String(material.supplier || '').toLowerCase().includes(query)
      || String(material.category || '').toLowerCase().includes(query)
      || String(material.thickness || '').toLowerCase().includes(query)
      || String(material.variant || '').toLowerCase().includes(query)
    )).sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'it', { sensitivity: 'base' }));
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
      <label className="block"><span className="block text-sm font-medium mb-1">Spessore</span><input value={form.thickness ?? ''} onChange={(event) => setForm({ ...form, thickness: event.target.value })} placeholder="mm" className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input" /></label>
      <label className="block"><span className="block text-sm font-medium mb-1">Variante / finitura</span><input value={form.variant || ''} onChange={(event) => setForm({ ...form, variant: event.target.value })} className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input" /></label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={form.active !== false} onChange={(event) => setForm({ ...form, active: event.target.checked })} /> Catalogo attivo</label>
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
        <div className="flex flex-wrap gap-2">
        {canImportCatalog && (
          <button type="button" onClick={() => setImportOpen(true)} className="px-4 py-2 border rounded-md flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5" /> Importa listino .xlsx
          </button>
        )}
        {canCreate && (
          <button onClick={openAdd} className="px-4 py-2 bg-light-primary text-white rounded-md flex items-center gap-2">
            <Plus className="w-5 h-5" /> Nuovo materiale
          </button>
        )}
        </div>
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

      {hasPermission('materials.view') && <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2"><CatalogPanel title="Catalogo bordi e angoli" endpoint="/edge-types" items={edgeTypes} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} showPrices={canViewFinancials} materials={materials as MaterialRecord[]} onReload={() => void loadCatalogs()} /><CatalogPanel title="Catalogo componenti lineari" endpoint="/linear-items" items={linearItems} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} showPrices={canViewFinancials} materials={materials as MaterialRecord[]} onReload={() => void loadCatalogs()} /></div>}

      {importOpen && (
        <Modal title="Importa listino materiali Excel" onClose={() => { if (!importBusy) { setImportOpen(false); setImportPreview(null); } }} wide>
          <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">Ogni foglio diventa il fornitore. Il server riconosce nome, spessore e prezzo; la scelta duplicati è obbligatoria.</p>
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void previewMaterialImport(event.target.files?.[0] || null)} disabled={importBusy} />
          {importBusy && <p className="mt-3 text-sm text-gray-500">Elaborazione...</p>}
          {importPreview && <div className="mt-4 space-y-4">
            {importPreview.sheets?.map((sheet: any) => <div key={sheet.name} className="rounded border p-3"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><b>{sheet.name}</b><span className="text-xs text-gray-500">{sheet.totalRows} righe · {sheet.validRows} valide · {sheet.duplicates} duplicati</span></div><div className="grid grid-cols-1 gap-2 md:grid-cols-3">{['name', 'thickness', 'unitPrice', 'variant', 'unit', 'category'].map((field) => <label key={field} className="text-xs"><span className="mb-1 block font-medium">{field === 'unitPrice' ? 'prezzo' : field}</span><select value={importMapping[sheet.name]?.[field] || ''} onChange={(event) => setImportMapping((current) => ({ ...current, [sheet.name]: { ...(current[sheet.name] || {}), [field]: event.target.value } }))} className="w-full rounded border p-2 dark:bg-dark-input"><option value="">(non mappare)</option>{sheet.headers.map((header: string) => <option key={header} value={header}>{header}</option>)}</select></label>)}</div>{sheet.invalidRows?.length > 0 && <p className="mt-2 text-xs text-red-600">Scartate: {sheet.invalidRows.map((row: any) => `riga ${row.rowNumber}: ${row.reason}`).join(' · ')}</p>}<div className="mt-3 overflow-x-auto"><table className="w-full text-xs"><tbody>{(sheet.sampleRows || []).slice(0, 3).map((row: any, index: number) => <tr key={`${sheet.name}-${index}`} className="border-b">{Object.entries(row).filter(([key]) => !['rowNumber', 'duplicate', 'importKey'].includes(key)).slice(0, 6).map(([key, value]) => <td key={key} className="p-1">{key}: {String(value ?? '')}</td>)}</tr>)}</tbody></table></div></div>)}
            <label className="block"><span className="mb-1 block text-sm font-medium">Duplicati</span><select value={duplicateMode} onChange={(event) => setDuplicateMode(event.target.value as 'skip' | 'update')} className="rounded border p-2 dark:bg-dark-input"><option value="skip">Salta duplicati</option><option value="update">Aggiorna duplicati (conferma esplicita)</option></select></label>
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setImportOpen(false)} className="rounded border px-3 py-2">Annulla</button><button type="button" disabled={importBusy} onClick={() => void commitMaterialImport()} className="rounded bg-light-primary px-3 py-2 text-white disabled:opacity-50">Conferma importazione</button></div>
          </div>}
        </Modal>
      )}

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
            <p><strong>Spessore:</strong> {selected.thickness || '-'}</p>
            <p><strong>Variante:</strong> {selected.variant || '-'}</p>
            <p><strong>Attivo:</strong> {selected.active === false ? 'No' : 'Si'}</p>
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
