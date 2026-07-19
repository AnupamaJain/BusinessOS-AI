import { z } from 'zod';

export type UserRole = 'owner' | 'manager' | 'sales_agent' | 'support_agent';

export interface UserSession {
  userId: string;
  email: string;
  organizationId: string;
  role: UserRole;
  verticalId: string;
  permissions: string[];
  issuedAt: number;
  expiresAt: number;
}

export type PermissionAction =
  | 'org:read' | 'org:write' | 'org:delete'
  | 'members:invite' | 'members:remove' | 'members:update_role'
  | 'conversations:read' | 'conversations:reply' | 'conversations:resolve'
  | 'leads:read' | 'leads:write' | 'leads:assign'
  | 'catalog:read' | 'catalog:write'
  | 'campaigns:read' | 'campaigns:schedule'
  | 'settings:read' | 'settings:write'
  | 'audit:read';

export const PERMISSION_MATRIX: Record<UserRole, PermissionAction[]> = {
  owner: [
    'org:read', 'org:write', 'org:delete',
    'members:invite', 'members:remove', 'members:update_role',
    'conversations:read', 'conversations:reply', 'conversations:resolve',
    'leads:read', 'leads:write', 'leads:assign',
    'catalog:read', 'catalog:write',
    'campaigns:read', 'campaigns:schedule',
    'settings:read', 'settings:write',
    'audit:read'
  ],
  manager: [
    'org:read', 'org:write',
    'members:invite',
    'conversations:read', 'conversations:reply', 'conversations:resolve',
    'leads:read', 'leads:write', 'leads:assign',
    'catalog:read', 'catalog:write',
    'campaigns:read', 'campaigns:schedule',
    'settings:read',
    'audit:read'
  ],
  sales_agent: [
    'conversations:read', 'conversations:reply', 'conversations:resolve',
    'leads:read', 'leads:write',
    'catalog:read',
    'campaigns:read'
  ],
  support_agent: [
    'conversations:read', 'conversations:reply', 'conversations:resolve',
    'catalog:read'
  ]
};

export const SessionClaimsSchema = z.object({
  sub: z.string().uuid(),
  email: z.string().email(),
  org: z.string().uuid(),
  role: z.enum(['owner', 'manager', 'sales_agent', 'support_agent']),
  vertical: z.string().default('travel'),
  iat: z.number(),
  exp: z.number()
});
