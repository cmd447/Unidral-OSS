FROM nginx:1.27-alpine

RUN apk add --no-cache curl jq openssl

RUN mkdir -p /etc/nginx/ssl-fallback && \
    openssl req -x509 -newkey rsa:2048 \
      -keyout /etc/nginx/ssl-fallback/privkey.pem \
      -out /etc/nginx/ssl-fallback/fullchain.pem \
      -days 3650 -nodes \
      -subj "/CN=unidral-fallback" >/dev/null 2>&1
