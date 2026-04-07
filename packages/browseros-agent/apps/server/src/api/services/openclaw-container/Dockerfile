FROM ghcr.io/openclaw/openclaw:latest

USER root

# Install BrowserOS browser (.deb)
ARG BROWSEROS_DEB_URL=http://cdn.browseros.com/releases/0.44.0.2/linux/BrowserOS_v0.44.0.2_arm64.deb
RUN apt-get update -qq && \
    curl -fsSL -o /tmp/BrowserOS.deb "$BROWSEROS_DEB_URL" && \
    apt-get install -y -qq --fix-broken /tmp/BrowserOS.deb && \
    rm /tmp/BrowserOS.deb && \
    npm install -g browseros-cli && \
    rm -rf /var/lib/apt/lists/*

# Copy BrowserOS server binary (runs separately from the browser)
COPY browseros_server /usr/local/bin/browseros_server
RUN chmod +x /usr/local/bin/browseros_server

# Install browseros-agent skill
RUN su node -c "openclaw skills install browseros-agent" || true

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER node

ENTRYPOINT ["/entrypoint.sh"]
