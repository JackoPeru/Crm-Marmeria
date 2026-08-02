const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildInvoiceXml, createSdiPecService } = require('./sdi-pec');

const company = {
  legalName: 'Marmeria Test Srl', vatNumber: '01234567890', fiscalCode: '01234567890', taxRegime: 'RF01',
  address: 'Via Roma', streetNumber: '1', zip: '20100', city: 'Milano', province: 'MI', country: 'IT',
};
const client = {
  name: 'Cliente Test Srl', clientType: 'Azienda', vatNumber: '12345678901', fiscalCode: '12345678901',
  recipientCode: 'ABC1234', address: 'Via Torino', streetNumber: '2', zip: '10100', city: 'Torino', province: 'TO', country: 'IT',
};
const invoice = {
  id: 'invoice-1', invoiceNumber: 'FATT-2026-001', date: '2026-08-02', dueDate: '2026-09-01', total: 122,
  items: [{ description: 'Piano marmo & posa', quantity: 1, unitPrice: 100, taxRate: 22 }],
};

const run = async () => {
  const generated = buildInvoiceXml({ company, client, invoice, progressive: 'ABC123' });
  assert.equal(generated.filename, 'IT01234567890_ABC123.xml');
  assert.match(generated.xml, /<IdTrasmittente><IdPaese>IT<\/IdPaese><IdCodice>01234567890<\/IdCodice><\/IdTrasmittente>/);
  assert.match(generated.xml, /Piano marmo &amp; posa/);
  assert.match(generated.xml, /<ImportoTotaleDocumento>122\.00<\/ImportoTotaleDocumento>/);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-sdi-pec-'));
  let sent = null;
  let flagged = false;
  const service = createSdiPecService({
    dataDir,
    transportFactory: () => ({ verify: async () => true, sendMail: async (message) => { sent = message; return { messageId: '<pec-test>', accepted: ['sdi01@pec.fatturapa.it'] }; } }),
    imapFactory: () => ({
      connect: async () => {}, mailboxOpen: async () => {}, logout: async () => {},
      messageFlagsAdd: async () => { flagged = true; },
      fetch: async function* () { yield { uid: 1, source: Buffer.from('<NotificaScarto><NomeFile>IT01234567890_ABC123.xml</NomeFile></NotificaScarto>') }; },
    }),
    parseEmail: async () => ({ attachments: [{ content: Buffer.from('<NotificaScarto><NomeFile>IT01234567890_ABC123.xml</NomeFile></NotificaScarto>') }] }),
  });
  service.configure({ company, email: 'fatture@pec.it', password: 'segreto-test' });
  assert.equal(service.status().configured, true);
  assert.equal(JSON.stringify(service.status()).includes('segreto-test'), false);
  assert.equal((await service.testConnection()).verified, true);
  const result = await service.send({ invoice, client, progressive: 'ABC123' });
  assert.equal(sent.to, 'sdi01@pec.fatturapa.it');
  assert.equal(sent.attachments[0].filename, result.filename);
  assert.equal(fs.existsSync(result.archivedPath), true);
  let receipt = null;
  const polling = await service.pollReceipts({ onReceipt: async (entry) => { receipt = entry; return true; } });
  assert.equal(polling.changed, 1);
  assert.equal(receipt.state, 'scartata');
  assert.equal(receipt.filename, 'IT01234567890_ABC123.xml');
  assert.equal(flagged, true);
  fs.rmSync(dataDir, { recursive: true, force: true });
};

run().then(() => console.log('sdi-pec checks ok')).catch((error) => { console.error(error); process.exitCode = 1; });
