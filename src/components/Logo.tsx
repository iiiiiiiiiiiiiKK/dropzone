import { cn } from '../lib/utils';

export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'relative grid size-9 place-items-center overflow-hidden rounded-[11px] border border-white/10 bg-[#0d0e11] shadow-[0_8px_24px_-12px_var(--accent)]',
        className,
      )}
    >
      <span className="absolute inset-0 opacity-25 accent-gradient" />
      <svg viewBox="0 0 24 24" className="relative size-5" fill="none" aria-hidden>
        <path d="M12 4.5v9.5" stroke="url(#dz-mark)" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M8 10.5l4 4 4-4" stroke="url(#dz-mark)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6.5 17.5h11" stroke="url(#dz-mark)" strokeWidth="2.4" strokeLinecap="round" />
        <defs>
          <linearGradient id="dz-mark" x1="4" y1="4" x2="20" y2="20" gradientUnits="userSpaceOnUse">
            <stop stopColor="#c7bcff" />
            <stop offset="1" stopColor="#8fd0ff" />
          </linearGradient>
        </defs>
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
        <p className="mt-1 text-[10px] font-medium tracking-[0.18em] text-muted uppercase">Transfer space</p>
      </div>
    </div>
  );
}
