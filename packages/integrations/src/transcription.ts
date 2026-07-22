/**
 * Speech-to-text transcription via Google Gemini.
 *
 * Pure `fetch` — no SDK dependency. Given an audio clip (base64 + mime type),
 * asks Gemini to transcribe the spoken words to plain text. Built for WhatsApp
 * voice notes, which arrive as `audio/ogg; codecs=opus`. Degrades gracefully
 * when no API key is present: {@link TranscriptionService.transcribe} returns a
 * "skipped" result, never throws.
 */

export interface TranscriptionServiceConfig {
  /** Google Gemini key (fallback transcriber). */
  apiKey?: string;
  model?: string;
  /** Groq key — primary transcriber (Whisper, separate free audio quota). */
  groqApiKey?: string;
  groqModel?: string;
}

export interface TranscribeParams {
  audioBase64: string;
  mimeType?: string;
}

export interface TranscribeResult {
  ok: boolean;
  text?: string;
  skipped?: boolean;
  error?: string;
}

const DEFAULT_MODEL = 'gemini-2.0-flash';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const TRANSCRIBE_PROMPT =
  'Transcribe this audio to plain text. Return ONLY the spoken words, ' +
  'verbatim, with no commentary, labels, or quotes. If the audio is silent ' +
  'or unintelligible, return an empty string.';

interface GeminiPart {
  text?: string;
}
interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
}

/**
 * Normalise a media type to a bare mime (drop `; codecs=…` and other params).
 * WhatsApp voice notes report `audio/ogg; codecs=opus` — Gemini wants a clean
 * `audio/ogg`.
 */
function cleanMimeType(mimeType?: string): string {
  const bare = (mimeType ?? 'audio/ogg').split(';')[0]!.trim();
  return bare || 'audio/ogg';
}

/** Strip a single layer of wrapping quotes or backticks from a line of text. */
function stripWrappingQuotes(text: string): string {
  let out = text.trim();
  const pairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ['`', '`']
  ];
  // Handle ```-fenced blocks first.
  const fence = out.match(/^```(?:\w+)?\s*([\s\S]*?)\s*```$/);
  if (fence && fence[1] !== undefined) out = fence[1].trim();

  for (const [open, close] of pairs) {
    if (out.length >= 2 && out.startsWith(open) && out.endsWith(close)) {
      out = out.slice(open.length, out.length - close.length).trim();
      break;
    }
  }
  return out;
}

const GROQ_TRANSCRIBE_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const DEFAULT_GROQ_MODEL = 'whisper-large-v3-turbo';

function mimeToExt(mime: string): string {
  if (mime.includes('ogg') || mime.includes('opus')) return 'ogg';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('m4a') || mime.includes('mp4') || mime.includes('aac')) return 'm4a';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('flac')) return 'flac';
  return 'ogg';
}

export class TranscriptionService {
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly groqApiKey?: string;
  private readonly groqModel: string;

  constructor(config: TranscriptionServiceConfig = {}) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
    this.groqApiKey = config.groqApiKey;
    this.groqModel = config.groqModel ?? DEFAULT_GROQ_MODEL;
  }

  /** True when any transcription provider is configured. */
  get isConfigured(): boolean {
    return Boolean(this.groqApiKey || this.apiKey);
  }

  async transcribe(audio: TranscribeParams): Promise<TranscribeResult> {
    if (!this.groqApiKey && !this.apiKey) {
      return { ok: false, skipped: true, error: 'No transcription key configured (GROQ_API_KEY or GOOGLE_API_KEY)' };
    }
    if (!audio.audioBase64) {
      return { ok: false, error: 'No audio provided (audioBase64 required)' };
    }
    const mimeType = cleanMimeType(audio.mimeType);

    // 1) Groq Whisper — primary: purpose-built, accurate, and a SEPARATE free
    //    quota from Gemini (so voice notes don't compete with the LLM/embeddings).
    if (this.groqApiKey) {
      const g = await this.transcribeGroq(audio.audioBase64, mimeType);
      if (g.ok || !this.apiKey) return g; // only fall through to Gemini if Groq failed AND Gemini is available
    }
    // 2) Gemini fallback.
    return this.transcribeGemini(audio.audioBase64, mimeType);
  }

  private async transcribeGroq(audioBase64: string, mimeType: string): Promise<TranscribeResult> {
    try {
      const form = new FormData();
      form.append('file', new Blob([Buffer.from(audioBase64, 'base64')], { type: mimeType }), `audio.${mimeToExt(mimeType)}`);
      form.append('model', this.groqModel);
      form.append('response_format', 'text');
      const res = await fetch(GROQ_TRANSCRIBE_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.groqApiKey}` },
        body: form,
      });
      if (!res.ok) return { ok: false, error: `Groq responded ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}` };
      const text = stripWrappingQuotes(await res.text());
      return { ok: true, text };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  private async transcribeGemini(audioBase64: string, mimeType: string): Promise<TranscribeResult> {
    if (!this.apiKey) return { ok: false, error: 'Gemini key not configured' };
    const url = `${GEMINI_BASE}/${this.model}:generateContent?key=${this.apiKey}`;
    const audio = { audioBase64 };
    const body = {
      contents: [
        {
          parts: [
            { text: TRANSCRIBE_PROMPT },
            { inline_data: { mime_type: mimeType, data: audio.audioBase64 } }
          ]
        }
      ],
      generationConfig: {
        temperature: 0
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

    const raw =
      payload.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? '')
        .join('') ?? '';

    const text = stripWrappingQuotes(raw);
    return { ok: true, text };
  }
}

/**
 * Create a {@link TranscriptionService} from environment variables.
 * Reads GOOGLE_API_KEY (falling back to GEMINI_API_KEY) and optional
 * TRANSCRIPTION_MODEL.
 */
export function createTranscriptionServiceFromEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): TranscriptionService {
  return new TranscriptionService({
    groqApiKey: env.GROQ_API_KEY,               // primary — Whisper, separate free quota
    groqModel: env.GROQ_WHISPER_MODEL,
    apiKey: env.GOOGLE_API_KEY ?? env.GEMINI_API_KEY, // fallback — Gemini
    model: env.TRANSCRIPTION_MODEL,
  });
}
