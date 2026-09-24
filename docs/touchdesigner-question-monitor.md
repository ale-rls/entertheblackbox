# TouchDesigner question, scene, and join monitors

Set up the production cue receiver first using
[touchdesigner-production.md](touchdesigner-production.md). Its `timelines`
Table DAT contains the current phase payload for each show timeline.

For the complete four-monitor setup, follow [Four-monitor scenes and full
countdowns](#four-monitor-scenes-and-full-countdowns), then
[Pre-show join display](#pre-show-join-display-on-all-four-monitors).
That setup includes automatic voting-axis labels, the opposite-axis question
and countdown, scene themes and timers, and lobby join-screen selection.
All countdowns disappear at expiry without showing zero.

The section below is the optional question-only setup; do not use its Text TOP
binding on the same outputs as `scene_monitor`.

## Question-only output

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
5, 4, 3, 2, 1 during the final five seconds before
`payload.phase.deadlineAt`. At the deadline the countdown clears and stays
blank during the result freeze; zero is never displayed. Other phase kinds show blank text.
Existing side-label monitors continue using the `labels` table.

Keep the TouchDesigner computer clock synchronized: the helper compares local
wall-clock time to the server's absolute deadline. Reconnect snapshots restore
the current question and deadline. During an outage the receiver holds its last
phase, so this monitor finishes its countdown and stays blank until reconnection. Monitor
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
  "joinDisplay": {"enabled": true, "timeline": "main"},
  "monitors": {
    "M1": {"mode": "axis-auto", "slot": "y_min"},
    "M2": {"mode": "axis-auto", "slot": "x_min"},
    "M3": {"mode": "axis-auto", "slot": "y_max"},
    "M4": {"mode": "axis-auto", "slot": "x_max"}
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
In `axis-auto` mode, the voting axis keeps its endpoint labels while both
monitors on the other axis display the question, then the final five-second
countdown (blank during the result freeze). Changing from x to y voting
automatically swaps these roles; endpoint labels remain visible throughout
the countdown. For four-quadrant questions both axes vote, so all four outputs
show endpoint labels. Non-question and polygon fields are blank in this mode
unless overridden by a configured scene. For polygon/circle
labels, use `mode: "labels"` and put the actual zone IDs in `slots`. For text independent of field
geometry, use a scene's `messages` mapping instead.

Outside configured scenes, `mode: "axis-auto"` uses one physical axis `slot`
and applies the automatic behavior above. `mode: "labels"` displays the selected field slots;
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
finishes. Before that offset, only the message is shown. At expiry the timer disappears; neither `0` nor `0:00` is displayed.
Any static scene message remains until the phase changes. It does not advance the show,
open the curtain, or wait for audio completion automatically.

Set the show phase duration to at least `offsetMs + durationMs` to let the countdown finish. An optional
short hold after expiry makes its disappearance visible before the next scene.
Rehearse the transition with the curtain operators: the preparation timer
disappearing after `0:01` is the opening signal; the performance timer
disappearing is the closing signal. These are separate scenes with separate phase IDs.

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
from the last received phase and hides the timer at expiry; check `cue_status` before
following a curtain signal. Missing timeline state clears the outputs. Invalid
configuration displays `MONITOR CONFIG ERROR`; correct it before the show.

### Venue verification

- Trigger one red-axis and one blue-axis question. Check the actual min/max
  texts at each end, including the question on both opposite-axis monitors. Wait through the last
  five seconds and confirm only those two outputs switch to the countdown,
  then change the voting axis and verify that the roles swap.
- Check any circle-zone messages explicitly; they need their own slots or
  scene messages and are not inferred from spoken instructions.
- Trigger the theme scene: four different themes, each with the same full
  one-minute clock. Check text wrapping from the audience position.
- Trigger preparation and performance: two minutes then one minute, no zero displayed,
  themes cleared, and the agreed curtain actions when the timer disappears.
- Restart the receiver halfway through a timer: the remaining time should
  recover, not return to the full duration. Reset the show and check that text
  clears; with join-display routing enabled, the idle lobby shows the join screen.
- Run the group audio paths together and check their instructions against the
  common timer, including any delayed timer start and the return to questions.


## Pre-show join display on all four monitors

Use the existing live browser join display as a shared video TOP named
`join_display`. This must be a live capture/feed of that display, including its
current QR code, not a screenshot or a fixed QR URL. The browser owns QR grant
rotation, expiry, and visibility. Connect your venue's existing display capture
or video transport to this TOP; the Python helper does not capture the browser
or generate a QR image. Do not open another `/display` client or attach a second
`display_join` WebSocket just to feed these monitors.

For each monitor, insert a Switch TOP before the final output:

- Input 0: that monitor's existing text output (question/labels/themes/timer).
- Input 1: the same live `join_display` TOP, fitted without cropping the QR code.
- Index parameter, Python expression mode:
  `op('scene_monitor').module.output_index(absTime.frame)`.

Set `joinDisplay` in `monitor_config` as shown in the example above. It selects
input 1 while the configured lobby timeline's phase kind is `idle`, and input 0
as soon as that timeline leaves idle. This uses `main` independently of the
`ki` timeline that supplies question text: the group timeline may not exist yet
before the show starts. If your lobby uses another timeline, set its exact ID.
A pre-show video/narration phase is not an idle lobby and will not activate this
selector. The selector does not alter the show start or admission policy.

Omitting `joinDisplay`, setting `enabled` to false, missing/reset timeline state,
or malformed configuration selects input 0. Reconnect snapshots restore the
selection. During an outage the last phase is retained, so monitor `cue_status`;
an undelivered show-start event cannot switch the outputs. Returning the main
timeline to idle selects the join screen again.

Before the audience enters, verify that all four monitors show the live join
screen, scan each QR with a phone, and check that QR rotation/visibility matches
the source browser. Start the show and confirm that all four outputs switch to
their text scenes. Reset to the lobby and confirm the join screen returns.
This requires the live video connection in the venue `.toe`; loading the Python
script alone supplies only the automatic selector.
