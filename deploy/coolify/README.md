# Coolify replacement deployment

This is the production Compose entry point for replacing the current
`enter-the-blackbox` Coolify Git resource with this canonical repository. It
deploys the installation server and its four browser bundles, PocketBase, the
personal-audio stack, and the low-latency realtime cursor relay as one Coolify
Compose resource.

The Compose project name, public service names, and volume names deliberately
match the current resource:

| Existing name | New implementation | Internal port |
|---|---|---:|
| `frontend` | canonical Fastify server plus phone/display/admin/Studio | 80 |
| `realtime` | room-scoped, batched cursor relay | 9001 |
| `pocketbase` | canonical PocketBase image and migrations | 8090 |
| `bridge` | authenticated audio control and public phone streams | 8090 |
| `icecast` | private stream origin | 8000 |
| `liquidsoap` | private continuous encoders | 1234 |
| `pocketbase-data` | existing PocketBase database and uploaded files | — |
| `audio-data` | uploaded narration cache | — |

Keeping those names prevents a Git-repository replacement from silently
creating a new database volume. The frontend continues on port 80, so its
existing Coolify domain can remain attached to `frontend`. Never delete or
recreate `pocketbase-data` during the switch.

## Before replacing the repository

1. Back up the current `pocketbase-data` volume in Coolify and verify the
   backup completed.
2. Record the four public domains for `frontend`, `realtime`, `pocketbase`, and
   `bridge`. Keep their internal ports at 80, 9001, 8090, and 8090 respectively.
3. Copy [`deploy/coolify/.env.example`](.env.example) into the Coolify
   environment editor. Replace every placeholder and use the current
   PocketBase superuser credentials.
4. Set the realtime relay's public `wss://` URL as `REALTIME_WS_URL`. The relay
   is built from `apps/realtime-ws-coolify` by this Compose resource.
5. In Coolify's Advanced build settings, enable **Include Source Commit in
   Build**. This keeps the server and browser build version tied to each
   deployed commit.
6. Change the resource's Git repository and branch, leaving its persistent
   volumes and domains attached. Set the Compose file to
   `/deploy/coolify/docker-compose.yml` and deploy.

PocketBase applies the canonical migrations on startup. They add the Studio,
installation, movement, and media collections alongside the legacy
collections; they do not delete the legacy production collections. The audio
volume is a cache and can be rebuilt by the server, but retaining it makes the
first restart faster.

## Admin and Show Studio

Admin and Show Studio are built into the `frontend` image and served by the
same Fastify service as the phone and display clients. Do not create separate
Coolify services or domains for them. Replace `https://play.example.org` below
with the public domain attached to `frontend`:

| Interface | URL | Purpose |
|---|---|---|
| Operator admin | `https://play.example.org/admin/` | Monitor the installation, select the active published show, schedule show starts, and control a live session |
| Show Studio | `https://play.example.org/studio/` | Create, validate, preview, and publish versioned shows and their media |
| PocketBase dashboard | `https://pb.example.org/_/` | Superuser-only database and operator-account administration |

Both operator interfaces authenticate against PocketBase's `operators`
collection. They use the public PocketBase address supplied as
`VITE_POCKETBASE_URL`; it must be reachable from the operator's browser and
must use HTTPS in production. After changing that value, rebuild the
`frontend` image because the address is embedded in both browser bundles at
build time.

PocketBase superuser credentials are only supplied to the server at runtime
through `POCKETBASE_ADMIN_EMAIL` and `POCKETBASE_ADMIN_PASSWORD`. They are not
valid operator-panel credentials and are not embedded in either browser
bundle.

### Provision the first operator

After PocketBase starts and applies its migrations, open
`https://pb.example.org/_/`, sign in as the existing PocketBase superuser, open
the `operators` collection, and create a record with an email, password, the
`operator` role, and `verified` enabled. There is deliberately no public
operator signup.

Alternatively, run the repository provisioning script from a trusted machine
that has Bash, curl, and Python 3:

```bash
POCKETBASE_URL=https://pb.example.org \
POCKETBASE_ADMIN_EMAIL=superuser@example.org \
POCKETBASE_ADMIN_PASSWORD='the-existing-superuser-password' \
pocketbase/scripts/create-operator.sh operator@example.org 'a-long-unique-password'
```

Use that operator email and password to sign in to both `/admin/` and
`/studio/`. The admin panel writes schedules and active-show selections through
the authenticated `/api/admin/*` server API; Show Studio publishes through the
same API and stores its shared media in PocketBase. The server uses its
internal `http://pocketbase:8090` connection for privileged persistence.

## Required environment

Coolify must define every value in this table. Compose rejects an incomplete
configuration before building containers, and the server rejects incomplete
or insecure phone-audio settings again at startup.

| Variable | Scope | Requirement |
|---|---|---|
| `VITE_POCKETBASE_URL` | build | public PocketBase `https://` URL |
| `REALTIME_WS_URL` | build | public `realtime` service `wss://` URL |
| `PHONE_JOIN_BASE_URL` | runtime | public frontend URL ending in `/phone/` |
| `PUBLIC_STREAM_BASE` | runtime | public bridge `https://` URL; also handed to phones |
| `ICECAST_HOSTNAME` | runtime | audio hostname only, without scheme/path/port |
| `INSTALLATION_ID` | runtime | stable installation identifier |
| `DISPLAY_TOKEN` | build + runtime | same long value in both contexts; Compose wires both |
| `JOIN_GRANT_SECRET` | runtime secret | long random participant-lease signing secret |
| `BRIDGE_TOKEN` | runtime secret | long random server-to-bridge bearer token |
| `ICECAST_SOURCE_PASSWORD` | runtime secret | unique long random value |
| `ICECAST_ADMIN_PASSWORD` | runtime secret | different long random value |
| `POCKETBASE_ADMIN_EMAIL` | runtime secret | existing PocketBase superuser email |
| `POCKETBASE_ADMIN_PASSWORD` | runtime secret | existing PocketBase superuser password |

Keep secrets as runtime-only Coolify variables. `DISPLAY_TOKEN` is the one
intentional exception because the authenticated display bundle needs it at
build time. With **Include Source Commit in Build** enabled, `SOURCE_COMMIT`
is supplied by Coolify and becomes the shared server/client build version
automatically.

Optional variables and their defaults are listed in `.env.example`. Omit an
optional variable from Coolify to accept its Compose default. Set
`TRACKINGBOX_URL` only when the deployed server can actually reach that URL;
otherwise leave it absent.

## Prune obsolete variables

Remove these from the current Coolify resource after copying the new required
set. They belonged to the old static frontend, venue runner, or local Compose
workflow and are ignored or replaced here:

- `VITE_AUDIO_STREAM_BASE`
- `AUDIO_BRIDGE_URL`, `AUDIO_BRIDGE_TOKEN`, `AUDIO_PUBLIC_URL`
- `POCKETBASE_URL`
- `AUDIO_DIR`, `BEDS_DIR`
- `ICECAST_PUBLIC_PORT`, `BRIDGE_PUBLIC_PORT`
- `BUILD_VERSION`, `HOST`, `PORT`, `NODE_ENV`, `TRUST_PROXY`
- `REQUIRE_PHONE_AUDIO`

The combined Compose file sets internal service URLs, fixed container values,
and `REQUIRE_PHONE_AUDIO=true` itself. Do not add a public domain to `icecast`
or `liquidsoap`.

## Recommended domain assignment

Assign these values in Coolify's domain fields. The port suffix selects the
container target; it is not part of the browser-visible HTTPS/WSS address.

| Service | Coolify domain field | Public value used by clients |
|---|---|---|
| `frontend` | `https://bb-frontend.enabler.space` | `https://bb-frontend.enabler.space` |
| `realtime` | `https://bb-realtime.enabler.space:9001` | `wss://bb-realtime.enabler.space` |
| `pocketbase` | `https://bb-pocketbase.enabler.space:8090` | `https://bb-pocketbase.enabler.space` |
| `bridge` | `https://bb-bridge.enabler.space:8090` | `https://bb-bridge.enabler.space` |
| `icecast` | none | internal only: `icecast:8000` |
| `liquidsoap` | none | internal only: `liquidsoap:1234` |

Keep the available `bb-icecast.enabler.space` and
`bb-liquidsoap.enabler.space` hostnames unassigned. They are not required by
the public architecture.

## Post-deploy checks

Run these before opening admission:

```bash
curl https://play.example.org/healthz
curl https://play.example.org/readyz
curl -fsS -o /dev/null https://play.example.org/admin/
curl -fsS -o /dev/null https://play.example.org/studio/
curl https://realtime.example.org/health
curl https://pb.example.org/api/health
curl https://audio.example.org/health
curl -H "Authorization: Bearer $BRIDGE_TOKEN" https://audio.example.org/status
```

`healthz` proves the process is alive. `readyz` must return 200 only after a
show has been published from Studio and its media has synchronized from
PocketBase. The two silent curl checks confirm that the frontend image contains
the Admin and Studio bundles. Sign in to `/studio/`, publish the production
show, then sign in to `/admin/`, select it under **Active show**, and add a
future time under **Lobby schedule**. Finally, verify a real phone can join, tap
**Start headphones**, hear a cue, lock its screen, and hear a later cue. The
real-phone check is required because container health checks cannot prove
mobile background playback.

If deployment fails, keep the old containers and volume, correct the reported
missing variable or health check, and redeploy. Do not create a fresh
PocketBase volume as a recovery step.
