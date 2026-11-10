import { Camera, Check, ImageDown, Monitor, ScanLine } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../lib/i18n';
import { useApp } from '../state/app';
import { useToasts } from './Toasts';
import { Badge, Button, Dialog } from './ui';

/**
 * Built-in screenshot tool so DROPZONE never needs a second app:
 *  - "Capture screen" uses getDisplayMedia (desktop browsers, one click, no install)
 *  - "Use camera" grabs a still from the device camera (phones/tablets)
 * Both produce a PNG File that lands in the send queue.
 */
export function CaptureDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { addFiles } = useApp();
  const toasts = useToasts();
  const [shot, setShot] = useState<{ file: File; url: string; width: number; height: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cameraOn, setCameraOn] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOn(false);
  }, []);

  useEffect(() => {
    if (!open) {
      stopCamera();
      setShot(null);
      setError('');
    }
  }, [open, stopCamera]);

  const keep = async () => {
    if (!shot) return;
    await addFiles([shot.file]);
    toasts.push({ tone: 'success', title: t('cap.staged'), body: t('cap.stagedBody') });
    URL.revokeObjectURL(shot.url);
    setShot(null);
    stopCamera();
    onClose();
  };

  const captureScreen = async () => {
    setError('');
    setBusy(true);
    try {
      const display = navigator.mediaDevices as MediaDevices & {
        getDisplayMedia?: (constraints: DisplayMediaStreamOptions) => Promise<MediaStream>;
      };
      if (!display.getDisplayMedia) throw new Error(t('cap.unsupported'));
      const stream = await display.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
      const track = stream.getVideoTracks()[0];
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      // Give the compositor two frames so the first paint is not black.
      await new Promise((resolve) => setTimeout(resolve, 220));
      const settings = track.getSettings();
      const canvas = document.createElement('canvas');
      canvas.width = settings.width ?? video.videoWidth;
      canvas.height = settings.height ?? video.videoHeight;
      canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((value) => resolve(value), 'image/png'));
      stream.getTracks().forEach((entry) => entry.stop());
      if (!blob) throw new Error(t('cap.failed'));
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const file = new File([blob], `screenshot-${stamp}.png`, { type: 'image/png' });
      setShot({ file, url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height });
    } catch (cause) {
      const message = (cause as Error).message;
      setError(message === t('cap.unsupported') || message === t('cap.failed') ? message : t('cap.denied'));
    } finally {
      setBusy(false);
    }
  };

  const startCamera = async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      streamRef.current = stream;
      setCameraOn(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      setError(t('cap.denied'));
      setCameraOn(false);
    }
  };

  const shootCamera = async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((value) => resolve(value), 'image/png'));
    if (!blob) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = new File([blob], `camera-${stamp}.png`, { type: 'image/png' });
    setShot({ file, url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height });
    stopCamera();
  };

  const supportsDisplay = typeof navigator !== 'undefined' && Boolean((navigator.mediaDevices as MediaDevices).getDisplayMedia);

  return (
    <Dialog open={open} onClose={() => { stopCamera(); onClose(); }} title={t('cap.title')} description={t('cap.desc')} size="md">
      {error ? <p className="mb-3 rounded-lg border border-err/30 bg-err/10 px-3 py-2 text-[12px] text-err">{error}</p> : null}

      {shot ? (
        <div className="space-y-3">
          <img src={shot.url} alt={t('cap.title')} className="max-h-[46vh] w-full rounded-xl border border-line object-contain" />
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{shot.width}×{shot.height}</Badge>
            <Badge>{Math.round(shot.file.size / 1024)} KB</Badge>
            <Badge tone="accent">PNG</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={keep}>
              <Check className="size-4" /> {t('cap.use')}
            </Button>
            <Button variant="ghost" onClick={() => { URL.revokeObjectURL(shot.url); setShot(null); }}>
              <ImageDown className="size-4" /> {t('cap.retake')}
            </Button>
          </div>
        </div>
      ) : cameraOn ? (
        <div className="space-y-3">
          <div className="overflow-hidden rounded-xl border border-line bg-black">
            <video ref={videoRef} playsInline muted className="aspect-[3/4] w-full object-cover" />
          </div>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => void shootCamera()}>
              <ScanLine className="size-4" /> {t('cap.shoot')}
            </Button>
            <Button variant="ghost" onClick={stopCamera}>{t('pair.stopCamera')}</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2.5">
          <button
            onClick={() => void captureScreen()}
            disabled={!supportsDisplay || busy}
            className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface-2/60 px-3.5 py-3 text-left transition-colors hover:border-accent-line hover:bg-surface-2 disabled:opacity-50"
          >
            <span className="grid size-9 place-items-center rounded-lg bg-accent-soft text-accent"><Monitor className="size-4" /></span>
            <span className="min-w-0">
              <span className="block text-[13px] font-medium">{t('cap.screen')}</span>
              <span className="block text-[11.5px] text-muted">{t('cap.screenHint')}</span>
            </span>
          </button>
          <button
            onClick={() => void startCamera()}
            className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface-2/60 px-3.5 py-3 text-left transition-colors hover:border-accent-line hover:bg-surface-2"
          >
            <span className="grid size-9 place-items-center rounded-lg bg-accent-soft text-accent"><Camera className="size-4" /></span>
            <span className="min-w-0">
              <span className="block text-[13px] font-medium">{t('cap.camera')}</span>
              <span className="block text-[11.5px] text-muted">{t('cap.cameraHint')}</span>
            </span>
          </button>
          <p className="px-1 pt-1 text-[11px] leading-relaxed text-muted">{t('cap.privacy')}</p>
        </div>
      )}
    </Dialog>
  );
}
