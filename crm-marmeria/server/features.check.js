const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcrypt');
const PizZip = require('pizzip');
const { createCrmServer } = require('./app');

const requestJson = async (baseUrl, route, options = {}) => {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  return { response, body: await response.json() };
};

const minimalWordTemplate = () => {
  const zip = new PizZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.folder('_rels').file('.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.folder('word').file('document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>{{quote_number}}</w:t></w:r></w:p><w:p><w:r><w:t>{{customer_name}}</w:t></w:r></w:p><w:p><w:r><w:t>{{total}}</w:t></w:r></w:p><w:p><w:r><w:t>{{#items}}{{description}} {{quantity}} {{line_total}}{{/items}}</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>');
  return zip.generate({ type: 'nodebuffer' });
};

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-features-'));
  const dataDir = path.join(root, 'data');
  const user = {
    id: 'admin-features', username: 'admin-features', email: 'admin@example.test',
    password: await bcrypt.hash('Feature-password-123', 4), firstName: 'Admin', lastName: 'Feature',
    role: 'admin', isActive: true,
    permissions: ['clients.view', 'clients.create', 'suppliers.view', 'suppliers.create', 'projects.view', 'projects.create', 'projects.edit', 'quotes.view', 'quotes.create', 'quotes.edit', 'invoices.view', 'invoices.create', 'payments.view', 'payments.create', 'payments.delete', 'orders.view', 'orders.create', 'orders.edit', 'orders.delete', 'calendar.view', 'calendar.create', 'calendar.edit', 'calendar.delete', 'settings.edit'],
  };
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'users.json'), JSON.stringify([user]));
  const gmailDrafts = [];
  const gmail = {
    status: () => ({ configured: true, clientId: 'test.apps.googleusercontent.com', connected: true, email: 'ufficio@example.test', callbackUrl: 'http://127.0.0.1:3001/oauth2/gmail', driveBackupReady: false }),
    configure: () => gmail.status(),
    beginAuthorization: () => ({ url: 'https://accounts.google.com/test' }),
    completeAuthorization: async () => gmail.status(),
    disconnect: () => ({ configured: true, clientId: 'test.apps.googleusercontent.com', connected: false, email: null, callbackUrl: 'http://127.0.0.1:3001/oauth2/gmail' }),
    createDraft: async (payload) => { gmailDrafts.push(payload); return { id: 'gmail-draft-ci', gmailUrl: 'https://mail.google.com/mail/u/0/#drafts' }; },
    getDriveAccessToken: async () => ({ token: 'drive-token' }),
  };
  let driveBackupConfig = {
    enabled: true,
    intervalHours: 24,
    retentionCount: 30,
    connected: true,
    accountEmail: 'admin@example.test',
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastError: null,
    lastSnapshotName: null,
    remoteBackupCount: 0,
  };
  const googleDriveBackups = {
    status: () => driveBackupConfig,
    configure: (input) => {
      driveBackupConfig = { ...driveBackupConfig, ...input };
      return driveBackupConfig;
    },
    isDue: () => false,
    uploadSnapshot: async ({ snapshot, snapshotDirectory }) => {
      assert.ok(fs.existsSync(path.join(snapshotDirectory, 'crm-marmeria.db')));
      driveBackupConfig = {
        ...driveBackupConfig,
        lastSuccessAt: new Date().toISOString(),
        lastSnapshotName: snapshot.name,
        remoteBackupCount: 1,
      };
      return { snapshot: snapshot.name, status: driveBackupConfig };
    },
  };
  let instance;
  try {
    instance = await createCrmServer({ port: 0, host: '127.0.0.1', dataDir, backupDir: path.join(root, 'backups'), attachmentsDir: path.join(root, 'attachments'), gmail, googleDriveBackups });
    const baseUrl = `http://127.0.0.1:${instance.port}/api`;
    const login = await requestJson(baseUrl, '/auth/login', { method: 'POST', body: JSON.stringify({ username: user.username, password: 'Feature-password-123' }) });
    assert.equal(login.response.status, 200);
    const headers = { Authorization: `Bearer ${login.body.token}` };
    const driveBackupStatus = await requestJson(baseUrl, '/integrations/google-drive-backups/status', { headers });
    assert.equal(driveBackupStatus.response.status, 200);
    const driveBackupConfigResponse = await requestJson(baseUrl, '/integrations/google-drive-backups/config', { method: 'PUT', headers, body: JSON.stringify({ intervalHours: 6, retentionCount: 7 }) });
    assert.equal(driveBackupConfigResponse.response.status, 200);
    assert.equal(driveBackupConfigResponse.body.intervalHours, 6);
    const driveBackupRun = await requestJson(baseUrl, '/integrations/google-drive-backups/run', { method: 'POST', headers });
    assert.equal(driveBackupRun.response.status, 201);
    assert.ok(driveBackupRun.body.snapshot);
    const customer = await requestJson(baseUrl, '/clients', { method: 'POST', headers, body: JSON.stringify({ name: 'Cliente Word', email: 'cliente@example.test', phone: '+39 333 1234567' }) });
    const project = await requestJson(baseUrl, '/projects', { method: 'POST', headers, body: JSON.stringify({ name: 'Cucina marmo', clientId: customer.body.id }) });
    assert.equal(customer.response.status, 201); assert.equal(project.response.status, 201);

    const invoice = await requestJson(baseUrl, '/invoices', { method: 'POST', headers, body: JSON.stringify({ date: '2031-06-03', dueDate: '2031-06-05', customerId: customer.body.id, projectId: project.body.id, items: [{ description: 'Piano cucina', quantity: 1, unitPrice: 1500, taxRate: 0 }] }) });
    assert.equal(invoice.response.status, 201);
    const payment = await requestJson(baseUrl, '/payments', { method: 'POST', headers, body: JSON.stringify({ clientId: customer.body.id, invoiceId: invoice.body.id, date: '2031-06-04', amount: 500, method: 'Bonifico' }) });
    assert.equal(payment.response.status, 201);
    const history = await requestJson(baseUrl, `/clients/${customer.body.id}/history`, { headers });
    assert.equal(history.response.status, 200);
    assert.equal(history.body.projects.length, 1);
    assert.equal(history.body.invoices[0].paymentSummary.paid, 500);
    assert.equal(history.body.invoices[0].paymentSummary.remaining, 1000);
    const projectCosts = await requestJson(baseUrl, `/projects/${project.body.id}`, { method: 'PUT', headers, body: JSON.stringify({ version: project.body.version, technicalSheet: { measurements: '240 × 65 cm', material: 'Marmo bianco', finish: 'Lucido', survey: 'Sagoma rilevata', installation: 'Posa piano' }, costItems: [{ category: 'Marmo', description: 'Lastra', quantity: 1, unitCost: 400 }], laborHours: 10, laborRate: 25, transportCost: 50 }) });
    assert.equal(projectCosts.response.status, 200);
    assert.equal(projectCosts.body.technicalSheet.survey, 'Sagoma rilevata');
    const financials = await requestJson(baseUrl, `/projects/${project.body.id}/financials`, { headers });
    assert.equal(financials.response.status, 200);
    assert.equal(financials.body.totalCost, 700);
    assert.equal(financials.body.margin, 800);
    const schedule = await requestJson(baseUrl, '/invoices/schedule', { headers });
    assert.equal(schedule.response.status, 200);
    assert.equal(schedule.body[0].remaining, 1000);
    const legacyPaidInvoice = await requestJson(baseUrl, '/invoices', { method: 'POST', headers, body: JSON.stringify({ date: '2025-01-01', dueDate: '2025-01-15', customerId: customer.body.id, projectId: project.body.id, status: 'Pagata', items: [{ description: 'Fattura legacy già saldata', quantity: 1, unitPrice: 100, taxRate: 0 }] }) });
    assert.equal(legacyPaidInvoice.response.status, 201);
    const scheduleAfterLegacy = await requestJson(baseUrl, '/invoices/schedule', { headers });
    assert.equal(scheduleAfterLegacy.body.some((item) => item.id === legacyPaidInvoice.body.id), false);
    const supplier = await requestJson(baseUrl, '/suppliers', { method: 'POST', headers, body: JSON.stringify({ name: 'Fornitore CI', phone: '3331234567' }) });
    assert.equal(supplier.response.status, 201);
    const purchaseOrder = await requestJson(baseUrl, '/purchase-orders', { method: 'POST', headers, body: JSON.stringify({ title: 'Marmo Bianco', supplier: 'Fornitore CI', supplierId: supplier.body.id, date: '2031-06-04', projectId: project.body.id, status: 'Inviato', amount: 400 }) });
    assert.equal(purchaseOrder.response.status, 201);
    const deliveryNote = await requestJson(baseUrl, '/delivery-notes', { method: 'POST', headers, body: JSON.stringify({ title: 'DDT posa cucina', date: '2031-06-06', clientId: customer.body.id, supplierId: supplier.body.id, projectId: project.body.id, status: 'Emesso' }) });
    assert.equal(deliveryNote.response.status, 201);
    const supplierHistory = await requestJson(baseUrl, `/suppliers/${supplier.body.id}/history`, { headers });
    assert.equal(supplierHistory.response.status, 200);
    assert.equal(supplierHistory.body.purchaseOrders.length, 1);
    assert.equal(supplierHistory.body.deliveryNotes.length, 1);
    assert.equal(supplierHistory.body.summary.totalOrdered, 400);
    const serviceCase = await requestJson(baseUrl, '/service-cases', { method: 'POST', headers, body: JSON.stringify({ title: 'Controllo garanzia', clientId: customer.body.id, projectId: project.body.id, date: '2032-06-06', status: 'Aperta' }) });
    assert.equal(serviceCase.response.status, 201);
    const operations = await requestJson(baseUrl, '/service-cases', { headers });
    assert.equal(operations.body.length, 1);
    const whatsapp = await requestJson(baseUrl, '/communications/whatsapp-draft', { method: 'POST', headers, body: JSON.stringify({ clientId: customer.body.id, title: 'Promemoria saldo', message: 'Buongiorno, promemoria saldo fattura.' }) });
    assert.equal(whatsapp.response.status, 201);
    assert.equal(whatsapp.body.sendMode, 'manual-confirmation');
    assert.ok(whatsapp.body.whatsappUrl.startsWith('https://wa.me/39'));
    const reminder = await requestJson(baseUrl, `/invoices/${invoice.body.id}/whatsapp-reminder`, { method: 'POST', headers, body: JSON.stringify({}) });
    assert.equal(reminder.response.status, 201);
    assert.equal(reminder.body.sendMode, 'manual-confirmation');

    const legacy = new FormData();
    legacy.append('file', new Blob(['Cliente;Lavoro;Data lavoro;Numero fattura;Totale fattura;Importo incassato;Data incasso\nCliente Excel;Davanzale;03/06/2031;LEG-1;300;100;04/06/2031\n'], { type: 'text/csv' }), 'storico.csv');
    const previewImport = await fetch(`${baseUrl}/imports/history/preview`, { method: 'POST', headers, body: legacy });
    assert.equal(previewImport.status, 200);
    const previewBody = await previewImport.json();
    assert.equal(previewBody.totalRows, 1);
    const xlsx = new PizZip();
    xlsx.folder('xl').file('sharedStrings.xml', '<sst><si><t>Cliente</t></si><si><t>Lavoro</t></si><si><t>Cliente XLSX</t></si><si><t>Scala</t></si></sst>');
    xlsx.folder('xl').folder('worksheets').file('sheet1.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row></sheetData></worksheet>');
    const xlsxPreview = new FormData();
    xlsxPreview.append('file', new Blob([xlsx.generate({ type: 'nodebuffer' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'storico.xlsx');
    const xlsxPreviewResponse = await fetch(`${baseUrl}/imports/history/preview`, { method: 'POST', headers, body: xlsxPreview });
    assert.equal(xlsxPreviewResponse.status, 200);
    assert.equal((await xlsxPreviewResponse.json()).sampleRows[0].Cliente, 'Cliente XLSX');
    const commitImport = new FormData();
    commitImport.append('file', new Blob(['Cliente;Lavoro;Data lavoro;Numero fattura;Totale fattura;Importo incassato;Data incasso\nCliente Excel;Davanzale;03/06/2031;LEG-1;300;100;04/06/2031\n'], { type: 'text/csv' }), 'storico.csv');
    commitImport.append('mapping', JSON.stringify(previewBody.suggestedMapping));
    const committedImport = await fetch(`${baseUrl}/imports/history/commit`, { method: 'POST', headers, body: commitImport });
    assert.equal(committedImport.status, 201);
    const committedBody = await committedImport.json();
    assert.equal(committedBody.imported.client, 1);
    assert.equal(committedBody.imported.payment, 1);

    const appointment = await requestJson(baseUrl, '/appointments', { method: 'POST', headers, body: JSON.stringify({ title: 'Sopralluogo', startAt: '2031-06-01T09:00', endAt: '2031-06-01T10:00', customerId: customer.body.id, projectId: project.body.id }) });
    assert.equal(appointment.response.status, 201);
    const appointmentUpdated = await requestJson(baseUrl, `/appointments/${appointment.body.id}`, { method: 'PUT', headers, body: JSON.stringify({ title: 'Sopralluogo confermato', version: appointment.body.version }) });
    assert.equal(appointmentUpdated.response.status, 200);
    const appointments = await requestJson(baseUrl, '/appointments', { headers });
    assert.equal(appointments.body.length, 1);

    const quote = await requestJson(baseUrl, '/quotes', { method: 'POST', headers, body: JSON.stringify({ date: '2031-06-01', customerId: customer.body.id, projectId: project.body.id, items: [{ description: 'Piano cucina', quantity: 2, unitPrice: 1200 }] }) });
    assert.equal(quote.response.status, 201);
    const template = await requestJson(baseUrl, '/quote-templates', { method: 'POST', headers, body: JSON.stringify({ name: 'Layout CI' }) });
    assert.equal(template.response.status, 201);
    const upload = new FormData();
    upload.append('files', new Blob([minimalWordTemplate()], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'layout-ci.docx');
    const uploaded = await fetch(`${baseUrl}/entity-attachments/quote_template/${template.body.id}`, { method: 'POST', headers, body: upload });
    assert.equal(uploaded.status, 201);
    const document = await fetch(`${baseUrl}/quotes/${quote.body.id}/document?templateId=${template.body.id}`, { headers });
    assert.equal(document.status, 200);
    const renderedXml = new PizZip(Buffer.from(await document.arrayBuffer())).file('word/document.xml').asText();
    assert.ok(renderedXml.includes(quote.body.quoteNumber));
    assert.ok(renderedXml.includes('Cliente Word'));
    assert.ok(renderedXml.includes('Piano cucina'));

    const gmailDraft = await requestJson(baseUrl, `/quotes/${quote.body.id}/gmail-draft`, { method: 'POST', headers, body: JSON.stringify({ templateId: template.body.id, subject: 'Preventivo CI', text: 'Buongiorno, trova allegato il preventivo.' }) });
    assert.equal(gmailDraft.response.status, 201);
    assert.equal(gmailDraft.body.id, 'gmail-draft-ci');
    assert.equal(gmailDrafts.length, 1);
    assert.equal(gmailDrafts[0].to, 'cliente@example.test');
    assert.equal(gmailDrafts[0].attachmentName, `preventivo-${quote.body.quoteNumber}.docx`);
    assert.ok(Buffer.isBuffer(gmailDrafts[0].attachment));

    const images = new FormData();
    for (let index = 0; index < 11; index += 1) images.append('files', new Blob(['x'], { type: 'image/png' }), `misura-${index}.png`);
    const imagesResponse = await fetch(`${baseUrl}/entity-attachments/project/${project.body.id}`, { method: 'POST', headers, body: images });
    assert.equal(imagesResponse.status, 201, 'Il progetto deve accettare più di dieci immagini');
    assert.equal((await imagesResponse.json()).length, 11);

    const exported = await requestJson(baseUrl, '/backup/export', { headers });
    assert.equal(exported.response.status, 200);
    const restoredJson = await requestJson(baseUrl, '/backup/import', { method: 'POST', headers, body: JSON.stringify(exported.body) });
    assert.equal(restoredJson.response.status, 200);
    assert.equal(restoredJson.body.preservedAttachments, 12);
    const relogin = await requestJson(baseUrl, '/auth/login', { method: 'POST', body: JSON.stringify({ username: user.username, password: 'Feature-password-123' }) });
    assert.equal(relogin.response.status, 200);
    const postRestoreHeaders = { Authorization: `Bearer ${relogin.body.token}` };
    const templateAttachments = await requestJson(baseUrl, `/entity-attachments/quote_template/${template.body.id}`, { headers: postRestoreHeaders });
    const projectAttachments = await requestJson(baseUrl, `/entity-attachments/project/${project.body.id}`, { headers: postRestoreHeaders });
    assert.equal(templateAttachments.body.length, 1, 'Import JSON deve mantenere allegati dei record presenti');
    assert.equal(projectAttachments.body.length, 11, 'Import JSON deve mantenere immagini progetto');
  } finally {
    if (instance) await instance.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
