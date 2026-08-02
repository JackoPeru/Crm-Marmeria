import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  Database,
  Download,
  RefreshCw,
  RotateCcw,
  Upload,
} from 'lucide-react';
import { apiClient } from '../services/api';

const formatBytes = (bytes = 0) => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
};

const DataManager = () => {
  const [backups, setBackups] = useState([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);

  const loadBackups = async () => {
    try {
      setBackups((await apiClient.get('/backups')).data || []);
    } catch (error) {
      if (error.response?.status !== 403) console.error('Caricamento backup fallito:', error);
    }
  };

  useEffect(() => {
    void loadBackups();
  }, []);

  const run = async (action) => {
    setBusy(true);
    setStatus(null);
    try {
      await action();
    } catch (error) {
      setStatus({
        type: 'error',
        message: error.response?.data?.error || error.message || 'Operazione non riuscita',
      });
    } finally {
      setBusy(false);
    }
  };

  const createSnapshot = () => run(async () => {
    await apiClient.post('/backups', { label: 'manuale' });
    await loadBackups();
    setStatus({ type: 'success', message: 'Backup completo creato sul PC principale.' });
  });

  const restoreSnapshot = (backup) => run(async () => {
    if (!window.confirm(
      `Ripristinare il backup del ${new Date(backup.createdAt).toLocaleString('it-IT')}? I dati, gli account e gli allegati correnti saranno sostituiti.`,
    )) return;
    await apiClient.post(`/backups/${encodeURIComponent(backup.name)}/restore`);
    setStatus({ type: 'success', message: 'Backup ripristinato. La pagina verrà ricaricata.' });
    window.setTimeout(() => window.location.reload(), 800);
  });

  const exportJson = () => run(async () => {
    const response = await apiClient.get('/backup/export');
    const blob = new Blob([JSON.stringify(response.data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `crm-marmeria-export-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus({
      type: 'success',
      message: 'Esportazione JSON completata. Il file JSON non include gli allegati binari né gli account.',
    });
  });

  const importJson = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void run(async () => {
      const parsed = JSON.parse(await file.text());
      if (!window.confirm(
        `Importare ${file.name}? I dati correnti saranno sostituiti. Gli allegati dei record presenti nel JSON verranno mantenuti; quelli di record assenti saranno rimossi. Prima dell’operazione verrà creato un backup completo.`,
      )) return;
      await apiClient.post('/backup/import', parsed);
      setStatus({ type: 'success', message: 'Importazione completata. Allegati compatibili mantenuti. La pagina verrà ricaricata.' });
      window.setTimeout(() => window.location.reload(), 800);
    });
  };

  return (
    <div className="mb-10 p-6 bg-white dark:bg-dark-card rounded-lg shadow-md">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="text-xl font-semibold text-gray-700 dark:text-gray-200 flex items-center">
            <Database size={24} className="mr-3 text-blue-500" /> Backup del server centrale
          </h3>
          <button
            onClick={() => void loadBackups()}
            disabled={busy}
            className="p-2 border rounded-md"
            title="Aggiorna elenco"
          >
            <RefreshCw size={18} />
          </button>
        </div>

        <p className="text-sm text-gray-600 dark:text-gray-400 mb-5">
          Il server crea automaticamente un backup completo al giorno e conserva gli ultimi 30. Ogni snapshot include database SQLite, account e allegati.
        </p>

        <div className="flex flex-wrap gap-3 mb-6">
          <button
            onClick={createSnapshot}
            disabled={busy}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-md flex items-center gap-2"
          >
            <Database size={18} /> Crea backup ora
          </button>
          <button
            onClick={exportJson}
            disabled={busy}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-md flex items-center gap-2"
          >
            <Download size={18} /> Esporta JSON
          </button>
          <label className={`px-4 py-2 rounded-md text-white flex items-center gap-2 ${busy ? 'bg-gray-400' : 'bg-indigo-600 hover:bg-indigo-700 cursor-pointer'}`}>
            <Upload size={18} /> Importa JSON
            <input
              type="file"
              accept="application/json,.json"
              onChange={importJson}
              disabled={busy}
              className="hidden"
            />
          </label>
        </div>

        {backups.length > 0 ? (
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {backups.map((backup) => (
              <div
                key={backup.name}
                className="p-3 border rounded-md flex flex-wrap items-center justify-between gap-3"
              >
                <div>
                  <p className="font-medium">
                    {backup.label === 'automatico' ? 'Backup automatico' : 'Backup manuale'}
                  </p>
                  <p className="text-sm text-gray-500">
                    {new Date(backup.createdAt).toLocaleString('it-IT')} · {formatBytes(backup.sizeBytes)}
                  </p>
                </div>
                <button
                  onClick={() => restoreSnapshot(backup)}
                  disabled={busy}
                  className="px-3 py-2 border rounded-md flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <RotateCcw size={17} /> Ripristina
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            Nessun backup elencato oppure account senza permesso per visualizzarli.
          </p>
        )}

        {status && (
          <div className={`mt-5 p-3 rounded-md flex items-start ${status.type === 'success' ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'}`}>
            {status.type === 'success'
              ? <CheckCircle size={18} className="mr-2 mt-0.5" />
              : <AlertTriangle size={18} className="mr-2 mt-0.5" />}
            {status.message}
          </div>
        )}
    </div>
  );
};

export default DataManager;
