import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';
import { useAuth } from './AuthContext';

type CollectionName = 'projects' | 'quotes' | 'invoices';
type Entity = Record<string, any> & { id: string; version?: number; _queued?: boolean };
interface BusinessDataContextValue {
  projects: Entity[]; quotes: Entity[]; invoices: Entity[]; loading: boolean; refresh: () => Promise<void>;
  addProject: (data: Record<string, any>) => Promise<boolean>; updateProject: (id: string, data: Record<string, any>) => Promise<boolean>; deleteProject: (id: string) => Promise<boolean>;
  addQuote: (data: Record<string, any>) => Promise<boolean>; updateQuote: (id: string, data: Record<string, any>) => Promise<boolean>; deleteQuote: (id: string) => Promise<boolean>;
  addInvoice: (data: Record<string, any>) => Promise<boolean>; updateInvoice: (id: string, data: Record<string, any>) => Promise<boolean>; deleteInvoice: (id: string) => Promise<boolean>;
}
const BusinessDataContext = createContext<BusinessDataContextValue | undefined>(undefined);
const cacheKey = (collection: CollectionName) => `crm_cache_${collection}`;
const normalizeEntity = (entity: Record<string, any>): Entity => {
  const normalized = { ...entity, id: String(entity.id) } as Entity;
  for (const key of ['clientId', 'customerId', 'projectId', 'quoteId']) if (normalized[key] != null && normalized[key] !== '') normalized[key] = String(normalized[key]);
  return normalized;
};
const readCache = (collection: CollectionName): Entity[] => {
  try { const data = JSON.parse(localStorage.getItem(cacheKey(collection)) || '[]'); return Array.isArray(data) ? data.map(normalizeEntity) : []; }
  catch { return []; }
};
const writeCache = (collection: CollectionName, data: Entity[]) => localStorage.setItem(cacheKey(collection), JSON.stringify(data));

export const BusinessDataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { isAuthenticated, user } = useAuth();
  const [projects, setProjects] = useState<Entity[]>(() => readCache('projects'));
  const [quotes, setQuotes] = useState<Entity[]>(() => readCache('quotes'));
  const [invoices, setInvoices] = useState<Entity[]>(() => readCache('invoices'));
  const [loading, setLoading] = useState(false);
  const setters = useMemo(() => ({ projects: setProjects, quotes: setQuotes, invoices: setInvoices }), []);
  const can = useCallback((collection: CollectionName, action: 'view' | 'create' | 'edit' | 'delete') => user?.permissions?.includes(`${collection}.${action}`) ?? false, [user?.permissions]);
  const replaceCollection = useCallback((collection: CollectionName, items: Entity[]) => {
    const normalized = items.map(normalizeEntity); setters[collection](normalized); writeCache(collection, normalized);
  }, [setters]);
  const loadCollection = useCallback(async (collection: CollectionName) => {
    if (!can(collection, 'view')) { replaceCollection(collection, []); return; }
    try { const response = await apiClient.get(`/${collection}`); replaceCollection(collection, response.data || []); }
    catch (error: any) {
      if (error.code !== 'ERR_NETWORK' && error.response) throw error;
      replaceCollection(collection, readCache(collection));
    }
  }, [can, replaceCollection]);
  const refresh = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    try { await Promise.all(['projects', 'quotes', 'invoices'].map((collection) => loadCollection(collection as CollectionName))); }
    catch (error) { console.error('Caricamento dati aziendali fallito:', error); }
    finally { setLoading(false); }
  }, [isAuthenticated, loadCollection]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const realtime = (event: Event) => {
      const detail = (event as CustomEvent<any>).detail;
      const collection = String(detail?.event || '').split('.')[0] as CollectionName;
      if (!['projects', 'quotes', 'invoices'].includes(collection)) { if (detail?.event === 'database.restored') void refresh(); return; }
      if (detail.item) {
        const item = normalizeEntity(detail.item);
        setters[collection]((current) => {
          const next = current.some((entry) => entry.id === item.id) ? current.map((entry) => entry.id === item.id ? item : entry) : [item, ...current];
          writeCache(collection, next); return next;
        });
      } else if (detail.id) {
        setters[collection]((current) => { const next = current.filter((entry) => entry.id !== String(detail.id)); writeCache(collection, next); return next; });
      }
    };
    const refreshRequested = () => void refresh();
    window.addEventListener('crm-realtime', realtime); window.addEventListener('crm-data-refresh-requested', refreshRequested);
    return () => { window.removeEventListener('crm-realtime', realtime); window.removeEventListener('crm-data-refresh-requested', refreshRequested); };
  }, [refresh, setters]);

  const createEntity = useCallback(async (collection: CollectionName, data: Record<string, any>) => {
    if (!can(collection, 'create')) { toast.error('Non hai il permesso per creare questo elemento'); return false; }
    try {
      const response = await apiClient.post(`/${collection}`, data);
      const created = normalizeEntity(response.data);
      setters[collection]((current) => { const next = [created, ...current.filter((item) => item.id !== created.id)]; writeCache(collection, next); return next; });
      if (response.status !== 202) toast.success('Elemento creato con successo');
      return true;
    } catch (error: any) { toast.error(error.response?.data?.error || 'Creazione non riuscita'); return false; }
  }, [can, setters]);
  const updateEntity = useCallback(async (collection: CollectionName, id: string, data: Record<string, any>) => {
    if (!can(collection, 'edit')) { toast.error('Non hai il permesso per modificare questo elemento'); return false; }
    const current = ({ projects, quotes, invoices }[collection]).find((item) => item.id === String(id));
    const expectedVersion = data.version ?? current?.version;
    try {
      const response = await apiClient.put(`/${collection}/${String(id)}`, { ...data, expectedVersion });
      const updated = normalizeEntity({ ...current, ...response.data, id: String(id) });
      setters[collection]((items) => { const next = items.map((item) => item.id === updated.id ? updated : item); writeCache(collection, next); return next; });
      if (response.status !== 202) toast.success('Elemento aggiornato con successo');
      return true;
    } catch (error: any) {
      if (error.response?.status === 409) { toast.error('Questo elemento è stato modificato da un’altra postazione. I dati sono stati aggiornati.'); await loadCollection(collection); }
      else toast.error(error.response?.data?.error || 'Aggiornamento non riuscito');
      return false;
    }
  }, [can, projects, quotes, invoices, setters, loadCollection]);
  const deleteEntity = useCallback(async (collection: CollectionName, id: string) => {
    if (!can(collection, 'delete')) { toast.error('Non hai il permesso per eliminare questo elemento'); return false; }
    const current = ({ projects, quotes, invoices }[collection]).find((item) => item.id === String(id));
    try {
      const response = await apiClient.delete(`/${collection}/${String(id)}`, { headers: current?.version != null ? { 'If-Match': String(current.version) } : undefined });
      setters[collection]((items) => { const next = items.filter((item) => item.id !== String(id)); writeCache(collection, next); return next; });
      if (response.status !== 202) toast.success('Elemento eliminato con successo');
      return true;
    } catch (error: any) {
      if (error.response?.status === 409) await loadCollection(collection);
      toast.error(error.response?.data?.error || 'Eliminazione non riuscita'); return false;
    }
  }, [can, projects, quotes, invoices, setters, loadCollection]);

  const value: BusinessDataContextValue = {
    projects, quotes, invoices, loading, refresh,
    addProject: (data) => createEntity('projects', data), updateProject: (id, data) => updateEntity('projects', id, data), deleteProject: (id) => deleteEntity('projects', id),
    addQuote: (data) => createEntity('quotes', data), updateQuote: (id, data) => updateEntity('quotes', id, data), deleteQuote: (id) => deleteEntity('quotes', id),
    addInvoice: (data) => createEntity('invoices', data), updateInvoice: (id, data) => updateEntity('invoices', id, data), deleteInvoice: (id) => deleteEntity('invoices', id),
  };
  return <BusinessDataContext.Provider value={value}>{children}</BusinessDataContext.Provider>;
};
export const useBusinessData = () => {
  const context = useContext(BusinessDataContext);
  if (!context) throw new Error('useBusinessData deve essere usato dentro BusinessDataProvider');
  return context;
};
