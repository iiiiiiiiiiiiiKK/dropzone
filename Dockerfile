# syntax=docker/dockerfile:1
# DROPZONE signaling server - Node 22, non-root, single runtime dependency (ws).
# Build:  docker build -t dropzone-signal .
# Run:    docker run --rm -p 127.0.0.1:8787:8787 --env-file .env dropzone-signal
FROM node:22-alpine

ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0

WORKDIR /app

# The signaling service needs exactly one runtime package, so it is installed
# ahead of the source copy: rebuilding after a server/ change does not re-install.
RUN npm init -y >/dev/null 2>&1 \
 && npm install --omit=dev --no-audit --no-fund ws@8.18.3 \
 && npm cache clean --force \
 && rm -rf /root/.npm /tmp/*

# Only the server ships here; the static frontend is built and hosted separately.
COPY --chown=node:node server ./server

USER node
EXPOSE 8787

# /health returns {status:"ok",service:"dropzone-signaling",clients,paired,uptime}.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then((r)=>{if(!r.ok)process.exit(1);return r.json();}).then(()=>process.exit(0)).catch(()=>process.exit(1))"

CMD ["node", "server/index.mjs"]
