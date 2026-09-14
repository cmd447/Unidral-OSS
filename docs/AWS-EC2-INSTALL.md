# Deploying on AWS EC2

This guide covers deploying Unidral Engine on a fresh EC2 instance running Ubuntu 24.04.

**Time:** ~30 minutes
**Cost:** t3.small (~$15/mo) or t3.micro free-tier

## What you need

- AWS account (free tier works)
- A domain with DNS on Cloudflare (free plan)
- A Firebase project with Firestore enabled (free Spark plan)

## Launch the instance

1. EC2 console → **Launch instance**
2. Name: `unidral`
3. AMI: **Ubuntu 24.04 LTS** (64-bit x86)
4. Instance type: `t3.small` (recommended) or `t2.micro` for free tier
5. Key pair: create one, download the `.pem` file: you can't re-download it
6. Network: check **Allow SSH**, **Allow HTTP**, **Allow HTTPS**
7. Storage: **30 GB** gp3 (default 8 GB is too small for Docker)
8. Launch

## Static IP

By default EC2 gives you a public IP that changes on reboot. You need a fixed one.

1. EC2 sidebar → **Elastic IPs** → **Allocate Elastic IP address**
2. Select it → **Associate** → pick your `unidral` instance
3. Copy the Elastic IP: you'll need it for DNS

## Connect via SSH

```bash
chmod 400 ~/Downloads/unidral-key.pem
ssh -i ~/Downloads/unidral-key.pem ubuntu@YOUR_ELASTIC_IP
```

If on Windows PowerShell, same command works. If permissions complain:

```powershell
icacls $env:USERPROFILE\Downloads\unidral-key.pem /inheritance:r
icacls $env:USERPROFILE\Downloads\unidral-key.pem /grant:r "$($env:USERNAME):(R)"
```

## Update the system

```bash
sudo apt-get update && sudo apt-get upgrade -y
```

If a kernel update was installed, `sudo reboot` and reconnect.

## Point your domain at the VPS

In Cloudflare:

1. **DNS → Records → Add record**
2. Apex A record: `@` → your Elastic IP → **Proxied**
3. Wildcard A record: `*` → your Elastic IP → **Proxied**

The wildcard record covers all subdomains (`site1.mydomain.com`, `site2.mydomain.com`, etc.) in one shot.

## Cloudflare API token

The engine needs this to manage DNS and issue SSL certs.

1. **My Profile → API Tokens → Create Token**
2. Template: **Edit zone DNS**
3. Zone Resources: `Include` → `Specific zone` → `mydomain.com`
4. Create and copy the token

Also grab your **Account ID** from the Cloudflare dashboard URL.

## Firebase / Firestore

1. [console.firebase.google.com](https://console.firebase.google.com) → **Create project** (e.g. `unidral-prod`)
2. **Build → Firestore Database → Create database** → production mode → pick a region
3. **Project Settings → Service accounts → Generate new private key** → download the JSON
4. Copy your **Project ID** from the same page

## Clone and run setup

```bash
git clone https://github.com/cmd447/Unidral-OSS.git
cd Unidral-OSS
sudo bash setup.sh
```

This takes 5-10 minutes. When it finishes, it prints a URL like:

```
http://YOUR_ELASTIC_IP/setup?key=abc123def456...
```

If the page doesn't load, make sure ports 80 and 443 are open in your EC2 security group:

- EC2 console → your instance → **Security** tab → click the security group → **Edit inbound rules**
- Add: `HTTP` / `80` / `0.0.0.0/0` and `HTTPS` / `443` / `0.0.0.0/0`

To find which security group your instance uses:

```bash
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/security-groups
```

## Complete the wizard

Open the setup URL in your browser. Four steps:

1. **Domain**: base domain, dashboard/API subdomains, VPS IP. Click **Verify DNS**.
2. **Cloudflare**: paste your API token and account ID. Click **Validate**.
3. **Firebase**: paste your project ID and service account JSON.
4. **Launch**: click **Initialize**. The wizard writes `.env`, creates the `.installed` lock file, issues a wildcard SSL cert, and switches nginx to production mode.

## Verify

| Service | URL |
|---|---|
| Dashboard | `https://dashboard.mydomain.com` |
| API | `https://api.mydomain.com` |
| Proxied sites | `https://<subdomain>.mydomain.com` |

## Managing the stack

```bash
docker compose --profile production up -d --build   # start / rebuild
docker compose --profile production down            # stop
docker compose logs -f unidral-server               # engine logs
docker compose logs -f unidral-dashboard            # dashboard logs
docker compose restart unidral-server               # restart engine
bash scripts/issue-wildcard-certs.sh                # reissue SSL certs
```

## Updating

```bash
cd ~/Unidral-OSS
git pull
docker compose --profile production up -d --build
```

## Troubleshooting

**`ERR_CONNECTION_REFUSED`**: check the security group has 80/443 open, check DNS propagation (`dig dashboard.mydomain.com`).

**`NET::ERR_CERT_AUTHORITY_INVALID`**: self-signed fallback cert is still in use. Reissue:
```bash
bash scripts/issue-wildcard-certs.sh
docker compose restart nginx
```

**Redirects back to `/setup`**: the `.installed` lock file wasn't created. Check `ls -la .installed` and re-run `sudo bash setup.sh` if needed.

**`signal: killed` during build**: the instance ran out of RAM during `next build`. You need at least 4GB. Upgrade to `t3.medium` or add swap.

**Start over**: wipe config and re-run the wizard:
```bash
docker compose --profile production down
rm -f .installed .env
sudo bash setup.sh
```
