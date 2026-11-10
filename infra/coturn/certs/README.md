# TLS certificates for TURN over TLS (port 5349)

Drop a certificate chain and key here to serve turns: (TLS) and DTLS. The
container mounts this directory read-only at /etc/coturn/certs.

    infra/coturn/certs/turn.crt   # full chain, leaf certificate first
    infra/coturn/certs/turn.key   # unencrypted private key

infra/coturn/entrypoint.sh passes --cert/--pkey when both files exist and falls
back to --no-tls --no-dtls when they do not, so the relay starts either way.

Let's Encrypt example on the relay host (stop coturn first, it needs port 80):

    certbot certonly --standalone -d turn.example.com
    cp /etc/letsencrypt/live/turn.example.com/fullchain.pem infra/coturn/certs/turn.crt
    cp /etc/letsencrypt/live/turn.example.com/privkey.pem   infra/coturn/certs/turn.key
    docker compose restart coturn

Add TURN_URLS entries with turns: to advertise TLS, for example
turns:turn.example.com:5349?transport=tcp. Never commit real keys.
