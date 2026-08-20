import React, { useEffect, useState } from 'react';
import { Check, Send, Sparkles, X } from 'lucide-react';
import aiService from '../../services/ai';

const AIAssistantPanel = ({ open, onClose }) => {
  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [liveText, setLiveText] = useState('');
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || sessionId) return undefined;
    let active = true;
    aiService.createSession().then((result) => {
      if (active) setSessionId(result.sessionId);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Assistente non disponibile');
    });
    return () => { active = false; };
  }, [open, sessionId]);

  if (!open) return null;

  const send = async () => {
    const message = draft.trim();
    if (!message || !sessionId || busy) return;
    setDraft('');
    setError('');
    setBusy(true);
    setLiveText('');
    setMessages((current) => [...current, { role: 'user', text: message }]);
    try {
      const done = await aiService.streamChat(sessionId, message, (event) => {
        if (event.type === 'confirmation') setPending(event);
        if (event.type === 'error') setError(String(event.message || 'Richiesta non eseguita'));
        if (event.type === 'text' && event.stage === 'delta') setLiveText((current) => `${current}${String(event.delta || '')}`);
        if (event.type === 'text' && event.stage === 'final') setLiveText(String(event.text || ''));
      });
      const responseText = String(done.result?.text || '');
      if (responseText) setMessages((current) => [...current, { role: 'assistant', text: responseText }]);
      if (!done.result?.confirmation) setPending(null);
      setLiveText('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Richiesta non eseguita');
      setLiveText('');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!sessionId || !pending || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await aiService.confirm(sessionId, String(pending.actionId), String(pending.operationId));
      setMessages((current) => [...current, { role: 'assistant', text: String(result.text || 'Modifica eseguita.') }]);
      setPending(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Conferma non eseguita');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!sessionId || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await aiService.cancel(sessionId, pending?.actionId);
      setMessages((current) => [...current, { role: 'assistant', text: String(result.text || 'Operazione annullata.') }]);
      setPending(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Annullamento non eseguito');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 pointer-events-none" aria-live="polite">
      <div className="absolute right-4 top-20 pointer-events-auto w-[min(92vw,26rem)] overflow-hidden rounded-2xl border border-indigo-200 bg-white shadow-2xl dark:border-indigo-900 dark:bg-gray-800">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-indigo-600 dark:text-indigo-300" />
            <div>
              <p className="font-semibold text-gray-900 dark:text-white">Assistente CRM</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Locale, con dati e permessi CRM</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Chiudi assistente" className="rounded-lg p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[50vh] min-h-40 space-y-2 overflow-y-auto p-3">
          {!messages.length && !liveText && <p className="text-sm text-gray-500 dark:text-gray-400">Chiedi, ad esempio: “Quanto deve Rossi?”</p>}
          {messages.map((message, index) => (
            <div key={`${message.role}-${index}`} className={`rounded-xl px-3 py-2 text-sm ${message.role === 'user' ? 'ml-8 bg-indigo-600 text-white' : 'mr-4 bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-100'}`}>
              {message.text}
            </div>
          ))}
          {liveText && <div className="mr-4 rounded-xl bg-gray-100 px-3 py-2 text-sm text-gray-800 dark:bg-gray-700 dark:text-gray-100">{liveText}</div>}
          {pending && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100">
              <p>{pending.summary}</p>
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={busy} onClick={confirm} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 font-medium text-white disabled:opacity-50"><Check className="h-4 w-4" />Conferma</button>
                <button type="button" disabled={busy} onClick={cancel} className="rounded-lg border border-amber-400 px-3 py-1.5 font-medium disabled:opacity-50">Annulla</button>
              </div>
            </div>
          )}
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-200">{error}</p>}
        </div>
        <form onSubmit={(event) => { event.preventDefault(); void send(); }} className="flex gap-2 border-t border-gray-200 p-3 dark:border-gray-700">
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} disabled={!sessionId || busy} rows={2} placeholder="Scrivi una richiesta..." aria-label="Richiesta assistente" className="min-w-0 flex-1 resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white" />
          <button type="submit" disabled={!sessionId || busy || !draft.trim()} aria-label="Invia richiesta" className="self-end rounded-lg bg-indigo-600 p-2 text-white disabled:opacity-50"><Send className="h-5 w-5" /></button>
        </form>
      </div>
    </div>
  );
};

export default AIAssistantPanel;
