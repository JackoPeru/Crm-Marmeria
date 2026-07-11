class MutationBarrier {
  constructor({ timeoutMs = 30000 } = {}) {
    this.timeoutMs = timeoutMs;
    this.activeRequests = 0;
    this.maintenance = false;
    this.idleWaiters = new Set();
  }

  get isMaintenance() {
    return this.maintenance;
  }

  get activeCount() {
    return this.activeRequests;
  }

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

  async runMaintenance(action, timeoutMs = this.timeoutMs) {
    if (this.maintenance) {
      const error = new Error('È già in corso un’operazione di manutenzione');
      error.status = 503;
      throw error;
    }
    this.maintenance = true;
    try {
      await this.waitForIdle(timeoutMs);
      return await action();
    } finally {
      this.maintenance = false;
    }
  }
}

module.exports = { MutationBarrier };
