# Authored stage monitor displays

M1–M4 are browser pages in the display app, independent of the main projection,
group displays and lobby signage. They do not use TouchDesigner monitor helpers.
All participant phones/tablets use the native iOS/Android app; monitor browsers
are installation outputs, not participant clients.

## Authoring

Select a phase in Studio and open **Stage monitors**, then M1, M2, M3 or M4.
Add a cue and choose video, image, text, placeholder or blank. Video/image cues
use the shared media library and manifest, including missing-media diagnostics
and usage references. Placeholders require no media and remain visibly labelled
as placeholders. Text preserves line breaks. Images can have a caption.

`monitorCues` is a phase field, including idle and group-selection phases:

```json
{
  "M1": [
    { "kind": "text", "text": "Where do you stand?", "startMs": 0 },
    { "kind": "image", "src": "answer.png", "fit": "contain", "startMs": 5000 },
    { "kind": "blank", "startMs": 20000 }
  ],
  "M2": [
    { "kind": "video", "src": "monitor-loop.mp4", "fit": "cover", "loop": true, "startMs": 0 }
  ],
  "M3": [
    { "kind": "placeholder", "text": "Answer image to come", "startMs": 0 }
  ]
}
```

Cues must have increasing, unique `startMs` values. Each replaces the previous
cue on that screen. Optional `durationMs` ends a cue early; the gap is black.
Otherwise it holds until the next cue or phase. No cues means black. Finite
videos hold their final frame; looping videos wrap against server elapsed time.
Video sound is always muted. Use native audio for participant narration.

Question-first/answers-second can be authored as two cues at different offsets.
Labels are authored explicitly; floor axes are not guessed from question text.
Countdowns can be authored as timed text cues or video; there is no automatic
question countdown/axis-routing helper. Ensure the main phase lasts long enough
for its monitor cues. A phase transition always cancels its remaining cues.

**Timing owner:** monitors follow the main server timeline by default. Set scenario `monitorGroupId` to a declared audience group to follow its independent scene clock instead, including reconnects and operator jumps. While that path waits for reunion, screens clear; at reunion they follow the shared scene again. This requires a server build supporting `monitorGroupId`.

Without this setting, group
audio may run independently, but monitor cues on an independent group path do
not drive these four screens. Put shared screen cues on main phases and use
group-targeted narration there when a common question/monitor clock is needed.
The browser never advances the show or changes its deadline.

## Deployment and preparation

Build `apps/display`, `apps/studio` and `apps/admin` after deploying the server
and scenario. The display's build-time `DISPLAY_TOKEN` must match the server.
Open one browser per physical monitor:

- `/display/?monitor=M1&setup=1`
- `/display/?monitor=M2&setup=1`
- `/display/?monitor=M3&setup=1`
- `/display/?monitor=M4&setup=1`

Use a trusted HTTPS origin (or localhost) for browser Cache Storage and Web
Crypto. Complete the whole-show media download before starting. The existing
display media store checks file lengths and SHA-256 hashes, including cached
files, retries failures, and creates Blob URLs for playback. It currently
prepares the complete show manifest, not just the selected screen's assets.
Budget disk space on each screen accordingly. Readiness is local to each
monitor; show start is not automatically blocked on all four screens.

The setup overlay shows cache progress, connection, phase and elapsed time.
Every monitor page has an **Enter fullscreen** button in the top-right corner,
including without `setup=1`. It hides in fullscreen and returns when you exit
(for example with Escape). Browser kiosk mode is also supported. Remove `setup=1` for the show;
errors/disconnection remain visible. Refresh after a new deployment to replace
the service-worker shell. A scenario-version change revalidates media; publication assigns a new
version automatically. Studio display preview creates its
own revision and includes direct M1–M4 links.

Each ID has its own authenticated connection. Reopening M2 replaces only M2,
not M1 or the main projection. Reconnect restores the current snapshot and seeks
to server elapsed time. During an outage, the last received sequence continues
on that clock; it cannot know about new phases until reconnected. Cached media
does not make show control independent of the server.

## Venue acceptance

1. Open the main display and all four monitors together; verify each is ready.
2. Run different video/image/text/placeholder cues on all four outputs. Check
   text readability, image fit, muted sound, timed switching and black gaps.
3. Join midway through a clip and reconnect midway through a loop: playback
   must seek to elapsed show time, not restart at zero.
4. Jump, restart and return to idle; check old cues disappear. Open M2 again
   and verify no other display is replaced.
5. Interrupt the network and check the visible connection warning and recovery.
   Test a missing/corrupt file: the page must not report media ready.
6. Run native participant audio alongside the screens on the venue network.
   Accept synchronization with the actual devices, not only unit tests.

The general `/api/cues` feed and tracking integration remain available for
lighting or other external systems. They are not required by the monitor pages.

Publish with the top-right **Publish** button in Studio. Monitors, main display and native devices share that publication; no monitor release is required. Asset paths and scenario versions are assigned automatically. See [publishing.md](publishing.md).
