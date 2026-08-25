# Build context is the repo root (this is a pnpm workspace: apps/server
# depends on packages/protocol, packages/scenario, packages/shared as raw
# TS source -- see each package's `exports` field -- and on the built
# static bundles of apps/display, apps/phone, apps/admin).
#
# Coolify: Base Directory `.`, Dockerfile Location `apps/server/Dockerfile`.

FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.12.2 --activate

COPY . .

RUN pnpm install --frozen-lockfile

RUN pnpm --filter @smartphonecracy/display build \
  && pnpm --filter @smartphonecracy/phone build \
  && pnpm --filter @smartphonecracy/admin build

FROM node:22-bookworm-slim

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.12.2 --activate

# tsx runs the server's TypeScript directly at runtime (no compile step),
# so the runtime image needs the full workspace: source, node_modules
# (pnpm's symlinked structure ties packages/* into apps/server's
# resolution), and the three built client bundles.
COPY --from=build /app /app

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "--import", "tsx", "apps/server/src/index.ts"]
