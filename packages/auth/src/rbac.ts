import type { UserRole, PermissionAction, UserSession } from './types';
import { PERMISSION_MATRIX } from './types';

export function hasPermission(role: UserRole, action: PermissionAction): boolean {
  const allowedActions = PERMISSION_MATRIX[role] ?? [];
  return allowedActions.includes(action);
}

export function assertPermission(session: UserSession, action: PermissionAction): void {
  if (!hasPermission(session.role, action)) {
    throw new Error(`Permission denied: Action '${action}' requires higher privileges than '${session.role}'.`);
  }
}

export function canAccessTenant(session: UserSession, targetOrgId: string): boolean {
  return session.organizationId === targetOrgId;
}
