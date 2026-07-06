# blackbox-icecast

Personal audio streams for up to 100 audience phones — one Icecast mount per
player, fed by Liquidsoap, controlled through a small REST bridge. Built for
[blackbox-runner](../blackbox-runner/); the full rationale (why streaming,
why not cue files or HLS, screen-lock behavior) is in **[SPEC.md](SPEC.md)**.

```
blackbox-runner ── POST /players/{id}/play ──▶ bridge ── telnet ──▶ liquidsoap
                                                 │                     │ 100 sources
                                                 └── polls admin ──▶ icecast
                                                                       │ /p/{id}.mp3
phones: <audio src="http://<venue-box>:8000/p/{id}.mp3">  ◀───────────┘
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

- Stream: `http://localhost:8000/p/1.mp3` (open in any player)
- Test phone page: `http://localhost:8090/test/?player=1&base=http://<LAN-IP>:8000`
- Push narration: `make push PLAYER=1 FILE=sample_1.mp3` (or `MODE=queue`)
- Operator status: `make status` — per-player `connected` / `flagged`
- Health: `curl localhost:8090/health` · Metrics: `curl localhost:8090/metrics`

## Bridge API

All control endpoints take `Authorization: Bearer $BRIDGE_TOKEN` when the
token is set (always set it for a show).

| Endpoint | Body | Effect |
|---|---|---|
| `POST /players/{id}/play` | `{"file": "x.mp3", "mode": "interrupt"\|"queue"}` | interrupt cuts what's playing; queue plays after it |
| `POST /players/{id}/bed` | `{"bed": "forest"}` | switch ambient bed to `beds/forest/` |
| `POST /players/{id}/skip` | – | cut the current item |
| `PUT /players/{id}/active` | `{"active": true}` | mark claimed (also implied by first play) |
| `GET /players/{id}/status` | – | `connected`, `listeners`, `flagged`, `queued`, last push |
| `GET /status` | – | all players + `flagged` list for the operator dashboard |
| `GET /health`, `GET /metrics` | – | unauthenticated liveness / Prometheus text |

`file` must be a bare filename inside the mounted audio dir (blackbox-runner's
`content/audio` in production — set `AUDIO_DIR` in `.env`). A *flagged*
player is one that's active but has had no listener on their mount for
`FLAG_AFTER_S` (default 20 s) — the "we lost them" light (SPEC §8).

## Phase 0 — the locked-screen soak test (do this first)

The whole architecture rests on one claim: a phone keeps pulling the stream
with the screen locked, and server-injected narration arrives with no touch.
Verify it before building anything on top (SPEC §10 T1):

1. `make up` on a machine on the venue/home Wi-Fi.
2. On a real iPhone (oldest iOS you must support) open
   `http://<LAN-IP>:8090/test/?player=1&base=http://<LAN-IP>:8000`, tap start.
3. Lock the phone, pocket it, 45 minutes. Every few minutes:
   `make push PLAYER=1 FILE=sample_1.mp3`.
4. Pass = every narration audible; the page's log (and `gaps=` counter)
   shows what happened. Repeat on Android.

## Testing

```bash
make test                      # bridge unit tests (venv: pip install -e './bridge[dev]')
N=100 make loadtest            # T2: 100 concurrent listeners (curl)
```

## Integrating blackbox-runner (Phase 2, changes live in that repo)

1. Engine cue points additionally `POST bridge/players/{id}/play` (keep the
   WS cue for UI + fallback).
2. Player page: on the claim tap, point a persistent `<audio>` at the
   player's mount — `web/index.html` here is the reference implementation
   of the watchdog / Media Session / reconnect contract (SPEC §5).
3. Mount `content/audio` into this stack read-only (`AUDIO_DIR` in `.env`);
   set `PLAYER_IDS` to the real player ids.
4. Admin dashboard renders `GET /status` red/green per player.

## Not yet verified

- The compose stack has not been booted on this machine (no Docker here):
  Liquidsoap script syntax, the `bed_{id}.uri/.reload` telnet commands, and
  the Icecast Alpine build are untested until Phase 0 runs. Pinned image:
  `savonet/liquidsoap:v2.2.5`.
- Latency numbers and `burst-size` need venue calibration (SPEC §10 T4).
