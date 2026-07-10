import React, { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, Trash2, WifiOff } from 'lucide-react';
import { apiClient } from '../services/api';
import { offlineQueue, QueuedRequest } from '../services/offlineQueue';

const OfflineQueuePanel: React.FC = () => {
  const [items, setItems] = useState<QueuedRequest[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => setItems(await offlineQueue.list());

  useEffect(() => {
    void load();
    const listener = () => void load();
    window.addEventListener('crm-offline-queue-changed', listener);
    return () => window.removeEventListener('crm-offline-queue-changed', listener);
  }, []);

  const retry = async (item: QueuedRequest) => {
    setBusyId(item.id);
    try {
      await offlineQueue.unblock(item.id);
      await apiClient.replayOfflineQueue();
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (item: QueuedRequest) => {
    if (!window.confirm('Eliminare questa modifica dalla coda senza inviarla al server?')) return;
    await offlineQueue.remove(item.id);
    await load();
  };

  if (!items.length) return null;

  return (
    <div className="mb-10 p-6 bg-white dark:bg-dark-card rounded-lg shadow-md">
      <h3 className="text-xl font-semibold text-gray-700 dark:text-gray-200 flex items-center mb-3">
        <WifiOff size={23} className="mr-3 text-orange-500" /> Modifiche offline in attesa
      </h3>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Le operazioni normali vengono inviate automaticamente. Quelle con un conflitto restano bloccate finché non vengono controllate.
      </p>
      <div className="space-y-3 max-h-72 overflow-y-auto">
        {items.map((item) => (
          <div key={item.id} className={`p-3 border rounded-md ${item.blocked ? 'border-red-300 bg-red-50 dark:bg-red-900/10' : 'border-orange-200 bg-orange-50 dark:bg-orange-900/10'}`}>
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
