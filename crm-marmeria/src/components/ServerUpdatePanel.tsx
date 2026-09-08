import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, RefreshCw, Rocket, Server } from 'lucide-react';
import { apiClient } from '../services/api';
import {
  progressMatchesAttempt,
  updateAttemptExpired,
  updateAttemptOutcome,
  type UpdateAttempt,
} from '../domain/server-update/tracking';
import { createId } from '../utils/ids';

type UpdateProgress = {
  stage: string;
  percent: number;
  message: string;
  error?: boolean;
  updatedAt: string;
  updateId?: string;
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

const initialTracking = (): UpdateAttempt | null => {
  if (typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem(UPDATE_TRACKING_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const startedAt = Number(parsed?.startedAt);
    if (!parsed?.id || !Number.isFinite(startedAt)) throw new Error('tracking legacy');
    return {
      id: String(parsed.id),
      startedAt,
      confirmed: Boolean(parsed.confirmed),
    };
  } catch {
    window.sessionStorage.removeItem(UPDATE_TRACKING_KEY);
    return null;
  }
};

const ServerUpdatePanel: React.FC = () => {
  const [status, setStatus] = useState<ServerUpdateStatus | null>(null);
  const [message, setMessage] = useState('Controllo disponibilità aggiornamenti...');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [trackingAttempt, setTrackingAttempt] = useState<UpdateAttempt | null>(initialTracking);
  const trackingUpdate = Boolean(trackingAttempt);

  const persistTracking = useCallback((attempt: UpdateAttempt) => {
    window.sessionStorage.setItem(UPDATE_TRACKING_KEY, JSON.stringify(attempt));
    setTrackingAttempt(attempt);
  }, []);

  const finishTracking = useCallback(() => {
    window.sessionStorage.removeItem(UPDATE_TRACKING_KEY);
    setTrackingAttempt(null);
    setBusy(false);
  }, []);

  const load = useCallback(async (refresh = false) => {
    try {
      const response = refresh
        ? await apiClient.post('/system/update/check', undefined, { timeout: 90_000 })
        : await apiClient.get('/system/update/status');
      const next = response.data as ServerUpdateStatus;
      const progress = next.progress || null;
      setStatus(next);

      if (trackingAttempt) {
        const outcome = updateAttemptOutcome(progress, trackingAttempt);
        if (outcome !== 'waiting' && !trackingAttempt.confirmed) {
          persistTracking({ ...trackingAttempt, confirmed: true });
        }

        if (outcome === 'error') {
          finishTracking();
          setError(true);
          setMessage(progress?.message || 'Aggiornamento non riuscito.');
          return;
        }
        if (outcome === 'ready') {
          finishTracking();
          setError(false);
          setMessage(progress?.message || 'Aggiornamento completato. CRM pronto per l’uso.');
          return;
        }
        if (outcome === 'active') {
          setError(false);
          setMessage(progress?.message || 'Aggiornamento in corso...');
          return;
        }
        if (updateAttemptExpired(trackingAttempt)) {
          finishTracking();
          setError(true);
          setMessage('Il server non ha confermato l’avvio dell’aggiornamento. Controlla di nuovo gli aggiornamenti.');
          return;
        }

        setError(false);
        setMessage('Richiesta aggiornamento inviata. Attendo conferma dal server...');
        return;
      }

      setError(false);
      setMessage(next.updateAvailable
        ? `Disponibili ${next.pendingCommits} aggiornamenti del server.`
        : 'Server già aggiornato.');
    } catch (requestError) {
      if (trackingAttempt) {
        if (updateAttemptExpired(trackingAttempt)) {
          finishTracking();
          setError(true);
          setMessage('Il server non ha confermato l’avvio dell’aggiornamento. Controlla che sia online e riprova.');
          return;
        }
        setError(false);
        setMessage(trackingAttempt.confirmed
          ? 'Server in riavvio. Attendo che torni operativo...'
          : 'Richiesta aggiornamento inviata. Attendo conferma dal server...');
        return;
      }
      setError(true);
      setMessage(errorMessage(requestError));
    }
  }, [finishTracking, persistTracking, trackingAttempt]);

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
    const attempt: UpdateAttempt = {
      id: createId(),
      startedAt: Date.now(),
      confirmed: false,
    };
    persistTracking(attempt);
    setBusy(true);
    setError(false);
    setMessage('Preparo aggiornamento...');

    try {
      const result = (await apiClient.post(
        '/system/update/apply',
        { updateId: attempt.id },
        { timeout: 30_000 },
      )).data as ServerUpdateStatus & { updated: boolean };
      setStatus(result);

      if (!result.updated) {
        finishTracking();
        setError(false);
        setMessage(result.progress?.message || 'Nessun aggiornamento da installare.');
        return;
      }

      const confirmed = progressMatchesAttempt(result.progress, attempt);
      persistTracking(confirmed ? { ...attempt, confirmed: true } : attempt);
      setBusy(false);
      setMessage(result.progress?.message || 'Aggiornamento avviato. Attendo il riavvio del server...');
    } catch (requestError: any) {
      if (requestError?.response) {
        finishTracking();
        setError(true);
        setMessage(errorMessage(requestError));
        return;
      }

      // Un timeout o la perdita della connessione durante il riavvio non
      // significa che l'update sia fallito: il polling con updateId decide
      // l'esito usando lo stato persistito dal server.
      setBusy(false);
      setError(false);
      setMessage('Richiesta inviata. Continuo a verificare lo stato dell’aggiornamento...');
    }
  };

  const progress = status?.progress || null;
  const displayProgress = trackingAttempt
    ? (progressMatchesAttempt(progress, trackingAttempt) ? progress : null)
    : progress;
  const showProgress = trackingUpdate || Boolean(displayProgress && displayProgress.stage !== 'ready');
  const percent = Math.max(0, Math.min(100, displayProgress?.percent || 0));

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
            <span>{displayProgress?.message || 'Richiesta aggiornamento inviata...'}</span><span>{percent}%</span>
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
