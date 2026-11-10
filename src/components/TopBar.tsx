import { ArrowUpRight, Monitor, Moon, RefreshCw, Smartphone, Sun, Tablet } from 'lucide-react';
import type { ReactNode } from 'react';
import { AUTHOR_X_URL } from '../lib/constants';
import { cn } from '../lib/utils';
import { useApp } from '../state/app';
import { LogoMark } from './Logo';
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
      title="Author on X — @0xkillcoin"
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
  const { settings, theme, setTheme, relayState, deviceType, reconnectRelay, peers } = useApp();
  const online = peers.filter((peer) => peer.online).length;

  return (
    <header className="safe-top sticky top-0 z-20 border-b border-line bg-bg/75 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center gap-3 px-4 sm:px-6">
        <div className="flex items-center gap-2.5 lg:hidden">
          <LogoMark className="size-8" />
        </div>

        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-semibold tracking-tight sm:text-base">{title}</h1>
          {subtitle ? <p className="hidden truncate text-[12px] text-muted sm:block">{subtitle}</p> : null}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => onNavigate?.('devices')}
            className="hidden items-center gap-2 rounded-xl border border-line bg-surface/70 px-2.5 py-1.5 text-[12.5px] text-fg-soft transition-colors hover:bg-surface-2 hover:text-fg sm:inline-flex"
          >
            <DeviceIcon type={deviceType} className="size-3.5 text-muted" />
            <span className="max-w-[150px] truncate">{settings.deviceName || 'This device'}</span>
            <span className="h-3 w-px bg-line-strong" />
            <StatusDot tone={online > 0 ? 'ok' : 'muted'} />
            <span className="tabular-nums">{online} online</span>
          </button>

          <button
            onClick={reconnectRelay}
            title={relayState === 'online' ? 'Relay connected' : 'Reconnect relay'}
            aria-label="Reconnect relay"
            className="hidden items-center gap-1.5 rounded-xl border border-line bg-surface/70 px-2.5 py-1.5 text-[12px] text-muted transition-colors hover:bg-surface-2 hover:text-fg md:inline-flex"
          >
            <StatusDot tone={relayState === 'online' ? 'ok' : relayState === 'connecting' || relayState === 'reconnecting' ? 'warn' : 'err'} pulse={relayState === 'online'} />
            <span className="capitalize">{relayState === 'online' ? 'Relay' : relayState}</span>
            <RefreshCw className="size-3 opacity-50" />
          </button>

          {actions}

          <XBadge className="hidden sm:inline-flex" />

          <IconButton label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </IconButton>
        </div>
      </div>
    </header>
  );
}
