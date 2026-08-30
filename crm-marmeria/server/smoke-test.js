// Compatibilità del vecchio smoke test: il fixture storico usa l'ID cliente
// "cliente-uuid" senza crearlo esplicitamente. Lo materializziamo solo nel
// processo di test, senza allentare i vincoli referenziali del server reale.
const { CrmDatabase } = require('./database');

const originalCreate = CrmDatabase.prototype.create;
CrmDatabase.prototype.create = function createWithLegacySmokeClient(type, input, user, operationId) {
  const clientId = String(input?.clientId || input?.customerId || '');
  if (
    clientId === 'cliente-uuid'
    && ['project', 'quote', 'invoice', 'payment'].includes(String(type))
    && !this.get('client', clientId)
  ) {
    originalCreate.call(this, 'client', {
      id: clientId,
      name: 'Cliente fixture smoke CI',
      type: 'Privato',
    }, user, 'smoke-fixture-client');
  }
  return originalCreate.call(this, type, input, user, operationId);
};

require('./smoke-test-core');
