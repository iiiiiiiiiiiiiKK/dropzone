import { motion } from 'framer-motion';
import { Check, ClipboardPaste, Copy, Send, Type } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { t } from '../lib/i18n';
import { useApp } from '../state/app';
import { cn, copyText, formatBytes, timeAgo } from '../lib/utils';
import { Button, Card, EmptyState } from './ui';

export function TextComposer({ compact = false }: { compact?: boolean }) {
  const { devices, sendTextTo, texts, linkStates } = useApp();
  const [value, setValue] = useState('');
  const [target, setTarget] = useState('');
  const [sending, setSending] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  const copy = async (id: string, value: string) => {
    const ok = await copyText(value);
    if (!ok) return;
    setCopiedId(id);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopiedId(null), 1600);
  };

  useEffect(() => {
    if (devices.length === 0) {
      setTarget('');
      return;
    }
    if (!devices.some((device) => device.id === target)) {
      setTarget((devices.find((device) => device.online) ?? devices[0]!).id);
    }
  }, [devices, target]);

  const send = async () => {
    if (!value.trim()) return;
    setSending(true);
    try {
      await sendTextTo(target, value);
      setValue('');
    } finally {
      setSending(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Type className="size-4 text-accent" />
        <h3 className="text-[13px] font-semibold">{t('text.title')}</h3>
        <span className="ml-auto text-[11px] text-muted">{t('text.hint')}</span>
      </div>
      <div className="p-4 pt-3">
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              void send();
            }
          }}
          rows={compact ? 3 : 4}
          placeholder={t('text.placeholder')}
          className="block w-full min-w-0 resize-none overflow-y-auto break-words rounded-xl border border-line bg-surface-2/60 px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-fg outline-none transition-colors placeholder:text-muted focus:border-accent-line"
        />
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              try {
                const text = await navigator.clipboard.readText();
                if (text) setValue((current) => (current ? `${current}\n${text}` : text));
              } catch {
                /* clipboard read may be denied */
              }
            }}
          >
            <ClipboardPaste className="size-3.5" /> {t('text.paste')}
          </Button>
          <select
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] text-fg outline-none focus:border-accent-line"
          >
            {devices.length === 0 ? <option value="">{t('queue.noDevices')}</option> : null}
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name}
              </option>
            ))}
          </select>
          <Button variant="primary" size="sm" onClick={send} loading={sending} disabled={!value.trim() || !target}>
            <Send className="size-3.5" /> {t('text.send')}
          </Button>
        </div>
        {target && linkStates[target] === 'connected' ? <p className="mt-2 text-[11px] text-ok">{t('text.live')}</p> : null}
      </div>

      <div className="border-t border-line bg-surface-2/20 px-2 pt-2 pb-2">
        <div className="mb-1.5 flex items-center justify-between px-1.5">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">{t('text.history')}</p>
          <span className="text-[10px] text-muted tabular-nums">{texts.length}</span>
        </div>
        {texts.length === 0 ? (
          <p className="px-2 py-3 text-center text-[11.5px] text-muted">{t('text.empty')}</p>
        ) : (
          <ul className="max-h-64 space-y-1.5 overflow-y-auto px-1 pb-1">
            {texts.slice(0, 20).map((text) => {
              const copied = copiedId === text.id;
              return (
                <motion.li
                  key={text.id}
                  layout
                  className={cn(
                    'group relative flex items-start gap-2 rounded-xl border px-2.5 py-2 transition-colors',
                    text.direction === 'in'
                      ? 'border-accent-line/60 bg-accent-soft/40 hover:bg-accent-soft/60'
                      : 'border-line bg-surface-2/50 hover:bg-surface-2/80',
                    copied && 'border-ok/50 bg-ok/10',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'absolute inset-y-2 left-0 w-[2px] rounded-full',
                      text.direction === 'in' ? 'bg-accent' : 'bg-line-strong',
                    )}
                  />
                  <div className="min-w-0 flex-1 pl-1.5">
                    <pre className="max-h-[10lh] overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-fg">{text.content}</pre>
                    <p className="mt-1 flex items-center gap-1.5 text-[10px] text-muted">
                      <span className={cn('inline-flex items-center gap-1 font-medium', text.direction === 'in' ? 'text-accent' : 'text-fg-soft')}>
                        {text.direction === 'in' ? '↓' : '↑'}
                        {text.direction === 'in' ? t('text.from', { name: text.deviceName }) : t('text.to', { name: text.deviceName })}
                      </span>
                      <span aria-hidden>·</span>
                      <span>{timeAgo(text.createdAt)}</span>
                      <span aria-hidden>·</span>
                      <span>{formatBytes(new Blob([text.content]).size)}</span>
                    </p>
                  </div>
                  <button
                    onClick={() => void copy(text.id, text.content)}
                    aria-label={copied ? t('text.copied') : t('text.copy')}
                    title={copied ? t('text.copied') : t('text.copy')}
                    className={cn(
                      'grid size-7 shrink-0 place-items-center rounded-lg border transition-all',
                      copied
                        ? 'border-ok/40 bg-ok/15 text-ok'
                        : 'border-transparent text-muted opacity-70 hover:border-line hover:bg-surface-3 hover:text-fg group-hover:opacity-100',
                    )}
                  >
                    {copied ? <Check className="size-3.5" /> : <Copy className="size-3" />}
                  </button>
                </motion.li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}

export function TextEmpty() {
  return <EmptyState icon={<Type className="size-4" />} title={t('text.empty')} description={t('text.hint')} />;
}