import { describe, it, expect, vi, afterEach } from 'vitest';
import { verifySupabaseAccessToken, getOrganizationRole } from './supabase-auth';

const SUPABASE_URL = 'https://example.supabase.co';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const ORG_A = '11111111-1111-1111-1111-111111111111';

describe('verifySupabaseAccessToken', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the user identity for a valid token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ id: USER_ID, email: 'owner@travelagency.com' })
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await verifySupabaseAccessToken({
      supabaseUrl: SUPABASE_URL,
      anonKey: 'anon-key',
      accessToken: 'valid-token'
    });

    expect(result).toEqual({ userId: USER_ID, email: 'owner@travelagency.com' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${SUPABASE_URL}/auth/v1/user`);
    const headers = init.headers as Record<string, string>;
    expect(headers.apikey).toBe('anon-key');
    expect(headers.Authorization).toBe('Bearer valid-token');
  });

  it('returns null for an invalid token (401)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 401,
      json: async () => ({ message: 'invalid JWT' })
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await verifySupabaseAccessToken({
      supabaseUrl: SUPABASE_URL,
      anonKey: 'anon-key',
      accessToken: 'bad-token'
    });

    expect(result).toBeNull();
  });

  it('returns null instead of throwing on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const result = await verifySupabaseAccessToken({
      supabaseUrl: SUPABASE_URL,
      anonKey: 'anon-key',
      accessToken: 'any-token'
    });

    expect(result).toBeNull();
  });
});

describe('getOrganizationRole', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the first membership row when found', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => [{ organization_id: ORG_A, role: 'owner' }]
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getOrganizationRole({
      supabaseUrl: SUPABASE_URL,
      serviceRoleKey: 'service-key',
      userId: USER_ID,
      organizationId: ORG_A
    });

    expect(result).toEqual({ organizationId: ORG_A, role: 'owner' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `${SUPABASE_URL}/rest/v1/organization_members?user_id=eq.${USER_ID}&select=organization_id,role&organization_id=eq.${ORG_A}`
    );
    const headers = init.headers as Record<string, string>;
    expect(headers.apikey).toBe('service-key');
    expect(headers.Authorization).toBe('Bearer service-key');
  });

  it('omits the organization filter when organizationId is not provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => [{ organization_id: ORG_A, role: 'sales_agent' }]
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getOrganizationRole({
      supabaseUrl: SUPABASE_URL,
      serviceRoleKey: 'service-key',
      userId: USER_ID
    });

    expect(result).toEqual({ organizationId: ORG_A, role: 'sales_agent' });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(
      `${SUPABASE_URL}/rest/v1/organization_members?user_id=eq.${USER_ID}&select=organization_id,role`
    );
  });

  it('returns null when the user has no memberships', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => []
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getOrganizationRole({
      supabaseUrl: SUPABASE_URL,
      serviceRoleKey: 'service-key',
      userId: USER_ID
    });

    expect(result).toBeNull();
  });
});
