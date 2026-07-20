import { describe, it, expect } from 'vitest';
import {
  buildQuotationHtml,
  buildInvoiceHtml,
  escapeHtml,
  type QuotationDoc,
  type InvoiceDoc
} from './documents';

const baseQuotation: QuotationDoc = {
  number: 'QT-1001',
  businessName: 'SaarthiOne Traders',
  customerName: 'Ravi Kumar',
  customerPhone: '+91 90000 00000',
  issuedAt: '2026-07-19',
  validUntil: '2026-08-19',
  items: [
    { title: 'Consulting', quantity: 2, unitPrice: 5000 },
    { title: 'Setup fee', description: 'One-time', quantity: 1, unitPrice: 1500 }
  ]
};

const baseInvoice: InvoiceDoc = {
  number: 'INV-2001',
  businessName: 'SaarthiOne Traders',
  customerName: 'Ravi Kumar',
  issuedAt: '2026-07-19',
  dueDate: '2026-07-29',
  status: 'partially_paid',
  taxRate: 0.18,
  amountPaid: 5000,
  items: [
    { title: 'Widget', quantity: 10, unitPrice: 1000 }
  ]
};

describe('escapeHtml', () => {
  it('escapes HTML-significant characters', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
    );
  });
});

describe('buildQuotationHtml', () => {
  it('is a complete self-contained HTML document with number and business name', () => {
    const html = buildQuotationHtml(baseQuotation);
    expect(html.toLowerCase().startsWith('<!doctype html')).toBe(true);
    expect(html).toContain('QT-1001');
    expect(html).toContain('SaarthiOne Traders');
    expect(html).toContain('</html>');
    // self-contained: no external assets
    expect(html).not.toMatch(/https?:\/\//);
  });

  it('computes line amounts, subtotal and total', () => {
    const html = buildQuotationHtml(baseQuotation);
    // 2 * 5000 = 10000, 1 * 1500 = 1500, subtotal/total = 11500
    expect(html).toContain('₹10,000');
    expect(html).toContain('₹1,500');
    expect(html).toContain('₹11,500');
  });

  it('HTML-escapes user-supplied item titles', () => {
    const html = buildQuotationHtml({
      ...baseQuotation,
      items: [{ title: '<script>alert(1)</script>', quantity: 1, unitPrice: 100 }]
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('buildInvoiceHtml', () => {
  it('is a complete self-contained HTML document with number and business name', () => {
    const html = buildInvoiceHtml(baseInvoice);
    expect(html.toLowerCase().startsWith('<!doctype html')).toBe(true);
    expect(html).toContain('INV-2001');
    expect(html).toContain('SaarthiOne Traders');
  });

  it('applies taxRate, computes total and balance due from amountPaid', () => {
    const html = buildInvoiceHtml(baseInvoice);
    // subtotal = 10 * 1000 = 10000, tax = 1800, total = 11800, paid 5000, balance 6800
    expect(html).toContain('₹10,000'); // subtotal
    expect(html).toContain('₹1,800'); // tax
    expect(html).toContain('₹11,800'); // total
    expect(html).toContain('₹5,000'); // amount paid
    expect(html).toContain('₹6,800'); // balance due
  });

  it('shows the status badge', () => {
    const html = buildInvoiceHtml(baseInvoice);
    expect(html).toContain('badge partially_paid');
    expect(html).toContain('partially paid');
  });

  it('omits the tax row when taxRate is 0 or unset', () => {
    const html = buildInvoiceHtml({ ...baseInvoice, taxRate: 0 });
    expect(html).not.toContain('Tax (');
  });

  it('formats non-INR currency as "CUR value"', () => {
    const html = buildInvoiceHtml({
      ...baseInvoice,
      currency: 'USD',
      taxRate: 0,
      amountPaid: 0,
      items: [{ title: 'Item', quantity: 1, unitPrice: 42 }]
    });
    expect(html).toContain('USD 42');
    expect(html).not.toContain('₹');
  });
});
