#!/bin/sh
set -eu

BASE_DOMAIN="${BASE_DOMAIN:-example.com}"
DASHBOARD_SUBDOMAIN="${DASHBOARD_SUBDOMAIN:-thirdeye}"
API_SUBDOMAIN="${API_SUBDOMAIN:-api}"

repo_env() {
  [ -f /repo/.env ] || return 0
  grep -E "^$1=" /repo/.env 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d '"' | tr -d "'"
}
_v=$(repo_env BASE_DOMAIN);         [ -n "$_v" ] && BASE_DOMAIN="$_v"
_v=$(repo_env DASHBOARD_SUBDOMAIN); [ -n "$_v" ] && DASHBOARD_SUBDOMAIN="$_v"
_v=$(repo_env API_SUBDOMAIN);       [ -n "$_v" ] && API_SUBDOMAIN="$_v"
_v=$(repo_env EXTRA_BASE_DOMAINS);  [ -n "$_v" ] && EXTRA_BASE_DOMAINS="$_v"
unset _v

SETUP_MODE=0
if [ ! -f "/repo/.installed" ]; then
  SETUP_MODE=1
  echo "[nginx] Setup mode: no .installed lock found. Serving dashboard on port 80 (HTTP only)."
fi

if [ "${SETUP_MODE}" = "1" ]; then
  cat > /etc/nginx/conf.d/default.conf <<'SETUPEOF'
upstream unidral_engine {
    server unidral-server:4000;
}
upstream unidral_dashboard {
    server unidral-dashboard:3000;
}
server_tokens off;
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    client_max_body_size 50m;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location /api/ {
        proxy_pass http://unidral_engine/__unidral/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    location /sse {
        proxy_pass http://unidral_engine/__unidral/api/events;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location / {
        proxy_pass http://unidral_dashboard;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
SETUPEOF
  echo "[nginx] Setup mode config generated."
  echo "[nginx] Testing config..."
  nginx -t 2>&1
  echo "[nginx] Starting nginx in setup mode..."
  exec nginx -g 'daemon off;'
fi

FALLBACK_CERT="/etc/nginx/ssl-fallback/fullchain.pem"
FALLBACK_KEY="/etc/nginx/ssl-fallback/privkey.pem"

BASE_CERT_OK=0
if [ -f "/etc/letsencrypt/live/${BASE_DOMAIN}/fullchain.pem" ] && [ -f "/etc/letsencrypt/live/${BASE_DOMAIN}/privkey.pem" ]; then
  BASE_CERT_OK=1
  echo "[nginx] Using Let's Encrypt cert for ${BASE_DOMAIN}"
else
  echo "[nginx] WARNING: No Let's Encrypt cert for ${BASE_DOMAIN}. Using fallback self-signed cert."
  echo "[nginx] Run cert reissue from the dashboard to get real certs."
fi

cert_path() {
  if [ -f "/etc/letsencrypt/live/$1/fullchain.pem" ]; then
    echo "/etc/letsencrypt/live/$1/fullchain.pem"
  else
    echo "${FALLBACK_CERT}"
  fi
}
key_path() {
  if [ -f "/etc/letsencrypt/live/$1/privkey.pem" ]; then
    echo "/etc/letsencrypt/live/$1/privkey.pem"
  else
    echo "${FALLBACK_KEY}"
  fi
}

BASE_DOMAIN_ESC=$(printf '%s' "$BASE_DOMAIN" | sed 's/\./\\./g')

if [ "${BASE_CERT_OK}" = "1" ]; then
  SSL_CERT="/etc/letsencrypt/live/${BASE_DOMAIN}/fullchain.pem"
  SSL_KEY="/etc/letsencrypt/live/${BASE_DOMAIN}/privkey.pem"
else
  SSL_CERT="${FALLBACK_CERT}"
  SSL_KEY="${FALLBACK_KEY}"
fi

EXTRA_BASE_DOMAINS="${EXTRA_BASE_DOMAINS:-}"
EXTRA_SERVER_NAMES=""
EXTRA_DOMAIN_SERVERS=""
if [ -n "${EXTRA_BASE_DOMAINS}" ]; then
  for d in $(echo "${EXTRA_BASE_DOMAINS}" | tr ',' ' '); do
    d=$(echo "$d" | xargs)
    [ -z "$d" ] && continue
    EXTRA_SERVER_NAMES="${EXTRA_SERVER_NAMES} ${d} *.${d}"
    d_esc=$(printf '%s' "$d" | sed 's/\./\\./g')
    ed_cert=$(cert_path "$d")
    ed_key=$(key_path "$d")
    echo "[nginx] Extra domain ${d}: cert=${ed_cert}"
    EXTRA_DOMAIN_SERVERS="${EXTRA_DOMAIN_SERVERS}
# --- Extra domain: ${d} ---
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name ~^(?<subdomain>.+)\\.${d_esc}\$;

    ssl_certificate ${ed_cert};
    ssl_certificate_key ${ed_key};

    client_max_body_size 50m;
    proxy_buffering off;

    location / {
        proxy_pass http://unidral_engine;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name ${d};

    ssl_certificate ${ed_cert};
    ssl_certificate_key ${ed_key};

    location / {
        root /usr/share/nginx/html;
        try_files /404.html =404;
    }
}
"
  done
fi

USER_DOMAIN_SERVERS=""
if command -v curl >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then
  API_URL="http://unidral-server:4000/__unidral/api"
  echo "[nginx] Fetching user-added domains from ${API_URL}/domains ..."

  DOMAINS_JSON=""
  for attempt in 1 2 3 4 5 6; do
    DOMAINS_JSON=$(curl -sf --max-time 5 "${API_URL}/domains" 2>/dev/null) && break || true
    echo "[nginx] Engine not ready yet (attempt ${attempt}/6), retrying in 3s..."
    sleep 3
  done
  if [ -n "${DOMAINS_JSON}" ]; then
    USER_DOMAINS=$(echo "${DOMAINS_JSON}" | jq -r '.domains[]? | select(.status == "active" or .status == "ready") | .domain' 2>/dev/null) || true
    if [ -n "${USER_DOMAINS}" ]; then
      echo "[nginx] Found user-added domains:"
      echo "${USER_DOMAINS}" | sed 's/^/  - /'
      USER_DOMAINS_FILE=$(mktemp)
      echo "${USER_DOMAINS}" > "${USER_DOMAINS_FILE}"
      while IFS= read -r ud; do
        [ -z "${ud}" ] && continue
        if [ "${ud}" = "${BASE_DOMAIN}" ] || echo "${EXTRA_BASE_DOMAINS}" | grep -qw "${ud}"; then
          continue
        fi
        ud_esc=$(printf '%s' "${ud}" | sed 's/\./\\./g')
        ud_cert=$(cert_path "${ud}")
        ud_key=$(key_path "${ud}")
        echo "[nginx] User domain ${ud}: cert=${ud_cert}"
        USER_DOMAIN_SERVERS="${USER_DOMAIN_SERVERS}
# --- User-added domain: ${ud} ---
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name ~^(?<subdomain>.+)\\.${ud_esc}\$;

    ssl_certificate ${ud_cert};
    ssl_certificate_key ${ud_key};

    client_max_body_size 50m;
    proxy_buffering off;

    location / {
        proxy_pass http://unidral_engine;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name ${ud};

    ssl_certificate ${ud_cert};
    ssl_certificate_key ${ud_key};

    location / {
        root /usr/share/nginx/html;
        try_files /404.html =404;
    }
}
"
      done < "${USER_DOMAINS_FILE}"
      rm -f "${USER_DOMAINS_FILE}"
    else
      echo "[nginx] No user-added domains found."
    fi
  else
    echo "[nginx] Could not fetch domains from API (or timed out). Using catch-all for user domains."
  fi
fi

export BASE_DOMAIN BASE_DOMAIN_ESC DASHBOARD_SUBDOMAIN API_SUBDOMAIN
export EXTRA_SERVER_NAMES EXTRA_DOMAIN_SERVERS USER_DOMAIN_SERVERS
export SSL_CERT SSL_KEY

envsubst '${BASE_DOMAIN} ${BASE_DOMAIN_ESC} ${DASHBOARD_SUBDOMAIN} ${API_SUBDOMAIN} ${EXTRA_SERVER_NAMES} ${EXTRA_DOMAIN_SERVERS} ${USER_DOMAIN_SERVERS} ${SSL_CERT} ${SSL_KEY}' \
  < /etc/nginx/templates/unidral.conf.template \
  > /etc/nginx/conf.d/default.conf

echo "[nginx] Testing config..."
if nginx -t 2>&1; then
  echo "[nginx] Config test passed."
else
  echo "[nginx] ERROR: Config test failed! Generating minimal fallback config..."
  cat > /etc/nginx/conf.d/default.conf <<MINIEOF
upstream unidral_engine {
    server unidral-server:4000;
}
upstream unidral_dashboard {
    server unidral-dashboard:3000;
}
server_tokens off;
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    ''      close;
}
server {
    listen 80;
    server_name _;
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    location / {
        return 301 https://\$host\$request_uri;
    }
}
server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    http2 on;
    server_name _;
    ssl_certificate ${FALLBACK_CERT};
    ssl_certificate_key ${FALLBACK_KEY};
    client_max_body_size 50m;
    proxy_buffering off;
    location / {
        proxy_pass http://unidral_engine;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 3600s;
    }
}
MINIEOF
  echo "[nginx] Minimal fallback config generated. Testing again..."
  nginx -t 2>&1 || {
    echo "[nginx] FATAL: Even minimal config failed. Starting nginx anyway to show error in logs."
  }
fi

echo "[nginx] Starting nginx..."
exec nginx -g 'daemon off;'
