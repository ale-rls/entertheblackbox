# Admission programs, participant tasks, roles and handover

Reusable participant workflows authored in Studio, published with the show,
run by the server and operated from Admin. The native app plays admission
audio and shows task prompts.

## What exists

- **Admission programs** (`scenario.admission`). Each group path has an intro
  (played once) and a loop (repeated). Steps are MP3 files or silent gaps of a
  fixed length. Assignment is `operator` or `self-select`. Each admitted device
  runs its own clock, anchored at admission. Admission audio is part of the
  immutable native release. Edit it in Studio → Show properties → Admission.
- **Participant tasks** (`scenario.participantTasks`). A template has a
  question, a notification text, an audience-group filter, a response window
  and 1–12 fixed options. Each option has an optional capacity, an optional
  role and an outcome message. The server handles one claim at a time, so a
  full option is never over-assigned. Late responses get the authored
  "full" message. Operators send tasks from Admin → Participant tasks.
  A phase can open a task (`taskId`) and hold until the operator presses GO
  (`waitForGo`).
  A scene's task stays open until its response window ends, even when
  everyone has answered. Anyone who joins, or is moved into its audience
  group, during that window becomes a recipient and gets the prompt.
  Operator-sent tasks still close once every recipient has answered.
- **Outcomes by order and when full.** An option can give the Nth accepted
  response its own outcome (`rankOutcomes`: role, group, recording, message,
  follow-up task; empty fields fall back to the option's own). An option with
  an `overflow` outcome gives every later response that outcome once it is at
  capacity, instead of asking them to choose again. Overflow arrivals are
  `answered`, not `accepted`, and never take one of the option's places. If a
  rank's role is still held (for example from an earlier task), the response
  gets the overflow outcome. A task's `fullAudio` plays with `fullMessage`
  when a chosen option is full and has no overflow. Admin and the task CSV
  show which outcome each response got (`rank-N` / `overflow`). Studio edits
  roles, groups and messages; recordings are set in the show data.
- **Roles** (`scenario.participantRoles`). These are capacity-limited and can
  belong to an exclusive set. Roles come from accepted task options or from
  Admin. Withdrawing a role marks the matching task answer `withdrawn`.
- **Tablet handover** (Admin → Participant tasks → Tablet handover). This ends
  the current occupant's participation and roles and gives the same device a
  fresh participant ID in the same audience. It then opens
  `scenario.handoverTaskId` if that is set. Earlier answers stay with the old
  ID. Messages the socket had already queued for the old occupant are rejected:
  commands carry an `occupantId`. The app clears snapshot, task, vote, group
  and alert state when its identity changes.
- **Task results** are audited per revision. They export as CSV from Admin
  ("Download task results CSV") and through
  `/api/admin/sessions/:id/export?format=tasks-csv`.

## Safety rules the implementation enforces

- A show restart cancels every task from the earlier session. Responses that
  carry an old session ID are rejected.
- Handover needs the `occupant-handover-v1` capability. An older app is told
  to update, and handover is refused.
- When the active show requires capabilities an installed app lacks, such as
  admission programs, the app first receives a `reload` explanation it can
  parse, then an `update_required` join rejection.
- Native player disposal is serialized. A new join's `configure()` waits until
  the retired player has reset the scheduler.
- On iOS the repeating admission loop keeps its queue item, so later cycles are
  not silent.
- A retired occupant is removed from group balancing and from pending
  group selection.

## Not verified — needs physical-device acceptance

The automated tests cover contracts, arbitration, admission, handover and
serialization. They do **not** cover any of the following, which have to be
checked on real iOS and Android devices on the venue network:

1. Admission intro → loop over at least three loop cycles, on iOS and Android,
   with the screen locked. The iOS check covers the retained-queue-item fix.
2. The move from admission audio to the first show cue: the admission audio
   fades out over 3 s under the first cue (skipped audio fade), with no gap
   longer than the authored one.
3. Task notifications on a locked device, the outcome screen after answering,
   and capacity races between two devices answering at the same moment.
4. Tablet handover mid-scene: the replacement sees no prior task, vote or
   alert state, and receives the handover task.
5. Show restart while a task is open: the old overlay disappears on every
   device.
6. An older installed app gets a readable update message instead of a silent
   rejection.

Swift/Kotlin changes in `packages/expo-audio-scheduler` need a **new EAS
build**. An OTA update is not enough.

## Limitations

- Task options are fixed choices. There is no free text.
- The advanced election flow from the issue is not implemented.
- Task delivery relies on the WebSocket. A force-quit or offline device does
  not get the prompt.
