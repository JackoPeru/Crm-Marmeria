import React, { useEffect, useState } from 'react';
import { HardDrive, Network, RefreshCw, Server, Wifi, WifiOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { useNetworkStatus } from '../contexts/NetworkStatusProvider';

const normalizeApiUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('Inserisci l’indirizzo del PC principale');
  const parsed = new URL(trimmed);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('L’indirizzo deve iniziare con http:// o https://');
  }
  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = parsed.pathname.replace(/\/$/, '');
  if (!parsed.pathname.endsWith('/api')) parsed.pathname = `${parsed.pathname}/api`;
  return parsed.toString().replace(/\/$/, '');
};

const ServerConnectionSettings: React.FC = () => {
  const { networkStatus, setApiUrl, checkConnection } = useNetworkStatus();
  const [prefs, setPrefs] = useState<NetworkPreferences>({
    mode: 'client',
    masterPort: 3001,
    apiUrl: networkStatus.apiUrl,
    backupPath: '',
  });
  const [masters, setMasters] = useState<DiscoveredMaster[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!window.electronAPI) {
        setPrefs((previous) => ({
          ...previous,
          mode: 'client',
          apiUrl: networkStatus.apiUrl,
        }));
        return;
      }
      const result = await window.electronAPI.network.getPreferences();
      if (result.success && result.prefs) {
        setPrefs({
          ...result.prefs,
          apiUrl: result.prefs.apiUrl || networkStatus.apiUrl,
        });
      }
    };
    void load();
  }, [networkStatus.apiUrl]);

  const discover = async () => {
    if (!window.electronAPI) return;
    setBusy(true);
    try {
      const result = await window.electronAPI.network.discoverMasters();
      setMasters(result.masters || []);
      if (!result.masters?.length) toast.error('Nessun server CRM verificato nella rete locale');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Ricerca server non riuscita');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      const port = Number(prefs.masterPort || 3001);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        throw new Error('La porta deve essere compresa tra 1024 e 65535');
      }

      const requested: NetworkPreferences = {
        ...prefs,
        masterPort: port,
        apiUrl: prefs.mode === 'client'
          ? normalizeApiUrl(prefs.apiUrl || '')
          : `http://127.0.0.1:${port}/api`,
      };

      let applied = requested;
      if (window.electronAPI) {
        const result = await window.electronAPI.network.saveNetworkPrefs(requested);
        if (!result.success) {
          if (result.code === 'MASTER_ALREADY_EXISTS' && result.masters?.length) {
            throw new Error(`È già attivo un server principale: ${result.masters[0].apiUrl}`);
          }
          if (result.code === 'SERVER_ID_MISMATCH') {
            throw new Error('Il server trovato ha un’identità diversa da quello precedentemente associato. Se il PC principale è stato sostituito, selezionalo di nuovo dalla ricerca LAN.');
          }
          throw new Error(result.error || 'Salvataggio configurazione fallito');
        }
        applied = result.prefs || requested;
      } else if (requested.mode !== 'client') {
        throw new Error('La modalità server principale richiede l’app Electron');
      }

      setPrefs(applied);
      const connected = await setApiUrl(
        applied.apiUrl || networkStatus.apiUrl,
        applied.discoveredServerId,
      );
      if (connected) toast.success('Configurazione server salvata e verificata');
      else toast.error('Configurazione salvata, ma il server non risponde');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Configurazione non riuscita');
    } finally {
      setBusy(false);
    }
  };

  const pickBackupFolder = async () => {
    const result = await window.electronAPI?.network.pickBackupFolder();
    if (result?.success && result.path) {
      setPrefs((previous) => ({ ...previous, backupPath: result.path }));
    }
  };

  return (
    <div className="mb-10 p-6 bg-white dark:bg-dark-card rounded-lg shadow-md">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <h3 className="text-xl font-semibold text-gray-700 dark:text-gray-200 flex items-center">
          <Server size={24} className="mr-3 text-indigo-500" /> Server centrale della marmeria
        </h3>
        <div className={`px-3 py-1.5 rounded-full text-sm flex items-center gap-2 ${networkStatus.serverReachable ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
          {networkStatus.serverReachable ? <Wifi size={16} /> : <WifiOff size={16} />}
          {networkStatus.serverReachable ? 'Connesso' : 'Non raggiungibile'}
        </div>
      </div>

      <p className="text-sm text-gray-600 dark:text-gray-400 mb-5">
        Deve esistere un solo PC principale. Tutte le altre postazioni leggono e modificano lo stesso database centrale. Dopo il primo collegamento viene salvata anche l’identità del server, non soltanto il suo indirizzo IP.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-sm font-medium">Ruolo di questa postazione</span>
          <select
            value={prefs.mode}
            onChange={(event) => setPrefs((previous) => ({
              ...previous,
              mode: event.target.value as NetworkPreferences['mode'],
            }))}
            className="mt-1 w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input"
          >
            <option value="client">Postazione client / operaio</option>
            {window.electronAPI && <option value="master">PC principale / server</option>}
          </select>
        </label>

        {prefs.mode === 'master' ? (
          <label className="block">
            <span className="text-sm font-medium">Porta del server</span>
            <input
              type="number"
              min="1024"
              max="65535"
              value={prefs.masterPort || 3001}
              onChange={(event) => setPrefs((previous) => ({
                ...previous,
                masterPort: Number(event.target.value),
              }))}
              className="mt-1 w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input"
            />
          </label>
        ) : (
          <label className="block">
            <span className="text-sm font-medium">Indirizzo API del PC principale</span>
            <input
              value={prefs.apiUrl || ''}
              onChange={(event) => setPrefs((previous) => ({
                ...previous,
                apiUrl: event.target.value,
                discoveredServerId: undefined,
              }))}
              placeholder="http://192.168.1.20:3001/api"
              className="mt-1 w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input"
            />
          </label>
        )}
      </div>

      {prefs.mode === 'master' && window.electronAPI && (
        <div className="mt-4">
          <label className="block text-sm font-medium mb-1">Cartella dei backup automatici</label>
          <div className="flex gap-2">
            <input
              value={prefs.backupPath || ''}
              readOnly
              placeholder="Cartella locale predefinita"
              className="flex-1 p-2 border rounded-md bg-light-bg dark:bg-dark-input"
            />
            <button
              onClick={pickBackupFolder}
              type="button"
              className="px-3 py-2 border rounded-md flex items-center gap-2"
            >
              <HardDrive size={17} /> Scegli
            </button>
          </div>
        </div>
      )}

      {prefs.mode === 'client' && window.electronAPI && (
        <div className="mt-5">
          <button
            type="button"
            onClick={discover}
            disabled={busy}
            className="px-4 py-2 border rounded-md flex items-center gap-2 disabled:opacity-50"
          >
            <Network size={18} /> Cerca server nella LAN
          </button>
          {masters.length > 0 && (
            <div className="mt-3 space-y-2">
              {masters.map((master) => (
                <button
                  type="button"
                  key={master.serverId || master.apiUrl}
                  onClick={() => setPrefs((previous) => ({
                    ...previous,
                    apiUrl: master.apiUrl,
                    discoveredServerId: master.serverId,
                  }))}
                  className="w-full text-left p-3 border rounded-md hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <strong>{master.name || master.hostname || 'CRM Marmeria'}</strong>
                  <span className="block text-sm text-gray-500">{master.apiUrl}</span>
                  <span className="block text-xs text-gray-400 break-all">ID server: {master.serverId}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          onClick={save}
          disabled={busy}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white rounded-md"
        >
          Salva e applica
        </button>
        <button
          onClick={() => void checkConnection()}
          disabled={busy}
          className="px-4 py-2 border rounded-md flex items-center gap-2 disabled:opacity-50"
        >
          <RefreshCw size={17} /> Verifica ora
        </button>
      </div>

      <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
        <div className="p-3 rounded-md bg-gray-50 dark:bg-gray-800">
          <strong>API</strong>
          <span className="block break-all text-gray-500">{networkStatus.apiUrl}</span>
          {prefs.discoveredServerId && (
            <span className="block break-all text-xs text-gray-400 mt-1">ID: {prefs.discoveredServerId}</span>
          )}
        </div>
        <div className="p-3 rounded-md bg-gray-50 dark:bg-gray-800">
          <strong>Tempo reale</strong>
          <span className="block text-gray-500">{networkStatus.realtimeStatus}</span>
        </div>
        <div className="p-3 rounded-md bg-gray-50 dark:bg-gray-800">
          <strong>Operazioni in coda</strong>
          <span className="block text-gray-500">{networkStatus.queuedOperations}</span>
        </div>
      </div>
    </div>
  );
};

export default ServerConnectionSettings;
