import React, { useEffect, useMemo, useState } from 'react';
import { Download, Edit, Eye, FileCheck2, Mail, MessageCircle, Plus, Search, Send, Trash, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';
import useUI from '../hooks/useUI';
import { useAuth } from '../contexts/AuthContext';
import { formatEuro, parseLocaleNumber } from '../utils/numbers';
import AttachmentsPanel from './AttachmentsPanel';
import WorkLinesEditor from './work-lines/WorkLinesEditor';
import EdgeCatalogOverlay from './catalog/EdgeCatalogOverlay';
import { copyWorkLines, mergeImportedWorkLines } from '../domain/work-lines/import';
import { createWorkLine, normalizeWorkLines, workLinesToDocumentItems } from '../domain/work-lines/normalize';
import { refreshCatalogEdgePrices } from '../domain/work-lines/edgeSelector';

const emptyItem = (invoice) => ({
  description: '',
  quantity: 1,
  unitPrice: 0,
  taxRate: invoice ? 22 : 0,
  taxNature: '',
  materialId: '',
});

const emptyDocument = (kind) => ({
  date: new Date().toISOString().slice(0, 10),
  documentType: kind === 'invoice' ? 'TD01' : '',
  dueDate: '',
  customerId: '',
  projectId: '',
  quoteId: '',
  items: [emptyItem(kind === 'invoice')],
  notes: '',
  status: kind === 'invoice' ? 'Non Pagata' : 'Bozza',
  validityDays: '',
  paymentDetails: '',
  paymentMethod: 'MP05',
  templateId: '',
  workLines: [createWorkLine('manual')],
});

const normalizeDocument = (document, kind) => ({
  ...emptyDocument(kind),
  ...document,
  id: document.id == null ? undefined : String(document.id),
  customerId: document.customerId == null ? '' : String(document.customerId),
  projectId: document.projectId == null ? '' : String(document.projectId),
  quoteId: document.quoteId == null ? '' : String(document.quoteId),
  templateId: document.templateId == null ? '' : String(document.templateId),
  paymentMethod: document.paymentMethod == null ? '' : String(document.paymentMethod),
  date: document.date ? String(document.date).slice(0, 10) : '',
  documentType: kind === 'invoice' ? String(document.documentType || 'TD01').toUpperCase() : '',
  dueDate: document.dueDate ? String(document.dueDate).slice(0, 10) : '',
  validityDays: Number.isInteger(Number(document.validityDays)) && Number(document.validityDays) > 0 ? Number(document.validityDays) : '',
  items: Array.isArray(document.items) && document.items.length
    ? document.items.map((item) => ({
      ...emptyItem(kind === 'invoice'),
      ...item,
      materialId: item.materialId == null ? '' : String(item.materialId),
      quantity: parseLocaleNumber(item.quantity),
      unitPrice: parseLocaleNumber(item.unitPrice),
      taxRate: kind === 'invoice' ? parseLocaleNumber(item.taxRate ?? 22) : 0,
      taxNature: String(item.taxNature || '').toUpperCase(),
    }))
    : [emptyItem(kind === 'invoice')],
  workLines: normalizeWorkLines(document.workLines, document.items),
});

const totals = (items, invoice) => {
  const subtotal = items.reduce(
    (sum, item) => sum + parseLocaleNumber(item.quantity) * parseLocaleNumber(item.unitPrice),
    0,
  );
  const tax = invoice
    ? items.reduce((sum, item) => {
      const line = parseLocaleNumber(item.quantity) * parseLocaleNumber(item.unitPrice);
      return sum + line * (parseLocaleNumber(item.taxRate) / 100);
    }, 0)
    : 0;
  return { subtotal, tax, total: subtotal + tax };
};

const formatDate = (value) => {
  if (!value) return '-';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
    ? new Date(`${value}T00:00:00`)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('it-IT');
};

const formatQuoteValidity = (document) => {
  const days = Number(document?.validityDays);
  return Number.isInteger(days) && days > 0 ? String(days) + ' giorni' : 'Senza scadenza';
};

const Modal = ({ title, onClose, children, wide = false }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
    <div className={`w-full ${wide ? 'max-w-4xl' : 'max-w-2xl'} max-h-[92vh] overflow-y-auto rounded-lg bg-white p-6 shadow-xl dark:bg-dark-card`}>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{title}</h2>
        <button type="button" onClick={onClose} className="p-1 text-gray-500"><X size={22} /></button>
      </div>
      {children}
    </div>
  </div>
);

const askImportMode = (sourceLabel) => {
  const answer = window.prompt(
    `Il documento contiene già righe. Importazione da ${sourceLabel}: scrivi "sostituisci", "aggiungi" o "annulla".`,
    'sostituisci',
  );
  const normalized = String(answer || '').trim().toLowerCase();
  if (normalized === 'sostituisci' || normalized === 'replace') return 'replace';
  if (normalized === 'aggiungi' || normalized === 'add') return 'add';
  return 'cancel';
};

const importSourceIntoDocument = (previous, source, sourceType, invoice) => {
  const existing = normalizeWorkLines(previous.workLines, previous.items);
  const mode = existing.length ? askImportMode(sourceType === 'project' ? 'progetto' : 'preventivo') : 'replace';
  if (mode === 'cancel') return previous;
  const imported = copyWorkLines(source.workLines?.length ? source.workLines : source.items, sourceType, source.id, source.version);
  const workLines = mergeImportedWorkLines(existing, imported, mode);
  return {
    ...previous,
    workLines,
    items: workLinesToDocumentItems(workLines, invoice, previous.items),
    importSource: {
      sourceType,
      sourceId: String(source.id),
      sourceVersion: source.version,
      importedAt: new Date().toISOString(),
    },
  };
};

const DocumentForm = ({ kind, value, setValue, customers, projects, quotes, materials, quoteTemplates = [], edgeCatalog = [], linearCatalog = [], showPrices = true, onEdgeCatalogUpdated }) => {
  const invoice = kind === 'invoice';
  const { hasPermission } = useAuth();
  const [edgeSettingsOpen, setEdgeSettingsOpen] = useState(false);
  const lines = normalizeWorkLines(value.workLines, value.items);
  const currentTotals = totals(workLinesToDocumentItems(lines, invoice, value.items), invoice);

  const handleEdgeCatalogChange = (nextCatalog) => {
    onEdgeCatalogUpdated?.(nextCatalog);
    setValue((previous) => {
      const nextLines = refreshCatalogEdgePrices(normalizeWorkLines(previous.workLines, previous.items), nextCatalog);
      return {
        ...previous,
        workLines: nextLines,
        items: workLinesToDocumentItems(nextLines, invoice, previous.items),
      };
    });
  };

  const selectQuote = (quoteId) => {
    const quote = quotes.find((item) => String(item.id) === String(quoteId));
    if (!quote) {
      setValue((previous) => ({ ...previous, quoteId: '' }));
      return;
    }
    setValue((previous) => {
      const imported = importSourceIntoDocument(previous, quote, 'quote', invoice);
      return {
        ...imported,
        quoteId: String(quote.id),
        customerId: quote.customerId == null ? imported.customerId : String(quote.customerId),
        projectId: quote.projectId == null ? imported.projectId : String(quote.projectId),
        notes: imported.notes || quote.notes || '',
      };
    });
  };

  const selectProject = (projectId) => {
    const project = projects.find((item) => String(item.id) === String(projectId));
    if (!project) {
      setValue((previous) => ({ ...previous, projectId: '' }));
      return;
    }
    setValue((previous) => {
      const imported = importSourceIntoDocument(previous, project, 'project', invoice);
      return {
        ...imported,
        projectId: String(project.id),
        customerId: project.clientId == null ? imported.customerId : String(project.clientId),
        notes: imported.notes || project.productionNotes || project.notes || '',
      };
    });
  };

  // CompatibilitÃ  per dati/markup legacy: l'editor visibile usa WorkLinesEditor.
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Data *</span>
          <input type="date" required value={value.date || ''} onChange={(event) => setValue((previous) => ({ ...previous, date: event.target.value }))} className="w-full rounded-md border p-2 bg-light-bg dark:bg-dark-input" />
        </label>

        {!invoice && (
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Modello Word</span>
            <select value={value.templateId || ''} onChange={(event) => setValue((previous) => ({ ...previous, templateId: event.target.value }))} className="w-full rounded-md border p-2 bg-light-bg dark:bg-dark-input">
              <option value="">Seleziona modello per esportazione</option>
              {quoteTemplates.map((template) => <option key={template.id} value={String(template.id)}>{template.name}</option>)}
            </select>
          </label>
        )}

        {invoice ? (
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Scadenza *</span>
            <input type="date" required value={value.dueDate || ''} onChange={(event) => setValue((previous) => ({ ...previous, dueDate: event.target.value }))} className="w-full rounded-md border p-2 bg-light-bg dark:bg-dark-input" />
          </label>
        ) : (
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Validità (giorni)</span>
            <input type="number" min="1" step="1" inputMode="numeric" placeholder="Lascia vuoto" value={value.validityDays ?? ''} onChange={(event) => { const raw = event.target.value; const days = Number(raw); setValue((previous) => ({ ...previous, validityDays: raw === '' ? '' : (Number.isInteger(days) && days > 0 ? days : '') })); }} className="w-full rounded-md border p-2 bg-light-bg dark:bg-dark-input" />
            <span className="mt-1 block text-xs text-gray-500">Vuoto = <strong>Senza scadenza</strong>. Inserisci un numero intero positivo solo se vuoi una validità.</span>
          </label>
        )}

        {invoice && <label className="block"><span className="mb-1 block text-sm font-medium">Tipo documento elettronico</span><select value={value.documentType || 'TD01'} onChange={(event) => setValue((previous) => ({ ...previous, documentType: event.target.value }))} className="w-full rounded-md border p-2 bg-light-bg dark:bg-dark-input"><option value="TD01">TD01 — Fattura</option><option value="TD03">TD03 — Acconto/anticipo su fattura</option><option value="TD04">TD04 — Nota di credito</option></select></label>}

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Cliente *</span>
          <select required value={value.customerId || ''} onChange={(event) => setValue((previous) => ({ ...previous, customerId: event.target.value }))} className="w-full rounded-md border p-2 bg-light-bg dark:bg-dark-input">
            <option value="">Seleziona cliente</option>
            {[...customers].sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'it', { sensitivity: 'base' })).map((customer) => <option key={customer.id} value={String(customer.id)}>{customer.name}</option>)}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Progetto</span>
          <select value={value.projectId || ''} onChange={(event) => selectProject(event.target.value)} className="w-full rounded-md border p-2 bg-light-bg dark:bg-dark-input">
            <option value="">Nessun progetto</option>
            {projects.filter((project) => !value.customerId || String(project.clientId) === String(value.customerId)).map((project) => <option key={project.id} value={String(project.id)}>{project.name}</option>)}
          </select>
        </label>

        {invoice && (
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Preventivo collegato</span>
            <select value={value.quoteId || ''} onChange={(event) => selectQuote(event.target.value)} className="w-full rounded-md border p-2 bg-light-bg dark:bg-dark-input">
              <option value="">Nessun preventivo</option>
              {quotes.map((quote) => <option key={quote.id} value={String(quote.id)}>{quote.quoteNumber || 'Preventivo senza numero'}</option>)}
            </select>
          </label>
        )}

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Stato</span>
          <select value={value.status || ''} onChange={(event) => setValue((previous) => ({ ...previous, status: event.target.value }))} className="w-full rounded-md border p-2 bg-light-bg dark:bg-dark-input">
            {(invoice
              ? ['Non Pagata', 'Pagata Parzialmente', 'Pagata', 'Scaduta']
              : ['Bozza', 'Inviato', 'Accettato', 'Rifiutato', 'Scaduto']
            ).map((status) => <option key={status}>{status}</option>)}
          </select>
        </label>
      </div>

      <WorkLinesEditor
        value={lines}
        onChange={(nextLines) => setValue((previous) => ({
          ...previous,
          workLines: nextLines,
          items: workLinesToDocumentItems(nextLines, invoice, previous.items),
        }))}
        materials={materials}
        edgeCatalog={edgeCatalog}
        linearCatalog={linearCatalog}
        invoiceMode={invoice}
        showPrices={showPrices}
        onOpenEdgeCatalog={!invoice ? () => setEdgeSettingsOpen(true) : undefined}
      />
      {!invoice && <EdgeCatalogOverlay open={edgeSettingsOpen} items={edgeCatalog} materials={materials} canCreate={hasPermission('materials.create')} canEdit={hasPermission('materials.edit')} canDelete={hasPermission('materials.delete')} showPrices={showPrices} onItemsChange={handleEdgeCatalogChange} onClose={() => setEdgeSettingsOpen(false)} />}



      <label className="block">
        <span className="mb-1 block text-sm font-medium">Note</span>
        <textarea rows={3} value={value.notes || ''} onChange={(event) => setValue((previous) => ({ ...previous, notes: event.target.value }))} className="w-full rounded-md border p-2 bg-light-bg dark:bg-dark-input" />
      </label>

      {invoice && (
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Dettagli pagamento</span>
          <textarea rows={2} value={value.paymentDetails || ''} onChange={(event) => setValue((previous) => ({ ...previous, paymentDetails: event.target.value }))} className="w-full rounded-md border p-2 bg-light-bg dark:bg-dark-input" />
        </label>
      )}
      {invoice && <label className="block"><span className="mb-1 block text-sm font-medium">Metodo pagamento elettronico</span><select value={value.paymentMethod || ''} onChange={(event) => setValue((previous) => ({ ...previous, paymentMethod: event.target.value }))} className="w-full rounded-md border p-2 bg-light-bg dark:bg-dark-input"><option value="">Non indicare nel file XML</option><option value="MP05">Bonifico</option><option value="MP01">Contanti</option><option value="MP12">Ri.Ba.</option><option value="MP02">Assegno</option><option value="MP08">Carta pagamento</option></select></label>}

      <div className="rounded-md bg-gray-50 p-3 text-right dark:bg-gray-800">
        <p>Imponibile: {formatEuro(currentTotals.subtotal)}</p>
        {invoice && <p>IVA: {formatEuro(currentTotals.tax)}</p>}
        <p className="text-lg font-semibold">Totale: {formatEuro(currentTotals.total)}</p>
      </div>
    </div>
  );
};

const BusinessDocumentPage = ({
  kind,
  documents = [],
  customers = [],
  projects = [],
  quotes = [],
  materials = [],
  quoteTemplates = [],
  addDocument,
  updateDocument,
  deleteDocument,
}) => {
  const { isModalOpen, showModal, hideModal, setBreadcrumbs, userPreferences, updatePreferences } = useUI();
  const { hasPermission, user } = useAuth();
  const invoice = kind === 'invoice';
  const plural = invoice ? 'Fatture' : 'Preventivi';
  const singular = invoice ? 'fattura' : 'preventivo';
  const numberField = invoice ? 'invoiceNumber' : 'quoteNumber';
  const permission = invoice ? 'invoices' : 'quotes';
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [viewingId, setViewingId] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [form, setForm] = useState(() => emptyDocument(kind));
  const [saving, setSaving] = useState(false);
  const [emailDraft, setEmailDraft] = useState(null);
  const [drafting, setDrafting] = useState(false);
  const [sdiInvoice, setSdiInvoice] = useState(null);
  const [sdiPreflight, setSdiPreflight] = useState(null);
  const [sdiError, setSdiError] = useState('');
  const [sdiBusy, setSdiBusy] = useState(false);
  const [edgeCatalog, setEdgeCatalog] = useState([]);
  const [linearCatalog, setLinearCatalog] = useState([]);

  const viewing = documents.find((document) => String(document.id) === String(viewingId));
  const canUseSdi = invoice && user?.role === 'admin';
  const canViewFinancials = ['admin', 'manager'].includes(user?.role || '') && hasPermission('invoices.view');
  const electronicStatus = (document) => String(document?.electronicInvoice?.status || 'bozza');
  const transmitted = (document) => ['inviata_pec', 'consegnata', 'mancata_consegna'].includes(electronicStatus(document));

  useEffect(() => {
    setBreadcrumbs([{ label: plural }]);
  }, [plural, setBreadcrumbs]);

  useEffect(() => {
    if (!hasPermission('materials.view')) return undefined;
    let active = true;
    Promise.all([
      apiClient.get('/edge-types').catch(() => ({ data: [] })),
      apiClient.get('/linear-items').catch(() => ({ data: [] })),
    ]).then(([edges, linear]) => {
      if (!active) return;
      setEdgeCatalog(edges.data || []);
      setLinearCatalog(linear.data || []);
    });
    return () => { active = false; };
  }, [hasPermission]);

  useEffect(() => {
    const intent = userPreferences.pendingDocumentIntent;
    if (!intent || intent.targetType !== kind || !intent.sourceId) return;
    const sources = intent.sourceType === 'quote' ? quotes : projects;
    const source = sources.find((item) => String(item.id) === String(intent.sourceId));
    if (!source) return;
    const draft = { ...emptyDocument(kind), workLines: [], items: [] };
    const imported = importSourceIntoDocument(draft, source, intent.sourceType, invoice);
    setForm({
      ...imported,
      customerId: String(source.customerId || source.clientId || imported.customerId || ''),
      projectId: String(source.projectId || (intent.sourceType === 'project' ? source.id : imported.projectId) || ''),
      quoteId: intent.sourceType === 'quote' ? String(source.id) : String(source.quoteId || imported.quoteId || ''),
      includePhotos: invoice && intent.includePhotos === true,
    });
    showModal({ id: `${kind}-add`, type: 'add' });
    updatePreferences({ pendingDocumentIntent: null });
  }, [invoice, kind, projects, quotes, showModal, updatePreferences, userPreferences.pendingDocumentIntent]);

  useEffect(() => {
    if (userPreferences.openType !== kind || !userPreferences.openId) return;
    const found = documents.find((document) => String(document.id) === String(userPreferences.openId));
    if (!found) return;
    setViewingId(String(found.id));
    showModal({ id: `${kind}-view`, type: 'view' });
    updatePreferences({ openId: null, openType: null });
  }, [documents, kind, showModal, updatePreferences, userPreferences.openId, userPreferences.openType]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...documents]
      .filter((document) => {
        if (!query) return true;
        const customer = customers.find((item) => String(item.id) === String(document.customerId));
        const project = projects.find((item) => String(item.id) === String(document.projectId));
        return [document[numberField], document.status, customer?.name, project?.name]
          .some((value) => String(value || '').toLowerCase().includes(query));
      })
      .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
  }, [customers, documents, numberField, projects, search]);

  const payload = () => {
    const workLines = normalizeWorkLines(form.workLines, form.items);
    const items = workLinesToDocumentItems(workLines, invoice, form.items)
      .map(({ workLine, ...item }) => item);
    return {
      ...form,
      customerId: String(form.customerId),
      projectId: form.projectId ? String(form.projectId) : null,
      quoteId: invoice && form.quoteId ? String(form.quoteId) : null,
      validityDays: Number.isInteger(Number(form.validityDays)) && Number(form.validityDays) > 0 ? Number(form.validityDays) : null,
      workLines,
      items,
    };
  };

  const submitAdd = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const success = await addDocument(payload());
      if (success) hideModal(`${kind}-add`);
    } finally {
      setSaving(false);
    }
  };

  const submitEdit = async (event) => {
    event.preventDefault();
    if (!editing) return;
    setSaving(true);
    try {
      const success = await updateDocument(String(editing.id), {
        ...payload(),
        version: editing.version,
        [numberField]: editing[numberField],
      });
      if (success) {
        hideModal(`${kind}-edit`);
        setEditing(null);
      }
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setSaving(true);
    try {
      const success = await deleteDocument(String(deleting.id));
      if (success) {
        hideModal(`${kind}-delete`);
        setDeleting(null);
      }
    } finally {
      setSaving(false);
    }
  };

  const documentCustomer = (document) => customers.find(
    (item) => String(item.id) === String(document.customerId),
  )?.name || '-';

  const quoteMessage = (document) => {
    const customer = customers.find((item) => String(item.id) === String(document.customerId));
    return {
      customer,
      text: `Buongiorno ${customer?.name || ''},\nle inviamo il preventivo ${document.quoteNumber || ''} del ${formatDate(document.date)} per un totale di ${formatEuro(document.total)}.\nRimaniamo a disposizione.`,
    };
  };
  const sendQuote = (document) => {
    const { customer, text } = quoteMessage(document);
    const phone = String(customer?.phone || '').replace(/\D/g, '');
    if (!phone) { toast.error('Il cliente non ha un numero di telefono'); return; }
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  };
  const openGmailDraft = (document) => {
    const { customer, text } = quoteMessage(document);
    if (!hasPermission('quotes.edit')) { toast.error('Permesso modifica preventivi richiesto'); return; }
    if (!customer?.email) { toast.error('Il cliente non ha un indirizzo email'); return; }
    if (!document.templateId) { toast.error('Seleziona un modello Word nel preventivo'); return; }
    setEmailDraft({ document, subject: `Preventivo ${document.quoteNumber || ''}`, text });
    showModal({ id: 'quote-gmail-draft', type: 'email' });
  };
  const createGmailDraft = async (event) => {
    event.preventDefault();
    if (!emailDraft) return;
    const gmailWindow = window.open('', 'crm-gmail-drafts');
    if (!gmailWindow) { toast.error('Popup Gmail bloccato dal browser'); return; }
    setDrafting(true);
    try {
      const response = await apiClient.post(`/quotes/${emailDraft.document.id}/gmail-draft`, {
        templateId: emailDraft.document.templateId,
        subject: emailDraft.subject,
        text: emailDraft.text,
      });
      hideModal('quote-gmail-draft');
      setEmailDraft(null);
      gmailWindow.location.href = response.data.gmailUrl;
      toast.success('Bozza Gmail creata con Word allegato');
    } catch (error) { gmailWindow.close(); toast.error(error.response?.data?.error || 'Creazione bozza Gmail non riuscita'); } finally { setDrafting(false); }
  };
  const downloadQuoteWord = async (quote) => {
    if (!quote.templateId) { toast.error('Seleziona un modello Word nel preventivo'); return; }
    try {
      const response = await apiClient.get(`/quotes/${quote.id}/document`, { params: { templateId: quote.templateId }, responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const link = window.document.createElement('a');
      link.href = url; link.download = `preventivo-${quote.quoteNumber || quote.id}.docx`;
      window.document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    } catch (error) { toast.error(error.response?.data?.error || 'Creazione Word non riuscita'); }
  };
  const queueDocumentIntent = (source, target, includePhotos) => {
    const permissionName = target === 'project' ? 'projects.create' : 'invoices.create';
    if (!source || !hasPermission(permissionName)) return;
    const confirmedPhotos = target === 'invoice'
      ? window.confirm('Copiare nella fattura le foto del preventivo marcate "In Word"?')
      : includePhotos;
    updatePreferences({
      currentPage: target === 'project' ? 'projects' : 'invoices',
      pendingDocumentIntent: {
        intentId: `${kind}-${source.id}-${Date.now()}`,
        targetType: target,
        sourceType: kind,
        sourceId: String(source.id),
        sourceVersion: source.version,
        includePhotos: confirmedPhotos === true,
        createdAt: new Date().toISOString(),
      },
    });
    hideModal(`${kind}-view`);
    toast.success('Modulo di creazione aperto: controlla e modifica prima di salvare');
  };
  const openSdi = async (document) => {
    setSdiInvoice(document); setSdiPreflight(null); setSdiError(''); showModal({ id: 'invoice-sdi-confirm', type: 'confirm' });
    setSdiBusy(true);
    try {
      const response = await apiClient.get(`/invoices/${document.id}/electronic/preflight`);
      setSdiPreflight(response.data);
    } catch (error) {
      const message = error.response?.data?.error || 'Controllo FatturaPA non riuscito';
      setSdiError(message); toast.error(message);
    } finally { setSdiBusy(false); }
  };
  const sendSdi = async () => {
    if (!sdiInvoice || !sdiPreflight?.valid) return;
    setSdiBusy(true);
    try {
      await apiClient.post(`/invoices/${sdiInvoice.id}/electronic/send`, { confirm: true });
      toast.success('XML inviato via PEC a SdI. Attendo ricevuta.');
      hideModal('invoice-sdi-confirm'); setSdiInvoice(null); setSdiPreflight(null);
    } catch (error) { toast.error(error.response?.data?.error || 'Invio SdI non riuscito'); } finally { setSdiBusy(false); }
  };
  const downloadSdiXml = async (document) => {
    try {
      const response = await apiClient.get(`/invoices/${document.id}/electronic/xml`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data); const link = window.document.createElement('a');
      link.href = url; link.download = document.electronicInvoice?.fileName || `fattura-${document.invoiceNumber || document.id}.xml`;
      window.document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    } catch (error) { toast.error(error.response?.data?.error || 'Esportazione XML non riuscita'); }
  };

  return (
    <div className="min-h-screen bg-light-bg p-6 text-light-text dark:bg-dark-bg dark:text-dark-text">
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{plural}</h1>
        {hasPermission(`${permission}.create`) && (
          <button type="button" onClick={() => { setForm(emptyDocument(kind)); showModal({ id: `${kind}-add`, type: 'add' }); }} className="flex items-center gap-2 rounded-md bg-light-primary px-4 py-2 text-white">
            <Plus size={19} /> Nuovo {singular}
          </button>
        )}
      </div>

      <div className="rounded-lg bg-white shadow-sm dark:bg-dark-card">
        <div className="border-b p-4 dark:border-dark-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={19} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Cerca ${singular}, cliente, progetto o stato...`} className="w-full rounded-md border bg-light-bg py-2 pl-10 pr-4 dark:bg-dark-input" />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-light-bg dark:bg-dark-bg">
              <tr>
                <th className="px-5 py-3 text-left text-xs uppercase text-gray-500">Numero</th>
                <th className="px-5 py-3 text-left text-xs uppercase text-gray-500">Data</th>
                <th className="px-5 py-3 text-left text-xs uppercase text-gray-500">Cliente</th>
                <th className="px-5 py-3 text-left text-xs uppercase text-gray-500">Totale</th>
                <th className="px-5 py-3 text-left text-xs uppercase text-gray-500">Stato</th>
                <th className="px-5 py-3 text-right text-xs uppercase text-gray-500">Azioni</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-dark-border">
              {filtered.map((document) => (
                <tr key={document.id}>
                  <td className="px-5 py-4 font-medium">{document[numberField] || (document._queued ? 'In attesa' : '-')}</td>
                  <td className="px-5 py-4">{formatDate(document.date)}</td>
                  <td className="px-5 py-4">{documentCustomer(document)}</td>
                  <td className="px-5 py-4">{formatEuro(document.total)}</td>
                  <td className="px-5 py-4"><span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs text-blue-800 dark:bg-blue-900/20 dark:text-blue-300">{document.status || '-'}</span>{invoice && electronicStatus(document) !== 'bozza' && <span className="ml-2 text-xs text-orange-700 dark:text-orange-300">SdI: {electronicStatus(document).replace(/_/g, ' ')}</span>}{document._queued && <span className="ml-2 text-xs text-orange-600">in coda</span>}</td>
                  <td className="px-5 py-4">
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => { setViewingId(String(document.id)); showModal({ id: `${kind}-view`, type: 'view' }); }} className="p-1.5 text-blue-600" title="Visualizza"><Eye size={18} /></button>
                      {!invoice && <><button type="button" onClick={() => sendQuote(document)} className="p-1.5 text-green-600" title="Invia WhatsApp"><MessageCircle size={18} /></button><button type="button" onClick={() => openGmailDraft(document)} className="p-1.5 text-indigo-600" title="Crea bozza Gmail"><Mail size={18} /></button><button type="button" onClick={() => void downloadQuoteWord(document)} className="flex items-center gap-1 rounded border px-2 py-1 text-xs text-gray-700 dark:text-gray-200" title="Scarica preventivo Word"><Download size={16} /> Scarica</button></>}
                      {canUseSdi && !transmitted(document) && electronicStatus(document) !== 'invio_in_corso' && <button type="button" onClick={() => void openSdi(document)} className="p-1.5 text-orange-600" title="Invia a SdI via PEC"><Send size={18} /></button>}
                      {canUseSdi && <button type="button" onClick={() => void downloadSdiXml(document)} className="flex items-center gap-1 rounded border px-2 py-1 text-xs text-gray-700 dark:text-gray-200" title="Scarica fattura XML FatturaPA"><Download size={16} /> Scarica</button>}
                      {hasPermission(`${permission}.edit`) && !transmitted(document) && <button type="button" onClick={() => { setEditing(document); setForm(normalizeDocument(document, kind)); showModal({ id: `${kind}-edit`, type: 'edit' }); }} className="p-1.5 text-yellow-600" title="Modifica"><Edit size={18} /></button>}
                      {hasPermission(`${permission}.delete`) && !transmitted(document) && <button type="button" onClick={() => { setDeleting(document); showModal({ id: `${kind}-delete`, type: 'delete' }); }} className="p-1.5 text-red-600" title="Elimina"><Trash size={18} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
              {!filtered.length && <tr><td colSpan="6" className="px-6 py-12 text-center text-gray-500">Nessun {singular} trovato.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen(`${kind}-add`) && (
        <Modal title={`Nuovo ${singular}`} onClose={() => hideModal(`${kind}-add`)} wide>
          <form onSubmit={submitAdd}>
            <DocumentForm kind={kind} value={form} setValue={setForm} customers={customers} projects={projects} quotes={quotes} materials={materials} quoteTemplates={quoteTemplates} edgeCatalog={edgeCatalog} linearCatalog={linearCatalog} showPrices={canViewFinancials} onEdgeCatalogUpdated={setEdgeCatalog} />
            <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => hideModal(`${kind}-add`)} className="rounded-md border px-4 py-2">Annulla</button><button disabled={saving} className="rounded-md bg-light-primary px-4 py-2 text-white disabled:bg-gray-400">{saving ? 'Salvataggio...' : 'Crea'}</button></div>
          </form>
        </Modal>
      )}

      {isModalOpen(`${kind}-edit`) && editing && (
        <Modal title={`Modifica ${singular}`} onClose={() => hideModal(`${kind}-edit`)} wide>
          <form onSubmit={submitEdit}>
            <DocumentForm kind={kind} value={form} setValue={setForm} customers={customers} projects={projects} quotes={quotes} materials={materials} quoteTemplates={quoteTemplates} edgeCatalog={edgeCatalog} linearCatalog={linearCatalog} showPrices={canViewFinancials} onEdgeCatalogUpdated={setEdgeCatalog} />
            <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => hideModal(`${kind}-edit`)} className="rounded-md border px-4 py-2">Annulla</button><button disabled={saving} className="rounded-md bg-light-primary px-4 py-2 text-white disabled:bg-gray-400">{saving ? 'Salvataggio...' : 'Salva'}</button></div>
          </form>
        </Modal>
      )}

      {isModalOpen(`${kind}-view`) && viewing && (
        <Modal title={viewing[numberField] || singular} onClose={() => hideModal(`${kind}-view`)}>
          <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
            <div><span className="text-gray-500">Data</span><p>{formatDate(viewing.date)}</p></div>
            {invoice && <div><span className="text-gray-500">Scadenza</span><p>{formatDate(viewing.dueDate)}</p></div>}
            {!invoice && <div><span className="text-gray-500">Validità</span><p className={formatQuoteValidity(viewing) === 'Senza scadenza' ? 'text-green-700 dark:text-green-400' : ''}>{formatQuoteValidity(viewing)}</p></div>}
            <div><span className="text-gray-500">Cliente</span><p>{documentCustomer(viewing)}</p></div>
            <div><span className="text-gray-500">Stato</span><p>{viewing.status || '-'}</p></div>
            {invoice && <div><span className="text-gray-500">Esito SdI</span><p>{electronicStatus(viewing).replace(/_/g, ' ')}</p></div>}
            <div><span className="text-gray-500">Totale</span><p className="font-semibold">{formatEuro(viewing.total)}</p></div>
            <div className="md:col-span-2"><span className="text-gray-500">Note</span><p className="whitespace-pre-wrap">{viewing.notes || '-'}</p></div>
          </div>
          <div className="mt-5 space-y-2">
            {(viewing.items || []).map((item, index) => <div key={index} className="flex justify-between gap-3 border-b py-2 text-sm dark:border-dark-border"><span>{item.description} · {item.quantity} × {formatEuro(item.unitPrice)}</span><strong>{formatEuro(totals([item], invoice).total)}</strong></div>)}
          </div>
          <AttachmentsPanel entityType={kind} entityId={String(viewing.id)} />
          {!invoice && <div className="mt-3 flex flex-wrap gap-2">{hasPermission('projects.create') && <button type="button" onClick={() => queueDocumentIntent(viewing, 'project')} className="rounded-md border px-3 py-2 text-sm">Crea progetto</button>}{hasPermission('invoices.create') && <button type="button" onClick={() => queueDocumentIntent(viewing, 'invoice')} className="rounded-md bg-light-primary px-3 py-2 text-sm text-white">Crea fattura</button>}</div>}
          {invoice && viewing.projectId && <button type="button" onClick={() => { updatePreferences({ currentPage: 'projects', openId: String(viewing.projectId), openType: 'project' }); hideModal('invoice-view'); }} className="mt-3 rounded border px-3 py-2 text-sm">Apri progetto collegato</button>}
          {invoice && viewing.quoteId && <button type="button" onClick={() => { updatePreferences({ currentPage: 'quotes', openId: String(viewing.quoteId), openType: 'quote' }); hideModal('invoice-view'); }} className="ml-2 mt-3 rounded border px-3 py-2 text-sm">Apri preventivo collegato</button>}
          {!invoice && viewing.projectId && <button type="button" onClick={() => { updatePreferences({ currentPage: 'projects', openId: String(viewing.projectId), openType: 'project' }); hideModal('quote-view'); }} className="mt-3 rounded border px-3 py-2 text-sm">Apri progetto collegato</button>}
          {!invoice && <div className="mt-5 flex flex-wrap gap-2"><button type="button" onClick={() => sendQuote(viewing)} className="flex items-center gap-2 rounded-md bg-green-600 px-3 py-2 text-sm text-white"><MessageCircle size={16} /> WhatsApp</button><button type="button" onClick={() => openGmailDraft(viewing)} className="flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-2 text-sm text-white"><Mail size={16} /> Crea bozza Gmail</button><button type="button" onClick={() => void downloadQuoteWord(viewing)} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"><Download size={16} /> Word compilato</button></div>}
          {invoice && canUseSdi && <div className="mt-5 flex flex-wrap gap-2"><button type="button" onClick={() => void downloadSdiXml(viewing)} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"><FileCheck2 size={16} /> Scarica XML FatturaPA</button>{!transmitted(viewing) && electronicStatus(viewing) !== 'invio_in_corso' && <button type="button" onClick={() => void openSdi(viewing)} className="flex items-center gap-2 rounded-md bg-orange-600 px-3 py-2 text-sm text-white"><Send size={16} /> Invia a SdI via PEC</button>}</div>}
        </Modal>
      )}

      {isModalOpen('invoice-sdi-confirm') && sdiInvoice && (
        <Modal title="Invio fiscale a SdI" onClose={() => { if (!sdiBusy) { hideModal('invoice-sdi-confirm'); setSdiInvoice(null); } }}>
          <p className="mb-4 text-sm text-gray-700 dark:text-gray-300">Questa azione invia la fattura elettronica <strong>{sdiInvoice.invoiceNumber}</strong> a SdI tramite PEC Aruba. Dopo accettazione PEC, fattura non è più modificabile dal CRM.</p>
          {sdiBusy && !sdiPreflight ? <p className="mb-4 text-sm text-gray-500">Controllo dati FatturaPA…</p> : sdiPreflight ? <div className="mb-4 rounded border border-green-300 bg-green-50 p-3 text-sm text-green-900 dark:bg-green-950/30 dark:text-green-100"><p>Controllo superato.</p><p>File: <strong>{sdiPreflight.fileName}</strong></p><p>Destinatario: {sdiPreflight.recipientCode}</p></div> : <div className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{sdiError || 'Correggi campi fiscali indicati dal controllo prima di inviare.'}</div>}
          <div className="flex justify-end gap-3"><button type="button" disabled={sdiBusy} onClick={() => { hideModal('invoice-sdi-confirm'); setSdiInvoice(null); }} className="rounded-md border px-4 py-2">Annulla</button><button type="button" disabled={sdiBusy || !sdiPreflight?.valid} onClick={() => void sendSdi()} className="rounded-md bg-orange-600 px-4 py-2 text-white disabled:opacity-50">{sdiBusy ? 'Invio...' : 'Conferma invio SdI'}</button></div>
        </Modal>
      )}

      {isModalOpen('quote-gmail-draft') && emailDraft && (
        <Modal title="Bozza Gmail preventivo" onClose={() => { hideModal('quote-gmail-draft'); setEmailDraft(null); }}>
          <form onSubmit={createGmailDraft}>
            <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">Gmail creerà una bozza con Word allegato. Controlla testo, poi invia da Gmail.</p>
            <label className="block"><span className="mb-1 block text-sm font-medium">Oggetto *</span><input required value={emailDraft.subject} onChange={(event) => setEmailDraft((previous) => ({ ...previous, subject: event.target.value }))} className="w-full rounded-md border p-2 dark:bg-dark-input" /></label>
            <label className="mt-4 block"><span className="mb-1 block text-sm font-medium">Messaggio *</span><textarea required rows="7" value={emailDraft.text} onChange={(event) => setEmailDraft((previous) => ({ ...previous, text: event.target.value }))} className="w-full rounded-md border p-2 dark:bg-dark-input" /></label>
            <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => { hideModal('quote-gmail-draft'); setEmailDraft(null); }} className="rounded-md border px-4 py-2">Annulla</button><button disabled={drafting} className="rounded-md bg-indigo-600 px-4 py-2 text-white disabled:opacity-50">{drafting ? 'Creo bozza...' : 'Crea bozza Gmail'}</button></div>
          </form>
        </Modal>
      )}

      {isModalOpen(`${kind}-delete`) && deleting && (
        <Modal title="Conferma eliminazione" onClose={() => hideModal(`${kind}-delete`)}>
          <p>Eliminare definitivamente {deleting[numberField] || `questo ${singular}`}?</p>
          <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => hideModal(`${kind}-delete`)} className="rounded-md border px-4 py-2">Annulla</button><button type="button" onClick={() => void confirmDelete()} disabled={saving} className="rounded-md bg-red-600 px-4 py-2 text-white disabled:bg-gray-400">Elimina</button></div>
        </Modal>
      )}
    </div>
  );
};

export default BusinessDocumentPage;
