# PocketBase (local persistence)

PocketBase instance backing the persistence layer. It runs standalone for
local development and is built by the combined Coolify deployment for
production. Runtime data stays in the persistent `/pb/pb_data` volume.

## Usage

```bash
pnpm pocketbase:download   # fetch the pinned binary for your platform (once)
pnpm pocketbase:dev        # run PocketBase on http://127.0.0.1:8090
```

Admin UI: http://127.0.0.1:8090/_/ (create the first superuser on initial run,
or via `pocketbase/bin/pocketbase superuser upsert <email> <password>`).

Provision an admin-dashboard operator account (a separate, lower-privilege
`operators` collection — not a PocketBase superuser, see below):

```bash
pocketbase/scripts/create-operator.sh <email> <password>
```

## Layout

- `bin/` — downloaded binary (gitignored, platform-specific, not committed)
- `pb_data/` — SQLite database + uploaded files (gitignored, runtime state)
- `pb_migrations/` — JS migration files defining collections; **committed**,
  applied automatically on `serve`
- `pb_hooks/` — optional server-side JS hooks (`*.pb.js`); committed
- `scripts/download.sh` — downloads the pinned binary for the current OS/arch
- `scripts/dev.sh` — downloads (if missing) and starts the server
- `scripts/create-operator.sh` — provisions an `operators` account for `/admin/` login

## Notes

- The version is pinned in `scripts/download.sh`; bump it there deliberately.
- Realtime subscriptions (PocketBase's SSE-based `collection.subscribe`) are
  intended for lower-frequency data — scenario/session/vote state, admin
  config, Studio drafts. High-frequency cursor broadcast stays on the
  dedicated uWebSockets deployment, not PocketBase.
- `operators` (admin-dashboard login) is deliberately a separate auth
  collection from `_superusers`: an operator who can start/stop a show
  should not also get full database access to every collection. Only a
  superuser can create operator records (`createRule: null`).

## Coolify

Use [`deploy/coolify/docker-compose.yml`](../deploy/coolify/docker-compose.yml)
for the production repository replacement and follow the
[`Coolify replacement guide`](../deploy/coolify/README.md). The Compose file
keeps the existing `pocketbase` service and `pocketbase-data` volume names.
Back up that volume before switching repositories and never recreate it as
part of a routine deploy.
