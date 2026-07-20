/**
 * Meta WhatsApp Embedded Signup helpers.
 *
 * Loads the Facebook JS SDK and drives the Embedded Signup flow so a business
 * can connect its own WhatsApp Business Account (WABA) in a popup. Meta returns
 * an auth `code` via the FB.login callback and, in parallel, delivers the
 * newly-provisioned `phone_number_id` + `waba_id` through a window postMessage.
 */

interface FbLoginAuthResponse {
  code?: string;
  accessToken?: string;
}

interface FbLoginResponse {
  authResponse?: FbLoginAuthResponse | null;
  status?: string;
}

interface FbLoginOptions {
  config_id: string;
  response_type: string;
  override_default_response_type: boolean;
  extras: {
    setup: Record<string, unknown>;
    featureType: string;
    sessionInfoVersion: string;
  };
}

interface FbInitParams {
  appId: string;
  autoLogAppEvents: boolean;
  xfbml: boolean;
  version: string;
}

interface FacebookSdk {
  init(params: FbInitParams): void;
  login(callback: (response: FbLoginResponse) => void, options: FbLoginOptions): void;
}

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

const SDK_SRC = 'https://connect.facebook.net/en_US/sdk.js';
const SDK_SCRIPT_ID = 'facebook-jssdk';

let sdkPromise: Promise<void> | null = null;
let messageListenerAttached = false;

/** Captured from Meta's WA_EMBEDDED_SIGNUP postMessage during the flow. */
interface LastSignupInfo {
  phoneNumberId?: string;
  wabaId?: string;
}
let lastSignupInfo: LastSignupInfo = {};

function attachMessageListener(): void {
  if (messageListenerAttached) return;
  messageListenerAttached = true;

  window.addEventListener('message', (event: MessageEvent) => {
    if (typeof event.origin !== 'string' || !event.origin.includes('facebook.com')) return;
    if (typeof event.data !== 'string') return;
    try {
      const parsed = JSON.parse(event.data) as {
        type?: string;
        data?: { phone_number_id?: string; waba_id?: string };
      };
      if (parsed?.type === 'WA_EMBEDDED_SIGNUP' && parsed.data) {
        lastSignupInfo = {
          phoneNumberId: parsed.data.phone_number_id,
          wabaId: parsed.data.waba_id,
        };
      }
    } catch {
      /* Not JSON we care about — ignore. */
    }
  });
}

/** Info Meta delivered via postMessage alongside the FB.login code. */
export function getLastSignupInfo(): LastSignupInfo {
  return lastSignupInfo;
}

/**
 * Idempotently inject the Facebook JS SDK and initialize it. Resolves once
 * `window.FB` is ready to use.
 */
export function loadFacebookSdk(appId: string): Promise<void> {
  attachMessageListener();

  if (window.FB) {
    return Promise.resolve();
  }
  if (sdkPromise) {
    return sdkPromise;
  }

  sdkPromise = new Promise<void>((resolve, reject) => {
    window.fbAsyncInit = () => {
      if (!window.FB) {
        reject(new Error('Facebook SDK loaded but window.FB is unavailable'));
        return;
      }
      window.FB.init({
        appId,
        autoLogAppEvents: true,
        xfbml: false,
        version: 'v21.0',
      });
      resolve();
    };

    if (document.getElementById(SDK_SCRIPT_ID)) {
      // Script tag already present; fbAsyncInit will fire (or already did).
      if (window.FB) resolve();
      return;
    }

    const script = document.createElement('script');
    script.id = SDK_SCRIPT_ID;
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.src = SDK_SRC;
    script.onerror = () => {
      sdkPromise = null;
      reject(new Error('Failed to load the Facebook SDK'));
    };
    document.body.appendChild(script);
  });

  return sdkPromise;
}

/**
 * Launch Meta's WhatsApp Embedded Signup popup. Resolves with the OAuth
 * exchange `code` on success; rejects if the user cancels or the flow fails.
 */
export function launchWhatsAppSignup(configId: string): Promise<{ code: string }> {
  return new Promise((resolve, reject) => {
    if (!window.FB) {
      reject(new Error('Facebook SDK is not initialized. Call loadFacebookSdk first.'));
      return;
    }

    // Reset any stale info from a prior attempt.
    lastSignupInfo = {};

    window.FB.login(
      (response: FbLoginResponse) => {
        const code = response?.authResponse?.code;
        if (code) {
          resolve({ code });
        } else {
          reject(new Error('WhatsApp signup was cancelled or failed'));
        }
      },
      {
        config_id: configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: '',
          sessionInfoVersion: '3',
        },
      }
    );
  });
}
