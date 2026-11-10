import { motion } from 'framer-motion';
import { ArrowDownLeft, Clock3, Download, Search, Star, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { t } from '../lib/i18n';
import { useApp } from '../state/app';
import { useToasts } from '../components/Toasts';
import { TransferRow } from '../components/TransferRow';
import { Badge, Button, Card, Dialog, EmptyState } from '../components/ui';
import { readFile } from '../lib/db';
import { downloadBlob, formatBytes } from '../lib/utils';

import { cn } from '../lib/utils';

type Filter = 'all' | 'files' | 'text' | 'favorites';

const FILTERS: Array<{ key: Filter; labelKey: string }> = [
  { key: 'all', labelKey: 'hist.all' },
  { key: 'files', labelKey: 'hist.files' },
  { key: 'text', labelKey: 'hist.text' },
  { key: 'favorites', labelKey: 'hist.favorites' },
];

export function History({ favoritesOnly = false }: { favoritesOnly?: boolean }) {
  const { transfers, progress, toggleFavoriteTransfer, removeTransfer, cancelTransfer, clearHistory } = useApp();
  const toasts = useToasts();
  const reportMissing = () => toasts.push({ tone: 'warn', title: t('xfer.missing'), body: t('xfer.missingBody') });
  const [filter, setFilter] = useState<Filter>(favoritesOnly ? 'favorites' : 'all');
  const [query, setQuery] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [zipping, setZipping] = useState(false);

  const active: Filter = favoritesOnly ? 'favorites' : filter;

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return transfers.filter((record) => {
      if (active === 'favorites' && record.favorite !== 1) return false;
      if (active === 'files' && record.kind !== 'file') return false;
      if (active === 'text' && record.kind !== 'text') return false;
      if (needle && !`${record.name} ${record.deviceName}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [transfers, active, query]);

  return (
    <div className="space-y-4">
      <Card className="p-3 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex flex-1 items-center gap-2 rounded-xl border border-line bg-surface-2/60 px-3 py-2">
            <Search className="size-3.5 text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('hist.search')}
              className="w-full min-w-0 bg-transparent text-[13px] outline-none placeholder:text-muted"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {!favoritesOnly
              ? FILTERS.map((item) => (
                  <button
                    key={item.key}
                    onClick={() => setFilter(item.key)}
                    className={cn(
                      'rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors',
                      active === item.key ? 'bg-surface-3 text-fg' : 'text-muted hover:text-fg',
                    )}
                  >
                    {t(item.labelKey)}
                  </button>
                ))
              : null}
            <Button
              size="sm"
              variant="ghost"
              loading={zipping}
              onClick={async () => {
                const inbound = rows.filter((record) => record.kind === 'file' && record.direction === 'in' && record.status === 'completed');
                if (inbound.length === 0) {
                  toasts.push({ tone: 'warn', title: t('hist.zipEmpty') });
                  return;
                }
                setZipping(true);
                try {
                  // Loaded on demand so the ZIP encoder never sits in the startup bundle.
                  const { default: JSZip } = await import('jszip');
                  const zip = new JSZip();
                  let added = 0;
                  for (const record of inbound) {
                    const blob = await readFile(record.id);
                    if (blob) {
                      zip.file(record.name, blob);
                      added += 1;
                    }
                  }
                  if (added === 0) {
                    toasts.push({ tone: 'warn', title: t('xfer.missing'), body: t('xfer.missingBody') });
                    return;
                  }
                  const archive = await zip.generateAsync({ type: 'blob' });
                  downloadBlob(archive, `dropzone-${new Date().toISOString().slice(0, 10)}.zip`);
                  toasts.push({ tone: 'success', title: t('hist.zipDone', { n: added }), body: formatBytes(archive.size) });
                } finally {
                  setZipping(false);
                }
              }}
              className="text-muted hover:text-fg"
            >
              <Download className="size-3.5" /> {t('hist.zip')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmClear(true)} className="text-muted hover:text-err">
              <Trash2 className="size-3.5" /> {t('hist.clear')}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-2">
        {rows.length === 0 ? (
          <EmptyState
            icon={favoritesOnly ? <Star className="size-4" /> : <Clock3 className="size-4" />}
            title={favoritesOnly ? t('hist.emptyFavTitle') : t('hist.emptyTitle')}
            description={favoritesOnly ? t('hist.emptyFavDesc') : t('hist.emptyDesc')}
          />
        ) : (
          <ul className="space-y-0.5">
            {rows.map((record) => (
              <TransferRow
                key={record.id}
                record={record}
                progress={progress[record.id]}
                onFavorite={() => void toggleFavoriteTransfer(record.id)}
                onDelete={() => void removeTransfer(record.id)}
                onCancel={() => cancelTransfer(record.id)}
                    onMissingFile={reportMissing}
              />
            ))}
          </ul>
        )}
      </Card>

      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="px-1 text-[11.5px] leading-relaxed text-muted">
        <ArrowDownLeft className="mr-1 inline size-3" />
        {t('hist.localNote')}
      </motion.p>

      <Dialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title={t('hist.clearTitle')}
        description={t('hist.clearDesc')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              onClick={async () => {
                await clearHistory();
                setConfirmClear(false);
              }}
            >
              <Trash2 className="size-4" /> {t('hist.deleteEverything')}
            </Button>
          </>
        }
      >
        <div className="flex items-center gap-2 text-[13px] text-muted">
          <Badge tone="warn">{t('hist.records', { n: transfers.length })}</Badge>
          <span>{t('hist.clearBodyExtra')}</span>
        </div>
      </Dialog>
    </div>
  );
}