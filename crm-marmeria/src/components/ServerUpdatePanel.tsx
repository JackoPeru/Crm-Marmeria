import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, RefreshCw, Rocket, Server } from 'lucide-react';
import { apiClient } from '../services/api';

type ServerUpdateStatus = {
  version: string;
  branch: string;
  localRevision: string;
  remoteRevision: string;
  updateAvailable: boolean;
  pendingCommits: number;
};

const errorMessage = (error: any) => error?.response?.data?.error || error?.message || 'Operazione non riuscita';

const ServerUpdatePanel: React.FC = () => {
  const [status, setStatus] = useState<ServerUpdateStatus | null>(null);
  const [message, setMessage] = useState('Controllo disponibilità aggiornamenti...');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (refresh = false) => {
    try {
      const response = refresh
        ? await apiClient.post('/system/update/check')
        : await apiClient.get('/system/update/status');
      const next = response.data as ServerUpdateStatus;
      setStatus(next);
      setError(false);
      setMessage(next.updateAvailable
        ? `Disponibili ${next.pendingCommits} aggiornamenti del server.`
        : 'Server già aggiornato.');
    } catch (requestError) {
      setError(true);
      setMessage(errorMessage(requestError));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const check = async () => {
    setBusy(true);
    setMessage('Ricerca aggiornamenti su GitHub...');
    await load(true);
    setBusy(false);
  };

  const apply = async () => {
    setBusy(true);
    setError(false);
    setMessage('Scarico aggiornamento e riavvio server...');
    try {
      const result = (await apiClient.post('/system/update/apply')).data as ServerUpdateStatus & {
        updated: boolean;
      };
      setStatus(result);
      setMessage(result.updated
        ? 'Aggiornamento installato. Server in riavvio: ricarica questa pagina tra pochi secondi.'
        : 'Nessun aggiornamento da installare.');
    } catch (requestError) {
      setError(true);
      setMessage(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mb-10 p-6 bg-light-card dark:bg-dark-card text-light-text dark:text-dark-text border border-light-border dark:border-dark-border rounded-lg shadow-md">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h3 className="text-xl font-semibold flex items-center gap-3"><Server size={24} className="text-indigo-500" /> Aggiornamento server</h3>
        {status && <span className="text-sm text-gray-500 dark:text-gray-400">v{status.version} · {status.branch}</span>}
      </div>
      <div className={`rounded-md p-3 text-sm flex items-start gap-2 ${error ? 'bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-200' : 'bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-200'}`}>
        {error ? <AlertTriangle size={18} className="shrink-0 mt-0.5" /> : <CheckCircle2 size={18} className="shrink-0 mt-0.5" />}
        <span>{message}</span>
      </div>
      {status && <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">Installato: {status.localRevision} · GitHub: {status.remoteRevision}</p>}
      <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">Aggiorna questo PC server da GitHub. Telefoni e browser collegati devono solo ricaricare pagina dopo riavvio.</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" onClick={() => void check()} disabled={busy} className="px-4 py-2 border rounded-md flex items-center gap-2 disabled:opacity-50"><RefreshCw size={17} /> Controlla</button>
        {status?.updateAvailable && <button type="button" onClick={() => void apply()} disabled={busy} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white rounded-md flex items-center gap-2"><Download size={17} /> Aggiorna e riavvia</button>}
        {busy && <span className="inline-flex items-center text-sm text-gray-500"><Rocket size={16} className="mr-2" /> Attendi</span>}
      </div>
    </section>
  );
};

export default ServerUpdatePanel;
