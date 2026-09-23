# Show clock and cue timesheet

The show server is the time authority. Every runtime cue has a server Unix-millisecond `startedAt`, a session/phase epoch, and (where applicable) `deadlineAt`. Position is `(serverNow - startedAt) / 1000`. Decision and subtitle windows are offsets from that same start. Parallel group branches share server time but have independent cue starts; transferring a participant adopts the destination cue's timestamp.

Display and Phone bootstrap from snapshot arrival time, then estimate clock offset from ping/pong midpoints. Snapshot estimates include network delay; measured offsets still have uncertainty on asymmetric links. Admin samples the authenticated status request midpoint. Its integrated Show clock monitor lists active cue starts and device measurements, and reports stale observations. An elapsed cue counter is not a precomputed linear show duration: decisions and group branches change the route.

## App responsibilities

| App/service | Clock and media behavior |
| --- | --- |
| Server | Owns cue starts, vote windows, deadlines, epochs, and per-group timing. Video and still-narration cues end exactly `expectedDurationMs` after `startedAt`; display `video_ended` reports are ignored, so a missing or late display never changes the show's timing. |
| Display | Video, video questions, extra audio, and still narration follow corrected cue time. Errors over 250 ms seek; small errors adjust playback rate within 0.98–1.02. Pending seeks finish before another correction. Tail holds use the remaining cue duration. Decision stings seek from server `resolvedAt` and expired stings are skipped. |
| Phone | Subtitles/reaction windows follow the connection clock. Downloaded synchronized audio follows the same start, with Web Audio output latency compensation and drift correction. |
| Audio bridge | Receives elapsed `offsetSeconds` from the server for scene starts, reconnection/recovery, and group transfers. Liquidsoap cues the source at that offset. Icecast/browser buffering adds latency; stream `currentTime` is not a scene timecode and must not be sought as one. For precise audiovisual synchronization, author synchronized phone audio. |
| Admin | Read-only Show clock monitor: UTC reference, shared/group cue targets, and authenticated display/phone reports. Device filters and attention filtering distinguish drift, disconnected/disabled/loading devices, missing reports, and stale clocks. |
| Studio | Authors relative cue durations and decision windows. Rehearsals use their own authoritative server engine and the same runtime clients; local authoring previews remain independently scrubbable. |
| Credits | Asset authoring/rendering; the rendered asset follows the display cue when used in a show. |
| Realtime cursor relay | Transports input, does not schedule media or decide vote deadlines. Server owns decision timing. |
| Lobby/signage/background music | Intentional ambient loops, independent of an active show's cue position. QR expiry and lobby deadlines use server time. |

## Rehearsal checks

Open a display with `?clock=1` (or append `&clock=1`). The overlay shows server UTC, measured/estimated clock status, offset, round trip/sample age, cue elapsed time, and each display cue media's actual position/drift. Outgoing paused handoff slots may appear briefly alongside the incoming slot. Open Admin's Show clock monitor to compare cue targets with reported display and phone positions. Open **Show timing** on a phone for its own clock, cue, audio estimate and drift.

Reload halfway through ordinary video, video-with-vote, and still+MP3 cues; verify media catches up instead of restarting. Repeat while loading slowly and after a suspended tab resumes. Check subtitles and decision closure against the cue clock. For synchronized phone scenes, enable audio on real phones and compare audible output at the venue. Repeat with group transfers and independent group cues.

Clock offset/round trip are estimates, not frame/sample accuracy guarantees. Stream buffering and browser autoplay restrictions still require real-device rehearsal. Rebuild all clients, restart the server, and hard-refresh the display service worker after deployment.

## Integrated device reports

Displays send timing with their heartbeat every 2 seconds. Phones send it with a ping every 2 seconds while admitted. Reports contain clock calibration, offset, round trip, sample age, cue elapsed time, media position/target/drift and playback state; no media bytes or source URLs are sent. The server accepts reports only from the authenticated current display socket or admitted phone, for the current session/phase epoch; phone reports must also match the routing epoch after group transfers. Reports live in memory and are removed when the socket closes. Rehearsal reports remain in their own engine.

Admin keeps measured positions fixed until the next report, while increasing the displayed report age. Reports older than 6 seconds, or clock samples older than 30 seconds, are not shown as healthy. Within tolerance means at most 250 ms of reported drift, not guaranteed sound-at-headphones accuracy. Future cues, held media tails, and missing/disabled audio have explicit states. Ambient signage is not an active media timeline and is outside the drift roster.

Phone synchronized-audio positions are estimated from the Web Audio source anchor and playback rate, compared against the same latency-adjusted cue target used by the player. A suspended context reports disabled with no position/drift measurement. Streams have no reliable mapping between HTML stream time and cue time and therefore report **Stream drift unmeasured**; the existing per-phone audio diagnostics link supplies stream connection/recovery evidence. The on-phone **Show timing** view is collapsed by default and does not send cursor input when tapped.

Deploy server, Display, Phone and Admin builds together. Older clients still connect but appear as awaiting reports. Validate a suspended phone, a stale tab, a late display reload and an operator group transfer during venue rehearsal.
