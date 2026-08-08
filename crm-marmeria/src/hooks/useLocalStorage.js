import { useState, useEffect } from 'react';

const defaultData = {
  customers: [
    {
      id: '1',
      name: 'Cliente Demo',
      email: 'demo@example.com',
      phone: '+39 123 456 7890',
      address: 'Via Roma 1, Milano',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ],
  projects: [
    {
      id: '1',
      title: 'Progetto Demo',
      customerId: '1',
      status: 'In Lavorazione',
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ],
  materials: [
    {
      id: '1',
      name: 'Marmo Carrara',
      quantity: 100,
      unit: 'm²',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ],
  invoices: [
    {
      id: '1',
      projectId: '1',
      amount: 5000,
      status: 'Pagata',
      date: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ]
};

const useLocalStorage = (collectionName) => {
  const [data, setData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Carica i dati dal localStorage all'avvio
  useEffect(() => {
    try {
      const storedData = localStorage.getItem(collectionName);
      if (!storedData && defaultData[collectionName]) {
        // Inizializza con i dati predefiniti se non ci sono dati salvati
        saveData(defaultData[collectionName]);
        setData(defaultData[collectionName]);
      } else {
        setData(storedData ? JSON.parse(storedData) : []);
      }
      setIsLoading(false);
    } catch (err) {
      setError(err);
      setIsLoading(false);
    }
  }, [collectionName]);

  // Salva i dati nel localStorage ogni volta che cambiano
  const saveData = (newData) => {
    try {
      localStorage.setItem(collectionName, JSON.stringify(newData));
      setData(newData);
    } catch (err) {
      setError(err);
    }
  };

  const addItem = async (item) => {
    try {
      const newItem = {
        ...item,
        id: Date.now().toString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      const newData = [...data, newItem];
      saveData(newData);
      return newItem;
    } catch (err) {
      setError(err);
      throw err;
    }
  };

  const updateItem = async (id, updates) => {
    try {
      const newData = data.map(item => {
        if (item.id === id) {
          return {
            ...item,
            ...updates,
            updatedAt: new Date().toISOString()
          };
        }
        return item;
      });
      saveData(newData);
    } catch (err) {
      setError(err);
      throw err;
    }
  };

  const deleteItem = async (id) => {
    try {
      const newData = data.filter(item => item.id !== id);
      saveData(newData);
    } catch (err) {
      setError(err);
      throw err;
    }
  };

  const getItem = (id) => {
    return data.find(item => item.id === id);
  };

  return {
    data,
    isLoading,
    error,
    addItem,
    updateItem,
    deleteItem,
    getItem
  };
};

export default useLocalStorage;
