import { useEffect, useRef, useState, type FormEvent } from 'react';
import { digitsOnly, normalizeBarcode } from './lib/barcode';
import { startLiveScan, type ScanController } from './lib/live-scan';

/** Camera barcode scanner for iPhone Safari, the Home Screen app, and desktop Chrome. */
export function Scanner({ onResult, onClose }: { onResult: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onResultRef = useRef(onResult);
  const onCloseRef = useRef(onClose);
  onResultRef.current = onResult;
  onCloseRef.current = onClose;
  const controlRef = useRef<ScanController | null>(null);
  const doneRef = useRef(false);
  const pendingRef = useRef(0);
  const [phase, setPhase] = useState<'starting' | 'scanning' | 'hit' | 'error'>('starting');
  const [status, setStatus] = useState('Starting the camera…');
  const [error, setError] = useState('');
  const [blank, setBlank] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [torchOk, setTorchOk] = useState(false);
  const [cameras, setCameras] = useState(0);
  const [manual, setManual] = useState('');
  const [manualHint, setManualHint] = useState('');

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const ac = new AbortController();
    let control: ScanController | null = null;
    startLiveScan(video, ac.signal, {
      onScanning: () => { setPhase('scanning'); setStatus('Line the barcode up inside the frame and hold it steady.'); },
      onBlank: (isBlank) => setBlank(isBlank),
      onCapabilities: (caps) => { setTorchOk(caps.torch); setCameras(caps.cameras); if (!caps.torch) setTorchOn(false); },
      onHit: (code) => {
        if (doneRef.current) return;
        setPhase('hit');
        setBlank(false);
        setStatus('Got it — ' + code);
        try { navigator.vibrate?.(70); } catch { /* iPhone has no vibrate API */ }
        pendingRef.current = window.setTimeout(() => finish(code), 480);
      },
      onError: (message) => { setPhase('error'); setError(message); setStatus(''); },
    }).then((c) => {
      control = c;
      controlRef.current = c;
      if (ac.signal.aborted) c?.stop();
    });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(pendingRef.current);
      ac.abort();
      control?.stop();
      controlRef.current?.stop();
      removeEventListener('keydown', onKey);
    };
  }, []);

  function finish(code: string) {
    if (doneRef.current) return;
    doneRef.current = true;
    window.clearTimeout(pendingRef.current);
    controlRef.current?.stop();
    onResultRef.current(code);
  }

  function submitManual(e: FormEvent) {
    e.preventDefault();
    const digits = digitsOnly(manual);
    if (digits.length < 6 || digits.length > 14) {
      setManualHint('Enter the digits printed under the barcode (usually 8, 12, or 13).');
      return;
    }
    // A failed check digit is still looked up. The save form keeps the number so it can be corrected.
    finish(normalizeBarcode(digits) ?? digits);
  }

  async function toggleTorch() {
    const next = !torchOn;
    const ok = await controlRef.current?.setTorch(next);
    if (ok) setTorchOn(next);
    else { setTorchOk(false); setTorchOn(false); }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="scan-title">
      <div className="sheet">
        <h3 id="scan-title">Scan barcode</h3>
        <div className={'scanstage' + (phase === 'hit' ? ' hit' : '')}>
          <video ref={videoRef} className="scanvideo" playsInline muted autoPlay />
          <div className="guide" aria-hidden="true"><span /></div>
        </div>
        {status && <p className="hint" role="status">{status}</p>}
        {blank && phase === 'scanning' && <p className="warn" role="status">The picture looks black. Close and tap Scan again, or type the barcode below.</p>}
        {error && <p className="warn" role="alert">{error}</p>}
        <form onSubmit={submitManual}>
          <label>Or type the barcode
            <input inputMode="numeric" autoComplete="off" autoCorrect="off" spellCheck={false} placeholder="e.g. 012345678905" value={manual} onChange={(e) => { setManual(e.target.value); setManualHint(''); }} />
          </label>
          <div className="row"><button type="submit">Look up</button></div>
        </form>
        {manualHint && <p className="hint" role="status">{manualHint}</p>}
        <div className="row wrap">
          {torchOk && <button type="button" className={torchOn ? '' : 'ghost'} aria-pressed={torchOn} onClick={toggleTorch}>{torchOn ? 'Light on' : 'Light'}</button>}
          {cameras > 1 && <button type="button" className="ghost" onClick={() => controlRef.current?.switchCamera()}>Flip camera</button>}
          <button type="button" className="ghost" onClick={() => onCloseRef.current()}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
