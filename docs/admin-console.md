# Admin console

The Admin page separates operating a performance from venue setup. Its status bar remains visible across Show, Devices, Displays and Setup; tab selection is remembered on this browser.

- **Show:** current scene and measured timing, next action, current/next routes and the expandable graph. Restart and return-to-idle live under Other show actions and still require confirmation. Time is synchronized to the server; missing deadlines show elapsed time instead of an invented countdown.
- **Grouped stages:** each path has its own title, participant count, state, timing and scoped controls. Finished paths wait at reunion; empty paths cannot advance. Choosing states retain assignment blockers and the explicit disconnected-participant recovery option. Nested splits appear inside their parent lane and expose scoped start/reunion controls. The status API supplies parent group IDs and scene deadlines; older servers fall back to flat lanes and elapsed time. The server decides when to resume the shared timeline. Early reunion remains confirmed.
- **Devices:** native participants, assignments and measured timing diagnostics. A stale report does not establish that headphone playback stopped.
- **Displays:** main, group and M1–M4 links. Main connectivity comes from the existing API; other outputs say Not reported until telemetry exists. Open the link on its target screen and use that page's fullscreen control. Admin cannot fullscreen another browser remotely.
- **Setup:** active show selection, scheduling, joining instructions/QR, lobby text/video and replayed cursors. Author and publish show content in Studio. Active-show changes wait for the current performance to end; lobby text changes apply live, as stated in their editor.

Stale connection data disables show actions. The existing server guards against stale phase/epoch/session actions and remains authoritative. No new pause, seek, remote fullscreen, or fleet-download-readiness capability is implied. Retired streaming controls are removed from the main console; the historical read-only audio diagnostics URL remains available.

Unified show publication and the normal monitor fullscreen affordance are delivered separately in PRs #220 and #217. This redesign does not duplicate either implementation.
