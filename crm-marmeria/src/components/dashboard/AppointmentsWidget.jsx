import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { apiClient } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import useUI from '../../hooks/useUI';
import { nextLocalMidnightDelay, todayAndTomorrow } from './appointmentUtils';

const AppointmentsWidget = ({ customers = [], projects = [] }) => {
  const { hasPermission } = useAuth();
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const canView = hasPermission('calendar.view');
  const { updatePreferences } = useUI();
  const load = async () => {
    if (!canView) return;
    try { setAppointments((await apiClient.get('/appointments')).data || []); }
    catch (error) { if (error.response?.status !== 403) console.error('Caricamento appuntamenti dashboard fallito', error); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [canView]);
  useEffect(() => {
    const timer = window.setTimeout(() => setNow(new Date()), nextLocalMidnightDelay(now));
    return () => window.clearTimeout(timer);
  }, [now]);
  useEffect(() => {
    const listener = (event) => { if (String(event.detail?.event || '').startsWith('appointments.')) void load(); };
    window.addEventListener('crm-realtime', listener);
    return () => window.removeEventListener('crm-realtime', listener);
  }, [canView]);
  const groups = useMemo(() => todayAndTomorrow(appointments, now), [appointments, now]);
  const customerName = (appointment) => customers.find((item) => String(item.id) === String(appointment.customerId))?.name || '';
  const projectName = (appointment) => projects.find((item) => String(item.id) === String(appointment.projectId))?.name || '';
  if (!canView) return null;
  const day = (title, items) => <div><h3 className="mb-2 text-sm font-semibold">{title}</h3>{items.length ? <div className="space-y-2">{items.map((appointment) => <button type="button" key={appointment.id} onClick={() => updatePreferences({ currentPage: 'calendar' })} className={`block w-full rounded border p-3 text-left text-sm hover:bg-light-bg dark:hover:bg-dark-input ${appointment.status === 'Annullato' ? 'opacity-50' : ''}`}><div className="flex items-start justify-between gap-3"><b>{new Date(appointment.startAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })} · {appointment.title}</b><span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800">{appointment.status || 'Confermato'}</span></div>{(customerName(appointment) || projectName(appointment)) && <p className="mt-1 truncate text-gray-500">{[customerName(appointment), projectName(appointment)].filter(Boolean).join(' · ')}</p>}{appointment.notes && <p className="mt-1 line-clamp-2 text-xs text-gray-600">{appointment.notes}</p>}</button>)}</div> : <p className="text-sm text-gray-500">Nessun appuntamento.</p>}</div>;
  return <section className="rounded-lg bg-white p-6 shadow-sm dark:bg-dark-card"><div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-xl font-semibold"><CalendarDays size={21} /> Appuntamenti</h2><p className="text-sm text-gray-500">Agenda condivisa: oggi e domani.</p></div><button type="button" onClick={() => updatePreferences({ currentPage: 'calendar' })} className="text-sm text-light-primary">Apri calendario</button></div>{loading ? <p className="text-sm text-gray-500">Caricamento...</p> : <div className="grid grid-cols-1 gap-5 md:grid-cols-2">{day('Oggi', groups.today)}{day('Domani', groups.tomorrow)}</div>}</section>;
};

export default AppointmentsWidget;
