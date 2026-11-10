import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Ban,
  Check,
  Copy,
  Download,
  Eye,
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileCode2,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Presentation,
  RotateCw,
  Star,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import type { TransferRecord } from '../lib/db';
import { readFile } from '../lib/db';
import { copyText } from '../lib/utils';
import { t } from '../lib/i18n';
import { useRef, useState } from 'react';
import type { TransferProgress } from '../lib/transfer';
import { cn, downloadBlob, fileKind, formatBytes, formatDuration, formatSpeed, timeAgo } from '../lib/utils';
import { ProgressBar } from './ui';
import { useToasts } from './Toasts';

const ICONS = {
  image: FileIcon,
  video: FileVideo,
  audio: FileAudio,
  pdf: FileText,
  archive: FileArchive,
  doc: FileText,
  sheet: FileSpreadsheet,
  slide: Presentation,
  code: FileCode2,
  text: FileText,
  file: FileIcon,
};

const STATUS_TONE: Record<string, string> = {
  completed: 'text-ok',
  failed: 'text-err',
  canceled: 'text-muted',
  interrupted: 'text-warn',
  rejected: 'text-warn',
  transferring: 'text-accent',
  verifying: 'text-accent',
  queued: 'text-muted',
  connecting: 'text-muted',
};

function statusLabel(record: TransferRecord): string {
  if (record.status === 'transferring') return record.direction === 'in' ? t('xfer.receiving') : t('xfer.sending');
  return t(`xfer.${record.status}`);
}

export function TransferRow({
  record,
  progress,
  onFavorite,
  onDelete,
  onRetry,
  onCancel,
  onMissingFile,
  compact = false,
}: {
  record: TransferRecord;
  progress?: TransferProgress;
  onFavorite?: () => void;
  onDelete?: () => void;
  onRetry?: () => void;
  onCancel?: () => void;
  onMissingFile?: (record: TransferRecord) => void;
  compact?: boolean;
}) {
  const kind = fileKind(record.name, record.mime);
  const Icon = ICONS[kind] ?? FileIcon;
  const active = record.status === 'transferring' || record.status === 'queued' || record.status === 'verifying' || record.status === 'connecting';
  const ratio = progress && progress.size > 0 ? progress.transferred / progress.size : record.status === 'completed' ? 1 : 0;

  const [preview, setPreview] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toasts = useToasts();

  const isText = record.kind === 'text';
  const body = record.body ?? record.name;

  const copyBody = async () => {
    const ok = await copyText(body);
    if (!ok) return;
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1600);
  };

  const canSave = record.kind === 'file' && record.direction === 'in' && record.status === 'completed';

  const download = async () => {
    const blob = await readFile(record.id);
    if (!blob) {
      onMissingFile?.(record);
      return;
    }
    downloadBlob(blob, record.name);
    // Explicit confirmation: a silent download reads as "nothing happened".
    toasts.push({ tone: 'success', title: t('xfer.savedToast'), body: record.name });
  };

  const openPreview = async () => {
    const blob = await readFile(record.id);
    if (!blob) {
      onMissingFile?.(record);
      return;
    }
    if (fileKind(record.name, record.mime) === 'image') {
      const url = URL.createObjectURL(blob);
      setPreview(url);
      return;
    }
    downloadBlob(blob, record.name);
  };

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      className={cn(
        'group relative flex items-start gap-3 rounded-xl border px-2.5 py-2.5 transition-all',
        record.direction === 'in'
          ? 'border-accent-line/45 bg-accent-soft/35 hover:border-accent-line/70 hover:bg-accent-soft/55'
          : 'border-line bg-surface-2/45 hover:border-line-strong hover:bg-surface-2/70',
        compact ? '' : 'sm:px-3',
      )}
    >
      <div className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-surface-2">
        {record.thumbnail ? (
          <img src={URL.createObjectURL(record.thumbnail)} alt="" className="size-full object-cover" onLoad={(event) => URL.revokeObjectURL(event.currentTarget.src)} />
        ) : (
          <Icon className="size-4 text-fg-soft" />
        )}
        <span className={cn('absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full border border-line bg-bg', record.direction === 'in' ? 'text-accent-2' : 'text-accent')}>
          {record.direction === 'in' ? <ArrowDownLeft className="size-2.5" /> : <ArrowUpRight className="size-2.5" />}
        </span>
      </div>

      <div
        className={cn('min-w-0 flex-1', canSave && 'cursor-pointer')}
        onClick={canSave ? () => void openPreview() : undefined}
        role={canSave ? 'button' : undefined}
        tabIndex={canSave ? 0 : undefined}
        onKeyDown={
          canSave
            ? (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  void openPreview();
                }
              }
            : undefined
        }
      >
        {isText ? (
          <div className="flex items-start gap-2">
            <pre
              className="max-h-[10lh] min-w-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed text-fg"
              title={body}
            >
              {body}
            </pre>
            {record.favorite === 1 ? <Star className="mt-0.5 size-3 shrink-0 fill-warn text-warn" /> : null}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <p className={cn('truncate text-[13px] font-medium text-fg', canSave && 'hover:underline')}>{record.name}</p>
            {record.favorite === 1 ? <Star className="size-3 shrink-0 fill-warn text-warn" /> : null}
          </div>
        )}
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-muted">
          <span>{formatBytes(record.size)}</span>
          <span aria-hidden>·</span>
          <span>{record.direction === 'in' ? t('xfer.from', { name: record.deviceName }) : t('xfer.to', { name: record.deviceName })}</span>
          <span aria-hidden>·</span>
          <span>{timeAgo(record.createdAt)}</span>
          {progress && progress.phase === 'sending' ? (
            <>
              <span aria-hidden>·</span>
              <span className="tabular-nums text-accent">{formatSpeed(progress.speed)}</span>
              {progress.etaSec ? <span className="tabular-nums">{t('xfer.eta', { time: formatDuration(progress.etaSec) })}</span> : null}
            </>
          ) : null}
        </p>
        {active ? (
          <div className="mt-1.5 flex items-center gap-2">
            <ProgressBar value={ratio} className="max-w-[240px]" />
            <span className="font-mono text-[10.5px] text-muted tabular-nums">{Math.round(ratio * 100)}%</span>
          </div>
        ) : null}
        {record.status === 'failed' && record.error ? (
          <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-err">
            <TriangleAlert className="size-3" /> {record.error}
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-1">
        <span className={cn('mr-1 inline-flex items-center gap-1 text-[11px] font-medium', STATUS_TONE[record.status] ?? 'text-muted')}>
          {record.status === 'completed' ? <Check className="size-3" /> : null}
          {active && record.status !== 'queued' ? <RotateCw className="size-3 animate-spin" /> : null}
          {record.status === 'failed' ? <TriangleAlert className="size-3" /> : null}
          <span className="hidden sm:inline">{statusLabel(record)}</span>
        </span>

        <div className="flex items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100 focus-within:opacity-100 max-sm:opacity-100">
          {isText ? (
            <IconAction label={copied ? t('text.copied') : t('text.copy')} onClick={() => void copyBody()}>
              {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
            </IconAction>
          ) : null}
          {canSave ? (
            <IconAction label={t('xfer.save')} onClick={() => void download()}><Download className="size-3.5" /></IconAction>
          ) : null}
          {canSave && fileKind(record.name, record.mime) === 'image' ? (
            <IconAction label={t('xfer.preview')} onClick={() => void openPreview()}><Eye className="size-3.5" /></IconAction>
          ) : null}
          {onFavorite ? (
            <IconAction label={record.favorite === 1 ? t('xfer.unfavorite') : t('xfer.favorite')} onClick={onFavorite}>
              <Star className={cn('size-3.5', record.favorite === 1 && 'fill-warn text-warn')} />
            </IconAction>
          ) : null}
          {active && onCancel ? (
            <IconAction label={t('xfer.cancel')} onClick={onCancel}><Ban className="size-3.5" /></IconAction>
          ) : null}
          {(record.status === 'failed' || record.status === 'canceled') && onRetry ? (
            <IconAction label={t('xfer.retry')} onClick={onRetry}><RotateCw className="size-3.5" /></IconAction>
          ) : null}
          {onDelete ? (
            <IconAction label={t('xfer.delete')} onClick={onDelete}><Trash2 className="size-3.5" /></IconAction>
          ) : null}
        </div>
      </div>

      <AnimatePresence>
        {preview ? (
          <motion.div
            className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-6 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              URL.revokeObjectURL(preview);
              setPreview(null);
            }}
          >
            <motion.img
              src={preview}
              alt={record.name}
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              className="max-h-[85vh] max-w-full rounded-xl border border-white/15 object-contain shadow-2xl"
            />
            <p className="mt-3 text-[12px] text-white/70">{record.name} · {t('xfer.previewHint')}</p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.li>
  );
}

function IconAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-7 place-items-center rounded-md text-muted transition-colors hover:bg-surface-3 hover:text-fg"
    >
      {children}
    </button>
  );
}

export function CopyAction({ value }: { value: string }) {
  return (
    <button
      onClick={() => void navigator.clipboard?.writeText(value)}
      className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[10.5px] text-muted hover:text-fg"
    >
      <Copy className="size-3" /> {t('common.copy')}
    </button>
  );
}