import { motion } from 'framer-motion';
import { ClipboardPaste, Copy, Send, Type } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useApp } from '../state/app';
import { cn, copyText, formatBytes, timeAgo } from '../lib/utils';
import { Button, Card, EmptyState } from './ui';

export function TextComposer({ compact = false }: { compact?: boolean }) {
  const { devices, sendTextTo, texts, linkStates } = useApp();
  const [value, setValue] = useState('');
  const [target, setTarget] = useState('');
  const [sending, setSending] = useState(false);

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
        <h3 className="text-[13px] font-semibold">Send text</h3>
        <span className="ml-auto text-[11px] text-muted">links, code, anything</span>
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
          placeholder="Paste a link, a snippet, or a note…"
          className="w-full resize-none rounded-xl border border-line bg-surface-2/60 px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-fg outline-none transition-colors placeholder:text-muted focus:border-accent-line"
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
            <ClipboardPaste className="size-3.5" /> Paste
          </Button>
          <select
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] text-fg outline-none focus:border-accent-line"
          >
            {devices.length === 0 ? <option value="">No devices</option> : null}
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name}
              </option>
            ))}
          </select>
          <Button variant="primary" size="sm" onClick={send} loading={sending} disabled={!value.trim() || !target}>
            <Send className="size-3.5" /> Send
          </Button>
        </div>
        {target && linkStates[target] === 'connected' ? (
          <p className="mt-2 text-[11px] text-ok">Live link ready — text is delivered instantly.</p>
        ) : null}
      </div>

      <div className="border-t border-line px-2 py-2">
        {texts.length === 0 ? (
          <p className="px-2 py-3 text-center text-[11.5px] text-muted">Nothing received yet.</p>
        ) : (
          <ul className="max-h-56 space-y-1 overflow-y-auto px-1">
            {texts.slice(0, 12).map((text) => (
              <motion.li
                key={text.id}
                layout
                className={cn('group flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-2/70')}
              >
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-fg-soft">{text.content}</p>
                  <p className="mt-0.5 text-[10px] text-muted">
                    {text.direction === 'in' ? 'from' : 'to'} {text.deviceName} · {timeAgo(text.createdAt)} · {formatBytes(new Blob([text.content]).size)}
                  </p>
                </div>
                <button
                  onClick={() => void copyText(text.content)}
                  aria-label="Copy text"
                  className="rounded-md p-1 text-muted opacity-60 transition hover:bg-surface-3 hover:text-fg group-hover:opacity-100"
                >
                  <Copy className="size-3" />
                </button>
              </motion.li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

export function TextEmpty() {
  return <EmptyState icon={<Type className="size-4" />} title="No text yet" description="Send a link or snippet to one of your devices." />;
}
