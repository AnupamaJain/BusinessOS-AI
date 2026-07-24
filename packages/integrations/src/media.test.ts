import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenMontageMediaService, createMediaServiceFromEnv } from './media';

/** Route a mocked fetch by URL so real code paths run against fake responses. */
function stubFetch() {
  const mock = vi.fn(async (url: string) => {
    if (url.includes('api.pexels.com/videos')) {
      return { ok: true, status: 200, json: async () => ({ videos: [{ id: 42, image: 'https://img/preview.jpg', video_files: [{ link: 'https://vid/hd.mp4', quality: 'hd', file_type: 'video/mp4' }] }] }) };
    }
    if (url.includes('texttospeech.googleapis.com')) {
      return { ok: true, status: 200, json: async () => ({ audioContent: 'BASE64AUDIO' }) };
    }
    if (url.includes('pixabay.com/api/videos')) {
      return { ok: true, status: 200, json: async () => ({ hits: [{ id: 7, tags: 'money', videos: { large: { url: 'https://pix/large.mp4' } } }] }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('OpenMontageMediaService', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reports capabilities from env keys', () => {
    expect(new OpenMontageMediaService({}).isConfigured).toBe(false);
    const svc = createMediaServiceFromEnv({ PEXELS_API_KEY: 'k' });
    expect(svc.canSearchStock).toBe(true);
    expect(svc.isConfigured).toBe(true);
  });

  it('searches real Pexels footage and maps the mp4 link', async () => {
    stubFetch();
    const svc = new OpenMontageMediaService({ PEXELS_API_KEY: 'k' });
    const stock = await svc.searchStockFootage({ query: 'mutual funds', mediaType: 'video' });
    expect(stock.items).toHaveLength(1);
    expect(stock.items[0]?.provider).toBe('pexels');
    expect(stock.items[0]?.url).toBe('https://vid/hd.mp4');
  });

  it('falls back to Pixabay when Pexels has no key', async () => {
    stubFetch();
    const svc = new OpenMontageMediaService({ PIXABAY_API_KEY: 'k' });
    const stock = await svc.searchStockFootage({ query: 'sip', mediaType: 'video' });
    expect(stock.items[0]?.provider).toBe('pixabay');
    expect(stock.items[0]?.url).toBe('https://pix/large.mp4');
  });

  it('returns empty (never throws) when no stock key is configured', async () => {
    const svc = new OpenMontageMediaService({});
    expect((await svc.searchStockFootage({ query: 'x' })).items).toEqual([]);
  });

  it('generates real narration via Google TTS', async () => {
    stubFetch();
    const svc = new OpenMontageMediaService({ GOOGLE_CLOUD_TTS_API_KEY: 'k' });
    const n = await svc.generateVoiceNarration('Grow your wealth with a disciplined SIP.');
    expect(n.audioBase64).toBe('BASE64AUDIO');
    expect(n.provider).toBe('google-tts');
    expect(n.durationSec).toBeGreaterThan(0);
  });

  it('skips narration gracefully with no TTS key', async () => {
    const n = await new OpenMontageMediaService({}).generateVoiceNarration('hello there');
    expect(n.skipped).toBe(true);
    expect(n.durationSec).toBeGreaterThan(0);
  });

  it('teaser returns a real asset kit (assets_ready) without a renderer', async () => {
    stubFetch();
    const svc = new OpenMontageMediaService({ PEXELS_API_KEY: 'k', GOOGLE_CLOUD_TTS_API_KEY: 'k' });
    const r = await svc.generateVideoTeaser({ topic: 'index funds', style: 'product_ad' });
    expect(r.renderStatus).toBe('assets_ready');
    expect(r.success).toBe(true);
    expect((r.metadata?.clips as unknown[]).length).toBeGreaterThan(0);
    expect(r.metadata?.narrationAudioBase64).toBe('BASE64AUDIO');
  });

  it('teaser is unconfigured (no fake URL) when nothing is set up', async () => {
    const r = await new OpenMontageMediaService({}).generateVideoTeaser({ topic: 'x' });
    expect(r.renderStatus).toBe('unconfigured');
    expect(r.success).toBe(false);
    expect(r.mediaUrl).toBe('');
  });
});
