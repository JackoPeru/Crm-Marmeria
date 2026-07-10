import { useClients } from './useClients';
import { useMaterials } from './useMaterials';
import { useAuth } from '../contexts/AuthContext';
import { useBusinessData } from '../contexts/BusinessDataContext';
import { useAnalytics } from './useAnalytics';

export const useData = () => {
  const clients = useClients();
  const materials = useMaterials();
  const auth = useAuth();
  const business = useBusinessData();
  const analytics = useAnalytics();

  const normalizedUser = auth.user
    ? { ...auth.user, name: auth.user.username }
    : null;

  return {
    user: normalizedUser,
    isAuthenticated: auth.isAuthenticated,
    updateUser: auth.updateUser,

    customers: clients.clients,
    customersLoading: clients.loading,
    addCustomer: clients.addClient,
    updateCustomer: clients.updateClient,
    deleteCustomer: clients.removeClient,

    projects: business.projects,
    projectsLoading: business.loading,
    addProject: business.addProject,
    updateProject: business.updateProject,
    deleteProject: business.deleteProject,

    materials: materials.materials,
    materialsLoading: materials.loading,
    addMaterial: materials.addMaterial,
    updateMaterial: materials.updateMaterial,
    deleteMaterial: materials.removeMaterial,

    quotes: business.quotes,
    quotesLoading: business.loading,
    addQuote: business.addQuote,
    updateQuote: business.updateQuote,
    deleteQuote: business.deleteQuote,

    invoices: business.invoices,
    invoicesLoading: business.loading,
    addInvoice: business.addInvoice,
    updateInvoice: business.updateInvoice,
    deleteInvoice: business.deleteInvoice,

    analytics: {
      dailySummary: analytics.dailySummary,
      weeklySummary: analytics.weeklySummary,
      monthlySummary: analytics.monthlySummary,
      performanceMetrics: analytics.performanceMetrics,
      trendData: analytics.trendData
    },
    analyticsLoading: analytics.loading,

    dataState: {
      user: normalizedUser,
      customers: clients.clients,
      projects: business.projects,
      materials: materials.materials,
      quotes: business.quotes,
      invoices: business.invoices,
    }
  };
};

export default useData;
