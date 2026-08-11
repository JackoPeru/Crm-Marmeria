import React, { useEffect, useMemo, useState } from 'react';
import { Edit, Eye, Filter, Plus, Search, Trash } from 'lucide-react';
import toast from 'react-hot-toast';
import useUI from '../hooks/useUI';
import { useData } from '../hooks/useData';
import { useAuth } from '../contexts/AuthContext';
import AttachmentsPanel from '../components/AttachmentsPanel';
import { formatEuro } from '../utils/numbers';
import { localDateKey } from '../utils/dates';
import { apiClient } from '../services/api';
import { PROJECT_STATUS_OPTIONS } from '../utils/constants';
import WorkLinesEditor from '../components/work-lines/WorkLinesEditor';
import WorkLinesReadOnly from '../components/work-lines/WorkLinesReadOnly';
import { copyWorkLines, mergeImportedWorkLines } from '../domain/work-lines/import';
import { normalizeWorkLines } from '../domain/work-lines/normalize';
import Modal from '../components/common/Modal';

const emptyProject = () => ({
  name: '',
  clientId: '',
  startDate: localDateKey(),
  deadline: '',
  status: 'In Attesa',
  phase: '',
  productionNotes: '',
  workLines: [],
});

const ProjectForm = ({ value, setValue, customers, materials = [], quotes = [], edgeCatalog = [], linearCatalog = [], canViewFinancials = true, operationalOnly = false }) => {
  const lines = normalizeWorkLines(value.workLines, value.items);
  const importQuote = (quoteId) => {
    const quote = quotes.find((item) => String(item.id) === String(quoteId));
    if (!quote) return;
    const imported = copyWorkLines(quote.workLines?.length ? quote.workLines : quote.items, 'quote', quote.id, quote.version);
    let mode = lines.length ? String(window.prompt('Il progetto contiene giÃ  righe. Scrivi sostituisci, aggiungi o annulla.', 'sostituisci') || '').trim().toLowerCase() : 'replace';
    mode = mode === 'sostituisci' || mode === 'replace' ? 'replace' : mode === 'aggiungi' || mode === 'add' ? 'add' : 'cancel';
    if (mode === 'cancel') return;
    setValue({
      ...value,
      clientId: quote.customerId == null ? value.clientId : String(quote.customerId),
      name: value.name || `Progetto ${quote.quoteNumber || ''}`.trim(),
      workLines: mergeImportedWorkLines(lines, imported, mode),
      importSource: { sourceType: 'quote', sourceId: String(quote.id), sourceVersion: quote.version, importedAt: new Date().toISOString() },
    });
  };
  return <div className="space-y-5">
    {!operationalOnly && <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <label className="block"><span className="mb-1 block text-sm font-medium">Nome progetto *</span><input required value={value.name || ''} onChange={(event) => setValue({ ...value, name: event.target.value })} className="w-full rounded-md border p-2 bg-light-bg dark:bg-dark-input" /></label>
      <label className="block"><span className="mb-1 block text-sm font-medium">Cliente *</span><select required value={String(value.clientId || '')} onChange={(event) => { const clientId = event.target.value; const client = customers.find((item) => String(item.id) === clientId); setValue({ ...value, clientId, client: client?.name || 'Cliente non specificato' }); }} className="w-full rounded-md border p-2 bg-light-bg dark:bg-dark-input"><option value="">Seleziona cliente</option>{[...customers].sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'it', { sensitivity: 'base' })).map((customer) => <option key={customer.id} value={String(customer.id)}>{customer.name}</option>)}</select></label>
      <label className="block"><span className="mb-1 block text-sm font-medium">Data inizio *</span><input required type="date" value={value.startDate || ''} onChange={(event) => setValue({ ...value, startDate: event.target.value })} className="w-full rounded-md border p-2 bg-light-bg dark:bg-dark-input" /></label>
      <label className="block"><span className="mb-1 block text-sm font-medium">Scadenza (opzionale)</span><input type="date" value={value.deadline || ''} onChange={(event) => setValue({ ...value, deadline: event.target.value })} className="w-full rounded-md border p-2 bg-light-bg dark:bg-dark-input" /></label>
      <label className="block"><span className="mb-1 block text-sm font-medium">Importa da preventivo</span><select value="" onChange={(event) => importQuote(event.target.value)} className="w-full rounded-md border p-2 bg-light-bg dark:bg-dark-input"><option value="">Seleziona preventivo</option>{quotes.map((quote) => <option key={quote.id} value={String(quote.id)}>{quote.quoteNumber || quote.id}</option>)}</select></label>
    </div>}
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <label className="block"><span className="mb-1 block text-sm font-medium">Stato</span><select value={value.status || 'In Attesa'} onChange={(event) => setValue({ ...value, status: event.target.value })} className="w-full rounded-md border p-2 bg-light-bg dark:bg-dark-input">{PROJECT_STATUS_OPTIONS.map((status) => <option key={status}>{status}</option>)}</select></label>
      <label className="block"><span className="mb-1 block text-sm font-medium">Fase di lavorazione</span><input value={value.phase || ''} onChange={(event) => setValue({ ...value, phase: event.target.value })} placeholder="Taglio, lucidatura, posa..." className="w-full rounded-md border p-2 bg-light-bg dark:bg-dark-input" /></label>
      <label className="block md:col-span-2"><span className="mb-1 block text-sm font-medium">Note di produzione</span><textarea rows={3} value={value.productionNotes || ''} onChange={(event) => setValue({ ...value, productionNotes: event.target.value })} className="w-full rounded-md border p-2 bg-light-bg dark:bg-dark-input" /></label>
    </div>
    {!operationalOnly && <WorkLinesEditor value={lines} onChange={(workLines) => setValue({ ...value, workLines })} materials={materials} edgeCatalog={edgeCatalog} linearCatalog={linearCatalog} showPrices={canViewFinancials} />}
  </div>;
};

const ProjectsPage = () => {
  const { isModalOpen, showModal, hideModal, setBreadcrumbs, userPreferences, updatePreferences } = useUI();
  const { projects = [], customers = [], materials = [], quotes = [], addProject, updateProject, deleteProject } = useData();
  const { user, hasPermission } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [form, setForm] = useState(emptyProject);
  const [selected, setSelected] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [financials, setFinancials] = useState(null);
  const [edgeCatalog, setEdgeCatalog] = useState([]);
  const [linearCatalog, setLinearCatalog] = useState([]);

  const canCreate = hasPermission('projects.create');
  const canEdit = hasPermission('projects.edit');
  const canDelete = hasPermission('projects.delete');
  const canViewFinancials = ['admin', 'manager'].includes(user?.role || '') && hasPermission('invoices.view');
  const operationalOnly = !canViewFinancials;

  useEffect(() => {
    setBreadcrumbs([{ label: 'Progetti' }]);
  }, [setBreadcrumbs]);

  useEffect(() => {
    if (!hasPermission('materials.view')) return undefined;
    let active = true;
    Promise.all([
      apiClient.get('/edge-types').catch(() => ({ data: [] })),
      apiClient.get('/linear-items').catch(() => ({ data: [] })),
    ]).then(([edges, linear]) => {
      if (active) { setEdgeCatalog(edges.data || []); setLinearCatalog(linear.data || []); }
    });
    return () => { active = false; };
  }, [hasPermission]);

  useEffect(() => {
    const intent = userPreferences.pendingDocumentIntent;
    if (!intent || intent.targetType !== 'project' || intent.sourceType !== 'quote') return;
    const quote = quotes.find((item) => String(item.id) === String(intent.sourceId));
    if (!quote) return;
    setForm({
      ...emptyProject(),
      name: `Progetto ${quote.quoteNumber || quote.id}`,
      clientId: String(quote.customerId || ''),
      startDate: localDateKey(),
      workLines: copyWorkLines(quote.workLines?.length ? quote.workLines : quote.items, 'quote', quote.id, quote.version),
      quoteId: String(quote.id),
      importSource: { sourceType: 'quote', sourceId: String(quote.id), sourceVersion: quote.version, importedAt: new Date().toISOString() },
    });
    showModal({ id: 'addProject', type: 'add' });
    updatePreferences({ pendingDocumentIntent: null });
  }, [quotes, showModal, updatePreferences, userPreferences.pendingDocumentIntent]);

  useEffect(() => {
    if (userPreferences.openType !== 'project' || !userPreferences.openId) return;
    const found = projects.find((project) => String(project.id) === String(userPreferences.openId));
    if (!found) return;
    void openView(found);
    updatePreferences({ openId: null, openType: null });
  }, [projects, userPreferences.openId, userPreferences.openType]);

  const filtered = useMemo(() => projects.filter((project) => {
    const query = searchTerm.trim().toLowerCase();
    const matchesSearch = !query
      || String(project.name || '').toLowerCase().includes(query)
      || String(project.client || project.clientName || '').toLowerCase().includes(query);
    return matchesSearch && (!statusFilter || project.status === statusFilter);
  }), [projects, searchTerm, statusFilter]);

  const openAdd = () => {
    setForm(emptyProject());
    showModal({ id: 'addProject', type: 'add' });
  };

  const openEdit = (project) => {
    setSelected(project);
    setForm({
      ...project,
      clientId: String(project.clientId || ''),
    });
    showModal({ id: 'editProject', type: 'edit' });
  };

  const openView = async (project) => {
    setSelected(project);
    setFinancials(null);
    if (canViewFinancials) {
      try { const response = await apiClient.get(`/projects/${encodeURIComponent(project.id)}/financials`); setFinancials(response.data); } catch { /* Messaggio non necessario: dati operativi restano visibili. */ }
    }
    showModal({ id: 'viewProject', type: 'view' });
  };

  const submitAdd = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const customer = customers.find((item) => String(item.id) === String(form.clientId));
      const { budget: _legacyBudget, ...projectForm } = form;
      const success = await addProject({
        ...projectForm,
        clientId: String(form.clientId),
        client: customer?.name || 'Cliente non specificato',
      });
      if (success) hideModal('addProject');
    } finally {
      setSaving(false);
    }
  };

  const submitEdit = async (event) => {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    try {
      const { budget: _legacyBudget, ...projectForm } = form;
      const payload = operationalOnly
        ? {
          status: form.status,
          phase: form.phase,
          productionNotes: form.productionNotes,
          version: selected.version,
        }
        : {
          ...projectForm,
          clientId: String(form.clientId),
          version: selected.version,
        };
      const success = await updateProject(String(selected.id), payload);
      if (success) {
        hideModal('editProject');
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
      const success = await deleteProject(String(deleteId));
      if (success) {
        hideModal('confirmDelete');
        setDeleteId(null);
      }
    } finally {
      setSaving(false);
    }
  };

  const queueProjectIntent = (project, target) => {
    const permission = target === 'quote' ? 'quotes.create' : 'invoices.create';
    if (!hasPermission(permission)) return;
    const includePhotos = target === 'invoice'
      ? window.confirm('Copiare nella fattura le foto tecniche del progetto?')
      : false;
    updatePreferences({
      currentPage: target === 'quote' ? 'quotes' : 'invoices',
      pendingDocumentIntent: {
        intentId: `project-${project.id}-${target}-${Date.now()}`,
        targetType: target,
        sourceType: 'project',
        sourceId: String(project.id),
        sourceVersion: project.version,
        includePhotos,
        createdAt: new Date().toISOString(),
      },
    });
    hideModal('viewProject');
    toast.success('Modulo di creazione aperto: controlla e modifica prima di salvare');
  };

  return (
    <div className="p-6 bg-light-bg dark:bg-dark-bg text-light-text dark:text-dark-text">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-semibold">Progetti</h1>
        {canCreate && (
          <button onClick={openAdd} className="px-4 py-2 bg-light-primary text-white rounded-md flex items-center gap-2">
            <Plus size={19} /> Nuovo progetto
          </button>
        )}
      </div>

      <div className="bg-white dark:bg-dark-card rounded-lg shadow-sm">
        <div className="p-4 border-b border-light-border dark:border-dark-border">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={19} />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Cerca progetto o cliente..."
                className="w-full pl-10 pr-4 py-2 border rounded-md bg-light-bg dark:bg-dark-input"
              />
            </div>
            <button onClick={() => setShowFilters((value) => !value)} className="px-4 py-2 border rounded-md flex items-center gap-2">
              <Filter size={18} /> Filtri
            </button>
          </div>
          {showFilters && (
            <div className="mt-4 max-w-xs">
              <label className="block text-sm font-medium mb-1">Stato</label>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input">
                <option value="">Tutti</option>
                {PROJECT_STATUS_OPTIONS.map((status) => <option key={status}>{status}</option>)}
              </select>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-light-bg dark:bg-dark-bg">
              <tr>
                <th className="px-5 py-3 text-left text-xs uppercase text-gray-500">Nome</th>
                <th className="px-5 py-3 text-left text-xs uppercase text-gray-500">Cliente</th>
                <th className="px-5 py-3 text-left text-xs uppercase text-gray-500">Scadenza</th>
                <th className="px-5 py-3 text-left text-xs uppercase text-gray-500">Fase</th>
                <th className="px-5 py-3 text-left text-xs uppercase text-gray-500">Stato</th>
                <th className="px-5 py-3 text-right text-xs uppercase text-gray-500">Azioni</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-light-border dark:divide-dark-border">
              {filtered.map((project) => (
                <tr key={project.id}>
                  <td className="px-5 py-4 font-medium">{project.name}</td>
                  <td className="px-5 py-4">{project.client || project.clientName || '-'}</td>
                  <td className="px-5 py-4">{project.deadline || '-'}</td>
                  <td className="px-5 py-4">{project.phase || '-'}</td>
                  <td className="px-5 py-4">
                    <span className="px-2.5 py-1 rounded-full text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300">{project.status}</span>
                    {project._queued && <span className="ml-2 text-xs text-orange-600">in coda</span>}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => void openView(project)} className="p-1.5 text-blue-600" title="Visualizza"><Eye size={19} /></button>
                      {canEdit && <button onClick={() => openEdit(project)} className="p-1.5 text-yellow-600" title="Modifica"><Edit size={19} /></button>}
                      {canDelete && (
                        <button
                          onClick={() => {
                            setDeleteId(project.id);
                            showModal({ id: 'confirmDelete', type: 'delete' });
                          }}
                          className="p-1.5 text-red-600"
                          title="Elimina"
                        >
                          <Trash size={19} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr><td colSpan="6" className="px-6 py-12 text-center text-gray-500">Nessun progetto trovato.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen('addProject') && (
        <Modal title="Nuovo progetto" onClose={() => hideModal('addProject')} size="lg">
          <form onSubmit={submitAdd}>
            <ProjectForm value={form} setValue={setForm} customers={customers} materials={materials} quotes={quotes} edgeCatalog={edgeCatalog} linearCatalog={linearCatalog} canViewFinancials={canViewFinancials} />
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => hideModal('addProject')} className="px-4 py-2 border rounded-md">Annulla</button>
              <button disabled={saving} className="px-4 py-2 bg-light-primary text-white rounded-md disabled:bg-gray-400">{saving ? 'Salvataggio...' : 'Crea'}</button>
            </div>
          </form>
        </Modal>
      )}

      {isModalOpen('editProject') && selected && (
        <Modal title={operationalOnly ? 'Aggiorna lavorazione' : 'Modifica progetto'} onClose={() => hideModal('editProject')} size="lg">
          <form onSubmit={submitEdit}>
            <ProjectForm value={form} setValue={setForm} customers={customers} materials={materials} quotes={quotes} edgeCatalog={edgeCatalog} linearCatalog={linearCatalog} canViewFinancials={canViewFinancials} operationalOnly={operationalOnly} />
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => hideModal('editProject')} className="px-4 py-2 border rounded-md">Annulla</button>
              <button disabled={saving} className="px-4 py-2 bg-light-primary text-white rounded-md disabled:bg-gray-400">{saving ? 'Salvataggio...' : 'Salva'}</button>
            </div>
          </form>
        </Modal>
      )}

      {isModalOpen('viewProject') && selected && (
        <Modal title="Dettagli progetto" onClose={() => hideModal('viewProject')} size="3xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div><span className="text-gray-500">Nome</span><p className="font-medium text-base">{selected.name}</p></div>
            <div><span className="text-gray-500">Cliente</span><p className="font-medium text-base">{selected.client || selected.clientName || '-'}</p></div>
            <div><span className="text-gray-500">Inizio</span><p>{selected.startDate || '-'}</p></div>
            <div><span className="text-gray-500">Scadenza</span><p>{selected.deadline || '-'}</p></div>
            <div><span className="text-gray-500">Stato / fase</span><p>{selected.status} {selected.phase ? `· ${selected.phase}` : ''}</p></div>
            <div className="md:col-span-2"><span className="text-gray-500">Note di produzione</span><p className="whitespace-pre-wrap">{selected.productionNotes || '-'}</p></div>
            <div className="md:col-span-2"><span className="text-gray-500">Lavorazioni</span><WorkLinesReadOnly value={normalizeWorkLines(selected.workLines, selected.items)} showPrices={canViewFinancials} /></div>
            {canViewFinancials && financials && <div className="md:col-span-2 rounded-md bg-gray-50 p-4 dark:bg-gray-800"><p className="font-semibold">Margine reale</p><div className="mt-2 grid grid-cols-2 gap-2 text-sm md:grid-cols-4"><p>Ricavi fatturati: {formatEuro(financials.revenue)}</p><p>Costi: {formatEuro(financials.totalCost)}</p><p>Margine: {formatEuro(financials.margin)}</p><p>Margine %: {financials.marginPercent == null ? '-' : `${financials.marginPercent}%`}</p></div></div>}
          </div>
          <AttachmentsPanel entityType="project" entityId={String(selected.id)} />
          <div className="mt-4 flex flex-wrap gap-2">{hasPermission('quotes.create') && <button type="button" onClick={() => queueProjectIntent(selected, 'quote')} className="rounded border px-3 py-2 text-sm">Crea preventivo</button>}{hasPermission('invoices.create') && <button type="button" onClick={() => queueProjectIntent(selected, 'invoice')} className="rounded bg-light-primary px-3 py-2 text-sm text-white">Crea fattura</button>}{selected.quoteId && <button type="button" onClick={() => { updatePreferences({ currentPage: 'quotes', openId: String(selected.quoteId), openType: 'quote' }); hideModal('viewProject'); }} className="rounded border px-3 py-2 text-sm">Apri preventivo collegato</button>}</div>
          <div className="mt-6 flex justify-end"><button onClick={() => hideModal('viewProject')} className="px-4 py-2 border rounded-md">Chiudi</button></div>
        </Modal>
      )}

      {isModalOpen('confirmDelete') && (
        <Modal title="Conferma eliminazione" onClose={() => hideModal('confirmDelete')} size="lg">
          <p className="mb-6">Eliminare definitivamente questo progetto?</p>
          <div className="flex justify-end gap-3">
            <button onClick={() => hideModal('confirmDelete')} className="px-4 py-2 border rounded-md">Annulla</button>
            <button onClick={() => void confirmDelete()} disabled={saving} className="px-4 py-2 bg-red-600 text-white rounded-md disabled:bg-gray-400">Elimina</button>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default ProjectsPage;
