import React, { useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
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

const CustomerHistoryModal = ({ customer, onClose, canCreatePayment, canDeletePayment }) => {
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showPayment, setShowPayment] = useState(false);
  const [payment, setPayment] = useState(() => emptyPayment(customer.id));
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setLoading(true);
    try { const response = await apiClient.get(`/clients/${encodeURIComponent(customer.id)}/history`); setHistory(response.data); }
    catch (error) { toast.error(error.response?.data?.error || 'Storico cliente non disponibile'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [customer.id]);
  const invoiceOptions = useMemo(() => history?.invoices || [], [history]);
  const savePayment = async (event) => {
    event.preventDefault(); setBusy(true);
    try {
      await apiClient.post('/payments', { ...payment, invoiceId: payment.invoiceId || null, amount: String(payment.amount).replace(',', '.') });
      toast.success('Incasso registrato'); setPayment(emptyPayment(customer.id)); setShowPayment(false); await load();
    } catch (error) { toast.error(error.response?.data?.error || 'Salvataggio incasso non riuscito'); }
    finally { setBusy(false); }
  };
  const removePayment = async (entry) => {
    if (!window.confirm('Eliminare questo incasso registrato?')) return;
    setBusy(true);
    try { await apiClient.delete(`/payments/${encodeURIComponent(entry.id)}`, { headers: { 'If-Match': String(entry.version) } }); toast.success('Incasso eliminato'); await load(); }
    catch (error) { toast.error(error.response?.data?.error || 'Eliminazione incasso non riuscita'); }
    finally { setBusy(false); }
  };
  return <Dialog title={`Storico — ${customer.name}`} onClose={onClose} wide>
    {loading ? <p className="py-10 text-center text-gray-500">Caricamento storico…</p> : <>
      {history?.summary && <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded bg-gray-100 p-3 dark:bg-gray-800"><p className="text-xs text-gray-500">Fatturato</p><p className="text-lg font-semibold">{euro.format(history.summary.invoiceTotal || 0)}</p></div>
        <div className="rounded bg-green-50 p-3 dark:bg-green-950"><p className="text-xs text-gray-500">Incassato registrato</p><p className="text-lg font-semibold">{history.summary.recordedPaidTotal == null ? '—' : euro.format(history.summary.recordedPaidTotal)}</p></div>
        <div className="rounded bg-amber-50 p-3 dark:bg-amber-950"><p className="text-xs text-gray-500">Residuo registrato</p><p className="text-lg font-semibold">{history.summary.recordedOutstanding == null ? '—' : euro.format(history.summary.recordedOutstanding)}</p></div>
      </div>}
      <div className="mb-6 flex flex-wrap justify-between gap-3"><p className="text-sm text-gray-600 dark:text-gray-400">I totali si basano sugli incassi registrati; gli stati delle fatture precedenti non vengono modificati automaticamente.</p>{canCreatePayment && <button type="button" onClick={() => setShowPayment(!showPayment)} className="flex items-center gap-2 rounded bg-light-primary px-3 py-2 text-white"><Plus size={17} /> Registra incasso</button>}</div>
      {showPayment && <form onSubmit={savePayment} className="mb-6 grid grid-cols-1 gap-3 rounded border p-4 md:grid-cols-3">
        <label className="text-sm">Data<input type="date" required value={payment.date} onChange={(event) => setPayment({ ...payment, date: event.target.value })} className="mt-1 w-full rounded border p-2 dark:bg-dark-input" /></label>
        <label className="text-sm">Importo<input type="text" inputMode="decimal" required value={payment.amount} onChange={(event) => setPayment({ ...payment, amount: event.target.value })} className="mt-1 w-full rounded border p-2 dark:bg-dark-input" /></label>
        <label className="text-sm">Fattura<select value={payment.invoiceId} onChange={(event) => setPayment({ ...payment, invoiceId: event.target.value })} className="mt-1 w-full rounded border p-2 dark:bg-dark-input"><option value="">Acconto / non associato</option>{invoiceOptions.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber || 'Fattura senza numero'} — {invoice.paymentSummary ? euro.format(invoice.paymentSummary.remaining) : invoice.status}</option>)}</select></label>
        <label className="text-sm">Metodo<input value={payment.method} onChange={(event) => setPayment({ ...payment, method: event.target.value })} className="mt-1 w-full rounded border p-2 dark:bg-dark-input" /></label>
        <label className="text-sm">Riferimento<input value={payment.reference} onChange={(event) => setPayment({ ...payment, reference: event.target.value })} className="mt-1 w-full rounded border p-2 dark:bg-dark-input" /></label>
        <label className="text-sm">Note<input value={payment.notes} onChange={(event) => setPayment({ ...payment, notes: event.target.value })} className="mt-1 w-full rounded border p-2 dark:bg-dark-input" /></label>
        <div className="md:col-span-3 flex justify-end gap-2"><button type="button" onClick={() => setShowPayment(false)} className="rounded border px-3 py-2">Annulla</button><button disabled={busy} className="rounded bg-light-primary px-3 py-2 text-white disabled:bg-gray-400">Salva incasso</button></div>
      </form>}
      <section className="mb-6"><h3 className="mb-2 font-semibold">Lavori ({history?.projects?.length || 0})</h3><div className="overflow-auto rounded border"><table className="w-full text-sm"><thead><tr className="bg-gray-100 text-left dark:bg-gray-800"><th className="p-2">Lavoro</th><th className="p-2">Stato</th><th className="p-2">Data</th></tr></thead><tbody>{history?.projects?.map((item) => <tr key={item.id} className="border-t"><td className="p-2">{item.name || item.title}</td><td className="p-2">{item.status || '—'}</td><td className="p-2">{item.startDate || item.createdAt?.slice(0, 10) || '—'}</td></tr>)}{!history?.projects?.length && <tr><td colSpan="3" className="p-3 text-center text-gray-500">Nessun lavoro registrato.</td></tr>}</tbody></table></div></section>
      <section className="mb-6"><h3 className="mb-2 font-semibold">Fatture ({history?.invoices?.length || 0})</h3><div className="overflow-auto rounded border"><table className="w-full text-sm"><thead><tr className="bg-gray-100 text-left dark:bg-gray-800"><th className="p-2">Numero</th><th className="p-2">Data</th><th className="p-2">Stato</th><th className="p-2 text-right">Residuo</th></tr></thead><tbody>{history?.invoices?.map((item) => <tr key={item.id} className="border-t"><td className="p-2">{item.invoiceNumber || '—'}</td><td className="p-2">{item.date || '—'}</td><td className="p-2">{item.paymentSummary?.computedStatus || item.status || '—'}</td><td className="p-2 text-right">{item.paymentSummary ? euro.format(item.paymentSummary.remaining) : '—'}</td></tr>)}{!history?.invoices?.length && <tr><td colSpan="4" className="p-3 text-center text-gray-500">Nessuna fattura registrata.</td></tr>}</tbody></table></div></section>
      {history?.summary && <section><h3 className="mb-2 font-semibold">Incassi registrati ({history?.payments?.length || 0})</h3><div className="overflow-auto rounded border"><table className="w-full text-sm"><thead><tr className="bg-gray-100 text-left dark:bg-gray-800"><th className="p-2">Data</th><th className="p-2">Fattura</th><th className="p-2">Metodo</th><th className="p-2 text-right">Importo</th><th className="p-2" /></tr></thead><tbody>{history?.payments?.map((item) => <tr key={item.id} className="border-t"><td className="p-2">{item.date}</td><td className="p-2">{history.invoices.find((invoice) => invoice.id === item.invoiceId)?.invoiceNumber || 'Acconto / non associato'}</td><td className="p-2">{item.method || '—'}</td><td className="p-2 text-right">{euro.format(item.amount || 0)}</td><td className="p-2 text-right">{canDeletePayment && <button type="button" disabled={busy} onClick={() => void removePayment(item)} className="text-red-600" title="Elimina incasso"><Trash2 size={17} /></button>}</td></tr>)}{!history?.payments?.length && <tr><td colSpan="5" className="p-3 text-center text-gray-500">Nessun incasso registrato.</td></tr>}</tbody></table></div></section>}
    </>}
    <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => void load()} className="rounded border px-3 py-2"><RefreshCw size={16} /></button><button type="button" onClick={onClose} className="rounded border px-4 py-2">Chiudi</button></div>
  </Dialog>;
};

export default CustomerHistoryModal;
