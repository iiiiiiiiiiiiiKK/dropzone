import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AppProvider } from './state/app';
import { ToastProvider } from './components/Toasts';
import { applyTheme, initialTheme } from './lib/theme';
import './styles.css';

applyTheme(initialTheme());

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

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const registerShell = () => void navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  if (document.readyState === 'complete') registerShell();
  else window.addEventListener('load', registerShell, { once: true });
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
