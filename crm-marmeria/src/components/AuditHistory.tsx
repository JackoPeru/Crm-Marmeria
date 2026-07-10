import React, { useEffect, useState } from 'react';
import { Clock3, RefreshCw } from 'lucide-react';
import { apiClient } from '../services/api';

interface AuditItem { id: string; username?: string; action: string; previous?: Record<string, any> | null; next?: Record<string, any> | null; createdAt: string }
const actionLabel = (action: string) => ({ create: 'ha creato il record', update: 'ha modificato il record', delete: 'ha eliminato il record', 'attachment.add': 'ha aggiunto un allegato', 'attachment.delete': 'ha eliminato un allegato' }[action] || action);
const changedFields = (item: AuditItem) => item.action !== 'update' || !item.previous || !item.next ? [] : Object.keys(item.next).filter((key) => !['updatedAt', 'version'].includes(key) && JSON.stringify(item.previous?.[key]) !== JSON.stringify(item.next?.[key]));

const AuditHistory: React.FC<{ entityType: string; entityId: string }> = ({ entityType, entityId }) => {
  const [items, setItems] = useState<AuditItem[]>([]);
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try { setItems((await apiClient.get(`/audit/${entityType}/${entityId}`, { params: { limit: 100 } })).data || []); }
    catch (error) { console.error('Caricamento storico fallito:', error); }
    finally { setLoading(false); }
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
  return <div className="mt-6 border-t pt-5 border-light-border dark:border-dark-border">
    <div className="flex items-center justify-between mb-3"><h3 className="font-semibold flex items-center gap-2"><Clock3 size={18} /> Storico modifiche</h3><button type="button" onClick={() => void load()} className="p-1.5 border rounded-md"><RefreshCw size={15} /></button></div>
    {loading && !items.length ? <p className="text-sm text-gray-500">Caricamento...</p> : null}
    {!items.length && !loading ? <p className="text-sm text-gray-500">Nessuna modifica registrata.</p> : null}
    <div className="space-y-2 max-h-56 overflow-y-auto">{items.map((item) => { const fields = changedFields(item); return <div key={item.id} className="p-3 rounded-md bg-gray-50 dark:bg-gray-800 text-sm"><p><strong>{item.username || 'Sistema'}</strong> {actionLabel(item.action)}</p>{fields.length > 0 && <p className="text-gray-500 mt-1">Campi: {fields.join(', ')}</p>}<p className="text-xs text-gray-400 mt-1">{new Date(item.createdAt).toLocaleString('it-IT')}</p></div>; })}</div>
  </div>;
};
export default AuditHistory;
