/**
 * Google Sheets as a lightweight per-tenant CRM / data source.
 *
 * Auth model: ONE platform Google service account (its key lives in env). Each
 * merchant shares their own spreadsheet with the service account's email and
 * pastes the sheet URL into the dashboard — no per-merchant OAuth consent
 * screen, no Google app-verification review. We store only the spreadsheet id
 * + tab preferences per tenant.
 *
 * Pure `fetch` + `node:crypto` — no googleapis SDK — so it stays inside the
 * esbuild bundle. The service-account JWT is signed with RS256 by hand and
 * exchanged for a short-lived access token (cached ~55 min). Degrades
 * gracefully: when no credentials are present, {@link SheetsService.isConfigured}
 * is false and callers skip the sync rather than crash.
 */
import { createSign } from 'node:crypto';

export interface SheetsServiceConfig {
  /** Service-account email — merchants share their sheet with this address. */
  clientEmail?: string;
  /** Service-account private key (PEM; literal `\n` are unescaped). */
  privateKey?: string;
}

export interface SpreadsheetMeta {
  spreadsheetId: string;
  title: string;
  tabs: string[];
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

/** Extract a spreadsheet id from a full URL or return the id if already bare. */
export function parseSpreadsheetId(urlOrId: string): string | null {
  const trimmed = (urlOrId || '').trim();
  if (!trimmed) return null;
  const m = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1] ?? null;
  // Bare id: Google ids are long url-safe strings with no slashes/spaces.
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed;
  return null;
}

/** A1 range for a whole tab, safely quoting tab names that contain spaces. */
function tabRange(tab: string, span = 'A:Z'): string {
  return encodeURIComponent(`'${tab.replace(/'/g, "''")}'!${span}`);
}

export class SheetsService {
  private readonly clientEmail?: string;
  private readonly privateKey?: string;
  private token?: { value: string; expiresAt: number };

  constructor(config: SheetsServiceConfig = {}) {
    this.clientEmail = config.clientEmail;
    this.privateKey = config.privateKey?.replace(/\\n/g, '\n');
  }

  get isConfigured(): boolean {
    return Boolean(this.clientEmail && this.privateKey);
  }

  /** The address merchants must share their spreadsheet with (Editor access). */
  get serviceAccountEmail(): string | undefined {
    return this.clientEmail;
  }

  private async accessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.token && this.token.expiresAt > now + 60) return this.token.value;
    if (!this.clientEmail || !this.privateKey) {
      throw new Error('Google Sheets service account is not configured');
    }
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claim = b64url(
      JSON.stringify({
        iss: this.clientEmail,
        scope: SCOPE,
        aud: TOKEN_URL,
        iat: now,
        exp: now + 3600,
      }),
    );
    const signingInput = `${header}.${claim}`;
    const signature = createSign('RSA-SHA256')
      .update(signingInput)
      .sign(this.privateKey, 'base64url');
    const jwt = `${signingInput}.${signature}`;

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    });
    if (!res.ok) {
      throw new Error(`Google token exchange failed (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: data.access_token, expiresAt: now + (data.expires_in ?? 3600) };
    return this.token.value;
  }

  private async api(path: string, init?: RequestInit): Promise<Response> {
    const token = await this.accessToken();
    return fetch(`${SHEETS_API}/${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  }

  /** Fetch title + tab names. Throws on 403 (not shared) / 404 (bad id). */
  async getMeta(spreadsheetId: string): Promise<SpreadsheetMeta> {
    const res = await this.api(
      `${spreadsheetId}?fields=${encodeURIComponent('properties.title,sheets.properties.title')}`,
    );
    if (res.status === 403) {
      throw new Error(
        `Access denied — share the sheet with ${this.clientEmail} (Editor) and try again.`,
      );
    }
    if (!res.ok) {
      throw new Error(`Could not open spreadsheet (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as {
      properties?: { title?: string };
      sheets?: Array<{ properties?: { title?: string } }>;
    };
    return {
      spreadsheetId,
      title: data.properties?.title ?? 'Untitled',
      tabs: (data.sheets ?? []).map((s) => s.properties?.title ?? '').filter(Boolean),
    };
  }

  /** Create a tab if it doesn't exist (idempotent). */
  async ensureTab(spreadsheetId: string, tab: string): Promise<void> {
    const meta = await this.getMeta(spreadsheetId);
    if (meta.tabs.includes(tab)) return;
    const res = await this.api(`${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tab } } }] }),
    });
    if (!res.ok) throw new Error(`Could not create tab "${tab}" (${res.status})`);
  }

  /**
   * Ensure the tab exists and its first row matches `header`. Only writes the
   * header when the tab is empty, so we never clobber a merchant's own columns.
   */
  async ensureHeader(spreadsheetId: string, tab: string, header: string[]): Promise<void> {
    await this.ensureTab(spreadsheetId, tab);
    const existing = await this.readRows(spreadsheetId, tab);
    if (existing.length === 0) {
      await this.api(`${spreadsheetId}/values/${tabRange(tab, 'A1')}:append?valueInputOption=RAW`, {
        method: 'POST',
        body: JSON.stringify({ values: [header] }),
      });
    }
  }

  /** Append rows to the bottom of a tab. */
  async appendRows(spreadsheetId: string, tab: string, rows: (string | number)[][]): Promise<void> {
    if (rows.length === 0) return;
    const res = await this.api(
      `${spreadsheetId}/values/${tabRange(tab, 'A1')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      { method: 'POST', body: JSON.stringify({ values: rows }) },
    );
    if (!res.ok) throw new Error(`Append failed (${res.status}): ${await res.text()}`);
  }

  /** Read all rows of a tab as a 2D string array (including any header row). */
  async readRows(spreadsheetId: string, tab: string): Promise<string[][]> {
    const res = await this.api(`${spreadsheetId}/values/${tabRange(tab)}`);
    if (res.status === 400) return []; // tab doesn't exist yet
    if (!res.ok) throw new Error(`Read failed (${res.status}): ${await res.text()}`);
    const data = (await res.json()) as { values?: string[][] };
    return data.values ?? [];
  }

  /**
   * Read a tab as objects keyed by its header row (lower-cased, trimmed).
   * Returns [] when the tab is empty or missing.
   */
  async readAsObjects(spreadsheetId: string, tab: string): Promise<Record<string, string>[]> {
    const rows = await this.readRows(spreadsheetId, tab);
    if (rows.length < 2) return [];
    const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
    return rows.slice(1).map((row) => {
      const obj: Record<string, string> = {};
      header.forEach((key, i) => {
        if (key) obj[key] = (row[i] ?? '').trim();
      });
      return obj;
    });
  }
}

/**
 * Build a {@link SheetsService} from env. Accepts either a single
 * `GOOGLE_SERVICE_ACCOUNT_JSON` (raw or base64) or discrete
 * `GOOGLE_SHEETS_CLIENT_EMAIL` + `GOOGLE_SHEETS_PRIVATE_KEY`.
 */
export function createSheetsServiceFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SheetsService {
  const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    try {
      const json = raw.trim().startsWith('{')
        ? raw
        : Buffer.from(raw, 'base64').toString('utf8');
      const parsed = JSON.parse(json) as { client_email?: string; private_key?: string };
      return new SheetsService({
        clientEmail: parsed.client_email,
        privateKey: parsed.private_key,
      });
    } catch {
      // fall through to discrete vars
    }
  }
  return new SheetsService({
    clientEmail: env.GOOGLE_SHEETS_CLIENT_EMAIL,
    privateKey: env.GOOGLE_SHEETS_PRIVATE_KEY,
  });
}
