const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { pathToFileURL } = require('url');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-main-bootstrap-'));
  const handlers = new Map();
  const appEvents = new Map();
  const windows = [];
  let readyCallback = null;
  let fetchCalls = 0;

  fs.writeFileSync(path.join(root, 'network-prefs.json'), JSON.stringify({
    mode: 'client',
    masterPort: 3001,
    apiUrl: 'https://127.0.0.1:3001/api',
    discoveredServerId: 'server-ci',
  }));

  const fakeApp = {
    isQuiting: false,
    requestSingleInstanceLock: () => true,
    on: (name, callback) => appEvents.set(name, callback),
    whenReady: () => ({
      then(callback) {
        readyCallback = callback;
        return Promise.resolve();
      },
    }),
    getPath: () => root,
    quit() { this.isQuiting = true; },
  };

  class FakeBrowserWindow {
    constructor(options) {
      this.options = options;
      this.events = new Map();
      this.webEvents = new Map();
      this.webContents = {
        setWindowOpenHandler: (callback) => { this.windowOpenHandler = callback; },
        on: (name, callback) => this.webEvents.set(name, callback),
        openDevTools: () => undefined,
        getURL: () => pathToFileURL(path.join(__dirname, '../dist/index.html')).toString(),
      };
      windows.push(this);
    }
    on(name, callback) { this.events.set(name, callback); }
    loadFile(filePath) { this.loadedFile = filePath; return Promise.resolve(); }
    loadURL(url) { this.loadedUrl = url; return Promise.resolve(); }
    isMinimized() { return false; }
    restore() {}
    focus() {}
    static getAllWindows() { return windows; }
  }

  class FakeCentralServer {
    constructor() { this.running = false; }
    getStatus() {
      return {
        isRunning: this.running,
        serverId: 'local-server',
        localApiUrl: null,
      };
    }
    async start() { this.running = true; return { success: true, serverId: 'local-server' }; }
    async stop() { this.running = false; return { success: true }; }
    getSetupSecret() { return 'setup-secret'; }
  }

  const fakeElectron = {
    app: fakeApp,
    BrowserWindow: FakeBrowserWindow,
    ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
    dialog: {
      showMessageBox: async () => ({ response: 2 }),
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    },
    shell: { openExternal: async () => undefined },
  };

  const previousFetch = global.fetch;
  const originalLoad = Module._load;
  try {
    global.fetch = async (url) => {
      fetchCalls += 1;
      assert.equal(url, 'https://127.0.0.1:3001/api/health');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          mode: 'central-server',
          serverId: 'server-ci',
          dataEpoch: 'epoch-ci',
        }),
      };
    };

    Module._load = function loadWithMainMocks(request, parent, isMain) {
      if (request === 'electron') return fakeElectron;
      if (parent?.filename?.endsWith(`${path.sep}electron${path.sep}main.cjs`)) {
        if (request === './server.cjs') return FakeCentralServer;
        if (request === './discovery.cjs') {
          return { discoverMasters: async () => [] };
        }
      }
      return originalLoad.call(this, request, parent, isMain);
    };

    require('./main.cjs');
    assert.equal(typeof readyCallback, 'function', 'Il processo principale deve registrare il bootstrap');
    await readyCallback();
    assert.equal(fetchCalls, 1, 'Il bootstrap client deve verificare il server configurato');
    assert.equal(windows.length, 1, 'Il bootstrap deve creare la finestra principale');
    assert.equal(
      windows[0].loadedFile,
      path.join(__dirname, '../dist/index.html'),
      'La build deve caricare il file distribuito',
    );

    const rendererUrl = pathToFileURL(path.join(__dirname, '../dist/index.html')).toString();
    const trustedEvent = {
      senderFrame: { url: rendererUrl },
      sender: { getURL: () => rendererUrl },
    };
    const preferences = handlers.get('network-get-prefs')(trustedEvent);
    assert.equal(preferences.success, true);
    assert.equal(preferences.prefs.discoveredServerId, 'server-ci');
    assert.throws(
      () => handlers.get('network-get-prefs')({ senderFrame: { url: 'https://evil.example' } }),
      /origine non autorizzata/,
    );

    const willNavigate = windows[0].webEvents.get('will-navigate');
    let prevented = false;
    willNavigate({ preventDefault: () => { prevented = true; } }, 'https://evil.example');
    assert.equal(prevented, true, 'La finestra deve bloccare navigazioni esterne');
  } finally {
    Module._load = originalLoad;
    global.fetch = previousFetch;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
