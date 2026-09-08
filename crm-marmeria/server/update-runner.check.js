const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

assert.equal(
  fs.existsSync(path.join(__dirname, 'update-runner.js')),
  true,
  'Manca il supervisore esterno per update e rollback fuori dal processo server',
);

console.log('UPDATE_RUNNER_CHECK_OK');
