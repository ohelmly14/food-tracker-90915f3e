import { AIM_GUIDE, WIDE_GUIDE, guideSourceRect, normalizeScan, pushRead, selectNativeFormats, type GuideFrac, type ReadState, type RetailFormat } from './barcode';
import { cameraProblemMessage, canContinuousFocus, canUseTorch, frameLooksBlank, isAppleTouchDevice, preferredRearId, type CamInfo } from './camera';

export interface ScanController {
  stop(): void;
  setTorch(on: boolean): Promise<boolean>;
  switchCamera(): Promise<void>;
}

export interface ScanHooks {
  onScanning(): void;
  onHit(code: string): void;
  onError(message: string): void;
  /** Camera is open but the preview is black. Scanning continues. */
  onBlank(blank: boolean): void;
  onCapabilities(caps: { torch: boolean; cameras: number }): void;
}

interface NativeDetector {
  detect(source: CanvasImageSource): Promise<{ rawValue?: string; format?: string }[]>;
}

interface DetectorCtor {
  new (opts: { formats: string[] }): NativeDetector;
  getSupportedFormats?: () => Promise<string[]>;
}

const FATAL = new Set(['NotAllowedError', 'PermissionDeniedError', 'SecurityError', 'NotFoundError', 'DevicesNotFoundError']);

function abortError(): DOMException {
  return new DOMException('The scan was closed', 'AbortError');
}

function appleTouch(): boolean {
  const n = navigator;
  return isAppleTouchDevice(n.userAgent || '', n.platform || '', n.maxTouchPoints || 0);
}

function prepareVideo(video: HTMLVideoElement) {
  // iOS will not paint a camera preview (and will not decode) unless these are set
  // before srcObject, including in a Home Screen PWA.
  video.muted = true;
  video.defaultMuted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute('muted', '');
  video.setAttribute('autoplay', '');
  video.setAttribute('playsinline', 'true');
  video.setAttribute('webkit-playsinline', 'true');
}

async function wait(ms: number, signal: AbortSignal) {
  if (signal.aborted) throw abortError();
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(abortError()); };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function getUserMedia(video: MediaTrackConstraints | true, signal: AbortSignal): Promise<MediaStream> {
  const constraints: MediaStreamConstraints = { audio: false, video };
  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (e) {
    // iOS often throws NotReadableError for a moment after the previous track stops.
    if ((e as Error).name !== 'NotReadableError' || signal.aborted) throw e;
    await wait(300, signal);
    return navigator.mediaDevices.getUserMedia(constraints);
  }
}

/** Rear camera, high resolution, then progressively looser constraints. `facingMode` is ideal, not exact, so a laptop webcam still opens. */
async function openStream(signal: AbortSignal, deviceId?: string): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia || window.isSecureContext === false) {
    const err = new Error('Camera requires https');
    err.name = 'SecurityError';
    throw err;
  }
  const attempts: (MediaTrackConstraints | true)[] = deviceId
    ? [
        { deviceId: { ideal: deviceId }, facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        { deviceId: { ideal: deviceId } },
      ]
    : [
        { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        { facingMode: { ideal: 'environment' } },
        true,
      ];
  let last: unknown;
  for (const video of attempts) {
    if (signal.aborted) throw abortError();
    try { return await getUserMedia(video, signal); }
    catch (e) {
      last = e;
      if (signal.aborted || FATAL.has((e as Error).name)) throw e;
    }
  }
  throw last instanceof Error ? last : new Error('Camera failed');
}

async function attach(video: HTMLVideoElement, stream: MediaStream) {
  prepareVideo(video);
  video.srcObject = stream;
  try { await video.play(); } catch { /* play can reject until frames arrive; the size wait handles that */ }
}

async function waitForSize(video: HTMLVideoElement, signal: AbortSignal, ms: number) {
  const start = Date.now();
  while (video.videoWidth === 0) {
    if (signal.aborted) throw abortError();
    if (Date.now() - start > ms) return false;
    await wait(50, signal);
  }
  return true;
}

/** Re-bind the stream. A blank preview on an installed iPhone PWA often clears after this. */
async function kick(video: HTMLVideoElement, stream: MediaStream) {
  video.srcObject = null;
  await new Promise((r) => setTimeout(r, 80));
  prepareVideo(video);
  video.srcObject = stream;
  try { await video.play(); } catch { /* ignore */ }
}

function trackCaps(track: MediaStreamTrack): { torch?: boolean; focusMode?: string[] } {
  const get = track.getCapabilities as undefined | (() => { torch?: boolean; focusMode?: string[] });
  try { return get?.call(track) ?? {}; } catch { return {}; }
}

function applyAdvanced(track: MediaStreamTrack, extra: Record<string, string | boolean>) {
  // focusMode and torch are real camera constraints, but this TypeScript DOM lib doesn't list them.
  return track.applyConstraints({ advanced: [extra] } as unknown as MediaTrackConstraints);
}

async function enableFocus(track: MediaStreamTrack) {
  if (!canContinuousFocus(trackCaps(track))) return;
  try { await applyAdvanced(track, { focusMode: 'continuous' }); } catch { /* desktop webcams often lack this */ }
}

async function listCameras(): Promise<CamInfo[]> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'videoinput' && d.deviceId).map((d) => ({ deviceId: d.deviceId, label: d.label }));
  } catch { return []; }
}

async function nativeDetector(): Promise<NativeDetector | null> {
  // Never use BarcodeDetector on iPhone/iPad. It is absent unless a hidden flag is on,
  // and even then detect() does not return barcodes.
  if (appleTouch()) return null;
  const Ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  if (!Ctor?.getSupportedFormats) return null;
  let supported: string[] = [];
  try { supported = await Ctor.getSupportedFormats(); } catch { return null; }
  const formats = selectNativeFormats(supported, false);
  if (!formats) return null;
  try { return new Ctor({ formats }); } catch { return null; }
}

function nativeFormat(format: string | undefined): RetailFormat | null {
  if (format === 'ean_13' || format === 'ean_8' || format === 'upc_a' || format === 'upc_e') return format;
  return null;
}

function captureGuide(video: HTMLVideoElement, canvas: HTMLCanvasElement, guide: GuideFrac): ImageData | null {
  const rect = guideSourceRect(video.videoWidth, video.videoHeight, video.clientWidth, video.clientHeight, guide);
  if (!rect) return null;
  const scale = Math.min(1, 720 / rect.w);
  const w = Math.max(1, Math.round(rect.w * scale));
  const h = Math.max(1, Math.round(rect.h * scale));
  if (w < 40 || h < 16) return null;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, rect.x, rect.y, rect.w, rect.h, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/**
 * Open the rear camera and read UPC-A / EAN-13 / EAN-8 / UPC-E until stop() or a confirmed code.
 * The capture canvas is resized every frame. ZXing's own video helper sizes it once, which is
 * still 0×0 on iPhone when playback starts, so it never sees a barcode.
 */
export async function startLiveScan(video: HTMLVideoElement, signal: AbortSignal, hooks: ScanHooks): Promise<ScanController | null> {
  let stream: MediaStream | null = null;
  let stopped = false;
  let timer = 0;
  let torchOn = false;
  let devices: CamInfo[] = [];
  const canvas = document.createElement('canvas');

  const stopTracks = (s: MediaStream | null) => { s?.getTracks().forEach((t) => t.stop()); };
  // A getUserMedia that resolves after close must not be left running.
  const adopt = (s: MediaStream): MediaStream | null => {
    if (stopped || signal.aborted) { stopTracks(s); return null; }
    return s;
  };
  const release = () => {
    if (stopped) return;
    stopped = true;
    window.clearTimeout(timer);
    stopTracks(stream);
    stream = null;
    if (video.srcObject) video.srcObject = null;
    try { video.pause(); } catch { /* already gone */ }
  };
  signal.addEventListener('abort', release, { once: true });

  const currentTrack = () => stream?.getVideoTracks()[0];
  const publishCaps = () => {
    const track = currentTrack();
    hooks.onCapabilities({ torch: !!track && canUseTorch(trackCaps(track)), cameras: devices.length });
  };

  try {
    prepareVideo(video);
    // Load the decoder while the permission prompt is up so the first frames aren't spent downloading it.
    const decodeReady = import('./decode');
    const opened = adopt(await openStream(signal));
    if (!opened) { release(); return null; }
    stream = opened;
    devices = await listCameras();
    const currentId = stream.getVideoTracks()[0]?.getSettings?.().deviceId;
    const better = preferredRearId(devices, currentId);
    if (better && !stopped) {
      try {
        const next = adopt(await openStream(signal, better));
        if (next) { stopTracks(stream); stream = next; }
      } catch { /* keep the first camera */ }
    }
    if (stopped || !stream) { release(); return null; }
    await attach(video, stream);
    let sized = await waitForSize(video, signal, 2000);
    if (!sized) {
      await kick(video, stream);
      sized = await waitForSize(video, signal, 2000);
    }
    if (signal.aborted) { release(); return null; }
    if (!sized) {
      hooks.onError('The camera opened but is not sending a picture. Close and tap Scan again, or type the barcode below.');
      release();
      return null;
    }
    const track = currentTrack();
    if (track) await enableFocus(track);
    let decodeRgba: (rgba: Uint8ClampedArray, width: number, height: number) => string | null;
    try { ({ decodeRgba } = await decodeReady); }
    catch {
      if (!signal.aborted) hooks.onError('The barcode reader could not be loaded. Check your connection, or type the barcode below.');
      release();
      return null;
    }
    if (stopped || signal.aborted) { release(); return null; }
    publishCaps();
    hooks.onScanning();

    let detector = await nativeDetector();
    let nativeFailures = 0;
    let reads: ReadState = { code: null, hits: 0 };
    let frame = 0;
    let blankStreak = 0;
    let kickedForBlank = false;

    const tick = async () => {
      if (stopped || signal.aborted) return;
      const live = currentTrack();
      if (!live || video.videoWidth === 0) {
        timer = window.setTimeout(tick, 200);
        return;
      }
      const wide = frame % 2 === 1;
      frame++;
      const image = captureGuide(video, canvas, wide ? WIDE_GUIDE : AIM_GUIDE);
      if (image && frameLooksBlank(image.data)) {
        blankStreak++;
        if (blankStreak === 8) hooks.onBlank(true);
        if (blankStreak === 10 && stream && !kickedForBlank) {
          kickedForBlank = true;
          const liveStream = stream;
          await kick(video, liveStream);
          if (stopped || signal.aborted) return;
        }
      } else if (image) {
        if (blankStreak >= 8) hooks.onBlank(false);
        blankStreak = 0;
      }
      let code: string | null = null;
      if (detector) {
        try {
          const found = await detector.detect(video);
          nativeFailures = 0;
          for (const hit of found) {
            code = normalizeScan(hit.rawValue || '', nativeFormat(hit.format));
            if (code) break;
          }
        } catch {
          nativeFailures++;
          // A detector that throws (broken flag, missing frame) should not block the ZXing path.
          if (nativeFailures >= 5) detector = null;
        }
      }
      if (!code && image) code = decodeRgba(image.data, image.width, image.height);
      if (stopped || signal.aborted) return;
      const next = pushRead(reads, code);
      reads = next.state;
      if (next.confirmed) {
        window.clearTimeout(timer);
        hooks.onHit(next.confirmed);
        return;
      }
      timer = window.setTimeout(tick, 140);
    };
    timer = window.setTimeout(tick, 140);

    return {
      stop: release,
      async setTorch(on: boolean) {
        const t = currentTrack();
        if (!t || !canUseTorch(trackCaps(t))) return false;
        try {
          await applyAdvanced(t, { torch: on });
          torchOn = on;
          return true;
        } catch { return false; }
      },
      async switchCamera() {
        if (stopped) return;
        devices = await listCameras();
        if (devices.length < 2 || !stream) return;
        const id = currentTrack()?.getSettings?.().deviceId;
        const idx = Math.max(0, devices.findIndex((d) => d.deviceId === id));
        const next = devices[(idx + 1) % devices.length];
        try {
          const opened = adopt(await openStream(signal, next.deviceId));
          if (!opened || !stream) return;
          stopTracks(stream);
          stream = opened;
          await attach(video, stream);
          await waitForSize(video, signal, 2000);
          const t = currentTrack();
          if (t) await enableFocus(t);
          if (torchOn && t) {
            try { await applyAdvanced(t, { torch: true }); } catch { torchOn = false; }
          }
          publishCaps();
        } catch { /* keep the camera that's already running */ }
      },
    };
  } catch (e) {
    const aborted = signal.aborted || (e as Error).name === 'AbortError';
    release();
    if (!aborted) hooks.onError(cameraProblemMessage((e as Error).name || '', appleTouch()));
    return null;
  }
}
