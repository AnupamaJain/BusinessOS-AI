import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { HubSpotService, createHubSpotServiceFromEnv } from './hubspot';

describe('HubSpotService.upsertContact', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a new contact (POST /contacts) when the search returns no results', async () => {
    const fetchMock = vi
      .fn()
      // 1. search → empty
      .mockResolvedValueOnce({
        status: 200,
        json: async () => ({ total: 0, results: [] })
      })
      // 2. create → new id
      .mockResolvedValueOnce({
        status: 201,
        json: async () => ({ id: 'contact_new_1' })
      });
    vi.stubGlobal('fetch', fetchMock);

    const service = new HubSpotService({ accessToken: 'pat-token' });
    const result = await service.upsertContact({
      phone: '+15551234567',
      email: 'lead@smb.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      lifecycleStage: 'lead'
    });

    expect(result).toEqual({ ok: true, id: 'contact_new_1' });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // search call
    const [searchUrl, searchInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(searchUrl).toBe('https://api.hubapi.com/crm/v3/objects/contacts/search');
    expect(searchInit.method).toBe('POST');
    expect((searchInit.headers as Record<string, string>).Authorization).toBe('Bearer pat-token');
    const searchBody = JSON.parse(searchInit.body as string);
    expect(searchBody.filterGroups[0].filters[0]).toEqual({
      propertyName: 'phone',
      operator: 'EQ',
      value: '+15551234567'
    });

    // create call
    const [createUrl, createInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(createUrl).toBe('https://api.hubapi.com/crm/v3/objects/contacts');
    expect(createInit.method).toBe('POST');
    const createBody = JSON.parse(createInit.body as string);
    expect(createBody.properties.phone).toBe('+15551234567');
    expect(createBody.properties.email).toBe('lead@smb.com');
    expect(createBody.properties.firstname).toBe('Ada');
    expect(createBody.properties.lastname).toBe('Lovelace');
    expect(createBody.properties.lifecyclestage).toBe('lead');
  });

  it('patches the existing contact (PATCH /contacts/{id}) when the search returns a hit', async () => {
    const fetchMock = vi
      .fn()
      // 1. search → one hit
      .mockResolvedValueOnce({
        status: 200,
        json: async () => ({ total: 1, results: [{ id: 'contact_existing_9' }] })
      })
      // 2. patch → same id
      .mockResolvedValueOnce({
        status: 200,
        json: async () => ({ id: 'contact_existing_9' })
      });
    vi.stubGlobal('fetch', fetchMock);

    const service = new HubSpotService({ accessToken: 'pat-token' });
    const result = await service.upsertContact({
      phone: '+15550009999',
      email: 'updated@smb.com'
    });

    expect(result).toEqual({ ok: true, id: 'contact_existing_9' });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [patchUrl, patchInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(patchUrl).toBe('https://api.hubapi.com/crm/v3/objects/contacts/contact_existing_9');
    expect(patchInit.method).toBe('PATCH');
    const patchBody = JSON.parse(patchInit.body as string);
    expect(patchBody.properties.phone).toBe('+15550009999');
    expect(patchBody.properties.email).toBe('updated@smb.com');
  });

  it('returns { skipped: true } and does not call fetch when no access token is set', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const service = new HubSpotService({});
    const result = await service.upsertContact({ phone: '+15551112222' });

    expect(result).toEqual({
      ok: false,
      skipped: true,
      error: 'HUBSPOT_ACCESS_TOKEN not configured'
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('HubSpotService.upsertDeal', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a deal and associates it to the contact best-effort', async () => {
    const fetchMock = vi
      .fn()
      // 1. search → empty
      .mockResolvedValueOnce({ status: 200, json: async () => ({ total: 0, results: [] }) })
      // 2. create → new id
      .mockResolvedValueOnce({ status: 201, json: async () => ({ id: 'deal_1' }) })
      // 3. association (best-effort)
      .mockResolvedValueOnce({ status: 200, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    const service = new HubSpotService({ accessToken: 'pat-token' });
    const result = await service.upsertDeal({
      dealName: 'Roof repair',
      amount: 4200,
      stage: 'qualifiedtobuy',
      contactId: 'contact_7',
      externalId: 'ext-abc'
    });

    expect(result).toEqual({ ok: true, id: 'deal_1' });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const [createUrl, createInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(createUrl).toBe('https://api.hubapi.com/crm/v3/objects/deals');
    const createBody = JSON.parse(createInit.body as string);
    expect(createBody.properties.dealname).toBe('Roof repair');
    expect(createBody.properties.amount).toBe('4200');
    expect(createBody.properties.dealstage).toBe('qualifiedtobuy');
    expect(createBody.properties.pipeline).toBe('default');

    const [assocUrl, assocInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(assocUrl).toBe(
      'https://api.hubapi.com/crm/v3/objects/deals/deal_1/associations/contacts/contact_7/deal_to_contact'
    );
    expect(assocInit.method).toBe('PUT');
  });

  it('still returns ok when the association call fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, json: async () => ({ total: 0, results: [] }) })
      .mockResolvedValueOnce({ status: 201, json: async () => ({ id: 'deal_2' }) })
      .mockResolvedValueOnce({ status: 500, json: async () => ({ message: 'boom' }) });
    vi.stubGlobal('fetch', fetchMock);

    const service = new HubSpotService({ accessToken: 'pat-token' });
    const result = await service.upsertDeal({
      dealName: 'Job',
      contactId: 'contact_7',
      externalId: 'ext-1'
    });

    expect(result).toEqual({ ok: true, id: 'deal_2' });
  });

  it('patches an existing deal and does not associate', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        json: async () => ({ total: 1, results: [{ id: 'deal_existing' }] })
      })
      .mockResolvedValueOnce({ status: 200, json: async () => ({ id: 'deal_existing' }) });
    vi.stubGlobal('fetch', fetchMock);

    const service = new HubSpotService({ accessToken: 'pat-token' });
    const result = await service.upsertDeal({
      dealName: 'Job',
      contactId: 'contact_7',
      externalId: 'ext-1'
    });

    expect(result).toEqual({ ok: true, id: 'deal_existing' });
    // only search + patch — no association PUT
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [patchUrl, patchInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(patchUrl).toBe('https://api.hubapi.com/crm/v3/objects/deals/deal_existing');
    expect(patchInit.method).toBe('PATCH');
  });

  it('returns { skipped: true } without an access token', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const service = new HubSpotService({});
    const result = await service.upsertDeal({ dealName: 'Job', externalId: 'ext-1' });

    expect(result).toEqual({
      ok: false,
      skipped: true,
      error: 'HUBSPOT_ACCESS_TOKEN not configured'
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('HubSpotService.verifyWebhookSignature', () => {
  const webhookSecret = 'client-secret-xyz';
  const method = 'POST';
  const uri = 'https://app.saarthi.one/api/hubspot/webhook';
  const body = '[{"subscriptionType":"contact.propertyChange","objectId":123}]';
  const timestamp = '1700000000000';

  function sign(secret: string): string {
    return createHmac('sha256', secret)
      .update(`${method}${uri}${body}${timestamp}`, 'utf8')
      .digest('base64');
  }

  it('accepts a correctly computed v3 signature', () => {
    const service = new HubSpotService({ webhookSecret });
    const signature = sign(webhookSecret);
    expect(
      service.verifyWebhookSignature({ method, uri, body, signature, timestamp })
    ).toBe(true);
  });

  it('rejects a tampered body', () => {
    const service = new HubSpotService({ webhookSecret });
    const signature = sign(webhookSecret);
    expect(
      service.verifyWebhookSignature({ method, uri, body: body + 'x', signature, timestamp })
    ).toBe(false);
  });

  it('rejects a signature made with the wrong secret', () => {
    const service = new HubSpotService({ webhookSecret });
    const signature = sign('wrong-secret');
    expect(
      service.verifyWebhookSignature({ method, uri, body, signature, timestamp })
    ).toBe(false);
  });

  it('returns false when the webhook secret is missing', () => {
    const service = new HubSpotService({});
    const signature = sign(webhookSecret);
    expect(
      service.verifyWebhookSignature({ method, uri, body, signature, timestamp })
    ).toBe(false);
  });
});

describe('HubSpotService.parseWebhookEvents', () => {
  it('maps a contact.propertyChange array element to the normalized shape', () => {
    const service = new HubSpotService({});
    const raw = JSON.stringify([
      {
        subscriptionType: 'contact.propertyChange',
        objectId: 123,
        propertyName: 'lifecyclestage',
        propertyValue: 'customer',
        changeType: 'CHANGED'
      }
    ]);

    expect(service.parseWebhookEvents(raw)).toEqual([
      {
        objectType: 'contact',
        objectId: '123',
        propertyName: 'lifecyclestage',
        propertyValue: 'customer',
        changeType: 'CHANGED'
      }
    ]);
  });

  it('returns [] for malformed JSON', () => {
    const service = new HubSpotService({});
    expect(service.parseWebhookEvents('{bad')).toEqual([]);
  });

  it('returns [] for a non-array payload', () => {
    const service = new HubSpotService({});
    expect(service.parseWebhookEvents('{"subscriptionType":"contact.propertyChange"}')).toEqual([]);
  });
});

describe('createHubSpotServiceFromEnv', () => {
  it('reads HUBSPOT_ACCESS_TOKEN / HUBSPOT_WEBHOOK_SECRET', () => {
    expect(createHubSpotServiceFromEnv({}).isConfigured).toBe(false);
    expect(createHubSpotServiceFromEnv({ HUBSPOT_ACCESS_TOKEN: 'pat' }).isConfigured).toBe(true);
  });
});
