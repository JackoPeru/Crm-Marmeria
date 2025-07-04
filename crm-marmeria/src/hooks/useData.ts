import { useClients } from './useClients';
import { useOrders } from './useOrders';
import { useMaterials } from './useMaterials';
import { useAuth } from '../contexts/AuthContext';
import { useAnalytics } from './useAnalytics';

/**
 * Hook unificato per accedere a tutti i dati dell'applicazione
 * Combina tutti gli hook specifici per fornire un'interfaccia centralizzata
 */
export const useData = () => {
  const clients = useClients();
  const orders = useOrders();
  const materials = useMaterials();
  const auth = useAuth();
  const analytics = useAnalytics();

  return {
    // Dati utente
    user: auth.user,
    isAuthenticated: auth.isAuthenticated,
    
    // Clienti
    customers: clients.clients,
    customersLoading: clients.loading,
    addCustomer: clients.addClient,
    updateCustomer: clients.updateClient,
    deleteCustomer: clients.removeClient,
    
    // Progetti (ordini)
    projects: orders.orders,
    projectsLoading: orders.loading,
    addProject: orders.addOrder,
    updateProject: orders.updateOrder,
    deleteProject: orders.removeOrder,
    
    // Materiali
    materials: materials.materials,
    materialsLoading: materials.loading,
    addMaterial: materials.addMaterial,
    updateMaterial: materials.updateMaterial,
    deleteMaterial: materials.removeMaterial,
    
    // Preventivi (subset di ordini con tipo 'quote')
    quotes: orders.orders.filter(order => order.type === 'quote'),
    quotesLoading: orders.loading,
    addQuote: (quoteData: any) => orders.addOrder({ ...quoteData, type: 'quote' }),
    updateQuote: orders.updateOrder,
    deleteQuote: orders.removeOrder,
    
    // Fatture (subset di ordini con tipo 'invoice')
    invoices: orders.orders.filter(order => order.type === 'invoice'),
    invoicesLoading: orders.loading,
    addInvoice: (invoiceData: any) => orders.addOrder({ ...invoiceData, type: 'invoice' }),
    updateInvoice: orders.updateOrder,
    deleteInvoice: orders.removeOrder,
    
    // Analytics e statistiche
    analytics: {
      dailySummary: analytics.dailySummary,
      weeklySummary: analytics.weeklySummary,
      monthlySummary: analytics.monthlySummary,
      performanceMetrics: analytics.performanceMetrics,
      trendData: analytics.trendData
    },
    analyticsLoading: analytics.loading,
    
    // Stato generale
    dataState: {
      user: auth.user,
      customers: clients.clients,
      projects: orders.orders,
      materials: materials.materials,
      quotes: orders.orders.filter(order => order.type === 'quote'),
      invoices: orders.orders.filter(order => order.type === 'invoice'),
    }
  };
};

export default useData;
