import { motion } from 'framer-motion';
import { Download, FileDown, X } from 'lucide-react';
import { readFile } from '../lib/db';
import { t } from '../lib/i18n';
import { downloadBlob } from '../lib/utils';
import { useApp } from '../state/app';
import { useToasts } from './Toasts';
import { Button } from './ui';

/**
 * PairDrop-style arrival shelf: received files are listed for one click instead of
 * being buried in the history list. The bytes are still local-only — nothing is
 * auto-uploaded and nothing leaves the device unless the user saves it.
 */
export function InboxStrip() {
  const { inbox, dismissInbox } = useApp();
  const toasts = useToasts();
  if (inbox.length === 0) return null;

  const save = async (transferId: string, name: string) => {
    const blob = await readFile(transferId);
    if (!blob) {
      toasts.push({ tone: 'warn', title: t('xfer.missing'), body: t('xfer.missingBody') });
      return;
    }
    downloadBlob(blob, name);
    dismissInbox(transferId);
  };

  return (
    <motion.section
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-[20px] border border-accent-line bg-accent-soft/40 p-3 card-shadow backdrop-blur-sm"
    >
      <div className="mb-2 flex items-center gap-2 px-1">
        <FileDown className="size-4 text-accent" />
        <p className="text-[12.5px] font-semibold">{t('inbox.title')}</p>
        <span className="text-[11.5px] text-muted">{t('inbox.count', { n: inbox.length })}</span>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {inbox.map((item) => (
          <li key={item.transferId} className="flex items-center gap-2 rounded-xl border border-line bg-surface/80 px-2.5 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-medium">{item.name}</p>
              <p className="text-[10.5px] text-muted">{item.mime || 'file'}</p>
            </div>
            <Button size="sm" variant="primary" onClick={() => void save(item.transferId, item.name)}>
              <Download className="size-3.5" /> {t('inbox.save')}
            </Button>
            <button
              onClick={() => dismissInbox(item.transferId)}
              aria-label={t('common.dismiss')}
              className="rounded-md p-1 text-muted transition-colors hover:bg-surface-2 hover:text-fg"
            >
              <X className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 px-1 text-[10.5px] text-muted">{t('inbox.note')}</p>
    </motion.section>
  );
}
