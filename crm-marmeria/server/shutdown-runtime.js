const closeHttpServer = (server) => new Promise((resolve, reject) => {
  if (!server?.listening) {
    resolve();
    return;
  }
  server.close((error) => (error ? reject(error) : resolve()));
});

const gracefulShutdown = async ({
  barrier,
  drain,
  server,
  websocketServer,
  database,
  timer,
  timeoutMs = 120000,
}) => {
  if (timer) clearInterval(timer);
  return barrier.runMaintenance(async () => {
    if (typeof drain === 'function') await drain();
    for (const client of websocketServer?.clients || []) client.terminate();
    await closeHttpServer(server);
    if (database?.db?.open) {
      database.db.pragma('wal_checkpoint(TRUNCATE)');
    }
    database?.close();
  }, timeoutMs);
};

module.exports = { gracefulShutdown };
