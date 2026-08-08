import React from 'react';
import { Briefcase, DollarSign, Layers, TrendingUp, Users } from 'lucide-react';
import useUI from '../hooks/useUI';

const StatCard = ({ title, value, icon: Icon, className, targetPage }) => {
  const { updatePreferences } = useUI();
  return (
    <button
      type="button"
      onClick={() => targetPage && updatePreferences({ currentPage: targetPage })}
      disabled={!targetPage}
      className={`p-6 rounded-lg shadow-sm text-left transition-all hover:shadow-md disabled:cursor-default ${className}`}
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-medium">{title}</h3>
        <Icon className="w-7 h-7 opacity-80" />
      </div>
      <p className="text-3xl font-semibold">{value}</p>
    </button>
  );
};

const DashboardStats = ({ stats }) => {
  if (!stats) return null;

  const items = [
    {
      title: 'Clienti Attivi',
      value: stats.customers,
      icon: Users,
      className: 'bg-blue-500 dark:bg-blue-600 text-white',
      targetPage: 'customers',
      visible: stats.customersVisible,
    },
    {
      title: 'Progetti Totali',
      value: stats.projects,
      icon: Briefcase,
      className: 'bg-purple-500 dark:bg-purple-600 text-white',
      targetPage: 'projects',
      visible: stats.projectsVisible,
    },
    {
      title: 'Progetti in Lavorazione',
      value: stats.projectsInProgress,
      icon: TrendingUp,
      className: 'bg-yellow-500 dark:bg-yellow-600 text-white',
      targetPage: 'projects',
      visible: stats.projectsVisible,
    },
    {
      title: 'Materiali Registrati',
      value: stats.materials,
      icon: Layers,
      className: 'bg-green-500 dark:bg-green-600 text-white',
      targetPage: 'materials',
      visible: stats.materialsVisible,
    },
    {
      title: 'Fatturato del mese',
      value: stats.revenue,
      icon: DollarSign,
      className: 'bg-pink-500 dark:bg-pink-600 text-white',
      targetPage: 'invoices',
      visible: stats.revenueVisible,
    },
  ].filter((item) => item.visible);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 md:gap-6">
      {items.map((item) => <StatCard key={item.title} {...item} />)}
    </div>
  );
};

export default DashboardStats;
