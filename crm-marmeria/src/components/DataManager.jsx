import React, { useEffect, useState } from 'react';
import { Download, Upload, AlertTriangle, CheckCircle, Database, Trash2 } from 'lucide-react';
import { apiClient } from '../services/api';

const DataManager = () => {
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [status, setStatus] = useState(null);
  const [availableBackups, setAvailableBackups] = useState([]);

  const getNetworkPrefs = () => {
    try {
      return JSON.parse(localStorage.getItem('networkPrefs') || '{}');
    } catch {
      return {};
    }
  };

  const loadAvailableBackups = async () => {
    const networkPrefs = getNetworkPrefs();
    if (!window.electronAPI?.network || !networkPrefs.sharedPath) return;

    try {
      const result = await window.electronAPI.network.listBackupsInSharedFolder();
      if (result.success) setAvailableBackups(result.files || []);
    } catch (error) {
      console.error('Errore nel caricamento dei backup:', error);
    }
  };

  useEffect(() => {
    loadAvailableBackups();
  }, []);

  const downloadBackup = (backup, filename) => {
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const exportData = async () => {
    setIsExporting(true);
    setStatus(null);

    try {
      const response = await apiClient.get('/backup');
      const backup = response.data;
      const filename = `crm-marmeria-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      const networkPrefs = getNetworkPrefs();

      if (window.electronAPI?.network && networkPrefs.sharedPath) {
        const result = await window.electronAPI.network.saveBackupToSharedFolder(backup, filename);
        if (result.success) {
          setStatus({ type: 'success', message: `Backup reale del server salvato in: ${result.path}` });
          await loadAvailableBackups();
          return;
        }
      }

      downloadBackup(backup, filename);
      setStatus({ type: 'success', message: 'Backup reale del server esportato con successo.' });
    } catch (error) {
      console.error('Errore durante l’esportazione:', error);
      setStatus({ type: 'error', message: error?.response?.data?.error || 'Impossibile esportare il backup.' });
    } finally {
      setIsExporting(false);
    }
  };

  const restoreBackup = async (backup, sourceName = 'file selezionato') => {
    if (!backup?.version || !backup?.data) throw new Error('File di backup non valido o corrotto.');

    const confirmed = window.confirm(
      `Ripristinare il backup da ${sourceName}?\n\nI dati correnti del server verranno sostituiti. È consigliato esportare prima un backup aggiornato.`
    );
    if (!confirmed) return;

    await apiClient.post('/backup/restore', backup);
    setStatus({ type: 'success', message: 'Backup ripristinato. La pagina verrà ricaricata.' });
    window.setTimeout(() => window.location.reload(), 700);
  };

  const importData = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setIsImporting(true);
    setStatus(null);
    try {
      const backup = JSON.parse(await file.text());
      await restoreBackup(backup, file.name);
    } catch (error) {
      console.error('Errore durante l’importazione:', error);
      setStatus({ type: 'error', message: error?.response?.data?.error || error.message || 'Importazione non riuscita.' });
    } finally {
      setIsImporting(false);
    }
  };

  const importFromSharedFolder = async (filename) => {
    setIsImporting(true);
    setStatus(null);
    try {
      const result = await window.electronAPI.network.loadBackupFromSharedFolder(filename);
      if (!result.success) throw new Error(result.error);
      await restoreBackup(result.data, filename);
    } catch (error) {
      console.error('Errore durante l’importazione:', error);
      setStatus({ type: 'error', message: error?.response?.data?.error || error.message || 'Importazione non riuscita.' });
    } finally {
      setIsImporting(false);
    }
  };

  const clearAllData = async () => {
    const first = window.confirm(
      'Questa operazione cancellerà clienti, lavori, materiali, preventivi e fatture dal server. Gli account utente resteranno presenti. Continuare?'
    );
    if (!first) return;
    const second = window.confirm('Ultima conferma: i dati applicativi verranno cancellati definitivamente.');
    if (!second) return;

    try {
      await apiClient.post('/backup/clear');
      setStatus({ type: 'success', message: 'Dati cancellati. La pagina verrà ricaricata.' });
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      setStatus({ type: 'error', message: error?.response?.data?.error || 'Cancellazione non riuscita.' });
    }
  };

  return (
    <div className="mb-10 p-6 bg-white dark:bg-dark-card rounded-lg shadow-md">
      <h3 className="text-xl font-semibold mb-4 text-gray-700 dark:text-gray-200 flex items-center">
        <Database size={24} className="mr-3 text-blue-500" /> Gestione Dati
      </h3>

      <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
        Il backup viene creato direttamente dai file usati dal server, non dal localStorage del browser.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <button
          onClick={exportData}
          disabled={isExporting || isImporting}
          className="px-4 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-md flex items-center justify-center"
        >
          <Download size={18} className="mr-2" />
          {isExporting ? 'Esportazione...' : 'Esporta backup'}
        </button>

        <label className={`px-4 py-3 rounded-md flex items-center justify-center text-white ${isExporting || isImporting ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700 cursor-pointer'}`}>
          <Upload size={18} className="mr-2" />
          {isImporting ? 'Importazione...' : 'Importa backup'}
          <input type="file" accept=".json,application/json" onChange={importData} disabled={isExporting || isImporting} className="hidden" />
        </label>

        <button
          onClick={clearAllData}
          disabled={isExporting || isImporting}
          className="px-4 py-3 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white rounded-md flex items-center justify-center"
        >
          <Trash2 size={18} className="mr-2" /> Cancella dati
        </button>
      </div>

      {availableBackups.length > 0 && (
        <div className="mt-6 border-t border-gray-200 dark:border-gray-700 pt-5">
          <h4 className="font-medium text-gray-700 dark:text-gray-200 mb-3">Backup nella cartella condivisa</h4>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {availableBackups.map((backup) => (
              <div key={backup.name} className="flex items-center justify-between gap-3 p-3 rounded-md bg-gray-50 dark:bg-gray-800">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{backup.name}</p>
                  <p className="text-xs text-gray-500">{new Date(backup.modified).toLocaleString('it-IT')}</p>
                </div>
                <button
                  onClick={() => importFromSharedFolder(backup.name)}
                  disabled={isImporting}
                  className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-md"
                >
                  Ripristina
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {status && (
        <div className={`mt-5 p-3 rounded-md flex items-start ${status.type === 'success' ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'}`}>
          {status.type === 'success' ? <CheckCircle size={18} className="mr-2 mt-0.5 shrink-0" /> : <AlertTriangle size={18} className="mr-2 mt-0.5 shrink-0" />}
          <span>{status.message}</span>
        </div>
      )}
    </div>
  );
};

export default DataManager;
