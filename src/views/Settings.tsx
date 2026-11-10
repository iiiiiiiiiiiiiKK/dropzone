import { motion } from 'framer-motion';
import { Bell, Download, HardDrive, Info, Languages, Moon, Radio, RefreshCw, Save, ShieldCheck, Sun, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { APP_VERSION, AUTHOR_X_URL, REPO_URL } from '../lib/constants';
import { exportSnapshot, requestPersistentStorage, storageUsage } from '../lib/db';
import { setLanguage, t, useLanguage } from '../lib/i18n';
import { downloadBlob, formatBytes } from '../lib/utils';
import { useApp } from '../state/app';
import { Badge, Button, Card, Dialog, ProgressBar, Switch } from '../components/ui';

export function Settings() {
  const { settings, updateSettings, theme, setTheme, signalUrl, relayState, turnConfigured, devices, transfers, clearHistory, reconnectRelay } = useApp();
  const lang = useLanguage();
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
        <SectionTitle icon={<Sun className="size-4" />} title={t('set.appearance')} hint={t('set.appearanceHint')} />
        <div className="mt-3 grid grid-cols-2 gap-2 sm:max-w-sm">
          {(['dark', 'light'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => {
                setTheme(mode);
                void updateSettings({ theme: mode });
              }}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-[13px] font-medium transition-colors ${
                theme === mode ? 'border-accent-line bg-accent-soft text-fg' : 'border-line bg-surface-2/50 text-muted hover:text-fg'
              }`}
            >
              {mode === 'dark' ? <Moon className="size-4" /> : <Sun className="size-4" />}
              {t(mode === 'dark' ? 'set.dark' : 'set.light')}
            </button>
          ))}
        </div>

        <div className="mt-4 border-t border-line pt-3.5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-1.5 text-[12.5px] font-medium">
                <Languages className="size-3.5 text-accent" /> {t('set.language')}
              </p>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{t('set.languageHint')}</p>
            </div>
            <div className="flex shrink-0 overflow-hidden rounded-lg border border-line">
              {(
                [
                  { key: 'en', label: 'English' },
                  { key: 'zh', label: '简体中文' },
                ] as const
              ).map((option) => (
                <button
                  key={option.key}
                  onClick={() => {
                    setLanguage(option.key);
                    void updateSettings({ language: option.key });
                  }}
                  className={`px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
                    lang === option.key ? 'bg-accent-soft text-accent' : 'text-muted hover:text-fg'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <SectionTitle icon={<Radio className="size-4" />} title={t('set.behaviour')} hint={t('set.behaviourHint')} />
        <div className="mt-3 divide-y divide-[color:var(--line)]">
          <Row title={t('set.autoReceive')} description={t('set.autoReceiveDesc')}>
            <Switch checked={settings.autoReceive} onChange={(next) => void updateSettings({ autoReceive: next })} label={t('set.autoReceive')} />
          </Row>
          <Row title={t('set.notifications')} description={t('set.notificationsDesc')}>
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
                  <Bell className="size-3.5" /> {t('set.allow')}
                </Button>
              ) : null}
              <Switch
                checked={settings.notifications && notifyState === 'granted'}
                disabled={notifyState !== 'granted'}
                onChange={(next) => void updateSettings({ notifications: next })}
                label={t('set.notifications')}
              />
            </div>
          </Row>
          <Row title={t('set.retention')} description={t('set.retentionDesc')}>
            <select
              value={settings.historyLimit}
              onChange={(event) => void updateSettings({ historyLimit: Number(event.target.value) })}
              className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12.5px] outline-none focus:border-accent-line"
            >
              {[25, 50, 100, 250, 500].map((value) => (
                <option key={value} value={value}>
                  {t('set.records', { n: value })}
                </option>
              ))}
            </select>
          </Row>
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <SectionTitle icon={<Radio className="size-4" />} title={t('set.relay')} hint={t('set.relayHint')} />
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={relayState === 'online' ? 'ok' : 'err'}>
              {relayState === 'online' ? t('status.online') : relayState === 'connecting' ? t('status.connecting') : relayState === 'reconnecting' ? t('status.reconnecting') : t('status.offline')}
            </Badge>
            <Badge tone={turnConfigured ? 'ok' : 'warn'}>{turnConfigured ? t('set.turnAvailable') : t('set.stunOnly')}</Badge>
            <Badge>{t('set.pairedCount', { n: devices.length })}</Badge>
            <Button size="sm" variant="ghost" onClick={reconnectRelay}>
              <RefreshCw className="size-3.5" /> {t('set.reconnect')}
            </Button>
          </div>
          <label className="block space-y-1.5">
            <span className="text-[11.5px] font-medium text-fg-soft">{t('set.endpoint')}</span>
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
                <Save className="size-3.5" /> {t('set.apply')}
              </Button>
            </div>
            <span className="text-[11px] text-muted">{t('set.endpointHint')}</span>
          </label>
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <SectionTitle icon={<HardDrive className="size-4" />} title={t('set.storage')} hint={t('set.storageHint')} />
        <div className="mt-3 space-y-3">
          <div>
            <div className="flex items-center justify-between text-[12px] text-muted">
              <span>{t('set.used', { size: formatBytes(usage.usage) })}</span>
              <span>{usage.quota ? t('set.ofQuota', { size: formatBytes(usage.quota) }) : t('set.quotaUnknown')}</span>
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
                if (!granted) alert(t('toast.storageDenied'));
              }}
            >
              <ShieldCheck className="size-3.5" /> {usage.persisted ? t('set.persist') : t('set.requestPersist')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                const snapshot = await exportSnapshot();
                downloadBlob(new Blob([snapshot], { type: 'application/json' }), `dropzone-export-${new Date().toISOString().slice(0, 10)}.json`);
              }}
            >
              <Download className="size-3.5" /> {t('set.export')}
            </Button>
            <Button size="sm" variant="danger" onClick={() => setConfirmClear(true)}>
              <Trash2 className="size-3.5" /> {t('set.clearHistory')}
            </Button>
          </div>
          <p className="text-[11px] leading-relaxed text-muted">{t('set.exportNote')}</p>
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <SectionTitle icon={<Info className="size-4" />} title={t('set.about')} hint={t('set.aboutHint')} />
        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <AboutTile label={t('set.version')} value={APP_VERSION} mono />
          <AboutTile label={t('set.license')} value="MIT" mono />
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="group rounded-xl border border-line bg-surface-2/40 px-3 py-2 transition-colors hover:border-accent-line hover:bg-surface-2"
          >
            <dt className="text-[10.5px] uppercase tracking-[0.12em] text-muted">{t('set.source')}</dt>
            <dd className="mt-0.5 truncate text-[12px] font-medium text-fg-soft group-hover:text-accent">GitHub</dd>
          </a>
          <a
            href={AUTHOR_X_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="group rounded-xl border border-line bg-surface-2/40 px-3 py-2 transition-colors hover:border-accent-line hover:bg-surface-2"
          >
            <dt className="text-[10.5px] uppercase tracking-[0.12em] text-muted">{t('set.author')}</dt>
            <dd className="mt-0.5 truncate text-[12px] font-medium text-fg-soft group-hover:text-accent">𝕏 @0xkillcoin</dd>
          </a>
        </dl>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 rounded-xl border border-line bg-surface-2/40 px-3 py-2 text-[11.5px] leading-relaxed text-muted">
          {t('set.privacyNote')}
        </motion.p>
      </Card>

      <Dialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title={t('set.clearTitle')}
        description={t('set.clearDesc')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>{t('dev.keep')}</Button>
            <Button
              variant="danger"
              onClick={async () => {
                await clearHistory();
                setConfirmClear(false);
                setUsage(await storageUsage());
              }}
            >
              <Trash2 className="size-4" /> {t('set.delete')}
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-muted">{t('set.clearBody', { n: transfers.length, m: devices.length })}</p>
      </Dialog>
    </div>
  );
}

function AboutTile({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2/40 px-3 py-2">
      <dt className="text-[10.5px] uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd className={`mt-0.5 truncate text-[12px] font-medium text-fg-soft ${mono ? 'font-mono' : ''}`}>{value}</dd>
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
    <div className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
      <div className="min-w-0">
        <p className="text-[12.5px] font-medium text-fg">{title}</p>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{description}</p>
      </div>
      <div className="shrink-0 self-start pt-0.5 sm:self-auto">{children}</div>
    </div>
  );
}
