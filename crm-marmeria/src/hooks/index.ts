export { useAuth } from '../contexts/AuthContext';
export { useClients } from './useClients';
export { useOrders } from './useOrders';
export { useMaterials } from './useMaterials';
export { useAnalytics } from './useAnalytics';
export { default as useUI } from './useUI';
export { useData } from './useData';
export { useDashboard } from './useDashboard';

export type { LoginCredentials, User } from '../services/auth';
export type { Client, ClientsFilters } from '../store/slices/clientsSlice';
export type { Order, OrdersFilters } from '../store/slices/ordersSlice';
export type { Material, MaterialsFilters } from '../store/slices/materialsSlice';
export type { AnalyticsFilters } from '../store/slices/analyticsSlice';
export type {
  Toast,
  Modal,
  SidebarState,
  TableState,
  NotificationSettings,
} from '../store/slices/uiSlice';
