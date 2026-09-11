# uWebSockets.js publishes native Linux binaries linked against glibc.
# Alpine uses musl, so the module cannot load there.
FROM node:20-bookworm-slim

# Set working directory
WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json package-lock.json ./

# Install production dependencies only. Requires the committed
# package-lock.json: once uWebSockets.js is pinned there to a resolved
# commit, npm fetches it straight from GitHub's tarball endpoint --
# no `git` binary needed in the image.
RUN npm ci --only=production

# Copy application files
COPY websocket-server.js .
COPY start.sh .

# Make start script executable
RUN chmod +x start.sh

# Expose WebSocket port
EXPOSE 9001

# Run as non-root user for security
USER node

# Use start script to set ulimits and start server
CMD ["sh", "start.sh"]
