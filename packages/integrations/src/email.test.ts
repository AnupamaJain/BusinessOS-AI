import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  EmailService,
  createEmailServiceFromEnv,
  buildBookingConfirmationEmail,
  buildQuotationEmail,
  buildFollowUpEmail,
  escapeHtml
} from './email';

describe('EmailService.send', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to the Resend API with Bearer auth and correct body, returning id on 201', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 201,
      json: async () => ({ id: 'email_abc123' })
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new EmailService({
      apiKey: 'resend_test_key',
      fromEmail: 'hello@saarthi.one',
      fromName: 'SaarthiOne'
    });

    const result = await service.send({
      to: 'customer@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
      replyTo: 'support@saarthi.one'
    });

    expect(result).toEqual({ sent: true, id: 'email_abc123' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');

    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer resend_test_key');
    expect(headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(init.body as string);
    expect(body.from).toBe('SaarthiOne <hello@saarthi.one>');
    expect(body.to).toEqual(['customer@example.com']);
    expect(body.subject).toBe('Hello');
    expect(body.html).toBe('<p>Hi</p>');
    expect(body.reply_to).toBe('support@saarthi.one');
  });

  it('returns { skipped: true } and does not call fetch when no API key is set', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const service = new EmailService({ fromEmail: 'hello@saarthi.one' });
    const result = await service.send({
      to: 'a@b.com',
      subject: 's',
      html: '<p>x</p>'
    });

    expect(result).toEqual({
      sent: false,
      skipped: true,
      error: 'RESEND_API_KEY not configured'
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns an error result on a non-2xx response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 422,
      text: async () => 'invalid from address'
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new EmailService({ apiKey: 'k', fromEmail: 'x@y.com' });
    const result = await service.send({ to: 'a@b.com', subject: 's', html: 'h' });

    expect(result.sent).toBe(false);
    expect(result.error).toBe('invalid from address');
  });

  it('defaults fromName to SaarthiOne', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ id: 'id1' })
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new EmailService({ apiKey: 'k', fromEmail: 'x@y.com' });
    await service.send({ to: 'a@b.com', subject: 's', html: 'h' });

    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string
    );
    expect(body.from).toBe('SaarthiOne <x@y.com>');
  });
});

describe('createEmailServiceFromEnv', () => {
  it('reads RESEND_API_KEY / EMAIL_FROM / EMAIL_FROM_NAME with defaults', async () => {
    const svc = createEmailServiceFromEnv({});
    expect(svc.isConfigured).toBe(false);

    const configured = createEmailServiceFromEnv({ RESEND_API_KEY: 'k' });
    expect(configured.isConfigured).toBe(true);
  });
});

describe('escapeHtml', () => {
  it('escapes HTML-significant characters', () => {
    expect(escapeHtml('<b>Bob & "Co"</b>')).toBe(
      '&lt;b&gt;Bob &amp; &quot;Co&quot;&lt;/b&gt;'
    );
  });
});

describe('template builders', () => {
  it('buildBookingConfirmationEmail escapes a name containing <b>', () => {
    const { subject, html } = buildBookingConfirmationEmail({
      businessName: 'Acme',
      customerName: '<b>Mallory</b>',
      bookingNumber: 'BK-1',
      summary: 'City tour',
      amountText: '₹5,000'
    });
    expect(subject).toContain('BK-1');
    expect(html).not.toContain('<b>Mallory</b>');
    expect(html).toContain('&lt;b&gt;Mallory&lt;/b&gt;');
    expect(html.toLowerCase().startsWith('<!doctype html')).toBe(true);
    // self-contained: no external assets
    expect(html).not.toMatch(/https?:\/\//);
  });

  it('buildQuotationEmail escapes the customer name and includes the view link', () => {
    const { html } = buildQuotationEmail({
      businessName: 'Acme',
      customerName: '<b>x</b>',
      quotationNumber: 'QT-9',
      viewUrl: 'https://app.example.com/q/9',
      amountText: '₹1,200'
    });
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('https://app.example.com/q/9');
    expect(html).toContain('QT-9');
  });

  it('buildFollowUpEmail escapes injected markup in the message', () => {
    const { html } = buildFollowUpEmail({
      businessName: 'Acme',
      customerName: '<b>n</b>',
      message: 'Ping <b>please</b>'
    });
    expect(html).not.toContain('<b>please</b>');
    expect(html).toContain('&lt;b&gt;please&lt;/b&gt;');
  });
});
