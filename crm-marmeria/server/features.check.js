// Il vecchio feature check crea via API una fattura storica già "Pagata".
// Il CRM ora deriva lo stato dagli incassi: nel solo harness traduciamo quel
// fixture legacy in un incasso completo, mantenendo la semantica del test.
const { CrmDatabase } = require('./database');

const originalCreate = CrmDatabase.prototype.create;
CrmDatabase.prototype.create = function createWithLegacyPaidFixture(type, input, user, operationId) {
  if (String(type) !== 'invoice' || String(input?.status || '').toLocaleLowerCase('it-IT') !== 'pagata') {
    return originalCreate.call(this, type, input, user, operationId);
  }

  const result = originalCreate.call(this, type, input, user, operationId);
  if (!result.replayed) {
    const invoice = result.item;
    const total = Number(invoice.total ?? invoice.amount ?? 0);
    if (total > 0) {
      originalCreate.call(this, 'payment', {
        clientId: invoice.customerId || invoice.clientId,
        invoiceId: String(invoice.id),
        projectId: invoice.projectId || null,
        date: String(invoice.date || new Date().toISOString()).slice(0, 10),
        amount: total,
        method: 'Storico',
        reference: 'Fixture legacy feature check',
        source: 'legacy-test-fixture',
      }, user, `${operationId || invoice.id}:legacy-paid-fixture`);
    }
  }
  return { ...result, item: this.get('invoice', result.item.id) };
};

require('./features-core.check');
