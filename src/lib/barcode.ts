/** Retail barcode helpers. UPC-A is 12 digits; EAN-13 is the same code with a leading 0. */

export type RetailFormat = 'ean_13' | 'ean_8' | 'upc_a' | 'upc_e';

/** On-screen aiming box, as fractions of the visible camera picture. Match `.guide` in index.css. */
export const AIM_GUIDE = { x: 0.08, y: 0.36, w: 0.84, h: 0.28 };
/** Wider crop used on alternate frames so a barcode slightly outside the box still reads. */
export const WIDE_GUIDE = { x: 0.02, y: 0.22, w: 0.96, h: 0.56 };

export interface GuideRect { x: number; y: number; w: number; h: number }
export interface GuideFrac { x: number; y: number; w: number; h: number }

const RETAIL: RetailFormat[] = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

/**
 * BarcodeDetector formats worth using. Returns null when the API should not be used:
 * iPhone/iPad (the API is off by default, and detection does not work even with the
 * Shape Detection flag — WebKit bug 281848), or when UPC/EAN is not actually supported
 * (Chrome on Windows and Linux expose nothing useful).
 */
export function selectNativeFormats(supported: readonly string[], appleTouch: boolean): RetailFormat[] | null {
  if (appleTouch) return null;
  const formats = RETAIL.filter((f) => supported.includes(f));
  if (!formats.includes('ean_13') && !formats.includes('upc_a')) return null;
  return formats;
}

/** GS1 check digit. `body` is the code without the final digit. */
export function gtinCheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += Number(body[body.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10;
}

export function validGtin(code: string): boolean {
  if (!/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(code)) return false;
  return gtinCheckDigit(code.slice(0, -1)) === Number(code[code.length - 1]);
}

/**
 * Expand an 8-digit UPC-E (number system + 6 digits + check) to UPC-A.
 * Returns null when the number system or check digit doesn't match.
 */
export function expandUpcE(code: string): string | null {
  if (!/^\d{8}$/.test(code)) return null;
  const ns = code[0];
  if (ns !== '0' && ns !== '1') return null;
  const d = code.slice(1, 7);
  const last = d[5];
  let body: string;
  if (last === '0' || last === '1' || last === '2') body = ns + d[0] + d[1] + last + '0000' + d[2] + d[3] + d[4];
  else if (last === '3') body = ns + d.slice(0, 3) + '00000' + d[3] + d[4];
  else if (last === '4') body = ns + d.slice(0, 4) + '00000' + d[4];
  else body = ns + d.slice(0, 5) + '0000' + last;
  if (body.length !== 11 || String(gtinCheckDigit(body)) !== code[7]) return null;
  return body + code[7];
}

/** Inverse of expandUpcE, for matching a stored 8-digit code after a 12-digit read. */
export function compressUpcA(upca: string): string | null {
  if (!/^\d{12}$/.test(upca) || !validGtin(upca)) return null;
  const ns = upca[0];
  if (ns !== '0' && ns !== '1') return null;
  const m = upca.slice(1, 6);
  const p = upca.slice(6, 11);
  const check = upca[11];
  let data: string | null = null;
  if ((m[2] === '0' || m[2] === '1' || m[2] === '2') && m.endsWith('00') && p.startsWith('00')) data = m[0] + m[1] + p.slice(2) + m[2];
  else if (m.endsWith('00') && p.startsWith('000') && m[2] >= '3') data = m.slice(0, 3) + p.slice(3) + '3';
  else if (m.endsWith('0') && !m.endsWith('00') && p.startsWith('0000')) data = m.slice(0, 4) + p[4] + '4';
  else if (!m.endsWith('0') && p.startsWith('0000') && p[4] >= '5') data = m + p[4];
  if (!data || data.length !== 6) return null;
  return ns + data + check;
}

export function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, '');
}

/** Accept a decoder result only when it is a real UPC/EAN. UPC-E is returned as UPC-A. */
export function normalizeScan(raw: string, format?: RetailFormat | null): string | null {
  const digits = digitsOnly(raw);
  if (format === 'upc_e') return expandUpcE(digits.length === 8 ? digits : '');
  if (format === 'ean_8' || format === 'upc_a' || format === 'ean_13') return validGtin(digits) ? digits : null;
  if (validGtin(digits)) return digits;
  if (digits.length === 8) return expandUpcE(digits);
  if (digits.length > 14) {
    for (const len of [13, 12, 8]) {
      for (let i = 0; i + len <= digits.length; i++) {
        const slice = digits.slice(i, i + len);
        if (validGtin(slice)) return slice;
      }
    }
  }
  return null;
}

/** Manual entry and camera reads both go through this. Invalid check digits return null. */
export function normalizeBarcode(raw: string): string | null {
  return normalizeScan(raw, null);
}

/** Codes to try against the local database and Open Food Facts. */
export function barcodeVariants(code: string): string[] {
  const digits = digitsOnly(code);
  if (!digits) return [];
  const canonical = normalizeBarcode(digits) ?? digits;
  const out: string[] = [];
  const add = (s: string) => { if (s && !out.includes(s)) out.push(s); };
  add(canonical);
  if (/^\d{12}$/.test(canonical)) add('0' + canonical);
  if (/^\d{13}$/.test(canonical) && canonical.startsWith('0')) add(canonical.slice(1));
  if (/^\d{8}$/.test(canonical)) {
    const expanded = expandUpcE(canonical);
    if (expanded) add(expanded);
  }
  const upca = canonical.length === 12 ? canonical : canonical.length === 13 && canonical.startsWith('0') ? canonical.slice(1) : '';
  if (upca) {
    const compressed = compressUpcA(upca);
    if (compressed) add(compressed);
    if (upca.length === 12) add('0' + upca);
  }
  return out;
}

export interface ReadState { code: string | null; hits: number }

/** Confirm a value only after the same code is read twice, so a single bad frame is ignored. */
export function pushRead(state: ReadState, code: string | null): { state: ReadState; confirmed: string | null } {
  if (!code) return { state, confirmed: null };
  if (state.code === code) {
    const hits = state.hits + 1;
    return { state: { code, hits }, confirmed: hits >= 2 ? code : null };
  }
  return { state: { code, hits: 1 }, confirmed: null };
}

/**
 * Source rectangle for the aiming box.
 * `object-fit: cover` crops the camera frame, so the box is mapped onto the visible part, not the raw frame.
 * When the element hasn't been laid out yet, the center of the full frame is used.
 */
export function guideSourceRect(videoWidth: number, videoHeight: number, elementWidth: number, elementHeight: number, guide: GuideFrac = AIM_GUIDE): GuideRect | null {
  if (videoWidth < 2 || videoHeight < 2) return null;
  const ew = elementWidth >= 2 ? elementWidth : videoWidth;
  const eh = elementHeight >= 2 ? elementHeight : videoHeight;
  const videoAspect = videoWidth / videoHeight;
  const elemAspect = ew / eh;
  let sx = 0, sy = 0, sw = videoWidth, sh = videoHeight;
  if (videoAspect > elemAspect) { sw = videoHeight * elemAspect; sx = (videoWidth - sw) / 2; }
  else if (videoAspect < elemAspect) { sh = videoWidth / elemAspect; sy = (videoHeight - sh) / 2; }
  const x = Math.max(0, Math.round(sx + sw * guide.x));
  const y = Math.max(0, Math.round(sy + sh * guide.y));
  const w = Math.min(videoWidth - x, Math.round(sw * guide.w));
  const h = Math.min(videoHeight - y, Math.round(sh * guide.h));
  if (w < 2 || h < 2) return null;
  return { x, y, w, h };
}

export type LookupKind = 'missing' | 'offline' | 'unreachable' | 'incomplete';

export function lookupNotice(kind: LookupKind, code: string, name?: string): string {
  if (kind === 'offline') return `You're offline, so barcode ${code} could not be looked up. Enter the food below. It stays on this device.`;
  if (kind === 'unreachable') return `Couldn't reach Open Food Facts for barcode ${code}. You can still enter it below. It stays on this device.`;
  if (kind === 'incomplete') {
    const who = name ? `“${name}”` : 'this product';
    return `Open Food Facts has ${who} for barcode ${code}, but no usable nutrition. Add the numbers from the package. It stays on this device.`;
  }
  return `No product found for barcode ${code}. Enter the name and nutrition from the package. It will be saved on this device for next time.`;
}
