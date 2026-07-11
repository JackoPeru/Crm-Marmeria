from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    if old not in text:
        raise RuntimeError(f'Pattern not found in {path}: {old[:180]!r}')
    path.write_text(text.replace(old, new, 1))


(ROOT / 'server/mutation-barrier.js').write_text(r'''class MutationBarrier {
  constructor({ timeoutMs = 30000 } = {}) {
    this.timeoutMs = timeoutMs;
    this.activeRequests = 0;
    this.maintenance = false;
    this.idleWaiters = new Set();
    this.maintenanceQueue = Promise.resolve();
  }

  get isMaintenance() { return this.maintenance; }
  get activeCount() { return this.activeRequests; }

  enterRequest() {
    if (this.maintenance) return null;
    this.activeRequests += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeRequests = Math.max(0, this.activeRequests - 1);
      if (this.activeRequests === 0) {
        for (const resolve of this.idleWaiters) resolve();
        this.idleWaiters.clear();
      }
    };
  }

  waitForIdle(timeoutMs = this.timeoutMs) {
    if (this.activeRequests === 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.idleWaiters.delete(onIdle);
        callback();
      };
      const onIdle = () => finish(resolve);
      const timer = setTimeout(() => finish(() => {
        const error = new Error('Richieste ancora attive: manutenzione annullata');
        error.status = 503;
        reject(error);
      }), timeoutMs);
      this.idleWaiters.add(onIdle);
    });
  }

  runMaintenance(action, timeoutMs = this.timeoutMs) {
    const task = this.maintenanceQueue.then(async () => {
      this.maintenance = true;
      try {
        await this.waitForIdle(timeoutMs);
        return await action();
      } finally {
        this.maintenance = false;
      }
    });
    this.maintenanceQueue = task.catch(() => undefined);
    return task;
  }
}

module.exports = { MutationBarrier };
''')

app = ROOT / 'server/app.js'
replace_once(app, "const { MutationBarrier } = require('./mutation-barrier');\n", "const { MutationBarrier } = require('./mutation-barrier');\nconst { gracefulShutdown } = require('./shutdown-runtime');\n")
replace_once(
    app,
    """    close: async () => {
      clearInterval(backupTimer);
      for (const client of realtime.wss.clients) client.terminate();
      await new Promise((resolve) => server.close(resolve));
      db.close();
    },
""",
    """    close: async () => gracefulShutdown({
      barrier: mutationBarrier,
      server,
      websocketServer: realtime.wss,
      database: db,
      timer: backupTimer,
    }),
""",
)

main = ROOT / 'electron/main.cjs'
replace_once(
    main,
    """  Promise.race([
    centralServer.stop(),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ])
    .catch((error) => console.error('Arresto server fallito:', error))
    .finally(() => app.quit());
""",
    """  centralServer.stop()
    .catch((error) => console.error('Arresto server fallito:', error))
    .finally(() => app.quit());
""",
)
