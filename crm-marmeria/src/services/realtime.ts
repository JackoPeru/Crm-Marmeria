type RealtimeStatus = 'disconnected' | 'connecting' | 'connected';

class RealtimeService {
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private shouldReconnect = false;
  private currentUrl = '';

  connect(apiBaseUrl: string, token: string | null): void {
    if (!token) {
      this.disconnect();
      return;
    }

    const websocketUrl = apiBaseUrl
      .replace(/^http:/, 'ws:')
      .replace(/^https:/, 'wss:')
      .replace(/\/api\/?$/, '/ws');
    const target = `${websocketUrl}?token=${encodeURIComponent(token)}`;

    if (
      this.socket
      && this.currentUrl === target
      && [WebSocket.CONNECTING, WebSocket.OPEN].includes(this.socket.readyState)
    ) {
      return;
    }

    this.disconnect(false);
    this.shouldReconnect = true;
    this.currentUrl = target;
    this.setStatus('connecting');

    const socket = new WebSocket(target);
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.setStatus('connected');
      socket.send('ping');
    };
    socket.onmessage = (event) => {
      if (event.data === 'pong') return;
      try {
        window.dispatchEvent(new CustomEvent('crm-realtime', {
          detail: JSON.parse(event.data),
        }));
      } catch (error) {
        console.warn('Evento realtime non valido:', error);
      }
    };
    socket.onerror = () => socket.close();
    socket.onclose = (event) => {
      if (this.socket === socket) this.socket = null;
      this.setStatus('disconnected');

      if (event.code === 4001) {
        this.shouldReconnect = false;
        localStorage.removeItem('crm_auth_token');
        localStorage.removeItem('crm_user_data');
        window.dispatchEvent(new CustomEvent('crm-auth-expired'));
        return;
      }

      if (this.shouldReconnect) {
        this.reconnectTimer = window.setTimeout(() => this.connectFromStorage(), 3000);
      }
    };
  }

  connectFromStorage(): void {
    const baseUrl = localStorage.getItem('crm_api_base_url')
      || import.meta.env.VITE_API_BASE_URL
      || 'http://127.0.0.1:3001/api';
    this.connect(baseUrl, localStorage.getItem('crm_auth_token'));
  }

  disconnect(disableReconnect = true): void {
    if (disableReconnect) this.shouldReconnect = false;
    if (this.reconnectTimer != null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;

    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    this.setStatus('disconnected');
  }

  private setStatus(status: RealtimeStatus): void {
    window.dispatchEvent(new CustomEvent('crm-realtime-status', { detail: status }));
  }
}

export const realtimeService = new RealtimeService();
