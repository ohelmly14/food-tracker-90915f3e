import { describe, expect, it } from 'vitest';
import {
  AIM_GUIDE, barcodeVariants, compressUpcA, expandUpcE, gtinCheckDigit,
  guideSourceRect, lookupNotice, normalizeBarcode, pushRead, selectNativeFormats, validGtin,
} from './barcode';
import { cameraProblemMessage, cameraScore, frameLooksBlank, preferredRearId, rankCameras } from './camera';
import { decodeLuminance } from './decode';

const L: Record<string, string> = {
  0: '0001101', 1: '0011001', 2: '0010011', 3: '0111101', 4: '0100011',
  5: '0110001', 6: '0101111', 7: '0111011', 8: '0110111', 9: '0001011',
};
const G: Record<string, string> = {
  0: '0100111', 1: '0110011', 2: '0011011', 3: '0100001', 4: '0011101',
  5: '0111001', 6: '0000101', 7: '0010001', 8: '0001001', 9: '0010111',
};
const R: Record<string, string> = Object.fromEntries(Object.entries(L).map(([d, bits]) => [d, [...bits].map((b) => (b === '0' ? '1' : '0')).join('')]));
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** Draw an EAN-13 so the ZXing reader used by the camera loop can be checked without a camera. */
function ean13Luminance(code: string, module = 3, quiet = 18, height = 70): { data: Uint8ClampedArray; width: number; height: number } {
  const parity = PARITY[Number(code[0])];
  let bits = '101';
  for (let i = 0; i < 6; i++) bits += (parity[i] === 'L' ? L : G)[code[i + 1]];
  bits += '01010';
  for (let i = 0; i < 6; i++) bits += R[code[i + 7]];
  bits += '101';
  const width = (bits.length + quiet * 2) * module;
  const data = new Uint8ClampedArray(width * height).fill(255);
  for (let y = 8; y < height - 8; y++) {
    for (let i = 0; i < bits.length; i++) {
      if (bits[i] !== '1') continue;
      for (let x = 0; x < module; x++) data[y * width + (quiet * module + i * module + x)] = 0;
    }
  }
  return { data, width, height };
}

describe('barcode numbers', () => {
  it('checks known retail codes and rejects a bad check digit', () => {
    expect(validGtin('4006381333931')).toBe(true);
    expect(validGtin('3017624010701')).toBe(true);
    expect(validGtin('036000291452')).toBe(true);
    expect(gtinCheckDigit('400638133393')).toBe(1);
    expect(validGtin('4006381333932')).toBe(false);
    expect(normalizeBarcode(' 4006381333931 ')).toBe('4006381333931');
    expect(normalizeBarcode('4006381333932')).toBeNull();
    expect(normalizeBarcode('https://example.test')).toBeNull();
  });

  it('treats UPC-A and EAN-13 as the same product, and expands UPC-E', () => {
    expect(barcodeVariants('036000291452')).toEqual(expect.arrayContaining(['036000291452', '0036000291452']));
    expect(barcodeVariants('0036000291452')).toEqual(expect.arrayContaining(['0036000291452', '036000291452']));
    const upca = '0' + '12345' + '00006' + String(gtinCheckDigit('01234500006'));
    expect(validGtin(upca)).toBe(true);
    const upce = compressUpcA(upca);
    expect(upce).toBeTruthy();
    expect(expandUpcE(upce!)).toBe(upca);
    expect(barcodeVariants(upce!)).toEqual(expect.arrayContaining([upca, upce!]));
  });

  it('confirms a code on the second identical read and ignores empty frames', () => {
    let state = { code: null as string | null, hits: 0 };
    ({ state } = pushRead(state, null));
    expect(state.hits).toBe(0);
    let confirmed: string | null;
    ({ state, confirmed } = pushRead(state, '4006381333931'));
    expect(confirmed).toBeNull();
    ({ state } = pushRead(state, null));
    ({ state, confirmed } = pushRead(state, '4006381333931'));
    expect(confirmed).toBe('4006381333931');
  });

  it('maps the aiming box onto the visible part of a wide camera frame', () => {
    expect(AIM_GUIDE).toEqual({ x: 0.08, y: 0.36, w: 0.84, h: 0.28 });
    const rect = guideSourceRect(1920, 1080, 390, 520);
    expect(rect).toEqual({ x: 620, y: 389, w: 680, h: 302 });
  });

  it('does not use BarcodeDetector on iPhone, or where UPC/EAN is unsupported', () => {
    const all = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code'];
    expect(selectNativeFormats(all, true)).toBeNull();
    expect(selectNativeFormats([], false)).toBeNull();
    expect(selectNativeFormats(['qr_code'], false)).toBeNull();
    expect(selectNativeFormats(all, false)).toEqual(['ean_13', 'ean_8', 'upc_a', 'upc_e']);
  });

  it('explains a miss and a denied camera', () => {
    expect(lookupNotice('missing', '3017624010701')).toContain('3017624010701');
    expect(lookupNotice('missing', '3017624010701')).toContain('saved on this device');
    expect(lookupNotice('offline', '123')).toContain('offline');
    expect(lookupNotice('incomplete', '123', 'Yogurt')).toContain('Yogurt');
    expect(cameraProblemMessage('NotAllowedError', true)).toContain('Home Screen');
    expect(cameraProblemMessage('NotAllowedError', false)).toContain('site settings');
    expect(cameraProblemMessage('NotFoundError', false)).toContain('No camera');
    expect(cameraProblemMessage('SecurityError', false)).toContain('https');
  });
});

describe('camera choice', () => {
  const front = { deviceId: 'front', label: 'Front Camera' };
  const back = { deviceId: 'back', label: 'Back Camera' };
  const ultra = { deviceId: 'ultra', label: 'Back Ultra Wide Camera' };
  it('prefers the main rear camera over the ultra-wide and the front', () => {
    expect(rankCameras([front, ultra, back]).map((d) => d.deviceId)).toEqual(['back', 'ultra', 'front']);
    expect(cameraScore('Back Camera')).toBeGreaterThan(cameraScore('Back Ultra Wide Camera'));
    expect(preferredRearId([front, ultra, back], 'front')).toBe('back');
    expect(preferredRearId([front, ultra, back], 'ultra')).toBe('back');
    expect(preferredRearId([front, ultra, back], 'back')).toBeUndefined();
    expect(preferredRearId([{ deviceId: 'only', label: '' }], 'only')).toBeUndefined();
  });
  it('treats a black frame as a blank preview', () => {
    expect(frameLooksBlank(new Uint8ClampedArray(64))).toBe(true);
    expect(frameLooksBlank(new Uint8ClampedArray(64).fill(255))).toBe(false);
  });
});

describe('zxing retail decode', () => {
  it('reads a drawn EAN-13', () => {
    const code = '4006381333931';
    const img = ean13Luminance(code);
    expect(decodeLuminance(img.data, img.width, img.height)).toBe(code);
  });
  it('reads a second code after the reader is reset', () => {
    const code = '3017624010701';
    const img = ean13Luminance(code);
    expect(decodeLuminance(img.data, img.width, img.height)).toBe(code);
  });
});
