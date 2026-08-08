import React, { useEffect, useState } from 'react';
import { Clock3, RefreshCw } from 'lucide-react';
import { apiClient } from '../services/api';
import { formatAuditItem } from '../utils/auditHistory';
import type { AuditItem } from '../utils/auditHistory';

const AuditHistory: React.FC<{ entityType: string; entityId: string }> = ({ entityType, entityId }) => {
  const [items, setItems] = useState<AuditItem[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setItems((await apiClient.get('/audit/' + entityType + '/' + entityId, { params: { limit: 100 } })).data || []);
    } catch (error) {
      console.error('Caricamento storico fallito:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [entityType, entityId]);
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<any>).detail;
      if (detail?.entityType === entityType && String(detail?.item?.id || detail?.id) === String(entityId)) void load();
    };
    window.addEventListener('crm-realtime', listener);
    return () => window.removeEventListener('crm-realtime', listener);
  }, [entityType, entityId]);

  return <div className="mt-6 border-t border-light-border pt-5 dark:border-dark-border">
    <div className="mb-3 flex items-center justify-between"><h3 className="flex items-center gap-2 font-semibold"><Clock3 size={18} /> Storico modifiche</h3><button type="button" onClick={() => void load()} className="rounded-md border p-1.5" title="Aggiorna storico" aria-label="Aggiorna storico"><RefreshCw size={15} /></button></div>
    {loading && !items.length && <p className="text-sm text-gray-500">Caricamento...</p>}
    {!items.length && !loading && <p className="text-sm text-gray-500">Nessuna modifica registrata.</p>}
    <div className="max-h-96 space-y-2 overflow-y-auto">{items.map((item) => {
      const formatted = formatAuditItem(item);
      return <article key={item.id} className="rounded-md bg-gray-50 p-3 text-sm dark:bg-gray-800">
        <p><strong>{formatted.summary}</strong></p>
        {formatted.changes.length > 0
          ? <ul className="mt-2 space-y-1 text-gray-700 dark:text-gray-200">{formatted.changes.map((change, index) => <li key={change.label + index}><span className="font-medium">{change.label}:</span>{change.before !== undefined && <span> {change.before}</span>}{change.before !== undefined && change.after !== undefined && <span className="mx-1 font-semibold text-gray-400">→</span>}{change.after !== undefined && <span>{change.after}</span>}</li>)}</ul>
          : <p className="mt-1 text-gray-500">Nessun dettaglio leggibile per questa operazione.</p>}
        <p className="mt-2 text-xs text-gray-400">{new Date(item.createdAt).toLocaleString('it-IT')}</p>
      </article>;
    })}</div>
  </div>;
};

export default AuditHistory;
