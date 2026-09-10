# blackbox-icecast — Per-Player Audio Delivery Specification

**Status:** proposal, v1 (2026-07-06)
**Scope:** delivering up to 100 individual audio narratives to audience phones
through the browser, surviving screen lock, integrated with
[blackbox-runner](../blackbox-runner/) (game engine, cues, content) and
[TrackingBox](../TrackingBox/) (positions — no direct dependency here).

---

## 1. Problem statement

blackbox-runner today plays narration like this: the engine broadcasts a cue
over the player WebSocket (`engine.py` → `audio_url`), and the phone page
calls `audio.play()` on a static mp3 (`web/player/index.html`,
`playAudio()`). This has two limits the show now hits:

1. **Per-player narratives.** Cues are per-round, effectively broadcast. We
   need up to 100 *different* audio programs, one per player.
2. **Screen lock.** When a phone locks, the browser page is frozen: the
   WebSocket goes quiet, timers stop, and JS cannot start new audio. A
   cue that arrives while locked is simply lost. Players must keep
   receiving their narrative with the phone in their pocket.

Hard requirements:

- **R1** — audio continues and *new* narration can begin while the screen is
  locked, on iOS Safari and Android Chrome, without the player touching the
  phone.
- **R2** — up to 100 concurrent players, each potentially on a different
  narrative branch.
- **R3** — we must not "lose" players: the operator can see who is actually
  receiving audio, and a dropped phone recovers without staff intervention.
- **R4** — one user gesture at the start (the existing claim tap) is the only
  interaction we may rely on; everything after must be hands-free.
- **R5** — venue LAN deployment, multi-hour show, no cloud dependency during
  the performance.

## 2. The one fact that decides the architecture

Mobile browsers keep a page alive **only while it is audibly playing media
through an `<audio>` element**. Concretely:

| While screen is locked… | Page playing `<audio>` | Idle page |
|---|---|---|
| Audio keeps playing | ✅ (native media pipeline) | n/a |
| JS keeps running / WS stays up | mostly ✅ (throttled) | ❌ frozen |
| JS can *start* new audio | ✅ (session already active) | ❌ |
| Media Session lock-screen UI | ✅ | ❌ |

Two corollaries:

- Any design where audio *stops between cues* is fragile: the moment the
  element goes idle, iOS may suspend the page, and the next cue never
  arrives. iOS has also historically detected and killed *pure digital
  silence*, so "loop a silent wav as keep-alive" is not a contract, it's a
  hack that breaks with OS updates.
- A design where the element is **continuously playing a live stream** never
  has this problem: the phone's native media stack pulls the stream even with
  JS fully frozen, and *what* comes down that stream is entirely a server
  decision. Starting new narration requires no phone-side action at all.

That is the personal-radio model, and it is what this repo implements.

## 3. Options considered

| | A — cue files + keep-alive bed | B — **Icecast, one mount per player** | C — per-player HLS (m3u8) |
|---|---|---|---|
| New audio while locked | ⚠️ relies on page staying alive via an always-playing ambient loop; breaks if iOS suspends anyway | ✅ server-side injection, phone does nothing | ✅ on iOS (native HLS); ⚠️ Android needs hls.js, i.e. live JS |
| Latency (cue → ear) | ~0 s | ~2–6 s, per-listener variable | ~10–30 s typical; LL-HLS lower but complex |
| Per-player narratives | ✅ (cue routing) | ✅ (100 mounts) | ✅ (100 playlists) |
| Infra added | none | Icecast + Liquidsoap + small bridge | segmenter + playlist generator per player |
| Failure surface | phone-side (page freeze = lost player, invisible to us) | server-side (observable, monitorable) | server-side + phone-side JS on Android |
| "Don't lose them" observability | ❌ no signal whether audio actually plays | ✅ Icecast knows exactly who is connected to which mount | ⚠️ inferable from segment requests |
| Overhead | lowest | ~13 Mbit/s total @128 kbps ×100 — trivial on LAN | more moving parts for no benefit at this scale |

**Decision: Option B.** The no-stream option (A) is genuinely lighter and its
latency is unbeatable, but it cannot *guarantee* R1 — it depends on
undocumented page-freezing heuristics that differ per OS release, and it
gives the operator no way to know a locked phone went deaf (violates R3).
HLS (C) adds latency and complexity that only pay off at CDN scale.
Icecast's per-listener connection state is exactly the "did we lose them?"
signal R3 asks for. Option A survives as the **degraded fallback** (§9): the
existing cue path in blackbox-runner stays functional if this whole stack
dies mid-show.

The **Media Session API is not an alternative to streaming** — it is a
complement we use regardless: it provides lock-screen metadata/artwork and
play/pause handlers, but it cannot deliver audio or wake a frozen page.

## 4. Architecture

```
                       blackbox-runner (unchanged repo boundary)
                       engine.py cue points ──────────────┐
                       content/audio/*.mp3 (read-only) ─┐ │ REST
                                                        │ ▼
┌──────────────────────────── this repo ────────────────┼──────────────────┐
│                                                       │                  │
│   bridge (FastAPI)  ◀── POST /players/{id}/play ──────┘                  │
│   │  auth token, queue vs interrupt, status cache                        │
│   │ telnet/harbor commands              ▲ polls /admin/listclients       │
│   ▼                                     │                                │
│   Liquidsoap ──── 100 source streams ──▶ Icecast2                        │
│   per player:                            mounts /p/{id}.mp3             │
│     interrupt queue  (priority)                                          │
│     narration queue                                                      │
│     fallback: per-narrative ambient bed                                  │
│     fallback: safe blank  (mount never dies)                             │
└───────────────────────────────────────────────────────┬──────────────────┘
                                                         │ HTTP audio
                                              ┌──────────▼──────────┐
                                              │ phone: <audio src=  │
                                              │  "/p/{id}.mp3">     │
                                              │ + Media Session     │
                                              └─────────────────────┘
```

### 4.1 Components

**Icecast2** — plain relay. `sources ≥ 110`, `clients ≥ 300`, YP/directory
disabled, `burst-size` tuned low (~16 KB) to cut startup latency. Mounts are
`/p/{player_id}.mp3`, matching blackbox-runner's player IDs (the page already
derives its ID from the URL path).

**Liquidsoap** — the single source client feeding all mounts. Per player:

```
interrupt_q(id)   # request.queue — plays immediately, cuts what's playing
narration_q(id)   # request.queue — plays when current item ends
bed(id)           # playlist: this player's current ambient/narrative bed
fallback(track_sensitive=false, [interrupt_q, narration_q, bed, blank])
→ output.icecast(%mp3(bitrate=128, samplerate=44100, stereo=false), mount="/p/{id}.mp3")
```

The fallback chain is the reliability core: a mount **always** has audio, so
Icecast never drops listeners for a dry source, and the phone's `<audio>`
element never goes idle (which is what keeps locked pages receiving, §2).
LAME at 128 kbps mono is ~1–2 % of a modern core per encoder; 100 encoders
fit on one machine. If measurement says otherwise, shard into N Liquidsoap
processes (e.g. 4 × 25 mounts) behind the same Icecast — the bridge hides
this from callers.

**Bridge** (small FastAPI service, this repo) — the only API the rest of the
system talks to. Translates REST to Liquidsoap telnet commands and polls
Icecast admin for listener state:

| Endpoint | Purpose |
|---|---|
| `POST /players/{id}/play` `{file, mode: interrupt\|queue}` | push a narration file to that player's stream |
| `POST /players/{id}/bed` `{playlist}` | switch the player's ambient/narrative bed |
| `POST /players/{id}/skip` | cut current item |
| `GET  /players/{id}/status` | `{connected, listeners, now_playing, queue}` |
| `GET  /status` | all players, for the operator dashboard |
| `GET  /health` | liveness of icecast + liquidsoap + bridge |

Single shared bearer token (venue LAN, one trusted caller). `file` is
validated against the mounted audio dir — the bridge never accepts arbitrary
paths or URLs.

### 4.2 Integration contract with blackbox-runner

blackbox-runner keeps owning **content and timing**; this repo owns
**delivery**. Changes on their side are deliberately small:

1. **Engine**: where it currently builds `audio_url` for the WS cue
   (`server/engine.py:461`), it *additionally* calls
   `POST bridge/players/{id}/play` for each affected player. The WS cue
   stays — it drives the on-screen UI and the fallback path.
2. **Player page**: on claim (the existing unlock tap,
   `web/player/index.html`), set the narration element's `src` to the
   player's mount and `play()` once. Add Media Session metadata and a
   reconnect watchdog (§5). The existing `playAudio(url)` cue path remains
   as fallback when the stream is marked down.
3. **Audio files**: the bridge mounts blackbox-runner's audio dir
   (`GAME_AUDIO_DIR`) read-only. The ElevenLabs generation workflow is
   untouched; new files are playable the moment they exist.
4. **Admin dashboard**: render `GET bridge/status` — a per-player
   "receiving audio" light. A claimed player whose mount has had 0
   listeners for > 20 s is flagged for staff. This is R3 made visible.

### 4.3 Latency and sync

Expected cue-to-ear latency is **2–6 s and per-listener variable** (server
burst + the phone's own live-stream buffer, which we don't control; iOS
Safari alone buffers several seconds). Consequences, stated honestly:

- Players on headphones hearing *individual* narratives: skew between
  players is invisible. This is the primary mode and it is fine.
- Sync against room events (TouchDesigner visuals, live performers, round
  timers): do **not** expect stream ↔ room frame-sync. Two rules:
  - moments that must feel tight are authored *inside* the audio (the
    narration itself counts the player down), not cued externally;
  - the engine starts round timers `LATENCY_COMP` seconds after pushing
    audio (measured per venue in rehearsal — see test T4, typically ~4 s),
    exactly the kind of rehearsal-tuned constant blackbox-runner already
    has (`REBIND_MAX_DISTANCE` etc.).

If a future scene needs sub-second shared sync (all players hear one beat
together), that is a different mechanism (pre-downloaded file + scheduled
local clock start) and is out of scope here — flagged in §11.

## 5. Phone playback spec (client best practices)

- **One `<audio>` element** for the stream. Never route it through Web Audio
  API — the iOS mute switch silences Web Audio but *not* plain `<audio>`
  media playback, and we want playback despite the mute switch.
- **Unlock**: the existing claim tap calls `.play()` directly (already the
  pattern in blackbox-runner). No additional gestures may be required after
  this point (R4).
- **Media Session**: set title/artist/artwork (show branding; update per
  scene via WS when the page is awake — cosmetic only). Register `play` and
  `pause` handlers; do **not** expose seek/next/previous. On `pause` →
  `play` from the lock screen, treat the element as stale: reset `src` with
  a cache-buster and `load(); play()` — resuming a live stream from a paused
  buffer position replays old audio.
- **Watchdog & reconnect**: listeners on `error`, `stalled`, `ended`, plus a
  timer checking that `currentTime` advances. On failure: exponential
  backoff (0.5 s → 8 s cap), reset `src`, `play()`. On `visibilitychange` to
  visible: if not playing, immediately reconnect — this is the recovery path
  when a *long* Wi-Fi outage made the native pipeline give up while locked.
- **Fallback switch**: if the stream fails N consecutive reconnects while
  the page is awake, mark stream-down, fall back to the legacy cue-file path
  (§9), and report the state over the player WS so the operator sees it.
- **Screen-lock UX**: instruct players (on-page copy) to lock the phone and
  pocket it *after* audio has started. A `wakeLock` is deliberately **not**
  used — locking is the intended state.

## 6. Content & encoding pipeline

- Liquidsoap re-encodes everything to one contract: **MP3 CBR 128 kbps,
  44.1 kHz, mono** (headphone narration; mono halves bandwidth and removes
  any L/R authoring accidents). Input files may be anything ffmpeg-readable.
- **Loudness-normalize at import time** (ffmpeg `loudnorm`, target −16 LUFS
  mono) rather than live in Liquidsoap — deterministic, auditable, done once.
  Hook this into blackbox-runner's `import_content.py` / TTS save path.
- Ambient beds: seamless loops, authored ~10 dB under narration level, one
  per narrative branch. The bed is what plays between narration items — it
  keeps the stream audibly alive (never ship pure silence as a bed; see §2).
- File naming stays blackbox-runner's (`content/audio/*.mp3`); the bridge
  addresses files by basename only.

## 7. Capacity

100 listeners × 128 kbps ≈ **13 Mbit/s** — negligible on wired LAN; the real
constraint is venue **Wi-Fi**: 100 phones holding a continuous TCP stream
each. Requirements for the venue AP setup (runbook material): enterprise-ish
AP (or several), 5 GHz, no client isolation between phones and the server
VLAN... actually phones only need the server, so client isolation *on* is
fine and preferable. Icecast and Liquidsoap CPU/RAM are trivial at this
scale (§4.1). Everything runs on the existing venue box or one adjacent
mini-PC; Docker Compose (`icecast`, `liquidsoap`, `bridge`) is the
deliverable.

## 8. Observability (the "without losing them" requirement)

- Bridge polls Icecast `/admin/listclients` per mount every 5 s → in-memory
  status map → `GET /status`.
- **Alert condition**: player claimed (bridge is told claims via
  blackbox-runner, or infers from first `play` call) ∧ 0 listeners on their
  mount for > 20 s → flagged in `GET /status`; the admin dashboard shows it
  red. Staff decision: approach the player or let auto-recovery work.
- Prometheus-style `/metrics` on the bridge (listener count, per-mount
  uptime, liquidsoap queue depths) — matches the `/metrics` habit both
  sibling repos already have.
- All bridge commands logged with timestamps → post-show, joinable against
  blackbox-runner's replay timeline.

## 9. Failure modes

| Failure | Behavior | Recovery |
|---|---|---|
| Phone Wi-Fi blip (seconds) | native player rides its buffer; maybe brief gap | automatic; watchdog reconnect if pipeline gave up |
| Long outage while locked | audio stops; page still frozen | on unlock/visibility, immediate reconnect (§5); operator sees red light meanwhile |
| Liquidsoap crash | mounts dry up, Icecast drops listeners | systemd/compose auto-restart; phones' watchdogs reconnect; expect ~10–20 s gap. Mounts come back with beds playing |
| Icecast crash | all streams drop | same as above |
| Whole stack dead mid-show | phones mark stream-down | **legacy cue-file path** still works via blackbox-runner WS for unlocked phones — degraded but the show survives |
| Bridge dead, streams alive | current audio/beds keep playing, no *new* narration | restart bridge; Liquidsoap state (queues) persists independently |
| Player closes the tab | listener gone → red light | staff re-engages; re-opening the page reclaims and replays (blackbox-runner's existing claim flow) |

Design rule embodied above: **the stream keeps playing even when control
fails** — every component that can die leaves the audio path in the most
alive state it can.

## 10. Test plan

- **T1 — locked-screen soak (go/no-go, do first)**: one mount, real iPhone
  (oldest iOS we must support) + one Android, screen locked in a pocket for
  45 min while narration items are injected every few minutes. Pass: every
  item audible, no touch needed. *This validates the core §2 assumption
  before anything else is built.*
- **T2 — load**: 100 headless listeners (`ffmpeg -i http://…/p/N.mp3 -f null -`)
  against 100 live encoders for 2 h; assert CPU, memory, zero mount drops.
- **T3 — chaos**: kill/restart liquidsoap, icecast, bridge, venue AP in turn
  during T2; assert recovery matches §9 and status/alerts fire.
- **T4 — latency calibration**: timestamped tone injected via bridge,
  measured at 10 phones → distribution → sets `LATENCY_COMP` (§4.3) per
  venue; repeat in the real venue during rehearsal.
- **T5 — integration**: full show run with blackbox-runner in mock-tracking
  mode; scripted scenario pushes per-player narratives; verify replay logs
  join up.

## 11. Implementation phases

- **Phase 0 — spike (≈1 day)**: docker-compose with Icecast + Liquidsoap,
  one hand-configured mount, run T1. *Go/no-go gate for the whole approach.*
- **Phase 1 — infra**: 100 generated mounts (players `1..100`), bridge API
  with auth + file validation, compose file, T2/T3 green.
- **Phase 2 — integration**: blackbox-runner engine calls bridge at cue
  points; player page stream element + Media Session + watchdog + fallback
  switch; admin dashboard status lights.
- **Phase 3 — hardening**: metrics, structured logs, runbook chapter (start
  order alongside blackbox-runner's `docs/runbook.md`), T4 calibration
  procedure documented.
- **Phase 4 — rehearsal validation**: T5 in the venue, tune
  `LATENCY_COMP` and burst-size, freeze config.

Open questions to resolve during Phase 0–1:

1. Oldest iOS/Android versions we must support (affects T1 device pool).
2. Are there *shared* sub-second-sync moments in the script? (out of scope
   for streaming; needs the pre-download mechanism flagged in §4.3.)
3. Player count ceiling per Liquidsoap process on the actual venue box
   (decides sharding).
4. Do mounts need per-show random suffixes (nosy audience members can guess
   `/p/7.mp3` and listen to someone else's narrative — accept, or salt?).
