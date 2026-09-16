# Question title and countdown monitor

Set up the production cue receiver first using
[touchdesigner-production.md](touchdesigner-production.md). Its `timelines`
Table DAT contains the current phase payload for each show timeline.

1. Add a Text DAT named `question_monitor` beside `timelines`.
2. Load [question_monitor.py](../services/trackingbox/td_scripts/question_monitor.py)
   into it.
3. In the monitor Text TOP's Text parameter, select Python expression mode:

```python
op('question_monitor').module.text('ki', absTime.frame)
```

Replace `ki` with the timeline ID in the `timelines` table (`theater` for that
branch, or `main` for a shared timeline). Passing `absTime.frame` causes the
expression to evaluate every frame, even when no new cue arrives.

For a `position-question`, the monitor displays `payload.phase.text`, then
5, 4, 3, 2, 1, 0 during the final five seconds before
`payload.phase.deadlineAt`. Zero remains during the result freeze; the next
non-question phase clears the monitor. Other phase kinds show blank text.
Existing side-label monitors continue using the `labels` table.

Keep the TouchDesigner computer clock synchronized: the helper compares local
wall-clock time to the server's absolute deadline. Reconnect snapshots restore
the current question and deadline. During an outage the receiver holds its last
phase, so this monitor counts down to zero until reconnection. Monitor
`cue_status` for connection health.

For optional one-shot triggers, put the question text in the phase's
`outgoingCues` array in Studio (each cue allows at most 120 characters). On phase
entry the receiver's callback gets `event['payload']['cue']`, with `timelineId`
and `phaseId` alongside. Those triggers are not replayed after an outage; this
monitor uses durable phase state instead. No extra outgoing cue is required for
the countdown, and adding a cue does not itself configure a Text TOP.

Verify the result on the venue's TouchDesigner monitors before running the show.
