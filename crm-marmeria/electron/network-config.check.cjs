const assert = require('assert');
const {
  safeClientPrefs,
  selectSingleMaster,
  validatePrefs,
} = require('./network-config.cjs');

const safe = safeClientPrefs(new Error('JSON corrotto'));
assert.equal(safe.mode, 'client', 'Una configurazione corrotta non deve mai attivare la modalità automatica');
assert.match(safe.lastServerError, /corrotto/);

const duplicateIdentity = [
  { serverId: 'server-a', apiUrl: 'http://192.168.1.10:3001/api' },
  { serverId: 'server-a', apiUrl: 'http://192.168.1.11:3001/api' },
];
assert.equal(
  selectSingleMaster(duplicateIdentity, 'server-a'),
  null,
  'Due indirizzi con lo stesso ID devono essere trattati come un conflitto, non come un singolo master',
);
assert.equal(selectSingleMaster([duplicateIdentity[0]], 'server-a'), duplicateIdentity[0]);

const client = validatePrefs({
  mode: 'client',
  masterPort: 3001,
  apiUrl: 'http://192.168.1.20:3001',
});
assert.equal(client.apiUrl, 'http://192.168.1.20:3001/api');
