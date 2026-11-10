# DROPZONE deployment guide

DROPZONE is a static, local-first SPA plus a small signaling service. File bytes never
touch the server: devices exchange them over an `RTCDataChannel`, and the signaling
service only relays JSON offers, answers and ICE candidates. `docs/protocol.md` is the
wire-protocol authority; this guide is about running the servers.

## 1. What runs where

```
                    https://app.example.com                (static SPA)
                            |
                            |  loads index.html + JS  (calls /config.json once)
                            v
                   +---------------------+
                   |  Browser (device A) |---- wss://signal.example.com/ws ----+
                   +---------------------+                                      |
                            |                                                   v
                            |                                     +---------------------------+
                            |                                     |  signaling service :8787  |
                            |                                     |  /ws  /health  /turn      |
                            |                                     |  /config.json             |
                            |                                     |  JSON relay only, no files|
                            |                                     +---------------------------+
                            |                                                   |
                   =========|=========  WebRTC DataChannel  =========|===========  direct P2P
                   ||       v                                        v          ||
                   ||  +---------------------+               +---------------+  ||
                   ||  |  Browser (device B) |               | coturn relay  |  ||
                   ||  +---------------------+               | 3478 / 5349   |  ||
                   ||                                        | 49160-49200   |  ||
                   ||                                        +---------------+  ||
                   ||========== used only when direct ICE fails ==================||
```

Three independently deployable pieces:

| Piece | Required? | What it does |
| --- | --- | --- |
| Static SPA (`dist/`) | yes | the whole UI, storage and WebRTC peer |
| Signaling (`server/` or `workers/signaling/`) | for cross-device pairing | relays JSON between paired devices only |
| TURN relay (`infra/coturn/`) | only for hostile networks | relays traffic over UDP/TCP when NAT traversal fails |

## 2. Endpoints the frontend depends on

| Method | Path | Response |
| --- | --- | --- |
| GET | `/health` | `{ status: "ok", service: "dropzone-signaling", clients, paired, uptime }` |
| GET | `/turn?device=<id>` | `{ urls: string[], username, credential, ttl }`, or JSON `null` when TURN is unconfigured (HTTP 200) |
| GET | `/config.json` | `{ signalUrl: "wss://host/ws", rtc: { stun: string[], turnConfigured: boolean } }` |
| WS | `/ws` | signaling protocol v1 (`docs/protocol.md` section 1) |
| GET | anything else | `404 { error: "not_found" }` |

`/turn` without a `device` parameter answers `400 { error: "device_required" }`. Both
server variants return identical JSON, so the SPA never needs to know which one it
talks to. The Node default port is `8787`; the Worker answers on its workers.dev host,
for example `https://dropzone-signaling.<account>.workers.dev/ws`.

## 3. Single VPS with Docker Compose

### 3.1 Prerequisites

```sh
sudo apt-get update && sudo apt-get install -y ca-certificates curl ufw
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"   # log out and back in
```

A host with a public IPv4 address. No inbound port 80 is needed unless TLS also
terminates here (section 4).

### 3.2 Configure

```sh
cd dropzone
cp .env.example .env
printf 'TURN_SECRET=%s\n' "$(openssl rand -hex 32)" >> .env
# edit .env and set, at minimum:
#   ALLOWED_ORIGINS=https://app.example.com
#   EXTERNAL_IP=<public IPv4 of this host>
#   TURN_URLS=turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp
#   VITE_SIGNAL_URL=wss://signal.example.com/ws     (build-time, used by the SPA)
```

`TURN_SECRET` must be identical for both containers: the signaling service signs
`base64(HMAC-SHA1(secret, expiry:deviceId))` and coturn recomputes it from the same
value. Rotate by editing `.env` and running `docker compose up -d` again; credentials
minted before the change keep working until their TTL expires.

### 3.3 Start

```sh
docker compose up -d --build
docker compose ps
curl -s http://127.0.0.1:8787/health | jq .
curl -s 'http://127.0.0.1:8787/turn?device=test-device' | jq .
docker compose logs -f signal coturn
```

`signal` publishes only on `127.0.0.1:8787` (loopback). Put a TLS proxy in front of it
(section 4) so browsers can reach `wss://`; `coturn` publishes its UDP ports directly.

### 3.4 Firewall and port requirements

| Port | Proto | Service | Why |
| --- | --- | --- | --- |
| 443 | TCP | Caddy/Nginx | `https://` SPA plus the `wss://` upgrade |
| 80 | TCP | Caddy/Nginx | ACME HTTP-01 challenge, redirect to 443 |
| 3478 | UDP + TCP | coturn | STUN binding and TURN allocations; TCP is the UDP-blocked fallback |
| 5349 | TCP + UDP | coturn | TURN over TLS / DTLS (needs certificates) |
| 49160-49200 | UDP | coturn | relay allocation range, one port per relayed flow |
| 8787 | TCP | signaling | loopback only, never exposed publicly |

```sh
sudo ufw allow 80,443/tcp
sudo ufw allow 3478/udp && sudo ufw allow 3478/tcp
sudo ufw allow 5349/udp && sudo ufw allow 5349/tcp
sudo ufw allow 49160:49200/udp
sudo ufw enable
```

Cloud providers keep their own firewall in front of the host: open the same ports in
the provider console (AWS security group, Hetzner firewall, Oracle NSG) and, on GCP,
add an ingress rule for `udp:49160-49200`. A correct `ufw` behind a closed cloud
firewall is the most common cause of "works on the LAN, dies on cellular".

## 4. HTTPS and WSS termination

Browsers refuse a `ws://` socket from an `https://` page, and the frontend origin must
appear in `ALLOWED_ORIGINS`. Terminate TLS on the host that runs `signal`.

### 4.1 Caddy (recommended: automatic certificates)

```caddyfile
# /etc/caddy/Caddyfile
{
	email admin@example.com
}

signal.example.com {
	reverse_proxy 127.0.0.1:8787 {
		header_up Host {host}
		header_up X-Forwarded-Proto {scheme}
		header_up X-Forwarded-Host {host}
		header_up X-Real-IP {remote_host}
	}
	encode zstd gzip
	log {
		output stdout
		format console
	}
}

# Optional: serve the built SPA from the same host instead of GitHub Pages.
# app.example.com {
# 	root * /var/www/dropzone/dist
# 	file_server
# 	try_files {path} /index.html
# }
```

```sh
sudo systemctl reload caddy
curl -s https://signal.example.com/health | jq .
curl -s https://signal.example.com/config.json | jq .
```

Caddy proxies WebSocket upgrades transparently; no extra directive is required.

### 4.2 Nginx

```nginx
# /etc/nginx/sites-available/dropzone-signal
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    listen [::]:80;
    server_name signal.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name signal.example.com;

    ssl_certificate     /etc/letsencrypt/live/signal.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/signal.example.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_session_cache   shared:SSL:10m;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;

    # Signaling frames are JSON control messages: 32 KiB ceiling, long idle sockets.
    client_max_body_size 64k;

    location /ws {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```sh
sudo ln -s /etc/nginx/sites-available/dropzone-signal /etc/nginx/sites-enabled/
sudo certbot --nginx -d signal.example.com
sudo nginx -t && sudo systemctl reload nginx
```

Without `proxy_set_header Connection $connection_upgrade` the upgrade header is
stripped and clients see HTTP 400 on `/ws`.

### 4.3 TURN over TLS

Drop a certificate pair into `infra/coturn/certs/` (see the README there) and advertise
TLS URLs:

```sh
TURN_URLS=turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp,turns:turn.example.com:5349?transport=tcp
```

Certificates must match the hostname clients dial, and coturn must own port 5349
itself, so the reverse proxy must not bind it.

## 5. Cloudflare Workers variant

`workers/signaling/` serves the same protocol from one Durable Object (`Relay`) bound
as `env.RELAY` and always addressed as `env.RELAY.idFromName('relay-main')`. It uses the
WebSocket Hibernation API, so idle paired devices cost no duration; invitations, pair
links and device records live in Durable Object storage and survive hibernation.

### 5.1 Deploy

```sh
npx wrangler login                     # or set the two env vars below

export CLOUDFLARE_API_TOKEN=<token with Workers Scripts:Edit + Durable Objects>
export CLOUDFLARE_ACCOUNT_ID=<32-hex account id>

npx wrangler deploy --dry-run --config workers/signaling/wrangler.toml   # validate
npx wrangler secret put TURN_SECRET --config workers/signaling/wrangler.toml
npx wrangler deploy --config workers/signaling/wrangler.toml
```

`wrangler.toml` keeps non-secret values in `[vars]` (`ALLOWED_ORIGINS`, `TURN_URLS`,
`TURN_USERNAME_PREFIX`, `STUN_URLS`, `TURN_TTL_SECONDS`, `PAIRING_TTL_SECONDS`). Only
`TURN_SECRET` is a secret. The first deploy prints the public URL:

```
https://dropzone-signaling.<account-subdomain>.workers.dev/ws
```

Use it as `VITE_SIGNAL_URL`, or attach a custom hostname by uncommenting the `routes`
block in `wrangler.toml` and deploying again. Keep `ALLOWED_ORIGINS` set to the exact
SPA origin: the Worker answers `403 { error: "forbidden" }` on mismatch.

### 5.2 Notes and limits

* Every socket funnels through a single Durable Object instance. That is deliberate (one
  authoritative pairing registry) and fine for personal use; a busy relay should run
  the Node variant.
* `npx wrangler dev --config workers/signaling/wrangler.toml` runs the same code locally
  with a local Durable Object, which is how `tests/signal-local.mjs` verifies it:
  `SIGNAL_URL=http://127.0.0.1:8787 EXPECT_TURN=1 node tests/signal-local.mjs`.
* TURN still needs somewhere to run: deploy `coturn` on a VPS (sections 3-4) and point
  `TURN_URLS` at it. The Worker only mints credentials.

## 6. Static frontend

```sh
pnpm install --ignore-scripts
VITE_SIGNAL_URL=wss://signal.example.com/ws pnpm run build   # emits dist/
```

`VITE_SIGNAL_URL` is baked in at build time: rebuild after changing it, and use `wss://`
whenever the site is served over `https://`.

### 6.1 GitHub Pages

1. Repository -> Settings -> Pages -> Source: **GitHub Actions**.
2. Build and upload `dist/` in the workflow:

```yaml
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --ignore-scripts
      - run: pnpm run build
        env:
          VITE_SIGNAL_URL: wss://signal.example.com/ws
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
```

3. Add the Pages origin to the signaling service's `ALLOWED_ORIGINS`. The origin is
   scheme + host only, e.g. `https://<user>.github.io`; a project site under
   `/<repo>/` uses the same origin.
4. `vite.config.ts` already uses a relative base, so project subpaths work unchanged.

### 6.2 Cloudflare Pages / Vercel / Netlify

Same build command (`pnpm install --ignore-scripts && pnpm run build`), output directory
`dist`, Node 22, `VITE_SIGNAL_URL` as a build environment variable. Add the resulting
origin to `ALLOWED_ORIGINS` and restart the signaling service.

## 7. Environment variables

| Name | Used by | Default | Notes |
| --- | --- | --- | --- |
| `PORT` | signaling | `8787` | HTTP + WebSocket port |
| `HOST` | signaling | `0.0.0.0` | use `127.0.0.1` behind a local proxy |
| `ALLOWED_ORIGINS` | signaling + Worker | empty = any | comma-separated exact origins, `403` on mismatch |
| `MAX_CLIENTS` | signaling | `1000` | upgrades beyond the cap get `503` |
| `MAX_SIGNAL_BYTES` | signaling | `32768` | clamped to the 32 KiB protocol ceiling |
| `PAIRING_TTL_SECONDS` | signaling + Worker | `300` | clamped to `60..900` |
| `TURN_URLS` | signaling, Worker, clients | empty | comma-separated; empty disables TURN |
| `TURN_SECRET` | signaling + Worker + coturn | empty | `openssl rand -hex 32`; never in the SPA |
| `TURN_TTL_SECONDS` | signaling + Worker | `3600` | clamped to `60..86400` |
| `STUN_URLS` | signaling + Worker | `stun:stun.l.google.com:19302` | comma-separated |
| `VITE_SIGNAL_URL` | SPA build | none | `wss://host/ws`; older builds read `VITE_SIGNALING_URL` |
| `SIGNAL_PUBLIC_URL` | signaling | derived | overrides `signalUrl` in `/config.json` |
| `HELLO_TIMEOUT_MS` | signaling | `10000` | test hook; the protocol fixes 10 s |
| `LOG_LEVEL` | signaling | `info` | `error`, `warn`, `info`, `debug` as single-line JSON |
| `EXTERNAL_IP` | coturn | auto-detected | required behind 1:1 NAT or floating IPs |
| `TURNS_REALM` | coturn | `dropzone` | realm in the 401 challenge |
| `TURN_MIN_PORT` / `TURN_MAX_PORT` | coturn | `49160` / `49200` | relay allocation range |
| `TURN_USERNAME_PREFIX` | Worker only | empty | prepended to `<expiry>:<deviceId>` |

## 8. Operations

* Health: `curl -s https://signal.example.com/health`. `clients` is the live socket
  count, `paired` the number of distinct device pairs, `uptime` seconds since start.
* Logs are single-line JSON on stdout: a timestamp, a level, an event name and small
  scalar fields. Never file names, content, credentials or tokens.
* Node state is in memory: a restart drops sockets (clients reconnect) and pending
  invitations. Pair links are re-established by pairing again.
* One process is enough for a household; the Node server is single-instance by design.
  Raising `MAX_CLIENTS` past a few thousand needs a shared registry.
* Rotate `TURN_SECRET` periodically. Keep coturn's admin CLI disabled (`no-cli`).

## 9. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Pairing succeeds, the transfer stalls on connect, ICE never completes | no reachable TURN relay; both peers sit behind symmetric NAT | confirm `/turn?device=x` returns an object, then open 3478/udp+tcp and 49160-49200/udp end to end (`turnutils_uclient -u <expiry>:dev -w <credential> turn.example.com`) |
| `/config.json` reports `turnConfigured: false` and `/turn` returns `null` | `TURN_URLS` or `TURN_SECRET` missing from the server environment | set both and restart the container |
| WebSocket upgrade answers `403` | page origin not in `ALLOWED_ORIGINS`; scheme, host and port must match exactly with no trailing slash | add the exact origin, e.g. `https://app.example.com`, then restart |
| Socket closes `1008` immediately | first frame was not a valid `hello`, the JSON was malformed, the device id was rejected, or `hello` arrived after 10 s | send `{"t":"hello","v":1,"device":{...}}` right after open |
| Socket closes `1009` | frame larger than `MAX_SIGNAL_BYTES` (32 KiB) | signaling frames carry SDP and ICE only, never file bytes |
| `error` `pair_used` | the QR token was already consumed | create a new invitation on device A |
| `error` `pair_expired` | invitation older than `PAIRING_TTL_SECONDS` | raise the TTL (max 900 s) or scan sooner |
| `error` `pair_not_online` | the inviting device closed its socket | keep device A connected while device B scans |
| `error` `not_paired` on `signal` | the devices are not paired, or link state was lost on restart | pair again |
| `error` `peer_offline` | the paired peer disconnected | wake or reload the other device |
| `error` `rate_limited` then close `1008` | more than 60 frames in 10 s | batch ICE candidates instead of sending many frames |
| Nginx returns `400` on `/ws` | missing `Upgrade`/`Connection` headers | add the `proxy_set_header` lines from section 4.2 |
| Console reports a mixed-content block | `ws://` from an `https://` page | rebuild the SPA with `VITE_SIGNAL_URL=wss://...` |
| coturn logs a relay-IP error and allocations fail | `EXTERNAL_IP` wrong or missing behind NAT | set `EXTERNAL_IP` to the public IPv4 and restart coturn |

## 10. Post-deploy checklist

```sh
curl -s https://signal.example.com/health | jq .                       # 1 reachable
curl -s 'https://signal.example.com/turn?device=check' | jq .          # 2 TURN creds
curl -s https://signal.example.com/config.json | jq .                  # 3 SPA config
docker compose logs --tail=50 coturn | grep -E 'listener|relay|error'  # 4 relay up
```

Then, in two browser profiles on different networks: open the SPA, generate an
invitation on device A, open it on device B, compare the safety number on both screens,
send a small file, and confirm the received SHA-256 equals the source file's. Repeat
with one device on cellular data to prove the TURN path, not just the LAN path.
