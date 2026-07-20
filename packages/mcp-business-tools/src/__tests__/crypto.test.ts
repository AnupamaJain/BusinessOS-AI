import { describe, it, expect } from 'vitest';
import { SecretBox } from '../crypto';

describe('SecretBox', () => {
  it('round-trips ciphertext with a key', () => {
    const box = new SecretBox('test-key-material');
    const enc = box.encrypt('EAAG-secret-token');
    expect(enc.startsWith('v1:')).toBe(true);
    expect(enc).not.toContain('EAAG-secret-token');
    expect(box.decrypt(enc)).toBe('EAAG-secret-token');
  });

  it('passes through plaintext when no key is configured', () => {
    const box = new SecretBox();
    expect(box.enabled).toBe(false);
    expect(box.encrypt('hello')).toBe('hello');
    expect(box.decrypt('hello')).toBe('hello');
    expect(box.blindIndex('hello')).toBeNull();
  });

  it('produces a stable, case/space-insensitive blind index for equality lookups', () => {
    const box = new SecretBox('idx-key');
    const a = box.blindIndex('+91 8770507368');
    const b = box.blindIndex('+91 8770507368');
    expect(a).toBe(b);
    expect(box.blindIndex('  ABC ')).toBe(box.blindIndex('abc'));
    expect(box.blindIndex('phone-a')).not.toBe(box.blindIndex('phone-b'));
    // The index is a keyed hash, not reversible plaintext.
    expect(a).not.toContain('8770507368');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('derives different indexes under different keys', () => {
    const k1 = new SecretBox('key-one');
    const k2 = new SecretBox('key-two');
    expect(k1.blindIndex('same')).not.toBe(k2.blindIndex('same'));
  });

  it('returns the original value when decrypt cannot authenticate', () => {
    const box = new SecretBox('k');
    expect(box.decrypt('v1:bad:bad:bad')).toBe('v1:bad:bad:bad');
    expect(box.decrypt('not-encrypted')).toBe('not-encrypted');
  });
});
