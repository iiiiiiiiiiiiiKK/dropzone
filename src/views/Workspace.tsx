import { motion } from 'framer-motion';
import { ArrowRight, Camera, ClipboardPaste, FilePlus2, Link2, Sparkles, Type } from 'lucide-react';
import { useState } from 'react';
import { pickFiles, readClipboardDirect } from '../lib/clipboard';
import { t } from '../lib/i18n';
import { isTouchDevice } from '../lib/utils';
import { useMediaQuery } from '../lib/useMediaQuery';
import { useApp } from '../state/app';
import { useToasts } from '../components/Toasts';
import { DeviceChips, DeviceRail } from '../components/DeviceRail';
import { DropZone, QueuePanel } from '../components/DropZone';
import { TextComposer } from '../components/TextComposer';
import { TransferRow } from '../components/TransferRow';
import { Badge, Button, Card, EmptyState } from '../components/ui';
import type { ViewKey } from '../components/Sidebar';

export function Workspace({ onNavigate, onPair }: { onNavigate: (view: ViewKey) => void; onPair: () => void }) {
  const { transfers, progress, devices, toggleFavoriteTransfer, removeTransfer, cancelTransfer, addFiles, queue } = useApp();
  const toasts = useToasts();
  const reportMissing = () => toasts.push({ tone: 'warn', title: t('xfer.missing'), body: t('xfer.missingBody') });
  const recent = transfers.slice(0, 6);
  const touch = isTouchDevice();
  const wide = useMediaQuery('(min-width: 1280px)');
  const [busy, setBusy] = useState(false);

  const quickPickImage = async () => {
    setBusy(true);
    try {
      const files = await pickFiles({ accept: 'image/*' });
      if (files.length) await addFiles(files);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_336px]">
      <div className="min-w-0 space-y-4">
        <DropZone onPasteHint={() => onNavigate('settings')} />

        {touch ? (
          <div className="grid grid-cols-4 gap-2">
            {[
              {
                label: t('ws.quickPaste'),
                icon: ClipboardPaste,
                action: async () => {
                  const result = await readClipboardDirect();
                  if (result.files.length) await addFiles(result.files);
                },
              },
              { label: t('ws.quickPhotos'), icon: Camera, action: quickPickImage },
              {
                label: t('ws.quickFiles'),
                icon: FilePlus2,
                action: async () => {
                  const files = await pickFiles();
                  if (files.length) await addFiles(files);
                },
              },
              { label: t('ws.quickText'), icon: Type, action: () => onNavigate('history') },
            ].map((item) => (
              <button
                key={item.label}
                onClick={() => void item.action()}
                disabled={busy}
                className="flex flex-col items-center gap-1.5 rounded-2xl border border-line bg-surface/70 px-2 py-3 text-[11.5px] font-medium text-fg-soft transition-colors active:bg-surface-2 disabled:opacity-50"
              >
                <span className="grid size-9 place-items-center rounded-xl bg-accent-soft text-accent">
                  <item.icon className="size-4" />
                </span>
                {item.label}
              </button>
            ))}
          </div>
        ) : null}

        <QueuePanel />

        {devices.length > 0 && queue.length > 0 ? <DeviceChips /> : null}

        <Card>
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div className="flex items-center gap-2">
              <h2 className="text-[13px] font-semibold">{t('ws.recent')}</h2>
              <Badge>{transfers.length}</Badge>
            </div>
            <button onClick={() => onNavigate('history')} className="inline-flex items-center gap-1 text-[12px] text-muted transition-colors hover:text-fg">
              {t('ws.viewAll')} <ArrowRight className="size-3.5" />
            </button>
          </div>
          <div className="p-2">
            {recent.length === 0 ? (
              <EmptyState
                icon={<Sparkles className="size-4" />}
                title={devices.length === 0 ? t('ws.emptyPairTitle') : t('ws.emptyNothingTitle')}
                description={devices.length === 0 ? t('ws.emptyPairDesc') : t('ws.emptyNothingDesc')}
                action={
                  devices.length === 0 ? (
                    <Button size="sm" variant="primary" onClick={onPair}>
                      <Link2 className="size-3.5" /> {t('rail.pairCta')}
                    </Button>
                  ) : null
                }
              />
            ) : (
              <ul className="space-y-0.5">
                {recent.map((record) => (
                  <TransferRow
                    key={record.id}
                    record={record}
                    progress={progress[record.id]}
                    compact
                    onFavorite={() => void toggleFavoriteTransfer(record.id)}
                    onDelete={() => void removeTransfer(record.id)}
                    onCancel={() => cancelTransfer(record.id)}
                    onMissingFile={reportMissing}
                  />
                ))}
              </ul>
            )}
          </div>
        </Card>

        {!wide ? <TextComposer compact /> : null}
      </div>

      {wide ? (
        <div className="flex flex-col gap-3">
          <DeviceRail onPair={onPair} />
          <TextComposer compact />
        </div>
      ) : null}

      <motion.div
        key="tip"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="rounded-2xl border border-line bg-surface/40 px-4 py-3 xl:hidden"
      >
        <p className="text-[11.5px] leading-relaxed text-muted">{t('ws.tip')}</p>
      </motion.div>
    </div>
  );
}