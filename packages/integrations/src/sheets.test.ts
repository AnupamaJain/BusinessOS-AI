import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { SheetsService, createSheetsServiceFromEnv, parseSpreadsheetId } from './sheets';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

function tokenResponse() {
  return { ok: true, status: 200, json: async () => ({ access_token: 'ya29.test', expires_in: 3600 }) };
}

function service() {
  return new SheetsService({ clientEmail: 'bot@proj.iam.gserviceaccount.com', privateKey: PEM });
}

describe('parseSpreadsheetId', () => {
  it('extracts the id from a full URL', () => {
    expect(
      parseSpreadsheetId('https://docs.google.com/spreadsheets/d/1AbC-dEfG_hIjKlMnOpQrStUvWxYz012345/edit#gid=0'),
    ).toBe('1AbC-dEfG_hIjKlMnOpQrStUvWxYz012345');
  });
  it('accepts a bare id', () => {
    expect(parseSpreadsheetId('1AbC-dEfG_hIjKlMnOpQrStUvWxYz012345')).toBe('1AbC-dEfG_hIjKlMnOpQrStUvWxYz012345');
  });
  it('returns null for junk', () => {
    expect(parseSpreadsheetId('not a sheet')).toBeNull();
    expect(parseSpreadsheetId('')).toBeNull();
  });
});

describe('SheetsService', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is not configured without credentials', () => {
    expect(new SheetsService({}).isConfigured).toBe(false);
    expect(service().isConfigured).toBe(true);
    expect(service().serviceAccountEmail).toBe('bot@proj.iam.gserviceaccount.com');
  });

  it('signs a JWT, exchanges it for a token, and reads sheet metadata', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          properties: { title: 'My CRM' },
          sheets: [{ properties: { title: 'Leads' } }, { properties: { title: 'Contacts' } }],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const meta = await service().getMeta('SHEET123');
    expect(meta).toEqual({ spreadsheetId: 'SHEET123', title: 'My CRM', tabs: ['Leads', 'Contacts'] });

    // First call: token exchange with a well-formed JWT assertion.
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(tokenUrl).toBe('https://oauth2.googleapis.com/token');
    const assertion = new URLSearchParams(tokenInit.body as string).get('assertion')!;
    expect(assertion.split('.')).toHaveLength(3);

    // Second call: Sheets API with the bearer token.
    const [apiUrl, apiInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(apiUrl).toContain('sheets.googleapis.com/v4/spreadsheets/SHEET123');
    expect((apiInit.headers as Record<string, string>).authorization).toBe('Bearer ya29.test');
  });

  it('gives a clear error when the sheet is not shared (403)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce({ ok: false, status: 403, text: async () => 'forbidden' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(service().getMeta('SHEET123')).rejects.toThrow(/share the sheet with/i);
  });

  it('reuses the cached access token across calls', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ values: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    const svc = service();
    await svc.readRows('S', 'Leads');
    await svc.readRows('S', 'Leads');
    // 1 token exchange + 2 reads = 3, not 4.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('maps rows to objects keyed by a lower-cased header', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          values: [
            ['Name', 'Phone', 'City'],
            ['Asha', '+919876543210', 'Pune'],
            ['Ravi', '+919812345678'],
          ],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const rows = await service().readAsObjects('S', 'Contacts');
    expect(rows).toEqual([
      { name: 'Asha', phone: '+919876543210', city: 'Pune' },
      { name: 'Ravi', phone: '+919812345678', city: '' },
    ]);
  });

  it('appends rows via the USER_ENTERED append endpoint', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    await service().appendRows('S', 'Leads', [['2026-07-24', 'Asha', '+919876543210']]);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toContain(':append');
    expect(url).toContain('valueInputOption=USER_ENTERED');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string).values[0]).toEqual(['2026-07-24', 'Asha', '+919876543210']);
  });
});

describe('createSheetsServiceFromEnv', () => {
  it('reads discrete client email + private key', () => {
    expect(createSheetsServiceFromEnv({}).isConfigured).toBe(false);
    const svc = createSheetsServiceFromEnv({
      GOOGLE_SHEETS_CLIENT_EMAIL: 'bot@proj.iam.gserviceaccount.com',
      GOOGLE_SHEETS_PRIVATE_KEY: PEM,
    });
    expect(svc.isConfigured).toBe(true);
  });

  it('reads a base64-encoded service account JSON blob', () => {
    const blob = Buffer.from(
      JSON.stringify({ client_email: 'bot@proj.iam.gserviceaccount.com', private_key: PEM }),
    ).toString('base64');
    const svc = createSheetsServiceFromEnv({ GOOGLE_SERVICE_ACCOUNT_JSON: blob });
    expect(svc.isConfigured).toBe(true);
    expect(svc.serviceAccountEmail).toBe('bot@proj.iam.gserviceaccount.com');
  });
});
