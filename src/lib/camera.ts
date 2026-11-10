/** Camera choice and error copy. No DOM, so it can be tested without a device. */

export interface CamInfo { deviceId: string; label: string }

export function isAppleTouchDevice(ua: string, platform: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  // iPadOS 13+ reports a desktop Macintosh UA, with touch.
  return platform === 'MacIntel' && maxTouchPoints > 1;
}

/** Higher is a better default for barcode scanning. Empty labels score 0 so we don't guess. */
export function cameraScore(label: string): number {
  const l = label.toLowerCase();
  if (!l) return 0;
  let score = 0;
  if (/back|rear|environment/.test(l)) score += 50;
  if (/front|user|facetime|face/.test(l)) score -= 40;
  if (/ultra|telephoto|\btele\b|depth|macro/.test(l)) score -= 25;
  if (/\bwide\b/.test(l)) score -= 10;
  return score;
}

export function rankCameras(devices: CamInfo[]): CamInfo[] {
  return [...devices].sort((a, b) => cameraScore(b.label) - cameraScore(a.label));
}

/**
 * Device to switch to after the first getUserMedia, or undefined to keep the current track.
 * A higher score has to win by a clear margin so an unlabeled webcam is left alone.
 */
export function preferredRearId(devices: CamInfo[], currentId: string | undefined): string | undefined {
  const ranked = rankCameras(devices.filter((d) => d.deviceId));
  const best = ranked[0];
  if (!best?.label || best.deviceId === currentId) return undefined;
  const current = devices.find((d) => d.deviceId === currentId);
  if (cameraScore(best.label) > cameraScore(current?.label || '') + 15) return best.deviceId;
  return undefined;
}

export function cameraProblemMessage(name: string, apple: boolean): string {
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return apple
        ? 'Camera permission was denied. On iPhone, allow the camera for Safari and, separately, for the Home Screen app. Or type the barcode below.'
        : 'Camera permission was denied. Allow the camera in the browser’s site settings, or type the barcode below.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No camera was found on this device. Type the barcode below.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The camera is busy or could not start. Close other apps using it and try again, or type the barcode below.';
    case 'SecurityError':
      return 'The camera only works on a secure (https) page. Type the barcode below.';
    default:
      return name
        ? `The camera could not be started (${name}). Type the barcode below.`
        : 'The camera could not be started. Type the barcode below.';
  }
}

/** True when a grabbed frame is essentially black (the iPhone standalone-PWA blank preview). */
export function frameLooksBlank(data: Uint8ClampedArray): boolean {
  if (data.length < 16) return true;
  let sum = 0;
  let n = 0;
  const step = Math.max(16, (Math.floor(data.length / 400) >> 2) << 2);
  for (let i = 0; i + 2 < data.length; i += step) {
    sum += data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
    n++;
  }
  return n > 0 && sum / n < 8;
}

export function canUseTorch(caps: { torch?: boolean }): boolean {
  return caps.torch === true;
}

export function canContinuousFocus(caps: { focusMode?: string[] }): boolean {
  return !!caps.focusMode?.includes('continuous');
}
