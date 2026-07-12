const dgram = require('dgram');
const os = require('os');
const crypto = require('crypto');
const https = require('https');

const DISCOVERY_PORT = 41234;
const BROADCAST_ADDRESS = '255.255.255.255';

const ipv4Interfaces = () => Object.values(os.networkInterfaces())
  .flat()
  .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal);

const localAddresses = () => ipv4Interfaces().map((entry) => entry.address);

const ipv4ToNumber = (address) => address
  .split('.')
  .reduce((result, part) => ((result << 8) | Number(part)) >>> 0, 0);

const numberToIpv4 = (value) => [24, 16, 8, 0]
  .map((shift) => (value >>> shift) & 255)
  .join('.');

const broadcastFor = (address, netmask) => {
  const ip = ipv4ToNumber(address);
  const mask = ipv4ToNumber(netmask);
  return numberToIpv4((ip | (~mask >>> 0)) >>> 0);
};

const verifyMaster = async (master, timeoutMs = 1800) => {
  try {
    const health = await new Promise((resolve, reject) => {
      const request = https.get(`${master.apiUrl}/health`, { rejectUnauthorized: false, timeout: timeoutMs }, (response) => {
        let body = '';
        const peerFingerprint = response.socket?.getPeerCertificate?.().fingerprint || '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => {
          if (!master.tlsFingerprint || peerFingerprint.toLowerCase() !== master.tlsFingerprint.toLowerCase()) {
            return reject(new Error('Certificato server non corrispondente alla discovery'));
          }
          if (response.statusCode !== 200) return reject(new Error('Health server non valido'));
          try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
        });
      });
      request.on('timeout', () => request.destroy(new Error('Timeout discovery')));
      request.on('error', reject);
    });
    if (
      health?.mode !== 'central-server'
      || !health?.serverId
      || String(health.serverId) !== String(master.serverId)
    ) {
      return null;
    }
    return {
      ...master,
      name: health.hostname || master.name,
      serverId: String(health.serverId),
      health,
    };
  } catch {
    return null;
  }
};

class DiscoveryAdvertiser {
  constructor({ port, serverId, tlsFingerprint, name = 'CRM Marmeria' }) {
    this.port = Number(port);
    this.serverId = serverId || crypto.randomUUID();
    this.name = name;
    this.tlsFingerprint = tlsFingerprint || null;
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
          protocol: 'https',
          tlsFingerprint: this.tlsFingerprint,
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

  const finish = async () => {
    if (settled) return;
    settled = true;
    try {
      socket.close();
    } catch {
      // Il socket potrebbe non essere stato aperto.
    }
    const verified = await Promise.all(
      [...masters.values()].map((master) => verifyMaster(master)),
    );
    resolve(verified.filter(Boolean));
  };

  socket.on('error', (error) => {
    console.warn('Ricerca server LAN non disponibile:', error.message);
    void finish();
  });

  socket.on('message', (buffer, remote) => {
    try {
      const message = JSON.parse(buffer.toString());
      const port = Number(message.port);
      if (
        message.type !== 'crm-marmeria-master'
        || !message.serverId
        || !Number.isInteger(port)
        || port < 1
        || port > 65535
      ) {
        return;
      }
      const address = remote.address;
      masters.set(`${String(message.serverId)}|${address}|${port}`, {
        ...message,
        serverId: String(message.serverId),
        port,
        address,
        apiUrl: `https://${address}:${port}/api`,
        tlsFingerprint: String(message.tlsFingerprint || ''),
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
      void finish();
      return;
    }

    const request = Buffer.from(JSON.stringify({ type: 'crm-marmeria-discover' }));
    const destinations = new Set([BROADCAST_ADDRESS]);
    for (const entry of ipv4Interfaces()) {
      try {
        destinations.add(broadcastFor(entry.address, entry.netmask));
      } catch {
        // L'indirizzo globale resta disponibile come fallback.
      }
    }

    for (const destination of destinations) {
      socket.send(request, DISCOVERY_PORT, destination, (error) => {
        if (error) console.warn(`Discovery verso ${destination} fallito:`, error.message);
      });
    }
  });

  setTimeout(() => void finish(), Math.max(Number(timeoutMs) || 1500, 100));
});

module.exports = {
  DiscoveryAdvertiser,
  discoverMasters,
  localAddresses,
  verifyMaster,
};
