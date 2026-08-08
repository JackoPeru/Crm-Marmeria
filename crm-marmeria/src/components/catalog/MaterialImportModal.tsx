import React, { useEffect, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import Modal from '../common/Modal';

interface MaterialImportModalProps {
  open: boolean;
  onClose: () => void;
  onImported?: () => void;
}

const MaterialImportModal: React.FC<MaterialImportModalProps> = ({ open, onClose, onImported }) => {
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<any | null>(null);
  const [importMapping, setImportMapping] = useState<Record<string, Record<string, string>>>({});
  const [duplicateMode, setDuplicateMode] = useState<'skip' | 'update'>('skip');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setImportFile(null);
      setImportPreview(null);
      setImportMapping({});
      setDuplicateMode('skip');
    }
  }, [open]);

  if (!open) return null;

  const preview = async (file: File | null) => {
    if (!file) return;
    setImportFile(file);
    setBusy(true);
    try {
      const payload = new FormData();
      payload.append('file', file);
      const response = await apiClient.post('/imports/materials/preview', payload, { timeout: 60000 });
      setImportPreview(response.data);
      setImportMapping(Object.fromEntries((response.data.sheets || []).map((sheet: any) => [sheet.name, sheet.suggestedMapping || {}])));
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Anteprima listino non riuscita');
      setImportPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!importFile || !importPreview) return;
    setBusy(true);
    try {
      const payload = new FormData();
      payload.append('file', importFile);
      payload.append('mapping', JSON.stringify({ sheets: importMapping }));
      payload.append('duplicateMode', duplicateMode);
      const response = await apiClient.post('/imports/materials/commit', payload, { timeout: 120000 });
      toast.success(`Listino importato: ${response.data.created || 0} nuovi, ${response.data.updated || 0} aggiornati, ${response.data.skipped?.length || 0} saltati`);
      onImported?.();
      onClose();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Importazione listino non riuscita');
    } finally {
      setBusy(false);
    }
  };

  return <Modal
    isOpen={open}
    onClose={() => { if (!busy) onClose(); }}
    title={<span className="flex items-center gap-2"><FileSpreadsheet size={21} /> Importa listino materiali Excel</span>}
    size="5xl"
    closeLabel="Chiudi importazione"
  >
      <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">Ogni foglio diventa il fornitore. Il server riconosce nome, spessore e prezzo; scegli cosa fare con i duplicati prima di confermare.</p>
      <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void preview(event.target.files?.[0] || null)} disabled={busy} />
      {busy && <p className="mt-3 text-sm text-gray-500">Elaborazione...</p>}
      {importPreview && <div className="mt-4 space-y-4">
        {importPreview.sheets?.map((sheet: any) => <div key={sheet.name} className="rounded border p-3"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><b>{sheet.name}</b><span className="text-xs text-gray-500">{sheet.totalRows} righe · {sheet.validRows} valide · {sheet.duplicates} duplicati</span></div><div className="grid grid-cols-1 gap-2 md:grid-cols-3">{['name', 'thickness', 'unitPrice', 'variant', 'unit', 'category'].map((field) => <label key={field} className="text-xs"><span className="mb-1 block font-medium">{field === 'unitPrice' ? 'Prezzo' : field === 'unit' ? 'Unità' : field === 'variant' ? 'Variante / finitura' : field === 'thickness' ? 'Spessore' : field === 'category' ? 'Categoria' : 'Nome'}</span><select value={importMapping[sheet.name]?.[field] || ''} onChange={(event) => setImportMapping((current) => ({ ...current, [sheet.name]: { ...(current[sheet.name] || {}), [field]: event.target.value } }))} className="w-full rounded border p-2 dark:bg-dark-input"><option value="">(non mappare)</option>{sheet.headers.map((header: string) => <option key={header} value={header}>{header}</option>)}</select></label>)}</div>{sheet.invalidRows?.length > 0 && <p className="mt-2 text-xs text-red-600">Scartate: {sheet.invalidRows.map((row: any) => `riga ${row.rowNumber}: ${row.reason}`).join(' · ')}</p>}<div className="mt-3 overflow-x-auto"><table className="w-full text-xs"><tbody>{(sheet.sampleRows || []).slice(0, 3).map((row: any, index: number) => <tr key={`${sheet.name}-${index}`} className="border-b">{Object.entries(row).filter(([key]) => !['rowNumber', 'duplicate', 'importKey'].includes(key)).slice(0, 6).map(([key, value]) => <td key={key} className="p-1">{key}: {String(value ?? '')}</td>)}</tr>)}</tbody></table></div></div>)}
        <label className="block"><span className="mb-1 block text-sm font-medium">Duplicati</span><select value={duplicateMode} onChange={(event) => setDuplicateMode(event.target.value as 'skip' | 'update')} className="rounded border p-2 dark:bg-dark-input"><option value="skip">Salta duplicati</option><option value="update">Aggiorna duplicati (conferma esplicita)</option></select></label>
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded border px-3 py-2">Annulla</button><button type="button" disabled={busy} onClick={() => void commit()} className="rounded bg-light-primary px-3 py-2 text-white disabled:opacity-50">Conferma importazione</button></div>
      </div>}
  </Modal>;
};

export default MaterialImportModal;
