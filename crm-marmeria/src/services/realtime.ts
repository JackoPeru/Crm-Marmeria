type RealtimeStatus = 'disconnected' | 'connecting' | 'connected';

class RealtimeService {
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private authenticationTimer: number | null = null;
  private shouldReconnect = false;
  private reconnectAttempts = 0;
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

    const hasActiveSocket = this.socket
      && (this.socket.readyState === WebSocket.CONNECTING
        || this.socket.readyState === WebSocket.OPEN);
    if (hasActiveSocket && this.currentUrl === websocketUrl) return;

    this.disconnect(false);
    this.shouldReconnect = true;
    this.currentUrl = websocketUrl;
    this.setStatus('connecting');

    const socket = new WebSocket(websocketUrl);
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      socket.send(JSON.stringify({ type: 'auth', token }));
      this.authenticationTimer = window.setTimeout(() => {
        if (this.socket === socket && socket.readyState === WebSocket.OPEN) {
          socket.close(4001, 'Timeout autenticazione');
        }
      }, 6000);
    };
    socket.onmessage = (event) => {
      if (event.data === 'pong') return;
      try {
        const payload = JSON.parse(String(event.data));
        if (payload.event === 'connected') {
          if (this.authenticationTimer != null) window.clearTimeout(this.authenticationTimer);
          this.authenticationTimer = null;
          this.reconnectAttempts = 0;
          this.setStatus('connected');
          this.startHeartbeat(socket);
          return;
        }
        window.dispatchEvent(new CustomEvent('crm-realtime', { detail: payload }));
      } catch (error) {
        console.warn('Evento realtime non valido:', error);
      }
    };
    socket.onerror = () => socket.close();
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.clearSocketTimers();
      this.socket = null;
      this.setStatus('disconnected');

      if (event.code === 4001) {
        this.shouldReconnect = false;
        localStorage.removeItem('crm_auth_token');
        localStorage.removeItem('crm_user_data');
        window.dispatchEvent(new CustomEvent('crm-auth-expired'));
        return;
      }

      if (this.shouldReconnect && navigator.onLine) this.scheduleReconnect();
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
    this.reconnectAttempts = 0;
    this.clearSocketTimers();

    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) {
      socket.onclose = null;
      socket.close();
    }
    this.setStatus('disconnected');
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer != null || this.reconnectAttempts >= 10) return;
    const delay = Math.min(30000, 1500 * (2 ** this.reconnectAttempts));
    this.reconnectAttempts += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connectFromStorage();
    }, delay);
  }

  private startHeartbeat(socket: WebSocket): void {
    if (this.heartbeatTimer != null) window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = window.setInterval(() => {
      if (this.socket === socket && socket.readyState === WebSocket.OPEN) socket.send('ping');
    }, 25000);
  }

  private clearSocketTimers(): void {
    if (this.heartbeatTimer != null) window.clearInterval(this.heartbeatTimer);
    if (this.authenticationTimer != null) window.clearTimeout(this.authenticationTimer);
    this.heartbeatTimer = null;
    this.authenticationTimer = null;
  }

  private setStatus(status: RealtimeStatus): void {
    window.dispatchEvent(new CustomEvent('crm-realtime-status', { detail: status }));
  }
}

export const realtimeService = new RealtimeService();
