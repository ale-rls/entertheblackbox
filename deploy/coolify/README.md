# Coolify replacement deployment

This is the production Compose entry point for replacing the current
`enter-the-blackbox` Coolify Git resource with this canonical repository. It
deploys the installation server and its four browser bundles, PocketBase, and
the personal-audio stack. The realtime cursor relay remains its existing
separate Coolify resource.

The Compose project name, public service names, and volume names deliberately
match the current resource:

| Existing name | New implementation | Internal port |
|---|---|---:|
| `frontend` | canonical Fastify server plus phone/display/admin/Studio | 80 |
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
2. Record the three existing public domains for `frontend`, `pocketbase`, and
   `bridge`. Keep their internal ports at 80, 8090, and 8090 respectively.
3. Copy [`deploy/coolify/.env.example`](.env.example) into the Coolify
   environment editor. Replace every placeholder and use the current
   PocketBase superuser credentials.
4. Confirm the existing separate realtime relay is healthy and set its
   public `wss://` URL as `REALTIME_WS_URL`.
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

## Required environment

Coolify must define every value in this table. Compose rejects an incomplete
configuration before building containers, and the server rejects incomplete
or insecure phone-audio settings again at startup.

| Variable | Scope | Requirement |
|---|---|---|
| `VITE_POCKETBASE_URL` | build | public PocketBase `https://` URL |
| `REALTIME_WS_URL` | build | public cursor relay `wss://` URL |
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

## Post-deploy checks

Run these before opening admission:

```bash
curl https://play.example.org/healthz
curl https://play.example.org/readyz
curl https://pb.example.org/api/health
curl https://audio.example.org/health
curl -H "Authorization: Bearer $BRIDGE_TOKEN" https://audio.example.org/status
```

`healthz` proves the process is alive. `readyz` must return 200 only after a
show has been published from Studio and its media has synchronized from
PocketBase. Open `/studio/`, publish the production show, then verify a real
phone can join, tap **Start headphones**, hear a cue, lock its screen, and hear
a later cue. The real-phone check is required because container health checks
cannot prove mobile background playback.

If deployment fails, keep the old containers and volume, correct the reported
missing variable or health check, and redeploy. Do not create a fresh
PocketBase volume as a recovery step.
