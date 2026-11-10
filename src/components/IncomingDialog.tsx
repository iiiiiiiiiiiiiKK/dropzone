import { ArrowDownToLine, X } from 'lucide-react';
import { t } from '../lib/i18n';
import { formatBytes } from '../lib/utils';
import { useApp } from '../state/app';
import { Badge, Button, Dialog } from './ui';

/** Shown when auto-receive is off: the receiver decides before any bytes flow. */
export function IncomingDialog() {
  const { incoming, answerIncoming } = useApp();
  return (
    <Dialog
      open={Boolean(incoming)}
      onClose={() => answerIncoming(false)}
      title={t('incoming.title')}
      description={t('incoming.desc')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => answerIncoming(false)}>
            <X className="size-4" /> {t('incoming.decline')}
          </Button>
          <Button variant="primary" onClick={() => answerIncoming(true)}>
            <ArrowDownToLine className="size-4" /> {t('incoming.accept')}
          </Button>
        </>
      }
    >
      <div className="space-y-2.5">
        <p className="truncate text-[14px] font-semibold">{incoming?.name}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{formatBytes(incoming?.size ?? 0)}</Badge>
          <Badge tone="accent">{t('incoming.from', { name: incoming?.deviceName ?? '' })}</Badge>
        </div>
        <p className="text-[11.5px] leading-relaxed text-muted">{t('incoming.note')}</p>
      </div>
    </Dialog>
  );
}
