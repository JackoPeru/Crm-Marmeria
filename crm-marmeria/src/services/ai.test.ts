import { describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({ apiClient: { getBaseURL: () => 'http://127.0.0.1:3001/api' } }));

import { parseSseBlock } from './ai';

describe('assistente AI SSE', () => {
  it('decodifica eventi JSON senza accettare payload corrotti', () => {
    expect(parseSseBlock('data: {"type":"status","status":"routing"}')).toEqual({ type: 'status', status: 'routing' });
    expect(parseSseBlock('event: ignored\ndata: {"type":"done","ok":true}')).toEqual({ type: 'done', ok: true });
    expect(parseSseBlock('data: non-json')).toBeNull();
  });
});
