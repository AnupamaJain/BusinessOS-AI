import { TenantAccessError } from '@whatsapp-smb/shared-types';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Verifies that the given userId is a member of the given organizationId.
 * This is the server-side authorization gate — never trust organization_id
 * from client input without this check.
 *
 * @throws TenantAccessError if the user is not a member.
 */
export async function verifyOrganizationMembership(
  client: SupabaseClient,
  userId: string,
  organizationId: string,
): Promise<void> {
  const { data, error } = await client
    .from('organization_members')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new TenantAccessError(
      'Failed to verify organization membership.',
    );
  }

  if (!data) {
    throw new TenantAccessError(
      'Access denied for this organization.',
    );
  }
}

/**
 * Returns the list of organization IDs that the user is a member of.
 * Used to scope queries when RLS policies reference user membership.
 */
export async function getUserOrganizationIds(
  client: SupabaseClient,
  userId: string,
): Promise<string[]> {
  const { data, error } = await client
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', userId);

  if (error) {
    throw new TenantAccessError(
      'Failed to fetch user organization memberships.',
    );
  }

  return (data ?? []).map(
    (row: { organization_id: string }) => row.organization_id,
  );
}

/**
 * Asserts that a resource belongs to the specified organization.
 * Lightweight check for service-layer use before mutations.
 */
export function assertTenantMatch(
  resourceOrgId: string,
  expectedOrgId: string,
): void {
  if (resourceOrgId !== expectedOrgId) {
    throw new TenantAccessError(
      'Resource does not belong to the active organization.',
    );
  }
}
