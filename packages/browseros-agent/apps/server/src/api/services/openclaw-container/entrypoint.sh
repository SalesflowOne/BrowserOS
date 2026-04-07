#!/bin/bash
set -e

# Ports — mirrors BrowserOSAppManager pattern
CDP_PORT=9000
SERVER_PORT=9100
EXTENSION_PORT=9300

# 1. Launch BrowserOS (browser only, server disabled — matches --manual mode)
browseros \
  --headless=new \
  --no-sandbox \
  --disable-gpu \
  --disable-software-rasterizer \
  --disable-dev-shm-usage \
  --no-zygote \
  --single-process \
  --no-first-run \
  --no-default-browser-check \
  --use-mock-keychain \
  --disable-browseros-server \
  --disable-browseros-extensions \
  --remote-debugging-port=$CDP_PORT \
  --browseros-mcp-port=$SERVER_PORT \
  --browseros-extension-port=$EXTENSION_PORT \
  --window-size=1440,900 \
  --user-data-dir=/tmp/browseros-data \
  about:blank \
  &

echo "[entrypoint] Waiting for BrowserOS CDP on port $CDP_PORT..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:$CDP_PORT/json/version > /dev/null 2>&1; then
    echo "[entrypoint] CDP ready"
    break
  fi
  sleep 1
done

# 2. Launch BrowserOS server (connects to browser via CDP)
BROWSEROS_CDP_PORT=$CDP_PORT \
BROWSEROS_SERVER_PORT=$SERVER_PORT \
BROWSEROS_EXTENSION_PORT=$EXTENSION_PORT \
NODE_ENV=production \
  browseros_server \
  --cdp-port $CDP_PORT \
  --server-port $SERVER_PORT \
  &

echo "[entrypoint] Waiting for BrowserOS server on port $SERVER_PORT..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:$SERVER_PORT/health > /dev/null 2>&1; then
    echo "[entrypoint] Server ready"
    break
  fi
  sleep 1
done

# 3. Configure browseros-cli
browseros-cli init $SERVER_PORT 2>/dev/null || true

# 4. Start OpenClaw gateway
exec node dist/index.js gateway --bind lan --port 18789
