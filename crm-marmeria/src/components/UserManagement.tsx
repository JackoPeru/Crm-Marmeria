import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, Save, Shield, UserCog, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';

interface ManagedUser {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'manager' | 'worker';
  permissions: string[];
  isActive: boolean;
}

interface UserForm {
  username: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: ManagedUser['role'];
  permissions: string[];
  isActive: boolean;
}

const CRUD_SECTIONS = ['clients', 'suppliers', 'projects', 'materials', 'quotes', 'invoices', 'payments', 'orders', 'calendar'];
const allCrudPermissions = CRUD_SECTIONS.flatMap((section) => [
  `${section}.view`,
  `${section}.create`,
  `${section}.edit`,
  `${section}.delete`,
]);
const ALL_PERMISSIONS = [
  'dashboard.view',
  ...allCrudPermissions,
  'settings.view', 'settings.edit',
  'users.view', 'users.create', 'users.edit', 'users.delete',
];

const permissionPreset = (role: ManagedUser['role']) => {
  if (role === 'admin') return [...ALL_PERMISSIONS];
  if (role === 'manager') {
    return [
      'dashboard.view',
      ...allCrudPermissions,
      'settings.view', 'settings.edit',
    ];
  }
  return [
    'dashboard.view',
    'projects.view', 'projects.edit',
    'materials.view', 'materials.edit',
    'orders.view', 'orders.edit',
  ];
};

const emptyForm = (): UserForm => ({
  username: '',
  email: '',
  password: '',
  firstName: '',
  lastName: '',
  role: 'worker',
  permissions: permissionPreset('worker'),
  isActive: true,
});

const permissionLabel = (permission: string) => {
  const [section, action] = permission.split('.');
  const sections: Record<string, string> = {
    dashboard: 'Dashboard',
    clients: 'Clienti',
    suppliers: 'Fornitori',
    projects: 'Progetti',
    materials: 'Materiali',
    quotes: 'Preventivi',
    invoices: 'Fatture',
    payments: 'Incassi',
    orders: 'Ordini',
    calendar: 'Calendario',
    settings: 'Impostazioni',
    users: 'Utenti',
  };
  const actions: Record<string, string> = {
    view: 'visualizza',
    create: 'crea',
    edit: 'modifica',
    delete: 'elimina',
  };
  return `${sections[section] || section}: ${actions[action] || action}`;
};

const UserManagement: React.FC = () => {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [form, setForm] = useState<UserForm>(() => emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const sortedUsers = useMemo(() => [...users].sort((a, b) => (
    `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`, 'it')
  )), [users]);

  const loadUsers = useCallback(async () => {
    try {
      const response = await apiClient.get('/users');
      setUsers(response.data || []);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Caricamento utenti non riuscito');
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setShowForm(true);
  };

  const openEdit = (user: ManagedUser) => {
    setEditingId(user.id);
    setForm({
      username: user.username,
      email: user.email,
      password: '',
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      permissions: [...(user.permissions || [])],
      isActive: user.isActive,
    });
    setShowForm(true);
  };

  const changeRole = (role: ManagedUser['role']) => {
    setForm((previous) => ({
      ...previous,
      role,
      permissions: permissionPreset(role),
    }));
  };

  const togglePermission = (permission: string) => {
    if (form.role === 'admin' && permission === 'settings.view') {
      toast.error('Un amministratore deve mantenere l’accesso alle impostazioni');
      return;
    }
    setForm((previous) => ({
      ...previous,
      permissions: previous.permissions.includes(permission)
        ? previous.permissions.filter((entry) => entry !== permission)
        : [...previous.permissions, permission],
    }));
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.username.trim() || !form.email.trim() || !form.firstName.trim() || !form.lastName.trim()) {
      toast.error('Compila tutti i campi obbligatori');
      return;
    }
    if (!editingId && form.password.length < 8) {
      toast.error('La password deve contenere almeno 8 caratteri');
      return;
    }
    if (editingId && form.password && form.password.length < 8) {
      toast.error('La nuova password deve contenere almeno 8 caratteri');
      return;
    }

    setBusy(true);
    try {
      const payload = {
        username: form.username.trim(),
        email: form.email.trim(),
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        role: form.role,
        isActive: form.isActive,
        permissions: [...new Set([...(form.role === 'admin' ? ['settings.view'] : []), ...form.permissions])],
        ...(form.password ? { password: form.password } : {}),
      };
      if (editingId) {
        await apiClient.put(`/users/${encodeURIComponent(editingId)}`, payload);
        toast.success('Utente aggiornato');
      } else {
        await apiClient.post('/users', payload);
        toast.success('Utente creato');
      }
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm());
      await loadUsers();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Salvataggio utente non riuscito');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mb-10 p-6 bg-white dark:bg-dark-card rounded-lg shadow-md">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <h3 className="text-xl font-semibold text-gray-700 dark:text-gray-200 flex items-center">
          <UserCog size={24} className="mr-3 text-cyan-500" /> Account e ruoli
        </h3>
        <div className="flex gap-2">
          <button type="button" onClick={() => void loadUsers()} disabled={busy} className="p-2 border rounded-md disabled:opacity-50" title="Aggiorna">
            <RefreshCw size={18} />
          </button>
          <button type="button" onClick={openCreate} disabled={busy} className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-400 text-white rounded-md flex items-center gap-2">
            <Plus size={18} /> Nuovo utente
          </button>
        </div>
      </div>

      <p className="text-sm text-gray-600 dark:text-gray-400 mb-5">
        I preset vengono applicati soltanto quando cambi ruolo. I permessi personalizzati esistenti non vengono più sovrascritti aprendo e salvando un account.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="px-4 py-3 text-left">Utente</th>
              <th className="px-4 py-3 text-left">Ruolo</th>
              <th className="px-4 py-3 text-left">Stato</th>
              <th className="px-4 py-3 text-right">Azioni</th>
            </tr>
          </thead>
          <tbody className="divide-y dark:divide-gray-700">
            {sortedUsers.map((user) => (
              <tr key={user.id}>
                <td className="px-4 py-3">
                  <p className="font-medium">{user.firstName} {user.lastName}</p>
                  <p className="text-xs text-gray-500">{user.username} · {user.email}</p>
                </td>
                <td className="px-4 py-3 capitalize">{user.role}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex px-2 py-1 rounded-full text-xs ${user.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
                    {user.isActive ? 'Attivo' : 'Disattivato'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button type="button" onClick={() => openEdit(user)} className="px-3 py-1.5 border rounded-md">Modifica</button>
                </td>
              </tr>
            ))}
            {!sortedUsers.length && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-500">Nessun account disponibile.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-lg bg-white dark:bg-dark-card p-6 shadow-xl">
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-xl font-semibold flex items-center gap-2">
                <Shield size={20} /> {editingId ? 'Modifica account' : 'Nuovo account'}
              </h3>
              <button type="button" onClick={() => setShowForm(false)} className="p-1 text-gray-500"><X size={22} /></button>
            </div>
            <form onSubmit={save}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="block">
                  <span className="block text-sm font-medium mb-1">Nome *</span>
                  <input value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} className="w-full p-2 border rounded-md bg-gray-50 dark:bg-gray-700" />
                </label>
                <label className="block">
                  <span className="block text-sm font-medium mb-1">Cognome *</span>
                  <input value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} className="w-full p-2 border rounded-md bg-gray-50 dark:bg-gray-700" />
                </label>
                <label className="block">
                  <span className="block text-sm font-medium mb-1">Username *</span>
                  <input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} className="w-full p-2 border rounded-md bg-gray-50 dark:bg-gray-700" />
                </label>
                <label className="block">
                  <span className="block text-sm font-medium mb-1">Email *</span>
                  <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="w-full p-2 border rounded-md bg-gray-50 dark:bg-gray-700" />
                </label>
                <label className="block">
                  <span className="block text-sm font-medium mb-1">Ruolo *</span>
                  <select value={form.role} onChange={(event) => changeRole(event.target.value as ManagedUser['role'])} className="w-full p-2 border rounded-md bg-gray-50 dark:bg-gray-700">
                    <option value="worker">Operaio</option>
                    <option value="manager">Responsabile</option>
                    <option value="admin">Amministratore</option>
                  </select>
                </label>
                <label className="block">
                  <span className="block text-sm font-medium mb-1">{editingId ? 'Nuova password (opzionale)' : 'Password *'}</span>
                  <input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} className="w-full p-2 border rounded-md bg-gray-50 dark:bg-gray-700" autoComplete="new-password" />
                </label>
              </div>

              <fieldset className="mt-5 border rounded-md p-4">
                <legend className="px-2 text-sm font-semibold">Permessi</legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {ALL_PERMISSIONS.map((permission) => (
                    <label key={permission} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.permissions.includes(permission)}
                        disabled={form.role === 'admin' && permission === 'settings.view'}
                        onChange={() => togglePermission(permission)}
                      />
                      {permissionLabel(permission)}
                    </label>
                  ))}
                </div>
              </fieldset>

              {editingId && (
                <label className="mt-4 flex items-center gap-2">
                  <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />
                  Account attivo
                </label>
              )}
              <div className="mt-6 flex justify-end gap-3">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 border rounded-md">Annulla</button>
                <button disabled={busy} className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-400 text-white rounded-md flex items-center gap-2">
                  <Save size={17} /> {busy ? 'Salvataggio...' : 'Salva'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
};

export default UserManagement;
