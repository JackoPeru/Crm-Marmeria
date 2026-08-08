import React, { useEffect, useState } from 'react';
import {
  Bell,
  CalendarDays,
  Database,
  FileDigit,
  Mail,
  Palette,
  Printer,
  Settings,
  User,
} from 'lucide-react';
import toast from 'react-hot-toast';
import DataManager from '../components/DataManager';
import UserManagement from '../components/UserManagement';
import ServerUpdatePanel from '../components/ServerUpdatePanel';
import useUI from '../hooks/useUI';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../hooks/useData';
import { apiClient } from '../services/api';
import CatalogManager from '../components/catalog/CatalogManager';

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
  <section className="mb-10 p-6 bg-light-card dark:bg-dark-card text-light-text dark:text-dark-text border border-light-border dark:border-dark-border rounded-lg shadow-md">
    <h3 className="text-xl font-semibold mb-4 text-gray-700 dark:text-gray-200 flex items-center">
      <Icon size={24} className={`mr-3 ${iconClass}`} /> {title}
    </h3>
    {children}
  </section>
);

const CatalogSettingsPanel = () => {
  const { materials = [] } = useData();
  const { user, hasPermission } = useAuth();
  const [edgeTypes, setEdgeTypes] = useState([]);
  const [linearItems, setLinearItems] = useState([]);
  const canView = hasPermission('materials.view');
  const canCreate = hasPermission('materials.create');
  const canEdit = hasPermission('materials.edit');
  const canDelete = hasPermission('materials.delete');
  const showPrices = ['admin', 'manager'].includes(user?.role || '');

  useEffect(() => {
    if (!canView) return undefined;
    let mounted = true;
    Promise.all([
      apiClient.get('/edge-types').catch(() => ({ data: [] })),
      apiClient.get('/linear-items').catch(() => ({ data: [] })),
    ]).then(([edges, linear]) => {
      if (!mounted) return;
      setEdgeTypes(Array.isArray(edges.data) ? edges.data : []);
      setLinearItems(Array.isArray(linear.data) ? linear.data : []);
    });
    return () => { mounted = false; };
  }, [canView]);

  if (!canView) return null;
  return <Section icon={Settings} title="Cataloghi per preventivi" iconClass="text-indigo-500">
    <p className="mb-5 text-sm text-gray-600 dark:text-gray-300">Bordi, angoli e lavorazioni lineari alimentano i selettori e i prezzi delle righe nei preventivi. Le modifiche valgono per le nuove selezioni.</p>
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <CatalogManager kind="edge" endpoint="/edge-types" title="Bordi e angoli" description="Tipi e prezzi al metro per i lati delle superfici." items={edgeTypes} materials={materials} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} showPrices={showPrices} onItemsChange={setEdgeTypes} />
      <CatalogManager kind="linear" endpoint="/linear-items" title="Lavorazioni lineari" description="Voci e prezzi al metro per lavorazioni lineari." items={linearItems} materials={materials} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} showPrices={showPrices} onItemsChange={setLinearItems} />
    </div>
  </Section>;
};

const GmailPanel = () => {
  const [status, setStatus] = useState(null);
  const [clientId, setClientId] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    try {
      const response = await apiClient.get('/integrations/gmail/status');
      setStatus(response.data);
      setClientId(response.data?.clientId || '');
    } catch (error) { toast.error(error.response?.data?.error || 'Stato Gmail non disponibile'); }
  };
  useEffect(() => { void load(); }, []);
  const save = async () => {
    setBusy(true);
    try {
      const response = await apiClient.put('/integrations/gmail/config', { clientId });
      setStatus(response.data);
      toast.success('Client ID Gmail salvato');
    } catch (error) { toast.error(error.response?.data?.error || 'Client ID Gmail non valido'); } finally { setBusy(false); }
  };
  const connect = async () => {
    const popup = window.open('', 'crm-gmail-connect', 'width=640,height=760');
    setBusy(true);
    try {
      const response = await apiClient.post('/integrations/gmail/authorize');
      if (!popup) throw new Error('Popup Gmail bloccato dal browser');
      popup.location.href = response.data.url;
      toast.success('Completa autorizzazione Gmail nella nuova finestra, poi aggiorna questa pagina');
    } catch (error) {
      popup?.close();
      toast.error(error.response?.data?.error || error.message || 'Collegamento Gmail non riuscito');
    } finally { setBusy(false); }
  };
  const disconnect = async () => {
    setBusy(true);
    try {
      const response = await apiClient.delete('/integrations/gmail');
      setStatus(response.data);
      toast.success('Gmail scollegato');
    } catch (error) { toast.error(error.response?.data?.error || 'Scollegamento Gmail non riuscito'); } finally { setBusy(false); }
  };
  return <Section icon={Mail} title="Account Google: Gmail e backup" iconClass="text-red-500">
    <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">Crea bozze Gmail con Word allegato. Invio finale sempre controllato in Gmail.</p>
    <label className="block"><span className="mb-1 block text-sm font-medium">Client ID OAuth Desktop Google</span><input value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="...apps.googleusercontent.com" className="w-full rounded-md border p-2 dark:bg-dark-input" /></label>
    <p className="mt-2 text-xs text-gray-500">Google Cloud: abilita Gmail API e Google Drive API, crea client OAuth Desktop con callback <code>http://127.0.0.1:3001/oauth2/gmail</code>, incolla qui Client ID. Collegamento solo dal PC server.</p>
    <div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" disabled={busy} onClick={() => void save()} className="rounded-md border px-4 py-2 disabled:opacity-50">Salva Client ID</button>{status?.configured && !status?.connected && <button type="button" disabled={busy} onClick={() => void connect()} className="rounded-md bg-red-600 px-4 py-2 text-white disabled:opacity-50">Collega Google</button>}{status?.connected && <><span className="text-sm text-green-700 dark:text-green-400">Collegato: {status.email}</span>{!status.driveBackupReady && <span className="text-sm text-amber-700 dark:text-amber-300">Ricollega Google per autorizzare Drive</span>}<button type="button" disabled={busy} onClick={() => void connect()} className="rounded-md border px-4 py-2 disabled:opacity-50">Ricollega</button><button type="button" disabled={busy} onClick={() => void disconnect()} className="rounded-md border border-red-300 px-4 py-2 text-red-700 disabled:opacity-50">Scollega</button></>}</div>
  </Section>;
};

const GoogleDriveBackupPanel = () => {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    try { setStatus((await apiClient.get('/integrations/google-drive-backups/status')).data); } catch (error) { toast.error(error.response?.data?.error || 'Stato backup Google Drive non disponibile'); }
  };
  useEffect(() => { void load(); }, []);
  const save = async (changes) => {
    setBusy(true);
    try {
      setStatus((await apiClient.put('/integrations/google-drive-backups/config', { ...status, ...changes })).data);
      toast.success('Impostazioni backup Google Drive salvate');
    } catch (error) { toast.error(error.response?.data?.error || 'Impostazioni backup non valide'); } finally { setBusy(false); }
  };
  const backupNow = async () => {
    setBusy(true);
    try {
      const response = await apiClient.post('/integrations/google-drive-backups/run');
      setStatus(response.data.status);
      toast.success('Backup completo caricato su Google Drive');
    } catch (error) { toast.error(error.response?.data?.error || 'Backup Google Drive non riuscito'); } finally { setBusy(false); }
  };
  return <Section icon={Database} title="Backup automatici Google Drive" iconClass="text-green-600">
    <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">Copia completa di database, account e allegati nell’account Google collegato. Cartella: <strong>CRM Marmeria - Backup automatici</strong>.</p>
    <div className="grid gap-4 md:grid-cols-3">
      <label className="block"><span className="mb-1 block text-sm font-medium">Intervallo</span><select value={status?.intervalHours ?? 24} disabled={busy} onChange={(event) => void save({ intervalHours: Number(event.target.value) })} className="w-full rounded-md border p-2 dark:bg-dark-input"><option value={6}>Ogni 6 ore</option><option value={12}>Ogni 12 ore</option><option value={24}>Ogni giorno</option><option value={48}>Ogni 2 giorni</option><option value={168}>Ogni settimana</option></select></label>
      <label className="block"><span className="mb-1 block text-sm font-medium">Copie conservate</span><select value={status?.retentionCount ?? 30} disabled={busy} onChange={(event) => void save({ retentionCount: Number(event.target.value) })} className="w-full rounded-md border p-2 dark:bg-dark-input"><option value={7}>7 copie</option><option value={14}>14 copie</option><option value={30}>30 copie</option><option value={60}>60 copie</option><option value={90}>90 copie</option></select></label>
      <div className="flex items-end gap-3"><button type="button" disabled={busy || !status?.connected || !status?.enabled} onClick={() => void backupNow()} className="rounded-md bg-green-600 px-4 py-2 text-white disabled:opacity-50">{busy ? 'Operazione...' : 'Backup ora'}</button><button type="button" disabled={busy} onClick={() => void save({ enabled: !status?.enabled })} className="rounded-md border px-4 py-2 disabled:opacity-50">{status?.enabled ? 'Disattiva' : 'Attiva'}</button></div>
    </div>
    <p className={`mt-4 text-sm ${status?.connected ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-300'}`}>{status?.connected ? `Google Drive autorizzato: ${status.accountEmail}` : 'Collega o ricollega account Google amministratore nella sezione sopra per autorizzare Google Drive.'}</p>
    {status?.lastSuccessAt && <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">Ultimo upload: {new Date(status.lastSuccessAt).toLocaleString('it-IT')} · {status.remoteBackupCount} copie remote.</p>}
    {status?.lastError && <p className="mt-2 text-sm text-red-700 dark:text-red-300">Ultimo errore: {status.lastError}</p>}
  </Section>;
};

const SdiPecPanel = () => {
  const [status, setStatus] = useState(null);
  const [company, setCompany] = useState({ legalName: '', vatNumber: '', fiscalCode: '', taxRegime: 'RF01', address: '', streetNumber: '', zip: '', city: '', province: '', country: 'IT' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    try {
      const next = (await apiClient.get('/integrations/sdi-pec/status')).data;
      setStatus(next); setCompany((previous) => ({ ...previous, ...(next.company || {}) })); setEmail(next.email || '');
    } catch (error) { toast.error(error.response?.data?.error || 'Stato PEC SdI non disponibile'); }
  };
  useEffect(() => { void load(); }, []);
  const save = async () => {
    setBusy(true);
    try {
      const next = (await apiClient.put('/integrations/sdi-pec/config', { company, email, password })).data;
      setStatus(next); setPassword(''); toast.success('Configurazione PEC Aruba salvata');
    } catch (error) { toast.error(error.response?.data?.error || 'Configurazione PEC non riuscita'); } finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true);
    try { const next = await apiClient.post('/integrations/sdi-pec/test'); toast.success(`PEC Aruba verificata: ${next.data.email}`); await load(); } catch (error) { toast.error(error.response?.data?.error || 'Test PEC non riuscito'); } finally { setBusy(false); }
  };
  const updateCompany = (key, value) => setCompany((previous) => ({ ...previous, [key]: value }));
  return <Section icon={FileDigit} title="Fatturazione elettronica SdI — PEC Aruba" iconClass="text-orange-600">
    <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">Invio XML FatturaPA a SdI, archivio invii e lettura automatica delle ricevute. Inserisci dati solo dal CRM aperto sul PC server: password cifrata localmente e mai mostrata.</p>
    <div className="grid gap-4 md:grid-cols-2">
      <label className="block md:col-span-2"><span className="mb-1 block text-sm font-medium">Ragione sociale / ditta *</span><input value={company.legalName || ''} onChange={(event) => updateCompany('legalName', event.target.value)} className="w-full rounded-md border p-2 dark:bg-dark-input" /></label>
      <label className="block"><span className="mb-1 block text-sm font-medium">Partita IVA *</span><input inputMode="numeric" value={company.vatNumber || ''} onChange={(event) => updateCompany('vatNumber', event.target.value)} className="w-full rounded-md border p-2 dark:bg-dark-input" /></label>
      <label className="block"><span className="mb-1 block text-sm font-medium">Codice fiscale *</span><input value={company.fiscalCode || ''} onChange={(event) => updateCompany('fiscalCode', event.target.value)} className="w-full rounded-md border p-2 dark:bg-dark-input" /></label>
      <label className="block"><span className="mb-1 block text-sm font-medium">Regime fiscale</span><input value={company.taxRegime || 'RF01'} onChange={(event) => updateCompany('taxRegime', event.target.value.toUpperCase())} className="w-full rounded-md border p-2 dark:bg-dark-input" /></label>
      <label className="block"><span className="mb-1 block text-sm font-medium">Via/Piazza *</span><input value={company.address || ''} onChange={(event) => updateCompany('address', event.target.value)} className="w-full rounded-md border p-2 dark:bg-dark-input" /></label>
      <label className="block"><span className="mb-1 block text-sm font-medium">Numero civico</span><input value={company.streetNumber || ''} onChange={(event) => updateCompany('streetNumber', event.target.value)} className="w-full rounded-md border p-2 dark:bg-dark-input" /></label>
      <label className="block"><span className="mb-1 block text-sm font-medium">CAP *</span><input value={company.zip || ''} onChange={(event) => updateCompany('zip', event.target.value)} className="w-full rounded-md border p-2 dark:bg-dark-input" /></label>
      <label className="block"><span className="mb-1 block text-sm font-medium">Comune *</span><input value={company.city || ''} onChange={(event) => updateCompany('city', event.target.value)} className="w-full rounded-md border p-2 dark:bg-dark-input" /></label>
      <label className="block"><span className="mb-1 block text-sm font-medium">Provincia *</span><input maxLength="2" value={company.province || ''} onChange={(event) => updateCompany('province', event.target.value.toUpperCase())} className="w-full rounded-md border p-2 dark:bg-dark-input" /></label>
      <label className="block"><span className="mb-1 block text-sm font-medium">PEC Aruba *</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-md border p-2 dark:bg-dark-input" /></label>
      <label className="block"><span className="mb-1 block text-sm font-medium">Password PEC / password app *</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={status?.hasPassword ? 'Lascia vuoto per non modificarla' : ''} className="w-full rounded-md border p-2 dark:bg-dark-input" /></label>
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" disabled={busy} onClick={() => void save()} className="rounded-md border px-4 py-2 disabled:opacity-50">Salva configurazione</button><button type="button" disabled={busy || !status?.configured} onClick={() => void test()} className="rounded-md bg-orange-600 px-4 py-2 text-white disabled:opacity-50">{busy ? 'Operazione...' : 'Testa SMTP e IMAP'}</button>{status?.configured ? <span className="text-sm text-green-700 dark:text-green-400">Pronta: {status.email}</span> : <span className="text-sm text-amber-700 dark:text-amber-300">Completa dati azienda e PEC prima di inviare.</span>}</div>
    <p className="mt-3 text-xs text-gray-500">Aruba: SMTP <code>smtps.pec.aruba.it:465</code>, IMAP <code>imaps.pec.aruba.it:993</code>, SSL/TLS. Se Aruba 2FA è attiva usa password per programma.</p>
  </Section>;
};

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

      <CatalogSettingsPanel />
      {user?.role === 'admin' && <ServerUpdatePanel />}
      {user?.role === 'admin' && <GmailPanel />}
      {user?.role === 'admin' && <GoogleDriveBackupPanel />}
      {user?.role === 'admin' && <SdiPecPanel />}
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
