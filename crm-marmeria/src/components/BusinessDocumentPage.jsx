import React, { useMemo, useState } from 'react';
import { Edit, Eye, Plus, Search, Trash, X } from 'lucide-react';
import useUI from '../hooks/useUI';
import { useAuth } from '../contexts/AuthContext';

const toNumber = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const normalized = String(value ?? '')
    .replace(/\s|€/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  return Number.parseFloat(normalized) || 0;
};

const emptyItem = (taxEnabled) => ({
  description: '',
  quantity: 1,
  unitPrice: 0,
  taxRate: taxEnabled ? 22 : 0,
  materialId: '',
});

const createEmptyDocument = (kind) => ({
  date: new Date().toISOString().slice(0, 10),
  dueDate: '',
  customerId: '',
  projectId: '',
  quoteId: '',
  items: [emptyItem(kind === 'invoice')],
  notes: '',
  status: kind === 'invoice' ? 'Non Pagata' : 'Bozza',
  validityDays: 30,
  paymentDetails: '',
});

const normalizeForForm = (document, kind) => ({
  ...createEmptyDocument(kind),
  ...document,
  id: document.id == null ? undefined : String(document.id),
  customerId: document.customerId == null ? '' : String(document.customerId),
  projectId: document.projectId == null ? '' : String(document.projectId),
  quoteId: document.quoteId == null ? '' : String(document.quoteId),
  date: document.date ? String(document.date).slice(0, 10) : '',
  dueDate: document.dueDate ? String(document.dueDate).slice(0, 10) : '',
  items: Array.isArray(document.items) && document.items.length
    ? document.items.map((item) => ({
      ...emptyItem(kind === 'invoice'),
      ...item,
      materialId: item.materialId == null ? '' : String(item.materialId),
      quantity: toNumber(item.quantity),
      unitPrice: toNumber(item.unitPrice),
      taxRate: kind === 'invoice' ? toNumber(item.taxRate ?? 22) : 0,
    }))
    : [emptyItem(kind === 'invoice')],
});

const calculateTotal = (items, taxEnabled) => items.reduce((sum, item) => {
  const subtotal = toNumber(item.quantity) * toNumber(item.unitPrice);
  const tax = taxEnabled ? subtotal * (toNumber(item.taxRate) / 100) : 0;
  return sum + subtotal + tax;
}, 0);

const formatCurrency = (value) => Number(value || 0).toLocaleString('it-IT', {
  style: 'currency',
  currency: 'EUR',
});

const formatDate = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('it-IT');
};

const Modal = ({ title, onClose, children, wide = false }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
    <div className={`w-full ${wide ? 'max-w-4xl' : 'max-w-2xl'} max-h-[92vh] overflow-y-auto rounded-lg bg-white p-6 shadow-xl dark:bg-dark-card`}>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{title}</h2>
        <button type="button" onClick={onClose} className="p-1 text-gray-500">
          <X size={22} />
        </button>
      </div>
      {children}
    </div>
  </div>
);

const DocumentForm = ({
  kind,
  value,
  setValue,
  customers,
  projects,
  quotes,
  materials,
}) => {
  const taxEnabled = kind === 'invoice';

  const selectQuote = (quoteId) => {
    const selected = quotes.find((quote) => String(quote.id) === String(quoteId));
    if (!selected) {
      setValue((previous) => ({ ...previous, quoteId: '' }));
      return;
    }
    setValue((previous) => ({
      ...previous,
      quoteId: String(selected.id),
      customerId: selected.customerId == null ? previous.customerId : String(selected.customerId),
      projectId: selected.projectId == null ? previous.projectId : String(selected.projectId),
      items: Array.isArray(selected.items) && selected.items.length
        ? selected.items.map((item) => ({
          ...emptyItem(true),
          ...item,
          materialId: item.materialId == null ? '' : String(item.materialId),
          quantity: toNumber(item.quantity),
          unitPrice: toNumber(item.unitPrice),
          taxRate: toNumber(item.taxRate ?? 22),
        }))
        : previous.items,
    }));
  };

  const updateItem = (index, field, rawValue) => {
    setValue((previous) => {
      const items = previous.items.map((item, itemIndex) => (
        itemIndex === index
          ? {
            ...item,
            [field]: ['quantity', 'unitPrice', 'taxRate'].includes(field)
              ? toNumber(rawValue)
              : rawValue,
          }
          : item
      ));

      if (field === 'materialId') {
        const material = materials.find(
          (candidate) => String(candidate.id) === String(rawValue),
        );
        if (material) {
          items[index] = {
            ...items[index],
            materialId: String(material.id),
            description: material.name || '',
            unitPrice: toNumber(material.unitPrice ?? material.price),
          };
        } else if (!rawValue) {
          items[index] = {
            ...items[index],
            materialId: '',
            description: '',
            unitPrice: 0,
          };
        }
      }
      return { ...previous, items };
    });
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Data *</span>
          <input
            type="date"
            required
            value={value.date || ''}
            onChange={(event) => setValue((previous) => ({
              ...previous,
              date: event.target.value,
            }))}
            className="w-full rounded-md border p-2 bg-light-bg dark:bg-dark-input"
          />
        </label>

        {taxEnabled ? (
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Scadenza *</span>
            <input
              type="date"
              required
              value={value.dueDate || ''}
              onChange={(event) => setValue((previous) => ({
                ...previous,
                dueDate: event.target.value,
              }))}
              className="w-full rounded-md border p-2 bg-light-bg dark:bg-dark-input"
            />
          </label>
        ) : (
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Validità (giorni)</span>
            <input
              type="number"
              min="1"
              value={value.validityDays ?? 30}
              onChange={(event) => setValue((previous) => ({
                ...previous,
                validityDays: Math.max(1, Number(event.target.value) || 1),
              }))}
              className="w-full rounded-md border p-2 bg-light-bg dark:bg-dark-input"
            />
          </label>
        )}

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Cliente *</span>
          <select
            required
            value={value.customerId || ''}
            onChange={(event) => setValue((previous) => ({
              ...previous,
              customerId: event.target.value,
            }))}
            className="w-full rounded-md border p-2 bg-light-bg dark:bg-dark-input"
          >
            <option value="">Seleziona cliente</option>
            {customers.map((customer) => (
              <option key={customer.id} value={String(customer.id)}>{customer.name}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Progetto</span>
          <select
            value={value.projectId || ''}
            onChange={(event) => setValue((previous) => ({
              ...previous,
              projectId: event.target.value,
            }))}
            className="w-full rounded-md border p-2 bg-light-bg dark:bg-dark-input"
          >
            <option value="">Nessun progetto</option>
            {projects.map((project) => (
              <option key={project.id} value={String(project.id)}>{project.name}</option>
            ))}
          </select>
        </label>

        {taxEnabled && (
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Preventivo collegato</span>
            <select
              value={value.quoteId || ''}
              onChange={(event) => selectQuote(event.target.value)}
              className="w-full rounded-md border p-2 bg-light-bg dark:bg-dark-input"
            >
              <option value="">Nessun preventivo</option>
              {quotes.map((quote) => (
                <option key={quote.id} value={String(quote.id)}>
                  {quote.quoteNumber || 'Preventivo senza numero'}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Stato</span>
          <select
            value={value.status || ''}
            onChange={(event) => setValue((previous) => ({
              ...previous,
              status: event.target.value,
            }))}
            className="w-full rounded-md border p-2 bg-light-bg dark:bg-dark-input"
          >
            {(taxEnabled
              ? ['Non Pagata', 'Pagata Parzialmente', 'Pagata', 'Scaduta']
              : ['Bozza', 'Inviato', 'Accettato', 'Rifiutato', 'Scaduto']
            ).map((status) => <option key={status}>{status}</option>)}
          </select>
        </label>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-semibold">Voci</h3>
          <button
            type="button"
            onClick={() => setValue((previous) => ({
              ...previous,
              items: [...previous.items, emptyItem(taxEnabled)],
            }))}
            className="rounded-md border px-3 py-1.5 text-sm"
          >
            Aggiungi voce
          </button>
        </div>

        <div className="space-y-3">
          {value.items.map((item, index) => (
            <div key={`${index}-${item.materialId || 'manuale'}`} className="rounded-md border p-3">
              <div className={`grid grid-cols-1 gap-3 ${taxEnabled ? 'md:grid-cols-6' : 'md:grid-cols-5'}`}>
                <select
                  value={item.materialId || ''}
                  onChange={(event) => updateItem(index, 'materialId', event.target.value)}
                  className="rounded-md border p-2 md:col-span-2 bg-light-bg dark:bg-dark-input"
                >
                  <option value="">Voce manuale</option>
                  {materials.map((material) => (
                    <option key={material.id} value={String(material.id)}>{material.name}</option>
                  ))}
                </select>
                <input
                  required
                  value={item.description || ''}
                  onChange={(event) => updateItem(index, 'description', event.target.value)}
                  placeholder="Descrizione"
                  className="rounded-md border p-2 md:col-span-2 bg-light-bg dark:bg-dark-input"
                />
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  value={item.quantity}
                  onChange={(event) => updateItem(index, 'quantity', event.target.value)}
                  placeholder="Quantità"
                  className="rounded-md border p-2 bg-light-bg dark:bg-dark-input"
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={item.unitPrice}
                  onChange={(event) => updateItem(index, 'unitPrice', event.target.value)}
                  placeholder="Prezzo"
                  className="rounded-md border p-2 bg-light-bg dark:bg-dark-input"
                />
                {taxEnabled && (
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={item.taxRate}
                    onChange={(event) => updateItem(index, 'taxRate', event.target.value)}
                    placeholder="IVA %"
                    className="rounded-md border p-2 bg-light-bg dark:bg-dark-input"
                  />
                )}
              </div>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span>
                  Totale voce: {formatCurrency(calculateTotal([item], taxEnabled))}
                </span>
                {value.items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setValue((previous) => ({
                      ...previous,
                      items: previous.items.filter((_, itemIndex) => itemIndex !== index),
                    }))}
                    className="text-red-600"
                  >
                    Rimuovi
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <label className="block">
        <span className="mb-1 block text-sm font-medium">Note</span>
        <textarea
          rows={3}
          value={value.notes || ''}
          onChange={(event) => setValue((previous) => ({
            ...previous,
            notes: event.target.value,
          }))}
          className="w-full rounded-md border p-2 bg-light-bg dark:bg-dark-input"
        />
      </label>

      {taxEnabled && (
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Dettagli pagamento</span>
          <textarea
            rows={2}
            value={value.paymentDetails || ''}
            onChange={(event) => setValue((previous) => ({
              ...previous,
              paymentDetails: event.target.value,
            }))}
            className="w-full rounded-md border p-2 bg-light-bg dark:bg-dark-input"
          />
        </label>
      )}

      <div className="text-right text-lg font-semibold">
        Totale: {formatCurrency(calculateTotal(value.items, taxEnabled))}
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
  addDocument,
  updateDocument,
  deleteDocument,
}) => {
  const { isModalOpen, showModal, hideModal, setBreadcrumbs } = useUI();
  const { hasPermission } = useAuth();
  const plural = kind === 'invoice' ? 'Fatture' : 'Preventivi';
  const singular = kind === 'invoice' ? 'fattura' : 'preventivo';
  const numberField = kind === 'invoice' ? 'invoiceNumber' : 'quoteNumber';
  const permission = kind === 'invoice' ? 'invoices' : 'quotes';
  const taxEnabled = kind === 'invoice';
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [form, setForm] = useState(() => createEmptyDocument(kind));
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    setBreadcrumbs([{ label: plural }]);
  }, [plural, setBreadcrumbs]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...documents]
      .filter((document) => {
        if (!query) return true;
        const customer = customers.find(
          (item) => String(item.id) === String(document.customerId),
        );
        const project = projects.find(
          (item) => String(item.id) === String(document.projectId),
        );
        return [
          document[numberField],
          document.status,
          customer?.name,
          project?.name,
        ].some((value) => String(value || '').toLowerCase().includes(query));
      })
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  }, [customers, documents, numberField, projects, search]);

  const openAdd = () => {
    setForm(createEmptyDocument(kind));
    showModal({ id: `${kind}-add`, type: 'add' });
  };

  const openEdit = (document) => {
    setEditing(document);
    setForm(normalizeForForm(document, kind));
    showModal({ id: `${kind}-edit`, type: 'edit' });
  };

  const payloadFromForm = () => ({
    ...form,
    customerId: String(form.customerId),
    projectId: form.projectId ? String(form.projectId) : null,
    quoteId: taxEnabled && form.quoteId ? String(form.quoteId) : null,
    items: form.items.map((item) => ({
      ...item,
      materialId: item.materialId ? String(item.materialId) : null,
      quantity: toNumber(item.quantity),
      unitPrice: toNumber(item.unitPrice),
      taxRate: taxEnabled ? toNumber(item.taxRate) : 0,
    })),
    total: calculateTotal(form.items, taxEnabled),
  });

  const submitAdd = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const success = await addDocument(payloadFromForm());
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
        ...payloadFromForm(),
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

  return (
    <div className="min-h-screen bg-light-bg p-6 text-light-text dark:bg-dark-bg dark:text-dark-text">
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{plural}</h1>
        {hasPermission(`${permission}.create`) && (
          <button
            type="button"
            onClick={openAdd}
            className="flex items-center gap-2 rounded-md bg-light-primary px-4 py-2 text-white"
          >
            <Plus size={19} /> Nuovo {singular}
          </button>
        )}
      </div>

      <div className="rounded-lg bg-white shadow-sm dark:bg-dark-card">
        <div className="border-b p-4 dark:border-dark-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={19} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={`Cerca ${singular}, cliente, progetto o stato...`}
              className="w-full rounded-md border bg-light-bg py-2 pl-10 pr-4 dark:bg-dark-input"
            />
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
              {filtered.map((document) => {
                const customer = customers.find(
                  (item) => String(item.id) === String(document.customerId),
                );
                return (
                  <tr key={document.id}>
                    <td className="px-5 py-4 font-medium">
                      {document[numberField] || (document._queued ? 'In attesa' : '-')}
                    </td>
                    <td className="px-5 py-4">{formatDate(document.date)}</td>
                    <td className="px-5 py-4">{customer?.name || 'N/D'}</td>
                    <td className="px-5 py-4">{formatCurrency(document.total)}</td>
                    <td className="px-5 py-4">
                      <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs text-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
                        {document.status || '-'}
                      </span>
                      {document._queued && (
                        <span className="ml-2 text-xs text-orange-600">in coda</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setViewing(document);
                            showModal({ id: `${kind}-view`, type: 'view' });
                          }}
                          className="p-1.5 text-blue-600"
                          title="Visualizza"
                        >
                          <Eye size={18} />
                        </button>
                        {hasPermission(`${permission}.edit`) && (
                          <button
                            type="button"
                            onClick={() => openEdit(document)}
                            className="p-1.5 text-yellow-600"
                            title="Modifica"
                          >
                            <Edit size={18} />
                          </button>
                        )}
                        {hasPermission(`${permission}.delete`) && (
                          <button
                            type="button"
                            onClick={() => {
                              setDeleting(document);
                              showModal({ id: `${kind}-delete`, type: 'delete' });
                            }}
                            className="p-1.5 text-red-600"
                            title="Elimina"
                          >
                            <Trash size={18} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!filtered.length && (
                <tr>
                  <td colSpan="6" className="px-6 py-12 text-center text-gray-500">
                    Nessun {singular} trovato.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen(`${kind}-add`) && (
        <Modal title={`Nuovo ${singular}`} onClose={() => hideModal(`${kind}-add`)} wide>
          <form onSubmit={submitAdd}>
            <DocumentForm
              kind={kind}
              value={form}
              setValue={setForm}
              customers={customers}
              projects={projects}
              quotes={quotes}
              materials={materials}
            />
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => hideModal(`${kind}-add`)} className="rounded-md border px-4 py-2">
                Annulla
              </button>
              <button disabled={saving} className="rounded-md bg-light-primary px-4 py-2 text-white disabled:bg-gray-400">
                {saving ? 'Salvataggio...' : 'Crea'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {isModalOpen(`${kind}-edit`) && editing && (
        <Modal title={`Modifica ${singular}`} onClose={() => hideModal(`${kind}-edit`)} wide>
          <form onSubmit={submitEdit}>
            <DocumentForm
              kind={kind}
              value={form}
              setValue={setForm}
              customers={customers}
              projects={projects}
              quotes={quotes}
              materials={materials}
            />
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => hideModal(`${kind}-edit`)} className="rounded-md border px-4 py-2">
                Annulla
              </button>
              <button disabled={saving} className="rounded-md bg-light-primary px-4 py-2 text-white disabled:bg-gray-400">
                {saving ? 'Salvataggio...' : 'Salva'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {isModalOpen(`${kind}-view`) && viewing && (
        <Modal title={viewing[numberField] || plural.slice(0, -1)} onClose={() => hideModal(`${kind}-view`)}>
          <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
            <div><span className="text-gray-500">Data</span><p>{formatDate(viewing.date)}</p></div>
            {taxEnabled && <div><span className="text-gray-500">Scadenza</span><p>{formatDate(viewing.dueDate)}</p></div>}
            <div><span className="text-gray-500">Stato</span><p>{viewing.status}</p></div>
            <div><span className="text-gray-500">Totale</span><p className="font-semibold">{formatCurrency(viewing.total)}</p></div>
            <div className="md:col-span-2"><span className="text-gray-500">Note</span><p className="whitespace-pre-wrap">{viewing.notes || '-'}</p></div>
          </div>
          <div className="mt-5 space-y-2">
            {(viewing.items || []).map((item, index) => (
              <div key={index} className="flex justify-between gap-3 border-b py-2 text-sm dark:border-dark-border">
                <span>{item.description} · {item.quantity} × {formatCurrency(item.unitPrice)}</span>
                <strong>{formatCurrency(calculateTotal([item], taxEnabled))}</strong>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {isModalOpen(`${kind}-delete`) && deleting && (
        <Modal title="Conferma eliminazione" onClose={() => hideModal(`${kind}-delete`)}>
          <p>Eliminare definitivamente {deleting[numberField] || `questo ${singular}`}?</p>
          <div className="mt-6 flex justify-end gap-3">
            <button type="button" onClick={() => hideModal(`${kind}-delete`)} className="rounded-md border px-4 py-2">
              Annulla
            </button>
            <button
              type="button"
              onClick={() => void confirmDelete()}
              disabled={saving}
              className="rounded-md bg-red-600 px-4 py-2 text-white disabled:bg-gray-400"
            >
              Elimina
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default BusinessDocumentPage;
