import { Clock3, LayoutGrid, Settings, Smartphone, Star } from 'lucide-react';
import { t } from '../lib/i18n';
import type { ViewKey } from './Sidebar';
import { cn } from '../lib/utils';

const ITEMS: Array<{ key: ViewKey; labelKey: string; icon: typeof LayoutGrid }> = [
  { key: 'workspace', labelKey: 'nav.mobileSend', icon: LayoutGrid },
  { key: 'history', labelKey: 'nav.mobileHistory', icon: Clock3 },
  { key: 'favorites', labelKey: 'nav.mobileSaved', icon: Star },
  { key: 'devices', labelKey: 'nav.mobileDevices', icon: Smartphone },
  { key: 'settings', labelKey: 'nav.mobileSettings', icon: Settings },
];

export function MobileNav({ view, onNavigate }: { view: ViewKey; onNavigate: (view: ViewKey) => void }) {
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg-elev/90 backdrop-blur-xl lg:hidden">
      <div className="mx-auto grid max-w-md grid-cols-5">
        {ITEMS.map((item) => {
          const active = view === item.key;
          return (
            <button
              key={item.key}
              onClick={() => onNavigate(item.key)}
              aria-current={active ? 'page' : undefined}
              className={cn('flex flex-col items-center gap-1 px-1 pb-1.5 pt-2.5 text-[10.5px] font-medium transition-colors', active ? 'text-accent' : 'text-muted')}
            >
              <span className={cn('grid size-9 place-items-center rounded-xl transition-colors', active ? 'bg-accent-soft' : '')}>
                <item.icon className="size-[18px]" />
              </span>
              {t(item.labelKey)}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
