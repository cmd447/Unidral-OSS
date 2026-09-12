#!/usr/bin/env bash
set -e

echo "=========================================="
echo "      Unidral Engine — VPS Setup          "
echo "=========================================="
echo ""

if ! command -v docker &> /dev/null; then
    echo "[+] Installing Docker..."
    curl -fsSL https://get.docker.com | sh
else
    echo "[+] Docker already installed."
fi

if ! command -v jq &> /dev/null; then
    echo "[+] Installing jq..."
    sudo apt-get update -y && sudo apt-get install -y jq || true
else
    echo "[+] jq already installed."
fi

if ! command -v certbot &> /dev/null; then
    echo "[+] Installing certbot + certbot-dns-cloudflare..."
    sudo apt-get update -y && sudo apt-get install -y certbot python3-certbot-dns-cloudflare || true
else
    echo "[+] certbot already installed."
    if ! certbot plugins --text 2>&1 | grep -q dns-cloudflare; then
        echo "[+] Installing certbot-dns-cloudflare plugin..."
        sudo apt-get install -y python3-certbot-dns-cloudflare || true
    fi
fi

if ! command -v warp-cli &> /dev/null; then
    echo "[+] Installing Cloudflare WARP client..."
    curl -fsSL https://pkg.cloudflareclient.com/install | sudo bash || {
        echo "[!] WARP installation failed. You can install it manually later."
        echo "    See: https://developers.cloudflare.com/warp-client/warp-macos/"
    }
else
    echo "[+] Cloudflare WARP already installed."
fi

if command -v warp-cli &> /dev/null; then
    echo "[+] Configuring WARP..."
    warp-cli registration new 2>/dev/null || true
    warp-cli mode proxy 2>/dev/null || true
    warp-cli connect 2>/dev/null || true
    echo "[+] WARP is running in proxy mode (SOCKS5 on 127.0.0.1:40000)."
fi

if ! command -v socat &> /dev/null; then
    echo "[+] Installing socat..."
    sudo apt-get install -y socat || true
else
    echo "[+] socat already installed."
fi

if command -v socat &> /dev/null && command -v warp-cli &> /dev/null; then
    pkill -f "socat TCP-LISTEN:40000.*TCP:127.0.0.1:40000" 2>/dev/null || true
    nohup socat TCP-LISTEN:40000,bind=172.18.0.1,reuseaddr,fork TCP:127.0.0.1:40000 &>/dev/null &
    echo "[+] socat forwarder started: 172.18.0.1:40000 -> 127.0.0.1:40000"
fi

if command -v ufw &> /dev/null && ufw status | grep -q "active"; then
    echo "[+] Opening ports 80 and 443 in ufw..."
    sudo ufw allow 80/tcp
    sudo ufw allow 443/tcp
else
    echo "[+] ufw not active — skipping local firewall rules."
fi

if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        echo "[+] Copying .env.example to .env..."
        cp .env.example .env
    else
        echo "[!] Warning: .env.example not found. Creating empty .env..."
        touch .env
    fi
fi

SETUP_KEY=$(openssl rand -hex 16 2>/dev/null || head -c 16 /dev/urandom | xxd -p || echo "setup_$(date +%s)")

if grep -q "^SETUP_KEY=" .env; then
    sed -i "s/^SETUP_KEY=.*/SETUP_KEY=${SETUP_KEY}/" .env
else
    echo "SETUP_KEY=${SETUP_KEY}" >> .env
fi

VPS_IP=$(curl -s -4 https://ifconfig.me || curl -s -4 https://api.ipify.org || echo "YOUR_VPS_IP")

echo ""
echo "[+] Starting Unidral Engine in setup mode..."
docker compose --profile production up -d --build

echo ""
echo "=========================================="
echo " Setup Mode Initialized"
echo "=========================================="
echo ""
echo " Complete the onboarding wizard in your browser:"
echo ""
echo "   http://${VPS_IP}/setup?key=${SETUP_KEY}"
echo ""
echo " Port 80 is used (standard HTTP) — no extra firewall rules needed."
echo " If port 80 is not open in your cloud firewall:"
echo "   AWS:    EC2 → Security Groups → Inbound → HTTP (80) → 0.0.0.0/0"
echo "   Or use an SSH tunnel:"
echo "     ssh -L 80:localhost:80 ubuntu@${VPS_IP}"
echo "   Then open http://localhost/setup?key=${SETUP_KEY}"
echo ""
echo " Prerequisites installed:"
echo "   - Docker"
echo "   - jq"
echo "   - certbot + certbot-dns-cloudflare (for SSL)"
echo "   - Cloudflare WARP (for egress IP diversity)"
echo "   - socat (WARP forwarder for Docker)"
echo ""
echo "=========================================="
