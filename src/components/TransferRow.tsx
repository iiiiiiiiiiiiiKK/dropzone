import { motion } from 'framer-motion';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Ban,
  Check,
  Copy,
  Download,
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
import { t } from '../lib/i18n';
import type { TransferProgress } from '../lib/transfer';
import { cn, downloadBlob, fileKind, formatBytes, formatDuration, formatSpeed, timeAgo } from '../lib/utils';
import { ProgressBar } from './ui';

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
  compact = false,
}: {
  record: TransferRecord;
  progress?: TransferProgress;
  onFavorite?: () => void;
  onDelete?: () => void;
  onRetry?: () => void;
  onCancel?: () => void;
  compact?: boolean;
}) {
  const kind = fileKind(record.name, record.mime);
  const Icon = ICONS[kind] ?? FileIcon;
  const active = record.status === 'transferring' || record.status === 'queued' || record.status === 'verifying' || record.status === 'connecting';
  const ratio = progress && progress.size > 0 ? progress.transferred / progress.size : record.status === 'completed' ? 1 : 0;

  const download = async () => {
    const blob = await readFile(record.id);
    if (blob) downloadBlob(blob, record.name);
  };

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      className={cn(
        'group relative flex items-start gap-3 rounded-xl border border-transparent px-2.5 py-2.5 transition-colors hover:border-line hover:bg-surface-2/60',
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

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[13px] font-medium text-fg">{record.name}</p>
          {record.favorite === 1 ? <Star className="size-3 shrink-0 fill-warn text-warn" /> : null}
        </div>
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

        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 max-sm:opacity-100">
          {record.kind === 'file' && record.direction === 'in' && record.status === 'completed' ? (
            <IconAction label={t('xfer.save')} onClick={download}><Download className="size-3.5" /></IconAction>
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
