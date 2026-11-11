import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AppProvider } from './state/app';
import { ToastProvider } from './components/Toasts';
import { applyTheme, initialTheme } from './lib/theme';
import './styles.css';

applyTheme(initialTheme());

/** Last-resort UI so a runtime error never leaves an iOS PWA on a white screen. */
function showFatal(message: string): void {
  const host = document.getElementById('root') ?? document.body;
  if (host.querySelector('[data-fatal]')) return;
  const box = document.createElement('div');
  box.setAttribute('data-fatal', '');
  box.style.cssText =
    'min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0b0d;color:#eceef2';
  box.innerHTML =
    '<div style="font-size:15px;font-weight:600">DROPZONE 无法启动 · Could not start</div>' +
    '<div style="max-width:22rem;color:#868d9b">' +
    message.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] as string) +
    '</div>';
  const reload = document.createElement('button');
  reload.textContent = '重新加载 · Reload';
  reload.style.cssText = 'height:38px;padding:0 18px;border-radius:12px;border:1px solid #2a2b33;background:#17181d;color:#eceef2;font:inherit';
  reload.onclick = async () => {
    try {
      const regs = await navigator.serviceWorker?.getRegistrations?.();
      await Promise.all((regs ?? []).map((reg) => reg.unregister()));
      const keys = await caches?.keys?.();
      await Promise.all((keys ?? []).map((key) => caches.delete(key)));
    } catch {
      /* ignore */
    }
    location.reload();
  };
  box.appendChild(reload);
  host.appendChild(box);
}

window.addEventListener('error', (event) => {
  if (document.getElementById('root')?.childElementCount === 0) {
    showFatal((event.error && (event.error as Error).message) || 'Unknown error');
  }
});
window.addEventListener('unhandledrejection', (event) => {
  if (document.getElementById('root')?.childElementCount === 0) {
    const reason = event.reason as Error | string | undefined;
    showFatal(typeof reason === 'string' ? reason : reason?.message || 'Unhandled rejection');
  }
});

async function bootstrap(): Promise<void> {
  // Runtime configuration is resolved before React mounts so a self-hosted
  // deployment can point at its own relay without a rebuild.
  try {
    const response = await fetch('./config.json', { cache: 'no-store' });
    if (response.ok) {
      const config = (await response.json()) as Record<string, unknown>;
      const signalUrl = typeof config.signalUrl === 'string' && config.signalUrl.trim() ? config.signalUrl.trim() : undefined;
      const stunUrls = Array.isArray(config.stunUrls) ? (config.stunUrls as unknown[]).filter((entry): entry is string => typeof entry === 'string') : undefined;
      window.__DROPZONE_CONFIG__ = { ...(signalUrl ? { signalUrl } : {}), ...(stunUrls && stunUrls.length ? { stunUrls } : {}) };
    }
  } catch {
    /* config.json is optional */
  }

  const container = document.getElementById('root');
  if (!container) throw new Error('Root element is missing');

  createRoot(container).render(
    <StrictMode>
      <ToastProvider>
        <AppProvider>
          <App />
        </AppProvider>
      </ToastProvider>
    </StrictMode>,
  );
}

void bootstrap().catch((error: unknown) => {
  showFatal(error instanceof Error ? error.message : String(error));
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const registerShell = () => {
    void navigator.serviceWorker
      .register('./sw.js', { updateViaCache: 'none' })
      .then((registration) => {
        // A new worker taking over means stale shell code; reload once, quietly.
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          worker?.addEventListener('statechange', () => {
            if (worker.state === 'activated' && navigator.serviceWorker.controller) {
              registration.waiting?.postMessage('skip-waiting');
            }
          });
        });
      })
      .catch(() => undefined);
  };
  if (document.readyState === 'complete') registerShell();
  else window.addEventListener('load', registerShell, { once: true });
}
