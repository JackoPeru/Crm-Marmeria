/**
 * Redux Slice per la gestione dello stato UI
 * Gestisce tema, notifiche, modali, sidebar e altri elementi dell'interfaccia
 */
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

// Interfacce per lo stato UI
export interface NotificationSettings {
  orders: boolean;
  deliveries: boolean;
  lowStock: boolean;
  newClients: boolean;
  systemUpdates: boolean;
  sound: boolean;
  desktop: boolean;
}

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
  duration?: number;
  persistent?: boolean;
}

export interface Modal {
  id: string;
  type: string;
  isOpen: boolean;
  data?: any;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
}

export interface SidebarState {
  isOpen: boolean;
  isCollapsed: boolean;
  activeSection: string;
  pinnedSections: string[];
}

export interface TableState {
  [tableId: string]: {
    sortBy: string;
    sortOrder: 'asc' | 'desc';
    filters: Record<string, any>;
    selectedRows: string[];
    pageSize: number;
    currentPage: number;
  };
}

interface UIState {
  // Tema e aspetto
  theme: 'light' | 'dark' | 'auto';
  isDarkMode: boolean;
  fontSize: 'small' | 'medium' | 'large';
  compactMode: boolean;
  
  // Layout
  sidebar: SidebarState;
  headerHeight: number;
  footerVisible: boolean;
  
  // Notifiche e toast
  notificationSettings: NotificationSettings;
  toasts: Toast[];
  
  // Modali
  modals: Modal[];
  
  // Tabelle
  tables: TableState;
  
  // Stato di caricamento globale
  globalLoading: boolean;
  loadingMessage: string;
  
  // Connessione di rete
  isOnline: boolean;
  lastOnlineCheck: number;
  
  // Preferenze utente
  preferences: {
    language: 'it' | 'en';
    dateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
    timeFormat: '12h' | '24h';
    currency: 'EUR' | 'USD';
    autoSave: boolean;
    confirmDelete: boolean;
    showTooltips: boolean;
    currentPage: string;
  };
  
  // Stato della ricerca globale
  globalSearch: {
    isOpen: boolean;
    query: string;
    results: any[];
    loading: boolean;
  };
  
  // Breadcrumb
  breadcrumb: Array<{
    label: string;
    path: string;
    icon?: string;
  }>;
}

const savedTheme = (): 'light' | 'dark' => {
  if (typeof window === 'undefined') return 'light';
  try {
    return window.localStorage.getItem('crm_theme') === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
};

// Stato iniziale
const initialState: UIState = {
  theme: savedTheme(),
  isDarkMode: false,
  fontSize: 'medium',
  compactMode: false,
  
  sidebar: {
    isOpen: true,
    isCollapsed: false,
    activeSection: 'dashboard',
    pinnedSections: ['dashboard', 'orders'],
  },
  headerHeight: 64,
  footerVisible: true,
  
  notificationSettings: {
    orders: true,
    deliveries: true,
    lowStock: true,
    newClients: true,
    systemUpdates: true,
    sound: true,
    desktop: true,
  },
  toasts: [],
  
  modals: [],
  
  tables: {},
  
  globalLoading: false,
  loadingMessage: '',
  
  isOnline: true,
  lastOnlineCheck: Date.now(),
  
  preferences: {
    language: 'it',
    dateFormat: 'DD/MM/YYYY',
    timeFormat: '24h',
    currency: 'EUR',
    autoSave: true,
    confirmDelete: true,
    showTooltips: true,
    currentPage: 'dashboard',
  },
  
  globalSearch: {
    isOpen: false,
    query: '',
    results: [],
    loading: false,
  },
  
  breadcrumb: [
    { label: 'Dashboard', path: '/', icon: 'home' },
  ],
};

// Slice
const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    // Tema e aspetto
    setTheme: (state, action: PayloadAction<'light' | 'dark' | 'auto'>) => {
      state.theme = action.payload;
    },
    
    setDarkMode: (state, action: PayloadAction<boolean>) => {
      state.isDarkMode = action.payload;
    },
    
    setFontSize: (state, action: PayloadAction<'small' | 'medium' | 'large'>) => {
      state.fontSize = action.payload;
    },
    
    toggleCompactMode: (state) => {
      state.compactMode = !state.compactMode;
    },
    
    // Sidebar
    toggleSidebar: (state) => {
      state.sidebar.isOpen = !state.sidebar.isOpen;
    },
    
    setSidebarOpen: (state, action: PayloadAction<boolean>) => {
      state.sidebar.isOpen = action.payload;
    },
    
    toggleSidebarCollapsed: (state) => {
      state.sidebar.isCollapsed = !state.sidebar.isCollapsed;
    },
    
    setSidebarCollapsed: (state, action: PayloadAction<boolean>) => {
      state.sidebar.isCollapsed = action.payload;
    },
    
    setActiveSection: (state, action: PayloadAction<string>) => {
      state.sidebar.activeSection = action.payload;
    },
    
    togglePinnedSection: (state, action: PayloadAction<string>) => {
      const section = action.payload;
      const index = state.sidebar.pinnedSections.indexOf(section);
      if (index > -1) {
        state.sidebar.pinnedSections.splice(index, 1);
      } else {
        state.sidebar.pinnedSections.push(section);
      }
    },
    
    // Notifiche
    updateNotificationSettings: (state, action: PayloadAction<Partial<NotificationSettings>>) => {
      state.notificationSettings = { ...state.notificationSettings, ...action.payload };
    },
    
    // Toast
    addToast: (state, action: PayloadAction<Omit<Toast, 'id'>>) => {
      const toast: Toast = {
        id: `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        ...action.payload,
      };
      state.toasts.push(toast);
    },
    
    removeToast: (state, action: PayloadAction<string>) => {
      state.toasts = state.toasts.filter(toast => toast.id !== action.payload);
    },
    
    clearAllToasts: (state) => {
      state.toasts = [];
    },
    
    // Modali
    openModal: (state, action: PayloadAction<Omit<Modal, 'isOpen'>>) => {
      const existingModal = state.modals.find(modal => modal.id === action.payload.id);
      if (existingModal) {
        existingModal.isOpen = true;
        existingModal.data = action.payload.data;
        existingModal.size = action.payload.size;
      } else {
        state.modals.push({ ...action.payload, isOpen: true });
      }
    },
    
    closeModal: (state, action: PayloadAction<string>) => {
      const modal = state.modals.find(modal => modal.id === action.payload);
      if (modal) {
        modal.isOpen = false;
      }
    },
    
    closeAllModals: (state) => {
      state.modals.forEach(modal => {
        modal.isOpen = false;
      });
    },
    
    removeModal: (state, action: PayloadAction<string>) => {
      state.modals = state.modals.filter(modal => modal.id !== action.payload);
    },
    
    // Tabelle
    updateTableState: (state, action: PayloadAction<{ tableId: string; updates: Partial<TableState[string]> }>) => {
      const { tableId, updates } = action.payload;
      if (!state.tables[tableId]) {
        state.tables[tableId] = {
          sortBy: '',
          sortOrder: 'asc',
          filters: {},
          selectedRows: [],
          pageSize: 25,
          currentPage: 1,
        };
      }
      state.tables[tableId] = { ...state.tables[tableId], ...updates };
    },
    
    resetTableState: (state, action: PayloadAction<string>) => {
      delete state.tables[action.payload];
    },
    
    // Caricamento globale
    setGlobalLoading: (state, action: PayloadAction<{ loading: boolean; message?: string }>) => {
      state.globalLoading = action.payload.loading;
      state.loadingMessage = action.payload.message || '';
    },
    
    // Stato di rete
    setOnlineStatus: (state, action: PayloadAction<boolean>) => {
      state.isOnline = action.payload;
      state.lastOnlineCheck = Date.now();
    },
    
    // Preferenze
    updatePreferences: (state, action: PayloadAction<Partial<UIState['preferences']>>) => {
      state.preferences = { ...state.preferences, ...action.payload };
    },
    
    // Ricerca globale
    setGlobalSearchOpen: (state, action: PayloadAction<boolean>) => {
      state.globalSearch.isOpen = action.payload;
      if (!action.payload) {
        state.globalSearch.query = '';
        state.globalSearch.results = [];
      }
    },
    
    setGlobalSearchQuery: (state, action: PayloadAction<string>) => {
      state.globalSearch.query = action.payload;
    },
    
    setGlobalSearchResults: (state, action: PayloadAction<any[]>) => {
      state.globalSearch.results = action.payload;
    },
    
    setGlobalSearchLoading: (state, action: PayloadAction<boolean>) => {
      state.globalSearch.loading = action.payload;
    },
    
    // Breadcrumb
    setBreadcrumb: (state, action: PayloadAction<UIState['breadcrumb']>) => {
      state.breadcrumb = action.payload;
    },
    
    addBreadcrumbItem: (state, action: PayloadAction<{ label: string; path: string; icon?: string }>) => {
      // Evita duplicati
      const exists = state.breadcrumb.some(item => item.path === action.payload.path);
      if (!exists) {
        state.breadcrumb.push(action.payload);
      }
    },
    
    removeBreadcrumbItem: (state, action: PayloadAction<string>) => {
      const index = state.breadcrumb.findIndex(item => item.path === action.payload);
      if (index > -1) {
        state.breadcrumb.splice(index + 1); // Rimuove l'elemento e tutti quelli successivi
      }
    },
    
    // Layout
    setHeaderHeight: (state, action: PayloadAction<number>) => {
      state.headerHeight = action.payload;
    },
    
    setFooterVisible: (state, action: PayloadAction<boolean>) => {
      state.footerVisible = action.payload;
    },
    
    // Reset completo dello stato UI
    resetUIState: (state) => {
      return { ...initialState, preferences: state.preferences }; // Mantiene le preferenze
    },
  },
});

// Export actions
export const {
  setTheme,
  setDarkMode,
  setFontSize,
  toggleCompactMode,
  toggleSidebar,
  setSidebarOpen,
  toggleSidebarCollapsed,
  setSidebarCollapsed,
  setActiveSection,
  togglePinnedSection,
  updateNotificationSettings,
  addToast,
  removeToast,
  clearAllToasts,
  openModal,
  closeModal,
  closeAllModals,
  removeModal,
  updateTableState,
  resetTableState,
  setGlobalLoading,
  setOnlineStatus,
  updatePreferences,
  setGlobalSearchOpen,
  setGlobalSearchQuery,
  setGlobalSearchResults,
  setGlobalSearchLoading,
  setBreadcrumb,
  addBreadcrumbItem,
  removeBreadcrumbItem,
  setHeaderHeight,
  setFooterVisible,
  resetUIState,
} = uiSlice.actions;

// Export selectors
export const selectUI = (state: { ui: UIState }) => state.ui;
export const selectTheme = (state: { ui: UIState }) => state.ui.theme;
export const selectIsDarkMode = (state: { ui: UIState }) => state.ui.isDarkMode;
export const selectFontSize = (state: { ui: UIState }) => state.ui.fontSize;
export const selectCompactMode = (state: { ui: UIState }) => state.ui.compactMode;
export const selectSidebar = (state: { ui: UIState }) => state.ui.sidebar;
export const selectNotificationSettings = (state: { ui: UIState }) => state.ui.notificationSettings;
export const selectToasts = (state: { ui: UIState }) => state.ui.toasts;
export const selectModals = (state: { ui: UIState }) => state.ui.modals;
export const selectTables = (state: { ui: UIState }) => state.ui.tables;
export const selectGlobalLoading = (state: { ui: UIState }) => state.ui.globalLoading;
export const selectLoadingMessage = (state: { ui: UIState }) => state.ui.loadingMessage;
export const selectIsOnline = (state: { ui: UIState }) => state.ui.isOnline;
export const selectPreferences = (state: { ui: UIState }) => state.ui.preferences;
export const selectGlobalSearch = (state: { ui: UIState }) => state.ui.globalSearch;
export const selectBreadcrumb = (state: { ui: UIState }) => state.ui.breadcrumb;
export const selectHeaderHeight = (state: { ui: UIState }) => state.ui.headerHeight;
export const selectFooterVisible = (state: { ui: UIState }) => state.ui.footerVisible;

// Selettori specifici
export const selectModalById = (modalId: string) => 
  (state: { ui: UIState }) => state.ui.modals.find(modal => modal.id === modalId);

export const selectTableState = (tableId: string) => 
  (state: { ui: UIState }) => state.ui.tables[tableId];

export const selectActiveToasts = (state: { ui: UIState }) => 
  state.ui.toasts.filter(toast => !toast.persistent || toast.duration === undefined);

export const selectPersistentToasts = (state: { ui: UIState }) => 
  state.ui.toasts.filter(toast => toast.persistent);

// Export reducer
export default uiSlice.reducer;
