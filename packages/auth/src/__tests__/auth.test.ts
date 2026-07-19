import { describe, it, expect } from 'vitest';
import { AuthService, hasPermission, assertPermission, canAccessTenant } from '../index';

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';

describe('AuthService & RBAC', () => {
  it('creates a valid session with appropriate permissions for owner', () => {
    const session = AuthService.createSession({
      userId: USER_ID,
      email: 'owner@travelagency.com',
      organizationId: ORG_A,
      role: 'owner',
      verticalId: 'travel'
    });

    expect(session.userId).toBe(USER_ID);
    expect(session.role).toBe('owner');
    expect(session.permissions).toContain('org:delete');
    expect(session.permissions).toContain('campaigns:schedule');

    const validation = AuthService.validateSession(session);
    expect(validation.valid).toBe(true);
  });

  it('enforces RBAC permissions correctly', () => {
    expect(hasPermission('owner', 'org:delete')).toBe(true);
    expect(hasPermission('sales_agent', 'org:delete')).toBe(false);
    expect(hasPermission('sales_agent', 'conversations:reply')).toBe(true);
    expect(hasPermission('support_agent', 'campaigns:schedule')).toBe(false);
  });

  it('validates tenant access boundaries', () => {
    const session = AuthService.createSession({
      userId: USER_ID,
      email: 'agent@travel.com',
      organizationId: ORG_A,
      role: 'sales_agent'
    });

    expect(canAccessTenant(session, ORG_A)).toBe(true);
    expect(canAccessTenant(session, ORG_B)).toBe(false);

    expect(() => assertPermission(session, 'org:delete')).toThrow('Permission denied');
  });

  it('generates valid Meta OAuth dialog URL', () => {
    const url = AuthService.generateMetaOAuthUrl({
      appId: '123456789',
      redirectUri: 'https://app.businessos.ai/auth/callback',
      state: 'nonce123'
    });

    expect(url).toContain('client_id=123456789');
    expect(url).toContain('whatsapp_business_management');
  });
});
