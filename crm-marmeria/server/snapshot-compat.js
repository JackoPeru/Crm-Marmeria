const fs = require('fs');
const path = require('path');

const upgradeLegacySnapshots = ({ dataDir, backupDir }) => {
  const usersPath = path.join(dataDir, 'users.json');
  if (!fs.existsSync(usersPath) || !fs.existsSync(backupDir)) return 0;

  let upgraded = 0;
  for (const entry of fs.readdirSync(backupDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const snapshotPath = path.join(backupDir, entry.name);
    const databasePath = path.join(snapshotPath, 'crm-marmeria.db');
    const snapshotUsersPath = path.join(snapshotPath, 'users.json');
    if (!fs.existsSync(databasePath) || fs.existsSync(snapshotUsersPath)) continue;

    try {
      fs.copyFileSync(usersPath, snapshotUsersPath);
      upgraded += 1;
    } catch (error) {
      console.error(`Aggiornamento snapshot legacy ${entry.name} fallito:`, error);
    }
  }
  return upgraded;
};

module.exports = { upgradeLegacySnapshots };
