FROM node:24-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash docker.io git curl jq certbot python3-pip tini \
    && pip install --break-system-packages certbot-dns-cloudflare \
    && pip cache purge \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=4000

COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY . .

EXPOSE 4000

CMD ["tini", "--", "node", "--max-http-header-size=131072", "index.js"]
