/**
 * Two-way HubSpot CRM sync via the HubSpot v3 HTTP API.
 *
 * Pure `fetch` — no HubSpot SDK dependency. Degrades gracefully when no access
 * token is configured: request methods return a clear "skipped" result rather
 * than throwing, so callers can run without HubSpot credentials in dev/test.
 * Webhook signatures are verified with `node:crypto` (v3 HMAC-SHA256,
 * timing-safe).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface HubSpotServiceConfig {
  accessToken?: string;
  /** The HubSpot app's client secret, used for v3 webhook signature validation. */
  webhookSecret?: string;
}

export interface UpsertContactParams {
  phone: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  lifecycleStage?: string;
}

export interface UpsertContactResult {
  ok: boolean;
  id?: string;
  error?: string;
  skipped?: boolean;
}

export interface UpsertDealParams {
  dealName: string;
  amount?: number;
  stage?: string;
  contactId?: string;
  externalId: string;
}

export interface UpsertDealResult {
  ok: boolean;
  id?: string;
  error?: string;
  skipped?: boolean;
}

export interface VerifyWebhookSignatureParams {
  method: string;
  uri: string;
  body: string;
  signature: string;
  timestamp: string;
}

export interface HubSpotWebhookEvent {
  objectType: string;
  objectId: string;
  propertyName?: string;
  propertyValue?: string;
  changeType?: string;
}

const HUBSPOT_API_BASE = 'https://api.hubapi.com';
const NO_TOKEN_ERROR = 'HUBSPOT_ACCESS_TOKEN not configured';

/** HubSpot error envelope: `{ message }`. */
interface HubSpotError {
  message?: string;
}

interface HubSpotSearchResponse {
  total?: number;
  results?: Array<{ id?: string }>;
}

interface HubSpotObjectResponse {
  id?: string;
}

/** A single event object in a HubSpot webhook subscription array. */
interface HubSpotSubscriptionEvent {
  subscriptionType?: unknown;
  objectId?: unknown;
  propertyName?: unknown;
  propertyValue?: unknown;
  changeType?: unknown;
}

export class HubSpotService {
  private readonly accessToken?: string;
  private readonly webhookSecret?: string;

  constructor(config: HubSpotServiceConfig = {}) {
    this.accessToken = config.accessToken;
    this.webhookSecret = config.webhookSecret;
  }

  /** True when an access token is present and HubSpot calls can actually be made. */
  get isConfigured(): boolean {
    return Boolean(this.accessToken);
  }

  /**
   * Send a JSON request to the HubSpot API and return the parsed body, or a
   * normalized error result. Never throws.
   */
  private async request(
    method: string,
    path: string,
    body?: unknown
  ): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
    let response: Response;
    try {
      response = await fetch(`${HUBSPOT_API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }

    if (response.status >= 200 && response.status < 300) {
      try {
        const data = (await response.json()) as Record<string, unknown>;
        return { ok: true, data };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    }

    let error = `HubSpot responded with status ${response.status}`;
    try {
      const payload = (await response.json()) as HubSpotError;
      if (payload?.message) error = payload.message;
    } catch {
      // keep the status-based message
    }
    return { ok: false, error };
  }

  /**
   * Upsert a contact keyed by phone number. HubSpot has no native phone-based
   * upsert, so we search by phone first, then PATCH the existing contact or
   * POST a new one.
   */
  async upsertContact(params: UpsertContactParams): Promise<UpsertContactResult> {
    if (!this.accessToken) {
      return { ok: false, skipped: true, error: NO_TOKEN_ERROR };
    }

    // 1. Search for an existing contact by phone.
    const search = await this.request('POST', '/crm/v3/objects/contacts/search', {
      filterGroups: [
        { filters: [{ propertyName: 'phone', operator: 'EQ', value: params.phone }] }
      ],
      properties: ['phone', 'email']
    });
    if (!search.ok) {
      return { ok: false, error: search.error };
    }

    const searchData = search.data as HubSpotSearchResponse;
    const existingId = searchData.results?.[0]?.id;

    // 2. Build the properties payload.
    const properties: Record<string, string> = { phone: params.phone };
    if (params.email !== undefined) properties.email = params.email;
    if (params.firstName !== undefined) properties.firstname = params.firstName;
    if (params.lastName !== undefined) properties.lastname = params.lastName;
    if (params.lifecycleStage !== undefined) properties.lifecyclestage = params.lifecycleStage;

    // 3. PATCH the existing contact or POST a new one.
    const result = existingId
      ? await this.request('PATCH', `/crm/v3/objects/contacts/${existingId}`, { properties })
      : await this.request('POST', '/crm/v3/objects/contacts', { properties });

    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    const id = (result.data as HubSpotObjectResponse).id ?? existingId;
    return { ok: true, id };
  }

  /**
   * Upsert a deal keyed by an external id (matched against `dealname`). Creates
   * or patches the deal, and — when a new deal is created with a `contactId` —
   * best-effort associates the deal to that contact.
   */
  async upsertDeal(params: UpsertDealParams): Promise<UpsertDealResult> {
    if (!this.accessToken) {
      return { ok: false, skipped: true, error: NO_TOKEN_ERROR };
    }

    // 1. Search for an existing deal by external id (matched on dealname).
    const search = await this.request('POST', '/crm/v3/objects/deals/search', {
      filterGroups: [
        { filters: [{ propertyName: 'dealname', operator: 'EQ', value: params.externalId }] }
      ],
      properties: ['dealname']
    });
    if (!search.ok) {
      return { ok: false, error: search.error };
    }

    const searchData = search.data as HubSpotSearchResponse;
    const existingId = searchData.results?.[0]?.id;

    // 2. Build the properties payload.
    const properties: Record<string, string> = {
      dealname: params.dealName,
      pipeline: 'default'
    };
    if (params.amount !== undefined) properties.amount = String(params.amount);
    if (params.stage !== undefined) properties.dealstage = params.stage;

    // 3. PATCH the existing deal or POST a new one.
    const created = !existingId;
    const result = existingId
      ? await this.request('PATCH', `/crm/v3/objects/deals/${existingId}`, { properties })
      : await this.request('POST', '/crm/v3/objects/deals', { properties });

    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    const id = (result.data as HubSpotObjectResponse).id ?? existingId;

    // 4. When a new deal was created and a contact is supplied, associate them.
    //    Best-effort — association failures never fail the upsert.
    if (created && id && params.contactId) {
      await this.request(
        'PUT',
        `/crm/v3/objects/deals/${id}/associations/contacts/${params.contactId}/deal_to_contact`
      );
    }

    return { ok: true, id };
  }

  /**
   * Verify a HubSpot v3 webhook signature.
   *
   * The signature is `base64( HMAC-SHA256( method + uri + body + timestamp,
   * clientSecret ) )`, delivered in the `X-HubSpot-Signature-v3` header. We
   * recompute it and timing-safe compare. Returns false if the webhook secret
   * is missing or the header is absent.
   */
  verifyWebhookSignature(params: VerifyWebhookSignatureParams): boolean {
    if (!this.webhookSecret || !params.signature) return false;

    const base = `${params.method}${params.uri}${params.body}${params.timestamp}`;
    const expected = createHmac('sha256', this.webhookSecret)
      .update(base, 'utf8')
      .digest('base64');

    const expectedBuf = Buffer.from(expected, 'utf8');
    const actualBuf = Buffer.from(params.signature, 'utf8');
    if (expectedBuf.length !== actualBuf.length) return false;

    try {
      return timingSafeEqual(expectedBuf, actualBuf);
    } catch {
      return false;
    }
  }

  /**
   * Parse a raw HubSpot webhook body — an ARRAY of subscription events — into
   * normalized events. `objectType` is derived from the `subscriptionType`
   * prefix (e.g. `contact.propertyChange` → `contact`). Returns [] for
   * malformed input. Never throws. Signature verification is separate — call
   * {@link verifyWebhookSignature} first.
   */
  parseWebhookEvents(rawBody: string): HubSpotWebhookEvent[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return [];
    }

    if (!Array.isArray(parsed)) return [];

    const events: HubSpotWebhookEvent[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const raw = item as HubSpotSubscriptionEvent;

      const subscriptionType = asString(raw.subscriptionType);
      const objectId = asString(raw.objectId) ?? asNumberString(raw.objectId);
      if (!subscriptionType || objectId === undefined) continue;

      const objectType = subscriptionType.split('.')[0]!;
      const event: HubSpotWebhookEvent = { objectType, objectId };

      const propertyName = asString(raw.propertyName);
      if (propertyName !== undefined) event.propertyName = propertyName;
      const propertyValue = asString(raw.propertyValue);
      if (propertyValue !== undefined) event.propertyValue = propertyValue;
      const changeType = asString(raw.changeType);
      if (changeType !== undefined) event.changeType = changeType;

      events.push(event);
    }

    return events;
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** HubSpot sends `objectId` as a number; normalize it to a string. */
function asNumberString(value: unknown): string | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined;
}

/**
 * Create a {@link HubSpotService} from environment variables.
 * Reads HUBSPOT_ACCESS_TOKEN and HUBSPOT_WEBHOOK_SECRET.
 */
export function createHubSpotServiceFromEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): HubSpotService {
  return new HubSpotService({
    accessToken: env.HUBSPOT_ACCESS_TOKEN,
    webhookSecret: env.HUBSPOT_WEBHOOK_SECRET
  });
}
