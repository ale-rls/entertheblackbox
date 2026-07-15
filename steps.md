# steps.md — RETIRED (historical record)

> **This file is no longer the source of truth and must not be acted on.**
> Retired 2026-07-15. The two-agent process moved to a PR-based flow on
> 2026-07-14 — see [docs/agent-workflow.md](docs/agent-workflow.md). The open
> backlog now lives in GitHub issues; the STEP-000 director decisions moved to
> [docs/director-decisions.md](docs/director-decisions.md). Do not claim steps,
> edit statuses, or use the `.steps.lock` protocol. The step notes below are
> kept verbatim because they contain review findings and verification records
> referenced elsewhere.

Agents: **claude** (Claude Code, Fable 5) and **codex** (Codex CLI, GPT-5.6).
Protocol agreed between both agents on 2026-07-11 (Codex session `019f52da-e20d-7e90-9475-51ee60a4659b`).

## Protocol

**Claiming.** Before editing this file: create the lock dir `.steps.lock/` (mkdir is
atomic), write `owner` and ISO timestamp into `.steps.lock/info`, re-read steps.md,
make your change, remove the lock. If mkdir fails, WAIT and retry — never
proceed with the edit and never delete a lock you did not create (only a lock
older than 10 minutes may be broken — verify no active writer if feasible, and
record the break in the step's notes). Shell scripts must not chain
`rm -rf .steps.lock` unconditionally after a possibly-failed mkdir.

**Ownership.** Claim a step (set `owner` + `in-progress`) before touching code.
One implementation owner per active step. Never edit files reserved by another
agent's in-progress step. Expected-file lists are reservations, not guarantees —
on newly discovered overlap, stop and coordinate before editing.

**Statuses.** `todo → in-progress → review → done`, plus `blocked`.
Complex steps require cross-review: the *other* agent reviews and flips
`review → done`. Reviewers request changes via `notes`; they never edit the
owner's files directly. Simple steps may go straight to `done` after
self-verification (`reviewer: none`), but verification results are mandatory
for every step. Blocked steps must name the exact blocker and what unblocks it.

**Model tiering (execution hint).** `tier: simple` steps run on cheaper models —
claude routes them to Sonnet 5 subagents; codex runs them with a lighter/
lower-effort config. `tier: complex` steps run on the frontier models.
Neither agent blocks on tiering if the cheaper path is unavailable.

**Review tiering (amended 2026-07-12, codex ACK).** Reviews owed by claude run
on a Sonnet 5 subagent by default. Fable (frontier claude) reviews only
STEP-006 (grant/lease crypto), STEP-008 (vote resolution correctness), and
STEP-018 (persistence integrity/privacy) — or any step whose Sonnet reviewer
flags uncertainty instead of approving. Codex reviews claude's steps as before.
If a step sits in `review` solely because the reviewing lane has a *confirmed*
quota outage, the owner may proceed to dependent steps at risk (note
"proceeding at risk pending review"); when credits return, review-triggered
fixes take priority over new steps.

**Tiering re-amended 2026-07-12 (user direction; codex ACK 2026-07-13;
supersedes the Sonnet routing above).** The claude lane no longer spawns Sonnet subagents —
codex has the larger credit budget. New routing: simple/medium implementation
work defaults to codex ownership regardless of historical slices. Reviews:
fable (frontier claude) reviews ONLY steps that are complex with high failure
potential (crypto, vote/resolution correctness, persistence integrity/privacy,
admission security, data-loss paths). Codex-authored low-risk steps use
`reviewer: none` self-verification instead of a claude-side review;
claude-authored steps are still cross-reviewed by codex as before. Cross-review
integrity is unchanged: no agent ever approves its own work.

**Division.** Feature slices first: when several steps touch the same files or
concepts, one agent owns the whole slice. Everything else is a greedy queue —
pull the next unblocked `todo` you're not colliding with.

**Commits (once git is initialized).** One completed step per commit, staged by
explicit paths (never `git add .`), message prefixed with the step ID
(`STEP-012: …`). Never reset or rewrite the other agent's work.

**Plan changes.** Work discovered mid-step becomes a *new* step — never silently
expand the current one. Full test suite runs once after all steps are done.

**Decomposition.** When the implementation plan lands, whichever agent is invoked
first decomposes it into steps below (with tiers and `depends-on`); the other
agent reviews the decomposition before any implementation starts.

## HANDOFF — claude lane quota outage (2026-07-12)

**RESOLVED 2026-07-12: claude lane is back (interactive session).** Working the
at-risk review queue first per protocol: STEP-019, STEP-021 re-review, STEP-032,
STEP-033 (also owes the STEP-033 commit on codex's behalf — codex hit its usage
limit before committing). STEP-023 (claude, in-progress) resumes after reviews.
Historical solo-mode instructions below are no longer in force:

The claude lane (including its Sonnet review subagents) is out of credits —
this is a CONFIRMED quota outage per the Review-tiering rule. Until claude
returns, codex operates solo:

- **Proceed at risk** past any review owed by claude. Mark such steps
  "proceeding at risk pending claude review" in notes and continue to
  dependent steps. Queue of reviews claude owes on return, in priority
  order: STEP-008 re-review (fable-critical), then anything else marked
  at-risk. When claude returns, review-triggered fixes take priority.
- **Execution order for the codex slice**: finish STEP-008 fixes → 009 →
  010 → 011 → 026 → 012 → 018 (fable-critical review, proceed at risk) →
  019 → 020 (greedy) → 021 → 022 (greedy) → 024. STEP-023/025 need
  claude/client coordination and the launch gate — leave for joint work.
- **Claude's slice is complete** (001–004, 013–017, 027 all done). Do not
  modify packages/protocol, packages/scenario, packages/shared, or
  apps/display, apps/phone except via a new step claimed per protocol.
- **Git commits**: the index.lock EPERM failures were almost certainly
  contention with concurrent claude sessions — with claude gone, retry
  commits with short backoff (3 attempts). If commit still fails, leave
  the working tree intact and record "UNCOMMITTED — needs commit" in the
  step's notes; never discard work.
- **Per invocation discipline** stays the same: one step per run, verify,
  record results, end with BACKLOG_STATUS: remaining|empty|blocked.

## Resume / watchdog

Credit or usage-limit outages are expected. Resumption is stateless-safe because
this file is the durable state — so retries always start a **fresh session**
(no `resume --last`; agreed with codex 2026-07-11: "last" is fragile across
repos/lanes, and fresh sessions that re-read steps.md are safer).

`scripts/resume-work.sh claude|codex` is the watchdog, one independent lane per
agent so one side being out of credits never stalls the other. Per invocation
the agent must: re-read steps.md → recover its own unexpired claim or claim the
next unblocked step → do **at most one step** → update status/verification under
the lock → end its final message with the sentinel
`BACKLOG_STATUS: remaining|empty|blocked`.

Watchdog classification (coarse — no stable exit codes are documented on either CLI):
- clean exit + `remaining` → run again immediately; `empty`/`blocked` → lane done.
- quota/rate-limit text match → sleep until parsed reset time if available,
  else exponential backoff (60 s → 30 min cap), then retry.
- any other failure → log and **stop the lane**. Never mark a step `blocked`
  from retry exhaustion; `blocked` means a confirmed task blocker only.
- per-lane process lock (`.watchdog/<lane>.lock`) prevents overlapping cron/
  launchd runs; logs are kept per run under `.watchdog/logs/<lane>/`.

Codex lane invocation: `codex exec --cd <repo> --sandbox workspace-write --json
--output-last-message <run>/final.txt "<prompt>"` (plus `--skip-git-repo-check`
until git is initialized). Claude lane: `claude -p --permission-mode acceptEdits "<prompt>"`.

## Step template

```
### STEP-NNN: <short title>
- status: todo | in-progress | review | done | blocked
- owner: claude | codex | —
- tier: simple | complex
- depends-on: STEP-NNN, … | —
- files: <expected files to touch>
- acceptance: <criteria that define done>
- verify: <command> → <result once run>
- reviewer: claude | codex | none
- notes: <handoffs, blockers, review requests>
```

## Slices

Source plan: `smartphonecracy-installation-implementation-plan.md` (v1, 2026-07-11).
Feature slices (decomposition reviewed by codex 2026-07-11, CHANGES REQUIRED amendments applied; slices accepted unchanged):
- **claude**: foundation packages (001–004), display client (013–016), phone client (017)
- **codex**: server core (005–012), persistence + admin (018–019), deployment (021, 024)
- greedy queue for the rest (020, 022, 023, 025) once dependencies clear.

## Backlog

### STEP-000: Phase 0 director decisions
- status: blocked
- owner: —
- tier: —
- depends-on: —
- files: content/scenarios/production.json (later)
- acceptance: director confirms policy values (§15 Phase 0): timings, axis wording, quadrant/boundary convention, counted statuses, empty targets, content graph, media inventory ≤ 2 GiB, privacy package
- verify: n/a (user/director input)
- reviewer: none
- notes: BLOCKER: needs the user/director. Four separable deliverable groups: (a) director decisions (timings, axes, quadrant convention, counted statuses, empty targets), (b) content production (graph, media inventory ≤ 2 GiB), (c) hardware procurement (venue-spec mini PC), (d) privacy package approval. Engineering proceeds against the fake dev scenario; production.json lands here later.
  GROUP (a) POLICY DECISIONS RECORDED — director (user) via claude session 2026-07-12:
  * Player cap: 30 (confirmed; matches load-tested capacity).
  * Position-question duration: 60 s (durationMs: 60000 per question in production.json).
  * Lobby/idle timings: as built — lobby countdown 10 s, interactive-idle 180 s, max session 30 min, no-participant grace 2 min (DEFAULT_PHASE_ENGINE_POLICY unchanged).
  * Resolution: freezeMs 5000 (CHANGED from plan's initial 3 s — 5 s hold on the outcome) + live quadrant counts ON (showLiveCounts: true per question).
  * Late join: LOBBY-ONLY (CHANGED from as-built default — allowLateJoin=false; QR hides once a session starts; latecomers wait for next idle/lobby). production.json/QR wiring must set this.
  * QR/grant/lease: as built — 60 s QR rotation, 120 s grant validity, 2 h participant lease.
  * Counted statuses: valid + stale + disconnected (never-moved always excluded) — countedStatuses: ["valid","stale","disconnected"] on every quadrant-plurality question.
  * Quadrant boundary convention: CONFIRMED center→q4 (x=0.5→right, y=0.5→bottom); shared quadrantOf stays as implemented.
  * Trackpad sensitivity: deferred to the Phase 7 on-hardware pass per STEP-017 notes (no decision needed pre-hardware).
  STILL OPEN (blockers): (b) content — axis wording + quadrant naming per question, full content graph, quadrant/tie/empty targets incl. the abandoned-solo empty-target review, media inventory + durations + 2 GiB arithmetic; opening hours/timezone + reset grace; (c) venue mini PC purchase; (d) privacy package (visitor notice, policy, processor/log-retention review, deletion schedule).

### STEP-001: Monorepo scaffold
- status: done
- owner: claude
- tier: complex
- depends-on: —
- files: package.json, pnpm-workspace.yaml, tsconfig*, apps/*/ (stubs), packages/*/ (stubs), .gitignore, vitest config
- acceptance: pnpm install + typecheck + empty vitest run pass across all workspaces; repo layout matches plan §3
- verify: pnpm -r typecheck && pnpm -r test → PASS (7 workspaces, node 22.17 / pnpm 9.12.2, 2026-07-11); pnpm --filter '@smartphonecracy/*' build → PASS (2026-07-11)
- reviewer: codex
- notes: APPROVED by codex 2026-07-11. Layout, workspace manifests, TypeScript configs, React/Vite stubs, Fastify/ws stub, and shared quadrantOf boundary-convention utility/tests match the plan. Keep quadrantOf in shared; STEP-003/008 should consume it rather than duplicate server-side logic.

### STEP-002: packages/protocol — message types + Zod schemas
- status: done
- owner: claude
- tier: complex
- depends-on: STEP-001, STEP-003
- files: packages/protocol/**
- acceptance: every §7 message (phone→server, display→server, server→clients/display/phone) has a type + Zod schema + discriminated-union parser; invalid messages fail with useful errors
- verify: pnpm --filter protocol test → PASS (30 tests) + typecheck PASS (2026-07-11)
- reviewer: codex
- notes: APPROVED by codex 2026-07-11. All §7 message envelopes, inferred types, and direction-specific discriminated unions match the plan. Parsers are throw-free for malformed JSON/messages and return useful first-issue paths; encoding, Uint8Array input, protocol-version rejection, optional live counts, and coordinate clamping are covered. Cursor shape ({clientId,x,y,color}) is a sound minimal contract for STEP-009/display. Independent review verification: `pnpm --filter protocol test && pnpm --filter protocol typecheck` → PASS (30 tests; Node 20.12.2 emitted the expected repo engine warning for >=22).

### STEP-003: packages/scenario — schema, graph + media validators
- status: done
- owner: claude
- tier: complex
- depends-on: STEP-001
- files: packages/scenario/**
- acceptance: rejects all invalid cases in §5 (missing IDs/media, bad durations/axes, incomplete quadrant maps, bad counted statuses, broken targets); reports unreachable phases; cycles allowed only when marked; media manifest byte-size check with 2 GiB ceiling; quadrant boundary convention (x=0.5→right, y=0.5→bottom, center→q4) implemented here as shared utility
- verify: pnpm --filter scenario test → PASS (17 tests) + typecheck PASS (2026-07-11)
- reviewer: codex
- notes: APPROVED by codex 2026-07-11. Structural Zod checks, graph validation, injectable media stat/2 GiB enforcement, exports, and tests match plan §5. Scenario-level cyclesAllowed is accepted for v1; STEP-007 must still enforce maxSessionDurationMs. quadrantOf is correctly consumed from shared; no additional server-facing exports are required. STEP-002 should consume the exported Phase/PhaseSnapshot types and schemas.

### STEP-004: Fake dev scenario + validate-scenario script
- status: done
- owner: claude
- tier: simple
- depends-on: STEP-003
- files: content/scenarios/dev.json, content/media-manifest.json, scripts/validate-scenario.ts
- acceptance: fake scenario (1 video, 2 questions incl. one quadrant-plurality) validates; script exits nonzero with readable errors on a broken copy
- verify: `pnpm validate-scenario content/scenarios/dev.json` → exit 0, "OK: scenario valid" (2026-07-11); broken copy (question-fixed next.target rewritten to a nonexistent "ghost-phase") → exit 1, `[ERROR] phase "question-fixed" next.target points to unknown phase "ghost-phase"` plus an expected `[WARN]` unreachable-phase for "question-quadrant" (its only inbound edge was the broken one), then `FAIL: scenario validation found errors`
- reviewer: none
- notes: delegated to Sonnet 5 subagent per tiering protocol (claude supervises). dev.json: idle + intro-video (1 video phase, media in content/media/intro.mp4 + content/media-manifest.json) + question-fixed (fixed next → question-quadrant) + question-quadrant (quadrant-plurality, full q1-q4 map + tie + empty all → idle, countedStatuses ["valid","stale","disconnected"]). No cycles (idle is a terminal sink). scripts/validate-scenario.ts imports @smartphonecracy/scenario via relative path ../packages/scenario/src/index.js (root package.json is intentionally outside the pnpm workspace glob, so package-name resolution isn't available from scripts/); no changes needed to root package.json (validate-scenario alias already present from STEP-001 scaffold).

### STEP-005: Server skeleton
- status: done
- owner: codex
- tier: complex
- depends-on: STEP-001, STEP-002, STEP-003, STEP-004
- files: apps/server/** (http, ws wiring, config)
- acceptance: Fastify + ws boot; /healthz, /readyz (fails on invalid scenario), /api/status; env/config module; serves display/phone/admin bundles; graceful shutdown
- verify: `pnpm --filter server test` → PASS (4 tests); `pnpm --filter server typecheck` → PASS; `pnpm -r test` → PASS (53 tests across 4 suites); `pnpm -r typecheck` → PASS (7 workspaces), 2026-07-11. Node 20.12.2 emitted the expected repo engine warning for >=22.
- reviewer: claude
- notes: Ready for claude review. Added validated env/config with repo-root path resolution; deployment scenario+manifest+media readiness that leaves liveness up and returns 503 from /readyz on invalid content; sanitized /api/status; display/phone/admin static bundle routes; /ws upgrade boundary; signal handling; and pre-close WebSocket termination for deadlock-free graceful shutdown. Tests cover config rejection, valid/invalid readiness, all bundle roles, secret omission, a real localhost WebSocket upgrade, and connected-client shutdown.
  APPROVED by claude review lane (sonnet) 2026-07-12: re-verified `pnpm --filter server typecheck/test` and `pnpm -r typecheck/test` (Node 22.17.0) all pass matching the notes; graceful shutdown double-close guard, sanitized /api/status, path-traversal-safe static bundle serving, and 503 invalid-scenario /readyz all check out; no socket message handling exists yet so the parseClientMessage requirement doesn't yet apply (correctly deferred to later steps). Two non-blocking FYIs left for future hardening, not blocking this step: (1) `void shutdown(...)` in index.ts doesn't catch a rejection from app.close(), a latent unhandled-rejection risk if close ever throws; (2) /readyz readiness is computed once at boot and never rechecked per request — fine for the current fixed-scenario-at-boot model, but STEP-019 admin-driven scenario reload will need an explicit recompute hook.

### STEP-006: Admission — grants, leases, registry
- status: done
- owner: codex
- tier: complex
- depends-on: STEP-005
- files: apps/server/src/admission/**, room registry
- acceptance: HMAC join grants (rotation/expiry per policy), participant leases (2 h, installation-scoped, same-lease socket replacement), 30-cap with room_full + lease reconnect at capacity, per-IP rate limit (memory only), identity/color assignment
- verify: `pnpm --filter server typecheck` → PASS; `pnpm --filter server exec vitest run src/admission/admission.test.ts` → PASS (8 tests); `pnpm -r typecheck` → PASS (7 workspaces), 2026-07-12. Full `pnpm --filter server test` remains environment-blocked here by its pre-existing localhost WebSocket test (`listen EPERM: operation not permitted 127.0.0.1`); user reports the full suite passes outside this sandbox.
- reviewer: claude
- notes: Changes requested by Fable were applied. X-Forwarded-For is now honored only when `TRUST_PROXY=true` is parsed into config and passed to admission; otherwise the socket peer address is used. The registry now counts held leases toward the cap, keeps disconnected leases for a 30-second heartbeat/disconnect grace, permits the existing lease to reconnect at capacity, and removes expired/grace-finished records. Rate limiter buckets sweep expired windows on every consume. Added focused tests for trust gating, grace/cap behavior, bucket pruning, crypto boundaries, replacement, and parser-backed socket admission. Ready for Fable re-review; crypto core remains unchanged and approved. APPROVED by fable re-review 2026-07-12 (57cfd82): all three findings fixed and verified; full suite 83 tests green.

### STEP-007: Phase engine
- status: done
- owner: codex
- tier: complex
- depends-on: STEP-005, STEP-006, STEP-003
- files: apps/server/src/engine/**
- acceptance: scenario-driven state machine; phase epochs reject stale input/events; lobby countdown, interactive-idle timeout, max-session cap; checkpoint hook on transitions; safe crash recovery → abort to idle (§6); display-disconnect policy (abort to idle after display timeout); no-participant grace-period return to idle; phones may join but cannot start a session without a connected healthy display
- verify: `pnpm --filter server exec vitest run src/engine/phase-engine.test.ts` → PASS (7 tests); `pnpm --filter server typecheck` → PASS; `pnpm --filter server test` → 18/19 tests pass, with the pre-existing real-localhost WebSocket test sandbox-blocked by `listen EPERM: operation not permitted 127.0.0.1`; `pnpm -r typecheck` → PASS (7 workspaces), 2026-07-12.
- reviewer: claude
- notes: Ready for claude review. Added deterministic PhaseEngine lifecycle with idle/lobby/active states, scenario phase snapshots, per-session phase epochs, lobby countdown, question/video deadlines, interactive-idle and max-session aborts, no-participant grace, display-disconnect timeout abort, transition/checkpoint hooks, crash recovery to idle, stale event rejection, authenticated single-display replacement, display heartbeat/video handling, phone input gating, and admission-registry-backed participant/display broadcasts. Admission now forwards parsed client messages and lifecycle callbacks to the engine. Engine timer is started/stopped with server runtime shutdown. Full suite localhost bind limitation is environment-only.
  CHANGES REQUESTED by claude review lane (sonnet) 2026-07-12. Verification re-run clean: `pnpm --filter @smartphonecracy/server typecheck` PASS; `pnpm --filter @smartphonecracy/server test` PASS 17/17 (admission 8, phase-engine 5, server 4 — no localhost EPERM issue in this sandbox); `pnpm -r test` PASS 99 tests / 7 suites; `pnpm -r typecheck` PASS 7 workspaces. Most of the acceptance line checks out: epoch-tagged stale-input/stale-display-event rejection, lobby countdown, max-session cap (works under cyclic graphs since it's a pure wall-clock check independent of phase structure), checkpoint hook fired on every transition (correctly left unwired to persistence pending STEP-018), display-disconnect→idle, no-participant grace→idle, and "cannot start without a connected healthy display" are all correctly implemented and covered by tests.
  BLOCKING DEFECT (confirmed by direct reproduction, not just inspection): the interactive-idle timeout does not exclude video-phase time as required ("video playback must NOT count toward this interactive-idle timeout"). In `apps/server/src/engine/phase-engine.ts`, `enterPhase()` only sets `lastInputAt` via `this.lastInputAt ??= now` (line ~389) — i.e. once per session, on first null — never on subsequent phase entries. `recordInput()` only updates it during `position-question` phases. So elapsed wall-clock time spent in an intervening `video` phase (during which input is intentionally not tracked) is never excluded from the idle budget of the position-question phase that follows: the stale `lastInputAt` from before the video is reused, and the video's duration silently eats into the 3-minute budget. Reproduced standalone (video 220s + 250ms into the next question phase, zero real inactivity within the question phase itself) → engine aborts to idle on the very next tick with checkpoint reason `interactive-idle-timeout`, i.e. the question phase never gets a chance to run once lobby+preceding video time exceeds `interactiveIdleTimeoutMs` (180s default). This is easy to hit with a normal-length intro video. None of the 5 existing tests in `phase-engine.test.ts` catch it because `completeVideo` is always invoked at the same `now` as session start in those tests (zero simulated video duration). Fix direction: reset/advance `lastInputAt` at the boundary into a tracked (lobby/position-question) phase from an untracked one, so elapsed time in video (or any other non-tracked phase kind) is excluded, while still deciding intentionally whether idle time should keep accruing across back-to-back tracked phases (e.g. lobby→question with no intervening video) — current code accidentally does the latter only because it never resets, not by design.
  Secondary, same-root-cause finding (non-blocking on its own, but likely resolved by the same fix): the interactive-idle check in `tick()` is only evaluated in the `if (this.lifecycle === "lobby") { ...; return; }` branch's absence — i.e. it's skipped entirely while `lifecycle === "lobby"` (the function returns after the lobby-deadline check, never reaching the interactive-idle block at line ~204). So "only during lobby/question phases" is not actually enforced during lobby; it's a no-op there today, currently masked because default `lobbyCountdownMs` (10s) is far shorter than `interactiveIdleTimeoutMs` (180s).
  Everything else (checkpoint/admission seams, single-display replacement/auth, crash-recovery-to-idle boundary correctly deferred pending STEP-018 checkpoint persistence) looks correct. Re-request review once the idle-timer scoping is fixed; recommend adding a regression test with non-zero simulated video duration before re-submitting.
  FIXED after review: `enterPhase()` now re-anchors the idle baseline on every `position-question` entry and clears it for video/idle phases, excluding video wall-clock time from interactive idle. `tick()` now enforces the interactive-idle timeout during lobby while retaining the lobby deadline transition behavior. Added regressions for a 220-second video before a question and for lobby inactivity. Ready for claude re-review; STEP-008 remains unclaimed.
  APPROVED by claude review lane (sonnet) 2026-07-12: re-reviewed fix commit 6aa724b; both findings resolved. Re-ran the original standalone repro against the fixed engine — 220s video then question phase survives (was: instant abort), and the idle budget is now anchored exactly at question entry (still active at +179s of genuine in-question inactivity, aborts with `interactive-idle-timeout` at +180.1s). Lobby-idle enforcement verified in code and by the new test; the post-`startSession` fall-through in the reworked lobby tick branch is safe (no double-transition: fresh idle anchor, zero session elapsed, future deadline). New regression tests encode realistic durations (220_000ms video vs 180_000ms idle timeout — not zero-time). Verification: `pnpm --filter @smartphonecracy/server typecheck` PASS; `pnpm --filter @smartphonecracy/server test` PASS 19/19 (engine 7, admission 8, server 4; no localhost EPERM in this sandbox). FYI, non-blocking: input during lobby cannot refresh the idle anchor (`recordInput` requires active+question), which only matters if a config sets `lobbyCountdownMs` > `interactiveIdleTimeoutMs`; unreachable with defaults and there is no trackpad surface during lobby.

### STEP-008: Vote engine + transition resolver
- status: done
- owner: codex
- tier: complex
- depends-on: STEP-007
- files: apps/server/src/votes/**, apps/server/src/engine/phase-engine.ts, apps/server/src/engine/phase-engine.test.ts, apps/server/src/admission/registry.ts
- acceptance: final-snapshot semantics (§8): statuses valid/never-moved/stale/disconnected; heartbeat-based staleness; fixed + quadrant-plurality resolution with tie/empty; countedStatuses filtering provably excludes; freezeMs hold; immutable snapshot enqueued before resolution
- verify: `pnpm --filter @smartphonecracy/server typecheck` → PASS; focused server suites (`src/admission/admission.test.ts`, `src/engine/phase-engine.test.ts`, `src/votes/vote-engine.test.ts`) → PASS (25 tests); `pnpm --filter protocol test` → PASS (30 tests); `pnpm --filter display test` → PASS (40 tests); `pnpm -r typecheck` → PASS (7 workspaces), 2026-07-12. Node 20.12.2 emitted the expected repo engine warning for >=22.
- reviewer: claude
- notes: Reclaimed by codex 2026-07-12 and fixed all three Fable findings: input refreshes heartbeat liveness; fixed transitions emit winner:"fixed" with real positional counts; dirty question-status updates flush at a fixed 250 ms cadence. Added regressions for liveness, fixed resolution, and throttling. STEP-027 protocol/display edits remain separately owned and uncommitted in the shared worktree; compatibility tests pass. Ready for Fable re-review; proceeding at risk pending claude review due confirmed quota outage. FYI for STEP-018: disconnected currently takes precedence over never-moved in statusOf. APPROVED by fable re-review 2026-07-12 (73dcf5c): all three findings fixed — input refreshes liveness, winner:'fixed' with real counts, question_status throttled to 4 Hz w/ dirty-flag + tick flush. Suite 156 tests green.

### STEP-009: Input pipeline + cursor tick loop
- status: done
- owner: codex
- tier: complex
- depends-on: STEP-006, STEP-007
- files: apps/server/src/cursors/**, apps/server/src/engine/phase-engine.ts
- acceptance: input validation/clamping, latest-position store, fixed 20–30 Hz cursor batch tick to display, presence counts, ping/pong with serverTime
- verify: `pnpm --filter @smartphonecracy/server typecheck` → PASS; focused cursor/engine/admission suites → PASS (21 tests); `pnpm -r typecheck` → PASS (7 workspaces); full server suite → 31/32 PASS with only the pre-existing sandbox-blocked localhost WebSocket test (`listen EPERM 127.0.0.1`), 2026-07-12.
- reviewer: claude
- notes: Added defensive finite input validation/clamping, monotonic per-client sequence filtering, latest-position storage, full cursor batches at a fixed 25 Hz, membership-driven presence updates, immediate display presence sync, and replacement-safe participant cleanup. Existing admission parser/ping path supplies validated ping/pong with echoClientTime and serverTime. Ready for claude review; proceeding at risk pending claude review due confirmed quota outage. STEP-027 protocol/display edits remain separately owned and preserved.
  APPROVED by claude review lane (sonnet) 2026-07-12: verified `pnpm --filter @smartphonecracy/server typecheck` and `pnpm --filter @smartphonecracy/server test` (55/55 tests, 10 suites, Node 22) both PASS on committed HEAD (7c5c1db). Confirmed input clamped to [0,1] via `clamp()` in cursor-pipeline.ts with per-client monotonic seq gating (`seq <= lastSeq` rejected) plus finite-number validation; latest-position-only store (no per-input forwarding — CursorPipeline.recordInput only mutates a Map, never sends); cursor batches emitted via a dedicated 40 ms (25 Hz, within 20-30 Hz band) setInterval in CursorPipeline.start()/stop(), routed only to `sendToDisplay` (never broadcast to phones); presence counts broadcast to all clients on join/leave membership changes only. Timer lifecycle is sound: CursorPipeline.start()/stop() are called 1:1 from PhaseEngine.start()/stop(), which are themselves called exactly once each from apps/server/src/server.ts (boot/shutdown) — no leak across engine instances, and CursorPipeline.stop() is idempotent (guards on `timer !== null`) even if start() was never called. Stale-epoch input rejection is enforced one layer up: `handleClientMessage`'s "input" case gates on `this.matches(message.sessionId, this.phaseId, message.phaseEpoch)` (full session+phase+epoch tuple) before reaching `cursors.recordInput`, in addition to the pipeline's own per-client seq monotonicity. Ping/pong (admission/controller.ts) still echoes `echoClientTime` + returns `serverTime`, unchanged and correct. No blocking findings.

### STEP-010: QR grant push loop
- status: done
- owner: codex
- tier: simple
- depends-on: STEP-006, STEP-007
- files: apps/server/src/admission/qr.ts, apps/server/src/admission/qr.test.ts, apps/server/src/admission/index.ts, apps/server/src/engine/phase-engine.ts, apps/server/src/engine/phase-engine.test.ts, apps/server/src/server.ts
- acceptance: qr_grant on display_join / qr_grant_request / every 60 s; large vs corner placement by phase; qr_hidden when admission closed; allowLateJoin=false ⇒ hidden after lobby
- verify: `pnpm --filter @smartphonecracy/server exec vitest run src/admission/qr.test.ts src/engine/phase-engine.test.ts` → PASS (15 tests); `pnpm --filter @smartphonecracy/server typecheck` → PASS; `pnpm -r typecheck` → PASS (7 workspaces); full server suite → 36/37 PASS with only the pre-existing sandbox-blocked localhost WebSocket test (`listen EPERM 127.0.0.1`), 2026-07-12.
- reviewer: none
- notes: Added a QR grant push loop with signed URL construction, 60-second rotation while a display is connected, large idle/lobby and corner active placement, and active-policy hiding. Authenticated display join, refresh requests, and lifecycle transitions now push current QR state; unauthenticated refresh requests are ignored. Discovered QR delivery required PhaseEngine/server integration and expanded the reservation after coordinating that STEP-011 was unclaimed.

### STEP-011: Video phase handling
- status: done
- owner: codex
- tier: complex
- depends-on: STEP-007
- files: apps/server/src/engine/video.ts, apps/server/src/engine/video.test.ts, apps/server/src/engine/phase-engine.ts, apps/server/src/engine/phase-engine.test.ts
- acceptance: video_ended accepted only from authenticated display with matching phase+epoch; expectedDurationMs+5 s fallback; idempotent (late video_ended cannot double-advance)
- verify: `pnpm --filter @smartphonecracy/server exec vitest run src/engine/video.test.ts src/engine/phase-engine.test.ts` → PASS (16 tests); `pnpm --filter @smartphonecracy/server typecheck` → PASS; full server suite → 41/42 PASS with only the pre-existing sandbox-blocked localhost WebSocket test (`listen EPERM 127.0.0.1`), 2026-07-12.
- reviewer: claude
- notes: Added a one-shot video-phase handler shared by authenticated display completion and the expectedDurationMs+5 s fallback, with stale identity rejection and cancellation on every phase transition. Engine tests cover unauthenticated rejection, matching phase/epoch, late-event idempotency, and the exact fallback boundary. Discovered integration overlap coordinated with the codex root: phase-engine.ts and focused engine tests were no longer actively reserved (STEP-008/009 review, STEP-010 done), so the STEP-011 reservation was expanded before editing them. Ready for claude review; proceeding at risk pending claude review due confirmed quota outage.
  APPROVED by claude review lane (sonnet) 2026-07-12: verified `pnpm --filter @smartphonecracy/server typecheck` and `pnpm --filter @smartphonecracy/server test` (55/55 tests, 10 suites, Node 22) both PASS on committed HEAD (7e3c095). VideoPhaseHandler (video.ts) is a clean one-shot slot: `begin()` sets `active`+`fallbackAt=now+expectedDurationMs+5000`; `complete(identity)` and `consumeFallback(now)` both require a full sessionId+phaseId+phaseEpoch match against the single tracked `active` record and consume it (set to null) on success, so only one of the two paths can ever fire per phase entry. `completeVideo()` in phase-engine.ts layers two more independent checks before delegating: `currentPhase().kind === "video"` and `this.matches(sessionId, phaseId, phaseEpoch)` against live engine state; `video_ended` is additionally gated on `socket === this.displaySocket`, which is only ever set via an authenticated `display_join` (installationId/roomId/displayToken checked). `enterPhase()` unconditionally calls `video.cancel()` before every transition (including all `abortToIdle` paths), so a stale `active` can never survive into a new phase. Mentally constructed both double-advance sequences and traced them through the code: (1) video_ended-then-late-timeout — `complete()` nulls `active` and advances the phase; the next `tick()` finds `currentPhase().kind !== "video"` (guarded at line ~284) so `consumeFallback` is never even called — structurally impossible to double-fire. (2) timeout-then-late-video_ended — `consumeFallback` nulls `active` and advances the phase; the late `completeVideo` call then fails at the first `currentPhase().kind !== "video"` check (or, for back-to-back video phases, at the `matches()` tuple check against the new phaseId+epoch) — verified this exact scenario is also unit-tested directly (phase-engine.test.ts "advances video at expected duration plus five seconds when no event arrives", asserting `completeVideo` returns `{ok:false, reason:"wrong-phase"}` after fallback and a further `tick()` does not re-advance). The reverse scenario (duplicate video_ended after a real one) is covered by the "accepts video_ended only from the authenticated display and cannot double-advance" test. Fallback grace period verified as exactly +5000 ms (VIDEO_FALLBACK_GRACE_MS) via both the unit test and an engine-level deadlineAt assertion (100 ms expectedDurationMs + 5000 ms = 5100 ms after phase entry). No blocking findings.

### STEP-012: Server integration tests over fake scenario
- status: done
- owner: codex
- tier: complex
- depends-on: STEP-004, STEP-006, STEP-007, STEP-008, STEP-009, STEP-010, STEP-011
- files: apps/server/test/integration/**
- acceptance: Phase 2 exit criteria — automated tests drive the entire fake scenario without a browser (join→lobby→video→questions→resolution→idle, incl. late join, disconnects, solo-abandon, recovery)
- verify: focused integration suite → PASS (3 tests); `pnpm --filter @smartphonecracy/server typecheck` → PASS; `pnpm -r typecheck` → PASS (7 workspaces); full server suite → 45/46 PASS with only the pre-existing sandbox-blocked localhost WebSocket test (`listen EPERM 127.0.0.1`), 2026-07-12.
- reviewer: claude
- notes: Added deterministic browserless integration coverage through the real admission parser/controller and PhaseEngine against content/scenarios/dev.json. Tests cover the complete join→lobby→video→fixed question→quadrant question→idle flow, late join snapshots, disconnect participation, solo-abandon grace, and crash recovery checkpoints. No production integration fixes were needed. Ready for claude review; proceeding at risk pending claude review due confirmed quota outage.
  APPROVED by claude review lane (sonnet) 2026-07-12: re-verified `pnpm --filter @smartphonecracy/server typecheck` PASS and `pnpm --filter @smartphonecracy/server test` PASS (58 tests / 10 files incl. the 3 integration tests; no localhost EPERM in this sandbox). Traced that the harness wires the REAL AdmissionController + PhaseEngine with the same callback wiring as production server.ts (onClientMessage/onParticipantJoin/onSocketClosed); only the ws transport is faked, so real parseClientMessage + verifyJoinGrant/lease verification run. Full traversal covers both resolution types with non-tautological assertions (fixed: winner:"fixed" + resolvedTarget; quadrant: voter at (0.8,0.2) independently confirmed as q1 via shared quadrantOf) plus checkpoint reasons; late join asserts a real mid-question snapshot message; disconnect assertion via registry.connectedCount was confirmed meaningful (reflects live socket state synchronously, independent of disconnectGraceMs); solo-abandon tests the exact noParticipantGraceMs boundary (active at grace-1, idle at grace); crash recovery asserts the recovery+transition checkpoint sequence through the real recoverAfterCrash(). Fully deterministic: injected now closure + manual tick(), engine.start() never called, no real timers. Non-blocking observation for a future step: recoverAfterCrash() has no production caller — boot never reads persisted checkpoints to write a boot-time recovery event (deferred per STEP-011 review note; STEP-018 doesn't wire boot either); worth folding into the deployment/boot wiring work (STEP-021/024) alongside STEP-018's noted persistence boot wiring.

### STEP-013: Display client core
- status: done
- owner: claude
- tier: complex
- depends-on: STEP-002, STEP-004
- files: apps/display/**
- acceptance: three layers (§9); phase renderer from snapshots; server-time-corrected countdowns; reconnect w/ backoff + snapshot re-request; build-version reload handling; kiosk basics (hidden cursor, no context menu, wake lock attempt)
- verify: `pnpm --filter display test` → PASS (11 tests); `pnpm --filter display typecheck` → PASS; `pnpm --filter display build` → PASS (2026-07-12). Playwright smoke explicitly accepted as deferred to STEP-023 because no e2e harness exists yet.
- reviewer: codex
- notes: APPROVED by codex 2026-07-12. Reviewed reconnect/backoff ownership, display_join and ping/pong clock correction, median-offset ServerClock, per-session epoch guard semantics, reload flow, and kiosk guards. The three-layer renderer is appropriately scoped; plain media and minimal question rendering remain deferred to STEP-014/015. Playwright smoke is explicitly accepted as deferred to STEP-023, which owns the future e2e harness.

### STEP-014: Display media pipeline
- status: done
- owner: claude
- tier: complex
- depends-on: STEP-013
- files: apps/display/src/media/**
- acceptance: manifest fetch + byte/hash verify before ready; Cache Storage by content hash; Blob URLs only for active/next videos w/ revocation; visible retry state on failure; app-shell-only service worker; preload next during questions
- verify: pnpm --filter display test → PASS (18 tests incl. 7 media) + typecheck + vite build PASS (2026-07-12). Playwright media suite deferred to STEP-023 (accepted pattern).
- reviewer: codex
- notes: MediaStore (injectable caches/fetch/digest): boot sync keyed by content hash, byte+sha256 verify per download, stale-entry eviction, endless capped-backoff retry (never ready with missing media); Blob URLs memoized per src, retainOnly() revokes outside the active set; useMedia hook gates UI on ready + visible retry state; public/sw.js is app-shell only (never intercepts /media/), cache-first hashed assets, network-first HTML. Next-video preload wired but waits on STEP-026 (id→src map) — only the active video gets a Blob URL until then. FIXES 2026-07-12: cached entries now re-hashed at boot (corruption test added); showVideo race purges stray Blob URLs via retainOnly on stale resolve; pending video re-resolves when sync reaches ready; SW narrowed to /assets/ + navigations only. Back to review. FIX 2026-07-12b: stop() now revokes all live Blob URLs (test added). Back to review.
  CHANGES REQUESTED by codex review 2026-07-12: (1) `syncOnce()` trusts a cached response solely from its `content-length`; read and verify the cached body’s actual byte length and sha256 against the manifest before counting it as synced/allowing `ready`, with a same-size-corrupt-cache regression test. (2) Fix the `useMedia` race where a video phase arrives before media sync finishes: `showVideo()` can return null once and its phase-only effect never retries after `ready`; add a readiness-triggered retry/test. (3) If `getBlobUrl()` resolves after the phase changes, revoke/discard the newly created stale URL (and clean up on unmount/stop) so asynchronous phase changes cannot leak Blob URLs. (4) Narrow `sw.js` to actual app-shell HTML and `/assets/` requests; its current “everything else” network-first branch intercepts/caches non-shell GETs such as `/api` and the manifest, contrary to app-shell-only semantics. Keep next-video preloading explicitly deferred to STEP-026’s public id→src map dependency.
  Verification by codex: `pnpm --filter @smartphonecracy/display typecheck` PASS; `pnpm --filter @smartphonecracy/display test` PASS (18 tests, 2 files); `pnpm --filter @smartphonecracy/display build` PASS; `node --check apps/display/public/sw.js` PASS, 2026-07-12. Status remains `review` pending the requested fixes.
  CHANGES REQUESTED by codex re-review 2026-07-12: (1) Finding (3) is only partially fixed: `useMedia` now purges a stale async URL, but its effect cleanup calls `store.stop()` and `MediaStore.stop()` only sets `stopped`; it never revokes Blob URLs already held in `blobUrls`. Add stop/unmount cleanup (and a regression test) so a kiosk unmount/restart cannot leak active object URLs. (2) Re-review remains blocked until this is fixed.
  APPROVED by codex re-review 2026-07-12: `MediaStore.stop()` now calls `retainOnly(new Set())`, revoking every live Blob URL; the new regression test passes. Current committed HEAD verification: display tests PASS (40/40, including STEP-016 additions) and display typecheck PASS. The fix-era baseline was 28 tests; the higher current count is due to committed STEP-016 coverage.

### STEP-015: Display cursors + question rendering
- status: done
- owner: claude
- tier: complex
- depends-on: STEP-013
- files: apps/display/src/cursors/**, question UI
- acceptance: canvas cursor field w/ ~100 ms interpolation; axis cross + pinned quadrant labels; optional live counts (only when server sends them); join halo; freeze + winner/tie/empty highlight for freezeMs on corrected time
- verify: pnpm --filter display test → PASS (27 tests incl. 9 cursor/question) + typecheck + build PASS (2026-07-12). Playwright deferred to STEP-023 (accepted pattern).
- reviewer: codex
- notes: CursorField (pure): 100 ms render-delay interpolation between last two ticks, stale-tick rejection, absent-cursor removal, join-halo progress, freeze semantics (ingest ignored while frozen); CursorCanvas rAF w/ destination-out fade trails, crisp full-clear while frozen; QuadrantOverlay pins q1 TR/q2 TL/q3 BL/q4 BR, live counts only when server sends them, winner/tie/empty highlight; store: question_status/resolved gated to current session+epoch, cleared on phase advance; cursors bypass React (direct CursorField ingest). freezeUntil display-side hold ends when server advances phase (server owns freezeMs timing). FIX 2026-07-12: freeze now derives from the reducer's session/epoch-gated resolution state via effect (stale question_resolved can no longer freeze the field); onMessage freeze shortcut removed. Back to review.
  CHANGES REQUESTED by codex review 2026-07-12: `displayReducer` correctly gates `question_status`/`question_resolved`, but `App` calls `cursorField.setFrozen(true)` for every `question_resolved` before reducer validation. A delayed prior-session or prior-epoch resolution can therefore freeze the cursor field even though its question frame is rejected from UI state. Gate the freeze side effect using the current session+epoch (or route it through the same authoritative state transition), and add a stale-resolution regression test. Keep server-owned `freezeMs` semantics.
  Verification by codex: `pnpm --filter @smartphonecracy/display exec vitest run --reporter=verbose` PASS (27 tests / 3 files); `pnpm --filter @smartphonecracy/display typecheck` PASS; `pnpm --filter @smartphonecracy/display build` PASS, 2026-07-12. Status remains `review` pending the requested fix.
  APPROVED by codex re-review 2026-07-12: freeze now derives from reducer state whose resolution is gated by current session+epoch, and the pre-reducer `question_resolved` shortcut is deleted; stale resolutions therefore cannot freeze the field. Current committed HEAD verification: display tests PASS (40/40, including STEP-016 additions) and display typecheck PASS. The fix-era baseline was 28 tests; the higher current count is due to committed STEP-016 coverage.

### STEP-016: Display QR + heartbeat
- status: done
- owner: claude
- tier: simple
- depends-on: STEP-013
- files: apps/display/src/qr/**, heartbeat
- acceptance: renders latest qr_grant (large/corner), hides at expiresAt on corrected time; display_heartbeat loop; display_replaced notice handling
- verify: pnpm --filter @smartphonecracy/display typecheck && pnpm --filter @smartphonecracy/display test && pnpm --filter @smartphonecracy/display build → all PASS (40 tests incl. 12 new: 8 qr + 4 heartbeat) (2026-07-12)
- reviewer: none
- notes: QrBadge (src/components/QrBadge.tsx) renders the latest qr_grant via the `qrcode` npm package (added as a dependency; generated fully client-side, no network fetch — Vite resolves its `browser` package.json field, verified no Node-only APIs in the built bundle). Visibility is a pure `shouldShowGrant(grant, nowServerTime, qrHidden)` helper (src/qr/shouldShowGrant.ts) polled ~1x/s against connection.clock (corrected server time) plus reactive to qr_hidden; placement/sizing is a pure `placementClassName`/`qrSizePx` (src/qr/placement.ts) — server picks large (idle/lobby, centered) vs corner (small), the display's `corner` prop only picks which screen corner, default bottom-right. Heartbeat (src/lib/heartbeat.ts, `startHeartbeat`) sends display_heartbeat every 5s only while `isOpen()` is true, reading sessionId/phaseId/phaseEpoch fresh each tick via a getter backed by a React ref (never a stale closure), clientTime from an injectable `now`. Idle-session convention confirmed in apps/server/src/engine/phase-engine.ts: sessionId="idle" and phaseId="idle" are the literal placeholders the engine itself uses pre-session (phaseEpoch 0), matched exactly (IDLE_PLACEHOLDER="idle") for the pre-first-snapshot state, satisfying the protocol's nonEmpty-string schema and the server's `matches()` equality check. display_replaced already landed in state.notice (STEP-013); App.tsx now adds a `notice-prominent` class specifically for that code so it's visually distinct from routine notices. Note: App.tsx had a concurrent edit in flight from another lane (question_resolved freeze moved to a session/epoch-gated useEffect) when this step started; merged cleanly on top without reverting it.

### STEP-017: Phone client
- status: done
- owner: claude
- tier: complex
- depends-on: STEP-002
- files: apps/phone/**
- acceptance: QR join flow; expired-grant/room-full/rate-limited states; fullscreen relative trackpad (touch-action none, throttled 20–30 Hz); identity marker matching cursor; lease in localStorage; reconnect + identity restore; input ignored outside question phases; build-version mismatch reload handling (service-worker app-shell update + rejoin)
- verify: `pnpm --filter phone test` → PASS (11 tests); `pnpm --filter phone typecheck` → PASS; `pnpm --filter phone build` → PASS (2026-07-12). Playwright mobile emulation explicitly accepted as deferred to STEP-023 because no e2e harness exists yet.
- reviewer: codex
- notes: APPROVED by codex 2026-07-12. Reviewed installation-scoped lease persistence and private-mode fallback, `?g=` join/reconnect flow, rejection states, question-only input gating, per-session epoch guard, relative trackpad clamping, and 25 Hz throttle. Real iOS/Android sensitivity tuning remains a Phase 7 hardware pass. Playwright mobile emulation is explicitly accepted as deferred to STEP-023, which owns the future e2e harness.

### STEP-018: Persistence layer
- status: done
- owner: codex
- tier: complex
- depends-on: STEP-007, STEP-008
- files: infra/migrations/**, apps/server/src/persistence/**
- acceptance: §11 tables; write queue w/ retry buffer + shutdown flush; gameplay never blocks on DB; checkpoints on transitions; outcome_json completeness; recovery events; no raw movement traces; retention-policy fields AND testable retention-deletion behavior (participant-level records expire per §11 policy)
- verify: Fix verification 2026-07-12: `pnpm --filter @smartphonecracy/server typecheck` → PASS; `pnpm --filter @smartphonecracy/server exec vitest run src/persistence/persistence.test.ts src/engine/phase-engine.test.ts src/votes/vote-engine.test.ts` → PASS (29 tests); `git diff --check` → PASS. Original verification: focused persistence/engine/votes → PASS (26 tests); `pnpm -r typecheck` → PASS (7 workspaces).
- reviewer: claude
- notes: Fixes applied, ready for Fable re-review; status remains review. Finding A: the bounded queue now retries indefinitely with capped exponential backoff, emits degraded/recovered and overflow health events, and contains every background rejection. Finding B: the unbounded snapshots Map was removed; exports query and reconstruct persisted Postgres session-phase/vote records and therefore survive restart. Regression tests cover an outage beyond the former retry limit, backoff capping, recovery/overflow events, bounded buffering, and export from a fresh persistence instance. Original review findings retained for traceability: (A) drain rejected after maxRetries and could become unobserved; (B) exports depended on an unbounded restart-volatile snapshots Map. Privacy model remains approved; no IP columns, movement traces, grants, or leases are persisted. (Codex's three commit attempts failed on transient `.git/index.lock` contention; committed on codex's behalf by claude after independent verification.)
  APPROVED by fable re-review 2026-07-12: both blocking findings fixed and independently verified (typecheck PASS; persistence/engine/votes suites 29/29 PASS re-run by reviewer). Finding A: drain() no longer throws — indefinite retry with backoff capped at maxRetryDelayMs (5s default), bounded 10k-batch buffer with drop-newest + buffer-full event, degraded/recovered events at sustained-failure threshold, and a defensive catch in kick() so even a throwing injected sleep/health observer cannot produce an unobserved rejection; regression test asserts the exact capped delay sequence across an 8-failure outage. Finding B: snapshots Map deleted; exportSession reconstructs from sessions/session_phases/votes via the new executor query path — column names and phase_index/phaseEpoch symmetry verified against infra/migrations/001_persistence.sql and the insert statements (the unit test uses canned rows, so this schema check was done manually); returns null for unknown sessions; restart survival covered by fresh-instance test. Non-blocking FYIs for the deployment step (STEP-021/024): (1) flush() now awaits a drain that never gives up, so shutdown flush during a sustained DB outage hangs until the supervisor kills the process — acceptable vs crashing, but boot wiring should add a bounded shutdown-flush timeout; (2) onHealthEvent defaults to a no-op and no production code constructs the persistence stack yet (it is injected into buildServer; boot wiring is deferred) — when DATABASE_URL boot wiring lands, connect health events to logging/health_events; (3) buffer-full emits one event per dropped write, which could spam the observer under sustained overflow.

### STEP-019: Admin API + UI
- status: done
- owner: codex
- tier: complex
- depends-on: STEP-007, STEP-009, STEP-018
- files: apps/server/src/admin/**, apps/server/src/config.ts, apps/server/src/server.ts, apps/server/src/engine/phase-engine.ts, apps/server/src/persistence/**, apps/admin/**
- acceptance: §12 — status (health, heartbeat age, counts, session/phase), controls (start, idle, skip, restart), recent errors, CSV/JSON export; token-protected; audit-logged
- verify: Review-fix verification 2026-07-12: `pnpm --filter @smartphonecracy/server exec vitest run src/admin/admin.test.ts src/persistence/persistence.test.ts src/engine/phase-engine.test.ts` → PASS (28 tests); `pnpm --filter @smartphonecracy/server typecheck` → PASS; `git diff --check -- apps/server/src/engine/phase-engine.test.ts steps.md` → PASS. Original verification: focused server suites PASS (22 tests); admin test/build PASS; monorepo typecheck PASS; full server suite 54/55 with only sandbox-blocked localhost bind.
- reviewer: claude
- notes: Added strong bearer-token protection (production rejects the development token), operational health/display-heartbeat/count/session/phase status, safe start/idle/skip/restart engine controls, recent error capture, JSON/CSV session exports, durable admin-action/error audit writes, and a polling operations UI with controls and downloads. Reservation expanded before edits to config/server wiring, engine controls, and persistence seams; no active step reserved those files. Ready for claude review; proceeding at risk pending claude review due confirmed quota outage.
  CHANGES REQUESTED by claude review lane (sonnet) 2026-07-12. Re-verified: admin.test.ts (3), admin app test+build, server typecheck, `pnpm -r typecheck` (7 workspaces), full server suite (66/66) all PASS; `git diff --check` clean. Auth guard (onRequest hook registered before all /api/admin routes, timing-safe compare, export included), production ADMIN_TOKEN dev-token rejection (config.ts:72-74), export routing/CSV escaping/SQL parameterization, no-secrets-in-status, and non-blocking audit/error writes via the write queue all check out. BLOCKING: the actual `PhaseEngine.adminStart/Idle/Skip/Restart` methods (phase-engine.ts:168-198) have zero direct test coverage — admin.test.ts exercises only the HTTP layer against a fully mocked engine, and phase-engine.test.ts has no admin-control tests at all; this is exactly the skip-during-video/freeze, restart-mid-session risk area. Reviewer independently confirmed via throwaway (uncommitted) repros that (1) adminRestart mid-video is safe — enterPhase()'s unconditional video.cancel() prevents double-advance; (2) non-blocking quirk: a repeat adminSkip while a question is already frozen/resolved re-extends the freeze window (deadline pushed out) and re-broadcasts question_resolved — votes.finalize() is idempotent so no data corruption; consider guarding resolveQuestionAtDeadline when already frozen. Requested: direct PhaseEngine-level tests (skip during video, skip during position-question, restart mid-video, restart mid-frozen-question, idle/start from various lifecycle states) using the existing connectDisplay/addParticipant/manual-tick harness pattern.
  FIX APPLIED by codex 2026-07-12: added direct PhaseEngine regressions covering rejected start without prerequisites, idle from idle and active, start from lobby, repeated start rejection while active, skip during video and position-question, restart mid-video with stale completion rejection, and restart mid-frozen-question without the old freeze advancing the restarted phase. Ready for claude re-review.
  APPROVED on re-review by claude (fable, inline — scope was the requested test additions, 78 lines) 2026-07-12: every scenario from the blocking finding is covered — start/idle across lifecycle states incl. rejection paths and admin-idle checkpoint reason, skip during video, skip during a live position-question (resolves with freezeUntil), restart mid-video with stale-epoch video_ended rejection, restart mid-frozen-question with an explicit no-double-advance tick assertion at the old freezeUntil, and admin-restart checkpoint reason. Independently verified: focused phase-engine+admin suites 18/18 PASS, full server suite 68/68 PASS, server typecheck PASS. The optional resolveQuestionAtDeadline repeat-skip guard was not added (it was a "consider", non-blocking) — carried on the follow-up cleanup list. Step done. Test file committed on codex's behalf by claude (codex sandbox git contention).

### STEP-020: simulate-clients load script
- status: done
- owner: codex
- tier: simple
- depends-on: STEP-002, STEP-006, STEP-009
- files: scripts/simulate-clients.ts, tests/load/**, package.json
- acceptance: 30 simulated phones join, move at 20–30 Hz, disconnect/reconnect; reports latency + drop stats
- verify: `pnpm exec vitest run tests/load/simulate-clients.test.ts` → PASS (3 tests); standalone script TypeScript check → PASS; live `pnpm simulate-clients --count 30` against local server → PASS: 30 clients, 14,520/14,520 inputs sent (0 drops), 15 successful lease reconnects, 0 rejections, 245 cursor ticks, 2,070 latency samples (p50 3 ms, p95 7 ms, max 12 ms), 2026-07-12.
- reviewer: none
- notes: Added a Node WebSocket load harness that acquires a real signed grant through the display protocol, joins up to 30 phones, advances video phases, moves at 25 Hz during questions, pings for RTT samples, and reconnects half the clients using leases. The default 70-second profile respects the server's 30 joins/minute per-IP abuse limit before reconnecting. Reports input send/drop, join rejection, reconnect, cursor tick, and latency percentile statistics. Self-verified; reviewer none.

### STEP-021: Deployment + CI
- status: done
- owner: codex
- tier: complex
- depends-on: STEP-012, STEP-016, STEP-017, STEP-019
- files: Dockerfile, infra/fly.toml, CI workflow
- acceptance: versioned container serving all bundles (display/phone/admin); fly.toml (min_machines_running=1, health checks); CI runs tests + scenario validation + build; manual production deploy gate + deploy-window check; rollback instructions
- verify: `pnpm -r typecheck` → PASS (7 workspaces); `pnpm -r test` → 158/159 PASS, with only the known sandbox-blocked localhost WebSocket test (`listen EPERM 127.0.0.1`); `node --import tsx scripts/validate-scenario.ts content/scenarios/dev.json` → PASS (`OK: scenario valid`; the equivalent `pnpm validate-scenario` command could not create tsx's IPC pipe in this sandbox); production builds for display, phone, and admin → PASS; Ruby Psych parse of both CI workflow YAML files → PASS; `git diff --check` → PASS; Docker CLI unavailable (`command not found`), so the container image was NOT built; flyctl unavailable, so `fly config validate`/deployment were NOT run; GitHub CI was NOT run locally, 2026-07-12.
- reviewer: claude
- notes: provisioning/secrets moved to STEP-024. Split from venue hardening per codex review. Started by user direction while STEP-019's claude review was in flight; any STEP-019 review-triggered fixes take priority over finishing STEP-021. Added a SHA-versioned multi-stage Node container that builds and serves all three bundles, always-on Fly configuration with liveness/readiness checks, automatic verification/image-build CI, protected manual production deployment with an explicit closed-venue window confirmation, and rollback documentation. Hadolint-style self-review confirmed pinned Node/pnpm versions, non-root runtime, exec-form CMD, immutable build-version injection, and no baked secrets. (Committed on codex's behalf by claude at 16b3348 — codex sandbox cannot create .git/index.lock.)
  CHANGES REQUESTED by claude review lane (sonnet) 2026-07-12. Re-verified independently: `pnpm -r typecheck` PASS (7 workspaces); `pnpm -r test` PASS 159/159 (no EPERM in that sandbox); all three bundle builds PASS; `pnpm install --frozen-lockfile` clean (Dockerfile install step will succeed); both workflow YAMLs parse; `git diff --check` clean. Docker/flyctl unavailable there too, so the image was still never built — accepted gap, but every Dockerfile step was exercised manually outside Docker and reproduces. Traced clean: config.ts repoRoot→/app layout matches image COPY layout so bundleDirs/content resolve (readiness true out of the box); PORT/EXPOSE/internal_port agree (3000); NODE_ENV=production only in the runtime stage; non-root uid 10001; auto_stop_machines="stop" + min_machines_running=1 is Fly's documented always-on floor pattern; CI runs the documented sequence with pinned Node/pnpm matching engines; deploy workflow gates on workflow_dispatch + deploy_window_confirmed + environment:production + non-cancelling concurrency; secrets only via GitHub secrets. BLOCKING: docs/deployment.md step 3 uses `fly releases rollback <version>` — flyctl no longer documents any such subcommand (checked fly.io/docs/flyctl/releases and the Fly rollback blueprint, which states there is no rollback command); on the Machines platform the executable path is `fly releases --app <app> --image` to find the prior tag, then `fly deploy --image registry.fly.io/<app>:<version>`; venue staff following this doc verbatim during an incident would hit a dead end. Fix and re-request review (expected quick approve). Non-blocking for STEP-024's checklist: config.ts rejects the default ADMIN_TOKEN in production but NOT default JOIN_GRANT_SECRET/DISPLAY_TOKEN (forgeable grants if secrets unset); optional flyctl-actions version pin; Dockerfile COPY-before-install invalidates the install layer cache on any source change (efficiency only).
  FIX APPLIED by codex 2026-07-12: rollback now follows Fly's current official procedure (`fly releases --app <app> --image`, then `fly deploy --app <app> --image <exact-registry-image>`), explicitly notes that no rollback subcommand exists, and warns that image rollback does not revert database schema, secrets, or fly.toml. `git diff --check` PASS and obsolete-command grep is clean. Ready for claude re-review; proceeding at risk pending the confirmed quota outage.
  APPROVED on re-review by claude (fable, inline — scope was a single doc fix) 2026-07-12: docs/deployment.md rollback steps now match the exact procedure requested in the original finding (`fly releases --app <app> --image` → `fly deploy --app <app> --image registry.fly.io/<app>:<tag>`), state that no rollback subcommand exists, and warn that image rollback does not revert schema/secrets/fly.toml. Verified `grep -rn "releases rollback" docs/ infra/ .github/` is clean and that step 4's verification target is real (`/api/status` exposes `buildVersion` at apps/server/src/server.ts:74). Non-blocking notes from the original review (JOIN_GRANT_SECRET/DISPLAY_TOKEN production defaults, flyctl-actions pin, Dockerfile layer caching) remain carried on STEP-024's checklist.

### STEP-022: Operations + venue docs
- status: done
- owner: codex
- tier: simple
- depends-on: STEP-021
- files: docs/operations.md, docs/venue-installation.md
- acceptance: §13 venue checklist (kiosk flags, watchdog, BIOS, VPN), staff power-cycle procedure, monitoring/alert list (§14), handoff package checklist (§18)
- verify: acceptance-topic review + local-link existence checks → PASS; `git diff --check -- docs/operations.md docs/venue-installation.md steps.md` → PASS, 2026-07-12
- reviewer: codex
- notes: Added an operator runbook with daily opening checks, no-SSH staff power-cycle recovery, incident classification, §14 monitoring/alert coverage, privacy-safe logging guidance, and the §18 handoff checklist. Added the venue guide covering the §13 hardware baseline, kiosk/autoplay/watchdog contract, BIOS power recovery, sleep/blanking controls, wired network/UPS, private VPN, asset records, and an evidence-based venue acceptance checklist including exact-machine soak tests. Self-reviewed as a simple step.

### STEP-023: E2E + reliability test suite
- status: done
- owner: claude
- tier: complex
- depends-on: STEP-012, STEP-013, STEP-014, STEP-015, STEP-016, STEP-017, STEP-018, STEP-028, STEP-029
- files: tests/e2e/**, package.json (test:e2e script + playwright devDependency only), pnpm-workspace/lockfile as needed
- acceptance: Playwright coverage of §16 automatable acceptance tests (server-kill, display-kill, stale-bundle reload, clock offset, second display, media failure retry); soak/venue tests documented as manual Phase 7 items
- verify: `pnpm test:e2e` → PASS 9/9 (1.7m; builds all three bundles then runs Playwright serial against real spawned server processes), 2026-07-12, after STEP-034's fix landed. Suite: full flow (both question kinds to idle), expired grant, server-kill recovery, display-kill abort→idle→replacement display, second-display replacement notice, stale-bundle reload chain for display AND phone, +5 min clock-skew countdown correction, media corrupt→retry→restore→ready. Codex review rerun 2026-07-12: all three production bundle builds PASS; browser phase environment-blocked at spawned server bind (`listen EPERM 127.0.0.1`), consistent with the repo's known sandbox limitation; implementation/coverage inspection PASS and the recorded unrestricted 9/9 run accepted.
- reviewer: cross (both)
- notes: Claimed by claude 2026-07-12 (all dependencies done as of 9dadd97/89a7531; greedy queue). Reservation: tests/e2e/** plus root package.json script/devDependency wiring for the documented verify command — no edits to apps/* or packages/* except via a new step if e2e surfaces defects.
  IMPLEMENTED 2026-07-12, ready for codex review (committed c745d33). Harness notes: (a) tests spawn their own server processes per test (they must kill/restart them), serial by design, no Playwright webServer; (b) servers are pinned BUILD_VERSION=0.0.0-dev to match the vite __BUILD_VERSION__ fallback baked into the bundles — otherwise every join trips the STEP-031 reload path; the stale-bundle specs override this deliberately and count page loads (≥3 proves reload→reconnect→reload since the bundle stays stale in-harness); (c) media-retry corrupts the media file on disk AFTER boot (readiness hashes only at boot) in a copied temp MEDIA_DIR, asserts the explicit "retrying" wording (bare .media-status also matches benign first-sync progress), then restores bytes and expects self-recovery; (d) tests/e2e/package.json ({type:module}, outside workspace globs) is required for Playwright to load the ESM helpers; (e) manual Phase 7 soak/venue items documented in tests/e2e/README.md per acceptance. DEFECT DISCOVERED AND SPLIT OUT: media-retry initially could never recover — one corrupt /media response was cached by the browser HTTP cache (immutable headers from STEP-029) and poisoned every retry; fixed as STEP-034 (MediaStore cache:"no-store"), on which the media-retry spec now depends.
  APPROVED by codex cross-review 2026-07-12: the nine specs cover the automatable §16 reliability matrix against real server processes and built display/phone bundles; the fixture shortens durations without weakening transition paths; stale-version reloads exercise both clients; media corruption proves visible retry and autonomous recovery; and manual exact-hardware/48-hour/alert drills are correctly deferred to STEP-025. No blocking findings.

### STEP-024: Venue hardening, monitoring, provisioning
- status: blocked
- owner: codex
- tier: complex
- depends-on: STEP-021
- files: infra/**, scripts/kiosk/**, docs snippets
- acceptance: Fly/Supabase/CDN/domain provisioning (needs user credentials — flag when reached); secrets in host secret manager; kiosk watchdog script + boot config; monitoring + §14 alert set (server, display heartbeat, venue domains); alert on media-retry >2 min, abort frequency, memory/restart spikes
- verify: `bash -n scripts/kiosk/launch-kiosk.sh && git diff --check` → PASS (2026-07-12); kiosk/alert configuration presence audit → PASS; live alert drills → BLOCKED pending production access and venue machine
- reviewer: claude
- notes: Repository-side work completed by codex 2026-07-12: added a single-instance, network-gated Chromium launcher; bounded systemd watchdog/boot unit and environment template; credential-safe Fly/Supabase/CDN/domain checklist; full §14 alert inventory and staged-drill record; and operator/venue documentation links. BLOCKER: live provisioning and the acceptance drill require user-provided Fly organisation/app/deploy access, paid Supabase project/credential and backup policy, object-storage/CDN and DNS access, production domains/URLs, alert destinations/owners, opening hours/timezone, director-approved abort threshold, soak-derived memory/restart baseline, and access to the production venue mini PC. Unblocks when an authorized operator supplies those values/access and schedules a closed-venue drill. No secrets or external resources were changed.

### STEP-025: Launch gate — reliability, soak, handoff
- status: todo
- owner: —
- tier: complex
- depends-on: STEP-000, STEP-020, STEP-023, STEP-024
- files: docs/**, tests/load/**
- acceptance: §16 acceptance list green: 30-client load test, server-kill/display-kill drills, stale-bundle reload, 48 h soak on the exact production mini PC with production media, venue acceptance test, approved privacy/visitor-notice package present, production content lock, §18 handoff package delivered
- verify: acceptance checklist signed off
- reviewer: cross (both)
- notes: largely manual/on-hardware; blocked until STEP-000 deliverables exist.

### STEP-026: Public video phase map API
- status: done
- owner: codex
- tier: simple
- depends-on: STEP-005
- files: apps/server/** (public phases API route)
- acceptance: `GET /api/phases` returns a sanitized public map of video phase IDs to media `src` values for display preloading, without exposing private configuration or scenario internals
- verify: `pnpm --filter @smartphonecracy/server exec vitest run src/server.test.ts -t "public video phase|invalid scenario"` → PASS (2 tests; 3 unrelated skipped); `pnpm --filter @smartphonecracy/server typecheck` → PASS, 2026-07-12. Node 20.12.2 emitted the expected repo engine warning for >=22.
- reviewer: none
- notes: Added `GET /api/phases` as an exact video phase ID→media src map; no durations, graph edges, scenario metadata, secrets, or non-video phases are exposed. Invalid scenario readiness fails closed with 503 `scenario_unavailable`. Self-verified as a simple step.

### STEP-027: winner:"fixed" protocol + display support
- status: done
- owner: claude
- tier: simple
- depends-on: STEP-002
- files: packages/protocol/src/messages.ts, apps/display/src/components/QuadrantOverlay.tsx (+tests)
- acceptance: question_resolved winner enum gains "fixed"; display renders no winner/empty highlight and no outcome state for winner:"fixed" (counts still shown if present); discovered during STEP-008 fable review
- verify: pnpm --filter protocol test → PASS (30) + pnpm --filter display test → PASS (40) + typechecks + display build PASS (2026-07-12)
- reviewer: none
- notes: unblocks STEP-008 finding (2). Commit was delayed: the original commit attempt ran from a wrong working directory during the claude-lane wind-down and silently failed; code was verified green before that. Committed during handoff cleanup.

### STEP-028: Client bundle base-path integration
- status: done
- owner: claude
- tier: simple
- depends-on: STEP-013, STEP-017
- files: apps/display/vite.config.ts, apps/display/public/sw.js, apps/display/src/** (sw registration only), apps/phone/vite.config.ts, apps/admin/vite.config.ts (+ focused tests)
- acceptance: built display/phone/admin bundles load when served by the server under /display/, /phone/, /admin/ — index.html asset URLs resolve (vite base per app), display sw.js registration + asset caching scoped to the mounted path; verified by fetching each built index.html's script/asset URLs through buildServer
- verify: all three `pnpm --filter @smartphonecracy/<app> build` → PASS emitting /<role>/assets/* URLs; `node --check apps/display/public/sw.js` → PASS; through-server check (buildServer + fastify inject, no listen needed): GET /display/, /phone/, /admin/ each 200 text/html, each index.html's script src 200 text/javascript, /display/sw.js 200 text/javascript → 7/7 PASS; display typecheck+test (40), phone (11), admin (1) all PASS, 2026-07-12.
- reviewer: codex
- notes: DISCOVERED during STEP-023 harness work 2026-07-12: all three vite configs omit `base`, so built index.html references root-absolute /assets/* which registerBundleRoutes never serves (bundles are mounted at /<role>/*) — every client 404s its own JS in production serving. Display sw.js additionally caches /assets/ and registers at root scope. Claimed by claude (owner slice); STEP-023 e2e depends on this to boot real bundles. Also affects STEP-021's "container serving all bundles" acceptance — its CI/container work is unaffected but a browser-level check would fail until this lands.
  IMPLEMENTED 2026-07-12: vite `base` set per app (/display/, /phone/, /admin/); display sw registration now uses import.meta.env.BASE_URL (sw served at /display/sw.js, scoping it to the mount); sw.js asset caching derives ASSETS_PREFIX from self.location instead of hardcoding /assets/ (navigations + same-origin guard unchanged, /media and /api still never intercepted). No committed test file: the through-server fetch check ran as a standalone buildServer+inject script (results in verify line); STEP-023's e2e will encode it durably. Ready for codex review.
  APPROVED by codex 2026-07-12 (commit b118964). Independent review rebuilt all three bundles and confirmed emitted script URLs under `/display/assets/`, `/phone/assets/`, and `/admin/assets/`; built display JS registers `/display/sw.js`; `node --check apps/display/dist/sw.js` PASS. Display/phone/admin typecheck+test PASS (40/11/1 tests). Fetch-handler trace confirms `/display/assets/` cache-first, navigations network-first, same-origin GET guard intact, and root `/media` + `/api` outside the `/display/` SW scope and not otherwise intercepted. Repo grep found no executable root-absolute `/assets/` or `/sw.js` references (only historical notes/comments). An additional reviewer-side buildServer injection attempt was environment-blocked by tsx IPC `listen EPERM`; the owner's recorded 7/7 injection check covers that acceptance path and static route inspection agrees.

### STEP-029: Server media + manifest HTTP routes
- status: done
- owner: codex
- tier: simple
- depends-on: STEP-005
- files: apps/server/src/static.ts or server.ts (media routes), apps/server/src/server.test.ts
- acceptance: GET /media-manifest.json serves the configured manifest; GET /media/<src> serves files from config.mediaDir (path-traversal-safe, correct content-type incl. .mp4, cache headers suited to hash-verified immutable media); 404 on unknown src; readiness unaffected
- verify: `pnpm --filter @smartphonecracy/server typecheck` → PASS; `pnpm --filter @smartphonecracy/server exec vitest run src/server.test.ts -t 'configuration|HTTP readiness and bundles'` → PASS (5 tests, 1 unrelated WebSocket test skipped); full `src/server.test.ts` attempt → 5/6 PASS, with only the pre-existing real-localhost WebSocket test sandbox-blocked by `listen EPERM: operation not permitted 127.0.0.1`; `git diff --check` → PASS (2026-07-12)
- reviewer: none
- notes: Completed and self-verified by codex 2026-07-12. Added configured manifest and media routes, root-containment traversal rejection, MP4 typing, immutable media caching, missing-media 404s, and readiness regression coverage. Committed on codex's behalf by claude at d962d16 after sanity review. DISCOVERED during STEP-023 harness work 2026-07-12: display useMedia fetches /media-manifest.json and MediaStore fetches /media/<src>, but the server exposes neither route (readiness validates them on disk only) — media sync can never reach ready against the real server. Production may later swap media origin to object storage/CDN per plan §13 (STEP-024 provisioning concern); these routes are the dev/e2e/venue-local serving path. Codex slice (server core).

### STEP-030: Clients send buildVersion in join messages
- status: done
- owner: claude
- tier: simple
- depends-on: STEP-002, STEP-013, STEP-017
- files: apps/display/vite.config.ts, apps/phone/vite.config.ts (scope shrank on investigation — see notes)
- acceptance: plan §7 — join and display_join schemas gain a required buildVersion string; display and phone send their build version (injected at build time, "dev" fallback) in every join; protocol tests cover the new field; server compilation unaffected (schema change is additive for the server until STEP-031 consumes it)
- verify: `BUILD_VERSION=e2e-test-marker-42 pnpm --filter @smartphonecracy/<display|phone> build` → marker present in both dist bundles (grep 1 hit each); rebuild without env → "0.0.0-dev" fallback present in both; display+phone typecheck PASS; display test 40/40, phone test 11/11 PASS, 2026-07-12.
- reviewer: codex
- notes: DISCOVERED during STEP-023 harness work 2026-07-12: protocol has the `reload` envelope and both clients honor it (display kiosk.ts performReload, phone reloadRequired effect), but nothing can ever trigger it — join/display_join carry no buildVersion, and the server never checks or emits reload. Plan §7 requires the check "on every join and display_join". Split: this step (protocol+clients, claude slice) then STEP-031 (server check+emit, codex slice). STEP-023's stale-bundle-reload e2e depends on both. APPROVED by codex review 2026-07-12: implementation is correctly limited to Vite compile-time injection; both typechecks, display 40/40 tests, phone 11/11 tests, and marker-bearing production builds pass. Broke claude-fable's stale plan lock after the required 10-minute threshold; the lane is confirmed out of credits and process inspection was sandbox-blocked.
  SCOPE SHRANK on investigation 2026-07-12: the protocol schemas ALREADY carry a required `clientVersion` in join + display_join, and both clients already send `__BUILD_VERSION__` with a "0.0.0-dev" fallback — the only missing link was that no vite config ever defined `__BUILD_VERSION__`, so every bundle baked the fallback. Fixed by adding `define.__BUILD_VERSION__` from process.env.BUILD_VERSION to display+phone vite configs. No protocol or App changes needed. IMPORTANT for STEP-031: (a) compare against `clientVersion` (existing field name), not a new buildVersion field; (b) the Dockerfile sets ARG/ENV BUILD_VERSION only in the *runtime* stage — the build stage runs the vite builds without it, so container bundles would bake "0.0.0-dev" while the server reports the real version, causing a reload loop the moment the server starts enforcing; STEP-031 must add ARG BUILD_VERSION + ENV to the build stage (Dockerfile is codex's STEP-021 file, same owner). Ready for codex review.

### STEP-031: Server build-version check + reload emit
- status: done
- owner: codex
- tier: simple
- depends-on: STEP-030
- files: apps/server/src/admission/** (join/display_join handling), apps/server/src/config.ts if needed (+tests)
- acceptance: plan §7 — on every join and display_join the server compares the client buildVersion against config.buildVersion; on mismatch sends { t: "reload", v, minVersion, reason: "assets" } (and still admits or rejects per admission rules — reload is an instruction, not a close); tests cover match, mismatch, and missing-field (old client ⇒ reload) paths
- verify: `pnpm --filter @smartphonecracy/server typecheck` PASS; server tests 61/61 PASS (localhost-binding lifecycle test rerun with sandbox approval after expected EPERM); focused admission tests 10/10 PASS; `git diff --check` PASS, 2026-07-12.
- reviewer: none
- notes: Filed 2026-07-12 during STEP-023 harness work; see STEP-030 notes for the discovery. Codex slice. §16: "A stale cached phone or display bundle receives reload, updates its app shell, and reconnects." Completed and self-verified by codex 2026-07-12. Admission now checks both join message types before normal parsing, sends an assets reload on missing/mismatched clientVersion, and preserves ordinary handling for schema-valid stale clients. Docker build stage now receives BUILD_VERSION so client bundles and runtime cannot diverge into a reload loop.

### STEP-032: Persistence + recovery boot wiring
- status: done
- owner: codex
- tier: complex
- depends-on: STEP-018, STEP-021
- files: apps/server/src/index.ts, apps/server/src/config.ts (DATABASE_URL), apps/server/src/server.ts (health-event seam), infra docs snippet
- acceptance: when DATABASE_URL is set, boot constructs pg client → PostgresPersistenceExecutor → PersistenceWriteQueue (onHealthEvent wired to logs and, on sustained degradation, an operational error record) → InstallationPersistence, passes it into buildServer, runs migrations or asserts schema presence, writes the boot-time recovery event / recoverAfterCrash path (plan §6 crash recovery steps 3-4), and bounds shutdown flush with a timeout (STEP-018 re-review FYI 1); without DATABASE_URL the server runs exactly as today (dev mode, no persistence)
- verify: `pnpm --filter @smartphonecracy/server typecheck` PASS; full server suite 63/63 PASS (localhost binding approved); focused persistence/runtime/server suite 17/17 PASS; `git diff --check` PASS, 2026-07-12.
- reviewer: claude
- notes: Filed 2026-07-12: no production code constructs the persistence stack (it is injected in tests only), recoverAfterCrash() has no production caller (flagged in STEP-012 review), onHealthEvent defaults to a no-op (flagged in STEP-018 fable re-review), and shutdown flush needs a bound. Codex slice. Without this, the deployed container never persists sessions — §16 "Session outcomes are persisted" cannot hold. Proceeding at risk past STEP-021's pending claude review under the confirmed quota-outage rule. Completed by codex 2026-07-12, ready for claude review and proceeding at risk pending that review: DATABASE_URL boot now holds a pg client, applies the existing migration, constructs the executor/queue/persistence chain, persists fixed closing-date+90-day retention, durably ends active pre-crash sessions with recovery events before listen, logs and persists degradation/recovery health events, and bounds shutdown flush. Database-free boot remains unchanged. Added pg runtime/types and focused fake-pool coverage; no live Supabase connection or provisioning was attempted (STEP-024 scope).
  APPROVED by claude review lane (sonnet) 2026-07-12, reviewed together with STEP-033 — full verdict, verification results, and non-blocking follow-ups recorded in STEP-033's notes.

### STEP-033: Persistence shutdown cancellation + failed-listen cleanup
- status: done
- owner: codex
- tier: complex
- depends-on: STEP-032
- files: apps/server/src/persistence/**, apps/server/src/index.ts, apps/server/src/server.ts (+tests)
- acceptance: a shutdown flush timeout stops the persistence queue's retry loop before releasing/closing the pg client, leaves no retry timer keeping the process alive, and reports abandoned/uncertain buffered writes; if app.listen fails after buildServer starts engine/WebSocket resources, startup closes the app before closing persistence; regression tests cover permanent executor failure, no retries after cancellation, bounded completion, and failed-listen cleanup
- verify: `pnpm --filter @smartphonecracy/server typecheck` PASS; focused persistence/runtime/server suite 20/20 PASS with localhost binding approved; full server suite 66/66 PASS before the final review-only lifecycle hardening (affected focused suites rerun after); `git diff --check` PASS, 2026-07-12.
- reviewer: claude
- notes: Filed from codex read-only audit 2026-07-12 while STEP-032 awaits claude review. Review priority: the existing Promise.race only bounds the caller while drain() retries forever, and the listen-failure catch closes persistence without closing the already-started app/engine. Proceeding at risk pending claude review due confirmed quota outage. Completed by codex 2026-07-12 and independently re-reviewed by a high-complexity sub-agent: queue shutdown is cached/idempotent, wakes and removes retry timers/listeners, abandons pending batches with explicit uncertain-loss telemetry, rejects post-stop enqueues visibly, and stops even when flush fails; runtime close is idempotent and destroys the held pg client. Listen failure closes app then persistence and preserves cleanup errors; signal handlers are installed only after listen and contain shutdown rejections. Ready for claude review. UNCOMMITTED — needs commit: the verified commit attempt was rejected because the Codex approval/usage limit was reached; working tree preserved per protocol.
  APPROVED by claude review lane (sonnet) 2026-07-12, STEP-032 and STEP-033 reviewed together (033 amends 032's shutdown/listen-failure paths in the same files). Verified independently: server typecheck PASS; focused persistence/runtime/server suite 20/20 PASS; full server suite 66/66 PASS (no sandbox EPERM); `pnpm -r typecheck` PASS 7/7; `git diff --check` clean. Confirmed via pg's own source (pg-pool _release/_remove → Client.end(), which force-destroys the socket on an active query) that runtime.close()'s client.release(true) safely unblocks any write in flight when shutdown times out — no lost-acknowledgment lies, no orphaned retry timers (dedicated fake-timer test proves timer count hits 0 post-shutdown). Boot ordering traced: DB-level recovery (persistence.recoverAfterCrash) completes before buildServer/listen; listen failure now closes app before persistence (the exact bug STEP-033 was filed to fix). All three STEP-018 FYIs addressed except buffer-full spam (still open, non-blocking, carry forward). Non-blocking findings for a future step: (1) engine?.recoverAfterCrash() in index.ts is dead code — a fresh PhaseEngine always starts idle, so it always no-ops; the real recovery path is persistence.recoverAfterCrash() only. (2) boot-time persistence.flush() calls in runtime.ts are unbounded (unlike shutdown flush) — a persistent post-migration write failure at boot hangs startServer() before listen with no timeout. (3) no direct happy-path test for queue.shutdown() success case. (4) informational: 001_persistence.sql `create table if not exists` without an advisory lock could race on a truly concurrent two-machine fresh-DB boot; single-machine deployment makes this low risk. COMMITTED on codex's behalf by claude at e75f808 after approval (codex usage limit had blocked its own commit).

### STEP-034: MediaStore downloads must bypass the browser HTTP cache
- status: done
- owner: claude
- tier: simple
- depends-on: STEP-014, STEP-029
- files: apps/display/src/media/mediaStore.ts, apps/display/src/media/mediaStore.test.ts
- acceptance: media downloads fetch with cache: "no-store" so a corrupt/truncated response cached by the browser HTTP cache (media is served Cache-Control: immutable per STEP-029) cannot poison every subsequent retry; unit test asserts the fetch init; STEP-023's media-retry e2e (corrupt → retry → restore → ready) passes
- verify: `pnpm --filter @smartphonecracy/display test` → PASS 41/41 (incl. new fetch-init assertion); display typecheck + build PASS; STEP-023 media-retry e2e → PASS with a genuine retry cycle observed (visible "retrying (attempt N): size mismatch" through corruption, self-recovery after restore); full `pnpm test:e2e` → PASS 9/9, 2026-07-12. Committed c7ca960.
- reviewer: none
- notes: DISCOVERED by STEP-023's media-retry e2e 2026-07-12: after one corrupt download, MediaStore's endless retry loop can never succeed — /media responses are Cache-Control "public, max-age=31536000, immutable", so the browser HTTP cache keeps returning the corrupt bytes on every retry (observed live: "size mismatch: expected 67, got 20" persisting through attempt 5 after the file on disk was already restored). MediaStore has its own hash-keyed Cache Storage, so the HTTP cache adds nothing for media downloads. Manifest fetch already uses cache: "no-cache" and the server serves it no-cache — unaffected. Display slice (claude).

### STEP-035: Enforce lobby-only late join (STEP-000 director decision)
- status: done
- owner: codex
- tier: complex
- depends-on: STEP-000 (group a decisions), STEP-006, STEP-007, STEP-010
- files: apps/server/src/admission/**, apps/server/src/engine/phase-engine.ts, apps/server/src/config.ts (+tests; tests/e2e/full-flow.spec.ts if assertions shift)
- acceptance: with late join disabled (config env, e.g. ALLOW_LATE_JOIN=false, wired into QrCoordinator and admission): QR hides once a session leaves lobby (qr_hidden) AND admission rejects NEW participant joins during active phases with a distinct rejection code the phone renders ("show in progress — wait for the next round"); existing-lease reconnects are still honored mid-session (a participant whose phone slept must get back in); joins re-open the moment the engine returns to idle/lobby; STEP-012 integration late-join test and any affected e2e updated to the new policy
- verify: protocol 31/31 PASS; focused admission/QR/engine/integration 33/33 PASS; phone 11/11 PASS; server+phone+workspace typechecks PASS; `git diff --check` PASS (2026-07-13). Full server suite: 68/69 PASS, only pre-existing localhost bind test blocked by sandbox `listen EPERM 127.0.0.1`. E2E bundles build PASS, browser run blocked at server bind by the same sandbox EPERM.
- reviewer: claude
- notes: Filed 2026-07-12 from the STEP-000 group (a) decisions: director chose LOBBY-ONLY late join. Implemented by codex 2026-07-13: `ALLOW_LATE_JOIN` defaults false and drives both active QR hiding and the admission gate; new joins during active phases receive `show_in_progress`, rendered by phone as “The show is in progress — wait for the next round.” A known, valid registered lease bypasses the active gate and replaces its prior socket; idle/lobby immediately admit new participants. Integration coverage replaces the former late-admit expectation with rejection plus mid-show lease reconnect. Protocol enum expanded for the distinct rejection. Ready for claude review.
  APPROVED by fable review 2026-07-13 (admission-security class per re-amended tiering): gate is a live closure on engine lifecycle (blocks only during active with ALLOW_LATE_JOIN=false → lobby/idle joins and post-show re-opening are automatic, satisfying the "re-open the moment" acceptance without event wiring); placed AFTER lease verification so only a registry-verified lease bypasses it, and BEFORE canAdmitNew (correct precedence, no cap-slot consumption by rejected latecomers); engine-null fallback admits (readiness-gated elsewhere). QR loop receives the same flag. Unit test covers block/reconnect/re-open; integration test updated to rejection + mid-show lease reconnect. Reviewer re-ran in an unsandboxed shell: server 69/69, protocol 31/31, phone 11/11, pnpm -r typecheck, and full e2e 9/9 (default-false verified compatible with all e2e flows — every e2e join happens at idle). Committed on codex's behalf at 67755e2.

## Show Studio slice (decomposed 2026-07-12 by claude from docs/show-studio-implementation-plan.md; codex CHANGES REQUIRED 2026-07-13; ALL FIVE AMENDMENT GROUPS APPLIED by claude 2026-07-13 — codex re-verifies at first claim, then implementation may start with STEP-036/037)

Source plan: docs/show-studio-implementation-plan.md (user/director-authored, reviewed by claude with amendments below).
Claude's plan amendments folded into the steps: (1) server engine/vote logic does not import into a browser — pure resolution math must be extracted to packages/shared first (STEP-037) with parity tests; (2) Zod .parse() strips unknown keys — round-trip fidelity needs .passthrough()/raw-carry handling decided in Phase A (STEP-036); (3) media manifest has no durations — Studio computes duration from local files via <video> element and only *suggests* expectedDurationMs; (4) no "allow-skip" on video nodes (runtime has no such field); (5) STEP-000 group (a) decisions (60 s duration, freezeMs 5000, showLiveCounts true, countedStatuses valid+stale+disconnected) are the Studio's new-question defaults. V1 TRIM: multi-participant drag simulation (plan §12 third mode) is deferred post-content-lock (STEP-044); outcome-shortcut preview ships in v1. Studio is NOT launch-blocking: production content may land via hand-authored JSON in parallel; STEP-036's round-trip fixtures then adopt it.

**Codex decomposition review 2026-07-13 — CHANGES REQUIRED.** The five claude amendments and the explicit v1 trim are sound, and no Show Studio file is double-reserved by a currently in-progress step (STEP-023 is done; STEP-035 is todo and only conditionally names an existing e2e spec). Do not implement this slice until the following are amended:

1. STEP-037 does not yet identify the complete browser-facing contract needed by STEP-042/044. The current server resolver accepts server-local `FinalVoteSnapshot`/`PositionVote` types, returns only quadrant counts/winner/target, duplicates filtering in `liveStatus()`, and keeps status classification (`disconnected` before `never-moved`, heartbeat staleness, coordinate/null rules) private to `VoteEngine`. Define shared browser-neutral input/output types and pure helpers for status materialization, counted/excluded classification and totals, live/final quadrant counting, and fixed/plurality resolution; preserve the existing fixed-transition rule (all positioned votes are counted regardless of status). Have both server final resolution and live counts consume them, with parity vectors covering every status, null positions, boundaries, fixed, q1-q4, tie, and empty. This is required for STEP-042's promised individual records and counted/excluded totals and STEP-044's stale/disconnect controls.
2. STEP-038 is not a simple scaffold: it combines home UI, IndexedDB/revision recovery, graph rendering, adapter integration, and the *final* §14 deployment package. The final package cannot truthfully execute required full diagnostics and branch-simulation smoke tests before STEP-041/042. Split the scaffold/draft-store/basic import-export shell from final deployment export, or move final package assembly/gating to a step depending on both STEP-041 and STEP-042. STEP-042 must depend on STEP-041 because plan §8 requires full validation before preview. Record whether preview reuses real display components as plan §12 requests; if direct app imports are unsuitable, add an explicit shared-rendering extraction or document/test the intentional preview adapter boundary.
3. Add hidden tooling reservations and acceptance: STEP-038 must reserve `pnpm-lock.yaml` (and any root config/script actually changed) for `@xyflow/react` and Studio dependencies. STEP-043 cannot reuse STEP-023 unchanged: its harness only starts the installation server and assumes prebuilt mounted clients, so reserve/update `tests/e2e/helpers/**`, `tests/e2e/playwright.config.ts`, and relevant package scripts/config to start the local-only Studio Vite app. Include the Phase F keyboard-navigation and large-graph performance checks, currently missing without an approved trim.
4. Normalize reviewer assignments to the ACKed tiering rule and no-self-approval invariant. STEP-039 currently says owner/reviewer codex while its note says claude; STEP-040/041/042 assign routine claude reviews even though the new rule says codex-authored low-risk work self-verifies and fable reviews only enumerated high-failure classes; STEP-043 `reviewer: cross (both)` would include codex approving its own work; STEP-044's reviewer is unsafe until its owner is chosen. Keep fable/claude review for STEP-036 and STEP-037 as high-failure semantic/resolution work, use `none` for genuinely low-risk codex work, and assign only the other lane wherever cross-review is actually required.
5. Make ownership/tiering follow the re-amendment after splitting: leave high-failure compatibility/resolution work complex; do not label the present overloaded STEP-038 simple. Also make STEP-043's “all §18 rows” auditable by explicitly listing any v1 exclusions (only multi-participant simulation is presently approved as deferred) and by checking the final export's required validation acknowledgement, reproducible/versioned metadata, and branch-smoke gating.

### STEP-036: Studio Phase A — compatibility audit + adapter round-trip core
- status: done
- owner: codex
- tier: complex
- depends-on: STEP-003, STEP-004
- files: packages/studio-adapter/** (new), docs/studio-compat.md
- acceptance: plan §5/§15/§17-A — parseRuntimeScenario()/compileStudioGraph()/validateStudioProject() skeletons over the REAL implemented schema (video next is a plain string, question next is a discriminated object; scenario-level cyclesAllowed; manifest is src/bytes/hash only); unknown-field policy decided and implemented (passthrough or raw-carry — never silently dropped, per plan §15); round-trip fixture tests: content/scenarios/dev.json + manifest → import → no edits → export is semantically identical after canonical normalization; compile ends by invoking the existing @smartphonecracy/scenario validator; docs/studio-compat.md records the compatibility matrix and versioning behavior
- verify: `pnpm --filter studio-adapter test` → PASS (5 tests: dev fixture round-trip, nested unknown-field raw-carry, known-field edit overlay, identity-keyed insert/delete/reorder, invalid import/graph); `pnpm --filter studio-adapter typecheck` → PASS; `git diff --check` → PASS (2026-07-13)
- reviewer: claude
- notes: Reclaimed by codex 2026-07-13 to address Fable's blocking keyed-sidecar review finding. Previously: claimed by codex 2026-07-13 after re-verifying that all five required decomposition amendment groups are present. Implemented the adapter skeleton against the imported canonical scenario schemas/validator, with unknown fields isolated in a recursive raw-carry sidecar and canonical known edits overlaid on export; documented the exact runtime compatibility matrix and versioning policy. Direct source resolution follows the existing root validator-script pattern so this step does not modify the pnpm lockfile reserved by STEP-038; the workspace dependency remains declared for installation/linking there. Ready for Fable review (high failure potential: silent semantic drift here corrupts every show authored later). Extend existing packages; never fork schemas (plan §19).
  CHANGES REQUESTED by fable review 2026-07-13. Verified independently: studio-adapter tests 4/4 PASS + typecheck PASS; overlay precedence (known edits win over sidecar), no-Studio-leak guarantee, compile-ends-with-runtime-validator, and the compat matrix (video next string vs question next object, manifest src/bytes/hash, scenario-level cyclesAllowed) all check out and match the implemented runtime. BLOCKING: unknown-field extensions are carried BY ARRAY INDEX (extensionsOf/applyExtensions array branches; docs/studio-compat.md even states "at their original nesting/index"). The sidecar is captured at import and applied at compile, but the Studio's entire purpose is to edit the phases array between those two moments — insert, delete, or reorder a phase and every subsequent phase silently inherits the WRONG phase's unknown fields (worse than dropping them; plan §15 violation in spirit). Today's fixtures carry no unknowns so all 4 tests pass without ever exercising an edit that shifts indices. REQUIRED: key phase-level extensions by phase `id` (unique, validator-enforced) and manifest-file extensions by `src`, with index alignment acceptable only for interior arrays that Studio cannot reorder; add a regression test that inserts + deletes + reorders phases around an unknown-field-bearing phase and proves the extension stays attached to the right id. NON-BLOCKING: (1) validateStudioProject funnels graph errors through the compile-throw path, flattening them to message-only "invalid-scenario" diagnostics — ScenarioIssue's code/phaseId are lost for errors (kept for warnings), which starves STEP-041's focus-node action; restructure to collect validator issues without throwing. (2) When STEP-038 adds the workspace dependency, switch the deep ../../scenario/src import to the package import. Re-request review after the keyed-sidecar fix.
  FIXED by codex 2026-07-13: reorderable record arrays now store extensions by a detected unique stable identity (`id` for phases, `src` for manifest files); only arrays without stable runtime identity retain index alignment. The regression imports unknown fields on a phase/file, inserts and deletes valid records, reorders collections, and proves extensions remain on the original identities without leaking to new records. Compatibility docs now state the keyed policy. Ready for Fable re-review; non-blocking diagnostic preservation remains deferred to the diagnostics step.
  APPROVED by fable re-review 2026-07-13: keyed sidecar verified — arrayIdentity picks id/src only when every item is a record with a unique string value (duplicate-id imports degrade safely to index alignment and are rejected by the validator at compile anyway); __studioKey/__studioItems markers are consumed exclusively at array positions during apply, so they cannot leak into runtime JSON or collide with genuine unknown fields (record-level unknowns are carried verbatim, never restructured); deleted-phase extensions drop with the phase; inserted phases inherit nothing. Regression test re-run by reviewer (5/5 PASS + typecheck) does exactly what the finding required: insert+delete+reorder around extension-bearing phase AND manifest file, asserting attachment by identity and non-leakage. Committed on codex's behalf at 6470805. CARRIED non-blocking items: (1) diagnostics phaseId/code fidelity → fold into STEP-041 acceptance-side; (2) deep ../../scenario/src import → switch at STEP-038; (3) NEW: an id-rename in the editor will detach that phase's unknown extensions (adapter cannot know old→new mapping) — STEP-040's rename operation must remap runtimeExtensions.scenario keys when a phase id changes; noted for that step's implementer.

### STEP-037: Extract pure resolution math to packages/shared
- status: done
- owner: codex
- tier: complex
- depends-on: STEP-008
- files: packages/shared/** (resolution module), apps/server/src/votes/** (consume shared), tests both sides
- acceptance: (expanded per codex decomposition review point 1) packages/shared gains browser-neutral input/output types plus pure helpers covering the COMPLETE resolution contract: status materialization (disconnected-before-never-moved precedence, heartbeat staleness, coordinate/null rules — currently private to VoteEngine), counted/excluded classification AND totals, live quadrant counting (currently duplicated in liveStatus()), final quadrant counting, and fixed/plurality resolution — preserving the existing fixed-transition rule that all positioned votes count regardless of status; BOTH server final resolution and server live counts consume the shared helpers (no behavior change — existing vote-engine tests stay green unmodified as the parity oracle); parity vectors cover every status, null positions, boundary coordinates (via quadrantOf), fixed, q1-q4 winners, tie, and empty; individual snapshot records and counted/excluded totals exposed in shapes sufficient for STEP-042 preview results and STEP-044 stale/disconnect controls
- verify: `pnpm --filter shared test` → PASS (9 tests); `pnpm --filter server exec vitest run src/votes/vote-engine.test.ts` → PASS (7 tests); `pnpm -r typecheck` → PASS (8 projects); full server suite → 68 PASS, 1 environment-blocked (`listen EPERM 127.0.0.1` in the pre-existing localhost WebSocket test), 2026-07-13
- reviewer: claude
- notes: Extracted browser-neutral status materialization, counted/excluded classification and totals, live/final quadrant counting, fixed resolution, and plurality resolution into shared. Both server status/final resolution and live counts consume the shared helpers; existing server parity tests pass unmodified. Shared vectors cover all statuses, null positions, boundaries, fixed, q1-q4 winners, tie, and empty. Ready for fable review (vote-resolution correctness is on the launch-critical path; a drift between Studio preview and venue resolution would be director-visible). Prerequisite for STEP-042 preview.
  APPROVED by fable review 2026-07-13: traced every extracted path against the pre-diff server code — materializePositionStatus preserves exact precedence (disconnected → never-moved → stale(>=) → valid); resolveFixedTransition preserves the counts-all-positioned-regardless-of-status rule (test proves it with an uncounted status included); resolveQuadrantPlurality's highest===0 empty check is equivalent to the old total===0; live-count fallback status "never-moved" reproduces the old missing-status skip. Parity vectors verified comprehensive: all four statuses incl. the exact stale boundary (now-heartbeat === staleAfterMs → stale), null positions in both counting and classification exclusion, x=0.5→right / y=0.5→bottom / center→q4 boundary convention, fixed, each q1-q4 unique winner, tie, empty. Vote-engine parity oracle untouched and green. Reviewer re-ran unsandboxed: shared 9/9, full server 69/69, pnpm -r typecheck clean. Committed on codex's behalf at 6a0d64d. STEP-042's preview contract is now fully unblocked.

### STEP-038: Studio Phase B — app scaffold, draft store, import/export shell
- status: done
- owner: codex
- tier: simple
- depends-on: STEP-036
- files: apps/studio/** (new workspace: React+Vite+@xyflow/react), pnpm-lock.yaml (Studio deps), root config/scripts only if actually touched
- acceptance: (scope split per codex review point 2 — final §14 deployment package moved to STEP-045) plan §17-B — apps/studio boots; project home (new/import/open-recent/duplicate/delete-with-confirm/export-backup); IndexedDB draft autosave with debounce + saving/saved/error status + bounded revision history (~20) + corrupt-draft recovery to last good save; import runtime JSON or studio backup via studio-adapter; BASIC export of scenario.json + media-manifest.json + .studio.json only (no deployment gating yet — that is STEP-045); imported dev.json renders as an auto-laid-out basic graph and re-exports round-trip-clean; layout/viewport persisted in .studio.json only — never leaks into runtime JSON
- verify: `pnpm --filter studio test` → PASS (4 tests, including normalized dev import→export and corrupt-draft recovery); `pnpm --filter studio typecheck` → PASS; `pnpm --filter studio build` → PASS; `pnpm --filter studio-adapter test` → PASS (5 tests); `pnpm --filter studio-adapter typecheck` → PASS; `git diff --check` → PASS (2026-07-13)
- reviewer: none
- notes: Completed by codex 2026-07-13 after claude restored dependencies and updated the reserved lockfile. Fixed the remaining UUID-typed test fixture, verified the Studio shell and adapter regression suite, and confirmed the production build. Implements the local/dev-only app shell, project home operations, IndexedDB autosave with bounded revisions/recovery, runtime/backup import, basic three-artifact export, and persisted auto-layout/viewport without runtime leakage. Self-verified per the re-amended tiering; NOT exposed as a production route (plan §13).

### STEP-039: Studio Phase C1 — graph canvas, nodes, typed handles, edge rules
- status: done
- owner: codex
- tier: complex
- depends-on: STEP-038
- files: apps/studio/src/canvas/**, node components
- acceptance: plan §7/§8 — node palette (entry marker, idle, video, position-question; NO allow-skip field); question nodes switch between one `next` handle (fixed) and six handles q1/q2/q3/q4/tie/empty (quadrant-plurality) with the runtime quadrant placement rendered exactly (q2 TL, q1 TR, q3 BL, q4 BR; center→q4 convention displayed, never reinvented); edge-time structural validation (single entry edge, no dangling targets, handles may share a target); deleting nodes cleans edges; editor-only nodes compile away (entry marker → entryPhaseId; end → existing idle target)
- verify: `pnpm --filter studio test` → PASS (7 tests, including 3 canvas/edge-rule units); `pnpm --filter studio typecheck` → PASS; `pnpm --filter studio build` → PASS; `git diff --check` → PASS (2026-07-13)
- reviewer: none
- notes: Completed by codex 2026-07-13. Added the node palette, entry/end editor markers, runtime phase nodes, fixed and six-way typed outputs, exact q2/q1/q3/q4 visual placement (center documented as q4), one-edge-per-output and single-entry rules, shared-target support, deletion cleanup, and graph-to-runtime compilation with editor markers removed. Self-verified per the re-amended tiering; compile round-trip against dev.json is covered. (reviewer normalized per codex review point 4) codex-authored, not in the enumerated high-failure classes (misrendering is director-visible, not silent corruption) → self-verified. Escalate to fable only if codex flags uncertainty about compile-affecting behavior.

### STEP-040: Studio Phase C2 — properties inspector, defaults, undo/redo
- status: done
- owner: codex
- tier: complex
- depends-on: STEP-039
- files: apps/studio/src/inspector/**, undo/redo store
- acceptance: plan §9 — typed forms from the node model; immediate draft application; unique runtime-ID validation; destructive type changes confirm + preserve old connections in undo history but exclude from compile; inline field errors; plain-language labels with runtime names as secondary text; read-only compiled-JSON inspector; session undo/redo; NEW-QUESTION DEFAULTS = STEP-000 group (a): durationMs 60000, freezeMs 5000, showLiveCounts true, countedStatuses ["valid","stale","disconnected"]; a complete show can be authored without touching JSON (plan §17-C exit); renaming a phase's runtime id remaps its runtimeExtensions sidecar key (STEP-036 re-review carry: extensions must not silently detach on rename)
- verify: `pnpm --filter studio test` → PASS (10 tests incl. inspector/history); `pnpm --filter studio typecheck` → PASS; `pnpm --filter studio build` → PASS; `git diff --check` → PASS (2026-07-13). Typed-form authoring walkthrough completed through the production build.
- reviewer: none
- notes: Completed by codex 2026-07-13. Added typed idle/video/question forms with immediate autosaved draft updates, plain-language and runtime labels, inline unique-ID errors, atomic rename with graph-target and runtimeExtensions sidecar remapping, director-approved question defaults, fixed/plurality transition editing, destructive-change confirmations, session undo/redo including connection restoration, and a read-only compiled-JSON panel. A complete show can be authored through the graph and forms without JSON editing. Self-verified per the normalized reviewer rule; the STEP-036 adapter validator remains the compile/export backstop.

### STEP-041: Studio Phase D — media library + diagnostics panel
- status: done
- owner: codex
- tier: complex
- depends-on: STEP-040
- files: apps/studio/src/media/**, diagnostics/**
- acceptance: plan §10/§11 — manifest import/list (id, file, bytes, hash, referencing nodes); local-file inspection computes size + SHA-256 in-browser and duration via <video> (suggests expectedDurationMs — manifest itself carries no durations); missing/unused/duplicate-hash detection; DISTINCT-file 2 GiB budget arithmetic incl. per-branch view; error/warning/info diagnostics with focus-node action; all plan §11 required errors block export, required warnings need acknowledgement (incl. abandoned-solo-reaches-unreviewed-empty-target and live-counts-influence warnings); invalid shows cannot be exported (plan §17-D exit)
- verify: `pnpm --filter studio test` → PASS (14 tests incl. 4 media/diagnostics fixtures); `pnpm --filter studio typecheck` → PASS; `pnpm --filter studio build` → PASS; `git diff --check` → PASS (2026-07-13)
- reviewer: none
- notes: Completed and self-verified by codex 2026-07-13. Added browser SHA-256/size/duration inspection, manifest reference and duplicate-hash reporting, distinct-content 2 GiB and per-outcome branch budgets, error/warning/info diagnostics with node focus and warning acknowledgement, and blocked basic export while errors or unacknowledged warnings remain. Canonical schema/graph diagnostics retain their runtime-validator coverage; Studio adds unused/duplicate media, budget, convergence, abandoned-solo empty-review, live-count influence, and intentional-cycle guidance. The 2 GiB/package gate gets independent checks in STEP-045 and STEP-043.

### STEP-042: Studio Phase E (v1 trim) — outcome-shortcut preview
- status: done
- owner: codex
- tier: complex
- depends-on: STEP-037, STEP-040, STEP-041
- files: apps/studio/src/preview/**, packages/studio-simulator/** if warranted
- acceptance: plan §12 modes 1-2 (manual walkthrough + outcome shortcuts; multi-participant drag sim EXPLICITLY deferred to STEP-044): start from entry, step video placeholders, advance timers manually, force q1-q4/tie/empty, include/exclude stale+disconnected, abandoned-solo preset; full validation runs before preview (plan §8 — hence the STEP-041 dependency, codex review point 2); resolution computed by the packages/shared module from STEP-037 (never a reimplementation); results show individual snapshot records, counted/excluded totals, quadrant counts, winner, resolved target, freeze interval; every branch of a show reachable in preview; DECISION RECORDED in notes on plan §12 display-component reuse: either preview imports real display components (QuadrantOverlay etc.) or the intentional preview-adapter boundary is documented and tested (codex review point 2)
- verify: `pnpm --filter studio test` → PASS (17/17 incl. 3 preview/parity tests); `pnpm --filter studio typecheck` → PASS; `pnpm --filter studio build` → PASS; `pnpm --filter server exec vitest run src/votes/vote-engine.test.ts` → PASS (7/7 server parity oracle); `git diff --check` → PASS (2026-07-13)
- reviewer: none
- notes: Completed and self-verified by codex 2026-07-13. Added validation-gated manual video/question timing, fixed and q1-q4/tie/empty outcome shortcuts, stale/disconnected inclusion controls, abandoned-solo preset, freeze/result details, and resolved-target continuation. Resolution and classification import STEP-037's shared implementation directly; parity tests cover fixed, tie, empty, status totals, and abandoned-solo status, while the unchanged server vote oracle remains green. Display reuse decision: use an intentional preview-adapter boundary rather than importing the socket/state-coupled display renderer; preview renders neutral placeholders/results but shares resolution math and has adapter-level parity coverage. Multi-participant dragging remains exclusively STEP-044.
  REVIEWED by fable 2026-07-13 (alongside STEP-045, at user request): preview.ts imports classifyPositionVotes/resolveFixedTransition/resolveQuadrantPlurality directly from packages/shared (STEP-037), so preview resolution is the same code the venue runs — parity confirmed, not a reimplementation. The intentional preview-adapter boundary (neutral placeholders rather than the socket-coupled display renderer) is a sound v1 decision. Non-blocking cosmetic: for a FIXED question the displayed quadrantCounts come from resolveFixedTransition (all positioned votes) while includedTotal/excludedTotal come from classifyPositionVotes (counted-status filtered), so the two count displays can disagree — harmless since fixed questions don't branch on counts. No action required.

### STEP-043: Studio Phase F (v1) — e2e flows, round-trip regression, guide
- status: done
- owner: codex
- tier: complex
- depends-on: STEP-041, STEP-042, STEP-045
- files: tests/e2e/studio-*.spec.ts, tests/e2e/helpers/** (Studio server helper), tests/e2e/playwright.config.ts, package.json scripts if needed, docs/studio-guide.md, example show project
- acceptance: plan §17-F — Playwright: import→edit→validate→preview→export flow; round-trip regression over all fixtures; corrupt-draft recovery; export package contents verified incl. STEP-045 gating (validation acknowledgement required, reproducible/versioned README metadata, branch-smoke gate); keyboard navigation and large-graph performance checks (codex review point 3 — no approved trim covers dropping them); curator user guide + example show; plan §18 acceptance rows checked and recorded with EXPLICIT v1 exclusions listed (only multi-participant simulation is approved deferred). Harness note: STEP-023's helpers only spawn the installation server — this step extends them to launch the local Studio Vite app (reservation above, codex review point 3)
- verify: `pnpm exec playwright test --config tests/e2e/playwright.config.ts tests/e2e/studio-flow.spec.ts` → PASS (2/2); `pnpm test:e2e` → PASS (11/11); `pnpm -r test` → PASS (all workspace suites, incl. server 69/69 and Studio 22/22); `pnpm -r typecheck` → PASS (9 projects); `pnpm --filter studio build` → PASS; `git diff --check` → PASS (2026-07-13). Localhost suites required the expected unsandboxed bind permission.
- reviewer: none
- notes: Completed by codex 2026-07-13 under the user's direction to finish with GPT-5.6 high because Fable is currently unreliable. Added the missing New show UI, a dedicated Vite Studio E2E helper, full import/edit/acknowledge/preview/versioned-five-file-export coverage, keyboard-entry coverage, a 150-phase graph render budget check (completed in under 1 second in Playwright), and round-trip regression for every checked-in scenario fixture. The curator guide documents validation, preview, deployment handoff, recovery, limitations, and audits every plan §18 row. Explicit v1 exclusion: only multi-participant cursor dragging is deferred to STEP-044; outcome shortcuts exercise its resolution branches. Corrupt-draft recovery remains covered by the focused Studio test, and the full workspace/browser suites are green. The final gate also caught and fixed the previously missing New show action, making UI-only authoring possible.
  REVIEWED by fable 2026-07-13 (final v1 gate, at user request): tests/e2e/studio-flow.spec.ts genuinely drives the whole flow against the real Vite Studio app via the new tests/e2e/helpers/studio.ts — import → rename → acknowledge every warning → preview → resolve → gated "Export for deployment" producing exactly the 5 files with a single consistent package-name prefix, plus keyboard-focus entry and a 150-phase (153-node) render inside the interaction budget. docs/studio-guide.md audits the §18 rows with the correct single v1 exclusion (multi-participant drag → STEP-044). Confirmed green independently: studio 22/22 + typecheck; the e2e localhost suites need the usual unsandboxed bind. Studio v1 slice is complete and accepted, with the one non-blocking STEP-047 README follow-up carried from the STEP-045 review.

### STEP-044: Studio post-v1 — multi-participant drag simulation
- status: todo
- owner: —
- tier: complex
- depends-on: STEP-043
- files: apps/studio/src/preview/**
- acceptance: plan §12 mode 3 — 1-30 synthetic participants, draggable cursors on the X/Y field, randomize, disconnect/stale marking, live quadrant counts, resolved-target confirmation
- verify: studio tests + e2e addition
- reviewer: cross (the non-owner lane, assigned at claim time — codex review point 4)
- notes: DEFERRED post content lock by v1 trim decision — do not claim before STEP-043 is done and production content exists; not launch-blocking. Plan §16 publishing phase is NOT decomposed (post-v1, needs auth/roles — new decomposition when wanted).

### STEP-045: Studio deployment-export assembly + gating
- status: done
- owner: codex
- tier: complex
- depends-on: STEP-041, STEP-042
- files: apps/studio/src/export/**, packages/studio-adapter/** (export packaging)
- acceptance: (split from STEP-038 per codex review point 2) plan §14 full flow — "Export for deployment" runs: validate graph → compile via studio-adapter → existing runtime validator → manifest+2 GiB budget validation → branch-simulation smoke tests (every branch resolvable via the STEP-037 shared resolution) → versioned export package (scenario.json, media-manifest.json, .studio.json, validation-report.json, README.txt with timestamp/studio build/runtime schema version/scenario version/validation result/media total/known warnings); unacknowledged required warnings block export; exports are reproducible and versioned (plan §19); a show rejected by the runtime validator can never produce a package
- verify: `pnpm --filter studio test` → PASS (20 tests incl. reproducibility, all-branch smoke, unacknowledged-warning block, runtime-invalid block); `pnpm --filter studio typecheck` → PASS; `pnpm --filter studio build` → PASS; `git diff --check` → PASS (2026-07-13)
- reviewer: none
- notes: Completed by codex 2026-07-13. Added the explicit “Export for deployment” flow: diagnostics/acknowledgement gate, canonical compile+runtime validation, distinct-hash media total and 2 GiB diagnostics gate, shared-resolution smoke coverage for fixed and all q1/q2/q3/q4/tie/empty branches, and deterministic assembly when supplied the same timestamp/build metadata. The versioned package emits scenario.json, media-manifest.json, .studio.json, validation-report.json, and README.txt with the required audit metadata and known warnings. User waived the unreliable Fable review on 2026-07-13 and directed GPT-5.6 high to finish the work. Codex performed a fresh high-effort review and re-ran Studio tests/typecheck/build, the server vote-engine parity oracle, and git diff checks; all passed. No resolution divergence or export-gate uncertainty was found.
  APPROVED by fable review 2026-07-13 (performed at user request; the earlier "review waived" note reflects a prior session decision, not this one). Traced the gate end-to-end in apps/studio/src/export/deployment.ts: ordering is metadata-validity → diagnostics/acknowledgement gate (exportBlocked throws DeploymentExportError on any error-severity item OR any acknowledgementRequired warning not in the acknowledged set) → compileStudioGraph (ends in the canonical runtime validator, so runtime-invalid output cannot escape) → smokeAllBranches → assemble. No gate-escape path found: a show with a broken target, exceeded 2 GiB budget, or an unacknowledged abandoned-solo/live-counts/converging/unused/duplicate/cycle warning cannot produce a package. Reproducibility holds given fixed metadata (deterministic phase/file/branch iteration order, sorted warning keys). Branch-smoke resolution uses STEP-037's shared functions (verified via preview.ts import), preserving venue parity. Re-ran studio 22/22 + typecheck. ONE NON-BLOCKING FINDING (filed as STEP-047): the README.txt "Media total" (deployment.ts mediaTotalBytes) sums distinct-by-hash over ALL manifest files, whereas the 2 GiB budget gate uses distinctReferencedBytes (referenced-only, max-bytes-per-hash). With unused media in the manifest the two diverge, so the venue-handoff README can report a media total that contradicts (and can exceed 2 GiB above) the number the gate actually enforced. The gate itself is correct — this is a reporting inconsistency only; the dev fixture has no unused media so the test (mediaTotalBytes:67) does not exercise it. Also cosmetic (not filed): smokeAllBranches' `if (!resolution) throw` is unreachable (resolvePreview always returns a resolution), and a forced outcome under an unusual countedStatuses set can resolve to a different winner than the one forced — smoke proves "resolvable" (its stated purpose) but not "forced outcome achievable".

### STEP-046: Make Studio node inputs visually explicit
- status: done
- owner: codex
- tier: simple
- depends-on: STEP-039, STEP-043
- files: apps/studio/src/App.tsx, apps/studio/src/canvas/nodes.tsx, apps/studio/src/canvas/graph.ts, apps/studio/src/canvas/graph.test.ts, apps/studio/src/style.css
- acceptance: runtime phase nodes visibly expose a labeled input port; Entry remains output-only; End remains input-only; invalid/unknown input targets are rejected; dragging an already-connected output rewires it instead of raising a duplicate-edge error; existing typed outputs remain unchanged
- verify: `pnpm --filter studio test` → PASS (22/22); `pnpm --filter studio typecheck` → PASS; `pnpm --filter studio build` → PASS; `git diff --check` → PASS (2026-07-13)
- reviewer: none
- notes: User identified that nodes appeared to have no inputs. The underlying target handle existed but was unlabeled and visually too subtle. Added a first-class “in” port with larger high-contrast handles, explicit input-capability validation, and regression coverage. Live testing then exposed “A show has exactly one entry edge” when dragging Entry to a replacement target; output drags now atomically replace that output's prior edge, with an Entry-rewire regression. Verified in the live Studio after Vite hot reload.
  SPOT-CHECKED by fable 2026-07-13 (simple UI step, no full review owed): input-capability validation and the atomic output-rewire (Entry→replacement target no longer raises "exactly one entry edge") are covered by graph.test.ts; part of the green studio 22/22. No concerns.

### STEP-047: Fix deployment README media-total basis to match the 2 GiB budget gate
- status: todo
- owner: codex
- tier: simple
- depends-on: STEP-045
- files: apps/studio/src/export/deployment.ts, apps/studio/src/export/deployment.test.ts
- acceptance: the README.txt "Media total" and validation-report.json mediaTotalBytes are computed on the SAME basis the 2 GiB gate enforces — distinct referenced media (reuse media/library.ts distinctReferencedBytes, referenced-only, max-bytes-per-hash) rather than distinct-by-hash over all manifest files; OR the README reports both clearly labelled ("distinct referenced (budget): X / all manifest media: Y"); a regression test with an UNUSED manifest file (so the two bases diverge) asserts the reported total matches the budget basis and that a large unused file does not inflate the reported budget total
- verify: pnpm --filter studio test + typecheck + build
- reviewer: none
- notes: Filed 2026-07-13 from the STEP-045 fable review (non-blocking finding). Reporting-only: the export GATE is correct (blocks on distinctReferencedBytes > 2 GiB); this only fixes the venue-handoff README/report so its media total cannot contradict — or spuriously exceed 2 GiB above — the number the gate checked. The current dev fixture has no unused media so existing tests pass; the new test must introduce unused media to exercise the divergence. Also OK to delete the unreachable `if (!resolution) throw` in smokeAllBranches while here (cosmetic, optional).

### STEP-048: Two-quadrant position questions
- status: done
- owner: codex
- tier: complex
- depends-on: STEP-037, STEP-043, STEP-045
- files: packages/shared/**, packages/scenario/**, packages/protocol/**, packages/studio-adapter/**, apps/server/src/votes/**, apps/server/src/engine/**, apps/server/src/persistence/**, apps/display/src/**, apps/studio/src/**, content/scenarios/**, infra/migrations/**, docs/**, tests/e2e/** as required
- acceptance: position questions support either FOUR quadrants (the existing X+Y cross: q2 TL, q1 TR, q3 BL, q4 BR) or TWO quadrants formed by one active axis; a two-quadrant X-axis question divides the field left/right and a two-quadrant Y-axis question divides it top/bottom; the exact 0.5 boundary follows the existing convention and belongs to the max/right-or-bottom quadrant; Show Studio continues to call and render these spatial regions “quadrants”, shows the exact two- or four-quadrant field, and exposes two outcome handles plus tie/empty for a two-quadrant plurality question (four plus tie/empty for four-quadrant plurality, one next handle for fixed); stable two-quadrant runtime outcome IDs are min/max while Studio labels them contextually from their axis endpoint and position; switching layouts confirms before dropping incompatible connected outcomes and remains undoable; fixed transitions work with either layout; scenario validation rejects mismatched layout/transition maps and broken targets; shared browser-neutral resolution is the single oracle used by server live/final counts and Studio preview/export smoke; protocol live/resolved messages identify the field layout and carry a strictly typed two- or four-quadrant count/winner shape; persistence/export records the layout, active axis labels, counts, winner, included/excluded totals, target, and boundary convention so historical results remain understandable; display renders one divider and only the active axis labels for two quadrants, two dividers and both axes for four, with correct live counts and winner/tie/empty freeze treatment; existing scenario JSON without an explicit layout remains valid and canonicalizes to four quadrants; phone input behavior is unchanged; dev fixture includes a two-quadrant branching question; curator/runtime docs explain authoring and migration behavior
- verify: `pnpm -r test` → PASS (shared 14, scenario 20, protocol 35, adapter 6, display 46, phone 11, admin 1, server 73, Studio 26); `pnpm -r typecheck` → PASS (9 projects); `pnpm test:e2e` → PASS (12/12); final display rebuild plus focused full runtime flow → PASS (2/2); `pnpm exec vitest run tests/load/simulate-clients.test.ts` → PASS (3/3); `pnpm validate-scenario content/scenarios/dev.json` → PASS; Studio/display/phone/admin production builds → PASS; `git diff --check` → PASS (2026-07-13). Focused coverage includes X/Y split classification, x=0.5 and y=0.5 boundaries, min/max winners, tie, empty, status filtering, fixed transitions, legacy four-quadrant parsing/canonicalization, Studio dynamic handles plus browser undo/redo and preview/runtime parity, protocol field/count/winner correlation, v1-compatible reload during the v2 rollout, persistence evidence, one-divider display rendering, and full-viewport quadrant/cursor geometry.
- reviewer: independent codex subagent (Fable unavailable per user direction)
- notes: Requested 2026-07-13. Product wording is intentionally “two quadrants” even though the layout is geometrically a two-region split. Implemented canonical schema-v2 `field` variants, lossless legacy four-quadrant normalization, stable min/max two-quadrant outcomes, one shared field-aware resolution oracle, correlated protocol-v2 status/resolution messages, server/persistence/display/Studio support, a reachable two-quadrant dev fixture, and curator/compatibility documentation. Existing persistence JSONB plus nullable axis columns represent the layout without a SQL migration: outcome JSON embeds the canonical field/layout/active axis and the inactive axis column is null. Independent codex review initially found five P1 rollout/UI issues: v1 reload compatibility, dynamic-handle history restoration, layout-switch graph/export consistency, missing spatial display CSS, and cursor-canvas sizing. All were fixed with compatibility/unit/browser regressions; final re-review APPROVED 2026-07-13 with no remaining actionable correctness, regression, or compatibility findings. Work is on `codex/two-quadrant-questions`; PR #3 is ready to merge after required checks.
