import React, { useEffect, useState } from 'react';
import {
  Bell,
  CalendarDays,
  Database,
  FileDigit,
  Palette,
  Printer,
  User,
} from 'lucide-react';
import toast from 'react-hot-toast';
import DataManager from '../components/DataManager';
import UserManagement from '../components/UserManagement';
import ServerConnectionSettings from '../components/ServerConnectionSettings';
import useUI from '../hooks/useUI';
import { useAuth } from '../contexts/AuthContext';

const AnimatedSwitch = ({ id, checked, onChange, label }) => (
  <div className="flex items-center justify-between py-3">
    <label htmlFor={id} className="text-gray-600 dark:text-gray-300 select-none cursor-pointer">
      {label}
    </label>
    <button
      id={id}
      onClick={onChange}
      type="button"
      role="switch"
      aria-checked={checked}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${checked ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-600'}`}
    >
      <span className="sr-only">{label}</span>
      <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  </div>
);

const Section = ({ icon: Icon, title, iconClass, children }) => (
  <section className="mb-10 p-6 bg-white dark:bg-dark-card rounded-lg shadow-md">
    <h3 className="text-xl font-semibold mb-4 text-gray-700 dark:text-gray-200 flex items-center">
      <Icon size={24} className={`mr-3 ${iconClass}`} /> {title}
    </h3>
    {children}
  </section>
);

const SettingsPage = () => {
  const { theme, userPreferences, changeTheme, updatePreferences } = useUI();
  const { user, updateUser } = useAuth();
  const [savingProfile, setSavingProfile] = useState(false);
  const [profile, setProfile] = useState({
    username: '',
    email: '',
    firstName: '',
    lastName: '',
  });

  useEffect(() => {
    if (!user) return;
    setProfile({
      username: user.username || '',
      email: user.email || '',
      firstName: user.firstName || '',
      lastName: user.lastName || '',
    });
  }, [user]);

  const notifications = userPreferences.notifications || {};
  const formatting = userPreferences.formatting || {
    dateFormat: 'DD/MM/YYYY',
    currencySymbol: '€',
  };
  const fiscal = userPreferences.fiscal || {
    vatNumber: '',
    taxCode: '',
    defaultTaxRate: 22,
  };
  const print = userPreferences.print || {
    logoUrl: '',
    printHeader: true,
    printFooter: true,
  };
  const dataPreferences = userPreferences.data || {
    customerCodePrefix: 'CLI-',
    projectCodePrefix: 'PRJ-',
  };

  const updateGroup = (group, key, value) => {
    const current = userPreferences[group] || {};
    updatePreferences({ [group]: { ...current, [key]: value } });
  };

  const saveProfile = async () => {
    const normalized = Object.fromEntries(
      Object.entries(profile).map(([key, value]) => [key, String(value).trim()]),
    );
    if (!normalized.username || !normalized.email) {
      toast.error('Username ed email sono obbligatori');
      return;
    }

    setSavingProfile(true);
    try {
      await updateUser(normalized);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Aggiornamento profilo non riuscito');
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <div className="p-4 md:p-8 bg-light-bg dark:bg-dark-bg text-light-text dark:text-dark-text min-h-screen">
      <h2 className="text-3xl font-semibold mb-8 text-gray-800 dark:text-gray-100">
        Impostazioni Applicazione
      </h2>

      <Section icon={Palette} title="Aspetto" iconClass="text-indigo-500">
        <AnimatedSwitch
          id="darkMode"
          checked={theme === 'dark'}
          onChange={() => changeTheme(theme === 'dark' ? 'light' : 'dark')}
          label="Tema scuro"
        />
      </Section>

      <Section icon={User} title="Profilo Utente" iconClass="text-blue-500">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            ['firstName', 'Nome'],
            ['lastName', 'Cognome'],
            ['username', 'Nome utente'],
            ['email', 'Email'],
          ].map(([field, label]) => (
            <label key={field} className="block">
              <span className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                {label}
              </span>
              <input
                type={field === 'email' ? 'email' : 'text'}
                value={profile[field] || ''}
                onChange={(event) => setProfile((previous) => ({
                  ...previous,
                  [field]: event.target.value,
                }))}
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-700"
              />
            </label>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void saveProfile()}
          disabled={savingProfile}
          className="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white rounded-md"
        >
          {savingProfile ? 'Salvataggio...' : 'Salva modifiche profilo'}
        </button>
      </Section>

      {user?.role === 'admin' && <ServerConnectionSettings />}
      {user?.role === 'admin' && <UserManagement />}

      <Section icon={Bell} title="Notifiche" iconClass="text-green-500">
        <AnimatedSwitch
          id="emailNotifications"
          checked={Boolean(notifications.emailNewProjects)}
          onChange={() => updateGroup(
            'notifications',
            'emailNewProjects',
            !notifications.emailNewProjects,
          )}
          label="Notifiche email per nuovi progetti"
        />
        <div className="border-b border-gray-200 dark:border-gray-700" />
        <AnimatedSwitch
          id="inAppNotifications"
          checked={Boolean(notifications.inAppDeadlines)}
          onChange={() => updateGroup(
            'notifications',
            'inAppDeadlines',
            !notifications.inAppDeadlines,
          )}
          label="Notifiche nell’app per le scadenze"
        />
      </Section>

      {user?.role === 'admin' && <DataManager />}

      <Section icon={Database} title="Preferenze Dati" iconClass="text-purple-500">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-sm font-medium mb-1">Prefisso codice cliente</span>
            <input
              value={dataPreferences.customerCodePrefix || ''}
              onChange={(event) => updateGroup('data', 'customerCodePrefix', event.target.value)}
              className="w-full p-2 border rounded-md bg-gray-50 dark:bg-gray-700"
            />
          </label>
          <label className="block">
            <span className="block text-sm font-medium mb-1">Prefisso codice progetto</span>
            <input
              value={dataPreferences.projectCodePrefix || ''}
              onChange={(event) => updateGroup('data', 'projectCodePrefix', event.target.value)}
              className="w-full p-2 border rounded-md bg-gray-50 dark:bg-gray-700"
            />
          </label>
        </div>
      </Section>

      <Section icon={CalendarDays} title="Formattazione" iconClass="text-teal-500">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-sm font-medium mb-1">Formato data</span>
            <select
              value={formatting.dateFormat || 'DD/MM/YYYY'}
              onChange={(event) => updateGroup('formatting', 'dateFormat', event.target.value)}
              className="w-full p-2 border rounded-md bg-gray-50 dark:bg-gray-700"
            >
              <option value="DD/MM/YYYY">DD/MM/YYYY</option>
              <option value="YYYY-MM-DD">YYYY-MM-DD</option>
            </select>
          </label>
          <label className="block">
            <span className="block text-sm font-medium mb-1">Valuta</span>
            <select
              value={formatting.currencySymbol || '€'}
              onChange={(event) => updateGroup('formatting', 'currencySymbol', event.target.value)}
              className="w-full p-2 border rounded-md bg-gray-50 dark:bg-gray-700"
            >
              <option value="€">Euro (€)</option>
              <option value="$">Dollaro ($)</option>
              <option value="£">Sterlina (£)</option>
            </select>
          </label>
        </div>
      </Section>

      <Section icon={FileDigit} title="Dati Fiscali" iconClass="text-orange-500">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label className="block">
            <span className="block text-sm font-medium mb-1">Partita IVA</span>
            <input
              value={fiscal.vatNumber || ''}
              onChange={(event) => updateGroup('fiscal', 'vatNumber', event.target.value)}
              className="w-full p-2 border rounded-md bg-gray-50 dark:bg-gray-700"
            />
          </label>
          <label className="block">
            <span className="block text-sm font-medium mb-1">Codice fiscale</span>
            <input
              value={fiscal.taxCode || ''}
              onChange={(event) => updateGroup('fiscal', 'taxCode', event.target.value)}
              className="w-full p-2 border rounded-md bg-gray-50 dark:bg-gray-700"
            />
          </label>
          <label className="block">
            <span className="block text-sm font-medium mb-1">IVA predefinita (%)</span>
            <input
              type="number"
              min="0"
              max="100"
              value={fiscal.defaultTaxRate ?? 22}
              onChange={(event) => updateGroup(
                'fiscal',
                'defaultTaxRate',
                Number(event.target.value),
              )}
              className="w-full p-2 border rounded-md bg-gray-50 dark:bg-gray-700"
            />
          </label>
        </div>
      </Section>

      <Section icon={Printer} title="Stampa" iconClass="text-pink-500">
        <AnimatedSwitch
          id="printHeader"
          checked={Boolean(print.printHeader)}
          onChange={() => updateGroup('print', 'printHeader', !print.printHeader)}
          label="Mostra intestazione"
        />
        <div className="border-b border-gray-200 dark:border-gray-700" />
        <AnimatedSwitch
          id="printFooter"
          checked={Boolean(print.printFooter)}
          onChange={() => updateGroup('print', 'printFooter', !print.printFooter)}
          label="Mostra piè di pagina"
        />
      </Section>
    </div>
  );
};

export default SettingsPage;
