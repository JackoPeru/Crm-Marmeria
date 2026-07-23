import { useState, useEffect, useCallback } from 'react';

// Hook per gestire il salvataggio dei dati tramite il server locale
const useServerStorage = (collectionName, networkPrefs = null) => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [syncStatus, setSyncStatus] = useState('idle');

  // Carica i dati iniziali
  useEffect(() => {
    loadData();
  }, [collectionName]);

  // Funzione per caricare i dati
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Se siamo in modalità master e il server è attivo, usa le API del server
      if (networkPrefs?.mode === 'master' && window.electronAPI) {
        const serverStatus = await window.electronAPI.network.getServerStatus();
        
        if (serverStatus.isRunning) {
          // Usa le API del server per caricare i dati
          try {
            const baseUrl = serverStatus.localApiUrl || `https://localhost:${serverStatus.port}/api`;
            const response = await fetch(`${baseUrl}/${collectionName}`);
            if (response.ok) {
              const serverData = await response.json();
              setData(serverData);
              setLoading(false);
              return;
            }
          } catch (fetchError) {
            console.warn('Errore nel caricamento dal server, uso localStorage:', fetchError);
          }
        }
      }
      
      // Fallback a localStorage
      const savedData = localStorage.getItem(collectionName);
      if (savedData) {
        const parsedData = JSON.parse(savedData);
        setData(Array.isArray(parsedData) ? parsedData : []);
      } else {
        setData([]);
      }
    } catch (err) {
      console.error('Errore nel caricamento dei dati:', err);
      setError(err.message);
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [collectionName, networkPrefs]);

  // Funzione per salvare i dati
  const saveData = useCallback(async (newData) => {
    try {
      // Se siamo in modalità master e il server è attivo, usa le API del server
      if (networkPrefs?.mode === 'master' && window.electronAPI) {
        const serverStatus = await window.electronAPI.network.getServerStatus();
        
        if (serverStatus.isRunning) {
          try {
            const baseUrl = serverStatus.localApiUrl || `https://localhost:${serverStatus.port}/api`;
            const response = await fetch(`${baseUrl}/${collectionName}`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(newData),
            });
            
            if (response.ok) {
              console.log(`Dati ${collectionName} salvati sul server`);
              return true;
            }
          } catch (fetchError) {
            console.warn('Errore nel salvataggio sul server, uso localStorage:', fetchError);
          }
        }
      }
      
      // Fallback a localStorage
      localStorage.setItem(collectionName, JSON.stringify(newData));
      console.log(`Dati ${collectionName} salvati in localStorage`);
      return true;
    } catch (err) {
      console.error('Errore nel salvataggio dei dati:', err);
      return false;
    }
  }, [collectionName, networkPrefs]);

  // Funzione per aggiungere un elemento
  const addItem = useCallback(async (item) => {
    setSyncStatus('syncing');
    try {
      const newItem = {
        ...item,
        id: item.id || Date.now().toString(),
        createdAt: item.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      const newData = [...data, newItem];
      
      // Salva i dati
      const success = await saveData(newData);
      if (success) {
        setData(newData);
        setSyncStatus('idle');
        return newItem;
      } else {
        throw new Error('Errore nel salvataggio');
      }
    } catch (err) {
      console.error('Errore nell\'aggiunta dell\'elemento:', err);
      setSyncStatus('error');
      throw err;
    }
  }, [data, saveData]);

  // Funzione per aggiornare un elemento
  const updateItem = useCallback(async (id, updates) => {
    setSyncStatus('syncing');
    try {
      const newData = data.map(item => 
        item.id === id 
          ? { ...item, ...updates, updatedAt: new Date().toISOString() }
          : item
      );
      
      // Salva i dati
      const success = await saveData(newData);
      if (success) {
        setData(newData);
        setSyncStatus('idle');
        return newData.find(item => item.id === id);
      } else {
        throw new Error('Errore nel salvataggio');
      }
    } catch (err) {
      console.error('Errore nell\'aggiornamento dell\'elemento:', err);
      setSyncStatus('error');
      throw err;
    }
  }, [data, saveData]);

  // Funzione per eliminare un elemento
  const deleteItem = useCallback(async (id) => {
    setSyncStatus('syncing');
    try {
      const newData = data.filter(item => item.id !== id);
      
      // Salva i dati
      const success = await saveData(newData);
      if (success) {
        setData(newData);
        setSyncStatus('idle');
        return true;
      } else {
        throw new Error('Errore nel salvataggio');
      }
    } catch (err) {
      console.error('Errore nell\'eliminazione dell\'elemento:', err);
      setSyncStatus('error');
      throw err;
    }
  }, [data, saveData]);

  // Funzione per ricaricare i dati
  const refreshData = useCallback(() => {
    loadData();
  }, [loadData]);

  return {
    data,
    loading,
    error,
    syncStatus,
    addItem,
    updateItem,
    deleteItem,
    refreshData,
    isOnline: true, // Per compatibilità con useNetworkStorage
  };
};

export default useServerStorage;
