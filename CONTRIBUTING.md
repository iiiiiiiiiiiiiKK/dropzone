# Contributing to DROPZONE

Thanks for helping. The project is deliberately small: a static React SPA, a Node signaling relay, and a Cloudflare Worker variant of the same protocol. Keep changes proportional to that.

- [Development setup](#development-setup)
- [Branch and commit style](#branch-and-commit-style)
- [Code style](#code-style)
- [Testing the signaling service](#testing-the-signaling-service)
- [Testing the UI](#testing-the-ui)
- [Pull request checklist](#pull-request-checklist)
- [Never commit secrets](#never-commit-secrets)

## Development setup

Requirements: **Node.js >= 20.19**, **pnpm** through Corepack, and a current Chromium, Firefox or Safari for manual checks.

```sh
corepack enable
pnpm install

# terminal 1 — static app
pnpm dev          # http://127.0.0.1:5173

# terminal 2 — signaling relay
cp .env.example .env
pnpm dev:signal   # ws://127.0.0.1:8787
```

Two browser profiles (or one normal window plus a private window) are enough to exercise pairing and a transfer locally. IndexedDB is origin-scoped, so `http://127.0.0.1:5173` and `http://localhost:5173` are two independent devices — useful, and easy to confuse.

There is exactly one package manifest, at the repository root. Do not add nested installs.

## Branch and commit style

- Branch from `main`: `feat/<topic>`, `fix/<topic>`, `docs/<topic>`, `chore/<topic>`.
- [Conventional Commits](https://www.conventionalcommits.org/): `feat(transfer): resume from last acknowledged chunk`.
- Types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `chore`. Scopes: `web`, `signal`, `worker`, `transfer`, `pairing`, `docs`, `ci`.
- One logical change per commit; keep formatting churn out of behaviour commits.
- Explain *why* in the body when the diff does not make it obvious.
- Do not rewrite published history on `main`.

## Code style

**TypeScript and React**

- Strict TypeScript. No `any` in new code; if a boundary is genuinely untyped, isolate it and comment why.
- Function components with explicit prop types; hooks at the top level, never conditionally.
- Tailwind v4 utilities built on the tokens in `src/styles.css`. Dark is the default theme, light is the `.light` override; do not hard-code colours outside the token layer.
- Components stay presentational. Identity, networking, persistence and transfer logic live in `src/lib/`.
- Every async effect cleans up: abort controllers, `cancelAnimationFrame`, `URL.revokeObjectURL`, peer and data-channel teardown.
- User-visible copy is English and short enough for the mobile layout.

**Protocol and servers**

- `docs/protocol.md` is the contract. A frame-shape change updates the document in the same PR.
- Treat client input as hostile: bound sizes, validate shapes, fail closed, never echo unbounded data.
- Log lines must never contain file names, file bytes, pairing tokens, public keys of third parties, or TURN secrets.

**General**

- Two-space indentation, single quotes in TypeScript, semicolons on.
- No dead code, no commented-out blocks, no `console.log` left in `src/`.
- `pnpm typecheck` must pass before you request review.

## Testing the signaling service

Test the relay as a protocol peer, not through the UI.

```sh
pnpm typecheck
pnpm test          # node --test tests/*.test.mjs
pnpm dev:signal    # then poke it by hand if needed
```

Manual checks for any signaling change:

1. `GET /health` returns `{ status: "ok", ... }` with client and pairing counts.
2. `GET /turn` returns `null` when `TURN_URLS`/`TURN_SECRET` are unset, and `{ urls, username, credential, ttl }` when they are set.
3. `GET /config.json` advertises the expected `signalUrl` and `turnConfigured`.
4. A pairing invitation is single-use: replaying the same token errors instead of pairing twice.
5. A frame larger than `MAX_SIGNAL_BYTES` closes the socket instead of being buffered.
6. A socket that never sends `hello` is closed after `HELLO_TIMEOUT_MS`.
7. `signal` frames only travel between devices that are actually paired.

## Testing the UI

Two peers on loopback cover most work. Cross-network testing needs a public `wss://` endpoint and, for strict NATs, TURN.

```sh
pnpm build      # tsc --noEmit + vite build, must stay green
pnpm preview    # serve dist/ and confirm relative asset paths
```

Checklist for a UI or transfer change:

- [ ] Desktop at 1280 px and 1920 px: workspace, history, devices, settings, sidebar, device rail.
- [ ] Mobile at 375×667 and 390×844: bottom navigation, safe-area insets, no horizontal scroll.
- [ ] Dark and light theme both legible.
- [ ] Ctrl/⌘+V with one image, then with three images at once; original bytes preserved.
- [ ] Drag & drop a multi-file selection; cancel a queued item.
- [ ] Pair a fresh second profile from a QR payload; both screens show the same safety number.
- [ ] Send a single-chunk file, a multi-chunk file, and a transfer cancelled mid-flight.
- [ ] A corrupted digest surfaces an error instead of a "completed" row.
- [ ] Reload mid-transfer: the row becomes `interrupted` — not "completed", and not silently resumed.
- [ ] Settings → export produces a JSON snapshot; clear asks for confirmation first.
- [ ] No uncaught console errors.

## Pull request checklist

- [ ] One focused change, branch up to date with `main`.
- [ ] `pnpm typecheck`, `pnpm build`, `pnpm test` pass locally.
- [ ] New behaviour described in the PR body; screenshots for visual changes.
- [ ] Protocol changes update `docs/protocol.md`; structural changes update `docs/architecture.md`.
- [ ] No new dependency unless it earns its weight — justify it in the PR body.
- [ ] No secrets, tokens, private keys, `.env` files or deployment credentials in the diff.
- [ ] Accessibility: real buttons and links, labelled, keyboard reachable, visible focus.
- [ ] Bundle impact checked for new libraries (`pnpm build` output size).

## Never commit secrets

- `.env` stays local. `.env.example` documents variable *names* with placeholder values only.
- `TURN_SECRET` is server-side. It never belongs in the bundle, a screenshot, a commit, or client-side config.
- Device private keys are generated in the browser and are non-extractable; never add code that exports or logs them.
- If a secret lands in a commit: rotate it first, then tell the maintainer. History rewriting alone is not remediation.
- Example values must be obviously fake, e.g. `wss://signal.example.invalid`.

## License

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
