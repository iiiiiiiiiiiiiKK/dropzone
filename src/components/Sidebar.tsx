import { motion } from 'framer-motion';
import { Clock3, LayoutGrid, Settings, Smartphone, Star, Wifi, WifiOff, Zap } from 'lucide-react';
import { AUTHOR_X_URL } from '../lib/constants';
import { cn } from '../lib/utils';
import { useApp } from '../state/app';
import { LogoMark } from './Logo';
import { StatusDot } from './ui';

export type ViewKey = 'workspace' | 'history' | 'favorites' | 'devices' | 'settings';

const NAV: Array<{ key: ViewKey; label: string; icon: typeof LayoutGrid }> = [
  { key: 'workspace', label: 'Workspace', icon: LayoutGrid },
  { key: 'history', label: 'Recent transfers', icon: Clock3 },
  { key: 'favorites', label: 'Favorites', icon: Star },
  { key: 'devices', label: 'My devices', icon: Smartphone },
  { key: 'settings', label: 'Settings', icon: Settings },
];

export function Sidebar({ view, onNavigate }: { view: ViewKey; onNavigate: (view: ViewKey) => void }) {
  const { relayState, devices, settings, paths, peers } = useApp();
  const online = peers.filter((peer) => peer.online).length;
  const relayed = Object.values(paths).filter((path) => path === 'relay').length;

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[266px] flex-col border-r border-line bg-bg-elev/60 px-4 pb-4 pt-5 backdrop-blur-xl lg:flex">
      <div className="flex items-center gap-2.5 px-2">
        <LogoMark />
        <div className="leading-none">
          <p className="text-[14px] font-semibold tracking-[0.16em]">DROPZONE</p>
          <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.18em] text-muted">Your transfer space</p>
        </div>
      </div>

      <nav className="mt-7 flex flex-col gap-1">
        {NAV.map((item) => {
          const active = view === item.key;
          return (
            <button
              key={item.key}
              onClick={() => onNavigate(item.key)}
              className={cn(
                'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-medium transition-colors',
                active ? 'text-fg' : 'text-muted hover:bg-surface-2/70 hover:text-fg',
              )}
            >
              {active ? (
                <motion.span
                  layoutId="sidebar-active"
                  transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                  className="absolute inset-0 rounded-xl border border-line bg-surface-2"
                />
              ) : null}
              <item.icon className={cn('relative size-[17px]', active ? 'text-accent' : 'text-muted group-hover:text-fg-soft')} />
              <span className="relative">{item.label}</span>
              {item.key === 'devices' && devices.length > 0 ? (
                <span className="relative ml-auto rounded-full bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-fg-soft">{devices.length}</span>
              ) : null}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto space-y-3">
        <div className="rounded-2xl border border-line bg-surface/60 p-3.5">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Relay</p>
            <StatusDot tone={relayState === 'online' ? 'ok' : relayState === 'connecting' || relayState === 'reconnecting' ? 'warn' : 'err'} pulse={relayState === 'online'} />
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-fg-soft">
            {relayState === 'online' ? <Wifi className="size-3.5 text-ok" /> : <WifiOff className="size-3.5 text-muted" />}
            {relayState === 'online' ? 'Signaling connected' : relayState === 'connecting' ? 'Connecting…' : relayState === 'reconnecting' ? 'Reconnecting…' : 'Offline'}
          </p>
          <p className="mt-1 text-[11.5px] text-muted">
            {online} of {devices.length} devices online{relayed > 0 ? ` · ${relayed} relayed` : ''}
          </p>
        </div>

        <div className="flex items-center justify-between rounded-2xl border border-line bg-surface/40 px-3.5 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-[12.5px] font-medium">{settings.deviceName || 'This device'}</p>
            <p className="text-[11px] text-muted">Local-first by design</p>
          </div>
          <a
            href={AUTHOR_X_URL}
            target="_blank"
            rel="noreferrer noopener"
            title="@0xkillcoin on X"
            className="grid size-8 place-items-center rounded-lg border border-line text-fg-soft transition-colors hover:border-accent-line hover:text-fg"
          >
            <Zap className="size-3.5" />
          </a>
        </div>
      </div>
    </aside>
  );
}
