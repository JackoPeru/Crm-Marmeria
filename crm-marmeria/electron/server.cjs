const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Module = require('module');
const { app } = require('electron');
const { DiscoveryAdvertiser, discoverMasters, localAddresses } = require('./discovery.cjs');
const { upgradeLegacySnapshots } = require('../server/snapshot-compat');

// Il progetto contiene due installazioni distinte: una ricompilata per Electron
// e una per il server Node standalone. Durante l'esecuzione Electron i moduli
// nativi devono sempre provenire dal node_modules principale.
const rootRequire = Module.createRequire(path.join(__dirname, '../package.json'));
const electronNativeModules = {
  'better-sqlite3': rootRequire.resolve('better-sqlite3'),
  bcrypt: rootRequire.resolve('bcrypt'),
};
const originalLoad = Module._load;
let createCrmServer;
try {
  Module._load = function loadElectronNativeModule(request, parent, isMain) {
    const resolvedNativeModule = electronNativeModules[request];
    if (resolvedNativeModule) {
      return originalLoad.call(this, resolvedNativeModule, parent, isMain);
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  ({ createCrmServer } = require('../server/app'));
} finally {
  Module._load = originalLoad;
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class CentralCrmServer {
  constructor() {
    this.instance = null;
    this.discovery = null;
    this.port = null;
    this.backupPath = null;
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

  resolveBackupPath(selectedPath, root) {
    if (!selectedPath) return path.join(root, 'backups');
    const resolvedSelection = path.resolve(String(selectedPath));
    fs.mkdirSync(resolvedSelection, { recursive: true });
    return path.basename(resolvedSelection) === 'CRM-Marmeria-Backups'
      ? resolvedSelection
      : path.join(resolvedSelection, 'CRM-Marmeria-Backups');
  }

  async findOtherMasters(ownId) {
    const discovered = await discoverMasters(1200);
    return discovered.filter((master) => master.serverId !== ownId);
  }

  async start(port = 3001, selectedBackupPath = null, options = {}) {
    const numericPort = Number(port);
    if (!Number.isInteger(numericPort) || numericPort < 1024 || numericPort > 65535) {
      throw new Error('La porta del server deve essere compresa tra 1024 e 65535');
    }

    const root = path.join(app.getPath('userData'), 'crm-central-data');
    const dataDir = path.join(root, 'data');
    const attachmentsDir = path.join(root, 'attachments');
    const backupDir = this.resolveBackupPath(selectedBackupPath, root);

    if (
      this.instance
      && this.port === numericPort
      && path.resolve(this.backupPath) === path.resolve(backupDir)
    ) {
      return { success: true, message: 'Server già attivo', ...this.getStatus() };
    }

    if (this.instance) await this.stop();

    const ownId = this.getServerId();
    let otherMasters = await this.findOtherMasters(ownId);

    // Un secondo controllo con jitter riduce la possibilità che due PC,
    // avviati nello stesso istante, si promuovano entrambi a master.
    if (!otherMasters.length && !options.force) {
      await wait(250 + Math.floor(Math.random() * 500));
      otherMasters = await this.findOtherMasters(ownId);
    }

    if (otherMasters.length && !options.force) {
      const error = new Error(
        `Esiste già un server principale sulla rete: ${otherMasters[0].name || otherMasters[0].hostname} (${otherMasters[0].apiUrl})`,
      );
      error.code = 'MASTER_ALREADY_EXISTS';
      error.masters = otherMasters;
      throw error;
    }

    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(attachmentsDir, { recursive: true });
    fs.mkdirSync(backupDir, { recursive: true });
    this.migrateLegacyData(dataDir);

    try {
      this.instance = await createCrmServer({
        port: numericPort,
        host: '0.0.0.0',
        dataDir,
        attachmentsDir,
        backupDir,
        serverName: 'CRM Marmeria',
        serverId: ownId,
      });
      const upgradedSnapshots = upgradeLegacySnapshots({ dataDir, backupDir });
      if (upgradedSnapshots > 0) {
        console.log(`Aggiornati ${upgradedSnapshots} snapshot legacy con gli account correnti`);
      }
      this.port = this.instance.port;
      this.backupPath = backupDir;
      this.discovery = new DiscoveryAdvertiser({
        port: this.port,
        serverId: ownId,
        name: 'CRM Marmeria',
      });
      this.discovery.start();
      return { success: true, message: 'Server centrale avviato', ...this.getStatus() };
    } catch (error) {
      this.discovery?.stop();
      this.discovery = null;
      if (this.instance) await this.instance.close().catch(() => undefined);
      this.instance = null;
      this.port = null;
      this.backupPath = null;
      throw error;
    }
  }

  async stop() {
    this.discovery?.stop();
    this.discovery = null;
    if (this.instance) await this.instance.close();
    this.instance = null;
    this.port = null;
    this.backupPath = null;
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
      apiUrls: this.port
        ? addresses.map((address) => `http://${address}:${this.port}/api`)
        : [],
      localApiUrl: this.port ? `http://127.0.0.1:${this.port}/api` : null,
      backupPath: this.backupPath,
    };
  }
}

module.exports = CentralCrmServer;
