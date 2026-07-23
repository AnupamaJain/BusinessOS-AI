/**
 * Text-to-speech synthesis via Google Cloud Text-to-Speech.
 *
 * Pure `fetch` — no SDK dependency. Given a string of text, asks Cloud TTS to
 * render it to speech and returns the audio as base64. Outputs OGG/Opus so
 * WhatsApp can send the result as a voice note with no transcoding. Degrades
 * gracefully when no API key is present: {@link TtsService.synthesize} returns
 * a "skipped" result, never throws.
 */

export interface TtsServiceConfig {
  /** Google Cloud Text-to-Speech API key. */
  apiKey?: string;
  /** BCP-47 language code, e.g. `en-IN`. Defaults to `en-IN`. */
  languageCode?: string;
  /** Optional specific voice name; when unset the API picks a voice. */
  voiceName?: string;
}

export interface SynthesizeParams {
  text: string;
  languageCode?: string;
  voiceName?: string;
}

export interface SynthesizeResult {
  ok: boolean;
  audioBase64?: string;
  mimeType?: string;
  skipped?: boolean;
  error?: string;
}

const DEFAULT_LANGUAGE_CODE = 'en-IN';
const TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';
/** Cloud TTS hard limit is 5000 chars; stay comfortably under it. */
const MAX_TEXT_LENGTH = 4800;

interface TtsResponse {
  audioContent?: string;
}

export class TtsService {
  private readonly apiKey?: string;
  private readonly languageCode: string;
  private readonly voiceName?: string;

  constructor(config: TtsServiceConfig = {}) {
    this.apiKey = config.apiKey;
    this.languageCode = config.languageCode ?? DEFAULT_LANGUAGE_CODE;
    this.voiceName = config.voiceName;
  }

  /** True when an API key is present and synthesis can actually run. */
  get isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async synthesize(params: SynthesizeParams): Promise<SynthesizeResult> {
    if (!this.apiKey) {
      return {
        ok: false,
        skipped: true,
        error: 'GOOGLE_CLOUD_TTS_API_KEY not configured'
      };
    }

    const text = (params.text ?? '').trim();
    if (!text) {
      return { ok: false, error: 'No text to synthesize' };
    }

    const languageCode = params.languageCode ?? this.languageCode;
    const voiceName = params.voiceName ?? this.voiceName;

    const voice: { languageCode: string; name?: string } = { languageCode };
    if (voiceName) voice.name = voiceName;

    const body = {
      input: { text: text.slice(0, MAX_TEXT_LENGTH) },
      voice,
      audioConfig: { audioEncoding: 'OGG_OPUS' }
    };

    const url = `${TTS_URL}?key=${this.apiKey}`;

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
      let error = `Cloud TTS responded with status ${response.status}`;
      try {
        const errText = await response.text();
        if (errText) error = errText.slice(0, 500);
      } catch {
        // keep status-based message
      }
      return { ok: false, error };
    }

    let payload: TtsResponse;
    try {
      payload = (await response.json()) as TtsResponse;
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }

    const audioContent = payload.audioContent;
    if (!audioContent) {
      return { ok: false, error: 'Cloud TTS response missing audioContent' };
    }

    return { ok: true, audioBase64: audioContent, mimeType: 'audio/ogg' };
  }
}

/**
 * Create a {@link TtsService} from environment variables.
 * Reads GOOGLE_CLOUD_TTS_API_KEY, and optional TTS_LANGUAGE_CODE / TTS_VOICE_NAME.
 */
export function createTtsServiceFromEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): TtsService {
  return new TtsService({
    apiKey: env.GOOGLE_CLOUD_TTS_API_KEY,
    languageCode: env.TTS_LANGUAGE_CODE,
    voiceName: env.TTS_VOICE_NAME
  });
}
