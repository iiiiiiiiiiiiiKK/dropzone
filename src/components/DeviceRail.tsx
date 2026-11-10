import { motion } from 'framer-motion';
import { Laptop, Link2, Monitor, QrCode, Send, Smartphone, Tablet, Trash2, Unplug, Wifi } from 'lucide-react';
import { useState } from 'react';
import type { DeviceRecord } from '../lib/db';
import { pickFiles } from '../lib/clipboard';
import { cn, timeAgo } from '../lib/utils';
import { useApp } from '../state/app';
import { Badge, Button, Dialog, EmptyState, StatusDot } from './ui';

function DeviceGlyph({ type, className }: { type: string; className?: string }) {
  const Icon = type === 'mobile' ? Smartphone : type === 'tablet' ? Tablet : type === 'desktop' ? Monitor : Laptop;
  return <Icon className={className} />;
}

export function DeviceRail({ onPair, className }: { onPair: () => void; className?: string }) {
  const { devices, paths, sendFilesTo, unpair, peers } = useApp();
  const [confirming, setConfirming] = useState<DeviceRecord | null>(null);

  const onlineById = new Map(peers.map((peer) => [peer.id, peer.online]));

  return (
    <aside className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-center justify-between px-1">
        <div>
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-muted">My devices</h2>
          <p className="mt-1 text-[11.5px] text-muted">{devices.length} paired · {devices.filter((device) => onlineById.get(device.id)).length} online</p>
        </div>
        <Button size="sm" variant="secondary" onClick={onPair}>
          <QrCode className="size-3.5" />
          Pair
        </Button>
      </div>

      {devices.length === 0 ? (
        <EmptyState
          icon={<Link2 className="size-4" />}
          title="No devices paired"
          description="Open DROPZONE on your phone and scan its QR code to create an encrypted pairing."
          action={
            <Button size="sm" variant="primary" onClick={onPair}>
              <QrCode className="size-3.5" /> Pair a device
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {devices.map((device) => {
            const online = onlineById.get(device.id) ?? false;
            const path = paths[device.id];
            return (
              <motion.li
                key={device.id}
                layout
                className="rounded-2xl border border-line bg-surface/70 p-3 transition-colors hover:border-line-strong"
              >
                <div className="flex items-start gap-2.5">
                  <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-line bg-surface-2 text-fg-soft">
                    <DeviceGlyph type={device.type} className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-[13px] font-medium">{device.name}</p>
                      <StatusDot tone={online ? 'ok' : 'muted'} pulse={online} />
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-muted">
                      {online ? 'Online' : `Last seen ${timeAgo(device.lastSeen)}`}
                      {path ? ` · ${path === 'relay' ? 'TURN relay' : path === 'direct' ? 'P2P direct' : 'linking'}` : ''}
                    </p>
                  </div>
                </div>

                <div className="mt-2.5 flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="flex-1"
                    onClick={async () => {
                      const files = await pickFiles();
                      if (files.length) await sendFilesTo(device.id, files);
                    }}
                  >
                    <Send className="size-3.5" /> Send
                  </Button>
                  <button
                    onClick={() => setConfirming(device)}
                    title="Unpair device"
                    aria-label={`Unpair ${device.name}`}
                    className="grid size-8 place-items-center rounded-lg border border-line text-muted transition-colors hover:border-err/40 hover:text-err"
                  >
                    <Unplug className="size-3.5" />
                  </button>
                </div>

                {device.safetyNumber ? (
                  <p className="mt-2 font-mono text-[10px] tracking-[0.12em] text-muted">safety {device.safetyNumber}</p>
                ) : null}
              </motion.li>
            );
          })}
        </ul>
      )}

      <div className="mt-1 rounded-2xl border border-line bg-surface/40 p-3">
        <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-fg-soft">
          <Wifi className="size-3.5 text-accent" /> Peer-to-peer by default
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">
          Files move directly between devices. When NAT blocks a direct path, traffic falls back to your own TURN relay — never to a storage bucket.
        </p>
      </div>

      <Dialog
        open={Boolean(confirming)}
        onClose={() => setConfirming(null)}
        title={`Unpair ${confirming?.name ?? 'device'}?`}
        description="This removes the trust link and history association on this device only. The other device keeps its own copy."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(null)}>Keep device</Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (confirming) await unpair(confirming.id);
                setConfirming(null);
              }}
            >
              <Trash2 className="size-4" /> Unpair
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-muted">
          You can pair again at any time with a fresh QR code. Safety number:
          <span className="ml-1 font-mono text-fg-soft">{confirming?.safetyNumber ?? '—'}</span>
        </p>
      </Dialog>
    </aside>
  );
}

export function DeviceChips({ className }: { className?: string }) {
  const { devices, peers } = useApp();
  const online = new Set(peers.filter((peer) => peer.online).map((peer) => peer.id));
  if (devices.length === 0) return null;
  return (
    <div className={cn('flex gap-2 overflow-x-auto pb-1 no-scrollbar', className)}>
      {devices.map((device) => (
        <span key={device.id} className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface-2/70 px-2.5 py-1 text-[11.5px] text-fg-soft">
          <DeviceGlyph type={device.type} className="size-3" />
          {device.name}
          <StatusDot tone={online.has(device.id) ? 'ok' : 'muted'} />
        </span>
      ))}
    </div>
  );
}

export function PairBadge() {
  return <Badge tone="accent"><Link2 className="size-3" /> encrypted</Badge>;
}
