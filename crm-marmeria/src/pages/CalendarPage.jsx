import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../hooks/useData';
import useUI from '../hooks/useUI';

const pad = (value) => String(value).padStart(2, '0');
const localDate = (value) => `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
const localInput = (value) => {
  const date = value ? new Date(value) : new Date();
  return `${localDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const emptyAppointment = (day = new Date()) => {
  const start = new Date(day);
  start.setHours(9, 0, 0, 0);
  const end = new Date(start);
  end.setHours(10, 0, 0, 0);
  return {
    title: '', startAt: localInput(start), endAt: localInput(end), customerId: '', projectId: '',
    status: 'Confermato', notes: '',
  };
};
const dateLabel = (value) => new Date(value).toLocaleString('it-IT', {
  weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
});
const modal = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
    <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl dark:bg-dark-card">
      <div className="mb-5 flex items-center justify-between gap-3"><h2 className="text-xl font-semibold">{title}</h2><button type="button" onClick={onClose} className="p-1 text-gray-500"><X size={22} /></button></div>
      {children}
    </div>
  </div>
);

const AppointmentForm = ({ value, setValue, customers, projects }) => (
  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
    <label className="md:col-span-2"><span className="mb-1 block text-sm font-medium">Titolo *</span><input required value={value.title} onChange={(event) => setValue({ ...value, title: event.target.value })} className="w-full rounded-md border p-2 dark:bg-dark-input" placeholder="Sopralluogo, appuntamento cliente..." /></label>
    <label><span className="mb-1 block text-sm font-medium">Inizio *</span><input type="datetime-local" required value={value.startAt} onChange={(event) => setValue({ ...value, startAt: event.target.value })} className="w-full rounded-md border p-2 dark:bg-dark-input" /></label>
    <label><span className="mb-1 block text-sm font-medium">Fine *</span><input type="datetime-local" required value={value.endAt} onChange={(event) => setValue({ ...value, endAt: event.target.value })} className="w-full rounded-md border p-2 dark:bg-dark-input" /></label>
    <label><span className="mb-1 block text-sm font-medium">Cliente</span><select value={value.customerId} onChange={(event) => setValue({ ...value, customerId: event.target.value })} className="w-full rounded-md border p-2 dark:bg-dark-input"><option value="">Nessun cliente</option>{customers.map((customer) => <option key={customer.id} value={String(customer.id)}>{customer.name}</option>)}</select></label>
    <label><span className="mb-1 block text-sm font-medium">Progetto</span><select value={value.projectId} onChange={(event) => setValue({ ...value, projectId: event.target.value })} className="w-full rounded-md border p-2 dark:bg-dark-input"><option value="">Nessun progetto</option>{projects.map((project) => <option key={project.id} value={String(project.id)}>{project.name}</option>)}</select></label>
    <label><span className="mb-1 block text-sm font-medium">Stato</span><select value={value.status} onChange={(event) => setValue({ ...value, status: event.target.value })} className="w-full rounded-md border p-2 dark:bg-dark-input"><option>Confermato</option><option>Da confermare</option><option>Annullato</option></select></label>
    <label className="md:col-span-2"><span className="mb-1 block text-sm font-medium">Note</span><textarea rows="4" value={value.notes} onChange={(event) => setValue({ ...value, notes: event.target.value })} className="w-full rounded-md border p-2 dark:bg-dark-input" /></label>
  </div>
);

const CalendarPage = () => {
  const { setBreadcrumbs } = useUI();
  const { hasPermission } = useAuth();
  const { customers, projects } = useData();
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [appointments, setAppointments] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(() => emptyAppointment());
  const [busy, setBusy] = useState(false);
  const canCreate = hasPermission('calendar.create');
  const canEdit = hasPermission('calendar.edit');
  const canDelete = hasPermission('calendar.delete');

  const load = async () => {
    try { setAppointments((await apiClient.get('/appointments')).data || []); } catch (error) {
      if (error.response?.status !== 403) toast.error(error.response?.data?.error || 'Caricamento calendario non riuscito');
    }
  };
  useEffect(() => { setBreadcrumbs([{ label: 'Calendario' }]); void load(); }, [setBreadcrumbs]);
  useEffect(() => {
    const listener = (event) => { if (String(event.detail?.event || '').startsWith('appointments.')) void load(); };
    window.addEventListener('crm-realtime', listener);
    return () => window.removeEventListener('crm-realtime', listener);
  }, []);

  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const gridStart = new Date(first); gridStart.setDate(first.getDate() - ((first.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, index) => { const day = new Date(gridStart); day.setDate(gridStart.getDate() + index); return day; });
  }, [month]);
  const byDay = (day) => appointments.filter((appointment) => localDate(new Date(appointment.startAt)) === localDate(day))
    .sort((left, right) => new Date(left.startAt) - new Date(right.startAt));
  const openNew = (day = new Date()) => { setEditing('new'); setForm(emptyAppointment(day)); };
  const openEdit = (appointment) => { setEditing(appointment); setForm({ ...appointment, customerId: String(appointment.customerId || ''), projectId: String(appointment.projectId || ''), startAt: localInput(appointment.startAt), endAt: localInput(appointment.endAt) }); };
  const save = async (event) => {
    event.preventDefault(); setBusy(true);
    try {
      const payload = { ...form, customerId: form.customerId || null, projectId: form.projectId || null };
      if (editing === 'new') await apiClient.post('/appointments', payload);
      else await apiClient.put(`/appointments/${editing.id}`, { ...payload, version: editing.version });
      setEditing(null); await load(); toast.success('Appuntamento salvato');
    } catch (error) { toast.error(error.response?.data?.error || 'Salvataggio appuntamento non riuscito'); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!editing || editing === 'new' || !window.confirm('Eliminare appuntamento?')) return;
    setBusy(true); try { await apiClient.delete(`/appointments/${editing.id}`, { data: { version: editing.version } }); setEditing(null); await load(); toast.success('Appuntamento eliminato'); } catch (error) { toast.error(error.response?.data?.error || 'Eliminazione non riuscita'); } finally { setBusy(false); }
  };

  return <div className="p-6 text-light-text dark:text-dark-text">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">Calendario</h1><p className="text-sm text-gray-500">Appuntamenti condivisi sul server centrale.</p></div>{canCreate && <button type="button" onClick={() => openNew()} className="flex items-center gap-2 rounded-md bg-light-primary px-4 py-2 text-white"><Plus size={18} /> Nuovo appuntamento</button>}</div>
    <div className="rounded-lg bg-white p-4 shadow-sm dark:bg-dark-card"><div className="mb-4 flex items-center justify-between"><button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded p-2 hover:bg-gray-100 dark:hover:bg-gray-800"><ChevronLeft /></button><h2 className="capitalize font-semibold">{month.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })}</h2><button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded p-2 hover:bg-gray-100 dark:hover:bg-gray-800"><ChevronRight /></button></div>
      <div className="grid grid-cols-7 border-l border-t dark:border-dark-border">{['Lun','Mar','Mer','Gio','Ven','Sab','Dom'].map((label) => <div key={label} className="border-b border-r p-2 text-center text-xs font-semibold text-gray-500 dark:border-dark-border">{label}</div>)}{days.map((day) => { const current = day.getMonth() === month.getMonth(); const today = localDate(day) === localDate(new Date()); return <div key={day.toISOString()} className={`min-h-28 border-b border-r p-2 dark:border-dark-border ${current ? '' : 'bg-gray-50 text-gray-400 dark:bg-gray-900/30'}`}><button type="button" disabled={!canCreate} onClick={() => openNew(day)} className={`mb-1 h-6 w-6 rounded-full text-xs ${today ? 'bg-light-primary text-white' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}>{day.getDate()}</button><div className="space-y-1">{byDay(day).map((appointment) => <button type="button" key={appointment.id} onClick={() => openEdit(appointment)} className={`block w-full truncate rounded px-1.5 py-1 text-left text-xs ${appointment.status === 'Annullato' ? 'bg-gray-200 text-gray-600' : appointment.status === 'Da confermare' ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-100 text-blue-800'}`} title={`${dateLabel(appointment.startAt)} · ${appointment.title}`}>{new Date(appointment.startAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })} {appointment.title}</button>)}</div></div>; })}</div>
    </div>
    {editing && modal({ title: editing === 'new' ? 'Nuovo appuntamento' : 'Appuntamento', onClose: () => setEditing(null), children: <form onSubmit={save}><AppointmentForm value={form} setValue={setForm} customers={customers} projects={projects} /><div className="mt-6 flex flex-wrap justify-end gap-3">{editing !== 'new' && canDelete && <button type="button" disabled={busy} onClick={remove} className="mr-auto flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-white"><Trash2 size={17} /> Elimina</button>}<button type="button" onClick={() => setEditing(null)} className="rounded-md border px-4 py-2">Annulla</button>{(editing === 'new' ? canCreate : canEdit) && <button disabled={busy} className="rounded-md bg-light-primary px-4 py-2 text-white">{busy ? 'Salvataggio...' : 'Salva'}</button>}</div></form> })}
  </div>;
};

export default CalendarPage;
