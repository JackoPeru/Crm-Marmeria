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

const quoteTemplateData = ({ quote, customer, project }) => {
  const validUntil = quote.validityDays && quote.date
    ? new Date(new Date(`${String(quote.date).slice(0, 10)}T00:00:00`).getTime()
      + Number(quote.validityDays) * 86400000)
    : null;
  const items = Array.isArray(quote.items) ? quote.items : [];
  return {
    quote_number: text(quote.quoteNumber),
    quote_date: formatDate(quote.date),
    quote_valid_until: validUntil ? date.format(validUntil) : '',
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
    items: items.map((item, index) => ({
      row_number: index + 1,
      description: text(item.description),
      quantity: number(item.quantity).toLocaleString('it-IT', { maximumFractionDigits: 3 }),
      unit_price: euro.format(number(item.unitPrice)),
      line_total: euro.format(number(item.quantity) * number(item.unitPrice)),
    })),
  };
};

const renderQuoteDocument = ({ templatePath, quote, customer, project }) => {
  const zip = new PizZip(fs.readFileSync(templatePath));
  const document = new Docxtemplater(zip, {
    delimiters: { start: '{{', end: '}}' },
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => '',
  });
  document.render(quoteTemplateData({ quote, customer, project }));
  return document.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
};

module.exports = { renderQuoteDocument };
