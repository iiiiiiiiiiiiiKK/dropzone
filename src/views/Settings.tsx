import { motion } from 'framer-motion';
import {
  Bell,
  Download,
  HardDrive,
  Info,
  Moon,
  Radio,
  RefreshCw,
  Save,
  ShieldCheck,
  Sun,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { APP_VERSION, AUTHOR_X_URL, REPO_URL } from '../lib/constants';
import { exportSnapshot, requestPersistentStorage, storageUsage } from '../lib/db';
import { downloadBlob, formatBytes } from '../lib/utils';
import { useApp } from '../state/app';
import { Badge, Button, Card, Dialog, ProgressBar, Switch } from '../components/ui';

export function Settings() {
  const { settings, updateSettings, theme, setTheme, signalUrl, relayState, turnConfigured, devices, transfers, clearHistory, reconnectRelay } = useApp();
  const [usage, setUsage] = useState<{ usage: number; quota: number; persisted: boolean }>({ usage: 0, quota: 0, persisted: false });
  const [signal, setSignal] = useState(settings.signalUrlOverride);
  const [notifyState, setNotifyState] = useState<NotificationPermission>('default');
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    void storageUsage().then(setUsage);
    if ('Notification' in window) setNotifyState(Notification.permission);
  }, [transfers.length]);

  return (
    <div className="space-y-4 pb-6">
      <Card className="p-4 sm:p-5">
        <SectionTitle icon={<Sun className="size-4" />} title="Appearance" hint="Dark is the default. Your choice is stored locally." />
        <div className="mt-3 grid grid-cols-2 gap-2 sm:max-w-sm">
          {(['dark', 'light'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => {
                setTheme(mode);
                void updateSettings({ theme: mode });
              }}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-[13px] font-medium capitalize transition-colors ${
                theme === mode ? 'border-accent-line bg-accent-soft text-fg' : 'border-line bg-surface-2/50 text-muted hover:text-fg'
              }`}
            >
              {mode === 'dark' ? <Moon className="size-4" /> : <Sun className="size-4" />}
              {mode}
            </button>
          ))}
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <SectionTitle icon={<Radio className="size-4" />} title="Transfer behaviour" hint="How incoming content is handled on this device." />
        <div className="mt-3 divide-y divide-[color:var(--line)]">
          <Row
            title="Auto-receive files"
            description="Accept transfers from paired devices without a prompt. Turn off to approve every incoming file."
          >
            <Switch checked={settings.autoReceive} onChange={(next) => void updateSettings({ autoReceive: next })} label="Auto receive" />
          </Row>
          <Row title="Desktop notifications" description="Show a system notification when a transfer completes in the background.">
            <div className="flex items-center gap-2">
              {notifyState !== 'granted' ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    const permission = await Notification.requestPermission();
                    setNotifyState(permission);
                    await updateSettings({ notifications: permission === 'granted' });
                  }}
                >
                  <Bell className="size-3.5" /> Allow
                </Button>
              ) : null}
              <Switch
                checked={settings.notifications && notifyState === 'granted'}
                disabled={notifyState !== 'granted'}
                onChange={(next) => void updateSettings({ notifications: next })}
                label="Notifications"
              />
            </div>
          </Row>
          <Row title="History retention" description="Favorites are always kept. Older records beyond this limit are pruned automatically.">
            <select
              value={settings.historyLimit}
              onChange={(event) => void updateSettings({ historyLimit: Number(event.target.value) })}
              className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12.5px] outline-none focus:border-accent-line"
            >
              {[25, 50, 100, 250, 500].map((value) => (
                <option key={value} value={value}>
                  {value} records
                </option>
              ))}
            </select>
          </Row>
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <SectionTitle icon={<Radio className="size-4" />} title="Signaling relay" hint="The relay only brokers connection metadata; file bytes never touch it." />
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={relayState === 'online' ? 'ok' : 'err'}>{relayState}</Badge>
            <Badge tone={turnConfigured ? 'ok' : 'warn'}>{turnConfigured ? 'TURN relay available' : 'STUN only'}</Badge>
            <Badge>{devices.length} paired</Badge>
            <Button size="sm" variant="ghost" onClick={reconnectRelay}>
              <RefreshCw className="size-3.5" /> Reconnect
            </Button>
          </div>
          <label className="block space-y-1.5">
            <span className="text-[11.5px] font-medium text-fg-soft">Relay endpoint override</span>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={signal}
                onChange={(event) => setSignal(event.target.value)}
                placeholder={signalUrl || 'wss://signal.example.com/ws'}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-[12px] outline-none focus:border-accent-line"
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  await updateSettings({ signalUrlOverride: signal.trim() });
                  reconnectRelay();
                }}
              >
                <Save className="size-3.5" /> Apply
              </Button>
            </div>
            <span className="text-[11px] text-muted">Empty = use the endpoint baked into this deployment.</span>
          </label>
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <SectionTitle icon={<HardDrive className="size-4" />} title="Local storage" hint="Everything DROPZONE keeps lives in this browser profile." />
        <div className="mt-3 space-y-3">
          <div>
            <div className="flex items-center justify-between text-[12px] text-muted">
              <span>{formatBytes(usage.usage)} used</span>
              <span>{usage.quota ? `of ${formatBytes(usage.quota)} available` : 'quota unknown'}</span>
            </div>
            <ProgressBar value={usage.quota ? usage.usage / usage.quota : 0} className="mt-2" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                const granted = await requestPersistentStorage();
                setUsage(await storageUsage());
                if (!granted) alert('The browser did not grant persistent storage. Data may be evicted under pressure.');
              }}
            >
              <ShieldCheck className="size-3.5" /> {usage.persisted ? 'Storage is persistent' : 'Request persistence'}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                const snapshot = await exportSnapshot();
                downloadBlob(new Blob([snapshot], { type: 'application/json' }), `dropzone-export-${new Date().toISOString().slice(0, 10)}.json`);
              }}
            >
              <Download className="size-3.5" /> Export data
            </Button>
            <Button size="sm" variant="danger" onClick={() => setConfirmClear(true)}>
              <Trash2 className="size-3.5" /> Clear history
            </Button>
          </div>
          <p className="text-[11px] leading-relaxed text-muted">
            Export contains device records, transfer metadata and received text — never private keys.
          </p>
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <SectionTitle icon={<Info className="size-4" />} title="About" hint="DROPZONE — Your Personal Transfer Space." />
        <div className="mt-3 grid gap-2 text-[12.5px] text-muted sm:grid-cols-2">
          <p>Version <span className="font-mono text-fg-soft">{APP_VERSION}</span></p>
          <p>License <span className="font-mono text-fg-soft">MIT</span></p>
          <p>
            Source{' '}
            <a className="text-accent hover:underline" href={REPO_URL} target="_blank" rel="noreferrer noopener">
              github.com/iiiiiiiiiiiiiKK/dropzone
            </a>
          </p>
          <p>
            Author{' '}
            <a className="text-accent hover:underline" href={AUTHOR_X_URL} target="_blank" rel="noreferrer noopener">
              𝕏 @0xkillcoin
            </a>
          </p>
        </div>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 rounded-xl border border-line bg-surface-2/40 px-3 py-2 text-[11.5px] leading-relaxed text-muted">
          No accounts, no analytics, no cloud storage. The signaling relay sees device IDs, display names and SDP/ICE metadata —
          never file names, file contents or clipboard text.
        </motion.p>
      </Card>

      <Dialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Delete local history?"
        description="Transfers, cached file blobs and received text will be removed from this browser. This cannot be undone."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={async () => {
                await clearHistory();
                setConfirmClear(false);
                setUsage(await storageUsage());
              }}
            >
              <Trash2 className="size-4" /> Delete everything
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-muted">{transfers.length} transfer records and {devices.length} device links will stay, only the transfer data is removed.</p>
      </Dialog>
    </div>
  );
}

function SectionTitle({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 grid size-7 place-items-center rounded-lg border border-line bg-surface-2 text-accent">{icon}</span>
      <div>
        <h2 className="text-[13.5px] font-semibold">{title}</h2>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{hint}</p>
      </div>
    </div>
  );
}

function Row({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-[12.5px] font-medium text-fg">{title}</p>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{description}</p>
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  );
}
