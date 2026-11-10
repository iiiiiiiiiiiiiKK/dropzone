import { Camera, Check, Crop, ImageDown, Monitor, ScanLine } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { dragToRect, MIN_CROP, stageRectToImage } from '../lib/crop';
import type { Rect as CropRect } from '../lib/crop';
import { t } from '../lib/i18n';
import { useApp } from '../state/app';
import { useToasts } from './Toasts';
import { Badge, Button, Dialog } from './ui';

type Shot = { file: File; url: string; width: number; height: number };
type Rect = CropRect;

/**
 * Built-in capture tool, no external software:
 *  - Capture screen -> getDisplayMedia, then pick a region (custom crop) or keep it all
 *  - Use camera -> grab a still from the device camera (phones/tablets)
 * Everything is cropped locally on a canvas and staged as PNG.
 */
export function CaptureDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { addFiles } = useApp();
  const toasts = useToasts();
  const [shot, setShot] = useState<Shot | null>(null);
  const [raw, setRaw] = useState<{ bitmap: ImageBitmap; width: number; height: number } | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cameraOn, setCameraOn] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const reset = useCallback(() => {
    setShot((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
    setRaw(null);
    setRect(null);
    setDragging(false);
    dragStart.current = null;
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOn(false);
  }, []);

  useEffect(() => {
    if (!open) {
      stopCamera();
      reset();
      setError('');
    }
  }, [open, stopCamera, reset]);

  const toFile = async (blob: Blob, prefix: string): Promise<Shot> => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = new File([blob], `${prefix}-${stamp}.png`, { type: 'image/png' });
    const bitmap = await createImageBitmap(blob);
    return { file, url: URL.createObjectURL(blob), width: bitmap.width, height: bitmap.height };
  };

  const cropTo = async (source: ImageBitmap, area: Rect | null): Promise<Blob | null> => {
    const canvas = document.createElement('canvas');
    if (area) {
      canvas.width = Math.max(1, Math.round(area.w));
      canvas.height = Math.max(1, Math.round(area.h));
      canvas.getContext('2d')?.drawImage(source, area.x, area.y, area.w, area.h, 0, 0, canvas.width, canvas.height);
    } else {
      canvas.width = source.width;
      canvas.height = source.height;
      canvas.getContext('2d')?.drawImage(source, 0, 0);
    }
    return await new Promise<Blob | null>((resolve) => canvas.toBlob((value) => resolve(value), 'image/png'));
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
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      // Two frames of headroom so the first paint is never black.
      await new Promise((resolve) => setTimeout(resolve, 240));
      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings();
      const width = settings.width ?? video.videoWidth;
      const height = settings.height ?? video.videoHeight;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')?.drawImage(video, 0, 0, width, height);
      stream.getTracks().forEach((entry) => entry.stop());
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((value) => resolve(value), 'image/png'));
      if (!blob) throw new Error(t('cap.failed'));
      const bitmap = await createImageBitmap(blob);
      setRaw({ bitmap, width: bitmap.width, height: bitmap.height });
      setRect(null);
    } catch (cause) {
      const message = (cause as Error).message;
      if (message === t('cap.unsupported') || message === t('cap.failed')) setError(message);
      else if (/denied|NotAllowed/i.test(message)) setError(t('cap.denied'));
      else setError(t('cap.denied'));
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
    setShot(await toFile(blob, 'camera'));
    stopCamera();
  };

  const pointerPos = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = stageRef.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return {
      x: Math.min(Math.max(event.clientX - box.left, 0), box.width),
      y: Math.min(Math.max(event.clientY - box.top, 0), box.height),
    };
  };

  /** Converts the on-screen drag rectangle into source-image pixels. */
  const normalize = (area: Rect): Rect | null => {
    if (!raw) return null;
    const box = stageRef.current?.getBoundingClientRect();
    if (!box) return null;
    return stageRectToImage(area, { width: box.width, height: box.height }, { width: raw.width, height: raw.height });
  };

  const keepRegion = async (area: Rect | null) => {
    if (!raw) return;
    setBusy(true);
    try {
      const source = area ? normalize(area) : null;
      const blob = await cropTo(raw.bitmap, source);
      if (!blob) throw new Error(t('cap.failed'));
      setShot(await toFile(blob, source ? 'region' : 'screenshot'));
    } catch {
      setError(t('cap.failed'));
    } finally {
      setBusy(false);
    }
  };

  const keep = async () => {
    if (!shot) return;
    await addFiles([shot.file]);
    toasts.push({ tone: 'success', title: t('cap.staged'), body: t('cap.stagedBody') });
    reset();
    stopCamera();
    onClose();
  };

  const supportsDisplay = typeof navigator !== 'undefined' && Boolean((navigator.mediaDevices as MediaDevices).getDisplayMedia);

  return (
    <Dialog open={open} onClose={() => { stopCamera(); reset(); onClose(); }} title={t('cap.title')} description={t('cap.desc')} size="lg">
      {error ? (
        <div className="mb-3 rounded-lg border border-err/30 bg-err/10 px-3 py-2">
          <p className="text-[12px] leading-relaxed text-err">{error}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                const { pickFiles } = await import('../lib/clipboard');
                const files = await pickFiles({ accept: 'image/*' });
                if (!files.length) return;
                await addFiles(files);
                toasts.push({ tone: 'success', title: t('cap.staged'), body: t('cap.stagedBody') });
                reset();
                onClose();
              }}
            >
              <ImageDown className="size-3.5" /> {t('cap.pickInstead')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { reset(); onClose(); }}>{t('common.cancel')}</Button>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{t('cap.deniedHint')}</p>
        </div>
      ) : null}

      {shot ? (
        <div className="space-y-3">
          <img src={shot.url} alt={t('cap.title')} className="max-h-[46vh] w-full rounded-xl border border-line object-contain" />
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{shot.width}×{shot.height}</Badge>
            <Badge>{Math.max(1, Math.round(shot.file.size / 1024))} KB</Badge>
            <Badge tone="accent">PNG</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={keep}>
              <Check className="size-4" /> {t('cap.use')}
            </Button>
            <Button variant="ghost" onClick={() => { reset(); if (raw) void captureScreen(); }}>
              <ImageDown className="size-4" /> {t('cap.retake')}
            </Button>
          </div>
        </div>
      ) : raw ? (
        <div className="space-y-3">
          <p className="rounded-lg border border-accent-line bg-accent-soft/50 px-3 py-2 text-[12px] text-fg-soft">{t('cap.cropHint')}</p>
          <div
            ref={stageRef}
            className="relative max-h-[52vh] w-full touch-none select-none overflow-hidden rounded-xl border border-line bg-black"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              const point = pointerPos(event);
              dragStart.current = point;
              setRect({ x: point.x, y: point.y, w: 0, h: 0 });
              setDragging(true);
            }}
            onPointerMove={(event) => {
              if (!dragging || !dragStart.current) return;
              const point = pointerPos(event);
              const box = stageRef.current?.getBoundingClientRect();
              if (!box) return;
              setRect(dragToRect(dragStart.current, point, { width: box.width, height: box.height }));
            }}
            onPointerUp={() => {
              setDragging(false);
              dragStart.current = null;
            }}
          >
            <canvas
              ref={(node) => {
                if (!node) return;
                node.width = raw.width;
                node.height = raw.height;
                node.getContext('2d')?.drawImage(raw.bitmap, 0, 0);
              }}
              className="mx-auto block h-auto max-h-[52vh] w-auto max-w-full"
            />
            {rect && rect.w > MIN_CROP && rect.h > MIN_CROP ? (
              <>
                <div className="pointer-events-none absolute inset-0 bg-black/45" />
                <div
                  className="pointer-events-none absolute border-2 border-accent shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
                  style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
                />
                <span
                  className="pointer-events-none absolute rounded bg-accent px-1.5 py-0.5 font-mono text-[10px] text-white"
                  style={{ left: rect.x, top: Math.max(0, rect.y - 20) }}
                >
                  {Math.round(rect.w)}×{Math.round(rect.h)}
                </span>
              </>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => void keepRegion(rect && rect.w > MIN_CROP && rect.h > MIN_CROP ? rect : null)} loading={busy}>
              <Crop className="size-4" /> {rect && rect.w > MIN_CROP && rect.h > MIN_CROP ? t('cap.useRegion') : t('cap.useFull')}
            </Button>
            <Button variant="ghost" onClick={() => void captureScreen()}>{t('cap.retake')}</Button>
            <Button variant="ghost" onClick={reset}>{t('common.cancel')}</Button>
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
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"><Monitor className="size-4" /></span>
            <span className="min-w-0">
              <span className="block text-[13px] font-medium">{t('cap.screen')}</span>
              <span className="block text-[11.5px] leading-relaxed text-muted">{t('cap.screenHint')}</span>
            </span>
          </button>
          <button
            onClick={() => void startCamera()}
            className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface-2/60 px-3.5 py-3 text-left transition-colors hover:border-accent-line hover:bg-surface-2"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"><Camera className="size-4" /></span>
            <span className="min-w-0">
              <span className="block text-[13px] font-medium">{t('cap.camera')}</span>
              <span className="block text-[11.5px] leading-relaxed text-muted">{t('cap.cameraHint')}</span>
            </span>
          </button>
          <p className="px-1 pt-1 text-[11px] leading-relaxed text-muted">{t('cap.privacy')}</p>
        </div>
      )}
    </Dialog>
  );
}
