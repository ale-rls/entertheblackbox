# blackbox-icecast

Personal audio streams for up to 100 audience phones — one Icecast mount slot
per concurrent player, fed by Liquidsoap, controlled through a small REST
bridge. The canonical installation server owns registration and cues; the full
rationale (why streaming,
why not cue files or HLS, screen-lock behavior) is in **[SPEC.md](SPEC.md)**.

```
Fastify server ─── POST /players/{id}/play ──▶ bridge ── telnet ──▶ liquidsoap
                                                 │                     │ 100 sources
                                                 └── polls admin ──▶ icecast
                                                                       │ /p/{id}.mp3
phones: <audio src="http://<venue-box>:8300/stream/{id}">  ◀───────────┘
```

The core property: every mount plays **continuously** (narration → queued
narration → ambient bed → silence-guard), so a phone's `<audio>` element
never goes idle — which is what keeps audio deliverable while the screen is
locked (SPEC §2). Injecting new narration is a server-side act; the phone
does nothing.

## Quick start

```bash
cp .env.example .env          # set passwords, PLAYERS / PLAYER_IDS, AUDIO_DIR
./scripts/make_default_bed.sh # needs ffmpeg (once; committed sample included)
make up
```

Then:

- Direct mount: `http://localhost:8200/p/1.mp3`
- Phone gateway: `http://localhost:8300/stream/<player-id>`
- Test phone page: `http://localhost:8300/test/?player=1&base=http://<LAN-IP>:8200`
- Push narration: `make push PLAYER=1 FILE=sample_1.mp3` (or `MODE=queue`)
- Operator status: `make status` — per-player `connected` / `flagged`
- Health: `curl localhost:8300/health` · Metrics: `curl localhost:8300/metrics`

## Bridge API

All control endpoints take `Authorization: Bearer $BRIDGE_TOKEN` when the
token is set (always set it for a show).

| Endpoint | Body | Effect |
|---|---|---|
| `POST /players/{id}/register` | – | allocate a stable stream slot to any player id |
| `PUT /audio/{file}.mp3` | raw MP3 body | authenticated upload from a remote runner |
| `POST /players/{id}/play` | `{"file": "x.mp3", "mode": "interrupt"\|"queue"}` | interrupt cuts what's playing; queue plays after it |
| `POST /players/{id}/bed` | `{"bed": "forest"}` | switch ambient bed to `beds/forest/` |
| `POST /players/{id}/skip` | – | cut the current item |
| `PUT /players/{id}/active` | `{"active": true}` | mark claimed (also implied by first play) |
| `GET /players/{id}/status` | – | `connected`, `listeners`, `flagged`, `queued`, last push |
| `GET /status` | – | all players + `flagged` list for the operator dashboard |
| `GET /health` | – | public liveness for Coolify |
| `GET /metrics` | – | protected Prometheus metrics |

Phones use the unauthenticated `GET /stream/{player_id}` gateway. The runner
first registers the player through the protected control API; public requests
cannot allocate finite stream slots. The gateway proxies the corresponding
Icecast mount, allowing generated `seat-…` ids to work with the fixed pool of
Liquidsoap encoders without exposing internal mount ids.

`file` must be a bare filename inside the mounted audio directory. In the
combined deployment, the canonical server uploads Studio media through the
bridge API into the shared `audio-data` volume. A *flagged*
player is one that's active but has had no listener on their mount for
`FLAG_AFTER_S` (default 20 s) — the "we lost them" light (SPEC §8).

## Phase 0 — the locked-screen soak test (do this first)

The whole architecture rests on one claim: a phone keeps pulling the stream
with the screen locked, and server-injected narration arrives with no touch.
Verify it before building anything on top (SPEC §10 T1):

1. `make up` on a machine on the venue/home Wi-Fi.
2. On a real iPhone (oldest iOS you must support) open
   `http://<LAN-IP>:8300/test/?player=1&base=http://<LAN-IP>:8200`, tap start.
3. Lock the phone, pocket it, 45 minutes. Every few minutes:
   `make push PLAYER=1 FILE=sample_1.mp3`.
4. Pass = every narration audible; the page's log (and `gaps=` counter)
   shows what happened. Repeat on Android.

## Testing

```bash
make test                      # bridge unit tests (venv: pip install -e './bridge[dev]')
N=100 make loadtest            # T2: 100 concurrent listeners (curl)
```

## entertheblackbox integration

The canonical Fastify server and React phone app implement this contract:

1. Joining registers the server-issued participant ID against one fixed stream
   slot; the signed participant lease prevents another browser claiming it.
2. A phase's Studio-authored `phoneAudioSrc` is uploaded once and injected into
   every registered stream on phase entry.
3. The phone starts `/stream/{player-id}` on one explicit headphone tap and
   retries a lost stream while keeping the native media pipeline active under
   screen lock.
4. Silent transitions clear narration, and ending a session clears queues,
   terminates old stream responses, and releases every slot.
5. The Admin dashboard shows current listeners and flags an active stream that
   has had no stream connection for longer than `FLAG_AFTER_S`. A listener count
   does not establish audible playback; the phone reports playback separately.
6. If the deployed bridge's round trip is too slow for a live cue (e.g. it's
   hosted off-venue), an admin can run this same stack locally (`make up`, as
   above) on a machine on the venue LAN and live-switch the running show to it
   from the Admin dashboard's "Local audio backend" control -- no server
   restart. It health-checks the local bridge before switching and re-plays
   current narration there; switching back to the deployment's default is one
   click. This does not change which network audience phones are on, only
   which bridge the server talks to.

### Keeping `apps/server` remote while audio runs at the venue

You do not need to move the whole installation server to the venue just to
get local audio. `AudioConfig` already splits into two independent URLs, and
the "Local audio backend" form in Admin exposes both separately:

- **Local bridge control URL** -- used only by `apps/server` itself (health
  check, MP3 upload, play/reset). Control round trips contribute to cue-to-ear latency: reset and play
  requests must reach the bridge before the new narration can enter the stream.
  Measure this path as well as the phone playback buffer.
- **Public stream URL** -- handed straight to phones, who fetch
  `/stream/{id}` *directly from the bridge*, never through `apps/server`.
  For production HTTPS pages, use a phone-reachable HTTPS stream URL with a
  trusted certificate, including for a venue-local bridge. Do not assume an
  HTTP LAN address will work inside an HTTPS page: browsers may upgrade or
  block mixed audio requests. Chrome documents this behavior in
  [No More Mixed Messages About HTTPS](https://security.googleblog.com/2019/10/no-more-mixed-messages-about-https_3.html).
  Local-network permissions also depend on browser/version; validate the
  actual phone-facing URL on the supported devices.


The only real gap is getting the remote server a network path to the local
bridge's control port. **Recommended: Tailscale, installed on the host
machine underneath the remote deployment -- not as a sidecar container.** A
sidecar sharing `frontend`'s network namespace (the usual Docker pattern)
would replace its network stack and break the Compose service-name DNS it
uses to reach `pocketbase`/`bridge`/`realtime` (see
`deploy/coolify/docker-compose.yml`), risking the live show's ingress for no
good reason. Installed at the host level instead, Docker's default bridge
networking already routes container egress through the host's routing table,
so containers get tailnet reachability automatically -- zero
`docker-compose.yml` changes, zero risk to existing service networking.

Setup, done once outside show hours:

1. On the venue machine running this stack: install the [Tailscale app](https://tailscale.com/download) (or `brew install --cask tailscale`) and sign in with the account that should own this venue's tailnet -- ideally a shared/team one, since it needs to stay authenticated through the show.
2. On the host machine underneath the remote deployment (SSH in; this is *not* a container change): `curl -fsSL https://tailscale.com/install.sh | sh` then `sudo tailscale up`, signed into the same tailnet.
3. Find the venue machine's tailnet address (`tailscale ip -4`, or its MagicDNS name from the Tailscale admin console).
4. In Admin's "Local audio backend" form: **Local bridge control URL** = that tailnet address plus the bridge's control port (e.g. `http://100.x.y.z:8300`); **Public stream URL** = the bridge's plain venue-LAN address (e.g. `http://192.168.1.42:8300`); **Bridge token** = this stack's `BRIDGE_TOKEN`.
5. "Test & switch to local" health-checks over the tailnet before committing -- nothing changes if that fails.

The server automatically uploads each MP3 from its synced `content/media`
directory before cueing it. `AUDIO_BRIDGE_TOKEN` must match this service's
`BRIDGE_TOKEN`, and `AUDIO_PUBLIC_URL` must point to the browser-reachable
bridge base. The phone learns that URL through its authenticated registration;
there is no phone build variable.

For the public deployment, use [`docker-compose.coolify.yml`](docker-compose.coolify.yml)
and follow [`COOLIFY.md`](COOLIFY.md). Only the bridge is public; Icecast and
Liquidsoap have no host ports.

## Not yet verified

- The compose stack still needs a real-device venue run:
  Liquidsoap script syntax, the `bed_{id}.uri/.reload` telnet commands, and
  the Icecast Alpine build are untested until Phase 0 runs. Pinned image:
  `savonet/liquidsoap:v2.2.5`.
- Latency numbers and `burst-size` need venue calibration (SPEC §10 T4).

The Alpine-based images use the supported 3.24 release line, PocketBase is
pinned to 0.39.11, and the server uses the maintained Node 22 Bookworm image.
Liquidsoap remains pinned to 2.2.5 because the current control script was
written and unit-tested against that command surface. Liquidsoap 2.4 changes
minor-version APIs; upgrade it only in staging with the locked-phone soak test,
then change both `services/audio/liquidsoap/Dockerfile` and the local Compose
image together.

## Continuity and recovery verification

See [the continuity audit and device rehearsal procedure](CONTINUITY.md).
