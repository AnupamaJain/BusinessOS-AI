/**
 * Document / OCR extraction via Google Gemini vision.
 *
 * Pure `fetch` — no SDK dependency. Given an image (base64 or URL) and a list
 * of field names, asks Gemini to return a flat JSON object mapping each field
 * to its extracted value (or null). Degrades gracefully when no API key is
 * present: {@link OcrService.extract} returns a "skipped" result, never throws.
 */

export interface OcrServiceConfig {
  apiKey?: string;
  model?: string;
}

export interface ExtractParams {
  imageBase64?: string;
  imageUrl?: string;
  mimeType?: string;
  fields: string[];
  documentHint?: string;
}

export interface ExtractResult {
  ok: boolean;
  data?: Record<string, string | null>;
  raw?: string;
  error?: string;
  skipped?: boolean;
}

const DEFAULT_MODEL = 'gemini-2.0-flash';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GeminiPart {
  text?: string;
}
interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
}

function buildPrompt(fields: string[], documentHint?: string): string {
  const docType = documentHint ? `a ${documentHint}` : 'the attached document';
  const fieldList = fields.map((f) => `"${f}"`).join(', ');
  return [
    `You are a precise document data extraction engine.`,
    `The attached image is ${docType}.`,
    `Extract EXACTLY these fields: ${fieldList}.`,
    `Return a single flat JSON object whose keys are exactly those field names.`,
    `Use the value found in the document as a string.`,
    `If a field is not present or not legible, set its value to null.`,
    `Do not add extra keys, commentary, or markdown fences — output only the JSON object.`
  ].join(' ');
}

/** Extract a bare JSON object from model text, tolerating ```json fences. */
function parseModelJson(text: string): Record<string, string | null> | null {
  const trimmed = text.trim();
  const candidates: string[] = [trimmed];

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) candidates.push(fence[1].trim());

  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    candidates.push(trimmed.slice(first, last + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, string | null>;
      }
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export class OcrService {
  private readonly apiKey?: string;
  private readonly model: string;

  constructor(config: OcrServiceConfig = {}) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
  }

  /** True when an API key is present and extraction can actually run. */
  get isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async extract(params: ExtractParams): Promise<ExtractResult> {
    if (!this.apiKey) {
      return {
        ok: false,
        skipped: true,
        error: 'GOOGLE_API_KEY not configured'
      };
    }

    // Resolve the image bytes to a base64 string + mime type.
    let base64 = params.imageBase64;
    let mimeType = params.mimeType ?? 'image/jpeg';

    if (params.imageUrl) {
      try {
        const imgRes = await fetch(params.imageUrl);
        if (!imgRes.ok) {
          return {
            ok: false,
            error: `Failed to fetch image (status ${imgRes.status})`
          };
        }
        const contentType = imgRes.headers.get('content-type');
        if (contentType) mimeType = contentType.split(';')[0]!.trim();
        const buffer = Buffer.from(await imgRes.arrayBuffer());
        base64 = buffer.toString('base64');
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    }

    if (!base64) {
      return { ok: false, error: 'No image provided (imageBase64 or imageUrl required)' };
    }

    const url = `${GEMINI_BASE}/${this.model}:generateContent?key=${this.apiKey}`;
    const body = {
      contents: [
        {
          parts: [
            { text: buildPrompt(params.fields, params.documentHint) },
            { inline_data: { mime_type: mimeType, data: base64 } }
          ]
        }
      ],
      generationConfig: {
        temperature: 0,
        response_mime_type: 'application/json'
      }
    };

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }

    if (!response.ok) {
      let error = `Gemini responded with status ${response.status}`;
      try {
        const text = await response.text();
        if (text) error = text;
      } catch {
        // keep status-based message
      }
      return { ok: false, error };
    }

    let payload: GeminiResponse;
    try {
      payload = (await response.json()) as GeminiResponse;
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }

    const text =
      payload.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? '')
        .join('') ?? '';

    const data = parseModelJson(text);
    if (data) {
      return { ok: true, data };
    }
    // Parse failed — hand back the raw text so callers can inspect it.
    return { ok: true, raw: text };
  }

  extractPassport(image: {
    imageBase64?: string;
    imageUrl?: string;
    mimeType?: string;
  }): Promise<ExtractResult> {
    return this.extract({
      ...image,
      documentHint: 'passport',
      fields: [
        'full_name',
        'passport_number',
        'nationality',
        'date_of_birth',
        'expiry_date'
      ]
    });
  }

  extractIdCard(image: {
    imageBase64?: string;
    imageUrl?: string;
    mimeType?: string;
  }): Promise<ExtractResult> {
    return this.extract({
      ...image,
      documentHint: 'ID card',
      fields: ['full_name', 'id_number', 'date_of_birth']
    });
  }
}

/**
 * Create an {@link OcrService} from environment variables.
 * Reads GOOGLE_API_KEY, falling back to GEMINI_API_KEY.
 */
export function createOcrServiceFromEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): OcrService {
  return new OcrService({
    apiKey: env.GOOGLE_API_KEY ?? env.GEMINI_API_KEY
  });
}
