const assert = require('assert');
const { MutationBarrier } = require('./mutation-barrier');
const { gracefulShutdown } = require('./shutdown-runtime');

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function run() {
  const barrier = new MutationBarrier({ timeoutMs: 1000 });
  const release = barrier.enterRequest();
  const events = [];
  const server = {
    listening: true,
    close(callback) {
      events.push('server-close');
      this.listening = false;
      callback();
    },
  };
  const database = {
    db: { open: true, pragma(value) { events.push(`pragma:${value}`); } },
    close() { events.push('db-close'); this.db.open = false; },
  };
  const websocketServer = {
    clients: new Set([{ terminate: () => events.push('ws-terminate') }]),
  };

  let completed = false;
  const shutdown = gracefulShutdown({
    barrier,
    server,
    websocketServer,
    database,
    timeoutMs: 1000,
  }).then(() => { completed = true; });

  await wait(20);
  assert.equal(completed, false, 'La chiusura deve attendere la richiesta già attiva');
  assert.equal(events.length, 0, 'DB e server non devono chiudersi mentre una richiesta è attiva');
  assert.equal(barrier.enterRequest(), null, 'Nuove richieste devono essere bloccate durante la chiusura');

  release();
  await shutdown;
  assert.deepEqual(events, [
    'ws-terminate',
    'server-close',
    'pragma:wal_checkpoint(TRUNCATE)',
    'db-close',
  ]);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
