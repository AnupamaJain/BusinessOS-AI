import { describe, it, expect } from 'vitest';
import {
  normalizeFilter,
  signTrack,
  verifyTrack,
  trackedUrl,
  wrapEmailLinks,
  personalize,
  computeStats,
  engagementScore,
} from '../marketing';

const SECRET = 'test-secret-key';

describe('normalizeFilter', () => {
  it('keeps only valid, positive constraints', () => {
    expect(
      normalizeFilter({ stages: ['qualified', ''], minScore: 40, serviceInterest: ' spa ', recencyDays: 7.9, requireEmail: true }),
    ).toEqual({ stages: ['qualified'], minScore: 40, serviceInterest: 'spa', recencyDays: 7, requireEmail: true });
  });
  it('drops junk / non-positive values', () => {
    expect(normalizeFilter({ minScore: 0, recencyDays: -3, requireEmail: false, stages: 'x' })).toEqual({});
    expect(normalizeFilter(null)).toEqual({});
  });
});

describe('tracked-link tokens', () => {
  it('round-trips a payload through sign → verify', () => {
    const p = { c: 'camp1', r: 'rcpt1', u: 'https://example.com/book' };
    const token = signTrack(SECRET, p);
    expect(verifyTrack(SECRET, token)).toEqual(p);
  });
  it('rejects a tampered payload', () => {
    const token = signTrack(SECRET, { c: 'c', r: 'r', u: 'https://a.com' });
    const [body] = token.split('.');
    expect(verifyTrack(SECRET, `${body}.deadbeef`)).toBeNull();
  });
  it('rejects a token signed with a different secret', () => {
    const token = signTrack('other', { c: 'c', r: 'r', u: 'https://a.com' });
    expect(verifyTrack(SECRET, token)).toBeNull();
  });
  it('rejects malformed tokens', () => {
    expect(verifyTrack(SECRET, 'nodot')).toBeNull();
    expect(verifyTrack(SECRET, '')).toBeNull();
  });
  it('builds a /r/ tracked url', () => {
    const url = trackedUrl('https://gw.example.com/', SECRET, { c: 'c', r: 'r', u: 'https://x.com' });
    expect(url).toMatch(/^https:\/\/gw\.example\.com\/r\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });
});

describe('wrapEmailLinks', () => {
  it('routes http(s) links through the tracker but leaves other hrefs alone', () => {
    const html = '<a href="https://shop.example.com/x">Shop</a> <a href="mailto:a@b.com">mail</a> <a href="#top">top</a>';
    const out = wrapEmailLinks(html, 'https://gw', SECRET, 'camp', 'rcpt');
    expect(out).toContain('href="https://gw/r/');
    expect(out).toContain('href="mailto:a@b.com"');
    expect(out).toContain('href="#top"');
    // The tracked token decodes back to the original destination.
    const token = out.match(/\/r\/([^"]+)/)?.[1] ?? '';
    expect(verifyTrack(SECRET, token)?.u).toBe('https://shop.example.com/x');
  });
});

describe('personalize', () => {
  it('substitutes known placeholders and blanks unknown ones', () => {
    expect(personalize('Hi {{name}}, book at {{url}} — {{missing}}', { name: 'Asha', url: 'x' })).toBe('Hi Asha, book at x — ');
  });
});

describe('computeStats', () => {
  it('computes rates off the sent base', () => {
    const stats = computeStats([
      { status: 'read', delivered_at: 't', opened_at: 't', clicked_at: 't', converted_at: 't' },
      { status: 'delivered', delivered_at: 't', opened_at: null, clicked_at: null, converted_at: null },
      { status: 'sent', delivered_at: null, opened_at: null, clicked_at: null, converted_at: null },
      { status: 'failed', delivered_at: null, opened_at: null, clicked_at: null, converted_at: null },
      { status: 'queued', delivered_at: null, opened_at: null, clicked_at: null, converted_at: null },
    ]);
    expect(stats.total).toBe(5);
    expect(stats.sent).toBe(3); // read + delivered + sent (not failed/queued)
    expect(stats.delivered).toBe(2);
    expect(stats.opened).toBe(1);
    expect(stats.clicked).toBe(1);
    expect(stats.converted).toBe(1);
    expect(stats.openRate).toBeCloseTo(33.3, 1);
    expect(stats.ctr).toBeCloseTo(33.3, 1);
  });
  it('handles an empty campaign without dividing by zero', () => {
    const s = computeStats([]);
    expect(s).toMatchObject({ total: 0, sent: 0, openRate: 0, ctr: 0, conversionRate: 0 });
  });
});

describe('engagementScore', () => {
  it('rewards recent activity and clamps to 0–100', () => {
    expect(engagementScore({ opens: 0, clicks: 0, conversions: 0, inboundMessages: 0, daysSinceLastActivity: null })).toBe(0);
    expect(
      engagementScore({ opens: 5, clicks: 5, conversions: 5, inboundMessages: 5, daysSinceLastActivity: 0 }),
    ).toBe(100);
    const mid = engagementScore({ opens: 1, clicks: 1, conversions: 0, inboundMessages: 1, daysSinceLastActivity: 5 });
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(100);
  });
});
