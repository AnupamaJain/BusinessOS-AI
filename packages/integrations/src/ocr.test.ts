import { describe, it, expect, vi, afterEach } from 'vitest';
import { OcrService, createOcrServiceFromEnv } from './ocr';

function geminiTextResponse(text: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text }] } }]
    })
  };
}

describe('OcrService.extract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns { skipped: true } and does not call fetch when no API key is set', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const service = new OcrService({});
    const result = await service.extract({
      imageBase64: 'AAAA',
      fields: ['full_name']
    });

    expect(result).toEqual({
      ok: false,
      skipped: true,
      error: 'GOOGLE_API_KEY not configured'
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs to Gemini with inline_data and parses the returned JSON', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        geminiTextResponse(
          JSON.stringify({ full_name: 'Ravi Kumar', id_number: null })
        )
      );
    vi.stubGlobal('fetch', fetchMock);

    const service = new OcrService({ apiKey: 'gkey' });
    const result = await service.extract({
      imageBase64: 'BASE64DATA',
      mimeType: 'image/png',
      fields: ['full_name', 'id_number'],
      documentHint: 'PAN card'
    });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ full_name: 'Ravi Kumar', id_number: null });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=gkey'
    );
    expect(init.method).toBe('POST');

    const body = JSON.parse(init.body as string);
    const parts = body.contents[0].parts;
    expect(parts[0].text).toContain('PAN card');
    expect(parts[0].text).toContain('"full_name"');
    expect(parts[1].inline_data).toEqual({
      mime_type: 'image/png',
      data: 'BASE64DATA'
    });
    expect(body.generationConfig).toEqual({
      temperature: 0,
      response_mime_type: 'application/json'
    });
  });

  it('tolerates JSON wrapped in markdown fences', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        geminiTextResponse('```json\n{"full_name":"Asha"}\n```')
      );
    vi.stubGlobal('fetch', fetchMock);

    const service = new OcrService({ apiKey: 'gkey' });
    const result = await service.extract({ imageBase64: 'x', fields: ['full_name'] });
    expect(result.data).toEqual({ full_name: 'Asha' });
  });

  it('returns raw text when the model output is not valid JSON', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(geminiTextResponse('I could not read the document.'));
    vi.stubGlobal('fetch', fetchMock);

    const service = new OcrService({ apiKey: 'gkey' });
    const result = await service.extract({ imageBase64: 'x', fields: ['full_name'] });
    expect(result.ok).toBe(true);
    expect(result.data).toBeUndefined();
    expect(result.raw).toBe('I could not read the document.');
  });

  it('imageUrl path fetches the image first, then POSTs to Gemini', async () => {
    const fetchMock = vi
      .fn()
      // first call: fetch the image
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: (h: string) => (h === 'content-type' ? 'image/jpeg' : null) },
        arrayBuffer: async () => new TextEncoder().encode('rawbytes').buffer
      })
      // second call: Gemini
      .mockResolvedValueOnce(
        geminiTextResponse(JSON.stringify({ full_name: 'Neha' }))
      );
    vi.stubGlobal('fetch', fetchMock);

    const service = new OcrService({ apiKey: 'gkey' });
    const result = await service.extract({
      imageUrl: 'https://cdn.example.com/doc.jpg',
      fields: ['full_name']
    });

    expect(result.data).toEqual({ full_name: 'Neha' });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [imgUrl] = fetchMock.mock.calls[0] as [string];
    expect(imgUrl).toBe('https://cdn.example.com/doc.jpg');

    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    const inline = body.contents[0].parts[1].inline_data;
    expect(inline.mime_type).toBe('image/jpeg');
    expect(Buffer.from(inline.data, 'base64').toString()).toBe('rawbytes');
  });

  it('extractPassport requests the passport fields', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(geminiTextResponse(JSON.stringify({ full_name: 'X' })));
    vi.stubGlobal('fetch', fetchMock);

    const service = new OcrService({ apiKey: 'gkey' });
    await service.extractPassport({ imageBase64: 'x' });

    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string
    );
    const prompt = body.contents[0].parts[0].text as string;
    expect(prompt).toContain('passport');
    expect(prompt).toContain('"passport_number"');
    expect(prompt).toContain('"expiry_date"');
  });

  it('extractPaymentReceipt returns the skipped result and does not call fetch with no API key', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const service = new OcrService({});
    const result = await service.extractPaymentReceipt({ imageBase64: 'AAAA' });

    expect(result).toEqual({
      ok: false,
      skipped: true,
      error: 'GOOGLE_API_KEY not configured'
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('extractPaymentReceipt requests the payment fields and maps amount/reference', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      geminiTextResponse(
        JSON.stringify({
          amount: '₹1,250',
          reference: '123456789012',
          date: '19 Jul 2026, 4:32 PM',
          upi_id: 'merchant@okhdfcbank',
          status: 'Success',
          payer_name: 'Ravi Kumar'
        })
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const service = new OcrService({ apiKey: 'gkey' });
    const result = await service.extractPaymentReceipt({ imageBase64: 'x' });

    expect(result.ok).toBe(true);
    expect(result.data?.amount).toBe('₹1,250');
    expect(result.data?.reference).toBe('123456789012');

    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string
    );
    const prompt = body.contents[0].parts[0].text as string;
    expect(prompt).toContain('UPI');
    expect(prompt).toContain('"amount"');
    expect(prompt).toContain('"reference"');
    expect(prompt).toContain('"upi_id"');
  });
});

describe('createOcrServiceFromEnv', () => {
  it('reads GOOGLE_API_KEY, falling back to GEMINI_API_KEY', () => {
    expect(createOcrServiceFromEnv({}).isConfigured).toBe(false);
    expect(createOcrServiceFromEnv({ GOOGLE_API_KEY: 'a' }).isConfigured).toBe(true);
    expect(createOcrServiceFromEnv({ GEMINI_API_KEY: 'b' }).isConfigured).toBe(true);
  });
});
