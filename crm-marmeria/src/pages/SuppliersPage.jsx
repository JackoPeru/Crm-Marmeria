import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import useUI from '../hooks/useUI';
import { formatEuro } from '../utils/numbers';

const empty = { name: '', email: '', phone: '', address: '', vatNumber: '', fiscalCode: '', notes: '' };
const Modal = ({ title, close, children }) => <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl dark:bg-dark-card"><div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-semibold">{title}</h2><button type="button" onClick={close}><X /></button></div>{children}</div></div>;

const SuppliersPage = () => {
  const { setBreadcrumbs } = useUI();
  const { hasPermission } = useAuth();
  const [allSuppliers, setSuppliers] = useState([]);
  const [form, setForm] = useState(empty);
  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [history, setHistory] = useState(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const canCreate = hasPermission('suppliers.create');
  const canEdit = hasPermission('suppliers.edit');
  const canDelete = hasPermission('suppliers.delete');
  const visibleSuppliers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return allSuppliers.filter((supplier) => !query || [supplier.name, supplier.email, supplier.phone, supplier.address, supplier.vatNumber, supplier.fiscalCode]
      .some((value) => String(value || '').toLowerCase().includes(query)))
      .sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'it', { sensitivity: 'base' }));
  }, [allSuppliers, search]);
  const suppliers = visibleSuppliers;

  const load = useCallback(async () => {
    try {
      const response = await apiClient.get('/suppliers');
      setSuppliers(response.data || []);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Caricamento fornitori non riuscito');
    }
  }, []);

  useEffect(() => {
    setBreadcrumbs([{ label: 'Fornitori' }]);
    void load();
  }, [load, setBreadcrumbs]);

  const closeForm = () => {
    setOpenForm(false);
    setEditing(null);
    setForm(empty);
  };
  const openCreate = () => {
    setEditing(null);
    setForm(empty);
    setOpenForm(true);
  };
  const openEdit = (supplier) => {
    setEditing(supplier);
    setForm({ ...empty, ...supplier });
    setOpenForm(true);
  };
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      if (editing) {
        await apiClient.put(`/suppliers/${encodeURIComponent(editing.id)}`, { ...form, version: editing.version });
        toast.success('Fornitore aggiornato');
      } else {
        await apiClient.post('/suppliers', form);
        toast.success('Fornitore creato');
      }
      closeForm();
      await load();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Salvataggio non riuscito');
    } finally {
      setBusy(false);
    }
  };
  const remove = async (supplier) => {
    if (!window.confirm(`Eliminare il fornitore ${supplier.name}?`)) return;
    setBusy(true);
    try {
      await apiClient.delete(`/suppliers/${encodeURIComponent(supplier.id)}`, { headers: { 'If-Match': String(supplier.version) } });
      toast.success('Fornitore eliminato');
      await load();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Eliminazione non riuscita');
    } finally {
      setBusy(false);
    }
  };
  const view = async (supplier) => {
    try {
      const response = await apiClient.get(`/suppliers/${encodeURIComponent(supplier.id)}/history`);
      setHistory(response.data);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Storico fornitore non disponibile');
    }
  };

  return <div className="p-6 bg-light-bg dark:bg-dark-bg text-light-text dark:text-dark-text">
    <div className="mb-4 relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cerca fornitore, contatto, P. IVA..." className="w-full rounded border bg-light-bg py-2 pl-10 pr-3 dark:bg-dark-input" /></div>
    <div className="mb-6 flex items-center justify-between"><h1 className="text-2xl font-semibold">Fornitori</h1>{canCreate && <button type="button" onClick={openCreate} className="flex items-center gap-2 rounded bg-light-primary px-4 py-2 text-white"><Plus size={18} /> Nuovo fornitore</button>}</div>
    <div className="overflow-auto rounded-lg bg-white shadow-sm dark:bg-dark-card"><table className="w-full text-sm"><thead className="bg-gray-100 dark:bg-gray-800"><tr><th className="p-3 text-left">Fornitore</th><th className="p-3 text-left">Contatti</th><th className="p-3 text-left">P. IVA</th><th className="p-3" /></tr></thead><tbody>{suppliers.map((supplier) => <tr key={supplier.id} className="border-t dark:border-gray-700"><td className="p-3 font-medium">{supplier.name}</td><td className="p-3">{supplier.phone || supplier.email || '—'}</td><td className="p-3">{supplier.vatNumber || '—'}</td><td className="p-3 text-right"><div className="flex justify-end gap-3"><button type="button" onClick={() => void view(supplier)} className="text-blue-600" title="Storico"><Eye size={18} /></button>{canEdit && <button type="button" onClick={() => openEdit(supplier)} className="text-amber-600" title="Modifica"><Pencil size={18} /></button>}{canDelete && <button type="button" disabled={busy} onClick={() => void remove(supplier)} className="text-red-600 disabled:opacity-50" title="Elimina"><Trash2 size={18} /></button>}</div></td></tr>)}{!suppliers.length && <tr><td colSpan="4" className="p-8 text-center text-gray-500">Nessun fornitore.</td></tr>}</tbody></table></div>
    {openForm && <Modal title={editing ? 'Modifica fornitore' : 'Nuovo fornitore'} close={closeForm}><form onSubmit={save} className="grid grid-cols-1 gap-3 md:grid-cols-2"><input required placeholder="Ragione sociale" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="rounded border p-2 dark:bg-dark-input" /><input placeholder="Telefono" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className="rounded border p-2 dark:bg-dark-input" /><input type="email" placeholder="Email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="rounded border p-2 dark:bg-dark-input" /><input placeholder="Partita IVA" value={form.vatNumber} onChange={(event) => setForm({ ...form, vatNumber: event.target.value })} className="rounded border p-2 dark:bg-dark-input" /><input placeholder="Codice fiscale" value={form.fiscalCode} onChange={(event) => setForm({ ...form, fiscalCode: event.target.value })} className="rounded border p-2 dark:bg-dark-input" /><input placeholder="Indirizzo" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} className="rounded border p-2 dark:bg-dark-input" /><textarea placeholder="Note" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} className="rounded border p-2 md:col-span-2 dark:bg-dark-input" /><div className="md:col-span-2 flex justify-end gap-2"><button type="button" onClick={closeForm} className="rounded border px-3 py-2">Annulla</button><button disabled={busy} className="rounded bg-light-primary px-3 py-2 text-white">Salva</button></div></form></Modal>}
    {history && <Modal title={`Storico — ${history.supplier.name}`} close={() => setHistory(null)}><div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4"><p className="rounded bg-gray-100 p-3 dark:bg-gray-800">Ordini<br /><b>{history.summary.orderCount}</b></p><p className="rounded bg-gray-100 p-3 dark:bg-gray-800">DDT<br /><b>{history.summary.deliveryCount}</b></p><p className="rounded bg-gray-100 p-3 dark:bg-gray-800">Materiali<br /><b>{history.summary.materialCount}</b></p>{history.summary.totalOrdered != null && <p className="rounded bg-gray-100 p-3 dark:bg-gray-800">Ordinato<br /><b>{formatEuro(history.summary.totalOrdered)}</b></p>}</div><h3 className="mb-2 font-semibold">Ordini</h3><ul className="mb-5 space-y-2 text-sm">{history.purchaseOrders.map((item) => <li key={item.id} className="rounded border p-2">{item.date} · {item.title} · {item.status || '—'}{Number(item.amount || 0) > 0 ? ` · ${formatEuro(item.amount)}` : ''}</li>)}{!history.purchaseOrders.length && <li className="text-gray-500">Nessun ordine.</li>}</ul><h3 className="mb-2 font-semibold">DDT</h3><ul className="mb-5 space-y-2 text-sm">{history.deliveryNotes.map((item) => <li key={item.id} className="rounded border p-2">{item.date} · {item.title} · {item.status || '—'}</li>)}{!history.deliveryNotes.length && <li className="text-gray-500">Nessun DDT.</li>}</ul><h3 className="mb-2 font-semibold">Materiali associati</h3><ul className="space-y-2 text-sm">{history.materials.map((item) => <li key={item.id} className="rounded border p-2">{item.name} · {item.category || '—'}</li>)}{!history.materials.length && <li className="text-gray-500">Nessun materiale associato.</li>}</ul></Modal>}
  </div>;
};

export default SuppliersPage;
