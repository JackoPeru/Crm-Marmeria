import { useCallback, useEffect } from 'react';
import toast from 'react-hot-toast';
import {
  useAppDispatch,
  useAppSelector,
  selectAllClients,
  selectClientsLoading,
  selectClientsError,
  selectClientsPagination,
  selectClientsFilters,
  selectClientsStats,
} from '../store';
import {
  fetchClients,
  createClient,
  updateClient,
  searchClients,
  fetchClientsStats,
  setClientsFilters,
  setClientsPagination,
  clearClientsError,
  resetClientsState,
} from '../store/slices/clientsSlice';
import type { Client, ClientsFilters } from '../store/slices/clientsSlice';
import { clientsService } from '../services/clients';
import { useAuth } from '../contexts/AuthContext';

export const useClients = () => {
  const dispatch = useAppDispatch();
  const { hasPermission, user } = useAuth();
  const canView = hasPermission('clients.view');
  const clients = useAppSelector(selectAllClients);
  const loading = useAppSelector(selectClientsLoading);
  const error = useAppSelector(selectClientsError);
  const pagination = useAppSelector(selectClientsPagination);
  const filters = useAppSelector(selectClientsFilters);
  const stats = useAppSelector(selectClientsStats);

  const refetch = useCallback(() => {
    if (!canView) {
      dispatch(resetClientsState());
      return;
    }
    dispatch(fetchClients());
    dispatch(fetchClientsStats());
  }, [canView, dispatch]);

  useEffect(() => {
    refetch();
    return () => {
      if (!canView) dispatch(resetClientsState());
    };
  }, [canView, dispatch, refetch, user?.id]);

  useEffect(() => {
    if (!canView) return undefined;
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<any>).detail;
      if (String(detail?.event || '').startsWith('clients.') || detail?.event === 'database.restored') {
        refetch();
      }
    };
    const requested = () => refetch();
    window.addEventListener('crm-realtime', refresh);
    window.addEventListener('crm-data-refresh-requested', requested);
    return () => {
      window.removeEventListener('crm-realtime', refresh);
      window.removeEventListener('crm-data-refresh-requested', requested);
    };
  }, [canView, refetch]);

  const addClient = useCallback(async (
    data: Omit<Client, 'id' | 'createdAt' | 'updatedAt'>,
  ) => {
    if (!hasPermission('clients.create')) return false;
    return (await dispatch(createClient(data))).meta.requestStatus === 'fulfilled';
  }, [dispatch, hasPermission]);

  const updateClientData = useCallback(async (id: string, data: Partial<Client>) => {
    if (!hasPermission('clients.edit')) return false;
    const current = clients.find((client) => client.id === String(id));
    const result = await dispatch(updateClient({
      id: String(id),
      data: { ...data, version: data.version ?? current?.version } as any,
    }));
    if (result.meta.requestStatus !== 'fulfilled' && String(result.payload || '').includes('modificato')) {
      refetch();
    }
    return result.meta.requestStatus === 'fulfilled';
  }, [clients, dispatch, hasPermission, refetch]);

  const removeClient = useCallback(async (id: string) => {
    if (!hasPermission('clients.delete')) return false;
    const current = clients.find((client) => client.id === String(id));
    try {
      await clientsService.deleteClient(String(id), current?.version);
      refetch();
      return true;
    } catch (deleteError: any) {
      if (deleteError.response?.status === 409) refetch();
      toast.error(deleteError.response?.data?.error || 'Eliminazione cliente non riuscita');
      return false;
    }
  }, [clients, hasPermission, refetch]);

  return {
    clients: canView ? clients : [],
    loading,
    error,
    pagination,
    filters,
    stats,
    refetch,
    addClient,
    updateClient: updateClientData,
    removeClient,
    searchClients: useCallback(async (query: string) => {
      if (!canView) return false;
      return (await dispatch(searchClients(query))).meta.requestStatus === 'fulfilled';
    }, [canView, dispatch]),
    setFilter: useCallback(
      (filter: Partial<ClientsFilters>) => dispatch(setClientsFilters(filter)),
      [dispatch],
    ),
    setPage: useCallback((page: number) => {
      if (!canView) return;
      dispatch(setClientsPagination({ page }));
      dispatch(fetchClients());
    }, [canView, dispatch]),
    clearError: useCallback(() => dispatch(clearClientsError()), [dispatch]),
    getClientById: useCallback(
      (id: string) => (canView ? clients.find((client) => client.id === String(id)) : undefined),
      [canView, clients],
    ),
  };
};

export default useClients;
