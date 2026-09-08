'use strict';

const path = require('path');
const { recoverPendingUpdate } = require('./update-recovery');

const dataDir = process.env.CRM_DATA_DIR || path.join(__dirname, 'data');

const boot = async () => {
  const recovered = await recoverPendingUpdate({ dataDir });
  if (recovered) return;
  require('./index-server');
};

boot().catch((error) => {
  console.error('Bootstrap server fallito:', error);
  process.exitCode = 1;
});
