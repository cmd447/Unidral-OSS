<p align="center">
  <img src="assets/sotware_boxlong.png" alt="Unidral Engine" />
</p>

# Unidral Engine — Free Edition

This is the free, open-source edition of Unidral — a clean reverse-proxy engine for standing up and managing proxy sites. You point it at an upstream website, give it a subdomain on a domain you control, and it serves the upstream's content through your domain — rewriting URLs, injecting your own JS/CSS, and exposing a DevTools-style toolbar so you can inspect and tweak the page live.

It's built for legitimate use cases: development, testing, QA, learning how proxies work, and prototyping front-end modifications against real sites.

### What's included

- Reverse proxy with URL rewriting
- Multi-site management
- Rules system (element binding + JS injection)
- DevTools-style toolbar (Elements, Rules, Console)
- Domain management with automatic wildcard SSL
- Next.js dashboard

### What's not included

The free edition is a clean proxy engine only. Adversary emulation, session capture, anti-detection, egress routing, and operational tooling are all part of **Unidral Pro** — the full platform for security testing and red team operations.

| Feature | Free Edition | Pro |
|---|---|---|
| Reverse proxy + URL rewriting | Yes | Yes |
| Multi-site management | Yes | Yes |
| Rules system | Yes | Yes |
| DevTools toolbar | Elements, Rules, Console | Full (7 tabs) |
| Domain management + SSL | Yes | Yes |
| Session capture | — | Yes |
| Browser-in-the-Browser (BITB) | — | Yes |
| Uni-Con Cell (browser telemetry + auth forwarding) | — | Yes |
| Pages Mode (per-visitor sessions) | — | Yes |
| Telegram exfil notifications | — | Yes |
| WARP/Workers egress routing | — | Yes |
| TLS impersonation | — | Yes |
| Bot detection bypass | — | Yes |
| Forensics, analytics, OpSec dashboards | — | Yes |
| M365 and Google capture modules | — | Yes |
| Custom modules (built on demand) | — | Yes |

Pro ships with M365 and Google capture modules out of the box. Additional modules for other platforms can be built on request after purchasing Pro — contact us with your requirements.

**Get Unidral Pro at [unidral.cc](https://unidral.cc)**

## How it works

```
┌─────────────┐     ┌─────────────────────────────┐     ┌─────────────┐
│  Visitor    │────▶│  nginx  →  Unidral Engine   │────▶│  Target     │
│  Browser    │     │            (Node.js)        │     │  Website    │
└─────────────┘     └─────────────────────────────┘     └─────────────┘
                            │
                     ┌──────┴──────┐
                     │  Dashboard  │
                     │  (Next.js)  │
                     └─────────────┘
```

A request comes in on `something.yourdomain.com`. nginx terminates TLS and forwards it to the engine. The engine looks up the subdomain in Firestore, finds the matching site config, and proxies the request to that site's `target_url`. On the way back, it rewrites the HTML so links, assets, and absolute URLs point back through your domain instead of the original — that's what keeps the proxied site browsing cleanly under your domain.

On top of the raw proxy, the engine:

- **Injects rules** — JavaScript snippets bound to CSS selectors, fired on events like `click` or `submit`, optionally scoped to a URL path pattern. Rules are stored in Firestore and pushed to the toolbar live over SSE.
- **Injects custom JS/CSS** — per-site global styles and scripts applied to every page.
- **Handles CSP** — strip the target's Content-Security-Policy, rewrite it to allow your origin, or pass it through untouched.
- **Serves a toolbar** — a small DevTools-style overlay (`Elements`, `Rules`, `Console` tabs) injected into proxied pages so you can inspect the DOM and manage rules without leaving the page.

The dashboard is a separate Next.js app that talks to the engine's REST API. In production, nginx routes `dashboard.yourdomain.com` to it and `api.yourdomain.com` to the engine; every other subdomain is treated as a proxied site.

## Features

**Engine**
- Reverse proxy with automatic URL rewriting and HTTP/2 support
- Multi-site management (CRUD) backed by Firebase / Firestore
- Rules system — bind JS to selectors, trigger on events, scope by path
- Module framework — extensible, but ships without any modules
- Multi-domain support with automatic wildcard SSL via certbot + Cloudflare DNS
- Per-site custom JS/CSS injection and CSP handling

**Dashboard**
- Site management with live config editing
- Inline rules editor
- Domain and certificate management
- Settings for Firebase, environment, and engine config
- Module browser

**Toolbar**
- Elements tab — DOM tree inspection and element selection
- Rules tab — create, edit, toggle, and delete rules in place
- Console tab — rule execution logs and engine messages
- Inspect mode — click any element to select it and generate a CSS selector

### Dashboard

<p align="center">
  <img src="assets/dashboard.png" alt="Unidral Dashboard" />
</p>

## Install on a VPS

The repo ships with a `setup.sh` script that bootstraps a fresh Ubuntu/Debian VPS end-to-end. It handles Docker, certbot with the Cloudflare DNS plugin, and the rest of the prerequisites, then brings the engine and dashboard up in setup mode so you can finish onboarding through a browser wizard.

### Prerequisites

- A VPS running Ubuntu or Debian, with root/sudo access
- **Minimum 4GB RAM** (Next.js builds are memory-intensive — builds on 2GB instances will be killed by the OOM killer)
- A domain you control, with its DNS managed by Cloudflare (needed for automated wildcard certs)
- A Firebase project with Firestore enabled (or run the Firestore emulator for local-only setups)

### Step 1 — Point your domain at the VPS

In Cloudflare, create an `A` record for your apex domain and a wildcard `*` record, both pointing at the VPS's public IP. Make sure the records are proxied (orange cloud) if you want Cloudflare in front, or DNS-only if you want traffic to hit nginx directly.

```
A     example.com        → 203.0.113.50   (proxied)
A     *.example.com      → 203.0.113.50   (proxied)
```

### Step 2 — Prepare Cloudflare credentials

Create a Cloudflare API token with DNS edit permissions for your zone, and put it in a credentials file for certbot:

```ini
# ~/.secrets/cloudflare.ini
dns_cloudflare_api_token = YOUR_CLOUDFLARE_API_TOKEN
```

```bash
chmod 600 ~/.secrets/cloudflare.ini
```

You'll also need the same Cloudflare API token and your account ID for the engine's own DNS/SSL provisioning — the setup wizard collects these and writes them into `.env` as `CF_API_TOKEN` and `CF_ACCOUNT_ID`.

### Step 3 — Clone and run setup.sh

```bash
sudo apt-get update && sudo apt-get upgrade -y
git clone https://github.com/cmd447/Unidral-OSS.git
cd Unidral-OSS
sudo bash setup.sh
```

<p align="center">
  <img src="assets/setup.png" alt="setup.sh output in terminal" />
</p>

`setup.sh` runs through the following:

1. **Installs Docker** via the official `get.docker.com` script if it's not already present
2. **Installs jq** for JSON parsing (used by the cert script and nginx entrypoint)
3. **Installs certbot and `certbot-dns-cloudflare`** for Let's Encrypt wildcard certs via DNS challenge
4. **Installs Cloudflare WARP** (optional) and socat for egress IP diversity — WARP gives the proxy a different outbound IP than your VPS
5. **Opens ports 80 and 443** in ufw if it's active
6. **Copies `.env.example` to `.env`** and generates a random one-time `SETUP_KEY` that protects the web wizard
7. **Builds and starts** the engine, dashboard, and nginx — nginx detects setup mode (no `.installed` lock file) and serves the dashboard over HTTP on port 80

When it finishes, it prints a URL like:

```
http://YOUR_VPS_IP/setup?key=abc123def456...
```

The setup wizard runs on port 80 (standard HTTP) — no extra firewall rules needed. Just make sure ports 80 and 443 are open in your cloud firewall (AWS Security Groups, Azure NSGs, GCP firewall rules, etc.).

### Step 4 — Complete the web wizard

Open that URL in your browser. The wizard walks through four steps:

<p align="center">
  <img src="assets/setup_dashboard.png" alt="Setup wizard in browser" />
</p>

1. **Domain** — enter your base domain (e.g. `example.com`), choose subdomain names for the dashboard and API (defaults: `dashboard` and `api`), and verify the wildcard DNS resolves to your VPS IP
2. **Cloudflare** — paste your Cloudflare API token and account ID; the wizard validates the token against Cloudflare's API
3. **Firebase** — paste your Firebase project ID and service account JSON; the wizard base64-encodes it automatically if you paste raw JSON

[![Firebase service account JSON](https://img.youtube.com/vi/1ABYkh5xb5M/0.jpg)](https://youtu.be/1ABYkh5xb5M)
4. **Launch** — the wizard writes everything to `.env`, creates a `.installed` lock file, writes `cloudflare.ini` for certbot, restarts the server with the new config, issues the wildcard SSL cert, restarts nginx in production mode (now with TLS), and installs a monthly renewal cron job

The wizard streams live output from each step so you can watch the installation progress. Until this wizard is completed, the dashboard locks all other routes — visiting `/sites`, `/settings`, or any other path redirects back to `/setup`.

### Step 5 — Verify the deployment

After the wizard finishes, the stack is fully live:

| Service | URL |
|---|---|
| Dashboard | `https://dashboard.yourdomain.com` |
| API | `https://api.yourdomain.com` |
| Proxied sites | `https://<subdomain>.yourdomain.com` |

The first nginx start uses a self-signed fallback cert. The wizard triggers a cert reissue automatically, but if the cert isn't ready yet you can reissue manually from the dashboard (Settings → Engine → Reissue certs) or by running:

```bash
bash scripts/issue-wildcard-certs.sh
```

A monthly cron job is installed at `/etc/cron.d/unidral-certs` to renew certs automatically on the 1st of each month at 3 AM.

### Managing the stack

```bash
docker compose --profile production up -d --build   # start everything (engine + dashboard + nginx)
docker compose --profile production down             # stop everything
docker compose logs -f unidral-server                # tail engine logs
docker compose restart unidral-server                 # restart just the engine
```

## Local development

You can run the engine and dashboard directly without Docker.

**Engine** (Node.js >= 24):

```bash
cd server
npm install
npm run dev    # listens on http://0.0.0.0:3000
```

**Dashboard** (Next.js):

```bash
cd dashboard
npm install
npm run dev    # listens on http://localhost:3001
```

For local Firestore, set `FIRESTORE_EMULATOR_HOST=localhost:8080` in `.env` and start the emulator with `firebase emulators:start --only firestore`.

## Docker (without the production profile)

If you just want the engine and dashboard without nginx/TLS — handy for testing behind another proxy:

```bash
docker compose up -d --build
```

This starts `unidral-server` on `:4000` and `unidral-dashboard` on `:3000`.

## Configuration

Copy `.env.example` to `.env` and fill in the values. The ones that matter:

| Variable | What it's for |
|---|---|
| `BASE_DOMAIN` | The domain proxied sites live under |
| `EXTRA_BASE_DOMAINS` | Additional domains, comma-separated |
| `RESERVED_SUBDOMAINS` | Subdomains that won't be treated as sites (default: `dashboard,www,api`) |
| `FIREBASE_PROJECT_ID` | Firebase project ID |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Service account JSON (or use `FIRESTORE_EMULATOR_HOST` for local dev) |
| `CF_API_TOKEN` / `CF_ACCOUNT_ID` | Cloudflare credentials for DNS/SSL provisioning |
| `VPS_IP` / `VPS_IPV6` | The VPS's public IPs, used for DNS records |
| `CLOUDFLARE_CREDENTIALS` | Path to the `cloudflare.ini` used by certbot |
| `DASHBOARD_SUBDOMAIN` / `API_SUBDOMAIN` | Subdomains for the dashboard and API (default: `dashboard`, `api`) |

### Site config

Each proxied site has a config document in Firestore. The main fields:

| Field | Description |
|---|---|
| `subdomain` | Subdomain prefix for this site |
| `target_url` | Upstream URL to proxy |
| `label` | Display name |
| `mode` | `active` or `stopped` |
| `csp_mode` | `strip`, `rewrite`, or `none` |
| `block_ads` | Block ad domains |
| `wildcard` | Accept any subdomain prefix |
| `subdomains` | Known subdomain prefixes |
| `custom_js` | JS injected into all pages |
| `custom_css` | CSS injected into all pages |

### Rules

Rules bind JavaScript to DOM elements:

```json
{
  "name": "Track login clicks",
  "selector": "#login-btn",
  "action": "bind",
  "event": "click",
  "code": "console.log('Login clicked:', event.target);",
  "path_pattern": "*",
  "enabled": true
}
```

## Unidral Pro

<p align="center">
  <img src="assets/software_box1.png" alt="Unidral Pro" />
</p>

Need session capture, adversary emulation, BITB, egress routing, TLS impersonation, or the full operational toolkit? Unidral Pro is the complete platform for security testing and red team operations.

**[unidral.cc](https://unidral.cc)**

## Support

Need help with installation or setup? Reach out:

- **Telegram:** [@unidrals](https://t.me/unidrals)
- **Email:** [info.unidral@gmail.com](mailto:info.unidral@gmail.com)
