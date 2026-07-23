import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, RefreshCw, Rocket } from 'lucide-react';

const statusStyle = (status: AppUpdateState['status']) => ({
  idle: 'bg-gray-50 text-gray-700 dark:bg-gray-800 dark:text-gray-200',
  checking: 'bg-gray-50 text-gray-700 dark:bg-gray-800 dark:text-gray-200',
  error: 'bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-200',
  available: 'bg-blue-50 text-blue-800 dark:bg-blue-900/20 dark:text-blue-200',
  downloading: 'bg-blue-50 text-blue-800 dark:bg-blue-900/20 dark:text-blue-200',
  downloaded: 'bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-200',
  'up-to-date': 'bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-200',
  unsupported: 'bg-gray-50 text-gray-700 dark:bg-gray-800 dark:text-gray-200',
}[status]);

const AppUpdatePanel: React.FC = () => {
  const updater = window.electronAPI?.updates;
  const [state, setState] = useState<AppUpdateState | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!updater) return;
    setState(await updater.getStatus());
  }, [updater]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => window.clearInterval(timer);
  }, [refresh]);

  if (!updater) {
    return (
      <section className="mb-10 p-6 bg-light-card dark:bg-dark-card text-light-text dark:text-dark-text border border-light-border dark:border-dark-border rounded-lg shadow-md">
        <h3 className="text-xl font-semibold mb-2 flex items-center gap-3"><Download size={24} className="text-indigo-500" /> Aggiornamenti</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">Questa Ã¨ la versione browser: viene aggiornata dal PC server. Dopo un aggiornamento del server basta ricaricare la pagina.</p>
      </section>
    );
  }

  const run = async (action: () => Promise<AppUpdateState | { success: boolean; error?: string }>) => {
    setBusy(true);
    try {
      const result = await action();
      if ('status' in result) setState(result);
      else if (!result.success) setState((current) => current ? { ...current, status: 'error', message: result.error } : current);
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  const status = state || {
    status: 'idle' as const,
    currentVersion: window.electronAPI?.version || '-',
    message: 'Pronto a controllare aggiornamenti',
  };
  const checking = status.status === 'checking' || status.status === 'downloading';

  return (
    <section className="mb-10 p-6 bg-light-card dark:bg-dark-card text-light-text dark:text-dark-text border border-light-border dark:border-dark-border rounded-lg shadow-md">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h3 className="text-xl font-semibold flex items-center gap-3"><Download size={24} className="text-indigo-500" /> Aggiornamenti app</h3>
        <span className="text-sm text-gray-500 dark:text-gray-400">Versione installata {status.currentVersion}</span>
      </div>
      <div className={`rounded-md p-3 text-sm flex items-start gap-2 ${statusStyle(status.status)}`}>
        {status.status === 'error' ? <AlertTriangle size={18} className="shrink-0 mt-0.5" /> : <CheckCircle2 size={18} className="shrink-0 mt-0.5" />}
        <span>{status.message || 'Pronto a controllare aggiornamenti'}</span>
      </div>
      {status.status === 'downloading' && (
        <div className="mt-4">
          <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden"><div className="h-full bg-indigo-600 transition-all" style={{ width: `${status.percent || 0}%` }} /></div>
          <p className="mt-1 text-xs text-gray-500">{status.percent || 0}%</p>
        </div>
      )}
      {status.releaseNotes && <p className="mt-3 text-sm whitespace-pre-wrap text-gray-600 dark:text-gray-300">{status.releaseNotes}</p>}
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" onClick={() => void run(updater.check)} disabled={busy || checking} className="px-4 py-2 border rounded-md flex items-center gap-2 disabled:opacity-50"><RefreshCw size={17} /> Controlla</button>
        {status.status === 'available' && <button type="button" onClick={() => void run(updater.download)} disabled={busy} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md flex items-center gap-2"><Download size={17} /> Scarica aggiornamento</button>}
        {status.status === 'downloaded' && <button type="button" onClick={() => void run(updater.install)} disabled={busy} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md flex items-center gap-2"><Rocket size={17} /> Installa e riavvia</button>}
      </div>
    </section>
  );
};

export default AppUpdatePanel;
