import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Eye, EyeOff, Lock, LogIn, RefreshCw, Server, User } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { apiClient } from '../../services/api';

interface LoginFormData {
  username: string;
  password: string;
  confirmPassword: string;
  email: string;
  firstName: string;
  lastName: string;
}

const emptyForm: LoginFormData = {
  username: '',
  password: '',
  confirmPassword: '',
  email: '',
  firstName: '',
  lastName: '',
};

const LoginForm: React.FC = () => {
  const { login, isLoading } = useAuth();
  const [formData, setFormData] = useState<LoginFormData>(emptyForm);
  const [showPassword, setShowPassword] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [setupAllowedHere, setSetupAllowedHere] = useState(false);
  const [checkingServer, setCheckingServer] = useState(true);
  const [serverReachable, setServerReachable] = useState(true);
  const [defaultAdmin, setDefaultAdmin] = useState<{ username: string; password: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState('');

  const checkServer = useCallback(async () => {
    setCheckingServer(true);
    try {
      const response = await apiClient.get('/health', { timeout: 5000 });
      const requiresSetup = Boolean(response.data?.setupRequired);
      let localSetup = false;
      if (requiresSetup && window.electronAPI?.network) {
        const [preferences, status] = await Promise.all([
          window.electronAPI.network.getPreferences(),
          window.electronAPI.network.getServerStatus(),
        ]);
        localSetup = Boolean(
          preferences.success
          && preferences.prefs?.mode === 'master'
          && status?.isRunning
          && status?.serverId
          && String(status.serverId) === String(response.data?.serverId),
        );
      }
      setSetupRequired(requiresSetup);
      setSetupAllowedHere(localSetup);
      setDefaultAdmin(response.data?.defaultAdmin || null);
      setServerReachable(true);
    } catch {
      setServerReachable(false);
      setSetupAllowedHere(false);
      setDefaultAdmin(null);
    } finally {
      setCheckingServer(false);
    }
  }, []);

  useEffect(() => {
    void checkServer();
    const interval = window.setInterval(() => void checkServer(), 5000);
    return () => window.clearInterval(interval);
  }, [checkServer]);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    setFormData((previous) => ({ ...previous, [name]: value }));
    if (submitError) setSubmitError('');
    if (errors[name]) setErrors((previous) => ({ ...previous, [name]: '' }));
  };

  const validate = () => {
    const next: Record<string, string> = {};
    if (!formData.username.trim()) next.username = 'Username richiesto';
    if (!formData.password) next.password = 'Password richiesta';

    if (setupRequired && setupAllowedHere) {
      if (formData.password.length < 10) next.password = 'Usa almeno 10 caratteri';
      if (formData.confirmPassword !== formData.password) {
        next.confirmPassword = 'Le password non coincidono';
      }
      if (!formData.firstName.trim()) next.firstName = 'Nome richiesto';
      if (!formData.lastName.trim()) next.lastName = 'Cognome richiesto';
      if (!formData.email.trim()) next.email = 'Email richiesta';
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (setupRequired && !setupAllowedHere) return;
    if (!validate()) return;
    setSubmitError('');

    try {
      await login({
        username: formData.username.trim(),
        password: formData.password,
        ...(setupRequired && setupAllowedHere
          ? {
            email: formData.email.trim(),
            firstName: formData.firstName.trim(),
            lastName: formData.lastName.trim(),
          }
          : {}),
      });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Accesso non riuscito');
    }
  };

  const setupMode = setupRequired && setupAllowedHere;
  const fieldClass = (name: string) => `block w-full px-3 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors ${
    errors[name]
      ? 'border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-600'
      : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700'
  } text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400`;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 p-6">
      <div className="max-w-md w-full">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-8">
          <div className="text-center mb-7">
            <div className="mx-auto h-16 w-16 bg-blue-600 rounded-full flex items-center justify-center mb-4">
              {setupRequired ? <Server className="h-8 w-8 text-white" /> : <LogIn className="h-8 w-8 text-white" />}
            </div>
            <h2 className="text-3xl font-bold text-gray-900 dark:text-white">CRM Marmeria</h2>
            <p className="mt-2 text-gray-600 dark:text-gray-400">
              {setupMode ? 'Crea il primo amministratore sul PC principale' : 'Accedi al tuo account'}
            </p>
          </div>

          {!checkingServer && !serverReachable && (
            <div className="mb-5 p-3 rounded-lg bg-orange-50 text-orange-800 border border-orange-200 text-sm dark:bg-orange-900/20 dark:text-orange-200 dark:border-orange-800">
              <div className="flex items-start gap-2">
                <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                <span>Il server centrale non risponde. Verifica che il PC principale sia acceso e che l'indirizzo configurato sia corretto.</span>
              </div>
              <button type="button" onClick={() => void checkServer()} className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 border rounded-md">
                <RefreshCw size={15} /> Riprova
              </button>
            </div>
          )}

          {setupMode && (
            <div className="mb-5 p-3 rounded-lg bg-blue-50 text-blue-800 border border-blue-200 text-sm dark:bg-blue-900/20 dark:text-blue-200 dark:border-blue-800">
              La configurazione iniziale è autorizzata soltanto dall'app desktop che ospita il database. Non esistono credenziali predefinite.
            </div>
          )}

          {setupRequired && !setupAllowedHere && serverReachable && (
            <div className="mb-5 p-3 rounded-lg bg-orange-50 text-orange-800 border border-orange-200 text-sm dark:bg-orange-900/20 dark:text-orange-200 dark:border-orange-800">
              Il database non ha ancora un amministratore. Completa la configurazione direttamente sul PC principale, poi premi “Riprova”.
              <button type="button" onClick={() => void checkServer()} className="mt-3 flex items-center gap-2 px-3 py-1.5 border rounded-md">
                <RefreshCw size={15} /> Riprova
              </button>
            </div>
          )}

          {defaultAdmin && (
            <div className="mb-5 p-3 rounded-lg bg-yellow-50 text-yellow-900 border border-yellow-300 text-sm dark:bg-yellow-900/20 dark:text-yellow-100 dark:border-yellow-700">
              <strong>Accesso base:</strong> username <code>{defaultAdmin.username}</code> — password <code>{defaultAdmin.password}</code>
            </div>
          )}

          {submitError && (
            <div className="mb-5 p-3 rounded-lg bg-red-50 text-red-800 border border-red-200 text-sm dark:bg-red-900/20 dark:text-red-200 dark:border-red-800" role="alert">
              {submitError}
            </div>
          )}

          <form onSubmit={submit} className="space-y-4">
            {setupMode && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block">
                  <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome</span>
                  <input name="firstName" value={formData.firstName} onChange={handleChange} disabled={isLoading} className={fieldClass('firstName')} />
                  {errors.firstName && <p className="mt-1 text-sm text-red-600">{errors.firstName}</p>}
                </label>
                <label className="block">
                  <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cognome</span>
                  <input name="lastName" value={formData.lastName} onChange={handleChange} disabled={isLoading} className={fieldClass('lastName')} />
                  {errors.lastName && <p className="mt-1 text-sm text-red-600">{errors.lastName}</p>}
                </label>
              </div>
            )}

            <label className="block">
              <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Username</span>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                <input name="username" value={formData.username} onChange={handleChange} disabled={isLoading || (setupRequired && !setupAllowedHere)} autoComplete="username" className={`${fieldClass('username')} pl-10`} />
              </div>
              {errors.username && <p className="mt-1 text-sm text-red-600">{errors.username}</p>}
            </label>

            {setupMode && (
              <label className="block">
                <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</span>
                <input type="email" name="email" value={formData.email} onChange={handleChange} disabled={isLoading} className={fieldClass('email')} />
                {errors.email && <p className="mt-1 text-sm text-red-600">{errors.email}</p>}
              </label>
            )}

            <label className="block">
              <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password</span>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                <input
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={handleChange}
                  disabled={isLoading || (setupRequired && !setupAllowedHere)}
                  autoComplete={setupMode ? 'new-password' : 'current-password'}
                  className={`${fieldClass('password')} pl-10 pr-12`}
                />
                <button type="button" onClick={() => setShowPassword((value) => !value)} disabled={isLoading} className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400">
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
              {errors.password && <p className="mt-1 text-sm text-red-600">{errors.password}</p>}
            </label>

            {setupMode && (
              <label className="block">
                <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Conferma password</span>
                <input name="confirmPassword" type={showPassword ? 'text' : 'password'} value={formData.confirmPassword} onChange={handleChange} disabled={isLoading} autoComplete="new-password" className={fieldClass('confirmPassword')} />
                {errors.confirmPassword && <p className="mt-1 text-sm text-red-600">{errors.confirmPassword}</p>}
              </label>
            )}

            <button type="submit" disabled={isLoading || checkingServer || !serverReachable || (setupRequired && !setupAllowedHere)} className="w-full flex justify-center items-center py-3 px-4 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
              {isLoading ? 'Operazione in corso...' : setupMode ? 'Crea amministratore' : 'Accedi'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default LoginForm;
