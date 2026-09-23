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

## Four-monitor scenes and full countdowns

For static messages, themes with a full countdown, or countdown-only scenes,
use `services/trackingbox/td_scripts/scene_monitor.py`. This is an alternative
Text TOP binding; keep the same production receiver, `cue_execute`, and
`timelines` DATs. The original `question_monitor.py` remains supported.

1. Load that file into a Text DAT named `scene_monitor` beside `timelines`.
2. Create a Text DAT named `monitor_config` with the JSON below.
3. For each physical monitor, set its Text TOP Text parameter to Python
   expression mode. Use `op('scene_monitor').module.text('M1', absTime.frame)`
   and substitute `M2`, `M3`, or `M4` for the other outputs.
4. Enable multiline text and fit the longest actual message plus the timer
   within the output. Connect each Text TOP to its corresponding monitor output.
   This helper supplies text; it does not create Window COMPs or wire cables.

```json
{
  "timeline": "ki",
  "monitors": {
    "M1": {"mode": "labels", "slots": ["y_min"]},
    "M2": {"mode": "labels", "slots": ["x_min"]},
    "M3": {"mode": "labels", "slots": ["y_max"]},
    "M4": {"mode": "labels", "slots": ["x_max"]}
  },
  "scenes": {
    "REPLACE_WITH_SELECTION_PHASE_ID": {
      "messages": {"M1": "Theme A", "M2": "Theme B", "M3": "Theme C", "M4": "Theme D"},
      "timer": {"durationMs": 60000, "offsetMs": 0, "monitors": ["M1", "M2", "M3", "M4"]}
    },
    "REPLACE_WITH_PREPARATION_PHASE_ID": {
      "timer": {"durationMs": 120000, "offsetMs": 0, "monitors": ["M1", "M2", "M3", "M4"]}
    },
    "REPLACE_WITH_PERFORMANCE_PHASE_ID": {
      "timer": {"durationMs": 60000, "offsetMs": 0, "monitors": ["M1", "M2", "M3", "M4"]}
    },
    "REPLACE_WITH_CLEAR_PHASE_ID": {}
  }
}
```

Replace all placeholder phase IDs with exact `phase.id` values from Studio or
`timelines.payload_json`, and the example themes with the production text.
Keep production configuration private and out of git. The mapping above is
an example, not a verified venue layout: identify the red and blue floor axes,
then record which physical monitors correspond to each minimum and maximum.
The renderer clears inactive axis slots automatically. For polygon/circle
labels, put the actual zone IDs in `slots`. For text independent of field
geometry, use a scene's `messages` mapping instead.

Outside configured scenes, `mode: "labels"` displays the selected field slots;
`mode: "question"` displays question text then the final five seconds;
`mode: "blank"` clears the output. A question output can be another Text TOP
using the original helper, or one of the four monitors assigned question mode.
A configured scene overrides all four defaults, so omitted messages are blank.
A scene containing only `messages` shows static text; an empty scene clears all
outputs. The timer appears on a new line below each message, or alone when no
message is supplied. Only the monitors listed in `timer.monitors` receive it.

### Timer timing and shared ownership

A timer works with narration, video, or any other phase carrying `startedAt`.
It displays `m:ss` for its entire configured duration. `offsetMs` delays the
start relative to the server's phase start, for example until an instruction
finishes. Before that offset, only the message is shown. The timer clamps to
`0:00` and stays there until the phase changes. It does not advance the show,
open the curtain, or wait for audio completion automatically.

Set the show phase duration to at least `offsetMs + durationMs` plus a visible
zero hold (for example 1000 ms). Otherwise the next phase can replace the timer
before zero is visible. Rehearse the hold and next phase timing with the curtain
operators. The preparation zero is the opening signal; the performance zero is
the closing signal. These are separate scenes with separate phase IDs.

Choose **one authoritative timeline** for all four monitor outputs using
`monitor_config.timeline`. All configured scenes must run on that timeline.
For parallel group audio, a shared sequence with `phoneAudioByGroup` keeps the
monitor timer on one common clock. If the show uses independent group branches,
choose one branch that is guaranteed to run and synchronize its phases with the
other groups in the show. Do not bind each monitor to a different group's
countdown. An empty/unstarted branch cannot drive the monitors. Ensure the
selected timeline receives a clearing phase before it rejoins: finished branch
state can otherwise remain in the receiver. This setup does not author or
synchronize the Studio graph for you.

No custom one-shot cue callback is needed. The renderer reads current phase
state each frame. Snapshot reconnects recover the original `startedAt`, so a
reconnect does not restart the timer. During a connection outage it continues
from the last received phase and holds at zero; check `cue_status` before
following a curtain signal. Missing timeline state clears the outputs. Invalid
configuration displays `MONITOR CONFIG ERROR`; correct it before the show.

### Venue verification

- Trigger one red-axis and one blue-axis question. Check the actual min/max
  texts at each end, including which two monitors go blank.
- Check any circle-zone messages explicitly; they need their own slots or
  scene messages and are not inferred from spoken instructions.
- Trigger the theme scene: four different themes, each with the same full
  one-minute clock. Check text wrapping from the audience position.
- Trigger preparation and performance: two minutes then one minute, visible
  zero holds, themes cleared, and the agreed curtain actions at zero.
- Restart the receiver halfway through a timer: the remaining time should
  recover, not return to the full duration. Reset the show and check blanking.
- Run the group audio paths together and check their instructions against the
  common timer, including any delayed timer start and the return to questions.
