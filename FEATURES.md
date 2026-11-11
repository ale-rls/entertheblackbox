# Feature inventory

Current production architecture: participant devices use the native iOS/Android app only. Browser pages serve the main projection, four stage monitors, signage, Studio and Admin. Retained browser/streaming source is historical and not a supported delivery path.

An extensive map of current features and their dependencies. See [README.md](README.md) for setup and running the show; this is a reference for what exists and where it lives.

## Show orchestration & lifecycle

- **Authoritative phase engine** (single running scenario graph, transitions, timers, epochs) — `apps/server/src/engine/phase-engine.ts`
- **Lifecycle states** (idle / lobby / active) with manual or scheduled start (no connected participants required), restart, return-to-idle; phone inactivity or disconnects do not end the show; a three-hour maximum-duration guard returns the show to idle — `apps/server/src/engine/phase-engine.ts`, admin API (`apps/server/src/admin/admin.ts`), operator UI `apps/admin/src/App.tsx`
- **Lobby scheduling** — one or more date/time show starts, ±10s/±1min quick adjust — `apps/server/src/persistence/lobby-config.ts`, display `apps/display/src/components/LobbyCountdown.tsx` + `Countdown.tsx`
- **Session recovery / stale-command rejection** — expected-phaseId/epoch/sessionId checks on every admin mutation — `apps/server/src/engine/phase-engine.ts`, `apps/server/src/admin/admin.ts`
- **Public phase map for preloading** — unauthenticated `GET /api/phases` — `apps/server/src/server.ts`
- **Health/readiness endpoints** — `/healthz`, `/readyz` — `apps/server/src/readiness.ts`
- **Server-authoritative clock** — `packages/shared/src/serverClock.ts`, consumed by `apps/display/src/lib/serverClock.ts`

## Scenario model & content types

Defined in `packages/scenario/src/schema.ts`, enforced in `apps/server`, authored in `apps/studio`:

- Phase kinds: `idle`, `video`, `narration`, `position-question`, `video-position-question`, `group-branch`
- Narration phases (Studio: Audio + text): optional native phone audio, display text and timed M1–M4 cues, with per-group audio/text overrides; connect to a position question for an introduction before voting. Duration is authored explicitly — `packages/scenario/src/schema.ts`, display in `apps/display/src/App.tsx`, authored in Studio's Inspector
- Position fields: four-quadrant, two-quadrant/spectrum, polygon-zones
- Arena calibration: ellipse or perspective quad corners — `apps/display/src/components/QuadrantOverlay.tsx`
- Resolution rules: fixed-next, or quadrant-plurality with tie handling / `kleroterion` tie-break
- Video/still-image phases: video or still+MP3, extra audio layer, tail hold, subtitles, applause/boo windows, skip control, cursor visibility
- Synchronized native participant audio — engine in `apps/server`, native clock scheduler in `packages/expo-audio-scheduler`
- Video-position-question hybrids (timed show/open/close/hide windows) — `apps/display/src/components/VideoQuestionOverlay.tsx`, `VoteCloseCountdown.tsx`
- Group catalogue & group-branch phases (balanced/self-select/vote-derived/manual, weighted branches, reunion) — [docs/group-branching.md](docs/group-branching.md), `apps/server/src/groups/`
- Per-phase/per-group narration metadata — scenario snapshots → native cues in `apps/native`
- Outgoing show-control cues — `apps/server/src/cues/feed.ts`
- Cycle control and ghost-cursor fill target as scenario-level settings

## Scenario authoring — `apps/studio`

- Visual graph editor — `apps/studio/src/canvas/nodes.tsx`, `App.tsx`
- Typed inspector per phase kind (arena ellipse/quad editors, polygon zones, timing timeline) — `apps/studio/src/inspector/*`
- Curtain-light authoring: per-group switch, per-vote switch for shared-timeline votes (`curtainLightVote`), shared curtain (video + fabric/light tuning), per-stage answer colours with reset, light preview with simulated votes, neutral-gap/lighting rehearsal tuning, validation — `apps/studio/src/inspector/CurtainLightEditor.tsx`, `packages/scenario/src/curtain.ts`
- Media library (PocketBase-backed) with usage-reference tracking — `apps/studio/src/media/MediaLibraryDialog.tsx`, `pocketbase-media.ts` → **PocketBase**
- Local media fallback/import reconciliation — `apps/studio/src/media/local.ts`
- Device preview (isolated runtime with main/group/monitor display links) — **no longer reachable from the Studio editor**; module and server route remain — `apps/studio/src/preview/DevicePreview.tsx`, `apps/server/src/rehearsal/rehearsal.ts`
- Runtime validation + branch/display preview — `apps/studio/src/preview/*`
- Diagnostics panel (collapsed by default) — `apps/studio/src/diagnostics/DiagnosticsPanel.tsx`
- Missing-media warning badge on graph nodes; resizable properties panel (width remembered per browser) — `apps/studio/src/canvas/nodes.tsx`, `apps/studio/src/App.tsx`
- Local draft autosave/recovery — `apps/studio/src/io.ts`, `model.ts`
- Versioned export + authenticated publish (non-disruptive to a live session) — admin `/api/admin/publish`, `apps/server/src/readiness.ts`
- Studio↔runtime adapter — `packages/studio-adapter`
- Admission program, participant task and role editors (Show properties) — `apps/studio/src/inspector/AdmissionEditor.tsx`, `TaskEditor.tsx`, `RoleEditor.tsx`; contracts in `packages/scenario/src/admission.ts`, `tasks.ts`. See [participant workflows](docs/participant-workflows.md).

## Participant experience — `apps/native` and `apps/phone`

- Native iOS/Android app for both audiences and all loan tablets: participant name separate from the tablet's device label (`join.deviceLabel`; Admin, Instrument, Identify and video wall use the label), identity, group choices, button votes and reactions (no cursor voting: the server excludes native devices from cursor fields and cursor-vote cohorts; in-app participants vote physically or with explicitly configured buttons), downloaded narration and background music. See the native section below.
- Browser voting at `/phone/`: name/lease admission, group selection, cursor/button votes and reactions alongside native participants. Button answers take the phase's authored `answerColors` (`voting_options` option `color`); text uses Optik. `/` and legacy `/phone-janus/` redirect there. Keep the page foregrounded; personal audio requires the native app — `apps/phone`, `apps/server/src/static.ts`.
- Browser participant tasks: capability-aware joining, timed choices and outcome messages, with responses disabled after expiry or disconnect — `apps/phone/src/ParticipantTaskCard.tsx`. Admission-program audio and tablet handover remain native-only.
- Retained browser audio, Icecast/Liquidsoap and Janus source/tests are historical. Environment settings cannot enable stream delivery through `loadConfig`; production Compose no longer starts these services.

## Display / installation screen — `apps/display`

- Fullscreen show playback (video, still+audio, subtitles) — `PhaseVideo.tsx`, `PhaseImageAudio.tsx`, `PhaseSubtitles.tsx`
- Video handoff between phases (pre-buffered next clip) — `PhaseVideoHandoff.tsx`, `apps/server/src/engine/video.ts`
- Live cursor field (real + ghost cursors) — `cursors/CursorCanvas.tsx`, `cursorField.ts` ← **apps/realtime-ws-coolify** + server ghost pool
- Spectrum glow / cursor-density heat — `cursors/spectrumGlow.ts`
- Curtain-light votes for curtain-light groups and for votes flagged `curtainLightVote` on any timeline (WebGL2 relit packed curtain video, answer pools from the counting geometry, instanced per-cursor lights with touch pulses, white labels with dark halos, fade into the next scene) — `curtain/*`, geometry in `packages/shared/src/curtain.ts`; see `docs/curtain-light-voting.md`
- Quadrant/zone overlays, vote-close countdown — `QuadrantOverlay.tsx`, `VoteCloseCountdown.tsx`, `VideoQuestionOverlay.tsx`
- Ghost cursors (replayed past-participant cursors filling a sparse room) — `apps/server/src/ghosts/ghost-cursor-player.ts`
- Idle attract loop (`attract-*.mp4` playlist, no QR on main/group idle displays; perspective-calibrated QR marker tracking remains for signage kiosks) — `IdleAttract.tsx`, `idle/*`
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
- Native participant audio guidance and show clock diagnostics; stream controls are hidden when unconfigured. The legacy audio diagnostics page is retained as historical tooling.
- Shared media-library picker for default, per-group, and per-signage-kiosk lobby/waiting videos (MP4/WebM, sync readiness, muted loop, live updates, black-screen override) — protocol platform settings, display `IdleAttract`, Admin `DisplaySettingsPanel`, PocketBase platform config
- Display text editor — `DisplaySettingsPanel.tsx`
- Participant roster + group (re)assignment
- Audience overview on the Show tab: group head counts (online, no-group warning), App/Web totals, each device's current cue and time in cue, device audio report — `apps/admin/src/AudienceOverview.tsx`, `participantPresence` in `apps/server/src/engine/phase-engine.ts`
- Downloadable high-resolution PNG export of the configured participant join QR code
- Session export (JSON/CSV) — `apps/server/src/persistence/admin-data.ts`
- Participant tasks: send published templates, per-path GO gates, role assignment/withdrawal, tablet handover, task results CSV — `apps/admin/src/ParticipantTasks.tsx`, `AdmissionPrograms.tsx`, `/api/admin/tasks`, `/api/admin/handover`
- Error log / audit log
- Admin API rate limiting — `apps/server/src/admission/rate-limit.ts`

## Admission & connectivity — `apps/server`

- QR-based admission with signed join grants — `admission/qr.ts`, `tokens.ts`
- Participant registry, capacity limits, returning-participant lease/reconnect — `admission/registry.ts`
- Per-path admission programs (intro + loop clocks per device), capability-gated join with compatible update notice, occupant handover with `occupantId` validation of queued commands — `admission/admission-program.ts`, `admission/controller.ts`
- Server-arbitrated participant tasks and capacity-limited roles; restart cancels old-session tasks; late joiners in the audience join a scene task that is still open — `apps/server/src/prompts/task-engine.ts`
- Per-IP join rate limiting
- Late-join toggle, printed/hidden phone join URL
- Cursor pipeline (batching/throttling) → **apps/realtime-ws-coolify**

## Voting & results

- Position vote engine (quadrant/two-quadrant/polygon tallying, live counts, freeze window) — `votes/vote-engine.ts`
- Reaction rating engine (applause/boo) — `votes/rating-engine.ts`
- Group-membership voting — `groups/voting.ts`
- Neutral gaps in two-way/four-quadrant fields (uncounted bands; shared by counting and rendering) — `packages/shared/src/index.ts` (`quadrantOfField`, `fieldSplitOffsets`)
- Curtain-light entry: cursors hidden until first touch per stage, enter at a neutral point, relative steering, touch pulses — `apps/server/src/cursors/cursor-pipeline.ts`, `cursors/relative-trackpad.ts`, `engine/phase-engine.ts` (`curtainFor`, `curtainInput`); browser `touch: "start"` flag in `apps/phone/src/App.tsx`
- Final vote snapshot persistence — `persistence/admin-data.ts`

## Group branching

- Group manager (catalogue, membership, balanced/manual/vote assignment, per-group paths/reunion) — `groups/group-manager.ts`
- Group by client (`groupByClient`): native-app joins and web-browser joins each get an authored group at join time, also mid-show for late joiners; manual splits keep it. Clients send `client` in `join`; older apps are recognised as native by their `occupant-handover-v1` capability — `groups/group-manager.ts`, `participantClientOf` in `packages/protocol`, Studio Show properties → Audience groups
- Per-group native narration and independent playback position
- Live group transfer with playback-position join — `apps/admin/src/App.tsx`, `apps/server/src/groups/`

## Audio (personal + ambient)

- Native downloaded narration and looping background music, immutable release verification, group-targeted cues and clock-scheduled playback — `apps/native`, `packages/show-content`, `packages/expo-audio-scheduler`.
- Main projection video/image soundtracks remain supported in `apps/display`. Stage monitor videos are muted.
- Native cue delivery while locked requires venue acceptance on the actual devices. No browser/streaming fallback is supported.

## Camera / audience tracking (optional)

- TrackingBox integration: anonymous GID floor-position tracking as an alternate vote-position source — `apps/server/src/tracking/*` → **services/trackingbox** (vendored, separate machine/GPU)
- Graceful degradation (tracking outage → nobody standing anywhere, show never stops)

## External show control

- Authenticated SSE cue feed (TouchDesigner/other receivers) — `cues/feed.ts`, `GET /api/cues`, `docs/touchdesigner-production.md`
- Per-phase outgoing cue authoring — `packages/scenario`, Studio

## Persistence & data (PocketBase-backed)

- Operator accounts, published shows/artifacts, ghost-cursor pool, lobby config, installation config, platform config (display text), media library + one-way media sync, admin data (errors/audit/export) — all in `apps/server/src/persistence/*`, backed by self-hosted **PocketBase**

## Shared design system & contracts

- Design tokens/primitives shared by Admin + Studio — `packages/tool-ui`
- Wire protocol / message schemas — `packages/protocol`
- Scenario/media-manifest schemas + validation CLI — `packages/scenario`
- Shared runtime helpers (server clock, quadrant constants) — `packages/shared`
- Studio↔runtime adapter — `packages/studio-adapter`
- Optik (licensed, not in git) on audience-facing surfaces: native/credits bundle it at build time; `/phone/` and `/display/` load `/fonts/*.woff2` at runtime from the server's `FONTS_DIR` (Coolify `optik-fonts` volume), cached by the display service worker — `apps/server/src/static.ts` (`registerFontRoutes`), [fonts/README.md](fonts/README.md).

## Tooling / dev & ops scripts

- `pnpm validate-scenario`, `pnpm build-media-manifest`, `pnpm import-show-yaml`, `pnpm generate-idle-marker-tracks` (Python/OpenCV), `pnpm simulate-clients`, PocketBase bootstrap scripts, Playwright e2e suite (`tests/e2e`, quarantined Studio specs), `pnpm import-media`.

---

## Dependency shape, in short

- **`apps/server`** is the hub — almost every feature above has a server-side authoritative half.
- **`apps/display`**, **`apps/admin`**, **`apps/studio`** are browser clients. **`apps/native`** is the participant client.
- **`apps/realtime-ws-coolify`** is required in production for live cursors.
- **`services/trackingbox`** supplies optional physical positions. **`services/audio`** is retained historical source and is not deployed.
- **PocketBase** (self-hosted, not a workspace app) is required for admin login, publishing, the media library, display text, and audit/export, but not for the core in-memory show runtime itself.

### Current groups and native participants

Group membership, nested selections, transfer/reconnect routing and native per-group audio remain server-authoritative. Existing browser player recovery notes describe retired implementation, not production acceptance.

## Central show timing

- Display and phone connections bootstrap server time from phase snapshots, then refine it with ping/pong samples. Phone subtitle and reaction windows use that same corrected clock.
- Video and still-narration cues end on the server clock at `expectedDurationMs`; displays only play along (`apps/server/src/engine/video.ts`). A disconnected display cannot delay or advance the show.
- All finite display cue media (ordinary video, video questions, extra soundtracks, and still-image narration) seek to elapsed server cue time after late loading/reconnects and correct drift during playback. Future cues wait, and late arrivals honor the remaining visual tail.
- Admin's integrated **Show clock monitor** exposes server UTC, shared/per-group cue targets, and per-display/per-phone measured positions, drift, clock offset/round trip and report freshness, with device/attention filters; native app music without a clock target is excluded from drift checks. Display `?clock=1` exposes actual media position and drift for rehearsal.
- Timing contract, participating apps, and stream limitations: [docs/show-clock.md](docs/show-clock.md).

- Native apps expose timing diagnostics and send authenticated clock/playback reports. Reports are checked against the current session, cue epoch and participant routing epoch.

## Native participant app — `apps/native`

- Dark Stage companion screens separate setup/device diagnostics from live participation, without internal narration, subtitles, scene titles or header artwork, without a cursor pad (cursor voting is browser-only), and with an animated playback activity field driven only by foreground cue playback (background music excluded; not an amplitude meter). Respects reduced motion and stops animation in background; recovery/paused/closed-voting states retain server authority — `src/StageCompanion.tsx`, `src/stage-state.ts`. Display video remains on the shared screen; no phone image/video source exists in the current protocol.

- iOS/Android system action notifications for group selection, phone voting/cursors and reaction windows; permission requested on join, tap opens the app, duplicate suppression and cleanup on answer/phase change/leave. Alerts are silent to preserve show audio. Live delivery depends on WebSocket reception; force-quit/offline delivery is not supported. Requires a new native build and locked-device acceptance — `src/action-prompt.ts`, `src/notifications.ts`.

- Expo iOS/Android builds, preview/production EAS Update channels, fingerprint runtime compatibility, explicit disconnected-only updates — `app.config.ts`, `eas.json`, `src/App.tsx`
- Automatic active-show verification/download before every join (failed checks block admission; joined sessions pin their release), verified persistent MP3 downloads, per-group server cues, late-join seeking, pause/resume, reconnect and timing reports — `src/content.ts`, `src/cues.ts`, `src/player.ts`, `src/connection.ts`
- Native clock-scheduled playback: cues become layers anchored to server time, started/offset/stopped and drift-corrected in Swift/Kotlin so narration plays with the screen locked; narration runs a fixed 400 ms behind its phase so every phone starts it at 0:00 (video phase audio stays on the display clock); lock-screen controls, call/headphone interruptions, Android foreground media service — `packages/expo-audio-scheduler` (Expo module + config plugin), `src/player.ts`. Changes need a new EAS build.
- Participant name/identity, group selection, cursor/buttons/reactions, narration/subtitles — `src/App.tsx`; existing protocol and authoritative server
- Admission audio programs and participant task cards (outcome UI, alerts); identity rotation on handover clears occupant-scoped state. Locked-device and multi-cycle playback need physical acceptance — `src/admission-program.ts`, `src/ParticipantTaskCard.tsx`, `src/player.ts`, `packages/expo-audio-scheduler`. See [participant workflows](docs/participant-workflows.md).
- Coolify persists published native releases and channel pointers in the frontend’s `native-shows` volume across redeployments (`deploy/coolify/docker-compose.yml`).
- Unified show publication with SHA-256 immutable visual/audio assets, unique scenario versions and native releases pinned to the running show — `apps/server/src/publication.ts`, `packages/show-content`; legacy content-channel URLs alias the active release.
- Store submission package: production profile sets `STORE_BUILD=1` (phone-only iOS, Android overlay permission removed), EAS Metadata App Store listing/age rating in `apps/native/store.config.json`, Play internal-track draft submit; all store answers and blockers in [store submission guide](docs/store-submission.md). Icon/splash, store join screen and reviewer demo session are not done yet.
- Native lock-screen cue delivery is a physical-device acceptance requirement, not an automated guarantee; cue reception still runs in JS over the WebSocket. No fleet provisioning UI or live streaming fallback. Setup, publishing and rehearsal: [native player guide](docs/native-player.md).

- **Studio → Publish** (top-right primary action, disabled while diagnostics block it) validates and prepares all outputs, saves and selects the show automatically; active performances defer activation. One operator action for projection, M1–M4 and native devices — `apps/studio/src/App.tsx`, `/api/admin/publish`. See [publishing guide](docs/publishing.md).

- Native downloaded background music: choose an MP3 from the shared media library plus a volume; the server pulls the chosen library file into its media directory before publishing, and a looping native scheduler layer continues across narration transitions, with device pause/resume and session cleanup — `packages/show-content`, `apps/studio/src/App.tsx`, `apps/server/src/server.ts` (PocketBase `media` sync), `apps/native/src/player.ts`, `packages/expo-audio-scheduler`. Locked-device cue delivery requires physical acceptance; no pocket mode.

## Authored stage monitors — M1–M4

- Four independent authenticated `/display/?monitor=M1` … `M4` pages; replacement affects only that monitor, never the main projection — `apps/server/src/engine/phase-engine.ts`, `apps/display/src/monitors/MonitorApp.tsx`.
- Per-phase video, image/caption, text, placeholder and blank sequences with offsets, optional durations, fit and looping; missing screens and gaps are black — `packages/scenario/src/monitors.ts`.
- Automatic server-clock countdown on visible nonblank monitor cues during open positioning votes (plain or video-timed); hidden for resolved, closed or untimed votes — `apps/display/src/monitors/countdown.ts`.
- Answer colour coding and Optik: monitor N draws text and captions in the phase's Nth answer colour (outcome order, authored `answerColors` or the resolved curtain colours); phases without colours stay white — `apps/display/src/monitors/answerColor.ts`.
- Studio inspector controls, shared media-library selection and usage tracking, schema/export validation and display-preview links — `apps/studio/src/inspector/MonitorEditor.tsx`.
- Complete manifest predownload with byte/hash verification and retries, cached Blob playback, main server clock alignment, late-join seeking and reconnect recovery — existing display `mediaStore`, `DisplayConnection`, monitor playback.
- Local setup/readiness/error overlay (`&setup=1`); all-screen readiness does not automatically gate show start. Main timeline only; videos muted. TouchDesigner scene/question helpers removed. [Setup and acceptance](docs/monitor-displays.md).

### Native foreground show mode

The app enters an awake, black waiting screen as soon as it is admitted (and again after a reconnect); it reveals group choice, button voting, tasks and rating windows. Hold the exit control for two seconds to restore device controls; after 60 s without a touch the app returns to show mode — `shouldEnterShowMode` in `apps/native/src/stage-state.ts`. Android Back is consumed during show mode; optional system screen pinning restricts Home and app switching after Android confirmation. Managed devices can allowlist the app for lock task mode. Power-button locking and Android's unpin gesture remain available. Requires a new native build containing ShowScreen; older binaries keep their existing controls.

Implemented in apps/native and the ShowScreen module bundled with packages/expo-audio-scheduler.

- Admin display settings set the resting native show-mode colour, pushed over the WebSocket and applied on the shared clock (`surface` message) — `apps/server/src/surface/surface.ts`, `apps/native/src/surface.ts`
- Admin **Instrument** tab: tablets as a playable colour grid (press/hold/drag, multi-touch chords, All pad, latch, dimmer, live recolour) with 40-key keyboard play, and per-tablet **Identify** flash — `apps/admin/src/SurfaceInstrument.tsx`, `POST /api/admin/surface`
- Instrument **effects** (chase, breathe, wave, gradient wave, rainbow) rendered on the server and sent on the shared clock — `apps/server/src/surface/effects.ts`, `packages/shared/src/surfaceEffects.ts`, `POST /api/admin/surface/effect`
- Admin **Wall** tab: tablet video wall. Slice calculator (crop per position with bezel compensation, Premiere Scale/Position, ffmpeg commands, CSV sheet, reference preview), tablet-to-position assignment, and Load/Play/Restart/Cue/Stop/Loop with per-tablet download, ready and drift status — `apps/admin/src/VideoWall.tsx`, `packages/shared/src/videoWall.ts`, `apps/server/src/wall/wall.ts`, `GET/POST /api/admin/wall`, `PUT /api/admin/wall/layout`; layout persisted in `platform_config` (`video-wall`); slices are media library files `<clip>__<position>.mp4`; any other MP4 plays as a whole video that each tablet crops to its own region; the calculator reads the master size from a reference file; Lenovo Tab M7 (TB-7306F) preset and default 6 × 6 landscape layout, portrait/landscape mounting (tablets rotate the video in the portrait-locked app); videos and slices upload to the media library straight from the Wall tab (`apps/admin/src/wallUpload.ts`)
- Native wall playback: downloads and verifies this tablet's slice (or the whole video, enlarged and offset to its region by `wallCropFraction`), plays it full screen in show mode with `expo-video`, started on the shared clock and kept in step by rate nudges and seeks; reports status over `wall_status` — `apps/native/src/WallVideo.tsx`, `apps/native/src/wall.ts`, `apps/native/src/content.ts`
- Native device label (T01–T40) stored on the device and used as the join name; show-mode text fades after 4 s idle — `apps/native/src/App.tsx`, `apps/native/src/StageCompanion.tsx`
- Admin phone audio coverage audits every phase/group assignment against immutable downloaded bytes, distinguishing unassigned, unpublished, missing and corrupt audio; device timing separately reports runtime playback.

- Optional `monitorGroupId` makes M1–M4 follow that audience’s independent path, clears cues while it waits, and returns to the shared timeline at reunion — scenario schema/validation and server phase engine.

- Studio phone audio uses the same audio-filtered library picker for default tracks, audience-specific replacements and group-selection audio; explicit default/silence states and removal controls explain what each audience hears — Studio Inspector and media picker.

### Automatic personal task routing

Participant tasks can play introduction and outcome recordings, assign audience groups after capped role acceptance, and open follow-up tasks after recordings finish. Roles share capacity across task instances. Vote-based recordings use the previous question plurality and an explicit tie/empty fallback. Persistent workflows survive scene changes and admit eligible late arrivals; scene cancellation and show restart stop them. Native playback follows each response clock; show-content publishing bundles all recordings. Native clients require participant-task-routing-v1; theater browser access remains supported. Implemented in packages/scenario, apps/server/src/prompts, apps/server/src/engine, packages/show-content and apps/native. Tablet routing retains occupant identity; identity reset remains a separate handover operation.

Studio exposes task attachments on both video and narration scenes and shows their audience, recordings, group/role assignments and follow-up task routes in the scene inspector.

## Actor script reader

- **Admin → Script** loads a private plain-text script, advances shared paragraph cues, and creates/revokes read-only actor links. Actors follow the cue or scroll independently and adjust text size. Server memory only; restart clears the script. No audience/show-control permissions on reader links. Apps: `admin`, `server`. See [actor script guide](docs/actor-script.md).
