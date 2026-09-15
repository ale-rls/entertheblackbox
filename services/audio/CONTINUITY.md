# Audio continuity audit

## Priority and supported contract

Preserve an existing playing stream across screen lock, app switching, scene
changes, WebSocket loss, and renewed participant leases. A brief native pause
first resumes the same connection. Reload only a failed/ended stream, a player
that fails to resume, or a clock that stops progressing beyond the recovery
window. Deliberate lock-screen pause is respected; deliberate resume rejoins
live audio rather than replaying an old buffer.

No browser implementation can promise uninterrupted sound through loss of
network connectivity, OS audio-focus interruptions, tab termination, or a
media-service crash. A frozen page cannot run a JavaScript recovery timer.
[Chrome's page lifecycle documentation](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)
explains suspension and discard behavior. Native continuous media avoids
requiring JavaScript for each narration cue, but does not remove those limits.
If zero missed audio is a release requirement, the physical-device rehearsal
below is a release gate; code tests alone cannot certify it. A requirement to
survive complete network loss also needs preloaded content and an explicit
playback/synchronization design, rather than only a live radio stream.

## Findings and changes

- Unexpected pauses previously discarded the stream and its buffer. They now
  attempt native resume first, with reload if that attempt fails to progress.
- Repeated `timeupdate` events without clock movement could clear retry state.
  Recovery now requires observed movement, and a delayed retry rechecks whether
  the native player has already recovered before replacing the source.
- `stalled` describes download progress, not necessarily playback. Buffered
  playback is preserved and no longer declared interrupted merely on that event.
- Returning from page suspension grants the native clock a fresh observation
  window. Errors and unexpected pauses can still recover immediately.
- Backend URL changes previously disposed the controller and required a new
  Start tap. They now retain playback intent and the same audio element.
  An explicit backend change still requires a new connection; it is not a
  seamless crossfade and should be avoided during narration when possible.
- Registration replies cannot overwrite a newer backend override. Lease renewal
  retains the player and subsequent diagnostic events use the current lease.
- State notifications are emitted on transitions, not on every `timeupdate`.
  Optional Media Session API failures cannot prevent playback or cleanup.
- Admin labels now distinguish stream connections from the last phone playback
  report. Recovery duration includes buffering after a failed connection and
  repeated interruption reports no longer reset its start time.

## Delivery path and latency

The phone connects to the bridge's `/stream/{participant}` endpoint. The bridge
forwards raw Icecast bytes without a deliberate chunk accumulator, disables
upstream read deadlines for the continuous response, and sends no-store and
X-Accel-Buffering headers. Actual ingress/CDN settings must also permit long
responses and disable buffering; repository configuration alone cannot prove
those deployed settings.

Liquidsoap keeps each MP3 mount fed using the bed/fallback chain. Narration is
injected server-side, so a sleeping phone needs no new JavaScript cue. The
participant roster survives ordinary WebSocket disconnects.

At 128 kbps, the configured 16 KiB connection burst represents about one second
of encoded data; the 256 KiB Icecast queue limit represents about 16 seconds of
maximum unsent backlog. The queue is not a required startup buffer. Shrinking it
can disconnect slow listeners, so this change preserves it. See
[Icecast configuration](https://icecast.org/docs/icecast-trunk/config_file/).
Native decoder buffering and control reset/play round trips also affect latency.
No code test here measures cue-to-ear latency or proves a latency reduction.

Remaining failure boundaries:

- The bridge is in the data path; restarting it closes all its proxy streams.
  Its participant-to-mount mappings are in memory. A service restart is a real
  interruption, not a case that a preserved HTML element can make seamless.
- Liquidsoap/Icecast failure can interrupt all listeners. Recovery of a transport
  does not restore narration already missed while it was disconnected.
- The default bed is digital silence. Connected/playing during that bed is not
  evidence that a narration cue was delivered or heard. Test both the configured
  bed and actual narration; do not substitute synthetic keep-alive noise as a
  supposed browser guarantee.
- OS audio-focus loss and autoplay rejection can require an explicit Resume tap.
  The player reports that condition instead of silently claiming recovery.
- A browser page reload, including the app's build-version refresh, replaces the
  document and audio element. Avoid application deployments during a performance.

## Android reproduction and release gate

Use the affected Android model/browser, then every supported Android and iOS
combination, on the actual audience Wi-Fi and phone-facing HTTPS stream URL.
Record device, OS/browser version, battery mode, build revision and network.

1. Start headphones once and verify an audible test narration. Record phone
   state alongside the admin connection count; `1 connection` alone is not a pass.
2. Lock the screen for 45 minutes. Inject recognizable narration every few
   minutes, including after long gaps with the configured default bed. Pass:
   every cue heard, no second gesture, no unexplained pause or source replacement.
3. Switch apps and return repeatedly; separately interrupt with another audio
   app/phone call and record whether automatic resume is permitted by the OS.
   Do not combine deliberate user pause with unexpected interruption results.
4. Disconnect only the control WebSocket. Audio must continue and new server-side
   narration must arrive. Reconnect it and verify no audio element replacement.
5. Introduce short Wi-Fi loss, then an outage longer than available buffering.
   Record gaps and recovery time, both locked and foregrounded. Distinguish a
   native buffer recovery from a new HTTP stream. Long-outage recovery cannot
   be described as uninterrupted or lossless.
6. Test backend switching during rehearsal: a playing phone should automatically
   start the new stream; a deliberately paused phone should stay paused. Test
   bridge/Icecast/Liquidsoap restarts separately and record missed narration.
7. At expected audience load, inject a timestamped audible marker and record the
   command time and acoustic output on several phones. Report median, p95 and
   maximum cue-to-ear delay before/after network disturbances. Change buffering
   only after these measurements, with continuity as the higher priority.

Capture the bridge's stream open/close logs and Android remote debugging media
errors for any failure. Do not accept a permanently “reconnecting” phone just
because Icecast still counts its socket.
