import { createCipheriv, createDecipheriv, randomBytes, createHash, createHmac } from 'crypto';

/**
 * AES-256-GCM encryption for secrets at rest (e.g. per-tenant WhatsApp tokens).
 * Format: v1:<iv-hex>:<tag-hex>:<ciphertext-hex>. Plaintext round-trips
 * unchanged when no key is configured (so local/dev keeps working).
 */
export class SecretBox {
  private readonly key: Buffer | null;

  constructor(secret?: string) {
    // Derive a stable 32-byte key from the provided secret (hex, base64, or passphrase).
    this.key = secret ? createHash('sha256').update(secret).digest() : null;
  }

  get enabled(): boolean {
    return this.key !== null;
  }

  encrypt(plaintext: string): string {
    if (!this.key) return plaintext;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
  }

  /**
   * Deterministic keyed hash ("blind index") of a value, for equality lookups
   * on an encrypted column without exposing the plaintext. Same input → same
   * index, so `WHERE phone_bidx = blindIndex(phone)` works over ciphertext.
   */
  blindIndex(value: string): string | null {
    if (!this.key) return null;
    return createHmac('sha256', this.key).update(value.trim().toLowerCase()).digest('hex');
  }

  decrypt(value: string): string {
    if (!this.key || !value.startsWith('v1:')) return value;
    const [, ivHex, tagHex, ctHex] = value.split(':');
    if (!ivHex || !tagHex || !ctHex) return value;
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivHex, 'hex'));
      decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
      return Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]).toString('utf8');
    } catch {
      return value;
    }
  }
}

/**
 * Privacy-preserving display value for a phone number stored at rest.
 * Preserves a leading `+` and a short country hint, masks the middle, and keeps
 * only the last 4 digits: `+918770507368` → `+91••••••7368`. This is what the
 * dashboard (anon key, reads `contacts.phone_number` directly) sees, so a DB
 * dump never exposes a full, reachable number. Short/edge inputs are handled
 * safely (never throws, always keeps whatever it can).
 */
export function maskPhone(phone: string): string {
  const raw = (phone ?? '').trim();
  if (!raw) return raw;
  const hasPlus = raw.startsWith('+');
  const digits = raw.replace(/\D/g, '');
  const prefix = hasPlus ? '+' : '';
  if (digits.length <= 4) return `${prefix}${digits}`;
  const last4 = digits.slice(-4);
  // Country hint: up to 2 leading digits, only when there's room to still mask.
  const hintLen = digits.length >= 8 ? 2 : 0;
  const hint = digits.slice(0, hintLen);
  const maskedCount = Math.max(digits.length - hintLen - 4, 1);
  return `${prefix}${hint}${'•'.repeat(maskedCount)}${last4}`;
}
