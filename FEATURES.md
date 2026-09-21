# Feature inventory

An extensive map of what this repo does, grouped by area, with the app(s), service(s), or package(s) each feature depends on. See [README.md](README.md) for setup and running the show; this is a reference for what exists and where it lives.

## Show orchestration & lifecycle

- **Authoritative phase engine** (single running scenario graph, transitions, timers, epochs) — `apps/server/src/engine/phase-engine.ts`
- **Lifecycle states** (idle / lobby / active) with manual or scheduled start, restart, return-to-idle — `apps/server/src/engine/phase-engine.ts`, admin API (`apps/server/src/admin/admin.ts`), operator UI `apps/admin/src/App.tsx`
- **Lobby scheduling** — one or more date/time show starts, ±10s/±1min quick adjust — `apps/server/src/persistence/lobby-config.ts`, display `apps/display/src/components/LobbyCountdown.tsx` + `Countdown.tsx`
- **Session recovery / stale-command rejection** — expected-phaseId/epoch/sessionId checks on every admin mutation — `apps/server/src/engine/phase-engine.ts`, `apps/server/src/admin/admin.ts`
- **Public phase map for preloading** — unauthenticated `GET /api/phases` — `apps/server/src/server.ts`
- **Health/readiness endpoints** — `/healthz`, `/readyz` — `apps/server/src/readiness.ts`
- **Server-authoritative clock** — `packages/shared/src/serverClock.ts`, consumed by `apps/display/src/lib/serverClock.ts`

## Scenario model & content types

Defined in `packages/scenario/src/schema.ts`, enforced in `apps/server`, authored in `apps/studio`:

- Phase kinds: `idle`, `video`, `position-question`, `video-position-question`, `group-branch`
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
- Display authentication (single authenticated display via installation/room/token) — `lib/resolveInstallation.ts`
- Heartbeat / reconnect resilience (surfaced in Admin) — `lib/heartbeat.ts`, `lib/connection.ts`, `lib/backoff.ts`
- Service-worker app shell (known stale-bundle gotcha — see README) — `apps/display` build
- Kiosk mode / fullscreen control — `lib/kiosk.ts`, `FullscreenControl.tsx`
- Video playback diagnostics (stalled/error/autoplay-blocked → Admin) — `media/useVideoPlaybackDiagnostics.ts`
- Vote decision sound / crowd reaction audio — `VoteDecisionSound.tsx`, `CrowdReactionSounds.tsx`
- Configurable display text (join heading, countdown wording, instructions) — `lib/useDisplaySettings.ts`, stored in **PocketBase**, edited via `apps/admin/src/DisplaySettingsPanel.tsx`

## Admin operations — `apps/admin`

- Operator authentication (30-day session) — **PocketBase** `operators` collection, `apps/server/src/persistence/operator-auth.ts`
- Live operational status (server/display/playback/participants/session)
- Scene navigator / live show graph, jump-to-scene, participant reassignment — `LiveGraph.tsx`
- Session controls: start/skip/restart/idle, group-path start, force-reunion
- Lobby schedule management
- Active show selection (published/pending, queued-until-show-ends)
- Ghost-cursor fill-target override
- Audio diagnostics page (`/admin/?view=audio`) — `AudioDiagnostics.tsx`
- Headphone stream ops: roster, background music, soundcheck, local↔remote backend switch → **services/audio**
- Persisted default and per-group lobby/waiting video URLs (muted loop, live updates, group black-screen override) — protocol platform settings, display `IdleAttract`, Admin `DisplaySettingsPanel`, PocketBase platform config
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
