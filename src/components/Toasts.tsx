import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Info, TriangleAlert, XCircle, X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { cn } from '../lib/utils';

export type ToastTone = 'info' | 'success' | 'warn' | 'error';
export type Toast = { id: string; tone: ToastTone; title: string; body?: string };

type ToastContextValue = { push: (toast: Omit<Toast, 'id'>) => void };

const ToastContext = createContext<ToastContextValue>({ push: () => undefined });

export function useToasts(): ToastContextValue {
  return useContext(ToastContext);
}

const icons = {
  info: Info,
  success: CheckCircle2,
  warn: TriangleAlert,
  error: XCircle,
};

const tones: Record<ToastTone, string> = {
  info: 'text-accent-2',
  success: 'text-ok',
  warn: 'text-warn',
  error: 'text-err',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = Math.random().toString(36).slice(2);
      setToasts((current) => [...current.slice(-3), { ...toast, id }]);
      setTimeout(() => remove(id), 5200);
    },
    [remove],
  );

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 px-4 pb-[calc(env(safe-area-inset-bottom)+86px)] sm:inset-x-auto sm:right-6 sm:bottom-6 sm:items-end sm:pb-0">
        <AnimatePresence initial={false}>
          {toasts.map((toast) => {
            const Icon = icons[toast.tone];
            return (
              <motion.div
                key={toast.id}
                layout
                initial={{ opacity: 0, y: 12, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.97 }}
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border border-line bg-bg-elev/95 px-3.5 py-3 pop-shadow backdrop-blur-xl"
              >
                <Icon className={cn('mt-0.5 size-4 shrink-0', tones[toast.tone])} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-fg">{toast.title}</p>
                  {toast.body ? <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-muted">{toast.body}</p> : null}
                </div>
                <button
                  onClick={() => remove(toast.id)}
                  aria-label="Dismiss notification"
                  className="rounded-md p-1 text-muted transition-colors hover:bg-surface-2 hover:text-fg"
                >
                  <X className="size-3.5" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
