# uWebSockets.js v20.56.0's Node 20 Linux binary requires glibc 2.38+.
# Debian 12/Bookworm only has glibc 2.36; Debian 13/Trixie is new enough.
FROM node:20-trixie-slim

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
