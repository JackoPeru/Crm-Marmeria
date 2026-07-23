import { useCallback, useEffect } from 'react';
import toast from 'react-hot-toast';
import {
  useAppDispatch,
  useAppSelector,
  selectAllMaterials,
  selectMaterialsLoading,
  selectMaterialsError,
  selectMaterialsPagination,
  selectMaterialsFilters,
  selectMaterialsStats,
  selectMaterialCategories,
  selectMaterialSuppliers,
} from '../store';
import {
  fetchMaterials,
  createMaterial,
  updateMaterial,
  searchMaterials,
  fetchMaterialsStats,
  fetchMaterialCategories,
  fetchMaterialSuppliers,
  setMaterialsFilters,
  setMaterialsPagination,
  clearMaterialsError,
  resetMaterialsState,
} from '../store/slices/materialsSlice';
import type { Material, MaterialsFilters } from '../store/slices/materialsSlice';
import { apiClient } from '../services/api';
import { cacheService } from '../services/cache';
import { useAuth } from '../contexts/AuthContext';

export const useMaterials = () => {
  const dispatch = useAppDispatch();
  const { hasPermission, user } = useAuth();
  const canView = hasPermission('materials.view');
  const materials = useAppSelector(selectAllMaterials);
  const loading = useAppSelector(selectMaterialsLoading);
  const error = useAppSelector(selectMaterialsError);
  const pagination = useAppSelector(selectMaterialsPagination);
  const filters = useAppSelector(selectMaterialsFilters);
  const stats = useAppSelector(selectMaterialsStats);
  const categories = useAppSelector(selectMaterialCategories);
  const suppliers = useAppSelector(selectMaterialSuppliers);

  const refetch = useCallback(() => {
    if (!canView) {
      dispatch(resetMaterialsState());
      return;
    }
    dispatch(fetchMaterials());
    dispatch(fetchMaterialsStats());
    dispatch(fetchMaterialCategories());
    dispatch(fetchMaterialSuppliers());
  }, [canView, dispatch]);

  useEffect(() => {
    refetch();
    return () => {
      if (!canView) dispatch(resetMaterialsState());
    };
  }, [canView, dispatch, refetch, user?.id]);

  useEffect(() => {
    if (!canView) return undefined;
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<any>).detail;
      if (String(detail?.event || '').startsWith('materials.') || detail?.event === 'database.restored') {
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

  const addMaterial = useCallback(async (
    data: Omit<Material, 'id' | 'createdAt' | 'updatedAt'>,
  ) => {
    if (!hasPermission('materials.create')) return false;
    return (await dispatch(createMaterial(data))).meta.requestStatus === 'fulfilled';
  }, [dispatch, hasPermission]);

  const updateMaterialData = useCallback(async (id: string, data: Partial<Material>) => {
    if (!hasPermission('materials.edit')) return false;
    const current = materials.find((material) => material.id === String(id));
    const result = await dispatch(updateMaterial({
      id: String(id),
      data: {
        ...data,
        version: (data as any).version ?? (current as any)?.version,
      } as any,
    }));
    if (result.meta.requestStatus !== 'fulfilled' && String(result.payload || '').includes('modificato')) {
      refetch();
    }
    return result.meta.requestStatus === 'fulfilled';
  }, [dispatch, hasPermission, materials, refetch]);

  const removeMaterial = useCallback(async (id: string) => {
    if (!hasPermission('materials.delete')) return false;
    const current = materials.find((material) => material.id === String(id)) as (Material & { version?: number }) | undefined;
    try {
      const response = await apiClient.delete(`/materials/${String(id)}`, {
        headers: current?.version != null
          ? { 'If-Match': String(current.version) }
          : undefined,
      });
      await cacheService.delete('materials', 'all');
      await cacheService.delete('materials', String(id));
      if (response.status !== 202) toast.success('Materiale eliminato con successo');
      refetch();
      return true;
    } catch (deleteError: any) {
      if (deleteError.response?.status === 409) refetch();
      toast.error(deleteError.response?.data?.error || 'Eliminazione materiale non riuscita');
      return false;
    }
  }, [hasPermission, materials, refetch]);

  return {
    materials: canView ? materials : [],
    loading,
    error,
    pagination,
    filters,
    stats,
    categories,
    suppliers,
    refetch,
    addMaterial,
    updateMaterial: updateMaterialData,
    removeMaterial,
    searchMaterials: useCallback(async (query: string) => {
      if (!canView) return false;
      return (await dispatch(searchMaterials(query))).meta.requestStatus === 'fulfilled';
    }, [canView, dispatch]),
    setFilter: useCallback(
      (filter: Partial<MaterialsFilters>) => dispatch(setMaterialsFilters(filter)),
      [dispatch],
    ),
    setPage: useCallback((page: number) => {
      if (!canView) return;
      dispatch(setMaterialsPagination({ page }));
      dispatch(fetchMaterials());
    }, [canView, dispatch]),
    clearError: useCallback(() => dispatch(clearMaterialsError()), [dispatch]),
    getMaterialById: useCallback(
      (id: string) => (canView ? materials.find((material) => material.id === String(id)) : undefined),
      [canView, materials],
    ),
    refetchMetadata: useCallback(() => {
      if (!canView) return;
      dispatch(fetchMaterialCategories());
      dispatch(fetchMaterialSuppliers());
    }, [canView, dispatch]),
  };
};

export default useMaterials;
