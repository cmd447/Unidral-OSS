#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [ -f "${REPO_DIR}/.env" ]; then
  set -a
  source "${REPO_DIR}/.env"
  set +a
fi

DOMAIN="${BASE_DOMAIN:-example.com}"
CERT_NAME="${DOMAIN}"
CREDENTIALS_FILE="${CLOUDFLARE_CREDENTIALS:-${HOME}/.secrets/cloudflare.ini}"
API_SUBDOMAIN="${API_SUBDOMAIN:-debian}"
API_URL="https://${API_SUBDOMAIN}.${DOMAIN}/api"

if [ -f /.dockerenv ] || [ "${RUNNING_IN_DOCKER:-}" = "true" ]; then
  LOCAL_API="http://127.0.0.1:4000/__unidral/api"
  if curl -sf --max-time 2 "${LOCAL_API}/sites" >/dev/null 2>&1; then
    echo "Using local API at ${LOCAL_API} (container-internal)"
    API_URL="${LOCAL_API}"
  fi
fi
COMPOSE_DIR="${COMPOSE_DIR:-${REPO_DIR}}"

EXTRA_DOMAINS=()
if [ -n "${EXTRA_BASE_DOMAINS:-}" ]; then
  IFS=',' read -ra EXTRA_DOMAINS <<< "${EXTRA_BASE_DOMAINS}"
fi

if [ -z "${CF_API_TOKEN:-}" ] && [ ! -f "${CREDENTIALS_FILE}" ]; then
  echo "ERROR: No Cloudflare credentials found."
  echo "  Either set CF_API_TOKEN in .env, or create ${CREDENTIALS_FILE} with:"
  echo "    mkdir -p ~/.secrets"
  echo "    echo 'dns_cloudflare_api_token=YOUR_TOKEN' > ${CREDENTIALS_FILE}"
  echo "    chmod 600 ${CREDENTIALS_FILE}"
  exit 1
fi

if [ -n "${CF_API_TOKEN:-}" ]; then
  CREDENTIALS_DIR="$(dirname "${CREDENTIALS_FILE}")"
  mkdir -p "${CREDENTIALS_DIR}"
  echo "dns_cloudflare_api_token=${CF_API_TOKEN}" > "${CREDENTIALS_FILE}"
  chmod 600 "${CREDENTIALS_FILE}"
  echo "Created ${CREDENTIALS_FILE} from CF_API_TOKEN in .env"
fi

if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is not installed. Run: apt install -y jq"
  exit 1
fi

if ! certbot plugins --text 2>&1 | grep -q dns-cloudflare; then
  echo "ERROR: certbot-dns-cloudflare plugin not installed."
  echo "  Run: apt install -y python3-certbot-dns-cloudflare"
  exit 1
fi

SITES_JSON=""
DOMAINS_JSON=""

echo "Fetching wildcard sites from ${API_URL}..."
SITES_JSON=$(curl -sf "${API_URL}/sites" 2>/dev/null) || {
  echo "WARNING: API not reachable at ${API_URL}."
  echo "  Proceeding with base domain only (${DOMAIN} and *.${DOMAIN})."
  echo "  Re-run this script after starting the stack to expand the cert."
}

echo "Fetching user-added domains from ${API_URL}/domains..."
DOMAINS_JSON=$(curl -sf "${API_URL}/domains" 2>/dev/null) || {
  echo "WARNING: Could not fetch domains from API."
  DOMAINS_JSON=""
}
if [ -n "${DOMAINS_JSON}" ]; then
  echo "Domain proxy status from API:"
  echo "${DOMAINS_JSON}" | jq -r '.domains[]? | "  \(.domain): cf_proxied=\(.cf_proxied | tostring)"' 2>/dev/null || true
fi

if [ -n "${SITES_JSON}" ]; then
  WILDCARD_SUBS=$(echo "${SITES_JSON}" | jq -r --arg bd "${DOMAIN}" '.[] | select(.wildcard == true and ((.base_domain // "") == "" or (.base_domain // "") == $bd)) | .subdomain' 2>/dev/null) || {
    echo "WARNING: Failed to parse sites JSON. Proceeding with base domain only."
    WILDCARD_SUBS=""
  }
else
  WILDCARD_SUBS=""
fi

if [ -z "${WILDCARD_SUBS}" ]; then
  echo "No wildcard sites found on ${DOMAIN}. Cert will cover ${DOMAIN} and *.${DOMAIN} only."
else
  echo "Wildcard sites found on ${DOMAIN}:"
  echo "${WILDCARD_SUBS}" | sed 's/^/  - /'
fi

DOMAINS=("-d" "${DOMAIN}" "-d" "*.${DOMAIN}")

DOMAIN_IDENT_COUNT=2
while IFS= read -r sub; do
  [ -z "${sub}" ] && continue
  if [ ${DOMAIN_IDENT_COUNT} -ge 95 ]; then
    echo "WARNING: Approaching LE 100-identifier limit for ${DOMAIN} (current: ${DOMAIN_IDENT_COUNT}). Skipping remaining subdomain wildcards."
    break
  fi
  DOMAINS+=("-d" "*.${sub}.${DOMAIN}")
  DOMAIN_IDENT_COUNT=$((DOMAIN_IDENT_COUNT + 1))

  if [[ "${sub}" == *.* ]]; then
    DOMAINS+=("-d" "${sub}.${DOMAIN}")
    DOMAIN_IDENT_COUNT=$((DOMAIN_IDENT_COUNT + 1))
  fi
done <<< "${WILDCARD_SUBS}"

while IFS= read -r sub; do
  [ -z "${sub}" ] && continue
  if [ ${DOMAIN_IDENT_COUNT} -ge 95 ]; then
    echo "WARNING: Approaching LE 100-identifier limit for ${DOMAIN} (current: ${DOMAIN_IDENT_COUNT}). Skipping remaining deep wildcards."
    break
  fi
  SITE_SUBS=$(echo "${SITES_JSON}" | jq -r --arg s "${sub}" '.[] | select(.subdomain == $s and .wildcard == true) | .subdomains[]?' 2>/dev/null || true)
  if [ -n "${SITE_SUBS}" ]; then
    while IFS= read -r prefix; do
      [ -z "${prefix}" ] && continue
      if [ ${DOMAIN_IDENT_COUNT} -ge 95 ]; then
        echo "WARNING: Approaching LE 100-identifier limit for ${DOMAIN} (current: ${DOMAIN_IDENT_COUNT}). Skipping remaining deep wildcards."
        break 2
      fi
      parts=(${prefix//./ })
      if [ ${#parts[@]} -eq 1 ]; then
        DOMAINS+=("-d" "*.${prefix}.${sub}.${DOMAIN}")
        DOMAIN_IDENT_COUNT=$((DOMAIN_IDENT_COUNT + 1))
      else
        for ((i=1; i<${#parts[@]}; i++)); do
          parent=$(IFS=.; echo "${parts[*]:i}")
          DOMAINS+=("-d" "*.${parent}.${sub}.${DOMAIN}")
          DOMAIN_IDENT_COUNT=$((DOMAIN_IDENT_COUNT + 1))
        done
        DOMAINS+=("-d" "*.${prefix}.${sub}.${DOMAIN}")
        DOMAIN_IDENT_COUNT=$((DOMAIN_IDENT_COUNT + 1))
      fi
    done <<< "${SITE_SUBS}"
  fi
done <<< "${WILDCARD_SUBS}"

EXTRA_CERT_DOMAINS=()
for ed in "${EXTRA_DOMAINS[@]}"; do
  ed=$(echo "$ed" | xargs)
  [ -z "$ed" ] && continue
  EXTRA_CERT_DOMAINS+=("-d" "${ed}" "-d" "*.${ed}")
  ED_IDENT_COUNT=2
  EXTRA_WILDCARD_SUBS=$(echo "${SITES_JSON}" | jq -r --arg bd "$ed" '.[] | select(.wildcard == true and (.base_domain // "") == $bd) | .subdomain' 2>/dev/null || true)
  while IFS= read -r sub; do
    [ -z "${sub}" ] && continue
    if [ ${ED_IDENT_COUNT} -ge 95 ]; then
      echo "WARNING: Approaching LE 100-identifier limit for ${ed} (current: ${ED_IDENT_COUNT}). Skipping remaining subdomain wildcards."
      break
    fi
    EXTRA_CERT_DOMAINS+=("-d" "*.${sub}.${ed}")
    ED_IDENT_COUNT=$((ED_IDENT_COUNT + 1))
    if [[ "${sub}" == *.* ]]; then
      EXTRA_CERT_DOMAINS+=("-d" "${sub}.${ed}")
      ED_IDENT_COUNT=$((ED_IDENT_COUNT + 1))
    fi
  done <<< "${EXTRA_WILDCARD_SUBS}"
  while IFS= read -r sub; do
    [ -z "${sub}" ] && continue
    if [ ${ED_IDENT_COUNT} -ge 95 ]; then
      echo "WARNING: Approaching LE 100-identifier limit for ${ed} (current: ${ED_IDENT_COUNT}). Skipping remaining deep wildcards."
      break
    fi
    SITE_SUBS=$(echo "${SITES_JSON}" | jq -r --arg s "${sub}" --arg bd "$ed" '.[] | select(.subdomain == $s and .wildcard == true and (.base_domain // "") == $bd) | .subdomains[]?' 2>/dev/null || true)
    if [ -n "${SITE_SUBS}" ]; then
      while IFS= read -r prefix; do
        [ -z "${prefix}" ] && continue
        if [ ${ED_IDENT_COUNT} -ge 95 ]; then
          echo "WARNING: Approaching LE 100-identifier limit for ${ed} (current: ${ED_IDENT_COUNT}). Skipping remaining deep wildcards."
          break 2
        fi
        parts=(${prefix//./ })
        if [ ${#parts[@]} -eq 1 ]; then
          EXTRA_CERT_DOMAINS+=("-d" "*.${prefix}.${sub}.${ed}")
          ED_IDENT_COUNT=$((ED_IDENT_COUNT + 1))
        else
          for ((i=1; i<${#parts[@]}; i++)); do
            parent=$(IFS=.; echo "${parts[*]:i}")
            EXTRA_CERT_DOMAINS+=("-d" "*.${parent}.${sub}.${ed}")
            ED_IDENT_COUNT=$((ED_IDENT_COUNT + 1))
          done
          EXTRA_CERT_DOMAINS+=("-d" "*.${prefix}.${sub}.${ed}")
          ED_IDENT_COUNT=$((ED_IDENT_COUNT + 1))
        fi
      done <<< "${SITE_SUBS}"
    fi
  done <<< "${EXTRA_WILDCARD_SUBS}"
done

CERTBOT_ARGS=(
  certonly
  --dns-cloudflare
  --dns-cloudflare-credentials "${CREDENTIALS_FILE}"
  --dns-cloudflare-propagation-seconds 30
  --agree-tos
  --email "admin@${DOMAIN}"
  --non-interactive
  --expand
  --force-renewal
  --cert-name "${CERT_NAME}"
  "${DOMAINS[@]}"
)

if [ "${1:-}" = "--dry-run" ]; then
  echo ""
  echo "=== DRY RUN ==="
  echo "Would run:"
  echo "  certbot ${CERTBOT_ARGS[*]}"
  echo ""
  echo "Domains in cert:"
  for d in "${DOMAINS[@]}"; do
    [ "$d" = "-d" ] && continue
    echo "  - $d"
  done
  if [ ${#EXTRA_CERT_DOMAINS[@]} -gt 0 ]; then
    echo ""
    echo "Extra domain cert:"
    for d in "${EXTRA_CERT_DOMAINS[@]}"; do
      [ "$d" = "-d" ] && continue
      echo "  - $d"
    done
  fi
  exit 0
fi

echo ""
echo "Issuing certificate with domains:"
for d in "${DOMAINS[@]}"; do
  [ "$d" = "-d" ] && continue
  echo "  - $d"
done
echo ""

certbot "${CERTBOT_ARGS[@]}" || {
  echo "WARNING: Primary domain cert issuance failed (rate limit or error). Continuing to extra domains..."
}

if [ ${#EXTRA_CERT_DOMAINS[@]} -gt 0 ]; then
  for ed in "${EXTRA_DOMAINS[@]}"; do
    ed=$(echo "$ed" | xargs)
    [ -z "$ed" ] && continue
    echo ""
    echo "Issuing certificate for extra domain: ${ed}"
    EXTRA_DOMS=()
    for d in "${EXTRA_CERT_DOMAINS[@]}"; do
      [ "$d" = "-d" ] && continue
      if [[ "$d" == *."${ed}" || "$d" == "${ed}" ]]; then
        EXTRA_DOMS+=("-d" "$d")
      fi
    done
    if [ ${#EXTRA_DOMS[@]} -gt 0 ]; then
      echo "Domains in cert:"
      for d in "${EXTRA_DOMS[@]}"; do
        [ "$d" = "-d" ] && continue
        echo "  - $d"
      done
      echo ""
      certbot certonly \
        --dns-cloudflare \
        --dns-cloudflare-credentials "${CREDENTIALS_FILE}" \
        --dns-cloudflare-propagation-seconds 30 \
        --agree-tos \
        --email "admin@${ed}" \
        --non-interactive \
        --expand \
        --force-renewal \
        --cert-name "${ed}" \
        "${EXTRA_DOMS[@]}" || {
          echo "WARNING: Extra domain ${ed} cert issuance failed. Continuing..."
        }
    fi
  done
fi

PUBLIC_CREDS_FILE=""
if [ -n "${PUBLIC_CF_API_TOKEN:-}" ]; then
  PUBLIC_CREDS_FILE=$(mktemp)
  echo "dns_cloudflare_api_token=${PUBLIC_CF_API_TOKEN}" > "${PUBLIC_CREDS_FILE}"
  chmod 600 "${PUBLIC_CREDS_FILE}"
  echo "Created temporary credentials file for public CF token"
fi

trap '[ -n "${PUBLIC_CREDS_FILE}" ] && rm -f "${PUBLIC_CREDS_FILE}"' EXIT

if [ -n "${DOMAINS_JSON}" ]; then
  USER_DOMAIN_INFO=$(echo "${DOMAINS_JSON}" | jq -r '.domains[]? | select(.status == "active" or .status == "ready") | "\(.domain)|\(if .owner then "public" else "private" end)|\(if .cf_proxied == null then true else .cf_proxied end)"' 2>/dev/null) || true
  if [ -n "${USER_DOMAIN_INFO}" ]; then
    echo ""
    echo "=== User-added domains ==="
    while IFS='|' read -r ud cf_source cf_proxied; do
      [ -z "${ud}" ] && continue
      SKIP=false
      if [ "${ud}" = "${DOMAIN}" ]; then SKIP=true; fi
      for ed in "${EXTRA_DOMAINS[@]}"; do
        if [ "${ud}" = "$(echo "$ed" | xargs)" ]; then SKIP=true; fi
      done
      if [ "${SKIP}" = "true" ]; then continue; fi

      if [ "${cf_source}" = "public" ] && [ -n "${PUBLIC_CREDS_FILE}" ]; then
        UD_CREDS="${PUBLIC_CREDS_FILE}"
        echo "Issuing cert for user-added domain: ${ud} (using public CF token)"
      else
        UD_CREDS="${CREDENTIALS_FILE}"
        echo "Issuing cert for user-added domain: ${ud} (using private CF token)"
      fi

      if [ "${cf_proxied}" = "true" ]; then
        echo "  Domain is proxied (orange cloud) — using dash format, no deep wildcards needed"
        UD_DOMAINS=("-d" "${ud}" "-d" "*.${ud}")
        UD_IDENT_COUNT=2
        UD_WILDCARD_SUBS=$(echo "${SITES_JSON}" | jq -r --arg bd "${ud}" '.[] | select(.wildcard == true and (.base_domain // "") == $bd) | .subdomain' 2>/dev/null) || true
        if [ -n "${UD_WILDCARD_SUBS}" ]; then
          while IFS= read -r sub; do
            [ -z "${sub}" ] && continue
            if [ ${UD_IDENT_COUNT} -ge 95 ]; then
              echo "  WARNING: Approaching LE 100-identifier limit (current: ${UD_IDENT_COUNT}). Skipping remaining subdomain wildcards."
              break
            fi
            if [[ "${sub}" == *.* ]]; then
              UD_DOMAINS+=("-d" "${sub}.${ud}")
              UD_DOMAINS+=("-d" "*.${sub}.${ud}")
              UD_IDENT_COUNT=$((UD_IDENT_COUNT + 2))
            fi
          done <<< "${UD_WILDCARD_SUBS}"
        fi
      else
        echo "  Domain is DNS-only (grey cloud) — using dot format, issuing deep wildcards"
        UD_DOMAINS=("-d" "${ud}" "-d" "*.${ud}")
        UD_IDENT_COUNT=2

      UD_WILDCARD_SUBS=$(echo "${SITES_JSON}" | jq -r --arg bd "${ud}" '.[] | select(.wildcard == true and (.base_domain // "") == $bd) | .subdomain' 2>/dev/null) || true
      if [ -n "${UD_WILDCARD_SUBS}" ]; then
        while IFS= read -r sub; do
          [ -z "${sub}" ] && continue
          if [ ${UD_IDENT_COUNT} -ge 95 ]; then
            echo "  WARNING: Approaching LE 100-identifier limit (current: ${UD_IDENT_COUNT}). Skipping remaining subdomain wildcards."
            break
          fi
          UD_DOMAINS+=("-d" "*.${sub}.${ud}")
          UD_IDENT_COUNT=$((UD_IDENT_COUNT + 1))
          if [[ "${sub}" == *.* ]]; then
            UD_DOMAINS+=("-d" "${sub}.${ud}")
            UD_IDENT_COUNT=$((UD_IDENT_COUNT + 1))
          fi
        done <<< "${UD_WILDCARD_SUBS}"

        while IFS= read -r sub; do
          [ -z "${sub}" ] && continue
          if [ ${UD_IDENT_COUNT} -ge 95 ]; then
            echo "  WARNING: Approaching LE 100-identifier limit (current: ${UD_IDENT_COUNT}). Skipping remaining deep wildcards."
            break
          fi
          UD_SITE_SUBS=$(echo "${SITES_JSON}" | jq -r --arg s "${sub}" --arg bd "${ud}" '.[] | select(.subdomain == $s and .wildcard == true and (.base_domain // "") == $bd) | .subdomains[]?' 2>/dev/null) || true
          if [ -n "${UD_SITE_SUBS}" ]; then
            while IFS= read -r prefix; do
              [ -z "${prefix}" ] && continue
              if [ ${UD_IDENT_COUNT} -ge 95 ]; then
                echo "  WARNING: Approaching LE 100-identifier limit (current: ${UD_IDENT_COUNT}). Skipping remaining deep wildcards."
                break 2
              fi
              parts=(${prefix//./ })
              if [ ${#parts[@]} -eq 1 ]; then
                UD_DOMAINS+=("-d" "*.${prefix}.${sub}.${ud}")
                UD_IDENT_COUNT=$((UD_IDENT_COUNT + 1))
              else
                for ((i=1; i<${#parts[@]}; i++)); do
                  parent=$(IFS=.; echo "${parts[*]:i}")
                  UD_DOMAINS+=("-d" "*.${parent}.${sub}.${ud}")
                  UD_IDENT_COUNT=$((UD_IDENT_COUNT + 1))
                done
                UD_DOMAINS+=("-d" "*.${prefix}.${sub}.${ud}")
                UD_IDENT_COUNT=$((UD_IDENT_COUNT + 1))
              fi
            done <<< "${UD_SITE_SUBS}"
          fi
        done <<< "${UD_WILDCARD_SUBS}"
      fi
      fi

      echo "Domains in cert:"
      for d in "${UD_DOMAINS[@]}"; do
        [ "$d" = "-d" ] && continue
        echo "  - $d"
      done
      echo ""
      certbot certonly \
        --dns-cloudflare \
        --dns-cloudflare-credentials "${UD_CREDS}" \
        --dns-cloudflare-propagation-seconds 30 \
        --agree-tos \
        --email "admin@${ud}" \
        --non-interactive \
        --expand \
        --force-renewal \
        --cert-name "${ud}" \
        "${UD_DOMAINS[@]}" || {
          echo "WARNING: User domain ${ud} cert issuance failed. Continuing..."
          echo "  If this is a 'zone_id' error, the CF token doesn't have access"
          echo "  to this domain's Cloudflare zone. Make sure PUBLIC_CF_API_TOKEN"
          echo "  is set and has DNS edit permissions for ${ud}."
        }
    done <<< "${USER_DOMAIN_INFO}"
  else
    echo "No user-added domains found."
  fi
fi

echo ""
echo "Certificate issued. nginx will be restarted by the engine to pick up new certs."

echo ""
echo "Done! All wildcard subdomains are now covered by the certificate."
echo "Renewal is automatic — add this to crontab for monthly renewal:"
echo "  0 3 1 * * ${COMPOSE_DIR}/scripts/issue-wildcard-certs.sh >> /var/log/unidral-certs.log 2>&1"
