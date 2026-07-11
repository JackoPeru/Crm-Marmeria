/**
 * Redux Slice per la gestione dei materiali
 * Sostituisce la gestione SQLite locale con chiamate API
 */
import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { apiClient } from '../../services/api';
import { cacheService } from '../../services/cache';
import toast from 'react-hot-toast';

// Interfacce per i materiali
export interface Material {
  id: string;
  name: string;
  category: string;
  supplier: string;
  unitPrice: number;
  price?: number; // Campo legacy per compatibilità
  unit: string; // m², kg, pz, etc.
  stockQuantity: number;
  minStockLevel: number;
  stock?: number; // Campo legacy per compatibilità
  description?: string;
  specifications?: Record<string, any>;
  version?: number;
  _queued?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMaterialRequest {
  name: string;
  category: string;
  supplier: string;
  unitPrice: number;
  unit: string;
  stockQuantity: number;
  minStockLevel: number;
  description?: string;
  specifications?: Record<string, any>;
}

// Interfacce per lo stato
interface MaterialsFilters {
  searchTerm: string;
  category: string;
  supplier: string;
  lowStock: boolean;
  sortBy: keyof Material | '';
  sortOrder: 'asc' | 'desc';
}

interface MaterialsState {
  items: Material[];
  selectedMaterial: Material | null;
  loading: boolean;
  error: string | null;
  filters: MaterialsFilters;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  stats: {
    total: number;
    byCategory: Record<string, number>;
    lowStockItems: number;
    totalValue: number;
  } | null;
  categories: string[];
  suppliers: string[];
  lastFetch: number | null;
}

// Stato iniziale
const initialState: MaterialsState = {
  items: [],
  selectedMaterial: null,
  loading: false,
  error: null,
  filters: {
    searchTerm: '',
    category: '',
    supplier: '',
    lowStock: false,
    sortBy: 'name',
    sortOrder: 'asc',
  },
  pagination: {
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0,
  },
  stats: null,
  categories: [],
  suppliers: [],
  lastFetch: null,
};

// Async Thunks

/**
 * Carica tutti i materiali
 */
export const fetchMaterials = createAsyncThunk<
  Material[],
  void,
  { rejectValue: string }
>(
  'materials/fetchMaterials',
  async (_, { rejectWithValue }) => {
    try {
      const response = await apiClient.getInstance().get('/materials');
      
      // Salva in cache
      await cacheService.set('materials', 'all', response.data, 30 * 60 * 1000); // 30 minuti
      
      return response.data;
    } catch (error: any) {
      // Fallback alla cache in caso di errore di rete
      if (error.code === 'ERR_NETWORK') {
        try {
          const cachedData = await cacheService.get('materials', 'all');
          if (cachedData) {
            toast.error('Sei offline – dati materiali in sola lettura');
            return cachedData;
          }
        } catch (cacheError) {
          console.warn('Errore nel recupero cache materiali:', cacheError);
        }
      }
      
      const message = error.response?.data?.message || error.message || 'Errore nel caricamento materiali';
      toast.error(message);
      return rejectWithValue(message);
    }
  }
);

/**
 * Carica un materiale specifico
 */
export const fetchMaterial = createAsyncThunk<
  Material,
  string,
  { rejectValue: string }
>(
  'materials/fetchMaterial',
  async (materialId, { rejectWithValue }) => {
    try {
      const response = await apiClient.getInstance().get(`/materials/${materialId}`);
      
      // Salva in cache
      await cacheService.set('materials', materialId, response.data, 30 * 60 * 1000);
      
      return response.data;
    } catch (error: any) {
      // Fallback alla cache
      if (error.code === 'ERR_NETWORK') {
        try {
          const cachedData = await cacheService.get('materials', materialId);
          if (cachedData) {
            toast.error('Sei offline – dati materiale in sola lettura');
            return cachedData;
          }
        } catch (cacheError) {
          console.warn('Errore nel recupero cache materiale:', cacheError);
        }
      }
      
      const message = error.response?.data?.message || error.message || 'Errore nel caricamento materiale';
      toast.error(message);
      return rejectWithValue(message);
    }
  }
);

/**
 * Crea un nuovo materiale
 */
export const createMaterial = createAsyncThunk<
  Material,
  CreateMaterialRequest,
  { rejectValue: string }
>(
  'materials/createMaterial',
  async (materialData, { rejectWithValue }) => {
    try {
      const response = await apiClient.getInstance().post('/materials', materialData);
      
      // Invalida la cache
      await cacheService.delete('materials', 'all');
      
      if (response.status !== 202) toast.success('Materiale creato con successo');
      return response.data;
    } catch (error: any) {
      const message = error.response?.data?.message || error.message || 'Errore nella creazione materiale';
      toast.error(message);
      return rejectWithValue(message);
    }
  }
);

/**
 * Aggiorna un materiale esistente
 */
export const updateMaterial = createAsyncThunk<
  Material,
  { id: string; data: Partial<CreateMaterialRequest> & { version?: number } },
  { rejectValue: string }
>(
  'materials/updateMaterial',
  async ({ id, data }, { rejectWithValue }) => {
    try {
      const direct = await cacheService.get<Material>('materials', id);
      const cachedList = direct ? null : await cacheService.get<Material[]>('materials', 'all');
      const current = direct || cachedList?.find((item) => String(item.id) === String(id));
      const version = Number(data.version);
      if (!Number.isInteger(version) || version < 1) {
        throw new Error('Versione materiale non disponibile. Ricarica i dati.');
      }
      const response = await apiClient.getInstance().put(`/materials/${id}`, {
        ...data,
        expectedVersion: version,
      });
      
      // Invalida la cache
      await cacheService.delete('materials', 'all');
      await cacheService.delete('materials', id);
      
      if (response.status !== 202) toast.success('Materiale aggiornato con successo');
      return {
        ...(current || {}),
        ...data,
        ...response.data,
        id: String(id),
      } as Material;
    } catch (error: any) {
      const message = error.response?.data?.message || error.message || 'Errore nell\'aggiornamento materiale';
      toast.error(message);
      return rejectWithValue(message);
    }
  }
);

/**
 * Elimina un materiale
 */
export const deleteMaterial = createAsyncThunk<
  string,
  { id: string; version: number },
  { rejectValue: string }
>(
  'materials/deleteMaterial',
  async ({ id, version }, { rejectWithValue }) => {
    try {
      if (!Number.isInteger(Number(version)) || Number(version) < 1) {
        throw new Error('Versione materiale non disponibile. Ricarica i dati.');
      }
      const response = await apiClient.getInstance().delete(`/materials/${id}`, {
        headers: { 'If-Match': String(version) },
      });
      
      // Invalida la cache
      await cacheService.delete('materials', 'all');
      await cacheService.delete('materials', id);
      
      if (response.status !== 202) toast.success('Materiale eliminato con successo');
      return id;
    } catch (error: any) {
      const message = error.response?.data?.message || error.message || 'Errore nell\'eliminazione materiale';
      toast.error(message);
      return rejectWithValue(message);
    }
  }
);

/**
 * Cerca materiali
 */
export const searchMaterials = createAsyncThunk<
  Material[],
  string,
  { rejectValue: string }
>(
  'materials/searchMaterials',
  async (query, { rejectWithValue }) => {
    try {
      const response = await apiClient.getInstance().get(`/materials/search?q=${encodeURIComponent(query)}`);
      return response.data;
    } catch (error: any) {
      // Fallback alla cache per la ricerca
      if (error.code === 'ERR_NETWORK') {
        try {
          const cachedData = await cacheService.get('materials', 'all');
          if (cachedData && Array.isArray(cachedData)) {
            // Ricerca locale sui dati in cache
            const filteredData = cachedData.filter((material: Material) =>
              String(material.name || '').toLowerCase().includes(query.toLowerCase()) ||
              String(material.category || '').toLowerCase().includes(query.toLowerCase()) ||
              String(material.supplier || '').toLowerCase().includes(query.toLowerCase())
            );
            toast.error('Sei offline – ricerca sui dati in cache');
            return filteredData;
          }
        } catch (cacheError) {
          console.warn('Errore nella ricerca cache materiali:', cacheError);
        }
      }
      
      const message = error.response?.data?.message || error.message || 'Errore nella ricerca materiali';
      toast.error(message);
      return rejectWithValue(message);
    }
  }
);

/**
 * Carica statistiche materiali
 */
export const fetchMaterialsStats = createAsyncThunk<
  { total: number; byCategory: Record<string, number>; lowStockItems: number; totalValue: number },
  void,
  { rejectValue: string }
>(
  'materials/fetchMaterialsStats',
  async (_, { rejectWithValue }) => {
    try {
      const response = await apiClient.getInstance().get('/materials/stats');
      
      // Salva in cache
      await cacheService.set('materials', 'stats', response.data, 15 * 60 * 1000); // 15 minuti
      
      return response.data;
    } catch (error: any) {
      // Fallback alla cache
      if (error.code === 'ERR_NETWORK') {
        try {
          const cachedData = await cacheService.get('materials', 'stats');
          if (cachedData) {
            toast.error('Sei offline – statistiche materiali in sola lettura');
            return cachedData;
          }
        } catch (cacheError) {
          console.warn('Errore nel recupero cache statistiche materiali:', cacheError);
        }
      }
      
      const message = error.response?.data?.message || error.message || 'Errore nel caricamento statistiche';
      toast.error(message);
      return rejectWithValue(message);
    }
  }
);

/**
 * Carica categorie materiali
 */
export const fetchMaterialCategories = createAsyncThunk<
  string[],
  void,
  { rejectValue: string }
>(
  'materials/fetchMaterialCategories',
  async (_, { rejectWithValue }) => {
    try {
      const response = await apiClient.getInstance().get('/materials/categories');
      return response.data;
    } catch (error: any) {
      const message = error.response?.data?.message || error.message || 'Errore nel caricamento categorie';
      return rejectWithValue(message);
    }
  }
);

/**
 * Carica fornitori materiali
 */
export const fetchMaterialSuppliers = createAsyncThunk<
  string[],
  void,
  { rejectValue: string }
>(
  'materials/fetchMaterialSuppliers',
  async (_, { rejectWithValue }) => {
    try {
      const response = await apiClient.getInstance().get('/materials/suppliers');
      return response.data;
    } catch (error: any) {
      const message = error.response?.data?.message || error.message || 'Errore nel caricamento fornitori';
      return rejectWithValue(message);
    }
  }
);

// Slice
const materialsSlice = createSlice({
  name: 'materials',
  initialState,
  reducers: {
    /**
     * Pulisce gli errori
     */
    clearMaterialsError: (state) => {
      state.error = null;
    },
    
    /**
     * Imposta il materiale selezionato
     */
    setSelectedMaterial: (state, action: PayloadAction<Material | null>) => {
      state.selectedMaterial = action.payload;
    },
    
    /**
     * Aggiorna i filtri
     */
    setMaterialsFilters: (state, action: PayloadAction<Partial<MaterialsFilters>>) => {
      state.filters = { ...state.filters, ...action.payload };
    },
    
    /**
     * Reset dei filtri
     */
    resetMaterialsFilters: (state) => {
      state.filters = initialState.filters;
    },
    
    /**
     * Aggiorna la paginazione
     */
    setMaterialsPagination: (state, action: PayloadAction<Partial<MaterialsState['pagination']>>) => {
      state.pagination = { ...state.pagination, ...action.payload };
    },
    
    /**
     * Aggiorna un materiale nello stato locale
     */
    updateMaterialInState: (state, action: PayloadAction<Material>) => {
      const index = state.items.findIndex(material => material.id === action.payload.id);
      if (index !== -1) {
        state.items[index] = { ...state.items[index], ...action.payload };
      }
      
      // Aggiorna anche il materiale selezionato se corrisponde
      if (state.selectedMaterial?.id === action.payload.id) {
        state.selectedMaterial = { ...state.selectedMaterial, ...action.payload };
      }
    },
    
    /**
     * Rimuove un materiale dallo stato locale
     */
    removeMaterialFromState: (state, action: PayloadAction<string>) => {
      state.items = state.items.filter(material => material.id !== action.payload);
      
      // Pulisce il materiale selezionato se corrisponde
      if (state.selectedMaterial?.id === action.payload) {
        state.selectedMaterial = null;
      }
    },
    
    /**
     * Reset completo dello stato materiali
     */
    resetMaterialsState: () => {
      return initialState;
    },
  },
  extraReducers: (builder) => {
    // Fetch Materials
    builder
      .addCase(fetchMaterials.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchMaterials.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload;
        state.pagination.total = action.payload.length;
        state.pagination.totalPages = Math.ceil(action.payload.length / state.pagination.limit);
        state.lastFetch = Date.now();
        state.error = null;
      })
      .addCase(fetchMaterials.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload || 'Errore nel caricamento materiali';
      });
    
    // Fetch Material
    builder
      .addCase(fetchMaterial.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchMaterial.fulfilled, (state, action) => {
        state.loading = false;
        state.selectedMaterial = action.payload;
        
        // Aggiorna anche nella lista se presente
        const index = state.items.findIndex(material => material.id === action.payload.id);
        if (index !== -1) {
          state.items[index] = action.payload;
        } else {
          state.items.push(action.payload);
        }
        
        state.error = null;
      })
      .addCase(fetchMaterial.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload || 'Errore nel caricamento materiale';
      });
    
    // Create Material
    builder
      .addCase(createMaterial.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(createMaterial.fulfilled, (state, action) => {
        state.loading = false;
        state.items.unshift(action.payload);
        state.pagination.total += 1;
        state.pagination.totalPages = Math.ceil(state.pagination.total / state.pagination.limit);
        state.error = null;
      })
      .addCase(createMaterial.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload || 'Errore nella creazione materiale';
      });
    
    // Update Material
    builder
      .addCase(updateMaterial.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(updateMaterial.fulfilled, (state, action) => {
        state.loading = false;
        
        const index = state.items.findIndex(material => material.id === action.payload.id);
        if (index !== -1) {
          state.items[index] = { ...state.items[index], ...action.payload };
        }
        
        if (state.selectedMaterial?.id === action.payload.id) {
          state.selectedMaterial = { ...state.selectedMaterial, ...action.payload };
        }
        
        state.error = null;
      })
      .addCase(updateMaterial.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload || 'Errore nell\'aggiornamento materiale';
      });
    
    // Delete Material
    builder
      .addCase(deleteMaterial.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(deleteMaterial.fulfilled, (state, action) => {
        state.loading = false;
        state.items = state.items.filter(material => material.id !== action.payload);
        state.pagination.total -= 1;
        state.pagination.totalPages = Math.ceil(state.pagination.total / state.pagination.limit);
        
        if (state.selectedMaterial?.id === action.payload) {
          state.selectedMaterial = null;
        }
        
        state.error = null;
      })
      .addCase(deleteMaterial.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload || 'Errore nell\'eliminazione materiale';
      });
    
    // Search Materials
    builder
      .addCase(searchMaterials.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(searchMaterials.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload;
        state.error = null;
      })
      .addCase(searchMaterials.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload || 'Errore nella ricerca materiali';
      });
    
    // Fetch Materials Stats
    builder
      .addCase(fetchMaterialsStats.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchMaterialsStats.fulfilled, (state, action) => {
        state.loading = false;
        state.stats = action.payload;
        state.error = null;
      })
      .addCase(fetchMaterialsStats.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload || 'Errore nel caricamento statistiche';
      });
    
    // Fetch Material Categories
    builder
      .addCase(fetchMaterialCategories.fulfilled, (state, action) => {
        state.categories = action.payload;
      });
    
    // Fetch Material Suppliers
    builder
      .addCase(fetchMaterialSuppliers.fulfilled, (state, action) => {
        state.suppliers = action.payload;
      });
  },
});

// Export actions
export const {
  clearMaterialsError,
  setSelectedMaterial,
  setMaterialsFilters,
  resetMaterialsFilters,
  setMaterialsPagination,
  updateMaterialInState,
  removeMaterialFromState,
  resetMaterialsState,
} = materialsSlice.actions;

// Export selectors
export const selectMaterials = (state: { materials: MaterialsState }) => state.materials;
export const selectMaterialsItems = (state: { materials: MaterialsState }) => state.materials.items;
export const selectSelectedMaterial = (state: { materials: MaterialsState }) => state.materials.selectedMaterial;
export const selectMaterialsLoading = (state: { materials: MaterialsState }) => state.materials.loading;
export const selectMaterialsError = (state: { materials: MaterialsState }) => state.materials.error;
export const selectMaterialsFilters = (state: { materials: MaterialsState }) => state.materials.filters;
export const selectMaterialsPagination = (state: { materials: MaterialsState }) => state.materials.pagination;
export const selectMaterialsStats = (state: { materials: MaterialsState }) => state.materials.stats;
export const selectMaterialCategories = (state: { materials: MaterialsState }) => state.materials.categories;
export const selectMaterialSuppliers = (state: { materials: MaterialsState }) => state.materials.suppliers;

// Export additional types
export type { MaterialsFilters, MaterialsState };

// Export reducer
export default materialsSlice.reducer;