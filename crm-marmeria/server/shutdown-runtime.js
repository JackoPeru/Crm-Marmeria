const closeHttpServer = (server) => new Promise((resolve, reject) => {
  if (!server?.listening) {
    resolve();
    return;
  }
  server.close((error) => (error ? reject(error) : resolve()));
});

const gracefulShutdown = async ({
  barrier,
  server,
  websocketServer,
  database,
  timer,
  timeoutMs = 120000,
}) => {
  if (timer) clearInterval(timer);
  return barrier.runMaintenance(async () => {
    for (const client of websocketServer?.clients || []) client.terminate();
    await closeHttpServer(server);
    if (database?.db?.open) {
      database.db.pragma('wal_checkpoint(TRUNCATE)');
    }
    database?.close();
  }, timeoutMs);
};

module.exports = { gracefulShutdown };
