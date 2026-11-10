import { AnimatePresence, motion } from 'framer-motion';
import { Check, Loader2, X } from 'lucide-react';
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/utils';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type ButtonSize = 'sm' | 'md' | 'lg';

const buttonBase =
  'relative inline-flex items-center justify-center gap-2 font-medium transition-all duration-200 select-none whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-45 active:translate-y-[0.5px]';

const variants: Record<ButtonVariant, string> = {
  primary:
    'accent-gradient text-white shadow-[0_10px_30px_-12px_var(--accent)] hover:shadow-[0_16px_40px_-14px_var(--accent)] hover:brightness-110',
  secondary: 'bg-surface-2 text-fg border border-line hover:bg-surface-3 hover:border-line-strong',
  ghost: 'text-fg-soft hover:bg-surface-2 hover:text-fg',
  danger: 'bg-err/12 text-err border border-err/30 hover:bg-err/20',
  outline: 'border border-line-strong text-fg hover:bg-surface-2',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] rounded-lg',
  md: 'h-10 px-4 text-sm rounded-xl',
  lg: 'h-12 px-6 text-[15px] rounded-xl',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean }) {
  return (
    <button
      className={cn(buttonBase, variants[variant], sizes[size], className)}
      {...props}
      disabled={props.disabled || loading}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  className,
  label,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cn(
        'inline-grid size-9 place-items-center rounded-xl border border-transparent text-muted transition-colors hover:border-line hover:bg-surface-2 hover:text-fg',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-[20px] border border-line bg-surface/70 card-shadow backdrop-blur-sm', className)} {...rest}>
      {children}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'err';
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-surface-2 text-fg-soft border-line',
    accent: 'bg-accent-soft text-accent border-accent-line',
    ok: 'bg-ok/12 text-ok border-ok/30',
    warn: 'bg-warn/12 text-warn border-warn/30',
    err: 'bg-err/12 text-err border-err/30',
  };
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-wide', tones[tone], className)}>
      {children}
    </span>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-200',
        checked ? 'accent-gradient border-transparent' : 'border-line-strong bg-surface-3',
        disabled && 'opacity-50',
      )}
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 500, damping: 32 }}
        className={cn('absolute top-0.5 size-4.5 rounded-full bg-white shadow-sm', checked ? 'left-[22px]' : 'left-0.5')}
      />
    </button>
  );
}

export function ProgressBar({ value, tone = 'accent', className }: { value: number; tone?: 'accent' | 'ok' | 'err'; className?: string }) {
  const tones = { accent: 'accent-gradient', ok: 'bg-ok', err: 'bg-err' };
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)}>
      <div
        className={cn('h-full rounded-full transition-[width] duration-300 ease-out', tones[tone])}
        style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }}
      />
    </div>
  );
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' };

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
          <motion.div
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            className={cn(
              'relative z-10 w-full overflow-hidden rounded-t-[24px] border border-line bg-bg-elev/95 pop-shadow backdrop-blur-xl sm:rounded-[24px]',
              widths[size],
            )}
          >
            <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
              <div>
                <h2 id={titleId} className="text-[15px] font-semibold tracking-tight">
                  {title}
                </h2>
                {description ? <p className="mt-1 text-[13px] leading-relaxed text-muted">{description}</p> : null}
              </div>
              <IconButton label="Close dialog" onClick={onClose} className="-mr-1 -mt-1">
                <X className="size-4" />
              </IconButton>
            </div>
            <div className="max-h-[70vh] overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
            {footer ? <div className="flex items-center justify-end gap-2 border-t border-line bg-surface/40 px-5 py-3.5 sm:px-6">{footer}</div> : null}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin text-muted', className)} aria-hidden />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line px-6 py-12 text-center', className)}>
      <div className="grid size-11 place-items-center rounded-2xl border border-line bg-surface-2 text-muted">{icon}</div>
      <div>
        <p className="text-sm font-medium text-fg">{title}</p>
        {description ? <p className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-[6px] border border-line-strong bg-surface-2 px-1.5 font-mono text-[10px] font-medium text-fg-soft">
      {children}
    </kbd>
  );
}

export function StatusDot({ tone, pulse = false }: { tone: 'ok' | 'warn' | 'err' | 'muted'; pulse?: boolean }) {
  const tones = { ok: 'bg-ok', warn: 'bg-warn', err: 'bg-err', muted: 'bg-muted' };
  return (
    <span className="relative inline-flex size-2">
      {pulse ? <span className={cn('absolute inline-flex size-2 animate-ping rounded-full opacity-60', tones[tone])} /> : null}
      <span className={cn('relative inline-flex size-2 rounded-full', tones[tone])} />
    </span>
  );
}

export function CheckLine({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-[13px] leading-relaxed text-fg-soft">
      <Check className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
      <span>{children}</span>
    </li>
  );
}
