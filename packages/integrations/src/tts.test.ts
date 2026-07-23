import { describe, it, expect, vi, afterEach } from 'vitest';
import { TtsService, createTtsServiceFromEnv } from './tts';

function ttsAudioResponse(audioContent: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ audioContent })
  };
}

describe('TtsService.synthesize', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns { skipped: true } and does not call fetch when no API key is set', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const service = new TtsService({});
    const result = await service.synthesize({ text: 'hi' });

    expect(result).toEqual({
      ok: false,
      skipped: true,
      error: 'GOOGLE_CLOUD_TTS_API_KEY not configured'
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs to Cloud TTS as OGG_OPUS and returns base64 audio', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ttsAudioResponse('BASE64AUDIO'));
    vi.stubGlobal('fetch', fetchMock);

    const service = new TtsService({ apiKey: 'ttskey' });
    const result = await service.synthesize({ text: 'hello world' });

    expect(result).toEqual({
      ok: true,
      audioBase64: 'BASE64AUDIO',
      mimeType: 'audio/ogg'
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('texttospeech.googleapis.com');
    expect(url).toContain('key=');
    expect(init.method).toBe('POST');

    const body = JSON.parse(init.body as string);
    expect(body.audioConfig.audioEncoding).toBe('OGG_OPUS');
    expect(body.input.text).toBe('hello world');
    expect(body.voice.languageCode).toBe('en-IN');
    expect(body.voice.name).toBeUndefined();
  });

  it('includes the voice name only when configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ttsAudioResponse('AAA'));
    vi.stubGlobal('fetch', fetchMock);

    const service = new TtsService({
      apiKey: 'ttskey',
      languageCode: 'hi-IN',
      voiceName: 'hi-IN-Wavenet-A'
    });
    await service.synthesize({ text: 'namaste' });

    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string
    );
    expect(body.voice.languageCode).toBe('hi-IN');
    expect(body.voice.name).toBe('hi-IN-Wavenet-A');
  });

  it('truncates text longer than 4800 chars', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ttsAudioResponse('AAA'));
    vi.stubGlobal('fetch', fetchMock);

    const service = new TtsService({ apiKey: 'ttskey' });
    await service.synthesize({ text: 'a'.repeat(6000) });

    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string
    );
    expect(body.input.text.length).toBe(4800);
  });

  it('returns { ok: false } for empty text without calling fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const service = new TtsService({ apiKey: 'ttskey' });
    const result = await service.synthesize({ text: '   ' });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('No text to synthesize');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns { ok: false, error } on a non-2xx response and does not throw', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'permission denied'
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new TtsService({ apiKey: 'ttskey' });
    const result = await service.synthesize({ text: 'hi' });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('permission denied');
    expect(result.skipped).toBeUndefined();
  });
});

describe('createTtsServiceFromEnv', () => {
  it('reads GOOGLE_CLOUD_TTS_API_KEY', () => {
    expect(createTtsServiceFromEnv({}).isConfigured).toBe(false);
    expect(
      createTtsServiceFromEnv({ GOOGLE_CLOUD_TTS_API_KEY: 'k' }).isConfigured
    ).toBe(true);
  });
});
