# Downloads the same pinned PocketBase release scripts/download.sh fetches
# for local dev, so the live instance runs the exact version bumped there.
# pb_data (SQLite + uploaded files) is NOT baked into the image -- it must
# be a persistent volume mounted at /pb/pb_data, or every redeploy wipes
# the database.
FROM alpine:3.20

ARG PB_VERSION=0.39.11
ARG PB_ARCH=amd64

RUN apk add --no-cache ca-certificates curl unzip

WORKDIR /pb

RUN curl -sL \
      "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${PB_ARCH}.zip" \
      -o pocketbase.zip \
    && unzip pocketbase.zip pocketbase \
    && rm pocketbase.zip \
    && chmod +x pocketbase

# Migrations are committed and applied automatically on boot (automigrate
# defaults to true) -- same mechanism as `pnpm pocketbase:dev` locally.
COPY pb_migrations ./pb_migrations

EXPOSE 8090
VOLUME ["/pb/pb_data"]

CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8090", "--dir=/pb/pb_data"]
