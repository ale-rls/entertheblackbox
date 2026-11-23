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
- Narration phases (Studio: Audio + text): optional native phone audio, display text and timed M1–M4 cues, with per-group audio/text overrides; connect to a position question for an introduction before voting. Duration is authored explicitly. **Title at top** (`titleLayout: "top"`) sets the title and text in a band at the top of the main display instead of centred, for scenes where the curtain is open and the audience should stay visible — `packages/scenario/src/schema.ts`, display in `apps/display/src/App.tsx`, authored in Studio's Inspector
- Position fields: four-quadrant, two-quadrant/spectrum, polygon-zones
- Arena calibration: ellipse or perspective quad corners — `apps/display/src/components/QuadrantOverlay.tsx`
- Resolution rules: fixed-next, or quadrant-plurality with tie handling / `kleroterion` tie-break
- Video/still-image phases: video or still+MP3, extra audio layer, tail hold, subtitles, applause/boo windows, skip control, cursor visibility
- Scene loop video (`loopVideoSrc`): a muted video the main display loops behind narration, position-question and still+MP3 scenes (e.g. an idle curtain), replacing the still. Rejected on scenes whose own `src` is a video. Published and manifest-checked like other visual media — `packages/scenario/src/schema.ts`, `apps/server/src/publication.ts`, Studio Inspector "Main display loop". Behind a title (narration with text) the loop dims to the curtain-light vote's level with the vote's own curve, over one second in and out, so the title reads like a vote question; a curtain vote straight after starts at that level. A vote over a loop that isn't drawn as curtain light (e.g. the open curtain) dims the same way under its labels, and so does any scene showing cursors over its loop, so cursors always glow as in a vote (Studio *Keep the loop bright under cursors* / `keepLoopBright` opts out, e.g. a QR code in the loop) — `apps/display/src/curtain/titleDim.tsx`, `packages/shared/src/backdropDim.ts`
- Synchronized native participant audio — engine in `apps/server`, native clock scheduler in `packages/expo-audio-scheduler`
- Video-position-question hybrids (timed show/open/close/hide windows) — `apps/display/src/components/VideoQuestionOverlay.tsx`, `VoteCloseCountdown.tsx`
- Group catalogue & group-branch phases (balanced/self-select/vote-derived/manual, weighted branches, reunion) — [docs/group-branching.md](docs/group-branching.md), `apps/server/src/groups/`
- Per-phase/per-group narration metadata — scenario snapshots → native cues in `apps/native`
- Outgoing show-control cues — `apps/server/src/cues/feed.ts`
- Cycle control and ghost-cursor fill target as scenario-level settings

## Scenario authoring — `apps/studio`

- Visual graph editor — `apps/studio/src/canvas/nodes.tsx`, `App.tsx`
- Typed inspector per phase kind (arena ellipse/quad editors, polygon zones, timing timeline) — `apps/studio/src/inspector/*`
- Curtain-light authoring: per-group switch, per-vote switch for shared-timeline votes (`curtainLightVote`), per-stage "Keep cursors from the previous curtain vote" (`curtainKeepCursors`) and "Fields don't light up yet" (`curtainFieldsStatic`), shared curtain (video + default neutral gap; fabric and light are fixed in code, `CURTAIN_DEFAULTS`), per-stage answer colours with reset (monitors and phones; the curtain stays neutral), light preview with simulated votes, per-stage neutral gap, validation — `apps/studio/src/inspector/CurtainLightEditor.tsx`, `packages/scenario/src/curtain.ts`
- Media library (PocketBase-backed) with usage-reference tracking — `apps/studio/src/media/MediaLibraryDialog.tsx`, `pocketbase-media.ts` → **PocketBase**
- Local media fallback/import reconciliation — `apps/studio/src/media/local.ts`
- Device preview (isolated runtime with main/group/monitor display links) — **no longer reachable from the Studio editor**; module and server route remain — `apps/studio/src/preview/DevicePreview.tsx`, `apps/server/src/rehearsal/rehearsal.ts`
- Runtime validation + branch/display preview — `apps/studio/src/preview/*`
- Screen minimap (bottom-left of the canvas while a scene is selected): schematic main/group display, M1–M4 (first cue, cue-count pips), native app (portrait) and browser `/phone/` showing what that scene puts on each; empty screens draw dashed; group-path scenes show on the group display and monitors only follow `monitorGroupId` — `apps/studio/src/minimap/*`
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
- Scene loop video: muted, looped on the absolute server clock so scenes in a row sharing a loop continue without a jump and every display shows the same frame; it stays up until an incoming scene video is presented. A loop that follows a picture-only clip (a curtain closing) dissolves in over the clip's last frame in 0.5 s, the reverse of the loop-to-opening dissolve. Pinned in the media store under its own owner beside the curtain-light video — `components/LoopVideo.tsx`, `App.tsx`, `media/mediaStore.ts` (`pin`). Main display only: no native app change
- Skipped phase audio fades out over 3 s: video sound, extra audio and image+MP3 audio that is still playing when the show moves on continue from a detached copy that ramps to silence while the picture cuts as before; the outgoing Blob URL is held for the fade. Natural ends, paused and muted media are untouched — `apps/display/src/media/skipFade.ts`, `PhaseVideoHandoff.tsx`, `PhaseImageAudio.tsx`, `media/mediaStore.ts` (`holdUrl`)
- Side safe area for vote text (Admin → Displays, `textSafeArea`, default 5% of the width per side): curtain questions and answer labels stay inside it, and labels at the ends of a scale move inward instead of being cut off; the plain field's axis labels use it too — `apps/display/src/curtain/CurtainStage.tsx` (`safeLabelX`), `packages/protocol/src/platform-settings.ts`, `apps/admin/src/DisplaySettingsPanel.tsx`
- Live cursor field (real + ghost cursors), drawn outside curtain votes as glowing lights in the curtain-light cursor look; a scene can hold its cursors back for its first seconds (`cursorsFromMs`, e.g. T5.0's 20 s hold) (participant colour lifted to white, touch pulse, added onto the scene) — `cursors/CursorCanvas.tsx`, `glowCursor.ts`, `cursorField.ts` ← **apps/realtime-ws-coolify** + server ghost pool
- Spectrum glow / cursor-density heat — `cursors/spectrumGlow.ts`
- Curtain-light votes for curtain-light groups and for votes flagged `curtainLightVote` on any timeline; a vote can draw its light over its scene's own loop video instead of the shared curtain (`curtainOverSceneLoop`, e.g. the open curtain, or the closed-curtain loop so a stretch of titles and votes stays one continuous bed: the lit curtain draws the running loop's own frames and fades in over it) (WebGL2 relit packed curtain video, neutral answer pools from the counting geometry divided by a thin cross, instanced per-cursor lights with a centre in each participant's own phone colour and a warm-white flood on the fabric, with touch pulses, white labels with dark halos, fade into the next scene) — `curtain/*`, geometry in `packages/shared/src/curtain.ts`; see `docs/curtain-light-voting.md`
- Spotlight mode on a main-timeline Position question: live browser cursors reveal the curtain against black, grow from ordinary cursor cues, and hold their final positions after the countdown. Studio sets diameter and hold. The director determines casting on site. The cue advances to its fixed target.
- Quadrant/zone overlays, vote-close countdown — `QuadrantOverlay.tsx`, `VoteCloseCountdown.tsx`, `VideoQuestionOverlay.tsx`
- Scene countdown on video and narration scenes (`countdown`: start/end on the scene timeline, optional Ping4 in the final seconds, optional `countFrom` to count an amount such as 2.000.000 tokens down to 0 instead of seconds; monitor cues take `countdownFrom` likewise): large centred number on the main display (beneath the text on narration scenes), same seconds on M1–M4 with a visible cue; edited in Studio → Countdown — `apps/display/src/components/SceneCountdown.tsx`, `packages/scenario/src/monitor-countdown.ts` (shared with the native app's audible countdown), `packages/scenario/src/scene-countdown.ts`
- Ghost cursors (replayed past-participant cursors filling a sparse room) — `apps/server/src/ghosts/ghost-cursor-player.ts`
- Idle attract loop (`attract-*.mp4` playlist, no QR on main/group idle displays; perspective-calibrated QR marker tracking remains for signage kiosks) — `IdleAttract.tsx`, `idle/*`
- Join QR code / corner QR for late joiners — `QrBadge.tsx`, `qr/*`, `apps/server/src/admission/qr.ts`
- Lobby countdown + printed join URL — `LobbyCountdown.tsx`
- Display authentication (build-time token, installation/room resolved live from `/api/status`; one authenticated main display, plus one per active group and one per signage kiosk) — `lib/resolveInstallation.ts`, `apps/server/src/engine/phase-engine.ts`
- Signage kiosks (e.g. a lobby entrance screen): always show a looping video and the live join QR, independent of show state — `?signage=<id>`, `apps/server/src/engine/phase-engine.ts` (`signageDisplays`), Admin `DisplaySettingsPanel`
- Heartbeat / reconnect resilience (surfaced in Admin) — `lib/heartbeat.ts`, `lib/connection.ts`, `lib/backoff.ts`
- Service-worker app shell (known stale-bundle gotcha — see README) — `apps/display` build
- Kiosk mode / fullscreen control — `lib/kiosk.ts`, `FullscreenControl.tsx`
- Screen fit for non-16:9 screens: the 16:9 frame letterboxes by default; `?fit=height` fills the height and crops the sides (e.g. a 4:3 rehearsal projector), `?fit=width` fills the width and crops top/bottom. Works on main, group and signage displays; M1–M4 monitors ignore it — `lib/displayFit.ts`, `style.css`
- Video playback diagnostics (stalled/error/autoplay-blocked → Admin) — `media/useVideoPlaybackDiagnostics.ts`
- Vote decision sound / crowd reaction audio — `VoteDecisionSound.tsx`, `CrowdReactionSounds.tsx`
- Configurable display text (join heading, countdown wording, instructions) — `lib/useDisplaySettings.ts`, stored in **PocketBase**, edited via `apps/admin/src/DisplaySettingsPanel.tsx`

## Admin operations — `apps/admin`

- Operator authentication (30-day session) — **PocketBase** `operators` collection, `apps/server/src/persistence/operator-auth.ts`
- Live operational status (server/display/playback/participants/session)
- Operator fields on a video scene (`operatorFields`, e.g. the hack's target field): the operator lights one field at a time and steps a counter from the cue sheet's Now panel; the main display and M1–M4 show it as "Checkpoints: n/total". Admin → Setup → *Hack checkpoints* replaces the scenes' total live, without republishing (`hackCheckpoints` in the display settings, restored at server start) (`POST /api/admin/operator-field`); the main display draws the lit field in its colour, the others faintly outlined, and the counter — `apps/admin/src/CueList.tsx`, `apps/server` (`adminOperatorField`, phase snapshot `operatorField`), `apps/display/src/components/OperatorFields.tsx`, Studio → Operator fields. Stage lights for the field are not sent (lights paused)
- Admin navigation: six main tabs (Show, Cues, Devices, Instrument, Displays, Setup) and a **More** menu for Tasks, Wall and Script; the open view survives a reload. On phones the top bar is compact, tabs are one sideways-scrolling row that keeps the open tab in view, and wide tables scroll inside their panel — `apps/admin/src/App.tsx`, `admin.css`
- Active-show cue sheet on its own **Cues** tab: scenes named by their operator-only script cue name (`cueName`, set in Studio; title and ID shown beneath), endings named after their first cue; Now / Next, the operator's options right now (manual continuation after a loop, endings, variant scenes) with Go buttons, and the whole show in playback order with alternative endings side by side; derived from the published routes, reloaded whenever it is missing or the server has restarted (e.g. after publishing), so an open Admin tab follows the new show — `CueList.tsx`, `cue-list-model.ts`, `flow-refresh.ts`
- Full scene graph behind "Full graph": live show graph, jump-to-scene, participant dropdown and reassignment — `LiveGraph.tsx`
- Session controls: start/skip/restart/idle, group-path start, force-reunion
- Lobby schedule management within the combined session controls panel
- Active show selection (published/pending, queued-until-show-ends)
- Ghost-cursor fill-target override
- Native participant audio guidance and show clock diagnostics; stream controls are hidden when unconfigured. The legacy audio diagnostics page is retained as historical tooling.
- Shared media-library picker for default, per-group, and per-signage-kiosk lobby/waiting videos (MP4/WebM, sync readiness, muted loop, live updates, black-screen override) — protocol platform settings, display `IdleAttract`, Admin `DisplaySettingsPanel`, PocketBase platform config
- Display text editor — `DisplaySettingsPanel.tsx`
- Participant roster + group (re)assignment
- Show monitor at the top of the Show tab: stable group rows, rolling timeline/table views, online counts, separate scene/audio countdowns, reunion readiness, and expandable device cues, audio reports and freshness. Stale, mismatched and missing reports stay unknown; nested paths use leaf rosters. Audio length comes from native playback (older builds show unknown); music stays separate — `apps/admin/src/ShowMonitor.tsx`, `show-monitor-model.ts`, native `ShowPlayer`, `packages/expo-audio-scheduler`
- Downloadable high-resolution PNG export of the configured participant join QR code
- Session export (JSON/CSV) — `apps/server/src/persistence/admin-data.ts`
- Participant tasks: send published templates, per-path GO gates, role assignment/withdrawal, tablet handover, task results CSV — `apps/admin/src/ParticipantTasks.tsx`, `AdmissionPrograms.tsx`, `/api/admin/tasks`, `/api/admin/handover`
- Error log / audit log
- Admin API rate limiting — `apps/server/src/admission/rate-limit.ts`

## Admission & connectivity — `apps/server`

- QR-based admission with signed join grants — `admission/qr.ts`, `tokens.ts`
- Participant registry, capacity limits, returning-participant lease/reconnect — `admission/registry.ts`
- Per-path admission programs (intro + loop clocks per device), capability-gated join with compatible update notice, occupant handover with `occupantId` validation of queued commands — `admission/admission-program.ts`, `admission/controller.ts`
- Server-arbitrated participant tasks and capacity-limited roles; Studio can mark bookkeeping tasks to complete at scene end or deadline without a response button; restart cancels old-session tasks; late joiners in the audience join a scene task that is still open — `apps/server/src/prompts/task-engine.ts`
- PIN-protected staff menu on native tablets: assigns a published staff pick (role and/or group) to that tablet's occupant; PIN from env `STAFF_PIN`, per-participant lockout — `apps/server/src/prompts/staff-gate.ts`, `PhaseEngine.staffCommand`, `apps/native/src/StaffMenu.tsx`, protocol `staff_menu_request`/`staff_assign`, Studio `StaffPickEditor.tsx`
- Per-IP join rate limiting
- Late-join toggle, printed/hidden phone join URL
- Cursor pipeline (batching/throttling) → **apps/realtime-ws-coolify**

## Voting & results

- Position vote engine (quadrant/two-quadrant/polygon tallying, live counts, freeze window) — `votes/vote-engine.ts`
- Reaction rating engine (applause/boo) — `votes/rating-engine.ts`
- Group-membership voting — `groups/voting.ts`
- Neutral gaps in two-way/four-quadrant fields (uncounted bands; shared by counting and rendering) — `packages/shared/src/index.ts` (`quadrantOfField`, `fieldSplitOffsets`)
- Curtain-light entry: cursors hidden until first touch per stage (a stage with `curtainKeepCursors` continues the previous curtain stage's cursors instead), enter at a neutral point, relative steering, touch pulses — `apps/server/src/cursors/cursor-pipeline.ts`, `cursors/relative-trackpad.ts`, `engine/phase-engine.ts` (`curtainFor`, `curtainInput`); browser `touch: "start"` flag in `apps/phone/src/App.tsx`
- Final vote snapshot persistence — `persistence/admin-data.ts`

## Group branching

- Group manager (catalogue, membership, balanced/manual/vote assignment, per-group paths/reunion) — `groups/group-manager.ts`
- Group by client (`groupByClient`): native-app joins and web-browser joins each get an authored group at join time, also mid-show for late joiners; manual splits keep it. Clients send `client` in `join`; older apps are recognised as native by their `occupant-handover-v1` capability — `groups/group-manager.ts`, `participantClientOf` in `packages/protocol`, Studio Show properties → Audience groups
- Per-group native narration and independent playback position
- Live group transfer with playback-position join — `apps/admin/src/App.tsx`, `apps/server/src/groups/`

## Audio (personal + ambient)

- Native downloaded narration and looping background music, immutable release verification, group-targeted cues and clock-scheduled playback — `apps/native`, `packages/show-content`, `packages/expo-audio-scheduler`.
- Native skipped-audio fade: a cue replaced or cleared while sounding, and admission audio cut by the show start, fade out over 3 s via the scheduler's native `fadeOutLayer` (works locked); builds without it hard-stop — `apps/native/src/player.ts`, `packages/expo-audio-scheduler` (iOS/Android `SchedulerEngine`).
- Main projection video/image soundtracks remain supported in `apps/display`. Stage monitor videos are muted.
- Native cue delivery while locked requires venue acceptance on the actual devices. No browser/streaming fallback is supported.

## Camera / audience tracking (optional)

- TrackingBox integration: anonymous GID floor-position tracking as an alternate vote-position source — `apps/server/src/tracking/*` → **services/trackingbox** (vendored, separate machine/GPU)
- Graceful degradation (tracking outage → nobody standing anywhere, show never stops)

## External show control

- Authenticated SSE cue feed (TouchDesigner/other receivers) — `cues/feed.ts`, `GET /api/cues`, `docs/touchdesigner-production.md`
- Per-phase outgoing cue authoring — `packages/scenario`, Studio
- MIDI bridge for Ableton on the sound MacBook: subscribes to `GET /api/cues` with the display token and turns outgoing cues, scene starts and show end into MIDI notes/CC/program changes through the macOS IAC Driver; JSON mapping file reloaded on save; never replays on (re)connect; `--test`, `--dry-run`, `--list-outputs`. Runs only on the MacBook, not deployed — `apps/midi-bridge`, `pnpm midi-bridge`, [docs/ableton-midi.md](docs/ableton-midi.md)
- Eos bridge for stage light on the laptop cabled to the ETC Eos/Nomad desk, or on the Nomad PC itself: subscribes to `GET /api/cues` with the display token and plays looks (per-lamp colour and level, timed fades) on the desk over OSC/TCP 3037 as Eos user 0, triggered by outgoing cues, scene starts or set times within a scene (timed steps, on the server's clock like monitor cues), vote results (by scene and winner) and show end; palette, fixtures, looks and triggers in one JSON file reloaded on save; never replays on (re)connect; `--test`, `--dry-run`, `--list`, `--ping`. Runs only on that laptop or the Nomad PC, not deployed; `pnpm eos-bridge:windows` builds a portable Windows folder/zip (official node.exe, bundled bridge, double-click launchers, `settings.cmd` for server and token, desk at 127.0.0.1) so the Nomad PC needs no Node install (`apps/eos-bridge/scripts/package-windows.mjs`). Light cues written in the script (`Licht: L1+L3: <colour> L2+L4: off`, a colour table, the vote-winner sentence, and 2×2 field grids that give each field M1–M4 its monitor text and lamp colour; Google Docs export or .docx) are checked by `/check-script-updates` and turned into `lighting.json` scene triggers (timed to the monitor cues inside longer scenes) by `/update-show` (`light_plan.py`, [docs/script-light-cues.md](docs/script-light-cues.md)) — `apps/eos-bridge`, `pnpm eos-bridge`, [docs/eos-lighting.md](docs/eos-lighting.md)

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
- Claude Code project skills (`.claude/skills/`): `/update-show` (revise a Studio backup or draft), `/check-script-updates` (check a script Google Doc for missing features and text/recording changes against the show; colour legend parser `parse_script.py`), `/check-app-update` (Android preview app vs main and the live show).

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
- Video and still-narration cues end on the server clock at `expectedDurationMs`; displays only play along (`apps/server/src/engine/video.ts`). A cue that trails the clock plays out to its own end for up to 1.5 s past its duration instead of being cut (`packages/shared/src/mediaClock.ts`); give spoken cues a `tailDurationMs` of at least ~1 s so the next scene doesn't start inside that. A disconnected display cannot delay or advance the show.
- All finite display cue media (ordinary video, video questions, extra soundtracks, and still-image narration) seek to elapsed server cue time after late loading/reconnects and correct drift during playback. Future cues wait, and late arrivals honor the remaining visual tail.
- Admin's integrated **Show clock monitor** exposes server UTC, shared/per-group cue targets, and per-display/per-phone measured positions, drift, clock offset/round trip and report freshness, with device/attention filters; native app music without a clock target is excluded from drift checks. Display `?clock=1` exposes actual media position and drift for rehearsal.
- Timing contract, participating apps, and stream limitations: [docs/show-clock.md](docs/show-clock.md).

- Native apps expose timing diagnostics and send authenticated clock/playback reports. Reports are checked against the current session, cue epoch and participant routing epoch.

## Native participant app — `apps/native`

- Dark Stage companion screens separate setup/device diagnostics from live participation, without internal narration, subtitles, scene titles or header artwork, without a cursor pad (cursor voting is browser-only), and with a slow full-screen background pulse (towards light grey and back, behind the content, no layout space) while foreground cue playback runs (background music excluded; not an amplitude meter; off while the video wall plays). Respects reduced motion and stops animation in background; recovery/paused/closed-voting states retain server authority — `src/StageCompanion.tsx`, `src/stage-state.ts`. Display video remains on the shared screen; no phone image/video source exists in the current protocol.

- Audible monitor countdown: whenever M1–M4 show a countdown number (per-cue countdowns and the final seconds of vote/scene countdowns, same rules as the monitors via `anyMonitorCountdown` in `packages/scenario/src/monitor-countdown.ts`), the app plays a short tick per second for the last 5 seconds and a distinct tone at zero on its own audio layer over narration and music. Heard by the KI side and groups derived from it; participants in a phone-cursor (theater) group, finished/unassigned participants and paused audio stay silent. Sounds are generated locally — `src/countdown-sound.ts`, `src/countdown-player.ts`.
- iOS/Android background system action notifications for group selection, phone-button voting and reaction windows; permission requested on join, tap opens the app, duplicate suppression and cleanup on answer/phase change/leave. OS alerts are silent. Foreground actions also show a persistent high-contrast banner and play one brief two-note cue on a separate audio layer; reduced motion disables the two gentle pulses. The cue does not require notification permission and is suppressed while backgrounded or audio is paused. Live delivery depends on WebSocket reception; force-quit/offline delivery is not supported. Requires a new native build and locked-device acceptance — `src/action-prompt.ts`, `src/notifications.ts`.

- Expo iOS/Android builds, preview/production EAS Update channels, fingerprint runtime compatibility, explicit disconnected-only updates — `app.config.ts`, `eas.json`, `src/App.tsx`
- Automatic active-show verification/download before every join (failed checks block admission; joined sessions pin their release), verified persistent MP3 downloads, per-group server cues, late-join seeking, pause/resume, reconnect and timing reports — `src/content.ts`, `src/cues.ts`, `src/player.ts`, `src/connection.ts`
- Native clock-scheduled playback: cues become layers anchored to server time, started/offset/stopped and drift-corrected in Swift/Kotlin so narration plays with the screen locked; narration runs a fixed 400 ms behind its phase so every phone starts it at 0:00 (video phase audio stays on the display clock); lock-screen controls, call/headphone interruptions, Android foreground media service — `packages/expo-audio-scheduler` (Expo module + config plugin), `src/player.ts`. Changes need a new EAS build.
- Participant name/identity, group selection, cursor/buttons/reactions, narration/subtitles — `src/App.tsx`; existing protocol and authoritative server
- Headphone countdown ping (KI side and its groups, not cursor-voting groups): the main display's own Ping4 in the last 5 s of every vote countdown, of scene countdowns that ping on the display, and of what M1–M4 count down; no end tone. The MP3 is embedded in the JS bundle, so it ships by EAS Update — `src/countdown-sound.ts`, `src/countdown-player.ts`, `src/ping-sound.ts`
- Admission audio programs and participant task cards (alerts and full-option feedback; accepted choices return to neutral while outcome audio continues); identity rotation on handover clears occupant-scoped state. Locked-device and multi-cycle playback need physical acceptance — `src/admission-program.ts`, `src/ParticipantTaskCard.tsx`, `src/player.ts`, `packages/expo-audio-scheduler`. See [participant workflows](docs/participant-workflows.md).
- Every server image gets its own build version (Coolify's `SOURCE_COMMIT`, else an id generated in the Docker build, kept in `/app/.build-version`); open display, monitor and `/phone/` pages whose bundle is older reload when they reconnect after a deploy. Native apps never get this reload — `apps/server/Dockerfile`, `apps/server/src/config.ts`, `apps/server/src/admission/controller.ts`.
- Coolify persists published native releases and channel pointers in the frontend’s `native-shows` volume across redeployments (`deploy/coolify/docker-compose.yml`).
- Unified show publication with SHA-256 immutable visual/audio assets, unique scenario versions and native releases pinned to the running show — `apps/server/src/publication.ts`, `packages/show-content`; legacy content-channel URLs alias the active release.
- Store submission package: production profile sets `STORE_BUILD=1` (phone-only iOS, Android overlay permission removed), EAS Metadata App Store listing/age rating in `apps/native/store.config.json`, Play internal-track draft submit; all store answers and blockers in [store submission guide](docs/store-submission.md). Icon/splash, store join screen and reviewer demo session are not done yet.
- Native lock-screen cue delivery is a physical-device acceptance requirement, not an automated guarantee; cue reception still runs in JS over the WebSocket. No fleet provisioning UI or live streaming fallback. Setup, publishing and rehearsal: [native player guide](docs/native-player.md).

- **Studio → Publish** (top-right primary action, disabled while diagnostics block it) validates and prepares all outputs, saves and selects the show automatically; active performances defer activation. One operator action for projection, M1–M4 and native devices — `apps/studio/src/App.tsx`, `/api/admin/publish`. See [publishing guide](docs/publishing.md).

- Tablet music per scene (`phoneMusic` on a scene: a looping track with optional volume, or stop; scenes without it keep what plays). The server tracks the current music and sends it with every phase/snapshot (`phoneMusic`, null = silent), so late joiners and reconnects hear the right track; a group path starts from the music that played. The app crossfades between tracks over 3 s, fades out on stop, keeps the participant's music volume, and retires the show-wide background loop as soon as scene music arrives; shows without scene music keep the old loop. Publishing downloads the tracks to the apps — `packages/scenario` (`phoneMusicSchema`), `apps/server` (`phoneMusicNow`), `packages/show-content`, `apps/native/src/player.ts` (`setSceneMusic`), Studio → scene → Tablet music
- Native downloaded background music: choose an MP3 from the shared media library plus a volume; the server pulls the chosen library file into its media directory before publishing, and a looping native scheduler layer continues across narration transitions, with device pause/resume and session cleanup. The published volume is the default; participants can change the music volume in 10% steps (0–100%) in the app's Device settings panel, saved per device and applied live without restarting the loop — `packages/show-content`, `apps/studio/src/App.tsx`, `apps/server/src/server.ts` (PocketBase `media` sync), `apps/native/src/player.ts`, `apps/native/src/music-volume.ts`, `apps/native/src/StageCompanion.tsx`, `packages/expo-audio-scheduler`. Locked-device cue delivery requires physical acceptance; no pocket mode.

## Authored stage monitors — M1–M4

- Four independent authenticated `/display/?monitor=M1` … `M4` pages; replacement affects only that monitor, never the main projection. The pages hide the mouse pointer (`cursor: none` in `monitors.css`) — `apps/server/src/engine/phase-engine.ts`, `apps/display/src/monitors/MonitorApp.tsx`.
- Monitor background colour per M1–M4: scheduled per cue (`background` on any monitor cue, Studio *Background*) and live from Admin → Instrument (*Monitor backgrounds*, overrides the cue until cleared, cleared at idle) — `packages/scenario/src/monitors.ts`, `apps/display/src/monitors/MonitorApp.tsx`, `apps/studio/src/inspector/MonitorEditor.tsx`, `apps/admin/src/MonitorBackgrounds.tsx`, `POST /api/admin/monitor-backgrounds`, `monitor_backgrounds` message
- Vote-result monitor cues show the unique winning answer label and colour from the latest or a named resolved vote in the current timeline; authored fallback for ties, empty or unresolved votes. Results survive scene transitions and monitor reconnects, and reset on a new session. Studio provides vote scene and fallback controls.
- Per-phase video, image/caption, text, placeholder and blank sequences with offsets, optional durations, fit and looping; missing screens and gaps are black — `packages/scenario/src/monitors.ts`.
- Countdowns replace the cue text with a large centred number in the text's colour (no corner countdown); only text, vote-result and placeholder cues count down, so image/video monitors (e.g. a scale) stay clean while the opposing question monitors count. Optional per cue (`countdownShowsText`, Studio checkbox): keep the text, smaller and centred, beneath the number.
- Optional per-cue final countdown (for example 5 seconds) on text cues, ending at its duration or next cue and taking precedence over scene/vote countdowns, including after a vote resolves; authored in Studio.
- Automatic server-clock countdown, final 5 seconds only, during open positioning votes (plain or video-timed) and scene countdowns; hidden for resolved, closed or untimed votes — `apps/display/src/monitors/countdown.ts`.
- Answer colour coding and Optik: monitor N draws text and captions in the phase's Nth answer colour (outcome order, authored `answerColors` or the resolved curtain colours; answers repeat when there are fewer than four, so two-answer questions colour M1/M3 and M2/M4); phases without colours stay white. A cue's own `color` (text, placeholder, vote-result, image caption; Studio: Text colour with presets white/orange/green/blue/red/yellow or custom) overrides it in any scene — `apps/display/src/monitors/answerColor.ts`, `MONITOR_TEXT_COLOR_PRESETS` in `packages/scenario/src/monitors.ts`. No widows: the last two words of each text line are kept together (non-breaking space, `text-wrap: pretty`) — `apps/display/src/monitors/typography.ts`.
- Studio inspector controls, shared media-library selection and usage tracking, schema/export validation and display-preview links — `apps/studio/src/inspector/MonitorEditor.tsx`.
- Per-monitor current-scene media predownload with byte/hash verification and retries; text and blank cues do not wait for downloads; isolated monitor caches, cached Blob playback, main server clock alignment, late-join seeking and reconnect recovery — existing display `mediaStore`, `DisplayConnection`, monitor playback.
- Local setup/readiness/error overlay (`&setup=1`); all-screen readiness does not automatically gate show start. Main timeline only; videos muted. TouchDesigner scene/question helpers removed. [Setup and acceptance](docs/monitor-displays.md).

- **Tablet text per scene and group:** `tabletText` / `tabletTextByGroup` on video, narration and question scenes. The native app shows the text in large type for the whole scene. It doesn't fade with idle show-mode text, and the next scene replaces or clears it. A group text wins over the default, and an empty group text shows that group nothing. Studio edits it under **Tablet text** next to phone audio. The browser `/phone/` page doesn't show it. JS only, so it ships as a compatible EAS Update — `packages/scenario` (schema, validation), `apps/native/src/tablet-text.ts`, `StageCompanion.tsx`, `apps/studio/src/inspector/Inspector.tsx`, `groups.ts`.

### Native foreground show mode

The app enters an awake, black waiting screen as soon as it is admitted (and again after a reconnect); it reveals group choice, button voting, tasks and rating windows. Hold the exit control for two seconds to restore device controls; after 60 s without a touch the app returns to show mode — `shouldEnterShowMode` in `apps/native/src/stage-state.ts`. Android Back is consumed during show mode; system screen pinning (on by default, saved per device under Show mode controls) restricts Home and app switching after Android confirmation; the pin survives dropped connections and exiting show mode and is released only when the tablet leaves the show or pinning is switched off (`releaseShowScreen`). Show mode keeps the participant's current group name visible at the top (hidden while the video wall plays) so people can read each other's roles — `showModeGroupLabel` / `parseScreenPinning` in `apps/native/src/stage-state.ts`. Managed devices can allowlist the app for lock task mode. Power-button locking and Android's unpin gesture remain available. Requires a new native build containing ShowScreen; older binaries keep their existing controls.

Implemented in apps/native and the ShowScreen module bundled with packages/expo-audio-scheduler.

- Admin display settings set the resting native show-mode colour, pushed over the WebSocket and applied on the shared clock (`surface` message) — `apps/server/src/surface/surface.ts`, `apps/native/src/surface.ts`
- **Cursor size** (Admin → Instrument): a default size and a list of scenes with their own size (0.5–4×), saved with the display settings (`cursorSize`, `cursorSizeByScene`; no republish), applied within ~5 s to glow cursors and curtain-light cursors on main and group displays; the Displays tab keeps them when it saves — `apps/admin/src/CursorSizes.tsx`, `packages/protocol/src/platform-settings.ts` (`resolveCursorSize`), `apps/display/src/cursors/glowCursor.ts`, `apps/display/src/curtain/curtainRenderer.ts`
- Admin **Instrument** tab: tablets as a playable colour grid (press/hold/drag, multi-touch chords, All pad, latch, dimmer, live recolour) with 40-key keyboard play, and per-tablet **Identify** flash — `apps/admin/src/SurfaceInstrument.tsx`, `POST /api/admin/surface`
- Instrument **effects** (chase, breathe, wave, gradient wave, rainbow) rendered on the server and sent on the shared clock — `apps/server/src/surface/effects.ts`, `packages/shared/src/surfaceEffects.ts`, `POST /api/admin/surface/effect`
- **Tablet lights from scene cues**: video and narration scenes carry timed `surfaceCues` (start an Instrument effect with colour/cycle/brightness, or stop) that the server plays on every joined tablet in label order; leaving the scene cancels pending cues, a running effect continues until a later cue, the operator (any Admin start/stop takes over) or idle stops it. Main timeline only. Edited in Studio → Tablet lights — `packages/scenario/src/surface-cues.ts`, `apps/server/src/surface/surface-cues.ts`, `apps/studio/src/inspector/SurfaceCueEditor.tsx`
- Admin **Wall** tab: tablet video wall. Slice calculator (crop per position with bezel compensation, Premiere Scale/Position, ffmpeg commands, CSV sheet, reference preview), tablet-to-position assignment, and Load/Play/Restart/Cue/Stop/Loop with per-tablet download, ready and drift status — `apps/admin/src/VideoWall.tsx`, `packages/shared/src/videoWall.ts`, `apps/server/src/wall/wall.ts`, `GET/POST /api/admin/wall`, `PUT /api/admin/wall/layout`; layout persisted in `platform_config` (`video-wall`); slices are media library files `<clip>__<position>.mp4`; any other MP4 plays as a whole video that each tablet crops to its own region; the calculator reads the master size from a reference file; Lenovo Tab M7 (TB-7306F) preset and default 6 × 6 landscape layout, portrait/landscape mounting (tablets rotate the video in the portrait-locked app); videos and slices upload to the media library straight from the Wall tab (`apps/admin/src/wallUpload.ts`)
- Native wall playback: downloads and verifies this tablet's slice (or the whole video, enlarged and offset to its region by `wallCropFraction`), plays it full screen in show mode with `expo-video`, started on the shared clock and kept in step by rate nudges and seeks; reports status over `wall_status` — `apps/native/src/WallVideo.tsx`, `apps/native/src/wall.ts`, `apps/native/src/content.ts`
- Native device label (T01–T40) stored on the device and used as the join name; show-mode text fades after 4 s idle — `apps/native/src/App.tsx`, `apps/native/src/StageCompanion.tsx`
- Admin phone audio coverage audits every phase/group assignment against immutable downloaded bytes, distinguishing unassigned, unpublished, missing and corrupt audio; device timing separately reports runtime playback.

- Optional `monitorGroupId` makes M1–M4 follow that audience’s independent path, clears cues while it waits, and returns to the shared timeline at reunion — scenario schema/validation and server phase engine.

- Studio phone audio uses the same audio-filtered library picker for default tracks, audience-specific replacements and group-selection audio; explicit default/silence states and removal controls explain what each audience hears — Studio Inspector and media picker.

### Automatic personal task routing

Participant tasks can play introduction and outcome recordings, give the Nth accepted response its own outcome (`rankOutcomes`), give later responses an overflow outcome once an option is full, play a recording with the full-option message (`fullAudio`), assign audience groups after capped role acceptance, and open follow-up tasks after recordings finish. Roles share capacity across task instances. Vote-based recordings use the previous question plurality and an explicit tie/empty fallback. Persistent workflows survive scene changes and admit eligible late arrivals; scene cancellation and show restart stop them. Native playback follows each response clock; show-content publishing bundles all recordings. Native clients require participant-task-routing-v1; theater browser access remains supported. Implemented in packages/scenario, apps/server/src/prompts, apps/server/src/engine, packages/show-content and apps/native. Tablet routing retains occupant identity; identity reset remains a separate handover operation.

Studio exposes task attachments on both video and narration scenes and shows their audience, recordings, group/role assignments and follow-up task routes in the scene inspector.

## Actor script reader

- **Studio → Show properties → Actor script** stores the show's script in the draft and publishes it with the show; per-scene **Actor script cues** (`scriptCues`, ms from scene start → paragraph) move the shared reader on the main timeline. The server loads it automatically with a restart-stable reader link; cues are stripped from client snapshots. Apps/packages: `studio`, `server`, `admin`, `scenario`.
- **Tablet script:** a scene can show a range of the show's actor script on the native tablets of chosen groups (`tabletScript`, plus further ranges for other groups in `moreTabletScripts`, e.g. the chorus's own lines), with each group's speaker lines highlighted (`actorScript.speakersByGroup`). Only participants in those groups receive the text. Apps: `server` (per-participant excerpt in `PhaseEngine.send`), `native` (`TabletScript.tsx`), `studio`; shared rules in `packages/scenario/src/actor-script.ts`. See [actor script guide](docs/actor-script.md).
- **Admin → Script** loads a private plain-text script, advances shared paragraph cues, and creates/revokes read-only actor links. Actors follow the cue or scroll independently and adjust text size. An Admin-loaded script overrides the show's until cleared and lives in server memory only. No audience/show-control permissions on reader links. Apps: `admin`, `server`. See [actor script guide](docs/actor-script.md).
