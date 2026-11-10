import { useCallback, useEffect, useMemo, useState } from 'react';
import { decodeInvite, inviteIsExpired, type PairInvite } from './lib/pairing';
import { ingestClipboardEvent } from './lib/clipboard';
import { t, useLanguage } from './lib/i18n';
import { useApp } from './state/app';
import { MobileNav } from './components/MobileNav';
import { Sidebar, type ViewKey } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { PairingDialog } from './components/PairingDialog';
import { IncomingDialog } from './components/IncomingDialog';
import { useToasts } from './components/Toasts';
import { Workspace } from './views/Workspace';
import { History } from './views/History';
import { Devices } from './views/Devices';
import { Settings } from './views/Settings';

const VIEW_META: Record<ViewKey, { title: string; subtitle: string }> = {
  workspace: { title: 'view.workspace.title', subtitle: 'view.workspace.sub' },
  history: { title: 'view.history.title', subtitle: 'view.history.sub' },
  favorites: { title: 'view.favorites.title', subtitle: 'view.favorites.sub' },
  devices: { title: 'view.devices.title', subtitle: 'view.devices.sub' },
  settings: { title: 'view.settings.title', subtitle: 'view.settings.sub' },
};

const VALID_VIEWS: ViewKey[] = ['workspace', 'history', 'favorites', 'devices', 'settings'];

function parseRoute(): { view: ViewKey; invite?: PairInvite } {
  const hash = window.location.hash.replace(/^#\/?/, '');
  if (hash.startsWith('pair?')) {
    const invite = decodeInvite(hash);
    return { view: 'workspace', invite: invite && !inviteIsExpired(invite) ? invite : undefined };
  }
  const view = (hash.split('?')[0] ?? '') as ViewKey;
  return { view: VALID_VIEWS.includes(view) ? view : 'workspace' };
}

export default function App() {
  const { ready, addFiles, devices } = useApp();
  const toasts = useToasts();
  useLanguage();
  const [route, setRoute] = useState(() => parseRoute());
  const [pairing, setPairing] = useState<{ open: boolean; invite?: PairInvite | null }>({ open: false });

  useEffect(() => {
    const onHash = () => setRoute(parseRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (route.invite) {
      setPairing({ open: true, invite: route.invite });
      window.history.replaceState(null, '', window.location.pathname + window.location.search + '#/workspace');
    }
  }, [route.invite]);

  const navigate = useCallback((view: ViewKey) => {
    window.location.hash = `#/${view}`;
    setRoute({ view });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const result = ingestClipboardEvent(event);
      if (result.files.length > 0) {
        event.preventDefault();
        void addFiles(result.files).then(() => {
          toasts.push({
            tone: 'success',
            title: result.files.length > 1 ? t('toast.stagedMany', { n: result.files.length }) : t('toast.stagedOne'),
            body: devices.length ? t('toast.stagedBodyDevices') : t('toast.stagedBodyNoDevice'),
          });
        });
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addFiles, devices.length, toasts]);

  const meta = VIEW_META[route.view];
  const content = useMemo(() => {
    switch (route.view) {
      case 'history':
        return <History />;
      case 'favorites':
        return <History favoritesOnly />;
      case 'devices':
        return <Devices onPair={() => setPairing({ open: true })} />;
      case 'settings':
        return <Settings />;
      case 'workspace':
      default:
        return <Workspace onNavigate={navigate} onPair={() => setPairing({ open: true })} />;
    }
  }, [route.view, navigate]);

  return (
    <div className="relative min-h-dvh bg-bg text-fg">
      <div className="ambient" aria-hidden />
      <div className="relative z-10 flex min-h-dvh">
        <Sidebar view={route.view} onNavigate={navigate} />
        <div className="flex min-w-0 flex-1 flex-col lg:pl-[266px]">
          <TopBar title={t(meta.title)} subtitle={t(meta.subtitle)} onNavigate={(view) => navigate(view)} />
          <main className="mx-auto w-full max-w-[1440px] flex-1 px-3 pb-28 pt-3 sm:px-6 sm:pt-5 lg:pb-10">
            {!ready ? <BootSkeleton /> : <div key={route.view} className="animate-in-up">{content}</div>}
          </main>
        </div>
      </div>
      <MobileNav view={route.view} onNavigate={navigate} />
      <PairingDialog open={pairing.open} initialInvite={pairing.invite ?? null} onClose={() => setPairing({ open: false })} />
      <IncomingDialog />
    </div>
  );
}

function BootSkeleton() {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_336px]">
      <div className="space-y-4">
        <div className="h-64 animate-pulse rounded-[24px] border border-line bg-surface/60" />
        <div className="h-40 animate-pulse rounded-[20px] border border-line bg-surface/50" />
      </div>
      <div className="hidden h-72 animate-pulse rounded-[20px] border border-line bg-surface/50 xl:block" />
    </div>
  );
}
