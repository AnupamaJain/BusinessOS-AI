import jsQR from 'jsqr';

/* Decode a UPI QR image client-side (no upload). Given an image File, draw it
 * to an offscreen canvas, run jsQR, and — if the payload is a UPI intent URI —
 * pull out the payee VPA (`pa`) and payee name (`pn`). Never throws: any
 * failure (non-image, unreadable, no QR, no `pa=`) resolves to null so the
 * caller can fall back to manual entry. */

export interface UpiQrResult {
  vpa: string;
  payee?: string;
}

function readFileAsDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    } catch {
      resolve(null);
    }
  });
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/* Extract the VPA/payee from a decoded QR string. Accepts `upi://pay?pa=…&pn=…`
 * (and tolerates any string that carries a `pa=` query param). Returns null when
 * there is no usable `pa`. */
export function parseUpiPayload(text: string): UpiQrResult | null {
  const raw = (text ?? '').trim();
  if (!raw) return null;
  const qIndex = raw.indexOf('?');
  const query = qIndex >= 0 ? raw.slice(qIndex + 1) : raw;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(query);
  } catch {
    return null;
  }
  const pa = params.get('pa');
  if (!pa || !pa.trim()) return null;
  const pn = params.get('pn');
  return { vpa: pa.trim(), payee: pn && pn.trim() ? pn.trim() : undefined };
}

export async function decodeUpiQrFromFile(file: File): Promise<UpiQrResult | null> {
  try {
    if (!file) return null;
    const dataUrl = await readFileAsDataUrl(file);
    if (!dataUrl) return null;

    const img = await loadImage(dataUrl);
    if (!img) return null;

    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (!width || !height) return null;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, width, height);

    const imageData = ctx.getImageData(0, 0, width, height);
    const code = jsQR(imageData.data, imageData.width, imageData.height);
    if (!code || !code.data) return null;

    return parseUpiPayload(code.data);
  } catch {
    return null;
  }
}
