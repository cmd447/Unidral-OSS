#!/usr/bin/env bash
# Runs inside the unidral-server container via the mounted docker socket.
# Schedules a delayed restart so the HTTP response stream can finish first.
set -u

echo "[env] .env updated — scheduling container restart..."

nohup bash -c 'sleep 2; docker restart unidral-nginx >/dev/null 2>&1; docker restart unidral-server >/dev/null 2>&1' >/dev/null 2>&1 &
disown

echo "[env] Restart scheduled — the engine will be back in a few seconds."
exit 0
