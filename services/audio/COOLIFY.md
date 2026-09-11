# Coolify deployment

This stack is the public personal-audio service. Only the `bridge` service is
internet-facing; Icecast and Liquidsoap remain on the private Compose network.
The canonical installation server connects to the bridge for authenticated
MP3 uploads and cue commands.

Deployment topology:

| Component | Location | Public? |
|---|---|---|
| Installation server + browser clients | Coolify | HTTPS |
| PocketBase | Combined monorepo Coolify service | HTTPS |
| Audio bridge | This Coolify stack | HTTPS |
| Icecast + Liquidsoap | This Coolify stack | No |
| Realtime cursor relay | Combined monorepo Coolify service | WSS |
| TrackingBox | Venue machine | No public ingress required |

PocketBase is not duplicated by this service-specific Compose stack. For the
recommended full repository replacement, use the combined
`/deploy/coolify/docker-compose.yml` and follow
[`deploy/coolify/README.md`](../../deploy/coolify/README.md). It preserves the
existing public service and persistent volume names. Use this service-specific
file only when audio is intentionally managed as a separate Coolify resource.

## Create the resource

1. In Coolify, create a Docker Compose application from this repository.
2. Set the Compose location to `/services/audio/docker-compose.coolify.yml`.
3. Assign an HTTPS domain to the `bridge` service and internal port `8090`,
   for example `https://audio.example.org:8090`.
4. Set the variables below, then deploy.

Required variables:

```env
ICECAST_SOURCE_PASSWORD=<generated-long-secret>
ICECAST_ADMIN_PASSWORD=<generated-long-secret>
ICECAST_HOSTNAME=audio.example.org
BRIDGE_TOKEN=<generated-long-secret>
PUBLIC_STREAM_BASE=https://audio.example.org
```

`ICECAST_HOSTNAME` is the hostname only—do not include `https://`, a path, or
a port. Coolify treats it as Compose-managed, so update its value rather than
trying to delete the variable.

Optional variables:

```env
PLAYERS=100
ICECAST_MAX_CLIENTS=400
ICECAST_MAX_SOURCES=120
FLAG_AFTER_S=20
MAX_AUDIO_UPLOAD_MB=20
```

All of these are runtime variables. Keep the three secrets out of build-time
variables. `audio-data` is a named persistent volume and must be included in
Coolify backups.

## Connect the canonical server

When this is a separate audio resource, set these on the canonical installation
server resource:

```env
AUDIO_BRIDGE_URL=https://audio.example.org
AUDIO_PUBLIC_URL=https://audio.example.org
AUDIO_BRIDGE_TOKEN=<same BRIDGE_TOKEN>
```

The server uploads each Studio-authored MP3 before issuing per-player play
commands. No shared filesystem, inbound tunnel to the venue, or public
TrackingBox endpoint is needed.

The phone needs no audio build variable. After it presents a valid signed
participant lease, the canonical server returns the configured
`AUDIO_PUBLIC_URL` for that participant's registered stream.

## Verify

```bash
curl https://audio.example.org/health
curl -H "Authorization: Bearer $BRIDGE_TOKEN" https://audio.example.org/status
```

`/health` is public for Coolify. Control, upload, status, and metrics endpoints
require the bearer token. The only other public route is
`/stream/<registered-player-id>`.
