/**
 * Supabase-backed authentication helpers.
 *
 * These use plain fetch against the Supabase Auth and PostgREST APIs so the
 * auth package stays dependency-free. Token verification is delegated to
 * Supabase (`/auth/v1/user`), which validates the JWT signature and expiry
 * server-side.
 */

export interface VerifiedSupabaseUser {
  userId: string;
  email?: string;
}

export interface OrganizationMembership {
  organizationId: string;
  role: string;
}

/**
 * Verifies a Supabase access token by asking Supabase Auth for the user it
 * belongs to. Returns the user identity on success, or null for any invalid,
 * expired, or malformed token. Never throws.
 */
export async function verifySupabaseAccessToken(params: {
  supabaseUrl: string;
  anonKey: string;
  accessToken: string;
}): Promise<VerifiedSupabaseUser | null> {
  try {
    const response = await fetch(`${params.supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: params.anonKey,
        Authorization: `Bearer ${params.accessToken}`
      }
    });

    if (response.status !== 200) {
      return null;
    }

    const json = (await response.json()) as { id?: string; email?: string };
    if (!json.id) {
      return null;
    }

    return { userId: json.id, email: json.email };
  } catch {
    return null;
  }
}

/**
 * Looks up a user's organization membership via PostgREST using the service
 * role key. Returns the first matching membership, or null when the user
 * belongs to no organization (or the lookup fails).
 */
export async function getOrganizationRole(params: {
  supabaseUrl: string;
  serviceRoleKey: string;
  userId: string;
  organizationId?: string;
}): Promise<OrganizationMembership | null> {
  try {
    let url = `${params.supabaseUrl}/rest/v1/organization_members?user_id=eq.${params.userId}&select=organization_id,role`;
    if (params.organizationId) {
      url += `&organization_id=eq.${params.organizationId}`;
    }

    const response = await fetch(url, {
      headers: {
        apikey: params.serviceRoleKey,
        Authorization: `Bearer ${params.serviceRoleKey}`
      }
    });

    if (response.status !== 200) {
      return null;
    }

    const rows = (await response.json()) as Array<{ organization_id?: string; role?: string }>;
    const first = rows[0];
    if (!first?.organization_id || !first.role) {
      return null;
    }

    return { organizationId: first.organization_id, role: first.role };
  } catch {
    return null;
  }
}
