import type { UserRole, UserSession } from './types';
import { PERMISSION_MATRIX } from './types';

export class AuthService {

  public static createSession(params: {
    userId: string;
    email: string;
    organizationId: string;
    role: UserRole;
    verticalId?: string;
    expiresInSeconds?: number;
  }): UserSession {
    const now = Math.floor(Date.now() / 1000);
    const ttl = params.expiresInSeconds ?? 86400; // 24h

    return {
      userId: params.userId,
      email: params.email,
      organizationId: params.organizationId,
      role: params.role,
      verticalId: params.verticalId ?? 'travel',
      permissions: PERMISSION_MATRIX[params.role] ?? [],
      issuedAt: now,
      expiresAt: now + ttl
    };
  }

  public static validateSession(session: UserSession): { valid: boolean; reason?: string } {
    const now = Math.floor(Date.now() / 1000);
    if (session.expiresAt <= now) {
      return { valid: false, reason: 'Session expired' };
    }
    if (!session.organizationId || !session.userId) {
      return { valid: false, reason: 'Invalid session claims' };
    }
    return { valid: true };
  }

  public static generateMetaOAuthUrl(params: { appId: string; redirectUri: string; state: string }): string {
    const scopes = ['whatsapp_business_management', 'whatsapp_business_messaging', 'pages_show_list'];
    return `https://www.facebook.com/v19.0/dialog/oauth?client_id=${params.appId}&redirect_uri=${encodeURIComponent(params.redirectUri)}&scope=${scopes.join(',')}&state=${params.state}&response_type=code`;
  }
}
