import { Check, Edit3, KeyRound, Monitor, QrCode, Send, Shield, Smartphone, Tablet, Unplug, Wifi, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { pickFiles } from '../lib/clipboard';
import { useApp } from '../state/app';
import { Badge, Button, Card, Dialog, EmptyState, StatusDot } from '../components/ui';
import { cn, timeAgo } from '../lib/utils';

function Glyph({ type, className }: { type: string; className?: string }) {
  const Icon = type === 'mobile' ? Smartphone : type === 'tablet' ? Tablet : Monitor;
  return <Icon className={className} />;
}

export function Devices({ onPair }: { onPair: () => void }) {
  const { devices, identity, peers, settings, updateSettings, linkStates, paths, unpair, sendFilesTo, verified } = useApp();
  const [name, setName] = useState(settings.deviceName);
  const [confirming, setConfirming] = useState<string | null>(null);
  const online = new Set(peers.filter((peer) => peer.online).map((peer) => peer.id));

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-2xl border border-line bg-surface-2 text-accent">
              <Glyph type={settings.deviceType} className="size-5" />
            </div>
            <div>
              <p className="text-[14px] font-semibold">This device</p>
              <p className="mt-0.5 text-[11.5px] text-muted">
                {identity ? `ID ${identity.deviceId.slice(0, 12)}…` : 'initialising identity…'} · {settings.deviceType}
              </p>
            </div>
          </div>
          <Button variant="primary" onClick={onPair}>
            <QrCode className="size-4" /> Pair a device
          </Button>
        </div>

        <div className="grid gap-3 border-t border-line bg-surface-2/30 p-4 sm:grid-cols-2 sm:p-5">
          <label className="space-y-1.5">
            <span className="text-[11.5px] font-medium text-fg-soft">Device name</span>
            <div className="flex items-center gap-2">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                onBlur={() => name.trim() && updateSettings({ deviceName: name.trim() })}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-accent-line"
              />
              <Button size="sm" variant="secondary" onClick={() => name.trim() && updateSettings({ deviceName: name.trim() })}>
                <Check className="size-3.5" />
              </Button>
            </div>
          </label>
          <div className="space-y-1.5">
            <span className="text-[11.5px] font-medium text-fg-soft">Identity key</span>
            <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2">
              <KeyRound className="size-3.5 shrink-0 text-muted" />
              <span className="truncate font-mono text-[11px] text-muted">{identity?.publicKey.slice(0, 44)}…</span>
            </div>
          </div>
        </div>
      </Card>

      <div>
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="text-[13px] font-semibold">Paired devices</h2>
          <span className="text-[11.5px] text-muted">{devices.length} trusted</span>
        </div>

        {devices.length === 0 ? (
          <EmptyState
            icon={<QrCode className="size-4" />}
            title="No trusted devices yet"
            description="Pairing creates a one-time code that links two devices. After that, no login is ever required."
            action={
              <Button size="sm" variant="primary" onClick={onPair}>
                <QrCode className="size-3.5" /> Pair now
              </Button>
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {devices.map((device) => {
              const isOnline = online.has(device.id);
              const link = linkStates[device.id] ?? 'idle';
              const path = paths[device.id];
              return (
                <Card key={device.id} className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="grid size-10 place-items-center rounded-xl border border-line bg-surface-2 text-fg-soft">
                      <Glyph type={device.type} className="size-4.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-semibold">{device.name}</p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted">
                        <StatusDot tone={isOnline ? 'ok' : 'muted'} pulse={isOnline} />
                        {isOnline ? 'Online' : `Last seen ${timeAgo(device.lastSeen)}`}
                      </p>
                    </div>
                    {verified[device.id] ? (
                      <Badge tone="ok">
                        <Shield className="size-3" /> verified
                      </Badge>
                    ) : null}
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-line bg-surface-2/40 p-2.5 text-[11px]">
                    <div>
                      <dt className="text-muted">Link</dt>
                      <dd className={cn('mt-0.5 font-medium', link === 'connected' ? 'text-ok' : 'text-fg-soft')}>
                        {link === 'connected' ? (path === 'relay' ? 'TURN relay' : 'P2P direct') : link}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">Safety number</dt>
                      <dd className="mt-0.5 font-mono text-[10.5px] text-fg-soft">{device.safetyNumber ?? '—'}</dd>
                    </div>
                  </dl>

                  <div className="mt-3 flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="flex-1"
                      onClick={async () => {
                        const files = await pickFiles();
                        if (files.length) await sendFilesTo(device.id, files);
                      }}
                    >
                      <Send className="size-3.5" /> Send files
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirming(device.id)} className="text-muted hover:text-err">
                      <Unplug className="size-3.5" /> Unpair
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Card className="p-4 sm:p-5">
        <p className="flex items-center gap-2 text-[12.5px] font-semibold">
          <Shield className="size-4 text-accent" /> How trust works here
        </p>
        <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-muted">
          <li>• Each device generates an ECDSA P-256 key pair; the private key never leaves this browser and cannot be exported.</li>
          <li>• A pairing code is a single-use secret that expires in five minutes. It is not a long-term key.</li>
          <li>• Both devices derive the same safety number from their public keys — compare it out loud to rule out a relay swap.</li>
          <li>• Files are encrypted in transit by DTLS-SRTP on the WebRTC data channel. The relay only brokers connection metadata.</li>
        </ul>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge tone={isSecureContext ? 'ok' : 'warn'}>
            {isSecureContext ? <Wifi className="size-3" /> : <WifiOff className="size-3" />} {isSecureContext ? 'secure context' : 'insecure context — WebRTC still works locally'}
          </Badge>
          <Badge>{peers.length} relay peer{peers.length === 1 ? '' : 's'}</Badge>
        </div>
      </Card>

      <Dialog
        open={Boolean(confirming)}
        onClose={() => setConfirming(null)}
        title="Unpair this device?"
        description="The trust link is removed locally. You can pair again with a fresh QR code."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(null)}>Keep</Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (confirming) await unpair(confirming);
                setConfirming(null);
              }}
            >
              <Edit3 className="size-4" /> Unpair
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-muted">Transfers already stored stay in your local history.</p>
      </Dialog>
    </div>
  );
}
