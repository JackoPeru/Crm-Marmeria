import React, { useEffect, useMemo, useState } from 'react';
import { Edit, Eye, Filter, Plus, Search, Trash, X } from 'lucide-react';
import useUI from '../hooks/useUI';
import { useData } from '../hooks/useData';
import { useAuth } from '../contexts/AuthContext';
import AttachmentsPanel from '../components/AttachmentsPanel';

const emptyProject = {
  name: '',
  clientId: '',
  startDate: '',
  deadline: '',
  budget: '',
  status: 'In Attesa',
  phase: '',
  productionNotes: '',
};

const budgetNumber = (value) => {
  if (typeof value === 'number') return value;
  return Number.parseFloat(String(value || '').replace(/\s|€/g, '').replace(/\./g, '').replace(',', '.')) || 0;
};
const formatBudget = (value) => `€ ${budgetNumber(value).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ProjectForm = ({ value, setValue, customers, workerMode = false }) => (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
    {!workerMode && (
      <>
        <label className="block">
          <span className="block text-sm font-medium mb-1">Nome progetto *</span>
          <input value={value.name || ''} onChange={(event) => setValue({ ...value, name: event.target.value })} required className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input" />
        </label>
        <label className="block">
          <span className="block text-sm font-medium mb-1">Cliente *</span>
          <select value={String(value.clientId || '')} onChange={(event) => {
            const clientId = String(event.target.value);
            const client = customers.find((item) => String(item.id) === clientId);
            setValue({ ...value, clientId, client: client?.name || 'Cliente non specificato' });
          }} required className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input">
            <option value="">Seleziona cliente</option>
            {customers.map((customer) => <option key={customer.id} value={String(customer.id)}>{customer.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="block text-sm font-medium mb-1">Data inizio *</span>
          <input type="date" value={value.startDate || ''} onChange={(event) => setValue({ ...value, startDate: event.target.value })} required className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input" />
        </label>
        <label className="block">
          <span className="block text-sm font-medium mb-1">Scadenza *</span>
          <input type="date" value={value.deadline || ''} onChange={(event) => setValue({ ...value, deadline: event.target.value })} required className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input" />
        </label>
        <label className="block">
          <span className="block text-sm font-medium mb-1">Budget (€) *</span>
          <input type="number" step="0.01" value={value.budget ?? ''} onChange={(event) => setValue({ ...value, budget: event.target.value })} required className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input" />
        </label>
      </>
    )}
    <label className="block">
      <span className="block text-sm font-medium mb-1">Stato</span>
      <select value={value.status || 'In Attesa'} onChange={(event) => setValue({ ...value, status: event.target.value })} className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input">
        <option>In Attesa</option>
        <option>In Corso</option>
        <option>In Lavorazione</option>
        <option>Completato</option>
        <option>Annullato</option>
      </select>
    </label>
    <label className="block">
      <span className="block text-sm font-medium mb-1">Fase di lavorazione</span>
      <input value={value.phase || ''} onChange={(event) => setValue({ ...value, phase: event.target.value })} placeholder="Taglio, lucidatura, posa..." className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input" />
    </label>
    <label className="block md:col-span-2">
      <span className="block text-sm font-medium mb-1">Note di produzione</span>
      <textarea value={value.productionNotes || ''} onChange={(event) => setValue({ ...value, productionNotes: event.target.value })} rows={4} className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input" />
    </label>
  </div>
);

const Modal = ({ title, onClose, children, wide = false }) => (
  <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center p-4 z-50">
    <div className={`bg-white dark:bg-dark-card rounded-lg shadow-xl p-6 w-full max-h-[92vh] overflow-y-auto ${wide ? 'max-w-3xl' : 'max-w-lg'}`}>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">{title}</h2>
        <button type="button" onClick={onClose} className="p-1 text-gray-500"><X className="w-6 h-6" /></button>
      </div>
      {children}
    </div>
  </div>
);

const ProjectsPage = () => {
  const { isModalOpen, showModal, hideModal, setBreadcrumbs } = useUI();
  const { projects = [], customers = [], addProject, updateProject, deleteProject } = useData();
  const { user, hasPermission } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [form, setForm] = useState(emptyProject);
  const [selected, setSelected] = useState(null);
  const [deleteId, setDeleteId] = useState(null);

  const canCreate = hasPermission('projects.create');
  const canEdit = hasPermission('projects.edit');
  const canDelete = hasPermission('projects.delete');
  const workerMode = user?.role === 'worker';

  useEffect(() => {
    setBreadcrumbs([{ label: 'Progetti' }]);
  }, [setBreadcrumbs]);

  const filtered = useMemo(() => projects.filter((project) => {
    const query = searchTerm.toLowerCase();
    const matchesSearch = !query
      || String(project.name || '').toLowerCase().includes(query)
      || String(project.client || project.clientName || '').toLowerCase().includes(query);
    return matchesSearch && (!statusFilter || project.status === statusFilter);
  }), [projects, searchTerm, statusFilter]);

  const openAdd = () => {
    setForm(emptyProject);
    showModal({ id: 'addProject', type: 'add' });
  };
  const openEdit = (project) => {
    setSelected(project);
    setForm({ ...project, clientId: String(project.clientId || ''), budget: budgetNumber(project.budget) });
    showModal({ id: 'editProject', type: 'edit' });
  };
  const openView = (project) => {
    setSelected(project);
    showModal({ id: 'viewProject', type: 'view' });
  };

  const submitAdd = async (event) => {
    event.preventDefault();
    const customer = customers.find((item) => String(item.id) === String(form.clientId));
    const success = await addProject({ ...form, clientId: String(form.clientId), client: customer?.name || 'Cliente non specificato', budget: formatBudget(form.budget) });
    if (success) hideModal('addProject');
  };

  const submitEdit = async (event) => {
    event.preventDefault();
    const payload = workerMode
      ? { status: form.status, phase: form.phase, productionNotes: form.productionNotes, version: selected.version }
      : { ...form, clientId: String(form.clientId), budget: formatBudget(form.budget), version: selected.version };
    const success = await updateProject(String(selected.id), payload);
    if (success) {
      hideModal('editProject');
      setSelected(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    const success = await deleteProject(String(deleteId));
    if (success) {
      hideModal('confirmDelete');
      setDeleteId(null);
    }
  };

  return (
    <div className="p-6 bg-light-bg dark:bg-dark-bg text-light-text dark:text-dark-text">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-semibold">Progetti</h1>
        {canCreate && <button onClick={openAdd} className="px-4 py-2 bg-light-primary text-white rounded-md flex items-center gap-2"><Plus size={19} /> Nuovo progetto</button>}
      </div>

      <div className="bg-white dark:bg-dark-card rounded-lg shadow-sm">
        <div className="p-4 border-b border-light-border dark:border-dark-border">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={19} />
              <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Cerca progetto o cliente..." className="w-full pl-10 pr-4 py-2 border rounded-md bg-light-bg dark:bg-dark-input" />
            </div>
            <button onClick={() => setShowFilters((value) => !value)} className="px-4 py-2 border rounded-md flex items-center gap-2"><Filter size={18} /> Filtri</button>
          </div>
          {showFilters && (
            <div className="mt-4 max-w-xs">
              <label className="block text-sm font-medium mb-1">Stato</label>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input">
                <option value="">Tutti</option>
                <option>In Attesa</option><option>In Corso</option><option>In Lavorazione</option><option>Completato</option><option>Annullato</option>
              </select>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-light-bg dark:bg-dark-bg"><tr>
              <th className="px-5 py-3 text-left text-xs uppercase text-gray-500">Nome</th>
              <th className="px-5 py-3 text-left text-xs uppercase text-gray-500">Cliente</th>
              <th className="px-5 py-3 text-left text-xs uppercase text-gray-500">Scadenza</th>
              <th className="px-5 py-3 text-left text-xs uppercase text-gray-500">Fase</th>
              <th className="px-5 py-3 text-left text-xs uppercase text-gray-500">Stato</th>
              <th className="px-5 py-3 text-right text-xs uppercase text-gray-500">Azioni</th>
            </tr></thead>
            <tbody className="divide-y divide-light-border dark:divide-dark-border">
              {filtered.map((project) => (
                <tr key={project.id}>
                  <td className="px-5 py-4 font-medium">{project.name}</td>
                  <td className="px-5 py-4">{project.client || project.clientName}</td>
                  <td className="px-5 py-4">{project.deadline || '-'}</td>
                  <td className="px-5 py-4">{project.phase || '-'}</td>
                  <td className="px-5 py-4"><span className="px-2.5 py-1 rounded-full text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300">{project.status}</span>{project._queued && <span className="ml-2 text-xs text-orange-600">in coda</span>}</td>
                  <td className="px-5 py-4"><div className="flex justify-end gap-2">
                    <button onClick={() => openView(project)} className="p-1.5 text-blue-600"><Eye size={19} /></button>
                    {canEdit && <button onClick={() => openEdit(project)} className="p-1.5 text-yellow-600"><Edit size={19} /></button>}
                    {canDelete && <button onClick={() => { setDeleteId(project.id); showModal({ id: 'confirmDelete', type: 'delete' }); }} className="p-1.5 text-red-600"><Trash size={19} /></button>}
                  </div></td>
                </tr>
              ))}
              {!filtered.length && <tr><td colSpan="6" className="px-6 py-12 text-center text-gray-500">Nessun progetto trovato.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen('addProject') && (
        <Modal title="Nuovo progetto" onClose={() => hideModal('addProject')}>
          <form onSubmit={submitAdd}><ProjectForm value={form} setValue={setForm} customers={customers} /><div className="flex justify-end gap-3"><button type="button" onClick={() => hideModal('addProject')} className="px-4 py-2 border rounded-md">Annulla</button><button className="px-4 py-2 bg-light-primary text-white rounded-md">Crea</button></div></form>
        </Modal>
      )}

      {isModalOpen('editProject') && selected && (
        <Modal title={workerMode ? 'Aggiorna lavorazione' : 'Modifica progetto'} onClose={() => hideModal('editProject')}>
          <form onSubmit={submitEdit}><ProjectForm value={form} setValue={setForm} customers={customers} workerMode={workerMode} /><div className="flex justify-end gap-3"><button type="button" onClick={() => hideModal('editProject')} className="px-4 py-2 border rounded-md">Annulla</button><button className="px-4 py-2 bg-light-primary text-white rounded-md">Salva</button></div></form>
        </Modal>
      )}

      {isModalOpen('viewProject') && selected && (
        <Modal title="Dettagli progetto" onClose={() => hideModal('viewProject')} wide>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div><span className="text-gray-500">Nome</span><p className="font-medium text-base">{selected.name}</p></div>
            <div><span className="text-gray-500">Cliente</span><p className="font-medium text-base">{selected.client || selected.clientName}</p></div>
            <div><span className="text-gray-500">Inizio</span><p>{selected.startDate || '-'}</p></div>
            <div><span className="text-gray-500">Scadenza</span><p>{selected.deadline || '-'}</p></div>
            <div><span className="text-gray-500">Budget</span><p>{selected.budget || '-'}</p></div>
            <div><span className="text-gray-500">Stato / fase</span><p>{selected.status} {selected.phase ? `· ${selected.phase}` : ''}</p></div>
            <div className="md:col-span-2"><span className="text-gray-500">Note di produzione</span><p className="whitespace-pre-wrap">{selected.productionNotes || '-'}</p></div>
          </div>
          <AttachmentsPanel entityType="project" entityId={String(selected.id)} />
          <div className="mt-6 flex justify-end"><button onClick={() => hideModal('viewProject')} className="px-4 py-2 border rounded-md">Chiudi</button></div>
        </Modal>
      )}

      {isModalOpen('confirmDelete') && (
        <Modal title="Conferma eliminazione" onClose={() => hideModal('confirmDelete')}>
          <p className="mb-6">Eliminare definitivamente questo progetto?</p>
          <div className="flex justify-end gap-3"><button onClick={() => hideModal('confirmDelete')} className="px-4 py-2 border rounded-md">Annulla</button><button onClick={() => void confirmDelete()} className="px-4 py-2 bg-red-600 text-white rounded-md">Elimina</button></div>
        </Modal>
      )}
    </div>
  );
};

export default ProjectsPage;
