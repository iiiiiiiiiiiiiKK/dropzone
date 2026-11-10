import { ArrowUpRight, Camera, Languages, Monitor, Moon, RefreshCw, Smartphone, Sun, Tablet } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { AUTHOR_X_URL } from '../lib/constants';
import { pickFiles } from '../lib/clipboard';
import { setLanguage, t, useLanguage } from '../lib/i18n';
import { cn } from '../lib/utils';
import { useApp } from '../state/app';
import { LogoMark } from './Logo';
import { CaptureDialog } from './CaptureDialog';
import { IconButton, StatusDot } from './ui';

function DeviceIcon({ type, className }: { type: string; className?: string }) {
  const Icon = type === 'mobile' ? Smartphone : type === 'tablet' ? Tablet : Monitor;
  return <Icon className={className} />;
}

export function XBadge({ className }: { className?: string }) {
  return (
    <a
      href={AUTHOR_X_URL}
      target="_blank"
      rel="noreferrer noopener"
      title={t('top.author')}
      className={cn(
        'group inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-surface/70 px-2.5 text-[12.5px] font-medium text-fg-soft transition-all hover:border-accent-line hover:bg-surface-2 hover:text-fg',
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-3.5 fill-current" aria-hidden>
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
      <span className="hidden sm:inline">@0xkillcoin</span>
      <ArrowUpRight className="size-3 opacity-0 transition-opacity group-hover:opacity-70" />
    </a>
  );
}

export function TopBar({
  title,
  subtitle,
  onNavigate,
  actions,
}: {
  title: string;
  subtitle?: string;
  onNavigate?: (view: 'devices' | 'settings') => void;
  actions?: ReactNode;
}) {
  const { settings, theme, setTheme, relayState, deviceType, reconnectRelay, peers, updateSettings, addFiles } = useApp();
  const lang = useLanguage();
  const [captureOpen, setCaptureOpen] = useState(false);
  const online = peers.filter((peer) => peer.online).length;

  const relayLabel =
    relayState === 'online'
      ? t('top.relay')
      : relayState === 'connecting'
        ? t('status.connecting')
        : relayState === 'reconnecting'
          ? t('status.reconnecting')
          : relayState === 'error'
            ? t('status.error')
            : t('status.offline');

  const shoot = async () => {
    // Direct camera capture on touch devices, file picker elsewhere; both feed the queue.
    const files = await pickFiles({ accept: 'image/*', capture: navigator.maxTouchPoints > 0 });
    if (files.length) await addFiles(files);
  };

  return (
    <header className="safe-top sticky top-0 z-20 border-b border-line bg-bg/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 w-full max-w-[1440px] items-center gap-2 px-3 sm:h-16 sm:gap-3 sm:px-6">
        <div className="flex items-center gap-2 lg:hidden">
          <LogoMark className="size-8" />
        </div>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[14px] font-semibold tracking-tight sm:text-base">{title}</h1>
          {subtitle ? <p className="hidden truncate text-[12px] text-muted sm:block">{subtitle}</p> : null}
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          <button
            onClick={() => onNavigate?.('devices')}
            className="hidden items-center gap-2 rounded-xl border border-line bg-surface/70 px-2.5 py-1.5 text-[12.5px] text-fg-soft transition-colors hover:bg-surface-2 hover:text-fg md:inline-flex"
          >
            <DeviceIcon type={deviceType} className="size-3.5 text-muted" />
            <span className="max-w-[130px] truncate">{settings.deviceName || t('top.device')}</span>
            <span className="h-3 w-px bg-line-strong" />
            <StatusDot tone={online > 0 ? 'ok' : 'muted'} />
            <span className="tabular-nums">{t('top.online', { n: online })}</span>
          </button>

          <button
            onClick={reconnectRelay}
            title={relayState === 'online' ? t('status.online') : t('top.reconnect')}
            aria-label={t('top.reconnect')}
            className="hidden items-center gap-1.5 rounded-xl border border-line bg-surface/70 px-2.5 py-1.5 text-[12px] text-muted transition-colors hover:bg-surface-2 hover:text-fg lg:inline-flex"
          >
            <StatusDot tone={relayState === 'online' ? 'ok' : relayState === 'connecting' || relayState === 'reconnecting' ? 'warn' : 'err'} pulse={relayState === 'online'} />
            <span>{relayLabel}</span>
            <RefreshCw className="size-3 opacity-50" />
          </button>

          {actions}

          {/* one consistent 36px control rhythm across X / capture / language / theme */}
          <IconButton label={t('top.shoot')} onClick={shoot} className="size-9">
            <Camera className="size-[17px]" />
          </IconButton>

          <IconButton label={t('top.capture')} onClick={() => setCaptureOpen(true)} className="hidden size-9 sm:grid">
            <svg viewBox="0 0 24 24" className="size-[17px]" fill="none" aria-hidden>
              <rect x="3.2" y="4.6" width="17.6" height="13.2" rx="2.2" stroke="currentColor" strokeWidth="1.7" />
              <path d="M7.2 20.4h9.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              <path d="M7.4 9.2h4.2M7.4 12.2h6.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </IconButton>

          <IconButton label={t('top.lang')} onClick={() => {
            const next = lang === 'zh' ? 'en' : 'zh';
            setLanguage(next);
            void updateSettings({ language: next });
          }} className="size-9">
            <Languages className="size-[17px]" />
          </IconButton>

          <IconButton label={theme === 'dark' ? t('top.themeLight') : t('top.themeDark')} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="size-9">
            {theme === 'dark' ? <Sun className="size-[17px]" /> : <Moon className="size-[17px]" />}
          </IconButton>

          <XBadge className="ml-0.5 hidden h-9 lg:inline-flex" />
        </div>
      </div>
      <CaptureDialog open={captureOpen} onClose={() => setCaptureOpen(false)} />
    </header>
  );
}
