const fs = require('fs');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');

const euro = new Intl.NumberFormat('it-IT', {
  style: 'currency', currency: 'EUR', minimumFractionDigits: 2,
});
const date = new Intl.DateTimeFormat('it-IT');

const formatDate = (value) => {
  if (!value) return '';
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
    ? new Date(`${value}T00:00:00`)
    : new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : date.format(parsed);
};
const number = (value) => Number(value || 0);
const text = (value) => String(value ?? '');
const xml = (value) => text(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const imageInfo = (attachment) => {
  const mime = String(attachment?.mimeType || '').toLowerCase();
  const extension = mime === 'image/png'
    ? 'png'
    : mime === 'image/jpeg' || mime === 'image/jpg'
      ? 'jpeg'
      : '';
  if (!extension || !attachment?.absolutePath || !fs.existsSync(attachment.absolutePath)) return null;
  try {
    return { extension, buffer: fs.readFileSync(attachment.absolutePath) };
  } catch {
    return null;
  }
};

const ensureNamespace = (documentXml, prefix, uri) => (
  documentXml.includes(`xmlns:${prefix}=`)
    ? documentXml
    : documentXml.replace('<w:document', `<w:document xmlns:${prefix}="${uri}"`)
);

const nextRelationshipId = (relationships) => {
  const ids = [...relationships.matchAll(/Id="rId(\d+)"/g)].map((match) => Number(match[1]));
  return `rId${Math.max(0, ...ids) + 1}`;
};

const appendRelationship = (relationships, id, target) => {
  const entry = `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${xml(target)}"/>`;
  return relationships.replace('</Relationships>', `${entry}</Relationships>`);
};

const appendContentType = (contentTypes, extension) => {
  const contentType = extension === 'png' ? 'image/png' : 'image/jpeg';
  if (new RegExp(`Extension="${extension}"`, 'i').test(contentTypes)) return contentTypes;
  return contentTypes.replace('</Types>', `<Default Extension="${extension}" ContentType="${contentType}"/></Types>`);
};

const pictureXml = ({ relationshipId, name, id }) => {
  const cx = 5486400;
  const cy = 3657600;
  return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="${xml(name)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${xml(name)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr bwMode="auto"><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
};

const appendExportPhotos = (zip, documentXml, attachments) => {
  const photos = attachments.map((attachment, index) => ({ attachment, info: imageInfo(attachment), index })).filter((item) => item.info);
  if (!photos.length) return documentXml;
  let relationships = zip.file('word/_rels/document.xml.rels')?.asText()
    || '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  let contentTypes = zip.file('[Content_Types].xml')?.asText()
    || '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>';
  let nextId = 1000;
  const blocks = ['<w:p><w:r><w:br w:type="page"/></w:r></w:p><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Foto preventivo</w:t></w:r></w:p>'];
  photos.forEach(({ attachment, info, index }) => {
    const mediaName = `crm-photo-${index + 1}.${info.extension}`;
    const relationshipId = nextRelationshipId(relationships);
    zip.file(`word/media/${mediaName}`, info.buffer);
    relationships = appendRelationship(relationships, relationshipId, `media/${mediaName}`);
    contentTypes = appendContentType(contentTypes, info.extension);
    const caption = text(attachment.caption).trim();
    if (caption) blocks.push(`<w:p><w:r><w:t xml:space="preserve">${xml(caption)}</w:t></w:r></w:p>`);
    blocks.push(pictureXml({ relationshipId, name: attachment.originalName || mediaName, id: nextId }));
    nextId += 1;
  });
  zip.file('word/_rels/document.xml.rels', relationships);
  zip.file('[Content_Types].xml', contentTypes);
  const withNamespaces = [
    ['wp', 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'],
    ['a', 'http://schemas.openxmlformats.org/drawingml/2006/main'],
    ['pic', 'http://schemas.openxmlformats.org/drawingml/2006/picture'],
    ['r', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'],
  ].reduce((value, [prefix, uri]) => ensureNamespace(value, prefix, uri), documentXml);
  const insertion = withNamespaces.indexOf('<w:sectPr');
  const at = insertion >= 0 ? insertion : withNamespaces.indexOf('</w:body>');
  if (at < 0) return withNamespaces;
  return `${withNamespaces.slice(0, at)}${blocks.join('')}${withNamespaces.slice(at)}`;
};

const quoteTemplateData = ({ quote, customer, project, attachments = [] }) => {
  const validityDays = Number(quote.validityDays);
  const validUntil = Number.isInteger(validityDays) && validityDays > 0 && quote.date
    ? new Date(new Date(`${String(quote.date).slice(0, 10)}T00:00:00`).getTime()
      + validityDays * 86400000)
    : null;
  const items = Array.isArray(quote.items) ? quote.items : [];
  return {
    quote_number: text(quote.quoteNumber),
    quote_date: formatDate(quote.date),
    quote_valid_until: validUntil ? date.format(validUntil) : 'Senza scadenza',
    quote_status: text(quote.status),
    quote_notes: text(quote.notes),
    payment_details: text(quote.paymentDetails),
    customer_name: text(customer?.name),
    customer_email: text(customer?.email),
    customer_phone: text(customer?.phone),
    customer_address: text(customer?.address),
    customer_city: text(customer?.city),
    customer_vat_number: text(customer?.vatNumber),
    project_name: text(project?.name || project?.title),
    subtotal: euro.format(number(quote.subtotal ?? quote.total)),
    tax_total: euro.format(number(quote.taxTotal)),
    total: euro.format(number(quote.total)),
    attachments: attachments.map((attachment, index) => ({
      row_number: index + 1,
      file_name: text(attachment.originalName),
      caption: text(attachment.caption),
    })),
    items: items.map((item, index) => ({
      row_number: index + 1,
      description: text(item.description),
      quantity: number(item.quantity).toLocaleString('it-IT', { maximumFractionDigits: 3 }),
      unit_price: euro.format(number(item.unitPrice)),
      line_total: euro.format(number(item.quantity) * number(item.unitPrice)),
    })),
  };
};

const renderQuoteDocument = ({ templatePath, quote, customer, project, attachments = [] }) => {
  const zip = new PizZip(fs.readFileSync(templatePath));
  const document = new Docxtemplater(zip, {
    delimiters: { start: '{{', end: '}}' },
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => '',
  });
  document.render(quoteTemplateData({ quote, customer, project, attachments }));
  const renderedZip = document.getZip();
  const documentXml = renderedZip.file('word/document.xml')?.asText() || '';
  renderedZip.file('word/document.xml', appendExportPhotos(renderedZip, documentXml, attachments));
  return renderedZip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
};

module.exports = { renderQuoteDocument };
