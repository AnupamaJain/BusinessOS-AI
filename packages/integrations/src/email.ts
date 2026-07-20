/**
 * Email automation via the Resend HTTP API.
 *
 * Pure `fetch` — no SDK dependency. Degrades gracefully when no API key is
 * configured: {@link EmailService.send} returns a clear "skipped" result rather
 * than throwing, so callers can run without email credentials in dev/test.
 */

export interface EmailServiceConfig {
  apiKey?: string;
  fromEmail?: string;
  fromName?: string;
}

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}

export interface SendEmailResult {
  sent: boolean;
  id?: string;
  error?: string;
  skipped?: boolean;
}

export interface EmailTemplate {
  subject: string;
  html: string;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const DEFAULT_FROM_NAME = 'SaarthiOne';

/**
 * Escape HTML-significant characters so dynamic text cannot inject markup
 * into a template. Used by every template builder below.
 */
export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export class EmailService {
  private readonly apiKey?: string;
  private readonly fromEmail?: string;
  private readonly fromName: string;

  constructor(config: EmailServiceConfig = {}) {
    this.apiKey = config.apiKey;
    this.fromEmail = config.fromEmail;
    this.fromName = config.fromName ?? DEFAULT_FROM_NAME;
  }

  /** True when an API key is present and email can actually be sent. */
  get isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async send(params: SendEmailParams): Promise<SendEmailResult> {
    if (!this.apiKey) {
      return {
        sent: false,
        skipped: true,
        error: 'RESEND_API_KEY not configured'
      };
    }

    const from = `${this.fromName} <${this.fromEmail}>`;
    const body: Record<string, unknown> = {
      from,
      to: [params.to],
      subject: params.subject,
      html: params.html
    };
    if (params.replyTo) {
      body.reply_to = params.replyTo;
    }

    let response: Response;
    try {
      response = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
    } catch (err) {
      return { sent: false, error: (err as Error).message };
    }

    if (response.status === 200 || response.status === 201) {
      try {
        const data = (await response.json()) as { id?: string };
        return { sent: true, id: data.id };
      } catch {
        return { sent: true };
      }
    }

    let error = `Resend responded with status ${response.status}`;
    try {
      const text = await response.text();
      if (text) error = text;
    } catch {
      // keep the status-based message
    }
    return { sent: false, error };
  }
}

/**
 * Create an {@link EmailService} from environment variables.
 * Reads RESEND_API_KEY, EMAIL_FROM (default 'onboarding@resend.dev') and
 * EMAIL_FROM_NAME (default 'SaarthiOne').
 */
export function createEmailServiceFromEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): EmailService {
  return new EmailService({
    apiKey: env.RESEND_API_KEY,
    fromEmail: env.EMAIL_FROM ?? 'onboarding@resend.dev',
    fromName: env.EMAIL_FROM_NAME ?? DEFAULT_FROM_NAME
  });
}

/* ------------------------------------------------------------------ */
/* Branded HTML templates                                              */
/* ------------------------------------------------------------------ */

const NAVY = '#0B1220';
const CYAN = '#00F2FE';
const INK = '#1a2233';
const MUTED = '#5b6472';
const BORDER = '#e5e8ee';
const BG = '#f4f6fa';

/** Wrap body content in a responsive, email-client-safe branded shell. */
function shell(businessName: string, heading: string, inner: string): string {
  const safeBusiness = escapeHtml(businessName);
  const safeHeading = escapeHtml(heading);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="x-apple-disable-message-reformatting" />
<title>${safeHeading}</title>
</head>
<body style="margin:0;padding:0;background:${BG};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid ${BORDER};font-family:Arial,Helvetica,sans-serif;">
<tr>
<td style="background:${NAVY};padding:28px 32px;border-bottom:4px solid ${CYAN};">
<div style="color:${CYAN};font-size:13px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;">${safeBusiness}</div>
<div style="color:#ffffff;font-size:22px;font-weight:bold;margin-top:6px;">${safeHeading}</div>
</td>
</tr>
<tr>
<td style="padding:32px;color:${INK};font-size:15px;line-height:1.6;">
${inner}
</td>
</tr>
<tr>
<td style="padding:20px 32px;background:#fafbfd;border-top:1px solid ${BORDER};color:${MUTED};font-size:12px;line-height:1.5;">
Sent by ${safeBusiness} via SaarthiOne. Please do not reply directly to this automated message.
</td>
</tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function greeting(customerName: string): string {
  return `<p style="margin:0 0 16px;">Hi ${escapeHtml(customerName)},</p>`;
}

function refRow(label: string, value: string): string {
  return `<tr>
<td style="padding:8px 0;color:${MUTED};font-size:13px;">${escapeHtml(label)}</td>
<td style="padding:8px 0;color:${INK};font-size:14px;font-weight:bold;text-align:right;">${escapeHtml(value)}</td>
</tr>`;
}

function ctaButton(url: string, label: string): string {
  const safeUrl = escapeHtml(url);
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0;">
<tr><td style="border-radius:8px;background:${NAVY};">
<a href="${safeUrl}" style="display:inline-block;padding:12px 28px;color:${CYAN};font-size:15px;font-weight:bold;text-decoration:none;border-radius:8px;border:1px solid ${CYAN};">${escapeHtml(label)}</a>
</td></tr>
</table>`;
}

export interface BookingConfirmationParams {
  businessName: string;
  customerName: string;
  bookingNumber: string;
  summary: string;
  amountText?: string;
}

export function buildBookingConfirmationEmail(
  params: BookingConfirmationParams
): EmailTemplate {
  const { businessName, customerName, bookingNumber, summary, amountText } = params;
  const rows = [refRow('Booking number', bookingNumber)];
  if (amountText) rows.push(refRow('Amount', amountText));

  const inner = `${greeting(customerName)}
<p style="margin:0 0 20px;">Your booking is confirmed. Here are the details:</p>
<div style="background:${BG};border:1px solid ${BORDER};border-radius:10px;padding:16px 20px;margin:0 0 20px;">
<p style="margin:0 0 12px;color:${INK};">${escapeHtml(summary)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join('')}</table>
</div>
<p style="margin:0;color:${MUTED};">We look forward to serving you. Reach out any time if you have questions.</p>`;

  return {
    subject: `Booking confirmed — ${bookingNumber}`,
    html: shell(businessName, 'Booking Confirmed', inner)
  };
}

export interface QuotationEmailParams {
  businessName: string;
  customerName: string;
  quotationNumber: string;
  viewUrl: string;
  amountText?: string;
}

export function buildQuotationEmail(params: QuotationEmailParams): EmailTemplate {
  const { businessName, customerName, quotationNumber, viewUrl, amountText } = params;
  const rows = [refRow('Quotation number', quotationNumber)];
  if (amountText) rows.push(refRow('Total', amountText));

  const inner = `${greeting(customerName)}
<p style="margin:0 0 20px;">Thank you for your interest. Please find your quotation below.</p>
<div style="background:${BG};border:1px solid ${BORDER};border-radius:10px;padding:16px 20px;margin:0 0 20px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join('')}</table>
</div>
${ctaButton(viewUrl, 'View Quotation')}
<p style="margin:16px 0 0;color:${MUTED};">This quotation is valid subject to the terms shared. Let us know if you would like to proceed.</p>`;

  return {
    subject: `Your quotation ${quotationNumber} from ${businessName}`,
    html: shell(businessName, 'Your Quotation', inner)
  };
}

export interface FollowUpEmailParams {
  businessName: string;
  customerName: string;
  message: string;
}

export function buildFollowUpEmail(params: FollowUpEmailParams): EmailTemplate {
  const { businessName, customerName, message } = params;
  const inner = `${greeting(customerName)}
<p style="margin:0 0 16px;white-space:pre-line;">${escapeHtml(message)}</p>
<p style="margin:0;color:${MUTED};">Warm regards,<br />${escapeHtml(businessName)}</p>`;

  return {
    subject: `A quick follow-up from ${businessName}`,
    html: shell(businessName, 'Following Up', inner)
  };
}
