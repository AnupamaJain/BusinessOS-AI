export interface DocumentLineItem {
  title: string;
  description?: string;
  quantity: number;
  unitPrice: number;
}

export interface QuotationDoc {
  number: string;
  businessName: string;
  customerName?: string;
  customerPhone?: string;
  currency?: string;
  issuedAt: string;
  validUntil?: string;
  items: DocumentLineItem[];
  notes?: string;
}

export type InvoiceStatus = 'unpaid' | 'paid' | 'partially_paid';

export interface InvoiceDoc {
  number: string;
  businessName: string;
  customerName?: string;
  customerPhone?: string;
  currency?: string;
  issuedAt: string;
  dueDate?: string;
  status?: InvoiceStatus;
  items: DocumentLineItem[];
  amountPaid?: number;
  taxRate?: number;
  notes?: string;
}

/**
 * Escape a user-supplied string so it is safe to interpolate into HTML text or
 * attribute values. Used on every dynamic string rendered into the document.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMoney(value: number, currency: string): string {
  if (currency === 'INR') {
    return `₹${value.toLocaleString('en-IN')}`;
  }
  return `${currency} ${value}`;
}

interface ComputedLine {
  title: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

function computeLines(items: DocumentLineItem[]): { lines: ComputedLine[]; subtotal: number } {
  const lines = items.map(item => ({
    title: item.title,
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    amount: item.quantity * item.unitPrice
  }));
  const subtotal = lines.reduce((sum, line) => sum + line.amount, 0);
  return { lines, subtotal };
}

const BASE_STYLES = `
  :root {
    --navy: #0B1220;
    --cyan: #00F2FE;
    --ink: #1a2233;
    --muted: #64748b;
    --line: #e2e8f0;
    --paper: #ffffff;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: var(--ink);
    background: #f1f5f9;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  .page {
    max-width: 800px;
    margin: 24px auto;
    background: var(--paper);
    box-shadow: 0 10px 30px rgba(11, 18, 32, 0.12);
    border-radius: 10px;
    overflow: hidden;
  }
  .header {
    background: var(--navy);
    color: #ffffff;
    padding: 28px 40px;
    border-bottom: 4px solid var(--cyan);
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 24px;
  }
  .header .brand { font-size: 22px; font-weight: 700; letter-spacing: 0.2px; }
  .header .brand .accent { color: var(--cyan); }
  .header .doc-meta { text-align: right; }
  .header .doc-type {
    text-transform: uppercase;
    letter-spacing: 2px;
    font-size: 13px;
    color: var(--cyan);
    font-weight: 600;
  }
  .header .doc-number { font-size: 18px; font-weight: 600; margin-top: 4px; }
  .body { padding: 32px 40px; }
  .customer { margin-bottom: 24px; }
  .customer h2 {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--muted);
    margin: 0 0 6px;
  }
  .customer .name { font-size: 16px; font-weight: 600; }
  .customer .phone { color: var(--muted); font-size: 14px; }
  table.items {
    width: 100%;
    border-collapse: collapse;
    margin: 8px 0 20px;
  }
  table.items thead th {
    background: #f8fafc;
    text-align: left;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--muted);
    padding: 10px 12px;
    border-bottom: 2px solid var(--line);
  }
  table.items tbody td {
    padding: 12px;
    border-bottom: 1px solid var(--line);
    vertical-align: top;
    font-size: 14px;
  }
  table.items .item-title { font-weight: 600; }
  table.items .item-desc { color: var(--muted); font-size: 13px; margin-top: 2px; }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-feature-settings: 'tnum';
    white-space: nowrap;
  }
  .totals { margin-left: auto; width: 320px; max-width: 100%; }
  .totals .row {
    display: flex;
    justify-content: space-between;
    padding: 8px 12px;
    font-size: 14px;
  }
  .totals .row.grand {
    border-top: 2px solid var(--navy);
    margin-top: 4px;
    font-size: 16px;
    font-weight: 700;
    color: var(--navy);
  }
  .totals .row .label { color: var(--muted); }
  .totals .row.grand .label { color: var(--navy); }
  .badge {
    display: inline-block;
    padding: 4px 12px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
  }
  .badge.paid { background: #dcfce7; color: #166534; }
  .badge.unpaid { background: #fee2e2; color: #991b1b; }
  .badge.partially_paid { background: #fef9c3; color: #854d0e; }
  .footer {
    padding: 24px 40px 36px;
    border-top: 1px solid var(--line);
    color: var(--muted);
    font-size: 13px;
  }
  .footer .meta { display: flex; flex-wrap: wrap; gap: 24px; margin-bottom: 12px; }
  .footer .meta .label { text-transform: uppercase; font-size: 11px; letter-spacing: 0.6px; }
  .footer .notes { white-space: pre-wrap; color: var(--ink); }
  @media print {
    body { background: #ffffff; }
    .page { box-shadow: none; margin: 0; max-width: none; border-radius: 0; }
    @page { size: A4; margin: 12mm; }
  }
`;

function renderItemsTable(lines: ComputedLine[], currency: string): string {
  const rows = lines.map(line => {
    const desc = line.description
      ? `<div class="item-desc">${escapeHtml(line.description)}</div>`
      : '';
    return `        <tr>
          <td><div class="item-title">${escapeHtml(line.title)}</div>${desc}</td>
          <td class="num">${line.quantity}</td>
          <td class="num">${formatMoney(line.unitPrice, currency)}</td>
          <td class="num">${formatMoney(line.amount, currency)}</td>
        </tr>`;
  }).join('\n');

  return `      <table class="items">
        <thead>
          <tr>
            <th>Item</th>
            <th class="num">Qty</th>
            <th class="num">Unit Price</th>
            <th class="num">Amount</th>
          </tr>
        </thead>
        <tbody>
${rows}
        </tbody>
      </table>`;
}

function renderCustomer(name?: string, phone?: string): string {
  if (!name && !phone) {
    return '';
  }
  const nameLine = name ? `<div class="name">${escapeHtml(name)}</div>` : '';
  const phoneLine = phone ? `<div class="phone">${escapeHtml(phone)}</div>` : '';
  return `      <div class="customer">
        <h2>Billed To</h2>
        ${nameLine}
        ${phoneLine}
      </div>`;
}

function renderHeader(businessName: string, docType: string, number: string): string {
  return `    <div class="header">
      <div class="brand">${escapeHtml(businessName)}</div>
      <div class="doc-meta">
        <div class="doc-type">${escapeHtml(docType)}</div>
        <div class="doc-number">${escapeHtml(number)}</div>
      </div>
    </div>`;
}

function renderNotes(notes?: string): string {
  if (!notes) {
    return '';
  }
  return `<div class="notes">${escapeHtml(notes)}</div>`;
}

function wrapDocument(title: string, inner: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>${BASE_STYLES}</style>
</head>
<body>
  <div class="page">
${inner}
  </div>
</body>
</html>`;
}

export function buildQuotationHtml(doc: QuotationDoc): string {
  const currency = doc.currency ?? 'INR';
  const { lines, subtotal } = computeLines(doc.items);
  const total = subtotal;

  const header = renderHeader(doc.businessName, 'Quotation', doc.number);
  const customer = renderCustomer(doc.customerName, doc.customerPhone);
  const table = renderItemsTable(lines, currency);

  const totals = `      <div class="totals">
        <div class="row"><span class="label">Subtotal</span><span class="num">${formatMoney(subtotal, currency)}</span></div>
        <div class="row grand"><span class="label">Total</span><span class="num">${formatMoney(total, currency)}</span></div>
      </div>`;

  const validUntil = doc.validUntil
    ? `        <div><div class="label">Valid Until</div>${escapeHtml(doc.validUntil)}</div>`
    : '';

  const footer = `    <div class="footer">
      <div class="meta">
        <div><div class="label">Issued</div>${escapeHtml(doc.issuedAt)}</div>
${validUntil}
      </div>
      ${renderNotes(doc.notes)}
    </div>`;

  const inner = `${header}
    <div class="body">
${customer}
${table}
${totals}
    </div>
${footer}`;

  return wrapDocument(`Quotation ${doc.number}`, inner);
}

export function buildInvoiceHtml(doc: InvoiceDoc): string {
  const currency = doc.currency ?? 'INR';
  const taxRate = doc.taxRate ?? 0;
  const amountPaid = doc.amountPaid ?? 0;
  const status: InvoiceStatus = doc.status ?? 'unpaid';

  const { lines, subtotal } = computeLines(doc.items);
  const tax = subtotal * taxRate;
  const total = subtotal + tax;
  const balanceDue = total - amountPaid;

  const header = renderHeader(doc.businessName, 'Invoice', doc.number);
  const customer = renderCustomer(doc.customerName, doc.customerPhone);
  const table = renderItemsTable(lines, currency);

  const statusLabel = status.replace('_', ' ');
  const badge = `<span class="badge ${status}">${escapeHtml(statusLabel)}</span>`;

  const taxRow = taxRate > 0
    ? `        <div class="row"><span class="label">Tax (${(taxRate * 100).toLocaleString('en-IN')}%)</span><span class="num">${formatMoney(tax, currency)}</span></div>`
    : '';

  const totals = `      <div class="totals">
        <div class="row"><span class="label">Subtotal</span><span class="num">${formatMoney(subtotal, currency)}</span></div>
${taxRow}
        <div class="row grand"><span class="label">Total</span><span class="num">${formatMoney(total, currency)}</span></div>
        <div class="row"><span class="label">Amount Paid</span><span class="num">${formatMoney(amountPaid, currency)}</span></div>
        <div class="row"><span class="label">Balance Due</span><span class="num">${formatMoney(balanceDue, currency)}</span></div>
      </div>`;

  const dueDate = doc.dueDate
    ? `        <div><div class="label">Due Date</div>${escapeHtml(doc.dueDate)}</div>`
    : '';

  const footer = `    <div class="footer">
      <div class="meta">
        <div><div class="label">Issued</div>${escapeHtml(doc.issuedAt)}</div>
${dueDate}
      </div>
      ${renderNotes(doc.notes)}
    </div>`;

  const inner = `${header}
    <div class="body">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        ${customer || '<div></div>'}
        <div>${badge}</div>
      </div>
${table}
${totals}
    </div>
${footer}`;

  return wrapDocument(`Invoice ${doc.number}`, inner);
}
