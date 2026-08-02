import React, { useEffect, useMemo, useState } from 'react';
import { CheckSquare, Edit2, Eye, Trash2, X } from 'lucide-react';
import { Pie } from 'react-chartjs-2';
import { ArcElement, Chart as ChartJS, Legend, Tooltip } from 'chart.js';
import WelcomeHeader from '../components/dashboard/WelcomeHeader';
import DashboardStats from '../components/DashboardStats';
import AttachmentsPanel from '../components/AttachmentsPanel';
import useUI from '../hooks/useUI';
import { useData } from '../hooks/useData';
import { useAuth } from '../contexts/AuthContext';
import { formatEuro, parseLocaleNumber } from '../utils/numbers';
import { createId } from '../utils/ids';
import { observeServerScope, stableServerKey } from '../utils/serverScope';
import { apiClient } from '../services/api';

ChartJS.register(ArcElement, Tooltip, Legend);

const parseDate = (value) => {
  if (!value) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
    ? new Date(`${value}T00:00:00`)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDate = (value) => parseDate(value)?.toLocaleDateString('it-IT') || '-';

const DashboardPage = () => {
  const { setBreadcrumbs } = useUI();
  const {
    customers = [],
    projects = [],
    materials = [],
    invoices = [],
    updateProject,
  } = useData();
  const { user, hasPermission } = useAuth();
  const [viewProjectId, setViewProjectId] = useState(null);
  const [notes, setNotes] = useState([]);
  const [notesReady, setNotesReady] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [editingNote, setEditingNote] = useState(null);
  const [editText, setEditText] = useState('');
  const [completingId, setCompletingId] = useState(null);
  const [notesScopeRevision, setNotesScopeRevision] = useState(0);
  const [invoiceSchedule, setInvoiceSchedule] = useState([]);
  const [remindingInvoice, setRemindingInvoice] = useState(null);

  const canViewProjects = hasPermission('projects.view');
  const canEditProjects = hasPermission('projects.edit');
  const canViewCustomers = hasPermission('clients.view');
  const canViewMaterials = hasPermission('materials.view');
  const canViewInvoices = hasPermission('invoices.view');
  const canViewFinancials = ['admin', 'manager'].includes(user?.role || '') && canViewInvoices;
  const selectedProject = projects.find((project) => String(project.id) === String(viewProjectId));
  const notesKey = useMemo(
    () => `dashboardNotes:${String(user?.id || 'anonymous')}:${stableServerKey(false)}`,
    [user?.id, notesScopeRevision],
  );

  useEffect(() => observeServerScope(() => setNotesScopeRevision((value) => value + 1)), []);

  useEffect(() => {
    setBreadcrumbs([{ label: 'Dashboard' }]);
  }, [setBreadcrumbs]);

  useEffect(() => {
    setNotesReady(false);
    try {
      const stored = JSON.parse(localStorage.getItem(notesKey) || '[]');
      setNotes(Array.isArray(stored) ? stored : []);
    } catch {
      setNotes([]);
    } finally {
      setNotesReady(true);
    }
  }, [notesKey]);

  useEffect(() => {
    if (!canViewFinancials) { setInvoiceSchedule([]); return; }
    apiClient.get('/invoices/schedule')
      .then((response) => setInvoiceSchedule(response.data || []))
      .catch(() => setInvoiceSchedule([]));
  }, [canViewFinancials, invoices]);

  useEffect(() => {
    if (notesReady) localStorage.setItem(notesKey, JSON.stringify(notes));
  }, [notes, notesKey, notesReady]);

  const monthRevenue = useMemo(() => {
    const now = new Date();
    return invoices
      .filter((invoice) => {
        const date = parseDate(invoice.date || invoice.createdAt);
        return date
          && date.getFullYear() === now.getFullYear()
          && date.getMonth() === now.getMonth();
      })
      .reduce((sum, invoice) => sum + parseLocaleNumber(invoice.total ?? invoice.amount), 0);
  }, [invoices]);

  const stats = {
    customers: customers.length,
    projects: projects.length,
    projectsInProgress: projects.filter(
      (project) => ['In Corso', 'In Lavorazione'].includes(project.status),
    ).length,
    materials: materials.length,
    revenue: formatEuro(monthRevenue),
    customersVisible: canViewCustomers,
    projectsVisible: canViewProjects,
    materialsVisible: canViewMaterials,
    revenueVisible: canViewFinancials,
  };

  const expiringProjects = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    end.setHours(23, 59, 59, 999);
    return projects
      .filter((project) => {
        if (['Completato', 'Annullato'].includes(project.status)) return false;
        const deadline = parseDate(project.deadline || project.endDate);
        return deadline && deadline >= start && deadline <= end;
      })
      .sort((a, b) => (
        parseDate(a.deadline || a.endDate).getTime()
        - parseDate(b.deadline || b.endDate).getTime()
      ));
  }, [projects]);

  const statusCounts = useMemo(() => projects.reduce((result, project) => {
    const status = project.status || 'Non specificato';
    result[status] = (result[status] || 0) + 1;
    return result;
  }, {}), [projects]);

  const pieData = {
    labels: Object.keys(statusCounts),
    datasets: [{
      label: 'Progetti',
      data: Object.values(statusCounts),
      backgroundColor: [
        'rgba(255, 99, 132, 0.7)',
        'rgba(54, 162, 235, 0.7)',
        'rgba(255, 206, 86, 0.7)',
        'rgba(75, 192, 192, 0.7)',
        'rgba(153, 102, 255, 0.7)',
        'rgba(255, 159, 64, 0.7)',
      ],
      borderWidth: 1,
    }],
  };

  const addNote = () => {
    const text = newNote.trim();
    if (!text) return;
    setNotes((current) => [
      ...current,
      { id: createId(), text, createdAt: new Date().toISOString() },
    ]);
    setNewNote('');
  };

  const saveNote = (id) => {
    const text = editText.trim();
    if (!text) return;
    setNotes((current) => current.map((note) => (
      note.id === id ? { ...note, text } : note
    )));
    setEditingNote(null);
    setEditText('');
  };

  const completeProject = async (project) => {
    if (!canEditProjects || completingId) return;
    setCompletingId(String(project.id));
    try {
      await updateProject(String(project.id), {
        status: 'Completato',
        completedAt: new Date().toISOString(),
        version: project.version,
      });
    } finally {
      setCompletingId(null);
    }
  };

  const customerName = (project) => {
    if (project.client || project.clientName) return project.client || project.clientName;
    return customers.find((customer) => String(customer.id) === String(project.clientId))?.name || '-';
  };
  const sendReminder = async (invoice) => {
    setRemindingInvoice(String(invoice.id));
    try {
      const response = await apiClient.post(`/invoices/${encodeURIComponent(invoice.id)}/whatsapp-reminder`);
      window.open(response.data.whatsappUrl, '_blank', 'noopener,noreferrer');
    } catch (error) { console.error('Bozza sollecito non creata', error); }
    finally { setRemindingInvoice(null); }
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 bg-light-bg dark:bg-dark-bg text-light-text dark:text-dark-text">
      <WelcomeHeader userName={user?.firstName || user?.username || 'Utente'} />
      <DashboardStats stats={stats} />

      {canViewFinancials && <section className="bg-white dark:bg-dark-card p-6 rounded-lg shadow-sm">
        <h2 className="text-xl font-semibold mb-1">Scadenziario incassi</h2>
        <p className="mb-4 text-sm text-gray-500">Aggiornato automaticamente da scadenze fatture e incassi registrati. WhatsApp apre solo bozza: invio manuale.</p>
        {invoiceSchedule.length ? <div className="space-y-2">{invoiceSchedule.map((invoice) => <div key={invoice.id} className={`flex flex-wrap items-center justify-between gap-3 rounded border p-3 ${invoice.kind === 'overdue' ? 'border-red-300 bg-red-50 dark:bg-red-950/30' : 'border-amber-300 bg-amber-50 dark:bg-amber-950/30'}`}><div><b>{invoice.invoiceNumber || 'Fattura senza numero'}</b><p className="text-sm">Scadenza: {invoice.dueDate} · Residuo: {formatEuro(invoice.remaining)}</p></div><button type="button" onClick={() => void sendReminder(invoice)} disabled={remindingInvoice === String(invoice.id)} className="rounded bg-green-600 px-3 py-2 text-sm text-white disabled:bg-gray-400">{remindingInvoice === String(invoice.id) ? 'Creo bozza…' : 'Prepara sollecito WhatsApp'}</button></div>)}</div> : <p className="text-gray-500">Nessuna fattura aperta o in scadenza.</p>}
      </section>}

      <section className="bg-white dark:bg-dark-card p-6 rounded-lg shadow-sm">
        <h2 className="text-xl font-semibold mb-4">Appunti rapidi personali</h2>
        <textarea
          className="w-full h-24 p-2 border rounded-md bg-light-bg dark:bg-dark-input"
          placeholder="Scrivi un nuovo appunto..."
          value={newNote}
          onChange={(event) => setNewNote(event.target.value)}
        />
        <button onClick={addNote} className="mt-2 px-4 py-2 bg-light-primary text-white rounded-md w-full">
          Aggiungi appunto
        </button>
        <div className="space-y-3 max-h-60 overflow-y-auto mt-4">
          {!notes.length && <p className="text-sm text-gray-500">Nessun appunto salvato.</p>}
          {notes.map((note) => (
            <div key={note.id} className="p-3 border rounded-md bg-light-bg/50 dark:bg-dark-input/50">
              {editingNote === note.id ? (
                <div>
                  <textarea value={editText} onChange={(event) => setEditText(event.target.value)} className="w-full p-2 border rounded-md bg-light-bg dark:bg-dark-input mb-2" />
                  <button onClick={() => saveNote(note.id)} className="px-3 py-1 bg-green-600 text-white rounded-md text-xs mr-2">Salva</button>
                  <button onClick={() => setEditingNote(null)} className="px-3 py-1 border rounded-md text-xs">Annulla</button>
                </div>
              ) : (
                <div className="flex justify-between items-start gap-2">
                  <p className="text-sm whitespace-pre-wrap break-words flex-1">{note.text}</p>
                  <div className="flex gap-2">
                    <button onClick={() => { setEditingNote(note.id); setEditText(note.text); }} className="p-1 text-yellow-600" title="Modifica"><Edit2 size={16} /></button>
                    <button onClick={() => setNotes((current) => current.filter((item) => item.id !== note.id))} className="p-1 text-red-600" title="Elimina"><Trash2 size={16} /></button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-1 bg-white dark:bg-dark-card p-6 rounded-lg shadow-sm">
          <h2 className="text-xl font-semibold mb-4">Stato progetti</h2>
          <div className="h-56">
            {projects.length ? (
              <Pie data={pieData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }} />
            ) : (
              <p className="text-gray-500">Nessun progetto disponibile.</p>
            )}
          </div>
        </section>

        <section className="lg:col-span-2 bg-white dark:bg-dark-card p-6 rounded-lg shadow-sm">
          <h2 className="text-xl font-semibold mb-4">Progetti in scadenza nei prossimi 7 giorni</h2>
          {expiringProjects.length ? (
            <ul className="space-y-4">
              {expiringProjects.map((project) => (
                <li key={project.id} className="p-4 border rounded-md hover:shadow-md transition-shadow">
                  <div className="flex flex-wrap justify-between items-center gap-3">
                    <div>
                      <p className="font-medium">{project.name || 'Progetto senza nome'}</p>
                      <p className="text-sm text-gray-500">Cliente: {customerName(project)}</p>
                      <p className="text-sm text-gray-500">Scadenza: {formatDate(project.deadline || project.endDate)}</p>
                      <p className="text-sm text-gray-500">Stato: {project.status || '-'}</p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setViewProjectId(String(project.id))} className="p-2 bg-blue-600 text-white rounded-md text-xs flex items-center gap-1"><Eye size={14} /> Vedi</button>
                      {canEditProjects && (
                        <button
                          onClick={() => void completeProject(project)}
                          disabled={completingId === String(project.id)}
                          className="p-2 bg-green-600 disabled:bg-gray-400 text-white rounded-md text-xs flex items-center gap-1"
                        >
                          <CheckSquare size={14} /> {completingId === String(project.id) ? 'Salvataggio...' : 'Completa'}
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-500">Nessun progetto in scadenza nei prossimi 7 giorni.</p>
          )}
        </section>
      </div>

      {selectedProject && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-dark-card rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-semibold">Dettagli progetto</h3>
              <button onClick={() => setViewProjectId(null)} className="p-1 text-gray-500"><X size={22} /></button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div><span className="text-gray-500">Nome</span><p className="font-medium">{selectedProject.name || '-'}</p></div>
              <div><span className="text-gray-500">Cliente</span><p>{customerName(selectedProject)}</p></div>
              <div><span className="text-gray-500">Scadenza</span><p>{formatDate(selectedProject.deadline || selectedProject.endDate)}</p></div>
              <div><span className="text-gray-500">Stato / fase</span><p>{selectedProject.status || '-'} {selectedProject.phase ? `· ${selectedProject.phase}` : ''}</p></div>
              {canViewFinancials && selectedProject.budget != null && (
                <div><span className="text-gray-500">Budget</span><p>{formatEuro(selectedProject.budget)}</p></div>
              )}
              <div className="md:col-span-2"><span className="text-gray-500">Note di produzione</span><p className="whitespace-pre-wrap">{selectedProject.productionNotes || '-'}</p></div>
            </div>
            <AttachmentsPanel entityType="project" entityId={String(selectedProject.id)} />
            <div className="mt-6 flex justify-end"><button onClick={() => setViewProjectId(null)} className="px-4 py-2 border rounded-md">Chiudi</button></div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardPage;
