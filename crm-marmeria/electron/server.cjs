const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const { createCrmServer } = require('../server/app');
const { DiscoveryAdvertiser, discoverMasters, localAddresses } = require('./discovery.cjs');

class CentralCrmServer {
  constructor() {
    this.instance = null;
    this.discovery = null;
    this.port = null;
    this.sharedDataPath = null;
    this.serverId = null;
  }

  identityPath() {
    return path.join(app.getPath('userData'), 'crm-server-id.txt');
  }

  getServerId() {
    if (this.serverId) return this.serverId;
    const filePath = this.identityPath();
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, crypto.randomUUID());
    this.serverId = fs.readFileSync(filePath, 'utf8').trim();
    return this.serverId;
  }

  migrateLegacyData(dataDir) {
    if (fs.existsSync(path.join(dataDir, 'crm-marmeria.db'))) return;

    const legacyDirectories = [
      path.join(app.getPath('userData'), 'shared-data'),
      path.join(app.getPath('userData'), 'crm-data'),
    ];
    const mappings = {
      'customers.json': 'clients.json',
      'clients.json': 'clients.json',
      'projects.json': 'projects.json',
      'materials.json': 'materials.json',
      'quotes.json': 'quotes.json',
      'invoices.json': 'invoices.json',
      'orders.json': 'orders.json',
    };

    for (const sourceDirectory of legacyDirectories) {
      if (!fs.existsSync(sourceDirectory)) continue;
      for (const [sourceName, destinationName] of Object.entries(mappings)) {
        const source = path.join(sourceDirectory, sourceName);
        const destination = path.join(dataDir, destinationName);
        if (!fs.existsSync(source) || fs.existsSync(destination)) continue;
        try {
          fs.copyFileSync(source, destination);
          console.log(`Dati legacy migrati: ${sourceName} → ${destinationName}`);
        } catch (error) {
          console.error(`Migrazione legacy ${sourceName} fallita:`, error);
        }
      }
    }
  }

  async start(port = 3001, backupPath = null, options = {}) {
    if (this.instance) return { success: true, message: 'Server già attivo', ...this.getStatus() };

    const discovered = await discoverMasters(1200);
    const ownId = this.getServerId();
    const otherMasters = discovered.filter((master) => master.serverId !== ownId);
    if (otherMasters.length && !options.force) {
      const error = new Error(`Esiste già un server principale sulla rete: ${otherMasters[0].name || otherMasters[0].hostname} (${otherMasters[0].apiUrl})`);
      error.code = 'MASTER_ALREADY_EXISTS';
      error.masters = otherMasters;
      throw error;
    }

    const root = path.join(app.getPath('userData'), 'crm-central-data');
    const dataDir = path.join(root, 'data');
    const attachmentsDir = path.join(root, 'attachments');
    const backupDir = backupPath || path.join(root, 'backups');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(attachmentsDir, { recursive: true });
    fs.mkdirSync(backupDir, { recursive: true });
    this.migrateLegacyData(dataDir);

    this.instance = await createCrmServer({
      port: Number(port),
      host: '0.0.0.0',
      dataDir,
      attachmentsDir,
      backupDir,
      serverName: 'CRM Marmeria',
      serverId: ownId,
    });
    this.port = Number(port);
    this.sharedDataPath = backupDir;
    this.discovery = new DiscoveryAdvertiser({
      port: this.port,
      serverId: ownId,
      name: 'CRM Marmeria',
    });
    this.discovery.start();
    return { success: true, message: 'Server centrale avviato', ...this.getStatus() };
  }

  async stop() {
    this.discovery?.stop();
    this.discovery = null;
    if (this.instance) await this.instance.close();
    this.instance = null;
    this.port = null;
    return { success: true, message: 'Server centrale arrestato' };
  }

  getStatus() {
    const addresses = localAddresses();
    return {
      isRunning: Boolean(this.instance),
      mode: this.instance ? 'master' : 'stopped',
      port: this.port,
      serverId: this.getServerId(),
      addresses,
      apiUrls: this.port ? addresses.map((address) => `http://${address}:${this.port}/api`) : [],
      localApiUrl: this.port ? `http://127.0.0.1:${this.port}/api` : null,
      backupPath: this.sharedDataPath,
    };
  }
}

module.exports = CentralCrmServer;
