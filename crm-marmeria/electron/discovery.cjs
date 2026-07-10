const dgram = require('dgram');
const os = require('os');
const crypto = require('crypto');

const DISCOVERY_PORT = 41234;
const BROADCAST_ADDRESS = '255.255.255.255';

const localAddresses = () => Object.values(os.networkInterfaces())
  .flat()
  .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
  .map((entry) => entry.address);

class DiscoveryAdvertiser {
  constructor({ port, serverId, name = 'CRM Marmeria' }) {
    this.port = Number(port);
    this.serverId = serverId || crypto.randomUUID();
    this.name = name;
    this.socket = null;
  }

  start() {
    if (this.socket) return;
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.socket = socket;

    socket.on('error', (error) => {
      console.warn('Discovery LAN non disponibile:', error.message);
      try {
        socket.close();
      } catch {
        // Il socket potrebbe essere già chiuso.
      }
      if (this.socket === socket) this.socket = null;
    });

    socket.on('message', (buffer, remote) => {
      try {
        const message = JSON.parse(buffer.toString());
        if (message.type !== 'crm-marmeria-discover') return;
        const response = Buffer.from(JSON.stringify({
          type: 'crm-marmeria-master',
          serverId: this.serverId,
          name: this.name,
          port: this.port,
          hostname: os.hostname(),
          addresses: localAddresses(),
        }));
        socket.send(response, remote.port, remote.address, (error) => {
          if (error) console.warn('Risposta discovery non inviata:', error.message);
        });
      } catch (error) {
        console.warn('Messaggio discovery ignorato:', error.message);
      }
    });

    socket.bind(DISCOVERY_PORT, () => {
      try {
        socket.setBroadcast(true);
      } catch (error) {
        console.warn('Broadcast discovery non disponibile:', error.message);
      }
    });
  }

  stop() {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    try {
      socket.close();
    } catch {
      // Il socket potrebbe essere già chiuso da un errore di rete.
    }
  }
}

const discoverMasters = (timeoutMs = 1500) => new Promise((resolve) => {
  const socket = dgram.createSocket('udp4');
  const masters = new Map();
  let settled = false;

  const finish = () => {
    if (settled) return;
    settled = true;
    try {
      socket.close();
    } catch {
      // Il socket potrebbe non essere stato aperto.
    }
    resolve([...masters.values()]);
  };

  socket.on('error', (error) => {
    console.warn('Ricerca server LAN non disponibile:', error.message);
    finish();
  });

  socket.on('message', (buffer, remote) => {
    try {
      const message = JSON.parse(buffer.toString());
      const port = Number(message.port);
      if (
        message.type !== 'crm-marmeria-master'
        || !Number.isInteger(port)
        || port < 1
        || port > 65535
      ) {
        return;
      }
      const address = remote.address;
      masters.set(message.serverId || `${address}:${port}`, {
        ...message,
        port,
        address,
        apiUrl: `http://${address}:${port}/api`,
      });
    } catch {
      // I pacchetti non validi vengono ignorati.
    }
  });

  socket.bind(0, () => {
    try {
      socket.setBroadcast(true);
    } catch (error) {
      console.warn('Broadcast ricerca server non disponibile:', error.message);
      finish();
      return;
    }

    const request = Buffer.from(JSON.stringify({ type: 'crm-marmeria-discover' }));
    const destinations = new Set([BROADCAST_ADDRESS]);
    for (const address of localAddresses()) {
      const parts = address.split('.');
      if (parts.length === 4) {
        parts[3] = '255';
        destinations.add(parts.join('.'));
      }
    }

    for (const destination of destinations) {
      socket.send(request, DISCOVERY_PORT, destination, (error) => {
        if (error) console.warn(`Discovery verso ${destination} fallito:`, error.message);
      });
    }
  });

  setTimeout(finish, Math.max(Number(timeoutMs) || 1500, 100));
});

module.exports = {
  DiscoveryAdvertiser,
  discoverMasters,
  localAddresses,
};
