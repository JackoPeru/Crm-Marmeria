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
    permissions: ['clients.view', 'clients.create', 'projects.view', 'projects.create', 'projects.edit', 'quotes.view', 'quotes.create', 'quotes.edit', 'calendar.view', 'calendar.create', 'calendar.edit', 'calendar.delete'],
  };
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'users.json'), JSON.stringify([user]));
  let instance;
  try {
    instance = await createCrmServer({ port: 0, host: '127.0.0.1', dataDir, backupDir: path.join(root, 'backups'), attachmentsDir: path.join(root, 'attachments') });
    const baseUrl = `http://127.0.0.1:${instance.port}/api`;
    const login = await requestJson(baseUrl, '/auth/login', { method: 'POST', body: JSON.stringify({ username: user.username, password: 'Feature-password-123' }) });
    assert.equal(login.response.status, 200);
    const headers = { Authorization: `Bearer ${login.body.token}` };
    const customer = await requestJson(baseUrl, '/clients', { method: 'POST', headers, body: JSON.stringify({ name: 'Cliente Word', email: 'cliente@example.test', phone: '+39 333 1234567' }) });
    const project = await requestJson(baseUrl, '/projects', { method: 'POST', headers, body: JSON.stringify({ name: 'Cucina marmo', clientId: customer.body.id }) });
    assert.equal(customer.response.status, 201); assert.equal(project.response.status, 201);

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

    const images = new FormData();
    for (let index = 0; index < 11; index += 1) images.append('files', new Blob(['x'], { type: 'image/png' }), `misura-${index}.png`);
    const imagesResponse = await fetch(`${baseUrl}/entity-attachments/project/${project.body.id}`, { method: 'POST', headers, body: images });
    assert.equal(imagesResponse.status, 201, 'Il progetto deve accettare più di dieci immagini');
    assert.equal((await imagesResponse.json()).length, 11);
  } finally {
    if (instance) await instance.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
