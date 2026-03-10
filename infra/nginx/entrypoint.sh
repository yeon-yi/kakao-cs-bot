#!/bin/sh
set -e

SSL_DIR="/etc/nginx/ssl"
CERT_FILE="$SSL_DIR/server.crt"
KEY_FILE="$SSL_DIR/server.key"

# 자체 서명 SSL 인증서 생성 (없을 경우)
if [ ! -f "$CERT_FILE" ] || [ ! -f "$KEY_FILE" ]; then
  echo "Generating self-signed SSL certificate..."
  mkdir -p "$SSL_DIR"
  openssl req -x509 -nodes -days 365 \
    -newkey rsa:2048 \
    -keyout "$KEY_FILE" \
    -out "$CERT_FILE" \
    -subj "/C=KR/ST=Seoul/L=Seoul/O=KakaoCSBot/CN=${SERVER_NAME:-localhost}" \
    2>/dev/null
  echo "SSL certificate generated."
fi

exec nginx -g "daemon off;"
