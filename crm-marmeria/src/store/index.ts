import { configureStore } from '@reduxjs/toolkit';
import { useDispatch, useSelector, TypedUseSelectorHook } from 'react-redux';
import clientsReducer from './slices/clientsSlice';
import ordersReducer from './slices/ordersSlice';
import materialsReducer from './slices/materialsSlice';
import analyticsReducer from './slices/analyticsSlice';
import uiReducer from './slices/uiSlice';

export const store = configureStore({
  reducer: {
    clients: clientsReducer,
    orders: ordersReducer,
    materials: materialsReducer,
    analytics: analyticsReducer,
    ui: uiReducer,
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware({
    serializableCheck: {
      ignoredActions: [
        'persist/PERSIST',
        'persist/REHYDRATE',
        'ui/addToast',
      ],
      ignoredPaths: [
        'ui.toasts',
        'analytics.voiceBotCache.lastUpdate',
        'orders.voiceBotCache.lastUpdate',
      ],
    },
  }),
  devTools: import.meta.env.DEV,
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

export const selectAllClients = (state: RootState) => state.clients.items;
export const selectClientsLoading = (state: RootState) => state.clients.loading;
export const selectClientsError = (state: RootState) => state.clients.error;
export const selectSelectedClient = (state: RootState) => state.clients.selectedClient;
export const selectClientsPagination = (state: RootState) => state.clients.pagination;
export const selectClientsFilters = (state: RootState) => state.clients.filters;
export const selectClientsStats = (state: RootState) => state.clients.stats;

export const selectAllOrders = (state: RootState) => state.orders.items;
export const selectOrdersLoading = (state: RootState) => state.orders.loading;
export const selectOrdersError = (state: RootState) => state.orders.error;
export const selectSelectedOrder = (state: RootState) => state.orders.selectedOrder;
export const selectOrdersPagination = (state: RootState) => state.orders.pagination;
export const selectOrdersFilters = (state: RootState) => state.orders.filters;
export const selectOrdersStats = (state: RootState) => state.orders.stats;
export const selectVoiceBotOrderStatus = (state: RootState) => state.orders.voiceBotCache.orderStatus;

export const selectAllMaterials = (state: RootState) => state.materials.items;
export const selectMaterialsLoading = (state: RootState) => state.materials.loading;
export const selectMaterialsError = (state: RootState) => state.materials.error;
export const selectSelectedMaterial = (state: RootState) => state.materials.selectedMaterial;
export const selectMaterialsPagination = (state: RootState) => state.materials.pagination;
export const selectMaterialsFilters = (state: RootState) => state.materials.filters;
export const selectMaterialsStats = (state: RootState) => state.materials.stats;
export const selectMaterialCategories = (state: RootState) => state.materials.categories;
export const selectMaterialSuppliers = (state: RootState) => state.materials.suppliers;

export const selectDailySummary = (state: RootState) => state.analytics.dailySummary;
export const selectWeeklySummary = (state: RootState) => state.analytics.weeklySummary;
export const selectMonthlySummary = (state: RootState) => state.analytics.monthlySummary;
export const selectPerformanceMetrics = (state: RootState) => state.analytics.performanceMetrics;
export const selectTrendData = (state: RootState) => state.analytics.trendData;
export const selectAnalyticsLoading = (state: RootState) => state.analytics.loading;
export const selectAnalyticsError = (state: RootState) => state.analytics.error;
export const selectAnalyticsFilters = (state: RootState) => state.analytics.filters;
export const selectVoiceBotTodaySummary = (state: RootState) => state.analytics.voiceBotCache.todaySummary;
export const selectLastFetchTimestamps = (state: RootState) => state.analytics.lastFetch;
export const selectTodaySummaryForVoiceBot = (state: RootState) => state.analytics.voiceBotCache.todaySummary;

export const selectTheme = (state: RootState) => state.ui.theme;
export const selectIsDarkMode = (state: RootState) => state.ui.isDarkMode;
export const selectNotifications = (state: RootState) => state.ui.toasts;
export const selectModals = (state: RootState) => state.ui.modals;
export const selectSidebar = (state: RootState) => state.ui.sidebar;
export const selectSidebarState = (state: RootState) => state.ui.sidebar;
export const selectTables = (state: RootState) => state.ui.tables;
export const selectGlobalLoading = (state: RootState) => state.ui.globalLoading;
export const selectNetworkStatus = (state: RootState) => state.ui.isOnline;
export const selectIsOnline = (state: RootState) => state.ui.isOnline;
export const selectUserPreferences = (state: RootState) => state.ui.preferences;
export const selectGlobalSearch = (state: RootState) => state.ui.globalSearch;
export const selectBreadcrumbs = (state: RootState) => state.ui.breadcrumb;
export const selectToasts = (state: RootState) => state.ui.toasts;

export const selectDashboardData = (state: RootState) => ({
  clients: state.clients.items,
  orders: state.orders.items,
  materials: state.materials.items,
  dailySummary: state.analytics.dailySummary,
  isOnline: state.ui.isOnline,
  loading: state.clients.loading || state.orders.loading || state.analytics.loading,
});

export const selectVoiceBotData = (state: RootState) => ({
  todaySummary: state.analytics.voiceBotCache.todaySummary,
  orderStatusCache: state.orders.voiceBotCache.orderStatus,
  isOnline: state.ui.isOnline,
});

export default store;
