const dgram = require('dgram');
const os = require('os');
const crypto = require('crypto');

const DISCOVERY_PORT = 41234;
const BROADCAST_ADDRESS = '255.255.255.255';
const localAddresses = () => Object.values(os.networkInterfaces()).flat().filter((entry) => entry && entry.family === 'IPv4' && !entry.internal).map((entry) => entry.address);

class DiscoveryAdvertiser {
  constructor({ port, serverId, name = 'CRM Marmeria' }) {
    this.port = Number(port);
    this.serverId = serverId || crypto.randomUUID();
    this.name = name;
    this.socket = null;
  }
  start() {
    if (this.socket) return;
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.socket.on('message', (buffer, remote) => {
      try {
        const message = JSON.parse(buffer.toString());
        if (message.type !== 'crm-marmeria-discover') return;
        const response = Buffer.from(JSON.stringify({ type: 'crm-marmeria-master', serverId: this.serverId, name: this.name, port: this.port, hostname: os.hostname(), addresses: localAddresses() }));
        this.socket.send(response, remote.port, remote.address);
      } catch (error) { console.warn('Messaggio discovery ignorato:', error.message); }
    });
    this.socket.bind(DISCOVERY_PORT, () => this.socket.setBroadcast(true));
  }
  stop() {
    if (!this.socket) return;
    this.socket.close();
    this.socket = null;
  }
}

const discoverMasters = (timeoutMs = 1500) => new Promise((resolve) => {
  const socket = dgram.createSocket('udp4');
  const masters = new Map();
  const finish = () => { try { socket.close(); } catch {} resolve([...masters.values()]); };
  socket.on('message', (buffer, remote) => {
    try {
      const message = JSON.parse(buffer.toString());
      if (message.type !== 'crm-marmeria-master') return;
      const address = remote.address;
      masters.set(message.serverId || `${address}:${message.port}`, { ...message, address, apiUrl: `http://${address}:${message.port}/api` });
    } catch {}
  });
  socket.bind(0, () => {
    socket.setBroadcast(true);
    const request = Buffer.from(JSON.stringify({ type: 'crm-marmeria-discover' }));
    socket.send(request, DISCOVERY_PORT, BROADCAST_ADDRESS);
    for (const address of localAddresses()) {
      const parts = address.split('.');
      if (parts.length === 4) { parts[3] = '255'; socket.send(request, DISCOVERY_PORT, parts.join('.')); }
    }
  });
  setTimeout(finish, timeoutMs);
});

module.exports = { DiscoveryAdvertiser, discoverMasters, localAddresses };
