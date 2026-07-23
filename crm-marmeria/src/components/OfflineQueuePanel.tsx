import React, { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, Trash2, WifiOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';
import { offlineQueue } from '../services/offlineQueue';
import type { QueuedRequest } from '../services/offlineQueue';

const OfflineQueuePanel: React.FC = () => {
  const [items, setItems] = useState<QueuedRequest[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    try {
      setItems(await offlineQueue.list());
    } catch (error) {
      console.error('Lettura coda offline fallita:', error);
    }
  };

  useEffect(() => {
    void load();
    const listener = () => void load();
    window.addEventListener('crm-offline-queue-changed', listener);
    window.addEventListener('crm-auth-changed', listener);
    window.addEventListener('crm-api-url-changed', listener);
    return () => {
      window.removeEventListener('crm-offline-queue-changed', listener);
      window.removeEventListener('crm-auth-changed', listener);
      window.removeEventListener('crm-api-url-changed', listener);
    };
  }, []);

  const retry = async (item: QueuedRequest) => {
    setBusyId(item.id);
    try {
      await offlineQueue.unblock(item.id, true);
      await apiClient.replayOfflineQueue();
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Invio modifica non riuscito');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (item: QueuedRequest) => {
    if (!window.confirm('Eliminare questa modifica dalla coda senza inviarla al server?')) return;
    try {
      await offlineQueue.remove(item.id);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Eliminazione dalla coda non riuscita');
    }
  };

  if (!items.length) return null;

  return (
    <div className="mb-6 p-5 bg-white dark:bg-dark-card rounded-lg shadow-md">
      <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-200 flex items-center mb-2">
        <WifiOff size={21} className="mr-3 text-orange-500" /> Modifiche offline in attesa
      </h3>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Le modifiche normali vengono inviate automaticamente. In caso di conflitto, “Riprova” applica la modifica sulla versione più recente del record.
      </p>
      <div className="space-y-3 max-h-72 overflow-y-auto">
        {items.map((item) => (
          <div
            key={item.id}
            className={`p-3 border rounded-md ${item.blocked ? 'border-red-300 bg-red-50 dark:bg-red-900/10' : 'border-orange-200 bg-orange-50 dark:bg-orange-900/10'}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium break-all">{item.method.toUpperCase()} {item.url}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {new Date(item.createdAt).toLocaleString('it-IT')} · tentativi: {item.attempts}
                </p>
                {item.lastError && (
                  <p className="text-sm text-red-700 dark:text-red-300 mt-2 flex items-start gap-2">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {item.lastError}
                  </p>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => void retry(item)}
                  disabled={busyId === item.id}
                  className="px-3 py-2 border rounded-md flex items-center gap-2 disabled:opacity-50"
                >
                  <RefreshCw size={16} /> Riprova
                </button>
                <button
                  type="button"
                  onClick={() => void remove(item)}
                  disabled={busyId === item.id}
                  className="p-2 text-red-600 border rounded-md disabled:opacity-50"
                  title="Elimina dalla coda"
                >
                  <Trash2 size={17} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default OfflineQueuePanel;
