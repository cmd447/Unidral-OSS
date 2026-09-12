# Installing Unidral on AWS EC2 — Beginner's Guide

This guide walks through deploying Unidral Engine on a fresh AWS EC2 instance running Ubuntu, from zero to a live stack with HTTPS. No prior AWS experience assumed — every command is included.

**Time:** ~45 minutes
**Cost:** A t3.small (~$15/mo) or t3.micro free-tier instance is enough to start.

---

## What you'll need before starting

- An **AWS account** (sign up at https://aws.amazon.com — requires a credit card, but a free-tier instance costs nothing for the first 12 months)
- A **domain name** registered somewhere (Namecheap, Porkbun, Cloudflare Registrar, anywhere)
- The domain's DNS managed by **Cloudflare** (free plan is fine — see Step 5)
- A **Firebase project** with Firestore enabled (free Spark plan is fine — see Step 9)
- A computer with a terminal (macOS/Linux have one built-in; on Windows use PowerShell or install [Git Bash](https://git-scm.com/downloads))

---

## Step 1 — Launch an EC2 instance

1. Sign in to the AWS Console at https://console.aws.amazon.com

2. In the top-right corner, pick a region close to you (e.g. `us-east-1` N. Virginia, `eu-west-1` Ireland). Remember this — you'll need to be in the same region to find your instance later.

3. In the search bar at the top, type **EC2** and click the EC2 service.

4. Click **Launch instance**.

5. Fill in the form:

   - **Name:** `unidral`
   - **Application and OS Images:** click **Ubuntu** → select **Ubuntu 24.04 LTS** (the one with the 64-bit x86 AMI)
   - **Instance type:** `t3.small` (recommended — 2 vCPU, 2 GB RAM). If you're on free tier and want to test first, `t2.micro` works but may be slow.
   - **Key pair:** click **Create new key pair**
     - Name: `unidral-key`
     - Type: RSA
     - Format: `.pem` (for macOS/Linux/Windows PowerShell) or `.ppk` if you use PuTTY
     - Click **Create** — your browser downloads the key file. **Keep this safe — you can't download it again.**
   - **Network settings:** leave defaults, but make sure these are checked:
     - **Allow SSH traffic from:** `Anywhere` (or `My IP` for better security)
     - **Allow HTTP traffic from the internet** ✓
     - **Allow HTTPS traffic from the internet** ✓
   - **Configure storage:** change to **30 GB** gp3 (the default 8 GB is tight for Docker images + certbot)
   - Click **Launch instance**

6. Wait ~30 seconds, then click **View all instances**. You'll see your instance listed as `Pending` then `Running`.

---

## Step 2 — Allocate a static Elastic IP

By default, EC2 gives your instance a public IP that changes on every stop/start. You need a fixed IP so your DNS records don't break.

1. In the EC2 sidebar (left), scroll down to **Network & Security** → **Elastic IPs**.

2. Click **Allocate Elastic IP address**.

3. Leave defaults (Amazon's pool, `us-east-1` or whatever region you picked) → click **Allocate**.

4. You now have a static IP (e.g. `54.210.83.91`). Select it → click **Associate**.

5. Choose your `unidral` instance → click **Associate**.

6. Copy the Elastic IP — you'll need it for DNS in the next step.

> **Note:** Elastic IPs are free while associated with a running instance. If you stop the instance, AWS charges ~$3/mo for the idle IP. Just don't stop the instance and you're fine.

---

## Step 3 — Connect to your instance via SSH

### On macOS / Linux / Git Bash (Windows)

1. Find your downloaded key file (e.g. `~/Downloads/unidral-key.pem`).

2. Move it somewhere stable and lock down permissions (SSH refuses to use keys that are world-readable):

   ```bash
   mkdir -p ~/.ssh
   mv ~/Downloads/unidral-key.pem ~/.ssh/unidral-key.pem
   chmod 400 ~/.ssh/unidral-key.pem
   ```

3. Connect (replace `54.210.83.91` with your Elastic IP):

   ```bash
   ssh -i ~/.ssh/unidral-key.pem ubuntu@54.210.83.91
   ```

4. The first time you connect, SSH asks `Are you sure you want to continue connecting?` — type `yes` and press Enter.

5. You're now in. Your prompt should look like `ubuntu@ip-10-0-1-42:~$`.

### On Windows (PowerShell)

PowerShell ships with a built-in SSH client on Windows 10/11. Same command:

```powershell
ssh -i $env:USERPROFILE\Downloads\unidral-key.pem ubuntu@54.210.83.91
```

If Windows complains about key permissions being too open:

```powershell
icacls $env:USERPROFILE\Downloads\unidral-key.pem /inheritance:r
icacls $env:USERPROFILE\Downloads\unidral-key.pem /grant:r "$($env:USERNAME):(R)"
```

Then retry the `ssh` command.

---

## Step 4 — Update the system

Once you're in the Ubuntu terminal, update everything:

```bash
sudo apt-get update && sudo apt-get upgrade -y
```

If the upgrade installs a new kernel, reboot:

```bash
sudo reboot
```

Wait ~20 seconds, then reconnect with the same `ssh` command from your local machine.

---

## Step 5 — Point your domain at the VPS via Cloudflare

If your domain isn't already on Cloudflare, add it:

1. Sign up / sign in at https://dash.cloudflare.com
2. Click **Add a site** → enter your domain (e.g. `mydomain.com`)
3. Select the **Free** plan
4. Cloudflare scans your existing DNS records. Review them, then click **Continue**
5. Cloudflare gives you two nameservers (e.g. `ada.ns.cloudflare.com` and `bob.ns.cloudflare.com`). Go to your domain registrar (where you bought the domain), find the nameserver settings, and replace the defaults with Cloudflare's. Save.
6. Back on Cloudflare, click **Done, check nameservers**. Propagation usually takes 10–60 minutes. You'll get an email when it's done.

Once your domain is active on Cloudflare, add the DNS records:

1. In Cloudflare, go to **DNS → Records** → **Add record**

2. Add the apex A record:

   | Field | Value |
   |---|---|
   | Type | `A` |
   | Name | `@` (or your domain root) |
   | IPv4 address | `54.210.83.91` (your Elastic IP) |
   | Proxy status | **Proxied** (orange cloud) |
   | TTL | Auto |

3. Add the wildcard A record:

   | Field | Value |
   |---|---|
   | Type | `A` |
   | Name | `*` |
   | IPv4 address | `54.210.83.91` |
   | Proxy status | **Proxied** (orange cloud) |
   | TTL | Auto |

4. Click **Save** on both.

> **Why the wildcard?** Unidral serves each proxied site on its own subdomain (`site1.mydomain.com`, `site2.mydomain.com`, …). The wildcard `*` record covers all of them in one go.

---

## Step 6 — Create a Cloudflare API token

The engine needs a Cloudflare API token to manage DNS records and issue SSL certs automatically.

1. In Cloudflare, go to **My Profile** (top-right) → **API Tokens** → **Create Token**

2. Click **Edit zone DNS** template → **Use template**

3. Under **Permissions**, it should already say:
   - `Zone` → `DNS` → `Edit`

4. Under **Zone Resources**, select:
   - `Include` → `Specific zone` → `mydomain.com` (your domain)

5. Click **Continue to summary** → **Create Token**

6. Copy the token. It looks like `v1.0-abc123def456...`. **Save it somewhere — you'll paste it into the setup wizard.**

7. Also grab your **Account ID** — it's on the right side of any Cloudflare dashboard page, or in the URL: `https://dash.cloudflare.com/<account_id>`. Copy that too.

---

## Step 7 — Set up Firebase / Firestore

Unidral uses Firestore as its database for site configs, rules, and domains.

1. Go to https://console.firebase.google.com → **Create a project** (or use an existing one)

2. Name it (e.g. `unidral-prod`) → disable Google Analytics (not needed) → **Create project**

3. In the Firebase console, click the **Build** sidebar → **Firestore Database** → **Create database**

4. Pick **Start in production mode** → choose a region close to your EC2 region → **Enable**

5. Now create a service account key so the engine can talk to Firestore:
   - Click the **gear icon** next to **Project Overview** → **Project settings**
   - Go to the **Service accounts** tab
   - Click **Generate new private key** → **Generate key**
   - A JSON file downloads (e.g. `unidral-prod-firebase-adminsdk-xxxxx.json`). Open it in a text editor — you'll paste the entire JSON into the setup wizard.

6. Copy your **Project ID** from the same page (e.g. `unidral-prod`).

---

## Step 8 — Clone the repo and run setup.sh

Back in your SSH session on the EC2 instance:

```bash
git clone https://github.com/cmd447/Unidral-OSS.git
cd Unidral-OSS
sudo bash setup.sh
```

`setup.sh` runs through the following automatically:

1. **Installs Docker** via the official `get.docker.com` script
2. **Installs jq** for JSON parsing
3. **Installs certbot and `certbot-dns-cloudflare`** for Let's Encrypt wildcard certs via DNS challenge
4. **Installs Cloudflare WARP** (optional) and socat for egress IP diversity
5. **Opens ports 80 and 443** in ufw if it's active
6. **Copies `.env.example` to `.env`** and generates a random one-time `SETUP_KEY`
7. **Builds and starts** the engine, dashboard, and nginx — nginx detects setup mode and serves the dashboard over HTTP on port 80

This takes 5–10 minutes. When it finishes, it prints:

```
==========================================
 Setup Mode Initialized
==========================================

 Complete the onboarding wizard in your browser:

   http://54.210.83.91/setup?key=abc123def456...

 Prerequisites installed:
   - Docker
   - jq
   - certbot + certbot-dns-cloudflare (for SSL)
   - Cloudflare WARP (for egress IP diversity)
   - socat (WARP forwarder for Docker)

==========================================
```

Copy that URL — you'll need it for the next step.

> **Can't reach the setup page?** The setup wizard runs on port 80 (standard HTTP). Make sure your EC2 security group has ports 80 and 443 open:
> - EC2 console → your instance → **Security** tab → click the security group → **Edit inbound rules** → **Add rule**:
>   - Type: `HTTP` | Port: `80` | Source: `0.0.0.0/0`
>   - Type: `HTTPS` | Port: `443` | Source: `0.0.0.0/0`
> - **Save rules**
>
> Not sure which security group is attached to your instance? Run this on the VPS:
> ```bash
> TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
> curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/security-groups
> ```

---

## Step 9 — Complete the web wizard

Open the setup URL in your browser:

```
http://54.210.83.91/setup?key=abc123def456...
```

The wizard has four steps:

### Step 9.1 — Domain

- **Base domain:** `mydomain.com` (your domain, no `https://`, no trailing slash)
- **Dashboard subdomain:** `dashboard` (default — the dashboard will live at `dashboard.mydomain.com`)
- **API subdomain:** `api` (default — the API will live at `api.mydomain.com`)
- **VPS IP:** auto-detected from the server, but verify it matches your Elastic IP

Click **Verify DNS** — the wizard probes a random subdomain to confirm the wildcard DNS works. If it fails, wait a few minutes for DNS propagation and retry.

Click **Next**.

### Step 9.2 — Cloudflare

- **Cloudflare API token:** paste the token you created in Step 6
- **Cloudflare Account ID:** paste the account ID from Step 6

Click **Validate** — the wizard checks the token against Cloudflare's API. If it passes, click **Next**.

### Step 9.3 — Firebase

- **Firebase Project ID:** `unidral-prod` (from Step 7)
- **Service Account JSON:** open the JSON file you downloaded in Step 7, copy the entire contents, and paste it here. The wizard base64-encodes it automatically.

Click **Next**.

### Step 9.4 — Launch

Click **Initialize**. The wizard now:

1. Writes all config to `.env`
2. Creates a `.installed` lock file (prevents re-running the wizard)
3. Writes `cloudflare.ini` for certbot
4. Restarts the server with the new config
5. Issues a Let's Encrypt wildcard SSL certificate (this takes 30–90 seconds — it's creating DNS TXT records and waiting for propagation)
6. Starts nginx in production mode with TLS
7. Installs a monthly cert renewal cron job at `/etc/cron.d/unidral-certs`

You'll see live output streaming from each step. When it finishes, you'll see:

```
==========================================
 Installation complete!
==========================================
 Dashboard: https://dashboard.mydomain.com
 API:       https://api.mydomain.com
==========================================
```

---

## Step 10 — Verify the deployment

Open these URLs in your browser:

| Service | URL | What you should see |
|---|---|---|
| Dashboard | `https://dashboard.mydomain.com` | The Unidral dashboard (sites list) |
| API | `https://api.mydomain.com/__unidral/health` | JSON with engine status |
| Apex | `https://mydomain.com` | A 404 page (intentional — the apex doesn't expose the backend) |

If the dashboard loads and you can create a site, you're live.

### Common issues

**`ERR_CONNECTION_REFUSED` or browser can't reach the dashboard:**
- Check the EC2 security group has ports 80 and 443 open
- Check the Elastic IP is associated with your instance
- Check DNS propagation: `dig dashboard.mydomain.com` should return your Elastic IP

**`NET::ERR_CERT_AUTHORITY_INVALID`:**
- The self-signed fallback cert is still in use. The wizard should have issued a real cert, but if it failed, run manually:
  ```bash
  cd ~/Unidral-OSS
  bash scripts/issue-wildcard-certs.sh
  ```
  Then restart nginx:
  ```bash
  docker compose --profile production restart nginx
  ```

**Dashboard redirects back to `/setup`:**
- The `.installed` lock file wasn't created. Check it exists:
  ```bash
  ls -la ~/Unidral-OSS/.installed
  ```
  If not, the wizard didn't complete. Re-run `sudo bash setup.sh` and redo the wizard.

**Cert issuance fails with `DNS problem: NXDOMAIN`:**
- DNS hasn't propagated yet. Wait 10 minutes and re-run the cert script.

---

## Step 11 — Verify production traffic

After setup completes, all traffic goes through nginx on ports 80 and 443. No port changes are needed — the setup wizard ran on port 80, and nginx automatically switches to the full TLS production config after the `.installed` lock file is created.

Verify your deployment:

| Service | URL |
|---|---|
| Dashboard | `https://dashboard.mydomain.com` |
| API | `https://api.mydomain.com` |
| Proxied sites | `https://<subdomain>.mydomain.com` |

If you ever need to re-run setup (e.g. after a config reset), delete the `.installed` lock file and restart:

```bash
rm -f .installed
sudo docker compose --profile production restart nginx
```

nginx will detect setup mode and serve the dashboard on port 80 again.

---

## Managing the stack

From your SSH session, in the `~/Unidral-OSS` directory:

```bash
# Start everything (engine + dashboard + nginx)
docker compose --profile production up -d --build

# Stop everything
docker compose --profile production down

# Tail engine logs
docker compose logs -f unidral-server

# Tail dashboard logs
docker compose logs -f unidral-dashboard

# Tail nginx logs
docker compose logs -f nginx

# Restart just the engine
docker compose restart unidral-server

# Rebuild the engine after a code change
docker compose --profile production up -d --build unidral-server

# Reissue SSL certs manually
bash scripts/issue-wildcard-certs.sh

# Restart nginx (e.g. after cert reissue)
docker compose restart nginx
```

---

## Updating Unidral

```bash
cd ~/Unidral-OSS
git pull
docker compose --profile production up -d --build
```

This pulls the latest code, rebuilds the containers, and restarts the stack. Your `.env` and Firestore data are untouched.

---

## Backing up

Your site configs, rules, and domains live in Firestore (managed by Firebase). No local database to back up. To be safe:

- Export your Firestore data periodically from the Firebase console (Firestore → Export data)
- Keep a copy of your `.env` file somewhere off the server:
  ```bash
  scp -i ~/.ssh/unidral-key.pem ubuntu@54.210.83.91:~/Unidral-OSS/.env ~/unidral-env-backup
  ```

---

## Costs overview

| Resource | Free tier | Paid |
|---|---|---|
| EC2 t3.small | — | ~$15/mo |
| EC2 t2.micro | 750 hrs/mo for 12 mo | ~$8/mo after |
| Elastic IP | Free while associated | ~$3/mo if instance stopped |
| Cloudflare | Free plan | — |
| Firebase Firestore | 1 GB storage, 50K reads/day | Pay-as-you-go above that |
| Let's Encrypt certs | Free | — |

For a personal deployment with a handful of sites, you'll stay within free tiers on everything except the EC2 instance itself.

---

## Troubleshooting

### `sudo: docker: command not found` after setup.sh

Docker didn't install. Run it manually:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
```

Log out and back in, then retry `sudo bash setup.sh`.

### `permission denied while trying to connect to the Docker daemon socket`

Your user isn't in the docker group:

```bash
sudo usermod -aG docker ubuntu
```

Log out and back in (or run `newgrp docker`).

### `Cannot reach the Unidral engine` in the dashboard

The engine container isn't running. Check:

```bash
docker compose ps
docker compose logs unidral-server
```

Common causes: missing Firebase credentials, Firestore rules blocking access, or the engine crashed on startup.

### Cert renewal cron didn't run

Check the cron file exists:

```bash
cat /etc/cron.d/unidral-certs
```

If missing, create it manually:

```bash
echo "0 3 1 * * $(pwd)/scripts/issue-wildcard-certs.sh >> /var/log/unidral-certs.log 2>&1" | sudo tee /etc/cron.d/unidral-certs
sudo chmod 644 /etc/cron.d/unidral-certs
sudo service cron reload
```

### Want to start over

To wipe everything and re-run setup:

```bash
cd ~/Unidral-OSS
docker compose --profile production down
rm -f .installed .env
sudo bash setup.sh
```

This keeps your code but removes the lock file and config, letting you run the wizard again.

---

## What's next

- Create your first proxied site from the dashboard at `https://dashboard.mydomain.com`
- Add custom JS/CSS to the proxied site
- Create rules to bind JavaScript to elements (the toolbar on the proxied site lets you do this live)
- Add more domains from the dashboard if you have multiple

See the [main README](../README.md) for the full feature reference and configuration options.
