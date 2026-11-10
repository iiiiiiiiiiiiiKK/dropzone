import { motion } from 'framer-motion';
import { ClipboardPaste, FilePlus2, Image as ImageIcon, Send, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { pickFiles, readClipboardDirect } from '../lib/clipboard';
import { t } from '../lib/i18n';
import { cn, formatBytes } from '../lib/utils';
import { useApp } from '../state/app';
import { Badge, Button, Kbd } from './ui';

export function DropZone({ onPasteHint }: { onPasteHint?: () => void }) {
  const { addFiles, devices } = useApp();
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const hasDevices = devices.length > 0;

  useEffect(() => {
    let depth = 0;
    const onDragEnter = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      depth += 1;
      setDragging(true);
    };
    const onDragLeave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = () => {
      depth = 0;
      setDragging(false);
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  const choose = async () => {
    setBusy(true);
    try {
      const files = await pickFiles();
      if (files.length) await addFiles(files);
    } finally {
      setBusy(false);
    }
  };

  const paste = async () => {
    setBusy(true);
    try {
      const result = await readClipboardDirect();
      if (result.files.length) await addFiles(result.files);
      else onPasteHint?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.section
      onDragOver={(event) => {
        event.preventDefault();
        if (event.dataTransfer.types.includes('Files')) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={async (event) => {
        event.preventDefault();
        setDragging(false);
        const files = Array.from(event.dataTransfer.files ?? []);
        if (files.length) await addFiles(files);
      }}
      animate={dragging ? { scale: 1.006 } : { scale: 1 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className={cn(
        'relative overflow-hidden rounded-[24px] border bg-surface/60 p-5 card-shadow transition-colors sm:p-7',
        dragging ? 'border-accent-line bg-accent-soft/40' : 'border-line',
      )}
    >
      <div
        className={cn('pointer-events-none absolute inset-0 transition-opacity duration-500', dragging ? 'opacity-100' : 'opacity-40')}
        style={{ background: 'radial-gradient(600px 240px at 50% -20%, var(--accent-soft), transparent 70%)' }}
      />
      <div className="relative flex flex-col items-center gap-4 py-6 text-center sm:py-10">
        <div className="relative">
          <div className="absolute inset-0 -z-10 blur-2xl accent-gradient opacity-20" />
          <div className="grid size-14 place-items-center rounded-2xl border border-line-strong bg-surface-2/80 sm:size-16">
            <svg viewBox="0 0 24 24" className="size-6 sm:size-7" fill="none" aria-hidden>
              <path d="M12 16V5" stroke="url(#dz-drop)" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M7.5 9.5L12 5l4.5 4.5" stroke="url(#dz-drop)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M5 16.5v1.75A1.75 1.75 0 0 0 6.75 20h10.5A1.75 1.75 0 0 0 19 18.25V16.5" stroke="url(#dz-drop)" strokeWidth="1.8" strokeLinecap="round" />
              <defs>
                <linearGradient id="dz-drop" x1="5" y1="5" x2="19" y2="20" gradientUnits="userSpaceOnUse">
                  <stop stopColor="var(--accent)" />
                  <stop offset="1" stopColor="var(--accent-2)" />
                </linearGradient>
              </defs>
            </svg>
          </div>
        </div>

        <div className="space-y-2">
          <h2 className="text-balance text-[19px] font-semibold tracking-tight sm:text-[22px]">
            {dragging ? t('drop.titleDragging') : t('drop.title')}
          </h2>
          <p className="mx-auto max-w-md text-[13px] leading-relaxed text-muted sm:text-[13.5px]">{t('drop.subtitle')}</p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          <Button variant="primary" size="lg" onClick={choose} loading={busy} className="w-full sm:w-auto">
            <FilePlus2 className="size-4" />
            {t('drop.choose')}
          </Button>
          <Button variant="secondary" size="lg" onClick={paste} disabled={busy} className="w-full sm:w-auto">
            <ClipboardPaste className="size-4" />
            {t('drop.paste')}
          </Button>
        </div>

        <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[12px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Kbd>Ctrl</Kbd>
            <Kbd>V</Kbd>
            {t('drop.onWindows')} ·
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>⌘</Kbd>
            <Kbd>V</Kbd>
            {t('drop.onMac')}
          </span>
          <span className="hidden sm:inline">· {t('drop.multi')}</span>
        </p>

        {!hasDevices ? (
          <p className="mt-1 inline-flex items-center gap-2 rounded-full border border-warn/30 bg-warn/10 px-3 py-1 text-[12px] text-warn">
            {t('drop.noDevices')}
          </p>
        ) : null}
      </div>
    </motion.section>
  );
}

export function QueuePanel() {
  const { queue, removeQueued, clearQueue, sendQueued, devices, linkStates } = useApp();
  const [target, setTarget] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (devices.length === 0) {
      setTarget('');
      return;
    }
    if (!devices.some((device) => device.id === target)) {
      const online = devices.find((device) => device.online) ?? devices[0]!;
      setTarget(online.id);
    }
  }, [devices, target]);

  if (queue.length === 0) return null;
  const total = queue.reduce((sum, item) => sum + item.file.size, 0);

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded-[20px] border border-line bg-surface/70 card-shadow"
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <Badge tone="accent">{t('queue.staged', { n: queue.length })}</Badge>
          <span className="text-[12.5px] text-muted">{t('queue.total', { size: formatBytes(total) })}</span>
        </div>
        <button onClick={clearQueue} className="inline-flex items-center gap-1.5 text-[12.5px] text-muted transition-colors hover:text-err">
          <Trash2 className="size-3.5" /> {t('queue.clear')}
        </button>
      </div>

      <ul className="grid gap-2.5 p-3 sm:grid-cols-2 xl:grid-cols-3">
        {queue.map((item) => (
          <li key={item.id} className="group relative flex items-center gap-3 rounded-xl border border-line bg-surface-2/70 p-2.5">
            <div className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-bg">
              {item.previewUrl ? <img src={item.previewUrl} alt="" className="size-full object-cover" /> : <ImageIcon className="size-4 text-muted" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-medium">{item.file.name}</p>
              <p className="text-[11px] text-muted">
                {formatBytes(item.file.size)}
                {item.width && item.height ? ` · ${item.width}×${item.height}` : ''}
                {item.file.type ? ` · ${item.file.type.split('/')[1] ?? item.file.type}`.toUpperCase() : ''}
              </p>
            </div>
            <button
              onClick={() => removeQueued(item.id)}
              aria-label={t('queue.remove', { name: item.file.name })}
              className="rounded-md p-1 text-muted opacity-70 transition hover:bg-surface-3 hover:text-err"
            >
              <X className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-2 border-t border-line bg-surface-2/40 px-4 py-3 sm:flex-row sm:items-center">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-[12.5px] text-muted">
          {t('queue.sendTo')}
          <select
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12.5px] text-fg outline-none focus:border-accent-line"
          >
            {devices.length === 0 ? <option value="">{t('queue.noDevices')}</option> : null}
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name} · {device.online ? t('queue.online') : t('queue.offline')}
              </option>
            ))}
          </select>
        </label>
        <Button
          variant="primary"
          onClick={async () => {
            setSending(true);
            try {
              await sendQueued(target);
            } finally {
              setSending(false);
            }
          }}
          disabled={!target || queue.length === 0}
          loading={sending}
        >
          <Send className="size-4" />
          {queue.length > 1 ? t('queue.sendItems', { n: queue.length }) : t('queue.sendNow')}
        </Button>
        {target && linkStates[target] === 'connected' ? <Badge tone="ok">{t('queue.liveLink')}</Badge> : null}
      </div>
    </motion.section>
  );
}
