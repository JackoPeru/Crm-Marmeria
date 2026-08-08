import React, { useEffect } from 'react';
import { Provider } from 'react-redux';
import { Toaster } from 'react-hot-toast';
import {
  LayoutDashboard,
  Users,
  Briefcase,
  Layers,
  FileText,
  DollarSign,
  CalendarDays,
  ClipboardList,
  Truck,
  Settings as Cog,
} from 'lucide-react';
import { cacheService } from './services/cache';
import { store } from './store';
import { NetworkStatusProvider } from './contexts/NetworkStatusProvider';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { BusinessDataProvider } from './contexts/BusinessDataContext';
import Sidebar from './components/layout/Sidebar';
import Header from './components/layout/Header';
import LoginForm from './components/auth/LoginForm.tsx';
import ProtectedRoute from './components/auth/ProtectedRoute';
import OfflineQueuePanel from './components/OfflineQueuePanel';
import DashboardPage from './pages/DashboardPage';
import CustomersPage from './pages/CustomersPage';
import ProjectsPage from './pages/ProjectsPage';
import MaterialsPage from './pages/MaterialsPage';
import ListinoPage from './pages/ListinoPage';
import QuotesPage from './pages/QuotesPage';
import InvoicesPage from './pages/InvoicesPage';
import SettingsPage from './pages/SettingsPage';
import CalendarPage from './pages/CalendarPage';
import OperationsPage from './pages/OperationsPage';
import SuppliersPage from './pages/SuppliersPage';
import useUI from './hooks/useUI';

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, component: DashboardPage, permission: 'dashboard.view' },
  { id: 'customers', label: 'Clienti', icon: Users, component: CustomersPage, permission: 'clients.view' },
  { id: 'suppliers', label: 'Fornitori', icon: Truck, component: SuppliersPage, permission: 'suppliers.view' },
  { id: 'projects', label: 'Progetti', icon: Briefcase, component: ProjectsPage, permission: 'projects.view' },
  { id: 'materials', label: 'Materiali', icon: Layers, component: MaterialsPage, permission: 'materials.view' },
  { id: 'price-list', label: 'Listino', icon: Layers, component: ListinoPage, permission: 'materials.view' },
  { id: 'quotes', label: 'Preventivi', icon: FileText, component: QuotesPage, permission: 'quotes.view' },
  { id: 'calendar', label: 'Calendario', icon: CalendarDays, component: CalendarPage, permission: 'calendar.view' },
  { id: 'invoices', label: 'Fatture', icon: DollarSign, component: InvoicesPage, permission: 'invoices.view' },
  { id: 'operations', label: 'Operazioni', icon: ClipboardList, component: OperationsPage, permission: 'orders.view' },
  { id: 'settings', label: 'Impostazioni', icon: Cog, component: SettingsPage, permission: 'settings.view' },
];

const AppContent = () => {
  const {
    theme,
    sidebar: { isOpen: isSidebarOpen },
    userPreferences,
    updatePreferences,
    toggleSidebar,
    closeSidebar,
  } = useUI();
  const { isAuthenticated, isLoading, isInitialized, user, hasPermission } = useAuth();

  useEffect(() => {
    cacheService.init().catch((error) => console.error('Errore inizializzazione cache:', error));
  }, []);

  const allowedNavItems = isAuthenticated && user
    ? navItems.filter((item) => !item.permission || hasPermission(item.permission))
    : [];

  const requestedPage = userPreferences.currentPage || 'dashboard';
  const currentPage = allowedNavItems.some((item) => item.id === requestedPage)
    ? requestedPage
    : allowedNavItems[0]?.id || 'dashboard';

  useEffect(() => {
    if (isAuthenticated && currentPage !== requestedPage) {
      updatePreferences({ currentPage });
    }
  }, [isAuthenticated, currentPage, requestedPage, updatePreferences]);

  if (!isInitialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">Caricamento...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <LoginForm />
      </div>
    );
  }

  const currentItem = allowedNavItems.find((item) => item.id === currentPage) || allowedNavItems[0];
  const CurrentPageComponent = currentItem?.component || DashboardPage;
  const handleNavigation = (pageId) => {
    updatePreferences({ currentPage: pageId });
    if (window.innerWidth < 1024) closeSidebar();
  };

  return (
    <BusinessDataProvider>
      <div className={`app ${theme} ${isSidebarOpen ? 'sidebar-open' : ''}`}>
        <Sidebar
          navItems={allowedNavItems}
          isSidebarOpen={isSidebarOpen}
          currentPage={currentPage}
          handleNavigation={handleNavigation}
          currentUser={user}
          appId="crm-marmeria"
          onClose={toggleSidebar}
        />
        <div className="main-content">
          <Header />
          <main>
            <div className="px-4 pt-4 md:px-6">
              <OfflineQueuePanel />
            </div>
            <ProtectedRoute permission={currentItem?.permission}>
              <CurrentPageComponent />
            </ProtectedRoute>
          </main>
        </div>
        <Toaster position="bottom-right" />
      </div>
    </BusinessDataProvider>
  );
};

const App = () => (
  <Provider store={store}>
    <NetworkStatusProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </NetworkStatusProvider>
  </Provider>
);

export default App;
