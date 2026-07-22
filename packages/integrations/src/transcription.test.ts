import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  TranscriptionService,
  createTranscriptionServiceFromEnv
} from './transcription';

function geminiTextResponse(text: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text }] } }]
    })
  };
}

describe('TranscriptionService.transcribe', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns { skipped: true } and does not call fetch when no API key is set', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const service = new TranscriptionService({});
    const result = await service.transcribe({ audioBase64: 'AAAA' });

    expect(result.ok).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.error).toMatch(/GROQ_API_KEY|GOOGLE_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses Groq Whisper (multipart) as the primary transcriber', async () => {
    const fetchMock = vi.fn(async () => new Response('  hello I need help  ', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const service = new TranscriptionService({ groqApiKey: 'gsk_test' });
    const result = await service.transcribe({ audioBase64: 'AAAA', mimeType: 'audio/ogg; codecs=opus' });

    expect(result).toEqual({ ok: true, text: 'hello I need help' });
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(call[0])).toContain('api.groq.com/openai/v1/audio/transcriptions');
    expect(call[1].body).toBeInstanceOf(FormData);
    expect(call[1].headers).toMatchObject({ Authorization: 'Bearer gsk_test' });
  });

  it('falls back to Gemini when Groq fails', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      if (String(url).includes('groq.com')) return new Response('rate limited', { status: 429 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'from gemini' }] } }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const service = new TranscriptionService({ groqApiKey: 'gsk_test', apiKey: 'gemini_test' });
    const result = await service.transcribe({ audioBase64: 'AAAA' });

    expect(result).toEqual({ ok: true, text: 'from gemini' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('POSTs to Gemini with inline_data (clean audio/ogg mime) and returns the transcript', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        geminiTextResponse('hello I need help with my order')
      );
    vi.stubGlobal('fetch', fetchMock);

    const service = new TranscriptionService({ apiKey: 'gkey' });
    const result = await service.transcribe({
      audioBase64: 'AUDIOBASE64',
      mimeType: 'audio/ogg; codecs=opus'
    });

    expect(result).toEqual({ ok: true, text: 'hello I need help with my order' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=gkey'
    );
    expect(init.method).toBe('POST');

    const body = JSON.parse(init.body as string);
    const parts = body.contents[0].parts;
    expect(parts[0].text).toContain('Transcribe this audio');
    expect(parts[1].inline_data).toEqual({
      mime_type: 'audio/ogg',
      data: 'AUDIOBASE64'
    });
    expect(body.generationConfig.temperature).toBe(0);
  });

  it('defaults the mime type to audio/ogg when none is provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(geminiTextResponse('hi'));
    vi.stubGlobal('fetch', fetchMock);

    const service = new TranscriptionService({ apiKey: 'gkey' });
    await service.transcribe({ audioBase64: 'x' });

    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string
    );
    expect(body.contents[0].parts[1].inline_data.mime_type).toBe('audio/ogg');
  });

  it('strips wrapping quotes from the transcript', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(geminiTextResponse('"hello there"'));
    vi.stubGlobal('fetch', fetchMock);

    const service = new TranscriptionService({ apiKey: 'gkey' });
    const result = await service.transcribe({ audioBase64: 'x' });
    expect(result.text).toBe('hello there');
  });

  it('returns { ok: false, error } on a non-2xx response and does not throw', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limited'
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new TranscriptionService({ apiKey: 'gkey' });
    const result = await service.transcribe({ audioBase64: 'x' });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('rate limited');
    expect(result.skipped).toBeUndefined();
  });
});

describe('createTranscriptionServiceFromEnv', () => {
  it('reads GOOGLE_API_KEY, falling back to GEMINI_API_KEY', () => {
    expect(createTranscriptionServiceFromEnv({}).isConfigured).toBe(false);
    expect(
      createTranscriptionServiceFromEnv({ GOOGLE_API_KEY: 'a' }).isConfigured
    ).toBe(true);
    expect(
      createTranscriptionServiceFromEnv({ GEMINI_API_KEY: 'b' }).isConfigured
    ).toBe(true);
  });
});
