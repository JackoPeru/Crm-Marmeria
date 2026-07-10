type RealtimeStatus = 'disconnected' | 'connecting' | 'connected';

class RealtimeService {
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private shouldReconnect = false;
  private currentUrl = '';

  connect(apiBaseUrl: string, token: string | null): void {
    if (!token) { this.disconnect(); return; }
    const websocketUrl = apiBaseUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:').replace(/\/api\/?$/, '/ws');
    const target = `${websocketUrl}?token=${encodeURIComponent(token)}`;
    if (this.socket && this.currentUrl === target && this.socket.readyState <= WebSocket.OPEN) return;
    this.disconnect(false);
    this.shouldReconnect = true;
    this.currentUrl = target;
    this.setStatus('connecting');
    this.socket = new WebSocket(target);
    this.socket.onopen = () => { this.setStatus('connected'); this.socket?.send('ping'); };
    this.socket.onmessage = (event) => {
      if (event.data === 'pong') return;
      try { window.dispatchEvent(new CustomEvent('crm-realtime', { detail: JSON.parse(event.data) })); }
      catch (error) { console.warn('Evento realtime non valido:', error); }
    };
    this.socket.onerror = () => this.socket?.close();
    this.socket.onclose = () => {
      this.socket = null;
      this.setStatus('disconnected');
      if (this.shouldReconnect) this.reconnectTimer = window.setTimeout(() => this.connectFromStorage(), 3000);
    };
  }
  connectFromStorage() {
    const baseUrl = localStorage.getItem('crm_api_base_url') || import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3001/api';
    this.connect(baseUrl, localStorage.getItem('crm_auth_token'));
  }
  disconnect(disableReconnect = true) {
    if (disableReconnect) this.shouldReconnect = false;
    if (this.reconnectTimer != null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    this.setStatus('disconnected');
  }
  private setStatus(status: RealtimeStatus) {
    window.dispatchEvent(new CustomEvent('crm-realtime-status', { detail: status }));
  }
}
export const realtimeService = new RealtimeService();
