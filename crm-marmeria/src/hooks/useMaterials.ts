import { useCallback, useEffect } from 'react';
import { useAppDispatch, useAppSelector, selectAllMaterials, selectMaterialsLoading, selectMaterialsError, selectMaterialsPagination, selectMaterialsFilters, selectMaterialsStats, selectMaterialCategories, selectMaterialSuppliers } from '../store';
import { fetchMaterials, createMaterial, updateMaterial, deleteMaterial as removeMaterialAction, searchMaterials, fetchMaterialsStats, fetchMaterialCategories, fetchMaterialSuppliers, setMaterialsFilters, setMaterialsPagination, clearMaterialsError } from '../store/slices/materialsSlice';
import type { Material, MaterialsFilters } from '../store/slices/materialsSlice';

export const useMaterials = () => {
  const dispatch = useAppDispatch();
  const materials = useAppSelector(selectAllMaterials);
  const loading = useAppSelector(selectMaterialsLoading);
  const error = useAppSelector(selectMaterialsError);
  const pagination = useAppSelector(selectMaterialsPagination);
  const filters = useAppSelector(selectMaterialsFilters);
  const stats = useAppSelector(selectMaterialsStats);
  const categories = useAppSelector(selectMaterialCategories);
  const suppliers = useAppSelector(selectMaterialSuppliers);
  const refetch = useCallback(() => { dispatch(fetchMaterials()); dispatch(fetchMaterialsStats()); dispatch(fetchMaterialCategories()); dispatch(fetchMaterialSuppliers()); }, [dispatch]);
  useEffect(() => { refetch(); }, [refetch]);
  useEffect(() => {
    const refresh = (event: Event) => { const detail = (event as CustomEvent<any>).detail; if (String(detail?.event || '').startsWith('materials.') || detail?.event === 'database.restored') refetch(); };
    const requested = () => refetch();
    window.addEventListener('crm-realtime', refresh); window.addEventListener('crm-data-refresh-requested', requested);
    return () => { window.removeEventListener('crm-realtime', refresh); window.removeEventListener('crm-data-refresh-requested', requested); };
  }, [refetch]);
  const addMaterial = useCallback(async (data: Omit<Material, 'id' | 'createdAt' | 'updatedAt'>) => (await dispatch(createMaterial(data))).meta.requestStatus === 'fulfilled', [dispatch]);
  const updateMaterialData = useCallback(async (id: string, data: Partial<Material>) => {
    const current = materials.find((material) => material.id === String(id));
    const result = await dispatch(updateMaterial({ id: String(id), data: { ...data, version: (data as any).version ?? (current as any)?.version } as any }));
    if (result.meta.requestStatus !== 'fulfilled' && String(result.payload || '').includes('modificato')) refetch();
    return result.meta.requestStatus === 'fulfilled';
  }, [dispatch, materials, refetch]);
  return {
    materials, loading, error, pagination, filters, stats, categories, suppliers, refetch, addMaterial, updateMaterial: updateMaterialData,
    removeMaterial: useCallback(async (id: string) => (await dispatch(removeMaterialAction(String(id)))).meta.requestStatus === 'fulfilled', [dispatch]),
    searchMaterials: useCallback(async (query: string) => (await dispatch(searchMaterials(query))).meta.requestStatus === 'fulfilled', [dispatch]),
    setFilter: useCallback((filter: Partial<MaterialsFilters>) => dispatch(setMaterialsFilters(filter)), [dispatch]),
    setPage: useCallback((page: number) => { dispatch(setMaterialsPagination({ page })); dispatch(fetchMaterials()); }, [dispatch]),
    clearError: useCallback(() => dispatch(clearMaterialsError()), [dispatch]),
    getMaterialById: useCallback((id: string) => materials.find((material) => material.id === String(id)), [materials]),
    refetchMetadata: useCallback(() => { dispatch(fetchMaterialCategories()); dispatch(fetchMaterialSuppliers()); }, [dispatch]),
  };
};
export default useMaterials;
