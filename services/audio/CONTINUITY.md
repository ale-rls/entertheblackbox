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

## Deployed reproduction, 2026-09-15

The deployed phone bundle contained PR #59's controller methods. Two independent
HTTP consumers of one registered diagnostic stream reproduced a server-side
interruption without any browser audio element:

- First stream: EOF at 92.378 seconds; 1,472,800 bytes; approximately 11 seconds
  without new bytes before EOF. A narration was injected only into this test
  participant during capture.
- Second stream: EOF at 81.023 seconds; 1,687,000 bytes; approximately 11 seconds
  without bytes before EOF. No second soundcheck was injected. Its MP3 duration
  was 105.422 seconds, exceeding wall time by about 24 seconds even including
  the final idle interval. Delivery initially ran substantially faster than the
  nominal 16,000 bytes/second. Buffering or source catch-up can therefore add
  delay even when the network has ample throughput.
- An isolated local stack with the same source script and one encoder survived
  three eight-second generated tones at 5, 25 and 45 seconds, followed by silence,
  for the full 80-second capture. Maximum read gap was 385 ms; reset/play API
  round trips were 15–25 ms. This does not validate the deployed 100-encoder load
  or Android acoustic latency.

The end-of-narration fallback alone was not established as the root cause by
these captures. The subsequently supplied production logs below confirmed the
source timeouts and shared-clock lag.

For post-deployment verification, run `scripts/probe_stream.py` simultaneously against the
public bridge and its corresponding internal Icecast mount, using the same
participant mapping. Capture Liquidsoap late-clock/catch-up, source disconnect,
and Icecast timeout logs plus container CPU throttling/restart counters. Avoid
changing source timeout or shrinking listener buffers to mask the symptom.
The probe prints timings and byte counts without retaining narration.

### Production logs confirmed the source failure

The supplied ten-minute deployment log contains 468 Icecast source socket
timeouts and Liquidsoap `clock.main` catch-up warnings reaching 36.66 seconds.
The two-minute default-bed boundaries repeatedly precede the failures. The
bridge's `upstream-eof` records match both diagnostic connection endings.
This establishes an upstream-source interruption, independent of phone
visibility or autoplay policy.

The fix disables `send_icy_metadata` on each MP3 output. Those per-track Icecast
metadata HTTP updates are unused: the phone sets its own Media Session labels
and the bridge does not request ICY metadata in the audio response. Removing
these calls avoids synchronous metadata work on the audio clock when 100 beds
roll over together. Queue/burst sizes and source timeout are unchanged.

An independent-clock experiment was rejected because it increased scheduling
lag at 100 encoders on the test machine. It is not part of the final patch.
The improved `scripts/loadtest.sh` now fails on early EOF, HTTP errors, missing
audio, and low-speed timeouts instead of discarding curl failures. It must run
longer than 240 seconds to cover multiple default-bed loop boundaries.

### Final local verification

With only ICY updates disabled, 100 simultaneous bridge streams survived
280.118 seconds with zero errors, crossing multiple default-bed boundaries.
Generated narration was injected into three mounts during the run. The largest
observed read gap was 1.242 seconds.

Startup catch-up was still draining at the beginning: each stream delivered
about 4.70 MB (294 seconds of encoded audio) over 280 seconds of wall time.
This verifies continuity under the tested load, not a low-latency startup or
Android background-playback guarantee. Production deployment and cue-to-ear
measurements on Android remain necessary.

Liquidsoap 2.2.5 configuration validation, workspace typecheck, and all 720 tests
passed. The load-test harness passed with live streams and correctly failed for
an unavailable endpoint and clean premature EOF.
