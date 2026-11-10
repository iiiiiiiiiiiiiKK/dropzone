import jsQR from 'jsqr';
import QRCode from 'qrcode';
import { Camera, CameraOff, Check, Clock, Copy, Link2, QrCode, ScanLine } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { decodeInvite, encodeInvite, inviteIsExpired, type PairInvite } from '../lib/pairing';
import { applyTheme } from '../lib/theme';
import { cn, copyText } from '../lib/utils';
import { useApp } from '../state/app';
import { Badge, Button, Dialog } from './ui';

type Tab = 'show' | 'scan' | 'link';

export function PairingDialog({
  open,
  onClose,
  initialInvite,
  initialTab = 'show',
}: {
  open: boolean;
  onClose: () => void;
  initialInvite?: PairInvite | null;
  initialTab?: Tab;
}) {
  const { startInvite, pairWithInvite, devices, peers } = useApp();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [invite, setInvite] = useState<PairInvite | null>(null);
  const [qr, setQr] = useState<string>('');
  const [remaining, setRemaining] = useState(0);
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  useEffect(() => {
    if (!open) {
      stopCamera();
      return;
    }
    if (initialInvite) {
      setInvite(initialInvite);
      setTab(initialTab === 'show' ? 'show' : initialTab);
      void pairWithInvite(initialInvite);
      return;
    }
    if (tab === 'show' && !invite) {
      void startInvite()
        .then((next) => setInvite(next))
        .catch((cause: Error) => setError(cause.message));
    }
  }, [open, tab, invite, initialInvite, initialTab, startInvite, pairWithInvite, stopCamera]);

  useEffect(() => {
    if (!invite) return;
    QRCode.toDataURL(encodeInvite(invite), {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 560,
      color: { dark: '#0b0c0e', light: '#ffffff' },
    })
      .then(setQr)
      .catch(() => setQr(''));
  }, [invite]);

  useEffect(() => {
    if (!invite) return;
    const tick = () => setRemaining(Math.max(0, Math.round((invite.expiresAt - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [invite]);

  const handleDecoded = useCallback(
    async (raw: string) => {
      const parsed = decodeInvite(raw);
      if (!parsed) {
        setError('That code is not a DROPZONE pairing link.');
        return;
      }
      if (inviteIsExpired(parsed)) {
        setError('This pairing code has expired. Ask the other device for a fresh one.');
        return;
      }
      stopCamera();
      await pairWithInvite(parsed);
      onClose();
    },
    [onClose, pairWithInvite, stopCamera],
  );

  const startCamera = useCallback(async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      streamRef.current = stream;
      setScanning(true);
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      const canvas = canvasRef.current ?? document.createElement('canvas');
      canvasRef.current = canvas;
      const context = canvas.getContext('2d', { willReadFrequently: true });

      const detectorCtor = (window as unknown as { BarcodeDetector?: new (options: { formats: string[] }) => { detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>> } })
        .BarcodeDetector;
      const detector = detectorCtor ? new detectorCtor({ formats: ['qr_code'] }) : null;

      const tick = async () => {
        if (!streamRef.current || !videoRef.current) return;
        const source = videoRef.current;
        if (source.readyState >= 2 && source.videoWidth > 0) {
          canvas.width = source.videoWidth;
          canvas.height = source.videoHeight;
          context?.drawImage(source, 0, 0, canvas.width, canvas.height);
          let decoded: string | null = null;
          if (detector) {
            try {
              const results = await detector.detect(canvas);
              decoded = results[0]?.rawValue ?? null;
            } catch {
              decoded = null;
            }
          }
          if (!decoded && context) {
            const frame = context.getImageData(0, 0, canvas.width, canvas.height);
            const result = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' });
            decoded = result?.data ?? null;
          }
          if (decoded) {
            await handleDecoded(decoded);
            return;
          }
        }
        rafRef.current = requestAnimationFrame(() => void tick());
      };
      void tick();
    } catch (cause) {
      setError(`Camera unavailable: ${(cause as Error).message}`);
      setScanning(false);
    }
  }, [handleDecoded]);

  useEffect(() => {
    if (tab === 'scan' && open && !scanning) void startCamera();
    if (tab !== 'scan') stopCamera();
  }, [tab, open, scanning, startCamera, stopCamera]);

  useEffect(() => {
    if (open) applyTheme(document.documentElement.classList.contains('light') ? 'light' : 'dark');
  }, [open]);

  const linkValue = invite ? encodeInvite(invite) : '';

  return (
    <Dialog
      open={open}
      onClose={() => {
        stopCamera();
        onClose();
      }}
      title="Pair a device"
      description="Create an encrypted trust link with a one-time code. Nothing is stored in the cloud."
      size="md"
    >
      <div className="mb-4 grid grid-cols-3 gap-1 rounded-xl border border-line bg-surface-2/60 p-1">
        {(
          [
            { key: 'show', label: 'My QR', icon: QrCode },
            { key: 'scan', label: 'Scan', icon: ScanLine },
            { key: 'link', label: 'Link', icon: Link2 },
          ] as const
        ).map((item) => (
          <button
            key={item.key}
            onClick={() => {
              setError('');
              setTab(item.key);
            }}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[12.5px] font-medium transition-colors',
              tab === item.key ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg',
            )}
          >
            <item.icon className="size-3.5" />
            {item.label}
          </button>
        ))}
      </div>

      {error ? <p className="mb-3 rounded-lg border border-err/30 bg-err/10 px-3 py-2 text-[12px] text-err">{error}</p> : null}

      {tab === 'show' ? (
        <div className="flex flex-col items-center gap-3">
          <div className="relative rounded-2xl border border-line bg-white p-3">
            {qr ? <img src={qr} alt="Pairing QR code" className="size-56 rounded-lg" /> : <div className="grid size-56 place-items-center text-[12px] text-neutral-500">Generating…</div>}
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={remaining > 0 ? 'accent' : 'err'}>
              <Clock className="size-3" />
              {remaining > 0 ? `expires in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` : 'expired'}
            </Badge>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                const next = await startInvite();
                setInvite(next);
              }}
            >
              New code
            </Button>
          </div>
          <p className="max-w-sm text-center text-[12px] leading-relaxed text-muted">
            Open DROPZONE on the other device → <span className="text-fg-soft">Pair</span> → <span className="text-fg-soft">Scan</span>. The code is single-use and dies when it expires.
          </p>
          <Button size="sm" variant="secondary" onClick={() => void copyText(linkValue)}>
            <Copy className="size-3.5" /> Copy pairing link
          </Button>
        </div>
      ) : null}

      {tab === 'scan' ? (
        <div className="flex flex-col items-center gap-3">
          <div className="relative aspect-square w-full max-w-[280px] overflow-hidden rounded-2xl border border-line bg-black">
            <video ref={videoRef} playsInline muted className="size-full object-cover" />
            <div className="pointer-events-none absolute inset-0 m-6 rounded-xl border border-white/40" />
            {!scanning ? (
              <div className="absolute inset-0 grid place-items-center bg-black/60">
                <CameraOff className="size-6 text-white/70" />
              </div>
            ) : null}
          </div>
          <Button size="sm" variant="secondary" onClick={() => (scanning ? stopCamera() : void startCamera())}>
            <Camera className="size-3.5" /> {scanning ? 'Stop camera' : 'Start camera'}
          </Button>
          <p className="max-w-sm text-center text-[12px] leading-relaxed text-muted">
            Point the camera at the other device's QR code. Camera access is requested only while this tab is open.
          </p>
        </div>
      ) : null}

      {tab === 'link' ? (
        <div className="space-y-3">
          <label className="block text-[12px] font-medium text-fg-soft">Paste a pairing link or token</label>
          <textarea
            value={link}
            onChange={(event) => setLink(event.target.value)}
            rows={4}
            placeholder="dropzone://pair?d=… or https://…/#/pair?d=…"
            className="w-full resize-none rounded-xl border border-line bg-surface-2/60 px-3 py-2.5 font-mono text-[11.5px] outline-none focus:border-accent-line"
          />
          <Button
            variant="primary"
            onClick={async () => {
              setError('');
              await handleDecoded(link);
            }}
            disabled={!link.trim()}
          >
            <Check className="size-4" /> Pair with this code
          </Button>
        </div>
      ) : null}

      <div className="mt-5 rounded-xl border border-line bg-surface-2/40 px-3 py-2.5">
        <p className="text-[11.5px] leading-relaxed text-muted">
          {devices.length === 0 ? 'No devices paired yet. ' : `Paired: ${devices.map((device) => device.name).join(', ')}. `}
          Online now: {peers.filter((peer) => peer.online).length}. Every device keeps its own identity key — the QR only carries a short-lived invitation.
        </p>
      </div>
      <canvas ref={canvasRef} className="hidden" />
    </Dialog>
  );
}
