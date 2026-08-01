import React, { useRef, useState } from 'react';
import { FileText, Trash2, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

const QuoteTemplatePanel = ({ templates = [], onChanged }) => {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const { hasPermission } = useAuth();
  const canDelete = hasPermission('quotes.delete');
  const upload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!/\.docx$/i.test(file.name)) { toast.error('Carica un file Word .docx'); return; }
    setBusy(true);
    try {
      const template = (await apiClient.post('/quote-templates', { name: file.name.replace(/\.docx$/i, '') })).data;
      const data = new FormData(); data.append('files', file);
      await apiClient.post(`/entity-attachments/quote_template/${template.id}`, data, { headers: { 'Content-Type': 'multipart/form-data' } });
      await onChanged(); toast.success('Modello Word caricato');
    } catch (error) { toast.error(error.response?.data?.error || 'Caricamento modello non riuscito'); } finally { setBusy(false); }
  };
  const remove = async (template) => {
    if (!window.confirm(`Eliminare il modello “${template.name}”?`)) return;
    setBusy(true); try { await apiClient.delete(`/quote-templates/${template.id}`, { data: { version: template.version } }); await onChanged(); toast.success('Modello eliminato'); } catch (error) { toast.error(error.response?.data?.error || 'Eliminazione modello non riuscita'); } finally { setBusy(false); }
  };
  return <section className="mb-6 rounded-lg border border-dashed border-indigo-300 bg-indigo-50/50 p-4 dark:border-indigo-700 dark:bg-indigo-950/20">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 font-semibold"><FileText size={18} /> Modelli Word preventivo</h2><p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Carica layout `.docx`; selezionalo nel preventivo, poi scarica Word compilato.</p></div><button type="button" disabled={busy} onClick={() => input.current?.click()} className="flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-2 text-sm text-white disabled:opacity-50"><Upload size={16} /> Carica modello</button><input ref={input} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden" onChange={upload} /></div>
    <details className="mt-3 text-xs text-gray-600 dark:text-gray-300"><summary className="cursor-pointer font-medium">Segnaposti disponibili</summary><p className="mt-2 leading-5">{'{{quote_number}}, {{quote_date}}, {{quote_valid_until}}, {{customer_name}}, {{customer_email}}, {{customer_phone}}, {{customer_address}}, {{project_name}}, {{subtotal}}, {{tax_total}}, {{total}}, {{quote_notes}}.'}</p><p className="mt-1 leading-5">{'Per righe in tabella: stessa riga Word con {{#items}} prima cella, {{description}}, {{quantity}}, {{unit_price}}, {{line_total}}, {{/items}} ultima cella.'}</p></details>
    {templates.length > 0 && <div className="mt-3 space-y-2">{templates.map((template) => <div key={template.id} className="flex items-center justify-between rounded-md bg-white p-2 text-sm shadow-sm dark:bg-dark-card"><span className="truncate">{template.name}</span>{canDelete && <button type="button" disabled={busy} onClick={() => remove(template)} className="p-1 text-red-600" title="Elimina modello"><Trash2 size={16} /></button>}</div>)}</div>}
  </section>;
};

export default QuoteTemplatePanel;
