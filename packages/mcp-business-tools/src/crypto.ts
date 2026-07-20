import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

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
