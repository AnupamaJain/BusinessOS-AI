import { describe, it, expect } from 'vitest';
import { SecretBox, maskPhone } from '../crypto';

describe('maskPhone', () => {
  it('keeps only the last 4 digits (plus a country hint), masks the middle', () => {
    const masked = maskPhone('+918770507368');
    expect(masked).toBe('+91••••••7368');
    // Last 4 are visible…
    expect(masked.endsWith('7368')).toBe(true);
    // …the reachable middle digits are gone.
    expect(masked).not.toContain('877050');
    expect(masked).toContain('•');
  });

  it('preserves a leading + and masks numbers without one', () => {
    expect(maskPhone('918770507368')).toBe('91••••••7368');
    expect(maskPhone('+918770507368').startsWith('+')).toBe(true);
  });

  it('handles short / edge inputs safely (never throws)', () => {
    expect(maskPhone('')).toBe('');
    expect(maskPhone('   ')).toBe('');
    expect(maskPhone('1234')).toBe('1234');
    expect(maskPhone('+1234')).toBe('+1234');
    // 5–7 digit values have no country hint but still mask the middle.
    expect(maskPhone('+123456')).toMatch(/^\+•+3456$/);
  });
});

describe('contact phone encryption at rest', () => {
  const box = new SecretBox('contact-pii-key');
  const phone = '+918770507368';

  it('round-trips the real phone through encrypt → decrypt', () => {
    const enc = box.encrypt(phone);
    expect(enc.startsWith('v1:')).toBe(true);
    expect(enc).not.toContain('8770507368');
    expect(box.decrypt(enc)).toBe(phone);
  });

  it('produces a stable blind index for the same normalized phone', () => {
    const a = box.blindIndex(phone);
    const b = box.blindIndex(phone);
    expect(a).toBe(b);
    expect(a).not.toBeNull();
    expect(a).not.toContain('8770507368');
  });

  it('the mask stored in phone_number never exposes the full number', () => {
    expect(maskPhone(phone)).not.toContain('8770507368');
  });

  it('no key → plaintext passthrough, no blind index (local/dev unchanged)', () => {
    const plain = new SecretBox();
    expect(plain.enabled).toBe(false);
    expect(plain.encrypt(phone)).toBe(phone);
    expect(plain.blindIndex(phone)).toBeNull();
  });
});
