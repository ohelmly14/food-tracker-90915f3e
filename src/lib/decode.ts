import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} from '@zxing/library';
import { normalizeScan, type RetailFormat } from './barcode';

/**
 * ZXing reader limited to retail barcodes, with TRY_HARDER.
 * One reader is reused across frames; reset() clears per-frame state and keeps the hints.
 */
let reader: MultiFormatReader | null = null;

function retailReader(): MultiFormatReader {
  if (reader) return reader;
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  reader = new MultiFormatReader();
  reader.setHints(hints);
  return reader;
}

export function zxingRetailFormat(format: BarcodeFormat): RetailFormat | null {
  switch (format) {
    case BarcodeFormat.EAN_13: return 'ean_13';
    case BarcodeFormat.EAN_8: return 'ean_8';
    case BarcodeFormat.UPC_A: return 'upc_a';
    case BarcodeFormat.UPC_E: return 'upc_e';
    default: return null;
  }
}

/** Decode a grayscale buffer (0 = black). Returns a normalized UPC/EAN, or null. */
export function decodeLuminance(luminance: Uint8ClampedArray, width: number, height: number): string | null {
  if (width < 20 || height < 8) return null;
  try {
    const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(luminance, width, height)));
    const result = retailReader().decodeWithState(bitmap);
    const format = zxingRetailFormat(result.getBarcodeFormat());
    if (!format) return null;
    return normalizeScan(result.getText(), format);
  } catch {
    return null;
  } finally {
    retailReader().reset();
  }
}

/** Decode RGBA pixels from a canvas frame. */
export function decodeRgba(rgba: Uint8ClampedArray, width: number, height: number): string | null {
  if (rgba.length < width * height * 4) return null;
  const lum = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) lum[i] = (rgba[p] * 0.3 + rgba[p + 1] * 0.59 + rgba[p + 2] * 0.11) | 0;
  return decodeLuminance(lum, width, height);
}
