import { describe, it, expect, beforeEach } from 'vitest';
import { ToolDataStore } from '../tools';

const ORG = '11111111-1111-1111-1111-111111111111';
const OTHER_ORG = '22222222-2222-2222-2222-222222222222';

describe('integration connections (ToolDataStore)', () => {
  let store: ToolDataStore;
  beforeEach(() => {
    store = new ToolDataStore();
  });

  it('returns null when no connection exists', async () => {
    expect(await store.getIntegrationConnection(ORG, 'hubspot')).toBeNull();
  });

  it('round-trips config on save then get', async () => {
    await store.saveIntegrationConnection(ORG, 'hubspot', {
      config: { portalId: '123', accessToken: 'tok-abc', refreshToken: 'ref-xyz' },
      secretKeys: ['accessToken', 'refreshToken'],
    });
    const conn = await store.getIntegrationConnection(ORG, 'hubspot');
    expect(conn).not.toBeNull();
    expect(conn!.organizationId).toBe(ORG);
    expect(conn!.provider).toBe('hubspot');
    expect(conn!.status).toBe('active');
    expect(conn!.config).toEqual({ portalId: '123', accessToken: 'tok-abc', refreshToken: 'ref-xyz' });
  });

  it('defaults status to active and reflects an explicit status in the list', async () => {
    await store.saveIntegrationConnection(ORG, 'hubspot', { config: { a: 1 } });
    await store.saveIntegrationConnection(ORG, 'instagram', { config: { b: 2 }, status: 'error' });
    const list = await store.listIntegrationConnections(ORG);
    expect(list).toEqual(
      expect.arrayContaining([
        { provider: 'hubspot', status: 'active' },
        { provider: 'instagram', status: 'error' },
      ]),
    );
    expect(list).toHaveLength(2);
  });

  it('overwriting the same provider updates in place (one row per org+provider)', async () => {
    await store.saveIntegrationConnection(ORG, 'hubspot', { config: { accessToken: 'first' }, status: 'active' });
    await store.saveIntegrationConnection(ORG, 'hubspot', { config: { accessToken: 'second' }, status: 'inactive' });
    const conn = await store.getIntegrationConnection(ORG, 'hubspot');
    expect(store.integrationConnections).toHaveLength(1);
    expect(conn!.config).toEqual({ accessToken: 'second' });
    expect(conn!.status).toBe('inactive');
  });

  it('scopes connections per organization', async () => {
    await store.saveIntegrationConnection(ORG, 'hubspot', { config: { a: 1 } });
    await store.saveIntegrationConnection(OTHER_ORG, 'hubspot', { config: { a: 2 } });
    expect(await store.getIntegrationConnection(OTHER_ORG, 'hubspot')).not.toBeNull();
    expect((await store.getIntegrationConnection(ORG, 'hubspot'))!.config).toEqual({ a: 1 });
    expect(await store.listIntegrationConnections(ORG)).toEqual([{ provider: 'hubspot', status: 'active' }]);
  });

  it('drops undefined/null config values on write', async () => {
    await store.saveIntegrationConnection(ORG, 'hubspot', {
      config: { keep: 'yes', skipUndef: undefined, skipNull: null },
    });
    const conn = await store.getIntegrationConnection(ORG, 'hubspot');
    expect(conn!.config).toEqual({ keep: 'yes' });
  });

  it('list returns providers/status without exposing config secrets', async () => {
    await store.saveIntegrationConnection(ORG, 'hubspot', {
      config: { accessToken: 'super-secret' },
      secretKeys: ['accessToken'],
    });
    const list = await store.listIntegrationConnections(ORG);
    expect(list).toEqual([{ provider: 'hubspot', status: 'active' }]);
    for (const entry of list) {
      expect(Object.keys(entry)).toEqual(['provider', 'status']);
    }
  });
});
