/**
 * Promotional media generation — REAL, not mocked.
 *
 * Three capabilities, each degrades gracefully when its provider key is absent
 * (mirrors the other integrations: `isConfigured` + never throws):
 *   1. searchStockFootage   → real Pexels (primary) / Pixabay (fallback) search
 *   2. generateVoiceNarration → real Google Cloud TTS (returns base64 audio)
 *   3. generateVideoTeaser  → assembles real stock + narration into a storyboard;
 *      renders a real MP4 via Shotstack when SHOTSTACK_API_KEY is set, otherwise
 *      returns the real asset kit with renderStatus='assets_ready'.
 *
 * Pure `fetch` — no SDK dependency — so it stays inside the esbuild bundle.
 */
import { TtsService } from './tts';

export interface GenerateVideoTeaserOptions {
  topic: string;
  durationSec?: number;
  style?: 'cinematic' | 'anime' | 'documentary' | 'product_ad' | 'travel_reel';
  aspectRatio?: '16:9' | '9:16' | '1:1';
  /** Optional narration script; when omitted a line is derived from the topic. */
  narration?: string;
}

export interface StoryboardClip {
  url: string;
  previewUrl: string;
  provider: string;
  title: string;
}

export interface GeneratedMediaResult {
  success: boolean;
  /** Rendered MP4 URL when a renderer is configured + finished; else ''. */
  mediaUrl: string;
  mediaType: 'video' | 'image' | 'audio';
  durationSec: number;
  providerUsed: string;
  caption: string;
  costEstUsd: number;
  /** 'done' | 'rendering' | 'assets_ready' | 'unconfigured' | 'failed'. */
  renderStatus: string;
  /** Shotstack render id when a render was submitted (poll for completion). */
  renderId?: string;
  metadata?: Record<string, unknown>;
}

export interface StockFootageQuery {
  query: string;
  mediaType?: 'video' | 'image';
  limit?: number;
}

export interface StockFootageResult {
  items: Array<{
    id: string;
    url: string;
    previewUrl: string;
    provider: 'pexels' | 'pixabay' | 'unsplash' | 'archive';
    title: string;
  }>;
}

export interface NarrationResult {
  /** base64-encoded audio when TTS is configured. */
  audioBase64?: string;
  mimeType?: string;
  durationSec: number;
  provider: string;
  skipped?: boolean;
}

const SHOTSTACK_ASPECTS: Record<string, string> = { '16:9': '16:9', '9:16': '9:16', '1:1': '1:1' };

export class OpenMontageMediaService {
  private readonly pexelsKey?: string;
  private readonly pixabayKey?: string;
  private readonly shotstackKey?: string;
  private readonly shotstackEnv: string;
  private readonly tts: TtsService;

  constructor(env: Record<string, string | undefined> = process.env) {
    this.pexelsKey = env['PEXELS_API_KEY'];
    this.pixabayKey = env['PIXABAY_API_KEY'];
    this.shotstackKey = env['SHOTSTACK_API_KEY'];
    this.shotstackEnv = env['SHOTSTACK_ENV'] ?? 'stage'; // 'stage' = free sandbox
    this.tts = new TtsService({
      apiKey: env['GOOGLE_CLOUD_TTS_API_KEY'],
      languageCode: env['TTS_LANGUAGE_CODE'] ?? 'en-IN',
      voiceName: env['TTS_VOICE_NAME'],
    });
  }

  get canSearchStock(): boolean { return Boolean(this.pexelsKey || this.pixabayKey); }
  get canNarrate(): boolean { return this.tts.isConfigured; }
  get canRender(): boolean { return Boolean(this.shotstackKey); }
  /** Configured enough to produce *some* real asset. */
  get isConfigured(): boolean { return this.canSearchStock || this.canNarrate; }

  // ── 1. Stock footage (real Pexels / Pixabay) ─────────────────────
  async searchStockFootage(options: StockFootageQuery): Promise<StockFootageResult> {
    const limit = Math.min(options.limit ?? 5, 20);
    const type = options.mediaType ?? 'video';
    try {
      if (this.pexelsKey) {
        const items = await this.searchPexels(options.query, type, limit);
        if (items.length) return { items };
      }
      if (this.pixabayKey) {
        const items = await this.searchPixabay(options.query, type, limit);
        if (items.length) return { items };
      }
    } catch {
      // fall through to empty
    }
    return { items: [] };
  }

  private async searchPexels(query: string, type: 'video' | 'image', limit: number): Promise<StockFootageResult['items']> {
    const url = type === 'video'
      ? `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${limit}`
      : `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${limit}`;
    const res = await fetch(url, { headers: { Authorization: this.pexelsKey ?? '' } });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      videos?: Array<{ id: number; image: string; video_files: Array<{ link: string; quality: string; file_type: string }> }>;
      photos?: Array<{ id: number; alt?: string; src: { original: string; large: string; medium: string } }>;
    };
    if (type === 'video') {
      return (data.videos ?? []).map((v) => {
        const file = v.video_files.find((f) => f.quality === 'hd' && f.file_type === 'video/mp4') ?? v.video_files.find((f) => f.file_type === 'video/mp4') ?? v.video_files[0];
        return { id: `pexels-${v.id}`, url: file?.link ?? '', previewUrl: v.image, provider: 'pexels' as const, title: `${query} clip` };
      }).filter((i) => i.url);
    }
    return (data.photos ?? []).map((p) => ({ id: `pexels-${p.id}`, url: p.src.large, previewUrl: p.src.medium, provider: 'pexels' as const, title: p.alt || `${query} photo` }));
  }

  private async searchPixabay(query: string, type: 'video' | 'image', limit: number): Promise<StockFootageResult['items']> {
    const base = type === 'video' ? 'https://pixabay.com/api/videos/' : 'https://pixabay.com/api/';
    const res = await fetch(`${base}?key=${this.pixabayKey}&q=${encodeURIComponent(query)}&per_page=${limit}&safesearch=true`);
    if (!res.ok) return [];
    const data = (await res.json()) as {
      hits?: Array<{ id: number; tags?: string; videos?: { large?: { url: string }; medium?: { url: string } }; webformatURL?: string; largeImageURL?: string; previewURL?: string }>;
    };
    return (data.hits ?? []).map((h) => {
      if (type === 'video') {
        const v = h.videos?.large?.url ?? h.videos?.medium?.url ?? '';
        return { id: `pixabay-${h.id}`, url: v, previewUrl: '', provider: 'pixabay' as const, title: h.tags || `${query} clip` };
      }
      return { id: `pixabay-${h.id}`, url: h.largeImageURL ?? h.webformatURL ?? '', previewUrl: h.previewURL ?? '', provider: 'pixabay' as const, title: h.tags || `${query} photo` };
    }).filter((i) => i.url);
  }

  // ── 2. Voice narration (real Google Cloud TTS) ───────────────────
  async generateVoiceNarration(text: string, opts?: { languageCode?: string; voiceName?: string }): Promise<NarrationResult> {
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    const durationSec = Math.max(3, Math.ceil(words / 2.5)); // ~150 wpm
    if (!this.tts.isConfigured) {
      return { durationSec, provider: 'none', skipped: true };
    }
    const r = await this.tts.synthesize({ text, languageCode: opts?.languageCode, voiceName: opts?.voiceName });
    if (!r.ok || !r.audioBase64) return { durationSec, provider: 'google-tts', skipped: true };
    return { audioBase64: r.audioBase64, mimeType: r.mimeType ?? 'audio/ogg', durationSec, provider: 'google-tts' };
  }

  // ── 3. Video teaser (real assets → optional Shotstack render) ────
  async generateVideoTeaser(options: GenerateVideoTeaserOptions): Promise<GeneratedMediaResult> {
    const duration = options.durationSec ?? 15;
    const style = options.style ?? 'product_ad';
    const aspect = options.aspectRatio ?? '9:16';
    const narrationText = options.narration ?? `Discover ${options.topic}. Book with us today.`;
    const caption = `🎬 ${options.topic} (${style})`;

    if (!this.isConfigured) {
      return {
        success: false, mediaUrl: '', mediaType: 'video', durationSec: duration,
        providerUsed: 'none', caption, costEstUsd: 0, renderStatus: 'unconfigured',
        metadata: { hint: 'Set PEXELS_API_KEY / PIXABAY_API_KEY (footage), GOOGLE_CLOUD_TTS_API_KEY (narration), SHOTSTACK_API_KEY (render).' },
      };
    }

    // Real assets: stock clips + narration audio.
    const stock = await this.searchStockFootage({ query: options.topic, mediaType: 'video', limit: 3 });
    const narration = await this.generateVoiceNarration(narrationText);
    const clips: StoryboardClip[] = stock.items.map((i) => ({ url: i.url, previewUrl: i.previewUrl, provider: i.provider, title: i.title }));

    const baseMeta = {
      style, aspectRatio: aspect, narrationScript: narrationText,
      clips, narrationDurationSec: narration.durationSec, narrationProvider: narration.provider,
      hasNarrationAudio: Boolean(narration.audioBase64),
    };

    // Render a real MP4 when Shotstack is configured and we have footage.
    if (this.canRender && clips.length > 0) {
      try {
        const rendered = await this.renderWithShotstack(clips, options.topic, duration, aspect);
        return {
          success: true, mediaUrl: rendered.url ?? '', mediaType: 'video', durationSec: duration,
          providerUsed: `shotstack-${this.shotstackEnv}`, caption, costEstUsd: 0,
          renderStatus: rendered.status, renderId: rendered.id,
          metadata: { ...baseMeta, narrationAudioBase64: narration.audioBase64 },
        };
      } catch (err) {
        return {
          success: false, mediaUrl: '', mediaType: 'video', durationSec: duration,
          providerUsed: 'shotstack', caption, costEstUsd: 0, renderStatus: 'failed',
          metadata: { ...baseMeta, error: err instanceof Error ? err.message : String(err) },
        };
      }
    }

    // No renderer: return the real asset kit (clips + narration).
    return {
      success: clips.length > 0 || Boolean(narration.audioBase64), mediaUrl: '', mediaType: 'video',
      durationSec: duration, providerUsed: `${clips[0]?.provider ?? 'stock'}+${narration.provider}`,
      caption, costEstUsd: 0, renderStatus: 'assets_ready',
      metadata: { ...baseMeta, narrationAudioBase64: narration.audioBase64, note: 'Real footage + narration ready; set SHOTSTACK_API_KEY to auto-render a single MP4.' },
    };
  }

  private async renderWithShotstack(clips: StoryboardClip[], title: string, duration: number, aspect: string): Promise<{ status: string; url?: string; id?: string }> {
    const per = Math.max(2, Math.round(duration / clips.length));
    const videoClips = clips.map((c, i) => ({
      asset: { type: 'video', src: c.url }, start: i * per, length: per, fit: 'crop',
      transition: { in: 'fade', out: 'fade' },
    }));
    const titleClip = { asset: { type: 'title', text: title, style: 'minimal', size: 'medium' }, start: 0, length: Math.min(duration, per) };
    const body = {
      timeline: { background: '#000000', tracks: [{ clips: [titleClip] }, { clips: videoClips }] },
      output: { format: 'mp4', aspectRatio: SHOTSTACK_ASPECTS[aspect] ?? '9:16' },
    };
    const submit = await fetch(`https://api.shotstack.io/${this.shotstackEnv}/render`, {
      method: 'POST',
      headers: { 'x-api-key': this.shotstackKey ?? '', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!submit.ok) throw new Error(`Shotstack submit failed (${submit.status})`);
    const id = ((await submit.json()) as { response?: { id?: string } }).response?.id;
    if (!id) throw new Error('Shotstack returned no render id');

    // Bounded poll (renders are async; return 'rendering' + id if not done in time).
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const poll = await fetch(`https://api.shotstack.io/${this.shotstackEnv}/render/${id}`, { headers: { 'x-api-key': this.shotstackKey ?? '' } });
      if (!poll.ok) continue;
      const st = ((await poll.json()) as { response?: { status?: string; url?: string } }).response;
      if (st?.status === 'done') return { status: 'done', url: st.url, id };
      if (st?.status === 'failed') return { status: 'failed', id };
    }
    return { status: 'rendering', id };
  }
}

/** Build a media service from env (matches createXFromEnv convention). */
export function createMediaServiceFromEnv(env: Record<string, string | undefined> = process.env): OpenMontageMediaService {
  return new OpenMontageMediaService(env);
}
