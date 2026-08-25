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

# apps/admin authenticates operators against PocketBase directly from the
# browser, so it needs PocketBase's URL baked in at build time via Vite's
# import.meta.env.VITE_* convention (apps/admin/src/App.tsx). A Coolify
# build ARG isn't visible to RUN steps as a process env var on its own --
# this ENV line is what makes `vite build` actually see it.
ARG VITE_POCKETBASE_URL
ENV VITE_POCKETBASE_URL=$VITE_POCKETBASE_URL

# apps/display bakes BUILD_VERSION into its bundle as __BUILD_VERSION__
# (apps/display/vite.config.ts) and sends it as clientVersion on every
# display_join; the server rejects/reloads a display whose clientVersion
# doesn't match its own runtime BUILD_VERSION (plan §7 reload-on-mismatch).
# Coolify auto-injects SOURCE_COMMIT as a build ARG on every deploy, so
# deriving BUILD_VERSION from it here -- and again in the runtime stage
# below -- keeps both sides identical without anyone having to remember to
# set/update a BUILD_VERSION env var by hand each deploy.
ARG SOURCE_COMMIT=dev
ENV BUILD_VERSION=$SOURCE_COMMIT

RUN pnpm --filter @smartphonecracy/display build \
  && pnpm --filter @smartphonecracy/phone build \
  && pnpm --filter @smartphonecracy/admin build \
  && pnpm --filter @smartphonecracy/studio build

FROM node:22-bookworm-slim

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.12.2 --activate

# tsx runs the server's TypeScript directly at runtime (no compile step),
# so the runtime image needs the full workspace: source, node_modules
# (pnpm's symlinked structure ties packages/* into apps/server's
# resolution), and the three built client bundles.
COPY --from=build /app /app

# Must match the build stage's BUILD_VERSION (see comment there) --
# otherwise the server's own runtime config disagrees with what it just
# baked into the display bundle it serves.
ARG SOURCE_COMMIT=dev
ENV BUILD_VERSION=$SOURCE_COMMIT
ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "--import", "tsx", "apps/server/src/index.ts"]
