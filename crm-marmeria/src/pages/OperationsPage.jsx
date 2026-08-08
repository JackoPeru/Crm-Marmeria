import React, { useCallback, useEffect, useState } from 'react';
import { ClipboardList, MessageCircle, PackageCheck, Plus, Wrench } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';
import { useData } from '../hooks/useData';
import { useAuth } from '../contexts/AuthContext';
import useUI from '../hooks/useUI';
import { formatEuro } from '../utils/numbers';

const today = () => new Date().toISOString().slice(0, 10);
const initialOrder = { title: '', supplier: '', supplierId: '', date: today(), projectId: '', status: 'Bozza', amount: '', notes: '' };
const initialDdt = { title: '', supplier: '', supplierId: '', date: today(), clientId: '', projectId: '', status: 'Bozza', notes: '' };
const initialService = { title: '', date: today(), clientId: '', projectId: '', status: 'Aperta', warrantyUntil: '', notes: '' };

const OperationsPage = () => {
  const { setBreadcrumbs } = useUI();
  const { customers = [], projects = [] } = useData();
  const { hasPermission } = useAuth();
  const [orders, setOrders] = useState([]);
  const [ddts, setDdts] = useState([]);
  const [services, setServices] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [order, setOrder] = useState(initialOrder);
  const [ddt, setDdt] = useState(initialDdt);
  const [service, setService] = useState(initialService);
  const [whatsapp, setWhatsapp] = useState({ clientId: '', title: 'Messaggio cliente', message: '' });
  const [busy, setBusy] = useState(false);
  const [whatsappUrl, setWhatsappUrl] = useState('');
  const canViewOrders = hasPermission('orders.view');
  const canViewServices = hasPermission('projects.view');
  const canViewSuppliers = hasPermission('suppliers.view');
  const canViewClients = hasPermission('clients.view');
  const canCreateOrders = hasPermission('orders.create');
  const canCreateServices = hasPermission('projects.create');
  const canCreateMessages = hasPermission('clients.create');

  const load = useCallback(async () => {
    const resources = [
      { enabled: canViewOrders, route: '/purchase-orders', set: setOrders },
      { enabled: canViewOrders, route: '/delivery-notes', set: setDdts },
      { enabled: canViewServices, route: '/service-cases', set: setServices },
      { enabled: canViewSuppliers, route: '/suppliers', set: setSuppliers },
    ];
    const results = await Promise.allSettled(resources.map(async (resource) => {
      if (!resource.enabled) {
        resource.set([]);
        return;
      }
      const response = await apiClient.get(resource.route);
      resource.set(response.data || []);
    }));
    if (results.some((result) => result.status === 'rejected')) {
      toast.error('Parte delle operazioni non è stata caricata');
    }
  }, [canViewOrders, canViewServices, canViewSuppliers]);

  useEffect(() => {
    setBreadcrumbs([{ label: 'Operazioni' }]);
    void load();
  }, [load, setBreadcrumbs]);

  const create = async (route, payload, reset) => {
    setBusy(true);
    try {
      await apiClient.post(route, payload);
      toast.success('Salvato');
      reset();
      await load();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Salvataggio non riuscito');
    } finally {
      setBusy(false);
    }
  };

  const createWhatsapp = async (event) => {
    event.preventDefault();
    setBusy(true);
    setWhatsappUrl('');
    try {
      const response = await apiClient.post('/communications/whatsapp-draft', whatsapp);
      setWhatsappUrl(response.data.whatsappUrl);
      toast.success('Bozza salvata. Invio ancora manuale.');
      await load();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Bozza WhatsApp non creata');
    } finally {
      setBusy(false);
    }
  };

  const projectName = (id) => projects.find((item) => String(item.id) === String(id))?.name || '—';
  const clientName = (id) => customers.find((item) => String(item.id) === String(id))?.name || '—';
  const supplierName = (id) => suppliers.find((item) => String(item.id) === String(id))?.name || '';
  const setOrderSupplier = (value) => setOrder(canViewSuppliers
    ? { ...order, supplierId: value, supplier: supplierName(value) }
    : { ...order, supplierId: '', supplier: value });
  const setDdtSupplier = (value) => setDdt(canViewSuppliers
    ? { ...ddt, supplierId: value, supplier: supplierName(value) }
    : { ...ddt, supplierId: '', supplier: value });
  const projectSelect = (value, setValue) => (
    <label className="text-sm">Progetto
      <select value={value.projectId} onChange={(event) => setValue({ ...value, projectId: event.target.value })} className="mt-1 w-full rounded border p-2 dark:bg-dark-input">
        <option value="">Nessuno</option>
        {projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </label>
  );
  const clientSelect = (value, setValue) => (
    <label className="text-sm">Cliente
      <select required value={value.clientId} onChange={(event) => setValue({ ...value, clientId: event.target.value })} className="mt-1 w-full rounded border p-2 dark:bg-dark-input">
        <option value="">Seleziona</option>
        {[...customers].sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'it', { sensitivity: 'base' })).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </label>
  );
  const supplierField = (value, setValue, required = false) => canViewSuppliers ? (
    <select required={required} value={value.supplierId} onChange={(event) => setValue(event.target.value)} className="rounded border p-2 dark:bg-dark-input">
      <option value="">{required ? 'Fornitore' : 'Fornitore opzionale'}</option>
      {[...suppliers].sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'it', { sensitivity: 'base' })).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select>
  ) : (
    <input required={required} placeholder={required ? 'Fornitore' : 'Fornitore opzionale'} value={value.supplier} onChange={(event) => setValue(event.target.value)} className="rounded border p-2 dark:bg-dark-input" />
  );

  return <div className="space-y-6 p-6 bg-light-bg dark:bg-dark-bg text-light-text dark:text-dark-text">
    <h1 className="text-2xl font-semibold">Operazioni</h1>
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      {canViewOrders && <section className="rounded-lg bg-white p-5 shadow-sm dark:bg-dark-card">
        <h2 className="mb-4 flex gap-2 font-semibold"><ClipboardList /> Ordini fornitori</h2>
        {canCreateOrders && <form onSubmit={(event) => { event.preventDefault(); void create('/purchase-orders', order, () => setOrder(initialOrder)); }} className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <input required placeholder="Materiale / ordine" value={order.title} onChange={(event) => setOrder({ ...order, title: event.target.value })} className="rounded border p-2 dark:bg-dark-input" />
          {supplierField(order, setOrderSupplier, true)}
          <input required type="date" value={order.date} onChange={(event) => setOrder({ ...order, date: event.target.value })} className="rounded border p-2 dark:bg-dark-input" />
          <input type="number" min="0" step="0.01" placeholder="Importo ordine (€)" value={order.amount} onChange={(event) => setOrder({ ...order, amount: event.target.value })} className="rounded border p-2 dark:bg-dark-input" />
          <select value={order.status} onChange={(event) => setOrder({ ...order, status: event.target.value })} className="rounded border p-2 dark:bg-dark-input"><option>Bozza</option><option>Inviato</option><option>Confermato</option><option>Ricevuto</option></select>
          {projectSelect(order, setOrder)}
          <textarea placeholder="Note" value={order.notes} onChange={(event) => setOrder({ ...order, notes: event.target.value })} className="rounded border p-2 dark:bg-dark-input" />
          <button disabled={busy} className="rounded bg-light-primary px-3 py-2 text-white"><Plus size={16} className="inline" /> Crea ordine</button>
        </form>}
        <ul className="mt-4 space-y-2 text-sm">{orders.map((item) => <li key={item.id} className="rounded border p-2"><b>{item.title}</b> · {item.supplier} · {item.status} · {projectName(item.projectId)}{Number(item.amount || 0) > 0 ? ` · ${formatEuro(item.amount)}` : ''}</li>)}{!orders.length && <li className="text-gray-500">Nessun ordine.</li>}</ul>
      </section>}
      {canViewOrders && <section className="rounded-lg bg-white p-5 shadow-sm dark:bg-dark-card">
        <h2 className="mb-4 flex gap-2 font-semibold"><PackageCheck /> DDT</h2>
        {canCreateOrders && <form onSubmit={(event) => { event.preventDefault(); void create('/delivery-notes', ddt, () => setDdt(initialDdt)); }} className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <input required placeholder="Causale / DDT" value={ddt.title} onChange={(event) => setDdt({ ...ddt, title: event.target.value })} className="rounded border p-2 dark:bg-dark-input" />
          <input required type="date" value={ddt.date} onChange={(event) => setDdt({ ...ddt, date: event.target.value })} className="rounded border p-2 dark:bg-dark-input" />
          <select value={ddt.status} onChange={(event) => setDdt({ ...ddt, status: event.target.value })} className="rounded border p-2 dark:bg-dark-input"><option>Bozza</option><option>Emesso</option><option>Consegnato</option></select>
          {supplierField(ddt, setDdtSupplier)}
          {canViewClients && clientSelect(ddt, setDdt)}
          {projectSelect(ddt, setDdt)}
          <textarea placeholder="Note" value={ddt.notes} onChange={(event) => setDdt({ ...ddt, notes: event.target.value })} className="rounded border p-2 dark:bg-dark-input" />
          <button disabled={busy} className="rounded bg-light-primary px-3 py-2 text-white"><Plus size={16} className="inline" /> Crea DDT</button>
        </form>}
        <ul className="mt-4 space-y-2 text-sm">{ddts.map((item) => <li key={item.id} className="rounded border p-2"><b>{item.title}</b> · {item.date} · {item.status} · {clientName(item.clientId)}</li>)}{!ddts.length && <li className="text-gray-500">Nessun DDT.</li>}</ul>
      </section>}
      {canViewServices && <section className="rounded-lg bg-white p-5 shadow-sm dark:bg-dark-card">
        <h2 className="mb-4 flex gap-2 font-semibold"><Wrench /> Garanzie e assistenze</h2>
        {canCreateServices && <form onSubmit={(event) => { event.preventDefault(); void create('/service-cases', service, () => setService(initialService)); }} className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <input required placeholder="Intervento / garanzia" value={service.title} onChange={(event) => setService({ ...service, title: event.target.value })} className="rounded border p-2 dark:bg-dark-input" />
          <input required type="date" value={service.date} onChange={(event) => setService({ ...service, date: event.target.value })} className="rounded border p-2 dark:bg-dark-input" />
          <select value={service.status} onChange={(event) => setService({ ...service, status: event.target.value })} className="rounded border p-2 dark:bg-dark-input"><option>Aperta</option><option>In lavorazione</option><option>Chiusa</option></select>
          <label className="text-sm">Scadenza garanzia<input type="date" value={service.warrantyUntil} onChange={(event) => setService({ ...service, warrantyUntil: event.target.value })} className="mt-1 w-full rounded border p-2 dark:bg-dark-input" /></label>
          {canViewClients && clientSelect(service, setService)}
          {projectSelect(service, setService)}
          <textarea placeholder="Note" value={service.notes} onChange={(event) => setService({ ...service, notes: event.target.value })} className="rounded border p-2 dark:bg-dark-input" />
          <button disabled={busy} className="rounded bg-light-primary px-3 py-2 text-white"><Plus size={16} className="inline" /> Apri assistenza</button>
        </form>}
        <ul className="mt-4 space-y-2 text-sm">{services.map((item) => <li key={item.id} className="rounded border p-2"><b>{item.title}</b> · {item.status} · {clientName(item.clientId)} · garanzia: {item.warrantyUntil || '—'}</li>)}{!services.length && <li className="text-gray-500">Nessuna assistenza.</li>}</ul>
      </section>}
      {canViewClients && canCreateMessages && <section className="rounded-lg bg-white p-5 shadow-sm dark:bg-dark-card">
        <h2 className="mb-4 flex gap-2 font-semibold"><MessageCircle /> Bozza WhatsApp</h2>
        <p className="mb-3 text-sm text-gray-500">Crea bozza, poi apri WhatsApp e invia tu. Nessun invio automatico.</p>
        <form onSubmit={createWhatsapp} className="space-y-3"><select required value={whatsapp.clientId} onChange={(event) => setWhatsapp({ ...whatsapp, clientId: event.target.value })} className="w-full rounded border p-2 dark:bg-dark-input"><option value="">Cliente</option>{[...customers].sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'it', { sensitivity: 'base' })).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><input value={whatsapp.title} onChange={(event) => setWhatsapp({ ...whatsapp, title: event.target.value })} className="w-full rounded border p-2 dark:bg-dark-input" /><textarea required rows="5" placeholder="Messaggio" value={whatsapp.message} onChange={(event) => setWhatsapp({ ...whatsapp, message: event.target.value })} className="w-full rounded border p-2 dark:bg-dark-input" /><button disabled={busy} className="rounded bg-green-600 px-3 py-2 text-white">Crea bozza</button></form>
        {whatsappUrl && <a href={whatsappUrl} target="_blank" rel="noreferrer" className="mt-4 inline-block rounded border border-green-700 px-3 py-2 text-green-700">Apri WhatsApp per confermare invio</a>}
      </section>}
    </div>
  </div>;
};

export default OperationsPage;
