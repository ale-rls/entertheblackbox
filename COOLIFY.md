# Coolify deployment

This stack is the public personal-audio service. Only the `bridge` service is
internet-facing; Icecast and Liquidsoap remain on the private Compose network.
The venue runner connects outbound to the bridge for authenticated MP3 uploads
and cue commands.

Deployment topology:

| Component | Location | Public? |
|---|---|---|
| Phone frontend | Coolify (or existing Netlify site) | HTTPS |
| PocketBase | Existing Coolify service | HTTPS |
| Audio bridge | This Coolify stack | HTTPS |
| Icecast + Liquidsoap | This Coolify stack | No |
| Runner + TrackingBox | Venue machine | No; outbound connections only |

PocketBase is not duplicated by this Compose stack. Keep its existing
persistent volume and domain; on a fresh instance, run the runner repository's
`scripts/pocketbase_bootstrap.py` once before importing show content.

## Create the resource

1. In Coolify, create a Docker Compose application from this repository.
2. Set the Compose location to `/docker-compose.coolify.yml`.
3. Assign an HTTPS domain to the `bridge` service and internal port `8090`,
   for example `https://audio.example.org:8090`.
4. Set the variables below, then deploy.

Required variables:

```env
ICECAST_SOURCE_PASSWORD=<generated-long-secret>
ICECAST_ADMIN_PASSWORD=<generated-long-secret>
BRIDGE_TOKEN=<generated-long-secret>
PUBLIC_STREAM_BASE=https://audio.example.org
```

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

## Connect the venue runner

Set these on the private runner machine:

```env
AUDIO_BRIDGE_URL=https://audio.example.org
AUDIO_PUBLIC_URL=https://audio.example.org
AUDIO_BRIDGE_TOKEN=<same BRIDGE_TOKEN>
```

The runner uploads each MP3 before issuing per-player play commands. No shared
filesystem, inbound tunnel to the venue, or public TrackingBox endpoint is
needed.

Set the phone frontend's build variable to the same public URL:

```env
VITE_AUDIO_STREAM_BASE=https://audio.example.org
```

## Verify

```bash
curl https://audio.example.org/health
curl -H "Authorization: Bearer $BRIDGE_TOKEN" https://audio.example.org/status
```

`/health` is public for Coolify. Control, upload, status, and metrics endpoints
require the bearer token. The only other public route is
`/stream/<registered-player-id>`.
