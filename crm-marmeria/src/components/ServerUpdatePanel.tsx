import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, RefreshCw, Rocket, Server } from 'lucide-react';
import { apiClient } from '../services/api';

type UpdateProgress = {
  stage: string;
  percent: number;
  message: string;
  error?: boolean;
  updatedAt: string;
};

type ServerUpdateStatus = {
  version: string;
  branch: string;
  localRevision: string;
  remoteRevision: string;
  updateAvailable: boolean;
  pendingCommits: number;
  progress?: UpdateProgress | null;
};

const UPDATE_TRACKING_KEY = 'crm-marmeria-update-in-progress';
const errorMessage = (error: any) => error?.response?.data?.error || error?.message || 'Operazione non riuscita';
const initialTracking = () => typeof window !== 'undefined' && window.sessionStorage.getItem(UPDATE_TRACKING_KEY) === '1';

const ServerUpdatePanel: React.FC = () => {
  const [status, setStatus] = useState<ServerUpdateStatus | null>(null);
  const [message, setMessage] = useState('Controllo disponibilità aggiornamenti...');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [trackingUpdate, setTrackingUpdate] = useState(initialTracking);

  const finishTracking = () => {
    window.sessionStorage.removeItem(UPDATE_TRACKING_KEY);
    setTrackingUpdate(false);
    setBusy(false);
  };

  const load = useCallback(async (refresh = false) => {
    try {
      const response = refresh
        ? await apiClient.post('/system/update/check')
        : await apiClient.get('/system/update/status');
      const next = response.data as ServerUpdateStatus;
      const progress = next.progress || null;
      setStatus(next);

      if (trackingUpdate && progress?.error) {
        finishTracking();
        setError(true);
        setMessage(progress.message || 'Aggiornamento non riuscito.');
        return;
      }
      if (trackingUpdate && progress?.stage === 'ready' && progress.percent === 100) {
        finishTracking();
        setError(false);
        setMessage(progress.message || 'Aggiornamento completato. CRM pronto per l’uso.');
        return;
      }
      setError(false);
      setMessage(trackingUpdate && progress
        ? progress.message
        : next.updateAvailable
          ? `Disponibili ${next.pendingCommits} aggiornamenti del server.`
          : 'Server già aggiornato.');
    } catch (requestError) {
      if (trackingUpdate) {
        setError(false);
        setMessage('Server in riavvio. Attendo che torni operativo...');
        return;
      }
      setError(true);
      setMessage(errorMessage(requestError));
    }
  }, [trackingUpdate]);

  useEffect(() => {
    void load();
    if (!trackingUpdate) return undefined;
    const interval = window.setInterval(() => void load(), 1500);
    return () => window.clearInterval(interval);
  }, [load, trackingUpdate]);

  const check = async () => {
    setBusy(true);
    setMessage('Ricerca aggiornamenti su GitHub...');
    await load(true);
    setBusy(false);
  };

  const apply = async () => {
    setBusy(true);
    setError(false);
    setMessage('Preparo aggiornamento...');
    try {
      const result = (await apiClient.post('/system/update/apply')).data as ServerUpdateStatus & { updated: boolean };
      setStatus(result);
      if (!result.updated) {
        setMessage(result.progress?.message || 'Nessun aggiornamento da installare.');
        setBusy(false);
        return;
      }
      window.sessionStorage.setItem(UPDATE_TRACKING_KEY, '1');
      setTrackingUpdate(true);
      setMessage(result.progress?.message || 'Codice aggiornato. Riavvio server...');
    } catch (requestError) {
      setError(true);
      setMessage(errorMessage(requestError));
      setBusy(false);
    }
  };

  const progress = status?.progress;
  const showProgress = trackingUpdate || Boolean(progress && progress.stage !== 'ready');
  const percent = Math.max(0, Math.min(100, progress?.percent || 0));

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
      {showProgress && (
        <div className="mt-4 rounded-md border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-900 dark:bg-indigo-950/30">
          <div className="mb-2 flex items-center justify-between gap-3 text-sm font-medium text-indigo-900 dark:text-indigo-100">
            <span>{progress?.message || 'Avvio aggiornamento...'}</span><span>{percent}%</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-indigo-200 dark:bg-indigo-900"><div className="h-full rounded-full bg-indigo-600 transition-all duration-500" style={{ width: `${percent}%` }} /></div>
          <p className="mt-2 text-xs text-indigo-800 dark:text-indigo-200">100% solo quando CRM aggiornato risponde ed è pronto per essere usato.</p>
        </div>
      )}
      {status && <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">Installato: {status.localRevision} · GitHub: {status.remoteRevision}</p>}
      <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">Aggiorna questo PC server da GitHub. Telefoni e browser collegati devono solo ricaricare pagina dopo riavvio.</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" onClick={() => void check()} disabled={busy || trackingUpdate} className="px-4 py-2 border rounded-md flex items-center gap-2 disabled:opacity-50"><RefreshCw size={17} /> Controlla</button>
        {status?.updateAvailable && <button type="button" onClick={() => void apply()} disabled={busy || trackingUpdate} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white rounded-md flex items-center gap-2"><Download size={17} /> Aggiorna e riavvia</button>}
        {trackingUpdate && <span className="inline-flex items-center text-sm text-gray-500"><Rocket size={16} className="mr-2" /> Aggiornamento in corso</span>}
      </div>
    </section>
  );
};

export default ServerUpdatePanel;
