import { createId } from '../utils/ids';
import { apiClient } from './api';

export type AiEvent = {
  type: 'status' | 'tool' | 'confirmation' | 'text' | 'error' | 'done';
  [key: string]: unknown;
};

export type AiSessionState = {
  sessionId: string;
  currentEntityIds: Record<string, string>;
  disambiguationCandidates: unknown[];
  pendingConfirmation: {
    actionId: string;
    operationId: string;
    summary: string;
    expiresAt: string;
  } | null;
  recentTurns: Array<{ role: string; content: string }>;
  lastMetrics: Record<string, unknown> | null;
};

export type AiSessionResponse = { ok: true; sessionId: string; state: AiSessionState };
export type AiDone = AiEvent & { type: 'done'; ok: boolean; operationId?: string };

const authHeaders = (): Record<string, string> => {
  const token = localStorage.getItem('crm_auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const errorFromResponse = async (response: Response): Promise<Error> => {
  let body: any = null;
  try { body = await response.json(); } catch { /* risposta non JSON */ }
  return new Error(body?.message || body?.error || `Richiesta assistente fallita (${response.status})`);
};

export const parseSseBlock = (block: string): AiEvent | null => {
  const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
  if (!data) return null;
  try { return JSON.parse(data) as AiEvent; } catch { return null; }
};

export const aiService = {
  async createSession(): Promise<AiSessionResponse> {
    const response = await fetch(`${apiClient.getBaseURL()}/ai/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: '{}' });
    if (!response.ok) throw await errorFromResponse(response);
    return response.json();
  },

  async getSession(sessionId: string): Promise<{ ok: true; state: AiSessionState }> {
    const response = await fetch(`${apiClient.getBaseURL()}/ai/sessions/${encodeURIComponent(sessionId)}`, { headers: authHeaders() });
    if (!response.ok) throw await errorFromResponse(response);
    return response.json();
  },

  async streamChat(sessionId: string, message: string, onEvent: (event: AiEvent) => void, operationId = createId()): Promise<AiDone> {
    const response = await fetch(`${apiClient.getBaseURL()}/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', 'X-Operation-Id': operationId, ...authHeaders() },
      body: JSON.stringify({ sessionId, message, operationId }),
    });
    if (!response.ok) throw await errorFromResponse(response);
    if (!response.body) throw new Error('Risposta streaming non disponibile');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done: AiDone | null = null;
    const consume = (chunk: string) => {
      buffer += chunk;
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || '';
      blocks.forEach((block) => {
        const event = parseSseBlock(block);
        if (!event) return;
        onEvent(event);
        if (event.type === 'done') done = event as AiDone;
      });
    };
    while (true) {
      const next = await reader.read();
      consume(decoder.decode(next.value || new Uint8Array(), { stream: !next.done }));
      if (next.done) break;
    }
    if (buffer.trim()) {
      const event = parseSseBlock(buffer);
      if (event) { onEvent(event); if (event.type === 'done') done = event as AiDone; }
    }
    if (!done) throw new Error('Streaming assistente terminato senza evento finale');
    return done;
  },

  async confirm(sessionId: string, actionId: string, operationId: string): Promise<any> {
    const response = await fetch(`${apiClient.getBaseURL()}/ai/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ sessionId, actionId, operationId }) });
    if (!response.ok) throw await errorFromResponse(response);
    return response.json();
  },

  async cancel(sessionId: string, actionId?: string): Promise<any> {
    const response = await fetch(`${apiClient.getBaseURL()}/ai/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ sessionId, actionId }) });
    if (!response.ok) throw await errorFromResponse(response);
    return response.json();
  },
};

export default aiService;
