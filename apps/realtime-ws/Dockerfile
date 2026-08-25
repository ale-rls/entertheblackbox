FROM node:22-bookworm-slim AS deps

WORKDIR /app

# uWebSockets.js is installed straight from a GitHub tag, which npm needs
# git for -- neither this image nor node:22-alpine ship it by default.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

FROM node:22-bookworm-slim

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY tsconfig.json ./

EXPOSE 9001
USER node

CMD ["npx", "tsx", "src/server.ts"]
