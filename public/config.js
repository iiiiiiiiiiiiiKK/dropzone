/*
 * Runtime configuration for DROPZONE.
 * This file is served next to index.html and read before the app boots, so a
 * self-hosted deployment can point at its own relay without rebuilding.
 *
 *   window.__DROPZONE_CONFIG__ = { signalUrl: "wss://signal.example.com/ws" };
 *
 * Leaving signalUrl unset makes the app fall back to:
 *   1. VITE_SIGNAL_URL baked in at build time
 *   2. wss://<current-host>/ws
 *   3. "offline" when the page is opened from file:// or without a relay
 */
window.__DROPZONE_CONFIG__ = {
  // signalUrl: "wss://dropzone-signal.example.workers.dev/ws",
  // stunUrls: ["stun:stun.cloudflare.com:3478"],
};
