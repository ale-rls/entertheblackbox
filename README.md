# Enter the Blackbox

Enter the Blackbox is the runtime and visual authoring toolkit for the piece of the same name. Participant phones and loan tablets use the **native iOS/Android app** for downloaded audio, cursors, choices and reactions. Audience groups can also use **`/phone/` in their phone browser** for cursor voting, choices and reactions without personal audio.

Shows are server-authoritative scenario graphs. M1–M4 each open a dedicated display page, cache verified media before the show, and follow authored cues on the main server clock. See [Monitor displays](docs/monitor-displays.md) and [Native participant setup](docs/native-player.md). TouchDesigner is no longer used to render the four monitors.

## Applications

- `apps/server` — Fastify HTTP and WebSocket server, phase engine, admission, and admin API.
- `apps/display` — fullscreen React client for the installation screen.
- `apps/phone` — browser participant controller for voting without personal audio; built and served in production.
- `apps/native` — Expo iOS/Android participant player with downloaded audio and EAS updates; [setup and rehearsal](docs/native-player.md).
- `apps/admin` — protected operational interface.
- `apps/studio` — local visual editor for importing, authoring, validating, previewing, and exporting shows.
- `apps/realtime-ws-coolify` — room-scoped, batched low-latency cursor relay, included in the production Coolify stack.

Shared runtime contracts live in `packages/protocol`, `packages/scenario`, `packages/shared`, and `packages/studio-adapter`.

See [FEATURES.md](FEATURES.md) for a full feature-by-feature breakdown of what exists and which app/service/package each one depends on.

## Services

Vendored as git subtrees. They are not pnpm workspace members (`pnpm-workspace.yaml`
covers only `apps/*` and `packages/*`), so `pnpm install`, typecheck, and CI ignore
them entirely. They are here so both the code and the agents working on it can see
the whole piece in one place.

- `services/trackingbox` — camera-based anonymous audience tracking, from
  [ale-rls/TrackingBox](https://github.com/ale-rls/TrackingBox), based on
  `95d092864ff8e24a2af9c33e662e547262692b04` plus the venue RTSP, ReID setup,
  and continuous-capture fixes migrated from `enter-the-blackbox` commits
  `f214a1c`, `a2b0cc4`, and `b6b3464`. It emits persistent anonymous
  GIDs with normalized floor coordinates over REST and WebSocket. Treat it as a
  read-only sensor.
- `services/audio` and `services/audio-janus` — retired streaming implementations, retained as historical source; not part of production.

Future TrackingBox changes should be made upstream and
bring it down with `git subtree pull -P services/trackingbox <remote> <commit>`.
Editing inside the subtree means the vendored copy silently forks from upstream,
because pushing changes back out is awkward enough that nobody does it. Update
the provenance above whenever it moves, and re-validate the show.

### Which machine runs what

The venue runs two computers. The tracking machine runs `services/trackingbox`
with the camera and a GPU. The installation machine runs the server and the
display. They talk over the venue network.

### Camera positions (optional)

Set `TRACKINGBOX_URL` to TrackingBox's WebSocket endpoint and the server will
also take positions from tracked bodies, so standing in a floor zone resolves a
question exactly as a swiped cursor does:

```bash
env TRACKINGBOX_URL=ws://192.168.1.40:8000/ws ... node --import tsx apps/server/src/index.ts
```

Unset, nothing changes: the phone trackpad remains the only position source.
Each tracked body becomes a vote participant with no socket, lease, or name,
identified as `gid:<n>`, since people on the stage side walk in rather than
joining. A tracking outage degrades to nobody standing anywhere; it never stops
the show. Floor zones are authored in the scenario, not in TrackingBox's own
zone config, so there is one source of truth.

## Requirements

- Node.js 22 or newer
- pnpm 9.12.2

## Setup

From a fresh clone, run all commands from the repository root:

```bash
cd entertheblackbox
corepack enable
pnpm install
```

The checked-in development scenario and media manifest are used by default. The installation's live runtime state stays in-process with no database dependency, but the admin dashboard and persisted operational data (errors, audit log, session exports) require a local PocketBase instance — see below.

## PocketBase

The server talks to a local, self-hosted PocketBase instance (SQLite-backed, no external/cloud service) for admin-dashboard login and operational persistence:

```bash
pnpm pocketbase:download   # fetch the pinned binary for your platform (once)
pnpm pocketbase:dev        # run PocketBase on http://127.0.0.1:8090, leave it running
```

On first run, create a PocketBase superuser (prompted at the URL PocketBase prints, or via `pocketbase/bin/pocketbase superuser upsert <email> <password>`), then provision an admin-dashboard operator account:

```bash
pocketbase/scripts/create-operator.sh <email> <password>
```

Sign in at `/admin/` with that email/password. See [pocketbase/README.md](pocketbase/README.md) for more.

## Run locally

Build the three installation clients once (and rebuild them after frontend changes). The display's authentication token is baked into its bundle at build time, so pass the same `DISPLAY_TOKEN` the server will use (it defaults to `dev-display-token` if unset):

```bash
env DISPLAY_TOKEN=dev-display-token pnpm --filter @entertheblackbox/display build
pnpm --filter @entertheblackbox/admin build
```

Then start the installation server and leave it running:

```bash
env HOST=127.0.0.1 PORT=3000 BUILD_VERSION=0.0.0-dev NODE_ENV=development node --import tsx apps/server/src/index.ts
```

Open the installation display:

<http://127.0.0.1:3000/display/>

No query parameters are needed: the display authenticates with its build-time token and resolves its installation/room live from the server's own `/api/status`, so the venue's one kiosk never needs to remember or type a full URL. Two query parameters open other display kiosks instead of the main one: `?group=<group-id>` opens that group's own dedicated kiosk (see [docs/group-branching.md](docs/group-branching.md)), and `?signage=<id>` opens a signage kiosk that always shows a looping video and the live join QR code, independent of the show's state (e.g. a lobby entrance screen) — configured in `/admin/` next to the other waiting videos. The server allows only one authenticated main display connection, plus one per active group and one per signage kiosk. The root and legacy `/phone/` routes show native-app joining instructions.

Participants install the native app, select the venue server and tap **Update show & join**. See [native player setup](docs/native-player.md). For browser voting, open the printed QR URL or `/phone/`, enter a name, and choose a group when prompted. Keep the page open and the phone awake. Joining never starts a show by headcount; operators start it manually or schedule it in Admin.

The server also exposes:

- `/phone/` — native-app joining instructions (also `/` and `/phone-janus/`)
- `/admin/` — operations interface
- `/display/?monitor=M1` through `M4` — authored stage monitor pages; add `&setup=1` for local cache/connection diagnostics.
- `/healthz` and `/readyz` — health and readiness checks

### Public video phase map

`GET /api/phases` is deliberately unauthenticated. It is the stable lookup
intended for display-side video preloading and returns exactly one JSON object
property per video phase: the phase ID as the key and its media `src` as the
string value. The active video's `src` is also delivered to the authenticated
display in phase snapshots; the public lookup exists so the display can resolve
other video phase IDs without receiving the scenario graph.

The response never includes non-video phases, durations, transitions, question
text or axes, scenario metadata, server configuration, or credentials. If the
scenario is not ready, it fails closed with HTTP 503 and
`{"error":"scenario_unavailable"}`. Phase IDs and media paths are public content
metadata (the public media manifest already lists media paths), so authors must
not put secrets or private visitor information in either field.

Development credentials in the server configuration are intentionally local-only defaults. Set installation-specific `JOIN_GRANT_SECRET`, `DISPLAY_TOKEN`, and `POCKETBASE_ADMIN_PASSWORD` values before venue operation. `JOIN_GRANT_SECRET` continues to sign returning-participant leases; public first-time joins are protected by admission capacity and per-IP rate limits rather than URL secrets.

The admin dashboard (`/admin/`) authenticates operators against PocketBase's `operators` collection instead of a shared static token — see [PocketBase setup](#pocketbase) below for provisioning an operator account.

The admin API applies process-local per-IP limits in separate buckets for authenticated traffic and failed authentication, so bad-token traffic cannot exhaust an operator's allowance on a shared network. Defaults are 600 authenticated requests and 30 authentication failures per 60 seconds. Override them with `ADMIN_RATE_LIMIT_MAX_REQUESTS`, `ADMIN_RATE_LIMIT_MAX_AUTH_FAILURES`, and `ADMIN_RATE_LIMIT_WINDOW_MS`. `X-Forwarded-For` is used only when `TRUST_PROXY=true`.

### Run the checked-in `showtest1` show

The normal command loads the default development show. To run `showtest1`, stop the installation server with `Ctrl+C` and restart it with its checked-in scenario and media manifest:

```bash
env HOST=127.0.0.1 PORT=3000 BUILD_VERSION=0.0.0-dev NODE_ENV=development SCENARIO_PATH=content/scenarios/showtest1.json MEDIA_MANIFEST_PATH=content/media-manifests/showtest1.json node --import tsx apps/server/src/index.ts
```

Saving/exporting a draft does not change the installation. Use the top-right **Publish** button in Studio to publish and select it. The paths above apply to file-based development tooling. The scenario and manifest are tracked, but the real `showtest1` videos are not; copy the matching media files into `content/media` before starting it.

### Connect native participant devices

Use the [native player guide](docs/native-player.md) to install the iOS/Android app, publish the show once in Studio, and join the venue server. Use trusted HTTPS/WSS for production. Loan tablets use this same app. Browser voting is available at `/phone/` alongside native participants; browser audio remains retired. Configure those audience groups with phone-cursor voting and provide their audio through the venue.

### Main display waiting content

The onboarding attract playlist bundles every MP4 named `attract-*.mp4` in `apps/display/src/assets/`. The prefix matters: that directory also holds the rendered credits video and other non-lobby media, which must stay out of the playlist. Clips play in filename order, and the **first one is the A/hold clip** — it returns on every other beat, so three clips run A-B-A-C-A-B-A-C. With one clip, that file loops normally. With none, the lobby shows a static centred join QR on black.

Admin → **Display text and waiting video** can override the bundled playlist with a video selected from the shared media library. The default applies to the main display and any group that inherits it; each group can instead select its own video or a black waiting screen. Videos loop muted in idle/lobby states and on inactive displays while group paths run. Active scenes retain their normal media. Settings are stored in PocketBase and open displays refresh within five seconds. Blank defaults preserve the existing bundled main-display playlist and black group displays. Existing saved text settings need no migration.

Add MP4/WebM videos through Studio → Media library, then select them in Admin. The picker includes library videos outside the active show and disables files still syncing to the server; use Refresh media library after a sync. The server serves selected clips through its existing media route. Previously saved URLs are retained and labelled if absent from the library. This control does not add waiting clips to the show's offline media cache. Show footage stays out of git. After deploying new client bundles, hard-refresh displays to replace the service-worker-cached app.


Attract clips are show content and are gitignored, so a fresh clone has an empty playlist. Drop the files in locally; the glob picks them up with no code change.

Each clip can have a generated perspective QR track, which makes the join code appear fixed to a surface in the shot. Without one it falls back to a static centred square. After adding or replacing an attract MP4, run `pnpm generate-idle-marker-tracks` (requires Python, OpenCV, and NumPy) and commit the updated `apps/display/src/idle/markerTracks.generated.ts` — that file is generated code, not media, so it is tracked.

To run `showtest1` and accept physical phones at the same time, combine both sets of environment variables:

```bash
env HOST=0.0.0.0 PORT=3000 BUILD_VERSION=0.0.0-dev NODE_ENV=development PHONE_JOIN_BASE_URL=http://192.168.1.23:3000/phone/ SCENARIO_PATH=content/scenarios/showtest1.json MEDIA_MANIFEST_PATH=content/media-manifests/showtest1.json node --import tsx apps/server/src/index.ts
```

### Stale display or missing video

The display uses an app-shell service worker and Cache Storage. After rebuilding, close duplicate display tabs and hard-refresh (`Cmd+Shift+R` on macOS or `Ctrl+Shift+R` elsewhere). If the old shell persists, open the authenticated URL on the other local hostname (`localhost` instead of `127.0.0.1`, or vice versa); those origins have separate browser storage. As a last resort, unregister the service worker and clear site data in the browser's developer tools, then reload the authenticated URL.

## Show Studio

Start the local authoring tool with:

```bash
pnpm --filter studio dev
```

Run this in a second terminal while the installation server remains running, then open <http://localhost:5173>.

Studio supports graph editing, typed transitions, media diagnostics, runtime validation, branch preview, local draft recovery, versioned deployment exports, and authenticated publishing to PocketBase. A publish never interrupts an active session.

For headphone narration, add MP3s to the shared media library and choose each scene's **Phone headphones** content (the schema retains `phoneAudioSrc` naming for compatibility). Per-group overrides target native participants. Use the top-right **Publish** button to prepare all media, including optional background music, and automatically select one version for the server and devices.

For M1–M4, select a phase and edit **Stage monitors**. Each monitor supports timed video, image, text, placeholder and black cues, using the same media library. Native participant rehearsal uses the active show on a venue server; it has no browser phone preview or stream fallback.

See [native player setup](docs/native-player.md) and [monitor display setup](docs/monitor-displays.md).

## Coolify production deployment

Use [`deploy/coolify/docker-compose.yml`](deploy/coolify/docker-compose.yml) and the [deployment guide](deploy/coolify/README.md). Production runs frontend, realtime and PocketBase. The frontend builds display, Studio and Admin; participant devices use the native apps. Preserve the PocketBase and native-shows volumes across redeployments. Streaming containers and their environment settings are retired; historical audio volumes remain declared for preservation.

## Validate and test

```bash
pnpm typecheck
pnpm test
pnpm validate-scenario content/scenarios/dev.json --manifest content/media-manifest.json --media-dir content/media
```

Those three are what CI runs, alongside the client builds. There is no
end-to-end job on purpose: for an installation run by its own technical team,
the check that matters is a tech rehearsal in the venue with real phones on the
real network.

The Playwright suite is still here and can be run by hand before a venue date:

```bash
pnpm pocketbase:download   # once, fetches the pinned binary
pnpm test:e2e
```

It builds the installation clients and drives real server processes, so it
takes several minutes and some environments require permission to bind local
ports. Several Studio specs are quarantined with `test.fixme` because they
assert UI text the Studio no longer renders, so a green run is not broad
coverage.

To exercise the multiplayer server without browsers:

```bash
pnpm simulate-clients
```

Defaults to 30 simulated phones (the historical local-installation player cap).
For a larger production deployment, raise `--count` along with the server's
`MAX_PARTICIPANTS`/`MAX_WEBSOCKET_CONNECTIONS`/`JOIN_RATE_LIMIT_*` env vars
(`apps/server/src/config.ts`) and pass matching `--join-rate-limit-*` flags so
the script's reconnect timing doesn't trip the server's own join limiter, e.g.:

```bash
pnpm simulate-clients -- --count 300 --duration-ms 180000 \
  --join-rate-limit-max-attempts 400 --join-rate-limit-window-ms 60000 \
  --url wss://your-staging-host/ws
```

## Content

- `content/scenarios/entertheblackbox.json` — this production's show, imported
  from the sibling runner's `show.yaml` with `pnpm import-show-yaml <path>`
- `content/scenarios/dev.json` — fake development show, used by the tests and CI
- `content/scenarios/showtest1.json` — generic test show
- `content/media-manifest.json` — development media inventory
- `content/media-manifests/showtest1.json` — media inventory for `showtest1`
- `content/media/` — locally served media assets

**The imported production show still needs its real media before it can run.**

It has no media manifest, because every entry needs the byte length and hash of
a real file. Put its audio and the narration still image into `content/media`,
then run `pnpm build-media-manifest`.

Its narration durations are placeholders. The server ends a narration exactly
`expectedDurationMs` after it starts, whatever the display reports, so a
placeholder that is shorter than the recording cuts it off mid-sentence and one
that is longer holds the still image in silence. The importer measures each
narration MP3 with `ffprobe` when the file is in `content/media`, so put the
audio in place **before** re-running it. It exits non-zero and names every
narration that fell back, so this cannot ship silently.

The imported narration and question MP3s populate each phase's
`phoneAudioSrc`. They can also be created or replaced directly in Studio with
the **Phone headphones** control.

Scenarios and manifests are validated at startup and before Studio deployment export. Visual Studio layout metadata remains separate from runtime JSON.

## Venue operation

The supported architecture is a local installation computer serving the application and media on the venue network. Runtime operation does not depend on cloud hosting, a remote database, or a CDN.

- [Operations runbook](docs/operations.md)
- [Venue installation guide](docs/venue-installation.md)
- [Video with synchronized phone audio](docs/synchronized-phone-audio.md)

The application and Show Studio v1 are implemented and tested. A venue launch still requires production content, exact-hardware acceptance, a recovery image or spare computer, and the final soak test.

## Project status

Open work is tracked in [GitHub issues](https://github.com/ale-rls/entertheblackbox/issues); the agent process is described in [CLAUDE.md](CLAUDE.md) and, in full, [docs/agent-workflow.md](docs/agent-workflow.md).

This repository forked from the smartphonecracy production, which supplied the runtime, Show Studio, and venue tooling. The two shows are independent and do not share fixes. The engine and Show Studio v1 are implemented and tested; what Enter the Blackbox still needs is its own content — scenario graph, media, and director decisions. The only deferred Studio feature is the post-v1 multi-participant drag simulator; outcome shortcuts cover the same resolution branches in v1.

## License

No license has been declared yet. All rights are reserved unless a license file is added.


### Native headphone acceptance

Rehearse the full show on the actual native iOS/Android devices: download verification, silent gaps, group changes, lock/unlock, headphones, calls, network loss, pause and resume. Inspect the Admin show clock monitor. Native scheduler playback is implemented, but locked-device cue reception still requires physical acceptance. See [native player](docs/native-player.md).

### Display text and platform settings

In **Admin → Display text**, edit the join heading, countdown wording, network
instructions, and joining instructions, or hide the phone join URL. The countdown
wording must include `{time}`; network instructions may use `{wifi}` for the
existing configured Wi-Fi name or contain the name directly. Blank headings or
instruction lines are allowed. Scene titles/subtitles remain authored in Studio.

Settings are stored in PocketBase's `platform_config` collection as a unique
`key` plus JSON `value`; the first namespace is `display`. The collection is
server-only. Operator-authenticated `/api/admin/settings/display` reads/writes
validated display settings; public `/api/display-settings` exposes only display
copy, never arbitrary configuration namespaces. Additional platform settings
should get their own schemas and explicitly scoped routes.

Deploy the PocketBase migration `1789740000_create_platform_config.js` alongside
the server and rebuilt Admin/display clients. Existing text remains the default
until the first save. Saved edits apply to open displays through polling in about
five seconds, without restarting the show. During outages displays retain their
last successfully loaded copy; after a page reload they use defaults until a
successful fetch. Saving requires PocketBase; unavailable persistence is reported
as a failure and never silently replaced with an in-memory save.

### Publishing show content

Use Studio's top-right **Publish** button once for projection, M1–M4 monitors and native devices. It validates media and automatically selects the version; a running performance finishes first. See [publishing.md](docs/publishing.md). App software updates are needed only for software changes, not each show publication.
