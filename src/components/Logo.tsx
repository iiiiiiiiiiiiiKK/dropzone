import { t } from '../lib/i18n';
import { cn } from '../lib/utils';

/**
 * DROPZONE mark: a rounded graphite tile with a violet→cyan gradient "drop"
 * landing into an open tray. Drawn as vectors so it stays crisp at 16 px and 512 px.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-[11px] border border-white/10 bg-[#0b0c10] shadow-[0_10px_26px_-14px_var(--accent)]',
        className,
      )}
    >
      <span className="absolute inset-0 opacity-30 accent-gradient" />
      <span className="absolute inset-0 bg-[radial-gradient(circle_at_28%_16%,rgba(255,255,255,0.22),transparent_58%)]" />
      <svg viewBox="0 0 32 32" className="relative size-[62%]" fill="none" aria-hidden>
        <defs>
          <linearGradient id="dzg" x1="7" y1="5" x2="26" y2="27" gradientUnits="userSpaceOnUse">
            <stop stopColor="#d8cfff" />
            <stop offset="0.55" stopColor="#a99bff" />
            <stop offset="1" stopColor="#7fdcff" />
          </linearGradient>
        </defs>
        <path d="M16 6.4c0 4.2-4.6 6-4.6 9.9a4.6 4.6 0 0 0 9.2 0c0-3.9-4.6-5.7-4.6-9.9Z" fill="url(#dzg)" opacity="0.95" />
        <path d="M8.2 22.4h15.6" stroke="url(#dzg)" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M11 25.8h10" stroke="url(#dzg)" strokeWidth="2.2" strokeLinecap="round" opacity="0.55" />
      </svg>
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <LogoMark />
      <div className="leading-none">
        <p className="text-[15px] font-semibold tracking-[0.14em] text-fg">DROPZONE</p>
        <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.18em] text-muted">{t('brand.tagline')}</p>
      </div>
    </div>
  );
}
