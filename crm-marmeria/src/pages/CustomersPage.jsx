import React, { useEffect, useMemo, useState } from 'react';
import { Edit, Eye, FileSpreadsheet, Filter, Plus, Search, Trash, X } from 'lucide-react';
import useUI from '../hooks/useUI';
import { useData } from '../hooks/useData';
import { useAuth } from '../contexts/AuthContext';
import CustomerHistoryModal, { HistoryImportModal } from '../components/CustomerHistoryModal';

const emptyCustomer = {
  name: '',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  address: '',
  type: 'Privato',
  vatNumber: '',
  fiscalCode: '',
  recipientCode: '0000000',
  recipientPec: '',
  streetNumber: '',
  zip: '',
  city: '',
  province: '',
  country: 'IT',
  notes: '',
};

const Modal = ({ title, onClose, children }) => (
  <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center p-4 z-50 overflow-y-auto">
    <div className="bg-white dark:bg-dark-card rounded-lg shadow-xl p-6 w-full max-w-lg my-8">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">{title}</h2>
        <button type="button" onClick={onClose} className="p-1 text-gray-500"><X className="w-6 h-6" /></button>
      </div>
      {children}
    </div>
  </div>
);

const CustomerForm = ({ value, setValue }) => (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
    <label className="block md:col-span-2">
      <span className="block text-sm font-medium mb-1">Nome *</span>
      <input required value={value.name || ''} onChange={(event) => setValue({ ...value, name: event.target.value })} className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input" />
    </label>
    {(value.type || value.clientType || 'Privato') === 'Privato' && <><label className="block"><span className="block text-sm font-medium mb-1">Nome persona (SdI)</span><input value={value.firstName || ''} onChange={(event) => setValue({ ...value, firstName: event.target.value })} className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input" /></label><label className="block"><span className="block text-sm font-medium mb-1">Cognome persona (SdI)</span><input value={value.lastName || ''} onChange={(event) => setValue({ ...value, lastName: event.target.value })} className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input" /></label></>}
    <label className="block">
      <span className="block text-sm font-medium mb-1">Email</span>
      <input type="email" value={value.email || ''} onChange={(event) => setValue({ ...value, email: event.target.value })} className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input" />
    </label>
    <label className="block">
      <span className="block text-sm font-medium mb-1">Telefono</span>
      <input type="tel" value={value.phone || ''} onChange={(event) => setValue({ ...value, phone: event.target.value })} className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input" />
    </label>
    <label className="block md:col-span-2">
      <span className="block text-sm font-medium mb-1">Via/Piazza</span>
      <input value={value.address || ''} onChange={(event) => setValue({ ...value, address: event.target.value })} className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input" />
    </label>
    <label className="block"><span className="block text-sm font-medium mb-1">Numero civico</span><input value={value.streetNumber || ''} onChange={(event) => setValue({ ...value, streetNumber: event.target.value })} className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input" /></label>
    <label className="block"><span className="block text-sm font-medium mb-1">CAP</span><input value={value.zip || ''} onChange={(event) => setValue({ ...value, zip: event.target.value })} className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input" /></label>
    <label className="block"><span className="block text-sm font-medium mb-1">Comune</span><input value={value.city || ''} onChange={(event) => setValue({ ...value, city: event.target.value })} className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input" /></label>
    <label className="block"><span className="block text-sm font-medium mb-1">Provincia</span><input maxLength="2" value={value.province || ''} onChange={(event) => setValue({ ...value, province: event.target.value.toUpperCase() })} className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input" /></label>
    <label className="block">
      <span className="block text-sm font-medium mb-1">Tipo</span>
      <select value={value.type || value.clientType || 'Privato'} onChange={(event) => setValue({ ...value, type: event.target.value, clientType: event.target.value })} className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input">
        <option value="Privato">Privato</option>
        <option value="Azienda">Azienda</option>
      </select>
    </label>
    <label className="block">
      <span className="block text-sm font-medium mb-1">Partita IVA</span>
      <input value={value.vatNumber || ''} onChange={(event) => setValue({ ...value, vatNumber: event.target.value })} className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input" />
    </label>
    <label className="block md:col-span-2">
      <span className="block text-sm font-medium mb-1">Codice fiscale</span>
      <input value={value.fiscalCode || ''} onChange={(event) => setValue({ ...value, fiscalCode: event.target.value })} className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input" />
    </label>
    <div className="md:col-span-2 rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100">Dati fatturazione elettronica: per fatture SdI servono indirizzo completo, codice fiscale o Partita IVA e codice destinatario/PEC.</div>
    <label className="block"><span className="block text-sm font-medium mb-1">Codice destinatario</span><input maxLength="7" value={value.recipientCode || '0000000'} onChange={(event) => setValue({ ...value, recipientCode: event.target.value.toUpperCase() })} className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input" /><span className="mt-1 block text-xs text-gray-500">`0000000` se privato o destinatario PEC.</span></label>
    <label className="block"><span className="block text-sm font-medium mb-1">PEC destinatario</span><input type="email" value={value.recipientPec || ''} onChange={(event) => setValue({ ...value, recipientPec: event.target.value })} className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input" /></label>
    <label className="block md:col-span-2">
      <span className="block text-sm font-medium mb-1">Note</span>
      <textarea rows={3} value={value.notes || ''} onChange={(event) => setValue({ ...value, notes: event.target.value })} className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input" />
    </label>
  </div>
);

const CustomersPage = () => {
  const { isModalOpen, showModal, hideModal, setBreadcrumbs } = useUI();
  const { customers = [], addCustomer, updateCustomer, deleteCustomer } = useData();
  const { hasPermission, user } = useAuth();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [vatFilter, setVatFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [form, setForm] = useState(emptyCustomer);
  const [selected, setSelected] = useState(null);
  const [viewingId, setViewingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [saving, setSaving] = useState(false);

  const canCreate = hasPermission('clients.create');
  const canEdit = hasPermission('clients.edit');
  const canDelete = hasPermission('clients.delete');
  const canCreatePayment = hasPermission('payments.create');
  const canDeletePayment = hasPermission('payments.delete');
  const viewing = customers.find((customer) => String(customer.id) === String(viewingId));

  useEffect(() => {
    setBreadcrumbs([{ label: 'Clienti' }]);
  }, [setBreadcrumbs]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return customers.filter((customer) => {
      const matchesSearch = !query || [
        customer.name,
        customer.email,
        customer.phone,
        customer.address,
        customer.vatNumber,
        customer.fiscalCode,
      ].some((value) => String(value || '').toLowerCase().includes(query));
      const customerType = customer.clientType || customer.type || 'Privato';
      const matchesType = !typeFilter || customerType === typeFilter;
      const hasVat = Boolean(String(customer.vatNumber || '').trim());
      const matchesVat = !vatFilter || (vatFilter === 'si' ? hasVat : !hasVat);
      return matchesSearch && matchesType && matchesVat;
    }).sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'it', { sensitivity: 'base' }));
  }, [customers, search, typeFilter, vatFilter]);

  const submitAdd = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const success = await addCustomer({
        ...form,
        name: form.name.trim(),
        type: form.type || 'Privato',
        clientType: form.type || 'Privato',
      });
      if (success) {
        hideModal('addCustomer');
        setForm(emptyCustomer);
      }
    } finally {
      setSaving(false);
    }
  };

  const submitEdit = async (event) => {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    try {
      const success = await updateCustomer(String(selected.id), {
        ...form,
        name: form.name.trim(),
        type: form.type || form.clientType || 'Privato',
        clientType: form.type || form.clientType || 'Privato',
        version: selected.version,
      });
      if (success) {
        hideModal('editCustomer');
        setSelected(null);
      }
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deletingId) return;
    setSaving(true);
    try {
      const success = await deleteCustomer(String(deletingId));
      if (success) {
        hideModal('deleteCustomer');
        setDeletingId(null);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 bg-light-bg dark:bg-dark-bg text-light-text dark:text-dark-text min-h-screen">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-semibold">Clienti</h1>
        <div className="flex flex-wrap gap-2">
          {user?.role === 'admin' && <button onClick={() => showModal({ id: 'importHistory', type: 'import' })} className="px-4 py-2 border rounded-md flex items-center gap-2"><FileSpreadsheet className="w-5 h-5" /> Importa Excel</button>}
          {canCreate && <button onClick={() => { setForm(emptyCustomer); showModal({ id: 'addCustomer', type: 'add' }); }} className="px-4 py-2 bg-light-primary text-white rounded-md flex items-center gap-2"><Plus className="w-5 h-5" /> Nuovo cliente</button>}
        </div>
      </div>

      <div className="bg-white dark:bg-dark-card rounded-lg shadow-sm">
        <div className="p-4 border-b border-light-border dark:border-dark-border">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cerca cliente..." className="w-full pl-10 pr-4 py-2 border rounded-md bg-light-bg dark:bg-dark-input" />
            </div>
            <button onClick={() => setShowFilters((value) => !value)} className="px-4 py-2 border rounded-md flex items-center gap-2"><Filter className="w-5 h-5" /> Filtri</button>
          </div>
          {showFilters && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 max-w-xl">
              <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="p-2 border rounded-md bg-light-bg dark:bg-dark-input">
                <option value="">Tutti i tipi</option>
                <option value="Privato">Privati</option>
                <option value="Azienda">Aziende</option>
              </select>
              <select value={vatFilter} onChange={(event) => setVatFilter(event.target.value)} className="p-2 border rounded-md bg-light-bg dark:bg-dark-input">
                <option value="">Con e senza Partita IVA</option>
                <option value="si">Con Partita IVA</option>
                <option value="no">Senza Partita IVA</option>
              </select>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-light-bg dark:bg-dark-bg">
              <tr>
                <th className="px-5 py-3 text-left text-xs uppercase text-gray-500">Nome</th>
                <th className="px-5 py-3 text-left text-xs uppercase text-gray-500">Email</th>
                <th className="px-5 py-3 text-left text-xs uppercase text-gray-500">Telefono</th>
                <th className="px-5 py-3 text-left text-xs uppercase text-gray-500">Tipo</th>
                <th className="px-5 py-3 text-right text-xs uppercase text-gray-500">Azioni</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-light-border dark:divide-dark-border">
              {filtered.map((customer) => (
                <tr key={customer.id}>
                  <td className="px-5 py-4 font-medium">{customer.name}</td>
                  <td className="px-5 py-4">{customer.email || '-'}</td>
                  <td className="px-5 py-4">{customer.phone || '-'}</td>
                  <td className="px-5 py-4">{customer.clientType || customer.type || 'Privato'}</td>
                  <td className="px-5 py-4">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => { setViewingId(String(customer.id)); showModal({ id: 'viewCustomer', type: 'view' }); }} className="p-1.5 text-blue-600" title="Visualizza"><Eye className="w-5 h-5" /></button>
                      {canEdit && <button onClick={() => { setSelected(customer); setForm({ ...emptyCustomer, ...customer, type: customer.clientType || customer.type || 'Privato' }); showModal({ id: 'editCustomer', type: 'edit' }); }} className="p-1.5 text-yellow-600" title="Modifica"><Edit className="w-5 h-5" /></button>}
                      {canDelete && <button onClick={() => { setDeletingId(String(customer.id)); showModal({ id: 'deleteCustomer', type: 'delete' }); }} className="p-1.5 text-red-600" title="Elimina"><Trash className="w-5 h-5" /></button>}
                    </div>
                  </td>
                </tr>
              ))}
              {!filtered.length && <tr><td colSpan="5" className="px-6 py-10 text-center text-gray-500">Nessun cliente trovato.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen('addCustomer') && (
        <Modal title="Nuovo cliente" onClose={() => hideModal('addCustomer')}>
          <form onSubmit={submitAdd}>
            <CustomerForm value={form} setValue={setForm} />
            <div className="flex justify-end gap-3"><button type="button" onClick={() => hideModal('addCustomer')} className="px-4 py-2 border rounded-md">Annulla</button><button disabled={saving} className="px-4 py-2 bg-light-primary text-white rounded-md disabled:bg-gray-400">{saving ? 'Salvataggio...' : 'Aggiungi'}</button></div>
          </form>
        </Modal>
      )}

      {isModalOpen('editCustomer') && selected && (
        <Modal title="Modifica cliente" onClose={() => hideModal('editCustomer')}>
          <form onSubmit={submitEdit}>
            <CustomerForm value={form} setValue={setForm} />
            <div className="flex justify-end gap-3"><button type="button" onClick={() => hideModal('editCustomer')} className="px-4 py-2 border rounded-md">Annulla</button><button disabled={saving} className="px-4 py-2 bg-light-primary text-white rounded-md disabled:bg-gray-400">{saving ? 'Salvataggio...' : 'Salva'}</button></div>
          </form>
        </Modal>
      )}

      {isModalOpen('viewCustomer') && viewing && <CustomerHistoryModal customer={viewing} canCreatePayment={canCreatePayment} canDeletePayment={canDeletePayment} onClose={() => hideModal('viewCustomer')} />}
      {isModalOpen('importHistory') && <HistoryImportModal onClose={() => hideModal('importHistory')} />}

      {isModalOpen('deleteCustomer') && (
        <Modal title="Conferma eliminazione" onClose={() => hideModal('deleteCustomer')}>
          <p className="mb-6">Eliminare definitivamente questo cliente?</p>
          <div className="flex justify-end gap-3"><button onClick={() => hideModal('deleteCustomer')} className="px-4 py-2 border rounded-md">Annulla</button><button onClick={() => void confirmDelete()} disabled={saving} className="px-4 py-2 bg-red-600 text-white rounded-md disabled:bg-gray-400">Elimina</button></div>
        </Modal>
      )}
    </div>
  );
};

export default CustomersPage;
