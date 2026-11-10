#!/bin/sh
# Render the coturn configuration template from the container environment and
# exec turnserver. Used as the coturn entrypoint in docker-compose.yml.
#
# Required: TURN_SECRET (must equal the signaling service's TURN_SECRET).
# Optional: EXTERNAL_IP, TURNS_REALM, TURN_PORT, TURN_TLS_PORT,
#           TURN_MIN_PORT, TURN_MAX_PORT, TURNS_CERT, TURNS_KEY.
set -eu

TEMPLATE=${TEMPLATE:-/etc/coturn/turnserver.conf}
OUTPUT=${OUTPUT:-/tmp/turnserver.conf}
CERT=${TURNS_CERT:-/etc/coturn/certs/turn.crt}
KEY=${TURNS_KEY:-/etc/coturn/certs/turn.key}

: "${TURN_SECRET:?TURN_SECRET must be set (same value as the signaling service)}"

REALM=${TURNS_REALM:-dropzone}
LISTEN_PORT=${TURN_PORT:-3478}
TLS_PORT=${TURN_TLS_PORT:-5349}
MIN_PORT=${TURN_MIN_PORT:-49160}
MAX_PORT=${TURN_MAX_PORT:-49200}

# Escape characters that are special on the right-hand side of sed's s||| form.
escape() {
  printf '%s' "$1" | sed -e 's/[&|\\]/\\&/g'
}

render() {
  sed \
    -e "s|__TURN_SECRET__|$(escape "$TURN_SECRET")|g" \
    -e "s|__REALM__|$(escape "$REALM")|g" \
    -e "s|__LISTEN_PORT__|$LISTEN_PORT|g" \
    -e "s|__TLS_PORT__|$TLS_PORT|g" \
    -e "s|__MIN_PORT__|$MIN_PORT|g" \
    -e "s|__MAX_PORT__|$MAX_PORT|g" \
    "$TEMPLATE"
}

if [ -n "${EXTERNAL_IP:-}" ]; then
  render | sed -e "s|__EXTERNAL_IP__|$(escape "$EXTERNAL_IP")|g" > "$OUTPUT"
else
  render | sed -e "s|^external-ip=__EXTERNAL_IP__|# external-ip omitted: set EXTERNAL_IP when the host is behind NAT|" > "$OUTPUT"
fi

chmod 600 "$OUTPUT" 2>/dev/null || true

if [ -f "$CERT" ] && [ -f "$KEY" ]; then
  TLS_ARGS="--cert=$CERT --pkey=$KEY"
else
  echo "coturn-entrypoint: no TLS certificate at $CERT, starting with --no-tls --no-dtls" >&2
  TLS_ARGS="--no-tls --no-dtls"
fi

exec turnserver -c "$OUTPUT" $TLS_ARGS "$@"
