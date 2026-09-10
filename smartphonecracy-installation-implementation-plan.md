# Democracy + AI Installation

## Implementation and handoff plan

Status: ready for engineering handoff

Target: one unattended installation running for approximately one year

Primary interaction: visitors scan a QR code, use their phones as cursors, and collectively answer questions shown on a large display.

## 1. Product definition

The installation is a single-room, browser-based multiplayer experience.

There are three client roles:

1. **Display client** — the fullscreen browser connected to the projector or large screen.
2. **Participant client** — the phone browser used as a cursor/controller.
3. **Admin client** — a protected operational interface for checking health and controlling the installation.

The server is authoritative. Clients render state and send intent; they do not decide which video or question comes next.

The first production version supports one physical installation and one active room. The protocol should still include `installationId` and `roomId` so a second installation can be added later without redesigning the messages.

## 2. Locked technical decisions

### Application

- TypeScript throughout
- pnpm workspace monorepo
- React + Vite for display and phone applications
- Fastify for the HTTP server
- `ws` for WebSocket communication
- Zod for runtime validation of incoming messages and scenario files
- Vitest for unit tests
- Playwright for browser and end-to-end tests

This is deliberately a small, boring stack. I would not introduce Next.js, a separate realtime product, Redis, or microservices for the first installation. One room with thirty participants does not need them.

### Hosting

- Fly.io for the production server
- One machine in the region closest to the venue
- `min_machines_running = 1`; do not use scale-to-zero for the live game server
- Supabase Postgres on a paid project for persistent data and analytics
- Object storage/CDN for video assets
- HTTPS and WSS everywhere

Fly supports regional placement and application health checks through its deployment configuration. Use those checks for process readiness, but do not treat them as a substitute for the display heartbeat. [Fly application configuration](https://www.fly.io/docs/reference/configuration/)

Supabase should store durable session records, not drive the live game loop. Supabase Realtime remains optional for a future admin dashboard; the installation clients use the custom WebSocket server. The server uses a single process and a single authoritative room, so no distributed lock or Redis layer is required.

## 3. Repository structure

```text
/
  apps/
    server/              HTTP server, WebSocket server, state machine
    display/              Fullscreen installation client
    phone/                Mobile controller client
    admin/                Protected operations UI
  packages/
    protocol/             Message types, schemas, encoders
    scenario/             Scenario types, validation, graph utilities
    shared/               Constants and shared helpers
  content/
    scenarios/
      production.json
    media-manifest.json
  tests/
    e2e/
    load/
  infra/
    fly.toml
    migrations/
  scripts/
    validate-scenario.ts
    simulate-clients.ts
  docs/
    operations.md
    venue-installation.md
  package.json
  pnpm-workspace.yaml
```

The production scenario is data, not application logic. Changing wording, axis labels, timings, graph connections, or branch mappings should not require changing the state-machine code. Every scenario revision receives a version and is validated before deployment.

For v1, scenario files live in the repository and are published through CI. The server loads one validated production scenario at startup. This is safer than allowing an unvalidated database edit to change the live experience. A curator-facing content editor can be added later without changing the runtime model.

## 4. Runtime architecture

```text
                HTTPS / WSS

 phone clients ───────────────┐
                              ▼
                         Game server
                         ├─ room state
                         ├─ phase engine
                         ├─ timed position snapshots
                         ├─ cursor tick loop
                         ├─ recovery policy
                         └─ admin API
                              │
             ┌────────────────┴────────────────┐
             ▼                                 ▼
       display client                     Supabase Postgres
       fullscreen kiosk                   sessions, events,
                                          checkpoints, health

             display/video assets → object storage + CDN
```

The server keeps active room state in memory for low latency. It writes durable checkpoints and completed events to Postgres. It never performs a database write for every cursor movement.

## 5. Scenario model

The scenario is a directed graph of phases. A phase is one of:

```ts
type Phase =
  | {
      kind: "idle";
      id: "idle";
    }
  | {
      kind: "video";
      id: string;
      src: string;
      expectedDurationMs: number;
      next: string;
      allowSkip?: boolean;
    }
  | {
      kind: "position-question";
      id: string;
      text: string;
      xAxis: { minLabel: string; maxLabel: string };
      yAxis: { minLabel: string; maxLabel: string };
      durationMs: number;
      freezeMs: number;
      connectionStaleAfterMs: number;
      showLiveCounts: boolean;
      next: PositionQuestionNext;
    };

type PositionVoteStatus =
  | "valid"
  | "never-moved"
  | "stale"
  | "disconnected";

type CountablePositionVoteStatus = Exclude<PositionVoteStatus, "never-moved">;

type Quadrant = "q1" | "q2" | "q3" | "q4";

type PositionQuestionNext =
  | { type: "fixed"; target: string }
  | {
      type: "quadrant-plurality";
      map: Record<Quadrant, string>;
      tie: string;
      empty: string;
      countedStatuses: CountablePositionVoteStatus[];
    };

type PhaseSnapshot = Phase & {
  scenarioVersion: string;
  startedAt: number;
  deadlineAt: number | null;
};
```

Quadrants use normalized screen coordinates, where `x` increases left-to-right and `y` increases top-to-bottom:

```text
q2 (top-left)     q1 (top-right)
q3 (bottom-left)  q4 (bottom-right)
```

The half-open boundary convention is: `x = 0.5` belongs to the right half and `y = 0.5` belongs to the bottom half. Therefore the exact center belongs to `q4`. This convention is deterministic but artistically meaningful and must be confirmed by the director in Phase 0.

The scenario validator must reject missing phase IDs, missing media, invalid durations, malformed axes, incomplete quadrant maps, invalid counted statuses, and broken fixed, quadrant, tie, or empty targets. It should also report unreachable phases and cycles. Cycles may be allowed intentionally, but must be explicitly marked.

The media validator must read `media-manifest.json`, verify each file’s declared byte size against the actual file, and reject a total greater than `2 * 1024 * 1024 * 1024` bytes. If the artwork exceeds this budget later, the planned fallback is complete-response Cache API storage with a fetch handler that synthesizes byte-range responses; this is intentionally out of scope for v1.

The installation has an explicit admission and session policy:

```ts
type InstallationPolicy = {
  phoneJoinBaseUrl: string;
  maxParticipants: 30;
  qrRotationMs: 60_000;
  joinGrantTtlMs: 120_000;
  participantLeaseTtlMs: 7_200_000;
  allowLateJoin: true;
  activeQrVisibility: "corner";
  lobbyCountdownMs: 10_000;
  minParticipants: 1;
  interactiveIdleTimeoutMs: 180_000;
  maxSessionDurationMs: 1_800_000;
};
```

The phone join base URL belongs to installation configuration, not the scenario graph. The server appends each short-lived signed grant and sends the complete URL to the authenticated display. The default keeps a small rotating QR visible in a projection corner during videos and questions so late join remains possible. The director may choose `activeQrVisibility: "hidden"`, but that must also set `allowLateJoin: false` after the lobby.

The remaining defaults allow a solo visitor to experience the work, give nearby visitors ten seconds to join, prevent abandoned-but-heartbeating phones from holding a session indefinitely, and cap cycles at thirty minutes. The director must confirm these values against the final show duration.

## 6. Session lifecycle

### Idle

- Display shows attract loop and QR code.
- No active session exists.
- Phones may join the room but do not start the experience until a display is connected.
- The server pushes a newly signed QR join URL to the display every 60 seconds. Each grant expires after 2 minutes.

### Lobby and start

- The first valid participant joins while the display is healthy and starts a 10-second lobby countdown.
- Additional participants may join during the lobby, up to the 30-participant cap.
- The default minimum is one participant, so a solo visitor is not stranded waiting for others.
- At the end of the lobby, the server creates a session ID and starts the configured intro phase.
- All connected clients receive the authoritative phase snapshot.

### Active play

- With the default `allowLateJoin: true`, participants may join late by scanning the small rotating QR shown in the projection corner during active phases.
- A late participant receives the current phase and can participate in future questions.
- Late participants cannot retroactively vote in a closed question.
- An existing participant lease may reconnect even when the room is at capacity; a new thirty-first participant is rejected with a friendly `room_full` response and is not queued.
- Participants who disconnect are removed after a heartbeat timeout.

### Return to idle

- Once playback is active, participant disconnects do not stop the session; the show continues so a temporary network loss cannot return the display to idle.
- During lobby and position-question phases, if all participants produce no trackpad input for 3 minutes, the session closes even if their tabs continue sending heartbeats. Video playback does not count toward this interactive-idle timeout.
- The session closes when `maxSessionDurationMs` is reached, even if the graph contains cycles or a participant remains connected.
- The server records the session summary and returns the display to the idle phase.

### Crash recovery

The server writes a checkpoint on every phase transition. A checkpoint contains the session ID, scenario version, phase ID, phase epoch, phase start time, and deadline. Checkpoints are for diagnosis and controlled recovery; the live loop never waits on Postgres.

The safe recovery policy for v1 is:

1. Server process starts.
2. Server validates the scenario.
3. Any interrupted active session is marked `aborted`.
4. A recovery event is written.
5. The room returns to idle.
6. Existing clients reconnect and receive the idle snapshot.
7. The aborted session and last checkpoint remain available to the admin interface.

This is intentionally safer than attempting to reconstruct an in-progress vote or video from partial state. A future version may resume from checkpoints, but v1 must never leave the display waiting indefinitely.

## 7. WebSocket protocol

All messages are JSON and have a discriminator field `t`. Every message includes a protocol version.

### Phone to server

```ts
{ t: "join", v: 1, clientVersion: string, installationId: string, roomId: string, joinGrant: string, participantLease?: string }
{ t: "input", v: 1, sessionId: string, phaseEpoch: number, seq: number, x: number, y: number }
{ t: "ping", v: 1, clientTime: number }
```

Coordinates are normalized to `0..1`. The server clamps and validates them. The client sends input at approximately 20–30 Hz, but the server stores only the latest position per participant.

The QR URL contains a short-lived HMAC-signed `joinGrant` with installation ID, room ID, issued-at time, expiry time, and nonce. Expiry prevents a photographed QR from granting indefinite remote admission; it does not disconnect participants who already joined. The server applies a generous per-IP issuance rate limit for abuse control, but never treats an IP address as a voter identity because venue Wi-Fi users may share one public address.

### Display to server

```ts
{ t: "display_join", v: 1, clientVersion: string, installationId: string, roomId: string, displayToken: string }
{ t: "video_ended", v: 1, sessionId: string, phaseId: string, phaseEpoch: number, mediaId: string }
{ t: "display_heartbeat", v: 1, sessionId: string, phaseId: string, phaseEpoch: number, clientTime: number }
{ t: "qr_grant_request", v: 1 }
```

`video_ended` is accepted only from the authenticated display connection and only when its phase ID matches the server’s current phase.

The server checks the message protocol version `v` and the client build version on every `join` and `display_join`. If the client is too old, it sends:

```ts
{ t: "reload", v: 1, minVersion: string, reason: "protocol" | "scenario" | "assets" }
```

The reload envelope is kept backward-compatible across supported deployments. The client updates its application service worker, clears obsolete app-shell caches, reloads the page, and re-joins. HTML entry points must use `no-cache`; hashed JavaScript/CSS assets may use immutable caching. The display and phone apps must expose their build version in the join message.

### Server to all clients

```ts
{ t: "snapshot", v: 1, sessionId: string, phaseEpoch: number, phase: PhaseSnapshot, serverTime: number }
{ t: "phase", v: 1, sessionId: string, phaseEpoch: number, phase: PhaseSnapshot, serverTime: number }
{ t: "presence", v: 1, count: number }
```

### Server to display

```ts
{ t: "cursors", v: 1, tick: number, cursors: Cursor[] }
{ t: "question_status", v: 1, sessionId: string, phaseEpoch: number, connectedCount: number, positionedCount: number, quadrantCounts?: Record<Quadrant, number> }
{ t: "question_resolved", v: 1, sessionId: string, phaseEpoch: number, quadrantCounts: Record<Quadrant, number>, winner: Quadrant | "tie" | "empty", resolvedTarget: string, freezeUntil: number }
{ t: "qr_grant", v: 1, url: string, expiresAt: number, placement: "large" | "corner" }
{ t: "qr_hidden", v: 1 }
{ t: "display_notice", v: 1, code: "display_replaced" | "media_not_ready" | "reconnecting", level: "info" | "warning" | "error", message: string }
```

The server sends cursor batches at a fixed 20–30 Hz tick. It does not forward every input packet.

The server sends `qr_grant` immediately after `display_join`, after `qr_grant_request`, and every 60 seconds while admission is open. It signs the grant server-side, appends it to `phoneJoinBaseUrl`, and chooses `large` placement during idle/lobby or `corner` during active phases. The display evaluates `expiresAt` against corrected server time and hides an expired QR rather than continuing to show a dead grant. When active admission is disabled, the server sends `qr_hidden`.

`question_status.quadrantCounts` uses the same boundary convention and `countedStatuses` as final resolution. When `showLiveCounts` is true, the server includes the field. When false, the server still calculates the counts internally but omits the field entirely, so the display cannot accidentally make the editorial decision to reveal them. Showing live counts can produce coordination and majority-following behavior, so this is a per-question artistic choice rather than a purely cosmetic setting.

### Server to an individual phone

```ts
{ t: "identity", v: 1, clientId: string, color: string, sessionId: string, participantLease: string, leaseExpiresAt: number }
{ t: "join_rejected", v: 1, reason: "expired_grant" | "room_full" | "rate_limited", retryAfterMs?: number }
{ t: "status", v: 1, phaseId: string, message: string }
{ t: "pong", v: 1, echoClientTime: number, serverTime: number }
```

The client sends `ping` on join and approximately every 10 seconds. It records the local receive time for `pong` and estimates `serverOffset = serverTime - midpoint(localSend, localReceive)`. Countdown displays use corrected server time, not the device clock.

Only one display connection is active. When a new authenticated display joins, the server sends the old display a `display_replaced` notice and closes the old socket before promoting the new connection. This makes kiosk watchdog relaunches safe even when the previous socket has not timed out yet.

One short-lived participant lease represents one browser profile for the current visit. It is stored under an installation-scoped `localStorage` key so multiple ordinary tabs reuse one participant and one projected cursor. A newer connection using the same lease replaces the older phone socket. The signed lease expires after 2 hours and is not valid across installations. Incognito windows or separate devices can still bypass browser-level deduplication; preventing that completely would require visitor authentication, which is outside v1.

## 8. Vote mechanics

The v1 interaction is a timed two-dimensional position vote:

1. The server opens a `position-question` with a deadline, initially 60 seconds.
2. Each phone acts as a relative X/Y trackpad while the participant watches their cursor on the projected screen.
3. All participant cursors remain visible together on the projection throughout the question.
4. Participants may reposition freely until the deadline.
5. At zero, the server records one final snapshot for every participant.
6. For a fixed transition, the server selects `target`. For `quadrant-plurality`, it filters the snapshot to `countedStatuses`, assigns each counted position to exactly one quadrant, and counts each quadrant.
7. A unique highest count selects `map[winner]`; equal highest counts select `tie`; zero counted positions select `empty`.
8. The server emits `question_resolved`, holds the question phase for `freezeMs`, and then advances to the resolved target.

The default `countedStatuses` for quadrant plurality is `valid`, `stale`, and `disconnected`. `never-moved` does not count because it has no coordinates. This default must be confirmed by the director and can be configured per question.

The branch rule consumes the final snapshot; it never replaces or modifies it. The immutable snapshot is finalized in memory and enqueued for durable persistence before the outcome is resolved, so future analysis can apply different rules to the same historical votes. Gameplay does not wait for the database write to finish.

For each connected participant, persist the latest normalized position plus its status and timing metadata. Do not persist the 20–30 Hz raw movement stream by default.

```ts
type PositionVote = {
  sessionId: string;
  questionId: string;
  participantId: string;
  x: number | null;
  y: number | null;
  status: PositionVoteStatus;
  lastInputAt: number | null;
  lastHeartbeatAt: number | null;
  recordedAt: number;
};
```

A stale or disconnected position is still stored and labelled rather than silently discarded. This preserves the raw voting evidence while allowing the director to decide later which statuses should contribute to an outcome.

Required edge-case behavior:

- A participant who never moves is stored with null coordinates and `never-moved` status.
- A participant who disconnects retains their latest coordinates and is labelled `disconnected`.
- Staleness measures connection liveness, not cursor movement. A deliberately parked cursor remains valid. The client heartbeat runs approximately every 10 seconds; a connected client is labelled `stale` only when no heartbeat or other socket message has arrived for `connectionStaleAfterMs`, initially 30 seconds.
- A late participant may vote using the remaining question time.
- No connected participants: keep the session running and resolve the question using its configured disconnected/empty vote semantics.
- Display disconnects: pause or abort according to a global policy; default is abort to idle after the display timeout.

## 9. Display application

Implement the display as three rendering layers:

1. Video layer using one active `<video>` element.
2. UI layer for prompts, a visible axis cross, quadrant labels/counts, countdowns, outcomes, and diagnostics.
3. Canvas cursor layer for colored cursors and trails.

Behavior:

- Receive a phase snapshot and render from server timestamps.
- Render only the latest server-provided QR grant: large during idle/lobby and, when late join is enabled, small in the configured corner during videos and questions. Hide it at `expiresAt` if a replacement has not arrived.
- Render the axis cross and pinned quadrant naming consistently: q1 top-right, q2 top-left, q3 bottom-left, q4 bottom-right.
- When `showLiveCounts` is enabled, render the four live quadrant counts without obscuring participant cursors.
- On boot, fetch and verify the complete `media-manifest.json` before declaring the display ready.
- Persist each complete video response in Cache Storage under its content hash and verify its byte length/hash. Download only missing or changed files during boot synchronization.
- Create Blob URLs only for the active video and plausible next videos by reading their complete cached responses; revoke Blob URLs when they leave the active/preload set. This avoids direct `<video>` Range requests without keeping the full manifest materialized as live Blobs.
- Enforce a v1 media budget of **2 GiB total across the manifest**; the scenario validator must sum the declared and actual media file sizes and reject deployments above the ceiling.
- Use the service worker for the application shell only; media synchronization and Blob creation are controlled explicitly by the display application.
- If media download fails, keep the display in a visible retry state and do not report the display as ready.
- Preload the possible next videos while a question is active when they are not already in the boot cache.
- Interpolate cursor positions approximately 100 ms behind live time to hide network jitter.
- Reconnect with exponential backoff.
- Request a fresh snapshot after reconnect.
- Use corrected server time for countdowns and phase deadlines.
- On `question_resolved`, evaluate the server timestamp `freezeUntil` against corrected server time, freeze the cursor field until that moment, highlight the winning quadrant or tie/empty state, and only then transition to the resolved video or phase.
- Hide the mouse cursor and disable context menus.
- Prevent screen sleep where supported, but do not rely on wake lock as the only protection.
- Show a subtle operator diagnostic indicator that can be revealed with a keyboard shortcut.

Video progression:

- Normal path: display sends `video_ended`.
- Failure path: server advances after `expectedDurationMs + 5 seconds`.
- The timeout must be idempotent; a late `video_ended` must not advance the next phase twice.

## 10. Phone application

The phone UI should be intentionally minimal:

- Fullscreen relative X/Y trackpad
- Small participant color/shape/number identity marker
- Minimal connection indicator
- No account creation
- No names, contact details, or persistent visitor profiles

Store only the signed, installation-scoped participant lease in `localStorage`. This lets ordinary tabs share one cursor and reconnect without creating duplicate voters. The lease expires after 2 hours and carries no name or contact information. IP addresses may be processed transiently by the network stack and in-memory rate limiter but are not written to the application database.

The phone does not mirror the question, axes, other cursors, or countdown. Those belong on the projection so participants look up and experience the vote together. During videos and non-question phases, trackpad input is ignored. Use `touch-action: none`, suppress browser gestures and pull-to-refresh, and tune movement sensitivity on real iOS and Android devices.

When a participant joins, their projected cursor should appear with a brief expanding halo. The phone’s small identity marker matches the cursor’s color, shape, and number so a participant can find themselves in a crowded field. At the voting deadline, the projection freezes all cursors briefly to confirm that the snapshot was recorded.

## 11. Persistence model

Recommended tables:

```text
scenarios
  id, version, definition_json, status, created_at

sessions
  id, installation_id, scenario_id, status,
  started_at, ended_at, end_reason,
  current_phase_id, current_phase_epoch,
  current_phase_started_at, current_phase_deadline

session_phases
  id, session_id, phase_id, phase_index,
  started_at, ended_at,
  question_text, x_axis_json, y_axis_json,
  outcome_json

checkpoints
  id, session_id, phase_id, phase_epoch,
  scenario_version, started_at, deadline_at,
  reason, created_at

votes
  id, session_phase_id, participant_id,
  x, y, status, last_input_at, recorded_at,
  metadata_json

events
  id, session_id, type, payload_json, created_at

health_events
  id, installation_id, component, status, payload_json, created_at
```

For v1, the `scenarios` table is a registry of deployed scenario versions and an analytics reference. It is not the live source of truth for the running server; the validated repository scenario is loaded at startup.

Do not store raw cursor traces by default. Store one final position record for every participant at every question deadline, including stale, disconnected, and never-moved statuses. If research later requires movement traces, make that an explicit privacy and retention decision.

For a position question, `session_phases.outcome_json` must contain quadrant counts, included and excluded totals grouped by status, the winning quadrant or tie/empty result, the resolved target, the counted-status configuration, and the boundary convention. Question text and axis labels are denormalized onto the session phase so exports remain understandable without joining against historical scenario JSON.

Use a Supabase plan with backups appropriate to the project. Supabase documents daily backups for paid plans and Point-in-Time Recovery as an optional finer-grained recovery mechanism. [Supabase backups](https://supabase.com/docs/guides/platform/backups)

### Privacy and retention policy

The launch default is:

- Participant-level vote and session records: retain through the installation and for 90 days after its public closing date, then delete after the approved aggregate research/artistic export is produced.
- Operational application logs: 30 days.
- Join grants and participant leases: cryptographically expire after 2 minutes and 2 hours respectively; do not persist them as analytics data.
- IP-derived rate-limit state: memory only, never written to the application database or structured application logs.
- Raw 20–30 Hz movement traces: not collected.

The original design used `sessionStorage` to create a fresh identity per tab. That decision was explicitly revisited because it made ordinary duplicate-tab voting trivial. The replacement `localStorage` lease is installation-scoped, random, signed, limited to 2 hours, and used only to collapse tabs/reconnects into one participant; it is not a durable cross-visit profile or analytics identifier.

A concise visitor notice must appear at the venue and be linked beside the QR code. It states the data controller/contact, what is collected, the artistic/analytical purpose, that cursors are publicly visible in the room, the retention period, and where to read the complete notice. The responsible organisation must approve the purpose, lawful basis, processor list, host/CDN log retention, and deletion procedure before launch. EU guidance emphasizes transparency, purpose limitation, data minimisation, and storage limitation. [European Commission data-protection principles](https://commission.europa.eu/law/law-topic/data-protection/rules-business-and-organisations/principles-gdpr/overview-principles/what-data-can-we-process-and-under-which-conditions_en)

The privacy note is a launch-blocking, completed document—not a placeholder. This plan provides an engineering default, not legal advice; the responsible organisation should obtain appropriate privacy review.

## 12. Admin and operational API

The admin surface should support:

- View server health
- View display heartbeat age
- View connected participant count
- View current session and phase
- Start a new session
- Return to idle
- Skip current phase
- Restart current session
- View recent errors
- Download session CSV/JSON

Protect admin routes with a strong token or VPN. Do not use a publicly discoverable admin URL as the only protection.

Required server endpoints:

```text
GET  /healthz       process is alive
GET  /readyz        scenario and dependencies are valid
GET  /api/status    sanitized operational status
POST /api/admin/... protected controls
GET  /display       display application
GET  /phone         phone application
GET  /admin         admin application
```

`/healthz` should remain simple. `/readyz` should fail if the production scenario cannot be loaded or validated. Display availability must be tracked separately through its heartbeat.

## 13. Deployment and venue hardware

### Cloud deployment

- Build one versioned container for the server.
- Serve the display, phone, and admin bundles from the same application so the venue has one application URL family.
- Keep videos in object storage/CDN and include immutable versioned URLs.
- Run one always-on server machine near the venue.
- Configure automatic process restart and deployment health checks.
- Store secrets only in the hosting provider’s secret manager.
- Deploy through CI after tests and scenario validation pass.
- Keep the previous production image available for rollback.

The single-machine design intentionally accepts brief platform-initiated interruptions. Fly documents that Machine migration for host maintenance or host health stops the Machine before starting it on another host. The abort-to-idle and client-reconnect policies are the recovery mechanism. An isolated automatically recovered session abort is an accepted operational event; repeated aborts or failure to recover are incidents. [Fly Machine migration](https://fly.io/docs/reference/machine-migration/)

### Venue computer

- Venue mini PC purchased before display development and used throughout soak testing
- Minimum 16 GB RAM and 256 GB SSD
- Ubuntu LTS or ChromeOS Flex
- Wired Ethernet
- Automatic login
- Chrome or Chromium kiosk mode with `--autoplay-policy=no-user-gesture-required`
- Display URL launched on boot only after the machine has network access
- Browser process watchdog
- BIOS power-on-after-power-loss enabled
- Sleep and screen blanking disabled
- UPS recommended
- Remote access through a private VPN such as Tailscale
- One physical power-cycle instruction for venue staff

Production deploys are manual and occur outside venue opening hours. CI runs tests, scenario validation, and image builds automatically, but a production deployment requires explicit approval and a deploy-window check. A deployment may briefly drop the single live WebSocket server and abort an active session; this is acceptable only when visitors are not present.

The static app should remain usable while the server reconnects. If the server is unavailable, the display should show a clear “reconnecting” state and then return to the attract screen after recovery.

## 14. Monitoring and alerting

Monitor three separate failure domains:

1. **Cloud server** — `/healthz` and `/readyz` unavailable.
2. **Display client** — display heartbeat missing while the server is healthy.
3. **Venue network/computer** — both display heartbeat and venue-specific checks missing.

Recommended alerts:

- Server unavailable for 2 minutes
- Display heartbeat absent for 2 minutes during venue opening hours
- Repeated display reconnects
- Session abort frequency above the agreed threshold or failure to recover to idle
- Display stuck in media download/hash retry for more than 2 minutes
- Memory usage or process restart spike
- Scenario validation failure during deployment
- Database write queue growing

Log structured events with session ID, phase ID, installation ID, and error code. Avoid logging participant IP addresses or other unnecessary personal data.

## 15. Implementation phases

### Phase 0 — Decisions and content lock

Deliverables:

- Maximum simultaneous players, initially 30
- Lobby countdown, minimum participants, interactive-idle timeout, and maximum session duration
- Signed QR grant rotation/expiry and participant-lease policy
- Late-join policy and active-phase QR visibility/placement on the projection
- Relative trackpad movement sensitivity
- Position-question duration, initially 60 seconds
- X/Y axis wording and the quadrant naming/boundary convention
- `freezeMs`, initially 3 seconds, and whether live quadrant counts are shown
- Counted-status default confirmation
- Quadrant, tie, and empty targets for every branching question
- Director review of every `empty` target using the specific abandoned-solo scenario: one visitor starts the show, walks away during the intro, and the first question records zero counted votes
- Full content graph
- Media inventory and expected durations, including all distinct branch targets; quadrant, tie, and empty outcomes may reuse the same media
- Explicit media-budget arithmetic before content approval: sum the byte sizes of all distinct referenced files across every branch and confirm the result remains at or below the 2 GiB manifest ceiling
- Opening hours and reset grace period
- Purchase the production-spec venue mini PC so display development and soak tests run on the real hardware
- Approved visitor notice, privacy policy, processor/log-retention review, and deletion schedule

Exit criteria: scenario graph exists as a diagram and machine-readable config; admission/session policy is signed off; venue hardware is available; and the privacy package is approved.

### Phase 1 — Repository and protocol

Deliverables:

- Monorepo and workspace tooling
- Shared protocol types and Zod schemas
- Scenario schema and validator
- Fake scenario with one video and two questions
- Local development scripts

Exit criteria: invalid messages and invalid scenarios fail with useful errors.

### Phase 2 — Server core

Deliverables:

- WebSocket connection lifecycle
- Room and participant registry
- Signed join-grant validation, browser participant leases, admission rate limiting, and 30-participant cap
- Lobby countdown, interactive-idle timeout, and maximum-session timeout
- Identity and color assignment
- Input throttling and validation
- 20–30 Hz cursor tick loop
- State machine and phase timers
- Timed position-snapshot vote engine
- Fixed and quadrant-plurality transition resolver
- `freezeMs` resolution hold
- Video timeout fallback
- Idle/start/late-join behavior
- Phase epoch checks that reject stale input and stale display events
- Durable phase-transition checkpoints
- Safe crash recovery to idle

Exit criteria: automated tests cover the entire fake scenario without a browser.

### Phase 3 — Display client

Deliverables:

- Fullscreen phase renderer
- Video playback and preload behavior
- Question, X/Y axis, and cursor-field renderer
- Optional live quadrant counts and frozen winning-outcome highlight
- Countdown rendering from server timestamps
- Cursor canvas and interpolation
- Reconnect/snapshot handling
- Build-version mismatch/reload handling and service-worker update
- Full media-manifest download, hash verification, and Blob URL playback
- Server-pushed rotating QR, idle/lobby presentation, active-phase corner placement, and expiry hiding
- Display heartbeat

Exit criteria: display can run continuously through at least 24 hours on the venue-spec mini PC with the complete production-sized media set.

### Phase 4 — Phone client

Deliverables:

- QR join flow
- Expired-grant, room-full, and rate-limited admission states
- Trackpad input
- Cursor color and status
- Input throttling
- Reconnect and identity restoration
- iOS Safari and Android Chrome support

Exit criteria: ten real phones can join, move, disconnect, lock their screens, reconnect, and continue.

### Phase 5 — Persistence and admin

Deliverables:

- Supabase migrations
- Session/event writes
- Phase checkpoint writes and recovery events
- Retry buffer and shutdown flush
- Admin status screen
- Protected skip/reset controls
- CSV/JSON export

Exit criteria: a completed session can be reconstructed from database records.

### Phase 6 — Deployment and kiosk hardening

Deliverables:

- Production container
- Hosting configuration
- HTTPS/WSS
- Domain and QR URL
- CDN media delivery
- Venue mini PC provisioning
- Browser watchdog
- Remote access
- Monitoring and alerts
- Rollback instructions

Exit criteria: unplugging and restarting the venue computer results in automatic return to the idle screen without developer intervention.

### Phase 7 — Reliability testing and launch

Deliverables:

- 30-client load test
- Server-kill test
- Display-kill test
- Video codec/fallback test
- Bad network test
- Phone lock/reconnect test
- Stale cached display and phone bundle test across a deployment
- Full media boot/download failure and retry test
- Autoplay test with video audio enabled
- Second-display replacement test
- Clock-offset/countdown synchronization test
- 48-hour soak test
- Final 48-hour soak test on the exact production mini PC with production media volume
- Venue acceptance test
- Operations handoff and contact list

Exit criteria: all acceptance tests pass and the installation can be operated by someone who did not build it.

## 16. Acceptance tests

The project is ready for launch when all of the following are true:

- 30 simulated clients maintain stable connections and cursor updates.
- A current signed QR grant admits a new participant and an expired grant is rejected.
- The server pushes a replacement `qr_grant` every 60 seconds; the display hides a grant at its server-time `expiresAt` if no replacement arrives.
- With late join enabled, a participant scanning the corner QR during an active video or question is admitted with the current grant.
- With late join disabled, the server sends `qr_hidden` after the lobby and active phases display no QR.
- Multiple ordinary tabs using the same participant lease produce one participant and one projected cursor.
- A new thirty-first participant receives `room_full`, while an existing leased participant may reconnect at capacity.
- The first participant starts a 10-second lobby and a solo participant can begin the show.
- An abandoned solo session continues playback, follows the director-approved disconnected/`empty` vote behavior, and still returns safely to idle through the scenario flow, inactivity, or maximum-duration policy.
- Heartbeats without trackpad input cannot keep an interactive phase alive beyond the 3-minute idle timeout.
- A cyclic session returns to idle at the configured maximum session duration.
- The display renders all cursors without visible degradation.
- A late participant receives the current phase within one second.
- A phone reconnects and receives the correct current state.
- A stale cached phone or display bundle receives `reload`, updates its app shell, and reconnects.
- The display does not report ready until all manifest media is downloaded and verified.
- The complete media sync and 24-hour display test pass on the venue-spec 16 GB mini PC.
- A corrupted/failed media download keeps the display out of ready state and raises an alert after 2 minutes.
- A scenario whose media manifest exceeds 2 GiB fails validation before deployment.
- A 60-second question freezes and records exactly one final position record per participant.
- Never-moved, stale, and disconnected participants are stored with explicit statuses.
- Raw 20–30 Hz cursor movement is not written to the database.
- A fixed transition and every quadrant-plurality question resolve to a target.
- Unique plurality, equal-count tie, and zero-count empty cases resolve correctly.
- Positions exactly on `x = 0.5` resolve to the right half and positions exactly on `y = 0.5` resolve to the bottom half.
- Statuses excluded from `countedStatuses` provably do not affect the winner.
- A stationary but live participant remains valid; staleness is based on heartbeat age rather than input age.
- `question_status` includes `quadrantCounts` only when `showLiveCounts` is enabled.
- The frozen field and winning/tie/empty highlight remain visible for exactly `freezeMs`, evaluated using corrected server time, before the resolved target begins.
- A missing `video_ended` message cannot permanently block the experience.
- A stale input or video event from a previous phase cannot change the current phase.
- A second display connection replaces the old display connection safely.
- Display and phone countdowns agree with server time within the defined tolerance.
- Killing the server returns the installation to idle after restart.
- Killing Chrome causes the kiosk watchdog to relaunch it.
- A lost venue connection produces a visible reconnecting state and automatic recovery.
- Session outcomes are persisted with no duplicate phase transitions.
- Retention deletion is testable, participant-level records expire according to policy, and the approved visitor notice is present at the venue and QR entry point.
- A malformed content graph blocks deployment.
- The 48-hour soak test shows bounded memory usage and no growing queue.
- The venue staff recovery procedure works without SSH access.

## 17. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Venue internet outage | Automatic reconnect, visible idle/reconnecting state, local media cache, venue Ethernet |
| Remote or replayed QR participation | HMAC-signed join grants rotated every 60 seconds and expired after 2 minutes |
| Display shows an expired or unavailable join QR | Server-pushed grant with server-time expiry; display hides expired grants and requests a replacement after reconnect |
| Duplicate-tab voting | Installation-scoped, 2-hour participant lease shared across ordinary tabs; same-lease connection replacement |
| Admission above 30 participants | Deterministic `room_full` rejection for new leases; existing leases may reconnect |
| Stale browser/service-worker bundle | Build version in join handshake, backward-compatible reload message, no-cache HTML, hashed assets |
| Broken video Range caching | Complete-response Cache Storage plus Blob URLs for active/next videos |
| Media set exceeds kiosk storage/memory budget | 2 GiB validator ceiling, active/next Blob lifecycle, and soak tests on the venue-spec machine |
| Autoplay blocked | Kiosk launch flag and venue acceptance test with audio-enabled videos |
| Browser freezes | Kiosk watchdog and display heartbeat |
| Video never emits `ended` | Server-side expected-duration timeout |
| Server loses in-memory state | Abort active session and return to idle deterministically |
| Platform-initiated Machine migration/restart | Accepted isolated abort, automatic return to idle, reconnect, structured event; alert on repetition or failed recovery |
| Curator creates a broken phase link | Scenario validator and publication gate |
| Polarized or ambiguous outcome | Explicit tie target; optionally use a dramaturgical “no consensus” phase or video |
| Abandoned solo session repeatedly follows empty branches | Director-approved empty targets plus interactive inactivity and absolute session-duration limits |
| Too many cursor messages | Latest-position store plus fixed server tick |
| Visitors join after a question starts | Late-join policy explicitly defined |
| Absent but heartbeating phone keeps session alive | Trackpad-input idle timeout during interactive phases plus absolute session-duration cap |
| Unclear or excessive visitor-data retention | Approved visitor notice, fixed retention windows, deletion procedure, and no raw cursor traces |
| Admin endpoint exposed | Strong token/private VPN and audit logging |
| Database temporarily unavailable | In-memory retry buffer; gameplay does not depend on reads |
| Accidental production deploy during visitor hours | Manual deploy approval and venue-time deploy-window check |
| Mobile browser behavior differs | Early iOS Safari and Android testing |
| Silent long-term degradation | Alerts, daily status checks, memory monitoring, 48-hour soak test |

## 18. Final handoff package

The engineering team should deliver:

- Source repository
- Production scenario config
- Media manifest
- Database migrations
- Deployment configuration
- Environment-variable reference
- Automated test suite
- Venue installation guide
- Operations runbook
- Admin credentials transfer procedure
- Rollback procedure
- Monitoring dashboard and alert list
- Approved, completed data-retention/privacy document, visitor notice, processor list, and deletion procedure
- Contact list for technical and venue escalation

The simplest production shape is therefore: one TypeScript server, two public client experiences, one protected admin client, Supabase for durable records, CDN-backed media, and a kiosk computer that can recover itself. That is enough for the interaction, while keeping the operational surface small enough to maintain for a year.
