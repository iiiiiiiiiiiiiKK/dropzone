const enabled =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug');

/** Opt-in tracing: append ?debug=1 to the URL to see relay and WebRTC activity. */
export function trace(scope: string, ...args: unknown[]): void {
  if (!enabled) return;
  console.info('[dropzone:' + scope + ']', ...args);
}
