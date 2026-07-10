import { useCallback, useEffect } from 'react';
import { useAppDispatch, useAppSelector, selectAllClients, selectClientsLoading, selectClientsError, selectClientsPagination, selectClientsFilters, selectClientsStats } from '../store';
import { fetchClients, createClient, updateClient, deleteClient as removeClientAction, searchClients, fetchClientsStats, setClientsFilters, setClientsPagination, clearClientsError } from '../store/slices/clientsSlice';
import type { Client, ClientsFilters } from '../store/slices/clientsSlice';

export const useClients = () => {
  const dispatch = useAppDispatch();
  const clients = useAppSelector(selectAllClients);
  const loading = useAppSelector(selectClientsLoading);
  const error = useAppSelector(selectClientsError);
  const pagination = useAppSelector(selectClientsPagination);
  const filters = useAppSelector(selectClientsFilters);
  const stats = useAppSelector(selectClientsStats);
  const refetch = useCallback(() => { dispatch(fetchClients()); dispatch(fetchClientsStats()); }, [dispatch]);
  useEffect(() => { refetch(); }, [refetch]);
  useEffect(() => {
    const refresh = (event: Event) => { const detail = (event as CustomEvent<any>).detail; if (String(detail?.event || '').startsWith('clients.') || detail?.event === 'database.restored') refetch(); };
    const requested = () => refetch();
    window.addEventListener('crm-realtime', refresh); window.addEventListener('crm-data-refresh-requested', requested);
    return () => { window.removeEventListener('crm-realtime', refresh); window.removeEventListener('crm-data-refresh-requested', requested); };
  }, [refetch]);
  const addClient = useCallback(async (data: Omit<Client, 'id' | 'createdAt' | 'updatedAt'>) => (await dispatch(createClient(data))).meta.requestStatus === 'fulfilled', [dispatch]);
  const updateClientData = useCallback(async (id: string, data: Partial<Client>) => {
    const current = clients.find((client) => client.id === String(id));
    const result = await dispatch(updateClient({ id: String(id), data: { ...data, version: data.version ?? current?.version } as any }));
    if (result.meta.requestStatus !== 'fulfilled' && String(result.payload || '').includes('modificato')) refetch();
    return result.meta.requestStatus === 'fulfilled';
  }, [dispatch, clients, refetch]);
  return {
    clients, loading, error, pagination, filters, stats, refetch, addClient, updateClient: updateClientData,
    removeClient: useCallback(async (id: string) => (await dispatch(removeClientAction(String(id)))).meta.requestStatus === 'fulfilled', [dispatch]),
    searchClients: useCallback(async (query: string) => (await dispatch(searchClients(query))).meta.requestStatus === 'fulfilled', [dispatch]),
    setFilter: useCallback((filter: Partial<ClientsFilters>) => dispatch(setClientsFilters(filter)), [dispatch]),
    setPage: useCallback((page: number) => { dispatch(setClientsPagination({ page })); dispatch(fetchClients()); }, [dispatch]),
    clearError: useCallback(() => dispatch(clearClientsError()), [dispatch]),
    getClientById: useCallback((id: string) => clients.find((client) => client.id === String(id)), [clients]),
  };
};
export default useClients;
