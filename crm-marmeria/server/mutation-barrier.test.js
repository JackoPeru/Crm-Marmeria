const assert = require('assert');
const { MutationBarrier } = require('./mutation-barrier');

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function run() {
  const barrier = new MutationBarrier({ timeoutMs: 1000 });
  const release = barrier.enterRequest();
  assert.equal(typeof release, 'function');

  let maintenanceStarted = false;
  const maintenance = barrier.runMaintenance(async () => {
    maintenanceStarted = true;
    assert.equal(barrier.activeCount, 0);
  });

  await wait(20);
  assert.equal(maintenanceStarted, false, 'La manutenzione deve attendere le richieste già iniziate');
  assert.equal(barrier.enterRequest(), null, 'Nuove richieste devono essere bloccate durante la manutenzione');

  release();
  await maintenance;
  assert.equal(maintenanceStarted, true);
  assert.equal(barrier.isMaintenance, false);

  const nextRelease = barrier.enterRequest();
  assert.equal(typeof nextRelease, 'function', 'Le richieste devono riprendere dopo la manutenzione');
  nextRelease();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
