# Resume a show after a server restart — implementation plan

Status: plan, not built. Issue #429.

## The problem

If the server process restarts mid-show (a crash, a redeploy, a Coolify
restart), the show starts again from the top. Everything the show knows lives
only in the engine's memory:

- The engine comes back `idle`.
- Phones and tablets reconnect by themselves. Their lease survives, because
  `JOIN_GRANT_SECRET` is fixed and `AdmissionController` accepts a valid lease
  when no visit has ended since it was issued. Each person comes back with
  the same `clientId` and name.
- The operator's only choice is **Start show**, which enters
  `scenario.entryPhaseId`. **Restart show** does the same.
- `adminJump` cannot help. It needs an active show, and it refuses while
  group paths run, which is most of the show (KI and theater timelines).

The engine already writes a `session_checkpoints` row on every scene change
(`emitCheckpoint` → `AdminData.recordCheckpoint`). Nothing reads those rows
back. `recoverAfterCrash()` exists, but nothing calls it, and it only aborts to idle.

## Goal

After a restart, Admin offers **Resume interrupted show**. One click restarts
the show at the scene each timeline was in when the server went down. Each
scene starts from its beginning. Everyone is in the same group as before,
and earlier vote results still show on the monitors.

The operator makes the decision. The server never resumes by itself: if the
crash came from the show's own state, restoring it automatically would just
crash again.

## Not in scope

- Resuming mid-scene at the exact second. Displays and native players
  already seek to elapsed cue time, so this is a possible follow-up for
  video and narration scenes. It is not part of this plan, because a
  half-finished vote cannot be restored honestly.
- The vote that was open when the server went down. It starts again empty.
- Participant tasks, role assignments and admission programs. These start
  again empty, as on a new session. They are listed in the Admin panel as
  "not restored".
- Movement recordings of the part before the crash. They stay as they were
  written; the resumed part records as usual.

## Design

### 1. Richer checkpoints (server, PocketBase)

Each `PhaseCheckpoint` gains what a resume needs. Everything below is IDs
and labels, no personal data beyond the participant IDs that `vote_snapshots`
already store.

| Field | Why |
|---|---|
| `groupId` (text, empty for the main timeline) | Group path engines don't write checkpoints today (`startGroupPaths` doesn't pass `onCheckpoint` to the child). They must, tagged with their group, or a resume inside the split has nothing to go on. |
| `epoch` (number, the engine's `epochSequence`) | Phones drop a frame of the same session with an older `phaseEpoch` (`apps/phone/src/state/store.ts`). A resume keeps the session id, so the counter must continue above the old one. |
| `state` (json) | Written on the main timeline only: group membership (`clientId → groupId` from `GroupManager`), `monitorVoteResults`, `lastMonitorVotePhaseId`, and which paths had already reached the reunion. |

This needs a PocketBase migration that adds the three fields to
`session_checkpoints`. Old rows stay valid, with empty values.

Writes stay fire-and-forget, as now. If the last write is lost in the crash,
the resume offers the previous scene, and the operator can pick another scene
(see 3).

### 2. Read back at boot (server)

`AdminData.latestInterruptedSession(installationId, roomId)` returns the
newest session where:

- the last main-timeline checkpoint is not `idle`, and
- that checkpoint is less than **3 hours** old (director decision, see below).

The result holds the session id, the last checkpoint per timeline, the
restored `state`, and the time of the last checkpoint. `buildServer` loads it
once at startup and keeps it as `interruptedSession`.

`interruptedSession` is cleared as soon as one of these happens: a resume,
**Discard**, **Start show**, or a publish of a different show version. A
resume of a different show version is refused, because scene ids may no
longer match.

### 3. Resume in the engine (server)

`PhaseEngine.resumeSession(plan, now)` is the production sibling of
`startRehearsalAt`:

- It needs `lifecycle !== "active"`.
- It uses the interrupted `sessionId` and seeds `epochSequence` above the
  saved `epoch`.
- It restores `monitorVoteResults` and `lastMonitorVotePhaseId`.
- It calls `ghosts.selectForSession` and
  `joinMovementRecordingForConnectedParticipants` as `startSession` does.
- It emits a checkpoint with the reason `resume`.

There are two cases:

- **Main timeline only:** `enterPhase(target, now, "resume")`.
- **Inside a split:** enter the group-branch phase, then call a new variant of
  `startGroupPaths` that takes:
  - members from the restored membership, not from the selection cohort;
  - a start scene per group, taken from that group's last checkpoint (or
    `branch.next` if none);
  - `pathDone` for groups that had already reached the reunion.

  Nested splits follow the same rule one level down. Children write
  checkpoints with their `groupId` (see 1).

`server.ts` restores `GroupManager` membership from `state` before the engine
resumes, through a new `GroupManager.restore(membership)`. It doesn't go
through `beginSession`, which would rebalance. Participants who are not
connected at the moment of the resume keep their membership. When they
rejoin, `participantJoined` routes them to their path as today, because
they are in `paths.members`.

The operator can override the target: the Admin panel lists the scenes,
using the same targets `groupJumpTargets` allows today.

### 4. Admin API and UI

- `GET /api/admin/status` gains `interruptedSession`. It holds the scene per
  timeline (id and title), when the last checkpoint was written, how many of
  its participants are connected again, and the list of what will not be
  restored.
- `POST /api/admin/resume` takes `{ sessionId, targets?: { [groupId|"main"]: phaseId } }`.
  It answers 409 if the session is no longer the interrupted one or a show is
  active. It is audited like start, restart and jump.
- `POST /api/admin/resume/discard`.
- The Admin show controls get a **Resume interrupted show** panel. It is
  shown only while idle and only while `interruptedSession` is set. It has:
  - the scene per timeline, with a picker to change it;
  - "N of M participants back";
  - a primary **Resume** button and a secondary **Discard**;
  - a confirmation dialog like Restart's.
- **Start show** stays available. If an interrupted session exists, it asks
  for confirmation that the interrupted show will be discarded.

### 5. Displays, monitors, lights, tablets

These need no new client code:

- Displays and monitors rejoin and get a snapshot. Their media loading
  already handles a scene that starts later than the page load.
- The Eos bridge and other cue-feed listeners follow `onCueEvent` from
  `enterPhase`, so a resume fires the scene's cues again, as a jump does.
- Native tablets pin the release of a joined session; the session id is
  unchanged.

This must be checked at a rehearsal (see Verification), not assumed.

## Work order

Two PRs, each closing its own issue:

1. **Server:**
   - checkpoint fields and migration;
   - child path checkpoints;
   - `latestInterruptedSession`;
   - `GroupManager.restore`;
   - `PhaseEngine.resumeSession`;
   - the resume and discard routes.

   This one needs a second-pass review, because it touches vote results and
   group routing (see `docs/agent-workflow.md`).
2. **Admin:** the panel, the Start-show confirmation, and its tests.

Rough size: two to four agent days in total, mostly tests for the split case.

## Tests

- Engine:
  - resume on the main timeline;
  - resume inside a split, with one path at the reunion;
  - restored members routed to their path when they rejoin;
  - the epoch continues above the saved one;
  - monitor vote results survive;
  - a resume is refused while active.
- Server:
  - build a server with an in-memory `AdminData` and start a show;
  - move both timelines forward, then build a second server on the same
    data;
  - rejoin the phones with their leases and resume;
  - check each phone's scene, its group and the monitor result.
- PocketBase: the migration applies to existing data.
- Admin: the panel appears only while idle with an interrupted session;
  Start show asks for confirmation; resume and discard call the API.

## Verification at the venue

The real check is a rehearsal:

1. Start the show with a few tablets and phones.
2. Move into the split and past one vote.
3. Restart the server container in Coolify.
4. Resume.
5. Check the projector, M1–M4, lights, a tablet and a phone on each side.

## Decisions for the director

1. **Scene start or exact second?** This plan restarts each scene from its
   beginning (recommended).
2. **How long is a show resumable?** Proposed: 3 hours after the last
   checkpoint, or until Start show or Discard.
3. **Same session or a new one?** Proposed: the same session id, so the
   evening exports as one show.
