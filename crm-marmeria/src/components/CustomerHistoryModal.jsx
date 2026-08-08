import React, { useEffect, useState } from 'react';
import { Plus, RefreshCw, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import useUI from '../hooks/useUI';
import { apiClient } from '../services/api';

const euro = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
const fieldLabels = {
  clientName: 'Cliente *', projectTitle: 'Lavoro / progetto', workDate: 'Data lavoro',
  invoiceNumber: 'Numero fattura', invoiceDate: 'Data fattura', invoiceTotal: 'Totale fattura',
  paymentAmount: 'Importo incassato', paymentDate: 'Data incasso',
  paymentMethod: 'Metodo pagamento', notes: 'Note',
};

const Dialog = ({ title, onClose, children, wide = false }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4">
    <div className={`my-8 w-full ${wide ? 'max-w-6xl' : 'max-w-3xl'} rounded-lg bg-white p-6 shadow-xl dark:bg-dark-card`}>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-xl font-semibold">{title}</h2>
        <button type="button" onClick={onClose} className="p-1 text-gray-500" aria-label="Chiudi"><X /></button>
      </div>
      {children}
    </div>
  </div>
);

export const HistoryImportModal = ({ onClose }) => {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({});
  const [busy, setBusy] = useState(false);
  const previewFile = async () => {
    if (!file) return toast.error('Seleziona prima il file Excel');
    setBusy(true);
    try {
      const body = new FormData(); body.append('file', file);
      const response = await apiClient.post('/imports/history/preview', body, { headers: { 'Content-Type': 'multipart/form-data' } });
      setPreview(response.data); setMapping(response.data.suggestedMapping || {});
    } catch (error) {
      toast.error(error.response?.data?.error || 'Anteprima Excel non riuscita');
    } finally { setBusy(false); }
  };
  const commit = async () => {
    if (!file || !preview) return;
    setBusy(true);
    try {
      const body = new FormData(); body.append('file', file); body.append('mapping', JSON.stringify(mapping));
      const response = await apiClient.post('/imports/history/commit', body, { headers: { 'Content-Type': 'multipart/form-data' } });
      const imported = Object.entries(response.data.imported || {}).map(([type, count]) => `${count} ${type}`).join(', ');
      toast.success(`Importazione completata: ${imported || 'nessuna nuova riga'}`);
      window.dispatchEvent(new CustomEvent('crm-data-refresh-requested'));
      onClose();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Importazione non riuscita');
    } finally { setBusy(false); }
  };
  return (
    <Dialog title="Importa storico da Excel" onClose={onClose} wide>
      <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">Il file non viene conservato: prima vedi l’anteprima, poi confermi. Il server crea uno snapshot automatico prima di importare.</p>
      <div className="flex flex-wrap items-center gap-3">
        <input type="file" accept=".xlsx,.csv" onChange={(event) => { setFile(event.target.files?.[0] || null); setPreview(null); }} />
        <button type="button" onClick={() => void previewFile()} disabled={!file || busy} className="rounded-md border px-4 py-2 disabled:opacity-50">{busy ? 'Lettura…' : 'Anteprima'}</button>
      </div>
      {preview && <>
        <p className="mt-4 text-sm">{preview.fileName}: {preview.totalRows} righe. Collega almeno la colonna Cliente.</p>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Object.entries(fieldLabels).map(([field, label]) => <label key={field} className="text-sm"><span className="mb-1 block font-medium">{label}</span>
            <select value={mapping[field] || ''} onChange={(event) => setMapping({ ...mapping, [field]: event.target.value })} className="w-full rounded border p-2 dark:bg-dark-input">
              <option value="">— non importare —</option>{preview.headers.map((header, index) => <option key={`${header}-${index}`} value={header}>{header || `Colonna ${index + 1}`}</option>)}
            </select>
          </label>)}
        </div>
        <div className="mt-5 max-h-52 overflow-auto rounded border">
          <table className="w-full text-xs"><thead><tr>{preview.headers.map((header, index) => <th key={`${header}-${index}`} className="sticky top-0 bg-gray-100 px-2 py-2 text-left dark:bg-gray-800">{header || `Colonna ${index + 1}`}</th>)}</tr></thead>
            <tbody>{preview.sampleRows.map((row, index) => <tr key={index} className="border-t">{preview.headers.map((header, column) => <td key={column} className="px-2 py-1">{row[header || `Colonna ${column + 1}`]}</td>)}</tr>)}</tbody></table>
        </div>
        <div className="mt-5 flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded border px-4 py-2">Annulla</button><button type="button" onClick={() => void commit()} disabled={busy || !mapping.clientName} className="rounded bg-light-primary px-4 py-2 text-white disabled:bg-gray-400">{busy ? 'Importazione…' : 'Conferma importazione'}</button></div>
      </>}
    </Dialog>
  );
};

const emptyPayment = (clientId) => ({ clientId, invoiceId: '', date: new Date().toISOString().slice(0, 10), amount: '', method: 'Bonifico', reference: '', notes: '' });

export const classifyProjectStatus = (project, today = new Date()) => {
  const status = String(project?.status || '').toLowerCase();
  if (status.includes('annull')) return 'Annullato';
  if (status.includes('complet')) return 'Completato';
  if (status.includes('scad')) return 'Scaduto';
  const deadline = String(project?.deadline || '').trim();
  if (deadline) {
    const date = new Date(`${deadline}T23:59:59`);
    if (!Number.isNaN(date.getTime()) && date < today) return 'Scaduto';
  }
  return 'Attivo';
};

const CustomerHistoryModal = ({ customer, onClose, canCreatePayment, canDeletePayment }) => {
  const { updatePreferences } = useUI();
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showPayment, setShowPayment] = useState(false);
  const [payment, setPayment] = useState(() => emptyPayment(customer.id));
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setLoading(true);
    try { setHistory((await apiClient.get(`/clients/${encodeURIComponent(customer.id)}/history`)).data); }
    catch (error) { toast.error(error.response?.data?.error || 'Storico cliente non disponibile'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [customer.id]);
  const openRecord = (type, id) => {
    if (!id) return;
    const page = type === 'project' ? 'projects' : type === 'quote' ? 'quotes' : 'invoices';
    updatePreferences({ currentPage: page, openType: type, openId: String(id) });
    onClose();
  };
  const savePayment = async (event) => {
    event.preventDefault(); setBusy(true);
    try { await apiClient.post('/payments', { ...payment, invoiceId: payment.invoiceId || null, amount: String(payment.amount).replace(',', '.') }); toast.success('Incasso registrato'); setPayment(emptyPayment(customer.id)); setShowPayment(false); await load(); }
    catch (error) { toast.error(error.response?.data?.error || 'Salvataggio incasso non riuscito'); }
    finally { setBusy(false); }
  };
  const removePayment = async (entry) => {
    if (!window.confirm('Eliminare questo incasso registrato?')) return;
    setBusy(true);
    try { await apiClient.delete(`/payments/${encodeURIComponent(entry.id)}`, { headers: { 'If-Match': String(entry.version) } }); toast.success('Incasso eliminato'); await load(); }
    catch (error) { toast.error(error.response?.data?.error || 'Eliminazione incasso non riuscita'); }
    finally { setBusy(false); }
  };
  const invoices = history?.invoices || [];
  const projects = history?.projects || [];
  const quotes = history?.quotes || [];
  const payments = history?.payments || [];
  return <Dialog title={`Storico — ${customer.name}`} onClose={onClose} wide>
    {loading ? <p className="py-10 text-center text-gray-500">Caricamento storico…</p> : <>
      {history?.summary && <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="rounded bg-gray-100 p-3 dark:bg-gray-800"><p className="text-xs text-gray-500">Preventivato</p><b>{history.summary.quotedTotal == null ? '—' : euro.format(history.summary.quotedTotal)}</b></div>
        <div className="rounded bg-gray-100 p-3 dark:bg-gray-800"><p className="text-xs text-gray-500">Fatturato</p><b>{history.summary.invoiceTotal == null ? '—' : euro.format(history.summary.invoiceTotal)}</b></div>
        <div className="rounded bg-green-50 p-3 dark:bg-green-950"><p className="text-xs text-gray-500">Incassato</p><b>{history.summary.recordedPaidTotal == null ? '—' : euro.format(history.summary.recordedPaidTotal)}</b></div>
        <div className="rounded bg-amber-50 p-3 dark:bg-amber-950"><p className="text-xs text-gray-500">Residuo</p><b>{history.summary.recordedOutstanding == null ? '—' : euro.format(history.summary.recordedOutstanding)}</b></div>
        <div className="rounded bg-blue-50 p-3 dark:bg-blue-950"><p className="text-xs text-gray-500">Acconti non associati</p><b>{history.summary.unassociatedAdvanceTotal == null ? '—' : euro.format(history.summary.unassociatedAdvanceTotal)}</b></div>
      </div>}
      <div className="mb-6 flex flex-wrap justify-between gap-3"><p className="text-sm text-gray-600 dark:text-gray-400">Storico compatibile anche con record precedenti alla normalizzazione.</p>{canCreatePayment && <button type="button" onClick={() => setShowPayment((value) => !value)} className="flex items-center gap-2 rounded bg-light-primary px-3 py-2 text-white"><Plus size={17} /> Registra incasso</button>}</div>
      {showPayment && <form onSubmit={savePayment} className="mb-6 grid grid-cols-1 gap-3 rounded border p-4 md:grid-cols-3">
        <label className="text-sm">Data<input type="date" required value={payment.date} onChange={(event) => setPayment({ ...payment, date: event.target.value })} className="mt-1 w-full rounded border p-2 dark:bg-dark-input" /></label>
        <label className="text-sm">Importo<input type="text" inputMode="decimal" required value={payment.amount} onChange={(event) => setPayment({ ...payment, amount: event.target.value })} className="mt-1 w-full rounded border p-2 dark:bg-dark-input" /></label>
        <label className="text-sm">Fattura<select value={payment.invoiceId} onChange={(event) => setPayment({ ...payment, invoiceId: event.target.value })} className="mt-1 w-full rounded border p-2 dark:bg-dark-input"><option value="">Acconto / non associato</option>{invoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber || 'Fattura senza numero'} — {invoice.paymentSummary ? euro.format(invoice.paymentSummary.remaining) : '—'}</option>)}</select></label>
        <label className="text-sm">Metodo<input value={payment.method} onChange={(event) => setPayment({ ...payment, method: event.target.value })} className="mt-1 w-full rounded border p-2 dark:bg-dark-input" /></label>
        <label className="text-sm">Riferimento<input value={payment.reference} onChange={(event) => setPayment({ ...payment, reference: event.target.value })} className="mt-1 w-full rounded border p-2 dark:bg-dark-input" /></label>
        <label className="text-sm">Note<input value={payment.notes} onChange={(event) => setPayment({ ...payment, notes: event.target.value })} className="mt-1 w-full rounded border p-2 dark:bg-dark-input" /></label>
        <div className="md:col-span-3 flex justify-end gap-2"><button type="button" onClick={() => setShowPayment(false)} className="rounded border px-3 py-2">Annulla</button><button disabled={busy} className="rounded bg-light-primary px-3 py-2 text-white disabled:bg-gray-400">Salva incasso</button></div>
      </form>}
      <section className="mb-6"><h3 className="mb-2 font-semibold">Progetti ({projects.length})</h3><div className="space-y-2">{projects.map((item) => <div key={item.id} className="rounded border p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2"><button type="button" className="font-semibold text-light-primary underline" onClick={() => openRecord('project', item.id)}>{item.name || item.title || 'Progetto'}</button><span>{classifyProjectStatus(item)}</span></div>
        <div className="mt-1 flex flex-wrap gap-3 text-gray-600 dark:text-gray-400"><span>Inizio: {item.startDate || '—'}</span><span>Scadenza: {item.deadline || 'Nessuna scadenza'}</span><span>Stato: {item.status || '—'}</span></div>
      </div>)}{!projects.length && <p className="text-sm text-gray-500">Nessun progetto registrato.</p>}</div></section>
      <section className="mb-6"><h3 className="mb-2 font-semibold">Preventivi ({quotes.length})</h3><div className="space-y-2">{quotes.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded border p-3 text-sm">
        <div><button type="button" className="text-light-primary underline" onClick={() => openRecord('quote', item.id)}>{item.quoteNumber || 'Preventivo senza numero'}</button><span className="ml-2">{item.status || '—'} · {item.date || '—'}</span>{item.projectId && <button type="button" className="ml-2 text-light-primary underline" onClick={() => openRecord('project', item.projectId)}>Apri progetto</button>}</div>
        <b>{item.total == null ? '—' : euro.format(item.total)}</b>
      </div>)}{!quotes.length && <p className="text-sm text-gray-500">Nessun preventivo registrato.</p>}</div></section>
      <section className="mb-6"><h3 className="mb-2 font-semibold">Fatture ({invoices.length})</h3><div className="space-y-2">{invoices.map((item) => {
        const summary = item.paymentSummary;
        const itemPayments = summary?.payments || [];
        return <details key={item.id} className="rounded border p-3 text-sm"><summary className="cursor-pointer list-none">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-6"><span>{item.invoiceNumber || 'Fattura senza numero'}</span><span>Totale: {item.total == null ? '—' : euro.format(item.total)}</span><span>Pagato: {summary ? euro.format(summary.paid) : '—'}</span><span>Residuo: {summary ? euro.format(summary.remaining) : '—'}</span><span>Stato: {summary?.computedStatus || item.status || '—'}</span><span>Incassi: {itemPayments.length}</span></div>
        </summary>
        <div className="mt-3 space-y-2 border-t pt-2"><div>Data: {item.date || '—'} · Scadenza: {item.dueDate || '—'}</div>
          {item.projectId && <button type="button" className="mr-3 text-light-primary underline" onClick={() => openRecord('project', item.projectId)}>Apri progetto</button>}
          {item.quoteId && <button type="button" className="text-light-primary underline" onClick={() => openRecord('quote', item.quoteId)}>Apri preventivo</button>}
          {itemPayments.map((entry) => <div key={entry.id} className="rounded bg-gray-50 p-2 dark:bg-gray-800"><b>{entry.date || '—'}</b> · {entry.method || 'Metodo non indicato'} · {entry.reference || 'Senza riferimento'}{entry.notes ? ` · ${entry.notes}` : ''}: <strong>{euro.format(entry.amount || 0)}</strong></div>)}
          {!itemPayments.length && <p className="text-gray-500">Nessun incasso associato.</p>}
        </div>
      </details>;
      })}{!invoices.length && <p className="text-sm text-gray-500">Nessuna fattura registrata.</p>}</div></section>
      <section><h3 className="mb-2 font-semibold">Incassi ({payments.length})</h3><div className="space-y-2">{payments.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm"><span>{item.date || '—'} · {item.method || 'Metodo non indicato'} · {item.reference || item.notes || 'Acconto / non associato'}</span><span className="flex items-center gap-3"><b>{euro.format(item.amount || 0)}</b>{canDeletePayment && <button type="button" disabled={busy} onClick={() => void removePayment(item)} className="text-red-600" title="Elimina incasso"><Trash2 size={17} /></button>}</span></div>)}{!payments.length && <p className="text-sm text-gray-500">Nessun incasso registrato.</p>}</div></section>
    </>}
    <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => void load()} className="rounded border px-3 py-2"><RefreshCw size={16} /></button><button type="button" onClick={onClose} className="rounded border px-4 py-2">Chiudi</button></div>
  </Dialog>;
};

export default CustomerHistoryModal;
