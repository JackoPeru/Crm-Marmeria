import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';
import { useAuth } from './AuthContext';

type CollectionName = 'projects' | 'quotes' | 'invoices';
type Entity = Record<string, any> & { id: string };

interface BusinessDataContextValue {
  projects: Entity[];
  quotes: Entity[];
  invoices: Entity[];
  loading: boolean;
  refresh: () => Promise<void>;
  addProject: (data: Record<string, any>) => Promise<boolean>;
  updateProject: (id: string, data: Record<string, any>) => Promise<boolean>;
  deleteProject: (id: string) => Promise<boolean>;
  addQuote: (data: Record<string, any>) => Promise<boolean>;
  updateQuote: (id: string, data: Record<string, any>) => Promise<boolean>;
  deleteQuote: (id: string) => Promise<boolean>;
  addInvoice: (data: Record<string, any>) => Promise<boolean>;
  updateInvoice: (id: string, data: Record<string, any>) => Promise<boolean>;
  deleteInvoice: (id: string) => Promise<boolean>;
}

const BusinessDataContext = createContext<BusinessDataContextValue | undefined>(undefined);

const normalizeEntity = (entity: Record<string, any>): Entity => {
  const normalized = { ...entity, id: String(entity.id) } as Entity;
  for (const key of ['clientId', 'customerId', 'projectId', 'quoteId']) {
    if (normalized[key] !== null && normalized[key] !== undefined && normalized[key] !== '') {
      normalized[key] = String(normalized[key]);
    }
  }
  if (Array.isArray(normalized.items)) {
    normalized.items = normalized.items.map((item: Record<string, any>) => ({
      ...item,
      materialId: item.materialId === null || item.materialId === undefined || item.materialId === ''
        ? item.materialId
        : String(item.materialId),
    }));
  }
  return normalized;
};

export const BusinessDataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { isAuthenticated, hasPermission } = useAuth();
  const [projects, setProjects] = useState<Entity[]>([]);
  const [quotes, setQuotes] = useState<Entity[]>([]);
  const [invoices, setInvoices] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(false);

  const setters = useMemo(() => ({
    projects: setProjects,
    quotes: setQuotes,
    invoices: setInvoices,
  }), []);

  const permissionPrefix: Record<CollectionName, string> = {
    projects: 'projects',
    quotes: 'quotes',
    invoices: 'invoices',
  };

  const can = useCallback((collection: CollectionName, action: 'view' | 'create' | 'edit' | 'delete') => (
    hasPermission(`${permissionPrefix[collection]}.${action}`)
  ), [hasPermission]);

  const loadCollection = useCallback(async (collection: CollectionName) => {
    if (!can(collection, 'view')) {
      setters[collection]([]);
      return;
    }
    const response = await apiClient.get(`/${collection}`);
    setters[collection]((response.data || []).map(normalizeEntity));
  }, [can, setters]);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) {
      setProjects([]);
      setQuotes([]);
      setInvoices([]);
      return;
    }

    setLoading(true);
    try {
      await Promise.all([
        loadCollection('projects'),
        loadCollection('quotes'),
        loadCollection('invoices'),
      ]);
    } catch (error) {
      console.error('Errore nel caricamento dei dati aziendali:', error);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, loadCollection]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createEntity = useCallback(async (collection: CollectionName, data: Record<string, any>) => {
    if (!can(collection, 'create')) {
      toast.error('Non hai il permesso per creare questo elemento');
      return false;
    }
    try {
      const response = await apiClient.post(`/${collection}`, data);
      setters[collection]((current) => [normalizeEntity(response.data), ...current]);
      toast.success('Elemento creato con successo');
      return true;
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Creazione non riuscita');
      return false;
    }
  }, [can, setters]);

  const updateEntity = useCallback(async (collection: CollectionName, id: string, data: Record<string, any>) => {
    if (!can(collection, 'edit')) {
      toast.error('Non hai il permesso per modificare questo elemento');
      return false;
    }
    try {
      const response = await apiClient.put(`/${collection}/${String(id)}`, data);
      const updated = normalizeEntity(response.data);
      setters[collection]((current) => current.map((item) => item.id === updated.id ? updated : item));
      toast.success('Elemento aggiornato con successo');
      return true;
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Aggiornamento non riuscito');
      return false;
    }
  }, [can, setters]);

  const deleteEntity = useCallback(async (collection: CollectionName, id: string) => {
    if (!can(collection, 'delete')) {
      toast.error('Non hai il permesso per eliminare questo elemento');
      return false;
    }
    try {
      await apiClient.delete(`/${collection}/${String(id)}`);
      setters[collection]((current) => current.filter((item) => item.id !== String(id)));
      toast.success('Elemento eliminato con successo');
      return true;
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Eliminazione non riuscita');
      return false;
    }
  }, [can, setters]);

  const value: BusinessDataContextValue = {
    projects,
    quotes,
    invoices,
    loading,
    refresh,
    addProject: (data) => createEntity('projects', data),
    updateProject: (id, data) => updateEntity('projects', id, data),
    deleteProject: (id) => deleteEntity('projects', id),
    addQuote: (data) => createEntity('quotes', data),
    updateQuote: (id, data) => updateEntity('quotes', id, data),
    deleteQuote: (id) => deleteEntity('quotes', id),
    addInvoice: (data) => createEntity('invoices', data),
    updateInvoice: (id, data) => updateEntity('invoices', id, data),
    deleteInvoice: (id) => deleteEntity('invoices', id),
  };

  return <BusinessDataContext.Provider value={value}>{children}</BusinessDataContext.Provider>;
};

export const useBusinessData = (): BusinessDataContextValue => {
  const context = useContext(BusinessDataContext);
  if (!context) throw new Error('useBusinessData must be used within BusinessDataProvider');
  return context;
};
