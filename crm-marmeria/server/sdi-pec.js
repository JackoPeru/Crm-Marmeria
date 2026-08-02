const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { writePrivateTextAtomically } = require('./runtime-files');

const SDI_PEC_ADDRESS = 'sdi01@pec.fatturapa.it';
const ARUBA_SMTP = { host: 'smtps.pec.aruba.it', port: 465, secure: true };
const ARUBA_IMAP = { host: 'imaps.pec.aruba.it', port: 993, secure: true };
const XML_NAMESPACE = 'http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2';
const integrationError = (message, status = 400) => Object.assign(new Error(message), { status });
const xml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const text = (value) => String(value ?? '').trim();
const money = (value) => Number(Number(value || 0).toFixed(2));
const xmlMoney = (value) => money(value).toFixed(2);
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(value));
const validVat = (value) => /^\d{11}$/.test(text(value).replace(/\s/g, ''));
const validFiscalCode = (value) => /^(?:[A-Z0-9]{11}|[A-Z0-9]{16})$/i.test(text(value).replace(/\s/g, ''));
const validRecipientCode = (value) => /^[A-Z0-9]{7}$/i.test(text(value));
const dateOnly = (value) => /^\d{4}-\d{2}-\d{2}$/.test(text(value));
const tag = (name, value) => `<${name}>${xml(value)}</${name}>`;
const optionalTag = (name, value) => (text(value) ? tag(name, value) : '');

const normalizeCompany = (input = {}) => ({
  legalName: text(input.legalName), vatNumber: text(input.vatNumber).replace(/\s/g, ''),
  fiscalCode: text(input.fiscalCode).replace(/\s/g, ''), taxRegime: text(input.taxRegime || 'RF01').toUpperCase(),
  address: text(input.address), streetNumber: text(input.streetNumber), zip: text(input.zip),
  city: text(input.city), province: text(input.province).toUpperCase(), country: text(input.country || 'IT').toUpperCase(),
});

const normalizeClient = (input = {}) => ({
  name: text(input.name), firstName: text(input.firstName), lastName: text(input.lastName), clientType: text(input.clientType || input.type || 'Privato'),
  vatNumber: text(input.vatNumber).replace(/\s/g, ''), fiscalCode: text(input.fiscalCode).replace(/\s/g, ''),
  recipientCode: text(input.recipientCode || '0000000').toUpperCase(), recipientPec: text(input.recipientPec).toLowerCase(),
  address: text(input.address), streetNumber: text(input.streetNumber), zip: text(input.zip),
  city: text(input.city), province: text(input.province).toUpperCase(), country: text(input.country || 'IT').toUpperCase(),
});

const validationErrors = ({ company, client, invoice }) => {
  const errors = [];
  if (!company.legalName) errors.push('Ragione sociale cedente mancante');
  if (!validVat(company.vatNumber)) errors.push('Partita IVA cedente non valida');
  if (!validFiscalCode(company.fiscalCode || company.vatNumber)) errors.push('Codice fiscale cedente non valido');
  if (!/^RF\d{2}$/.test(company.taxRegime)) errors.push('Regime fiscale cedente non valido');
  for (const [label, value] of [['indirizzo cedente', company.address], ['CAP cedente', company.zip], ['comune cedente', company.city], ['provincia cedente', company.province]]) if (!value) errors.push(`${label} mancante`);
  if (!client.name) errors.push('Denominazione o nominativo cliente mancante');
  if (client.clientType === 'Privato' && (!client.firstName || !client.lastName)) errors.push('Nome e cognome cliente privato obbligatori per FatturaPA');
  if (!validVat(client.vatNumber) && !validFiscalCode(client.fiscalCode)) errors.push('Partita IVA o codice fiscale cliente non valido');
  if (!validRecipientCode(client.recipientCode)) errors.push('Codice destinatario cliente non valido');
  if (client.recipientCode === '0000000' && client.recipientPec && !validEmail(client.recipientPec)) errors.push('PEC destinatario cliente non valida');
  for (const [label, value] of [['indirizzo cliente', client.address], ['CAP cliente', client.zip], ['comune cliente', client.city], ['provincia cliente', client.province]]) if (!value) errors.push(`${label} mancante`);
  if (!text(invoice.invoiceNumber)) errors.push('Numero fattura mancante');
  if (!dateOnly(invoice.date)) errors.push('Data fattura non valida');
  if (!['TD01', 'TD03', 'TD04'].includes(text(invoice.documentType || 'TD01').toUpperCase())) errors.push('Tipo documento elettronico non supportato');
  if (!Array.isArray(invoice.items) || !invoice.items.length) errors.push('Inserire almeno una riga fattura');
  (invoice.items || []).forEach((item, index) => {
    if (!text(item.description)) errors.push(`Descrizione mancante nella riga ${index + 1}`);
    if (!(Number(item.quantity) > 0)) errors.push(`Quantità non valida nella riga ${index + 1}`);
    if (!(Number(item.unitPrice) >= 0)) errors.push(`Prezzo non valido nella riga ${index + 1}`);
    if (!(Number(item.taxRate) >= 0 && Number(item.taxRate) <= 100)) errors.push(`Aliquota IVA non valida nella riga ${index + 1}`);
    if (Number(item.taxRate) === 0 && !/^N[1-7](?:\.\d)?$/.test(text(item.taxNature))) errors.push(`Natura IVA obbligatoria nella riga ${index + 1} con IVA 0%`);
  });
  return errors;
};

const buildInvoiceXml = ({ company: companyInput, client: clientInput, invoice, progressive }) => {
  const company = normalizeCompany(companyInput);
  const client = normalizeClient(clientInput);
  const errors = validationErrors({ company, client, invoice });
  if (errors.length) throw integrationError(errors.join('; '), 422);
  const lines = invoice.items.map((item, index) => {
    const taxable = money(Number(item.quantity) * Number(item.unitPrice));
    const rate = money(item.taxRate);
    return `<DettaglioLinee>${tag('NumeroLinea', index + 1)}${tag('Descrizione', item.description)}${tag('Quantita', Number(item.quantity))}${tag('PrezzoUnitario', xmlMoney(item.unitPrice))}${tag('PrezzoTotale', xmlMoney(taxable))}${tag('AliquotaIVA', xmlMoney(rate))}${rate === 0 ? tag('Natura', text(item.taxNature).toUpperCase()) : ''}</DettaglioLinee>`;
  });
  const summaries = new Map();
  invoice.items.forEach((item) => {
    const rate = money(item.taxRate);
    const nature = rate === 0 ? text(item.taxNature).toUpperCase() : '';
    const key = `${rate}|${nature}`;
    const taxable = money(Number(item.quantity) * Number(item.unitPrice));
    const previous = summaries.get(key) || { rate, nature, taxable: 0, tax: 0 };
    previous.taxable = money(previous.taxable + taxable);
    previous.tax = money(previous.tax + taxable * (rate / 100));
    summaries.set(key, previous);
  });
  const taxBlocks = [...summaries.values()].map((summary) => `<DatiRiepilogo>${tag('AliquotaIVA', xmlMoney(summary.rate))}${summary.nature ? tag('Natura', summary.nature) : ''}${tag('ImponibileImporto', xmlMoney(summary.taxable))}${tag('Imposta', xmlMoney(summary.tax))}${summary.rate > 0 ? tag('EsigibilitaIVA', 'I') : ''}</DatiRiepilogo>`).join('');
  const total = money(invoice.total ?? invoice.amount ?? [...summaries.values()].reduce((sum, value) => sum + value.taxable + value.tax, 0));
  const customerTaxId = validVat(client.vatNumber)
    ? `<IdFiscaleIVA>${tag('IdPaese', client.country || 'IT')}${tag('IdCodice', client.vatNumber)}</IdFiscaleIVA>`
    : '';
  const supplierTaxId = `<IdFiscaleIVA>${tag('IdPaese', company.country || 'IT')}${tag('IdCodice', company.vatNumber)}</IdFiscaleIVA>`;
  const transmitterId = `<IdTrasmittente>${tag('IdPaese', company.country || 'IT')}${tag('IdCodice', company.vatNumber)}</IdTrasmittente>`;
  const customerAnagrafica = client.clientType === 'Privato'
    ? `<Anagrafica>${tag('Nome', client.firstName)}${tag('Cognome', client.lastName)}</Anagrafica>`
    : `<Anagrafica>${tag('Denominazione', client.name)}</Anagrafica>`;
  const payment = /^MP\d{2}$/.test(text(invoice.paymentMethod).toUpperCase())
    ? `\n<DatiPagamento>${tag('CondizioniPagamento', 'TP02')}<DettaglioPagamento>${tag('ModalitaPagamento', text(invoice.paymentMethod).toUpperCase())}${optionalTag('DataScadenzaPagamento', invoice.dueDate)}${tag('ImportoPagamento', xmlMoney(total))}</DettaglioPagamento></DatiPagamento>`
    : '';
  const filename = `IT${company.vatNumber}_${text(progressive).slice(0, 10)}.xml`;
  return {
    filename,
    xml: `<?xml version="1.0" encoding="UTF-8"?>\n<p:FatturaElettronica versione="FPR12" xmlns:p="${XML_NAMESPACE}" xmlns="${XML_NAMESPACE}">\n<FatturaElettronicaHeader>\n<DatiTrasmissione>${transmitterId}${tag('ProgressivoInvio', progressive)}${tag('FormatoTrasmissione', 'FPR12')}${tag('CodiceDestinatario', client.recipientCode)}${client.recipientCode === '0000000' && client.recipientPec ? tag('PECDestinatario', client.recipientPec) : ''}</DatiTrasmissione>\n<CedentePrestatore><DatiAnagrafici>${supplierTaxId}${optionalTag('CodiceFiscale', company.fiscalCode || company.vatNumber)}<Anagrafica>${tag('Denominazione', company.legalName)}</Anagrafica>${tag('RegimeFiscale', company.taxRegime)}</DatiAnagrafici><Sede>${tag('Indirizzo', company.address)}${optionalTag('NumeroCivico', company.streetNumber)}${tag('CAP', company.zip)}${tag('Comune', company.city)}${tag('Provincia', company.province)}${tag('Nazione', company.country || 'IT')}</Sede></CedentePrestatore>\n<CessionarioCommittente><DatiAnagrafici>${customerTaxId}${optionalTag('CodiceFiscale', client.fiscalCode)}${customerAnagrafica}</DatiAnagrafici><Sede>${tag('Indirizzo', client.address)}${optionalTag('NumeroCivico', client.streetNumber)}${tag('CAP', client.zip)}${tag('Comune', client.city)}${tag('Provincia', client.province)}${tag('Nazione', client.country || 'IT')}</Sede></CessionarioCommittente>\n</FatturaElettronicaHeader>\n<FatturaElettronicaBody><DatiGenerali><DatiGeneraliDocumento>${tag('TipoDocumento', text(invoice.documentType || 'TD01').toUpperCase())}${tag('Divisa', 'EUR')}${tag('Data', invoice.date)}${tag('Numero', invoice.invoiceNumber)}${tag('ImportoTotaleDocumento', xmlMoney(total))}${optionalTag('Causale', invoice.notes)}</DatiGeneraliDocumento></DatiGenerali>\n<DatiBeniServizi>${lines.join('')}${taxBlocks}</DatiBeniServizi>${payment}\n</FatturaElettronicaBody>\n</p:FatturaElettronica>\n`,
  };
};

const receiptStatus = (content) => {
  const value = String(content || '');
  if (/NotificaScarto|<TipoRicevuta>NS<\/TipoRicevuta>/i.test(value)) return 'scartata';
  if (/RicevutaConsegna|<TipoRicevuta>RC<\/TipoRicevuta>/i.test(value)) return 'consegnata';
  if (/NotificaMancataConsegna|<TipoRicevuta>MC<\/TipoRicevuta>/i.test(value)) return 'mancata_consegna';
  return null;
};
const referencedFilename = (content) => (String(content || '').match(/IT\d{11}_[A-Z0-9]{1,10}\.xml/i) || [])[0] || null;

const createSdiPecService = ({ dataDir, transportFactory = nodemailer.createTransport, imapFactory = (config) => new ImapFlow(config), parseEmail = simpleParser } = {}) => {
  if (!dataDir) throw new Error('Cartella dati SdI PEC mancante');
  const configPath = path.join(dataDir, 'sdi-pec.json');
  const keyPath = path.join(dataDir, '.sdi-pec-key');
  const archiveDir = path.join(dataDir, 'electronic-invoices');
  const key = () => {
    try { const current = Buffer.from(fs.readFileSync(keyPath, 'utf8').trim(), 'base64url'); if (current.length === 32) return current; } catch { /* crea */ }
    const generated = crypto.randomBytes(32); writePrivateTextAtomically(keyPath, generated.toString('base64url')); return generated;
  };
  const encrypt = (value) => { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv); const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]); return { iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), ciphertext: ciphertext.toString('base64url') }; };
  const decrypt = (value) => { try { const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(value.iv, 'base64url')); decipher.setAuthTag(Buffer.from(value.tag, 'base64url')); return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64url')), decipher.final()]).toString('utf8')); } catch { throw integrationError('Credenziali PEC non leggibili. Salvale di nuovo.', 409); } };
  const read = () => { try { const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')); return { company: normalizeCompany(raw.company), email: text(raw.email).toLowerCase(), secret: raw.secret || null }; } catch { return { company: normalizeCompany(), email: '', secret: null }; } };
  const write = (config) => writePrivateTextAtomically(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const status = () => { const config = read(); const companyReady = Boolean(config.company.legalName && validVat(config.company.vatNumber) && validFiscalCode(config.company.fiscalCode || config.company.vatNumber) && config.company.address && config.company.zip && config.company.city && config.company.province); return { provider: 'aruba-pec', configured: Boolean(config.email && config.secret && companyReady), email: config.email || null, hasPassword: Boolean(config.secret), company: config.company, smtp: ARUBA_SMTP, imap: ARUBA_IMAP }; };
  const configure = ({ company, email, password }) => {
    const previous = read(); const nextEmail = text(email || previous.email).toLowerCase();
    if (nextEmail && !validEmail(nextEmail)) throw integrationError('Indirizzo PEC Aruba non valido');
    const nextCompany = normalizeCompany({ ...previous.company, ...(company || {}) });
    const nextSecret = text(password) ? encrypt({ password: String(password) }) : previous.secret;
    write({ company: nextCompany, email: nextEmail, secret: nextSecret }); return status();
  };
  const account = () => { const config = read(); if (!config.email || !config.secret) throw integrationError('Configura PEC Aruba e password dedicata nelle Impostazioni', 409); const credentials = decrypt(config.secret); return { config, password: String(credentials.password || '') }; };
  const smtp = ({ email, password }) => transportFactory({ host: ARUBA_SMTP.host, port: ARUBA_SMTP.port, secure: true, auth: { user: email, pass: password }, tls: { minVersion: 'TLSv1.2' } });
  const imap = ({ email, password }) => imapFactory({ host: ARUBA_IMAP.host, port: ARUBA_IMAP.port, secure: true, auth: { user: email, pass: password }, tls: { minVersion: 'TLSv1.2' }, logger: false });
  const testConnection = async () => { const current = account(); const transport = smtp({ email: current.config.email, password: current.password }); await transport.verify(); const client = imap({ email: current.config.email, password: current.password }); try { await client.connect(); await client.mailboxOpen('INBOX', { readOnly: true }); } finally { await client.logout().catch(() => {}); } return { verified: true, email: current.config.email, smtp: ARUBA_SMTP, imap: ARUBA_IMAP }; };
  const prepare = ({ invoice, client, progressive }) => { const current = account(); return { company: current.config.company, ...buildInvoiceXml({ company: current.config.company, client, invoice, progressive }) }; };
  const archiveXml = ({ invoiceId, filename, content }) => { const folder = path.join(archiveDir, String(invoiceId)); fs.mkdirSync(folder, { recursive: true }); const destination = path.join(folder, filename); writePrivateTextAtomically(destination, content); return destination; };
  const send = async ({ invoice, client, progressive }) => { const current = account(); const prepared = buildInvoiceXml({ company: current.config.company, client, invoice, progressive }); const archivedPath = archiveXml({ invoiceId: invoice.id, filename: prepared.filename, content: prepared.xml }); const transport = smtp({ email: current.config.email, password: current.password }); const response = await transport.sendMail({ from: current.config.email, to: SDI_PEC_ADDRESS, subject: prepared.filename, text: `Trasmissione fattura elettronica ${prepared.filename}`, attachments: [{ filename: prepared.filename, content: prepared.xml, contentType: 'application/xml' }] }); return { ...prepared, archivedPath, messageId: String(response.messageId || ''), accepted: response.accepted || [] }; };
  const pollReceipts = async ({ onReceipt }) => {
    const current = account(); const client = imap({ email: current.config.email, password: current.password }); let changed = 0;
    try {
      await client.connect(); await client.mailboxOpen('INBOX');
      for await (const message of client.fetch({ seen: false }, { uid: true, envelope: true, source: true })) {
        const source = message.source || Buffer.alloc(0);
        const parsed = await parseEmail(source);
        const parts = [String(parsed.text || ''), String(parsed.html || ''), ...(parsed.attachments || []).map((attachment) => Buffer.from(attachment.content || '').toString('utf8'))];
        const receipt = parts.map((content) => ({ content, state: receiptStatus(content), filename: referencedFilename(content) })).find((entry) => entry.state && entry.filename);
        if (receipt && await onReceipt({ state: receipt.state, filename: receipt.filename, raw: receipt.content, receivedAt: new Date().toISOString() })) {
          await client.messageFlagsAdd(message.uid, ['\\Seen'], { uid: true });
          changed += 1;
        }
      }
    } finally { await client.logout().catch(() => {}); }
    return { changed };
  };
  return { status, configure, testConnection, prepare, send, pollReceipts, validationErrors, archiveXml };
};

module.exports = { ARUBA_SMTP, ARUBA_IMAP, SDI_PEC_ADDRESS, buildInvoiceXml, validationErrors, createSdiPecService };
