# Feature inventory

An extensive map of what this repo does, grouped by area, with the app(s), service(s), or package(s) each feature depends on. See [README.md](README.md) for setup and running the show; this is a reference for what exists and where it lives.

## Show orchestration & lifecycle

- **Authoritative phase engine** (single running scenario graph, transitions, timers, epochs) — `apps/server/src/engine/phase-engine.ts`
- **Lifecycle states** (idle / lobby / active) with manual or scheduled start (no connected participants required), restart, return-to-idle; phone inactivity or disconnects do not end the show — `apps/server/src/engine/phase-engine.ts`, admin API (`apps/server/src/admin/admin.ts`), operator UI `apps/admin/src/App.tsx`
- **Lobby scheduling** — one or more date/time show starts, ±10s/±1min quick adjust — `apps/server/src/persistence/lobby-config.ts`, display `apps/display/src/components/LobbyCountdown.tsx` + `Countdown.tsx`
- **Session recovery / stale-command rejection** — expected-phaseId/epoch/sessionId checks on every admin mutation — `apps/server/src/engine/phase-engine.ts`, `apps/server/src/admin/admin.ts`
- **Public phase map for preloading** — unauthenticated `GET /api/phases` — `apps/server/src/server.ts`
- **Health/readiness endpoints** — `/healthz`, `/readyz` — `apps/server/src/readiness.ts`
- **Server-authoritative clock** — `packages/shared/src/serverClock.ts`, consumed by `apps/display/src/lib/serverClock.ts`

## Scenario model & content types

Defined in `packages/scenario/src/schema.ts`, enforced in `apps/server`, authored in `apps/studio`:

- Phase kinds: `idle`, `video`, `narration`, `position-question`, `video-position-question`, `group-branch`
- Narration phases: media-free display text (with per-group overrides) for drafting/validating a show graph before real video/audio assets exist, upgradeable in place to a real phone soundtrack — `packages/scenario/src/schema.ts`, display in `apps/display/src/App.tsx`, authored in Studio's Inspector
- Position fields: four-quadrant, two-quadrant/spectrum, polygon-zones
- Arena calibration: ellipse or perspective quad corners — `apps/display/src/components/QuadrantOverlay.tsx`
- Resolution rules: fixed-next, or quadrant-plurality with tie handling / `kleroterion` tie-break
- Video/still-image phases: video or still+MP3, extra audio layer, tail hold, subtitles, applause/boo windows, skip control, cursor visibility
- Synchronized phone-audio phases — engine in `apps/server`, playback in `apps/phone/src/SynchronizedPhoneAudio.tsx` + `lib/synchronized-audio.ts`
- Video-position-question hybrids (timed show/open/close/hide windows) — `apps/display/src/components/VideoQuestionOverlay.tsx`, `VoteCloseCountdown.tsx`
- Group catalogue & group-branch phases (balanced/self-select/vote-derived/manual, weighted branches, reunion) — [docs/group-branching.md](docs/group-branching.md), `apps/server/src/groups/`
- Per-phase/per-group phone narration — `apps/server/src/audio/personal-audio.ts` → `apps/phone`
- Outgoing show-control cues — `apps/server/src/cues/feed.ts`
- Cycle control and ghost-cursor fill target as scenario-level settings

## Scenario authoring — `apps/studio`

- Visual graph editor — `apps/studio/src/canvas/nodes.tsx`, `App.tsx`
- Typed inspector per phase kind (arena ellipse/quad editors, polygon zones, timing timeline) — `apps/studio/src/inspector/*`
- Media library (PocketBase-backed) with usage-reference tracking — `apps/studio/src/media/MediaLibraryDialog.tsx`, `pocketbase-media.ts` → **PocketBase**
- Local media fallback/import reconciliation — `apps/studio/src/media/local.ts`
- Device preview of the current Studio draft, stable phone/display links and QR, isolated runtime and TouchDesigner SSE cues — `apps/studio/src/preview/DevicePreview.tsx`, `apps/server/src/rehearsal/rehearsal.ts`, phone/display runtime routing
- Runtime validation + branch/display preview — `apps/studio/src/preview/*`
- Diagnostics panel — `apps/studio/src/diagnostics/DiagnosticsPanel.tsx`
- Local draft autosave/recovery — `apps/studio/src/io.ts`, `model.ts`
- Versioned export + authenticated publish (non-disruptive to a live session) — admin `/api/admin/publish`, `apps/server/src/readiness.ts`
- Studio↔runtime adapter — `packages/studio-adapter`

## Participant experience — `apps/phone`

- Join flow (name entry, admission, returning-participant lease) — `apps/phone/src/App.tsx`, `lib/lease.ts`, `apps/server/src/admission/*`
- Trackpad cursor input — `apps/phone/src/lib/trackpad.ts`
- Realtime cursor transport — `apps/phone/src/lib/realtimeWsClient.ts` via **apps/realtime-ws-coolify**
- Group selection UI — `apps/phone` + `apps/server/src/groups/`
- Headphone/personal audio (survives reconnects/scene changes/lock screen, auto-recovery) — `apps/phone/src/PhoneAudio.tsx`, `lib/audio-playback.ts` → **services/audio** + `apps/server/src/audio/personal-audio.ts`
- Synchronized local phone soundtrack — `apps/phone/src/SynchronizedPhoneAudio.tsx`, `lib/synchronized-audio.ts`
- Soundcheck / background music delivery — admin `/audio/soundcheck`, `/audio/music`
- Movement/position consent + opt-in recording (60s auto-delete without consent) — `apps/server/src/movement/movement-consent.ts`, `movement-recorder.ts`
- Reaction buttons (applause/boo) — `apps/server/src/votes/rating-engine.ts`, display `CrowdReactionSounds.tsx`

## Display / installation screen — `apps/display`

- Fullscreen show playback (video, still+audio, subtitles) — `PhaseVideo.tsx`, `PhaseImageAudio.tsx`, `PhaseSubtitles.tsx`
- Video handoff between phases (pre-buffered next clip) — `PhaseVideoHandoff.tsx`, `apps/server/src/engine/video.ts`
- Live cursor field (real + ghost cursors) — `cursors/CursorCanvas.tsx`, `cursorField.ts` ← **apps/realtime-ws-coolify** + server ghost pool
- Spectrum glow / cursor-density heat — `cursors/spectrumGlow.ts`
- Quadrant/zone overlays, vote-close countdown — `QuadrantOverlay.tsx`, `VoteCloseCountdown.tsx`, `VideoQuestionOverlay.tsx`
- Ghost cursors (replayed past-participant cursors filling a sparse room) — `apps/server/src/ghosts/ghost-cursor-player.ts`
- Idle attract loop (`attract-*.mp4` playlist, perspective-calibrated QR marker tracking) — `IdleAttract.tsx`, `idle/*`
- Join QR code / corner QR for late joiners — `QrBadge.tsx`, `qr/*`, `apps/server/src/admission/qr.ts`
- Lobby countdown + printed join URL — `LobbyCountdown.tsx`
- Display authentication (build-time token, installation/room resolved live from `/api/status`; one authenticated main display, plus one per active group and one per signage kiosk) — `lib/resolveInstallation.ts`, `apps/server/src/engine/phase-engine.ts`
- Signage kiosks (e.g. a lobby entrance screen): always show a looping video and the live join QR, independent of show state — `?signage=<id>`, `apps/server/src/engine/phase-engine.ts` (`signageDisplays`), Admin `DisplaySettingsPanel`
- Heartbeat / reconnect resilience (surfaced in Admin) — `lib/heartbeat.ts`, `lib/connection.ts`, `lib/backoff.ts`
- Service-worker app shell (known stale-bundle gotcha — see README) — `apps/display` build
- Kiosk mode / fullscreen control — `lib/kiosk.ts`, `FullscreenControl.tsx`
- Video playback diagnostics (stalled/error/autoplay-blocked → Admin) — `media/useVideoPlaybackDiagnostics.ts`
- Vote decision sound / crowd reaction audio — `VoteDecisionSound.tsx`, `CrowdReactionSounds.tsx`
- Configurable display text (join heading, countdown wording, instructions) — `lib/useDisplaySettings.ts`, stored in **PocketBase**, edited via `apps/admin/src/DisplaySettingsPanel.tsx`

## Admin operations — `apps/admin`

- Operator authentication (30-day session) — **PocketBase** `operators` collection, `apps/server/src/persistence/operator-auth.ts`
- Live operational status (server/display/playback/participants/session)
- Active-show scene navigator / live show graph, jump-to-scene, participant dropdown and reassignment — `LiveGraph.tsx`
- Session controls: start/skip/restart/idle, group-path start, force-reunion
- Lobby schedule management within the combined session controls panel
- Active show selection (published/pending, queued-until-show-ends)
- Ghost-cursor fill-target override
- Audio diagnostics page (`/admin/?view=audio`) — `AudioDiagnostics.tsx`
- Headphone stream ops: roster, background music, soundcheck, local↔remote backend switch → **services/audio**
- Shared media-library picker for default, per-group, and per-signage-kiosk lobby/waiting videos (MP4/WebM, sync readiness, muted loop, live updates, black-screen override) — protocol platform settings, display `IdleAttract`, Admin `DisplaySettingsPanel`, PocketBase platform config
- Display text editor — `DisplaySettingsPanel.tsx`
- Participant roster + group (re)assignment
- Session export (JSON/CSV) — `apps/server/src/persistence/admin-data.ts`
- Error log / audit log
- Admin API rate limiting — `apps/server/src/admission/rate-limit.ts`

## Admission & connectivity — `apps/server`

- QR-based admission with signed join grants — `admission/qr.ts`, `tokens.ts`
- Participant registry, capacity limits, returning-participant lease/reconnect — `admission/registry.ts`
- Per-IP join rate limiting
- Late-join toggle, printed/hidden phone join URL
- Cursor pipeline (batching/throttling) → **apps/realtime-ws-coolify**

## Voting & results

- Position vote engine (quadrant/two-quadrant/polygon tallying, live counts, freeze window) — `votes/vote-engine.ts`
- Reaction rating engine (applause/boo) — `votes/rating-engine.ts`
- Group-membership voting — `groups/voting.ts`
- Final vote snapshot persistence — `persistence/admin-data.ts`

## Group branching

- Group manager (catalogue, membership, balanced/manual/vote assignment, per-group paths/reunion) — `groups/group-manager.ts`
- Per-group phone narration and independent playback position
- Live group transfer with playback-position join — `apps/admin/src/App.tsx`, `apps/server/src/groups/`

## Audio (personal + ambient)

- Optional independent Janus/WebRTC personal audio at `/phone-janus/`, sharing phone UI and show cues; private mounts, group narration, music, soundcheck, recovery and a separate Coolify Compose deployment — [services/audio-janus](services/audio-janus/README.md)

- Personal audio bridge integration (Icecast/Liquidsoap) — `audio/personal-audio.ts` → **services/audio**
- Per-scene phone narration injection with delivery-failure retry
- Background/ambient music control (admin `/audio/music`)
- Soundcheck tooling (admin `/audio/soundcheck`, disabled during active show)
- Local↔remote audio backend hot-switch (venue-LAN fallback) — `services/audio/docker-compose.yml`
- Synchronized video+phone-audio playback (lead time, offset, drift correction) — [docs/synchronized-phone-audio.md](docs/synchronized-phone-audio.md)

## Camera / audience tracking (optional)

- TrackingBox integration: anonymous GID floor-position tracking as an alternate vote-position source — `apps/server/src/tracking/*` → **services/trackingbox** (vendored, separate machine/GPU)
- Graceful degradation (tracking outage → nobody standing anywhere, show never stops)

## External show control

- Authenticated SSE cue feed (TouchDesigner/other receivers) — `cues/feed.ts`, `GET /api/cues`, `docs/touchdesigner-production.md`, `docs/touchdesigner-question-monitor.md`
- Per-phase outgoing cue authoring — `packages/scenario`, Studio

## Persistence & data (PocketBase-backed)

- Operator accounts, published shows/artifacts, ghost-cursor pool, lobby config, installation config, platform config (display text), media library + one-way media sync, admin data (errors/audit/export) — all in `apps/server/src/persistence/*`, backed by self-hosted **PocketBase**

## Shared design system & contracts

- Design tokens/primitives shared by Admin + Studio — `packages/tool-ui`
- Wire protocol / message schemas — `packages/protocol`
- Scenario/media-manifest schemas + validation CLI — `packages/scenario`
- Shared runtime helpers (server clock, quadrant constants) — `packages/shared`
- Studio↔runtime adapter — `packages/studio-adapter`

## Tooling / dev & ops scripts

- `pnpm validate-scenario`, `pnpm build-media-manifest`, `pnpm import-show-yaml`, `pnpm generate-idle-marker-tracks` (Python/OpenCV), `pnpm simulate-clients`, PocketBase bootstrap scripts, Playwright e2e suite (`tests/e2e`, quarantined Studio specs), `pnpm import-media`.

---

## Dependency shape, in short

- **`apps/server`** is the hub — almost every feature above has a server-side authoritative half.
- **`apps/display`**, **`apps/phone`**, **`apps/admin`**, **`apps/studio`** are single-purpose browser clients.
- **`apps/realtime-ws-coolify`** is required in production for live cursors.
- **`services/audio`** and **`services/trackingbox`** are optional vendored subtrees (see README's [Services](README.md#services) section) — the show runs without either, degrading gracefully.
- **PocketBase** (self-hosted, not a workspace app) is required for admin login, publishing, the media library, display text, and audit/export, but not for the core in-memory show runtime itself.

### Current group on phones and admin

- Participant snapshots include current group metadata and whether the local scene has phone audio, for initial and nested selections, transfers, and reconnects (`packages/protocol`, `apps/server`). Phones show the current group, respect hidden scene cursors, and display only the applicable audio controls. The native stream remains mounted across silent stages; normal playback displays no success banner, since playback state does not confirm audible output (`apps/phone`).
- Admin participant labels and selectors use current membership even while a nested selection is still running on its parent timeline (`apps/admin`).

### Recoverable group selection and nested controls

- Admin can explicitly start chosen branches when only disconnected participants lack a choice; the panel shows disconnected blockers, and returning phones can choose a running branch. Selection timers never close an incomplete cohort; choices remain available after the nominal deadline and admin start reports missing assignments. Operator assignment works in nested selections. Late arrivals can choose a running or empty branch on their phones.
- All group branches start together at the split and advance on the server clock, including empty groups. The first late phone or display joins the current scene with its original media offset; moving the last participant out does not end a branch. Reunion waits for every branch to finish.
- Scoped Start and Reunion controls identify the parent group and selection scene, including a nested split that reuses a parent group ID. Phones and admin distinguish choosing, unassigned, active, and finished participants. Revisited nested selections retain the parent's cohort despite changed trade membership.
- Legacy branch-preview audio receives a full authored selection window after a changed choice; repeated clicks on the same group do not restart it. Dedicated narration phases support phone-only group instructions after selection. Studio warns when an explicit group entry equals its reunion.

- Silent phone scenes suspend native streaming and clear buffered audio while keeping the media element and listener playback intent. Scene and group changes wait for queued bridge reset/play work via registration before reconnecting, including when the stream URL is unchanged; an explicit listener pause remains paused (`apps/phone/src/PhoneAudio.tsx`).

Dependencies: `apps/server` engine/admin, `packages/protocol`, `packages/scenario`, `apps/admin`, `apps/phone`.

## Central show timing

- Display and phone connections bootstrap server time from phase snapshots, then refine it with ping/pong samples. Phone subtitle and reaction windows use that same corrected clock.
- Video and still-narration cues end on the server clock at `expectedDurationMs`; displays only play along (`apps/server/src/engine/video.ts`). A disconnected display cannot delay or advance the show.
- All finite display cue media (ordinary video, video questions, extra soundtracks, and still-image narration) seek to elapsed server cue time after late loading/reconnects and correct drift during playback. Future cues wait, and late arrivals honor the remaining visual tail.
- Admin's integrated **Show clock monitor** exposes server UTC, shared/per-group cue targets, and per-display/per-phone measured positions, drift, clock offset/round trip and report freshness, with device/attention filters. Display `?clock=1` exposes actual media position and drift for rehearsal.
- Timing contract, participating apps, and stream limitations: [docs/show-clock.md](docs/show-clock.md).

- Phones expose a collapsible **Show timing** monitor and send authenticated timing reports every 2 seconds. Synchronized Web Audio reports output-latency-compensated estimates; stream drift is explicitly unmeasured. Reports are checked against the current session, cue epoch and participant routing epoch.
