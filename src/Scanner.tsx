import { useEffect, useRef, useState } from 'react';

/** Camera barcode scanner: native BarcodeDetector when available, else @zxing/browser (iPhone Safari). */
export function Scanner({ onResult, onClose }: { onResult: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState('');
  const [manual, setManual] = useState('');
  useEffect(() => {
    let stop = () => {}; let done = false;
    const finish = (c: string) => { if (done) return; done = true; stop(); onResult(c); };
    (async () => {
      try {
        const BD = (window as any).BarcodeDetector;
        if (BD) {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
          stop = () => stream.getTracks().forEach((t) => t.stop());
          const v = video.current!; v.srcObject = stream; await v.play();
          const det = new BD({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] });
          const tick = async () => { if (done) return; try { const r = await det.detect(v); if (r[0]) return finish(r[0].rawValue); } catch { /* frame not ready */ } setTimeout(tick, 250); };
          tick();
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser');
          const reader = new BrowserMultiFormatReader();
          const ctl = await reader.decodeFromVideoDevice(undefined, video.current!, (res) => { if (res) finish(res.getText()); });
          stop = () => ctl.stop();
        }
      } catch (e) { setErr('Camera unavailable: ' + ((e as Error).message || e) + '. Type the barcode instead.'); }
    })();
    return () => { done = true; stop(); };
  }, [onResult]);
  return (
    <div className="modal"><div className="sheet">
      <h3>Scan barcode</h3>
      <video ref={video} className="scanvideo" playsInline muted />
      {err && <p className="warn">{err}</p>}
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (manual.trim()) onResult(manual.trim()); }}>
        <input inputMode="numeric" placeholder="or type barcode" value={manual} onChange={(e) => setManual(e.target.value)} />
        <button>Look up</button>
      </form>
      <button className="ghost" onClick={onClose}>Cancel</button>
    </div></div>
  );
}
