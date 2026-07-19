import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'crypto';
import {
  verifyOrganizationMembership,
  getUserOrganizationIds,
  assertTenantMatch,
} from '../rls-helpers';
import { TenantAccessError } from '@whatsapp-smb/shared-types';

// ─── Mock Supabase client ────────────────────────────────────────────

function createMockClient(queryResult: {
  data: unknown;
  error: unknown;
}) {
  const mockSingle = vi.fn().mockResolvedValue(queryResult);
  const mockEq2 = vi.fn().mockReturnValue({ maybeSingle: mockSingle });
  const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 });
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 });
  const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

  return {
    from: mockFrom,
    _mocks: { from: mockFrom, select: mockSelect, eq1: mockEq1, eq2: mockEq2, single: mockSingle },
  } as unknown as Parameters<typeof verifyOrganizationMembership>[0];
}

function createMockClientForList(queryResult: {
  data: unknown;
  error: unknown;
}) {
  const mockEq = vi.fn().mockResolvedValue(queryResult);
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
  const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

  return {
    from: mockFrom,
  } as unknown as Parameters<typeof getUserOrganizationIds>[0];
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('verifyOrganizationMembership', () => {
  const userId = randomUUID();
  const orgId = randomUUID();

  it('succeeds when user is a member', async () => {
    const client = createMockClient({
      data: { id: randomUUID() },
      error: null,
    });

    await expect(
      verifyOrganizationMembership(client, userId, orgId),
    ).resolves.toBeUndefined();
  });

  it('throws TenantAccessError when user is not a member', async () => {
    const client = createMockClient({
      data: null,
      error: null,
    });

    await expect(
      verifyOrganizationMembership(client, userId, orgId),
    ).rejects.toThrow(TenantAccessError);
  });

  it('throws TenantAccessError on database error', async () => {
    const client = createMockClient({
      data: null,
      error: { message: 'connection error' },
    });

    await expect(
      verifyOrganizationMembership(client, userId, orgId),
    ).rejects.toThrow(TenantAccessError);
  });
});

describe('getUserOrganizationIds', () => {
  const userId = randomUUID();

  it('returns organization IDs for a member', async () => {
    const orgId1 = randomUUID();
    const orgId2 = randomUUID();
    const client = createMockClientForList({
      data: [
        { organization_id: orgId1 },
        { organization_id: orgId2 },
      ],
      error: null,
    });

    const result = await getUserOrganizationIds(client, userId);
    expect(result).toEqual([orgId1, orgId2]);
  });

  it('returns empty array for non-member', async () => {
    const client = createMockClientForList({
      data: [],
      error: null,
    });

    const result = await getUserOrganizationIds(client, userId);
    expect(result).toEqual([]);
  });

  it('throws on database error', async () => {
    const client = createMockClientForList({
      data: null,
      error: { message: 'db error' },
    });

    await expect(getUserOrganizationIds(client, userId)).rejects.toThrow(
      TenantAccessError,
    );
  });
});

describe('assertTenantMatch', () => {
  it('succeeds when organization IDs match', () => {
    const orgId = randomUUID();
    expect(() => assertTenantMatch(orgId, orgId)).not.toThrow();
  });

  it('throws TenantAccessError when organization IDs differ', () => {
    const orgA = randomUUID();
    const orgB = randomUUID();
    expect(() => assertTenantMatch(orgA, orgB)).toThrow(TenantAccessError);
  });
});

describe('Cross-tenant isolation scenarios', () => {
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();

  it('Organization A user cannot access Organization B', async () => {
    // Simulate: userA belongs to orgA only, tries to access orgB
    const client = createMockClient({
      data: null, // no membership found for userA in orgB
      error: null,
    });

    await expect(
      verifyOrganizationMembership(client, userA, orgB),
    ).rejects.toThrow(TenantAccessError);
  });

  it('assertTenantMatch prevents cross-org resource access', () => {
    // A resource with orgA cannot be accessed under orgB context
    expect(() => assertTenantMatch(orgA, orgB)).toThrow(TenantAccessError);
    expect(() => assertTenantMatch(orgB, orgA)).toThrow(TenantAccessError);
  });

  it('Organization A user can access Organization A', async () => {
    const client = createMockClient({
      data: { id: randomUUID() },
      error: null,
    });

    await expect(
      verifyOrganizationMembership(client, userA, orgA),
    ).resolves.toBeUndefined();
  });
});
