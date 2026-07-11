const assert = require('assert');
const { resolveAutomaticMode } = require('./network-config.cjs');

const prefs = {
  mode: 'auto',
  masterPort: 3001,
  apiUrl: 'http://127.0.0.1:3001/api',
  backupPath: '',
};

assert.throws(
  () => resolveAutomaticMode(prefs, []),
  (error) => error.code === 'NO_MASTER_FOUND',
  'La modalità automatica non deve promuovere silenziosamente il client a master',
);

const master = {
  serverId: 'server-a',
  apiUrl: 'http://192.168.1.20:3001/api',
};
const resolved = resolveAutomaticMode(prefs, [master]);
assert.equal(resolved.mode, 'client');
assert.equal(resolved.apiUrl, master.apiUrl);
assert.equal(resolved.discoveredServerId, master.serverId);

assert.throws(
  () => resolveAutomaticMode(prefs, [master, { ...master, serverId: 'server-b' }]),
  (error) => error.code === 'MULTIPLE_MASTERS',
  'Più master devono bloccare la selezione automatica',
);
