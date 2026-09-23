# Show clock and cue timesheet

The show server is the time authority. Every runtime cue has a server Unix-millisecond `startedAt`, a session/phase epoch, and (where applicable) `deadlineAt`. Position is `(serverNow - startedAt) / 1000`. Decision and subtitle windows are offsets from that same start. Parallel group branches share server time but have independent cue starts; transferring a participant adopts the destination cue's timestamp.

Display and Phone bootstrap from snapshot arrival time, then estimate clock offset from ping/pong midpoints. Snapshot estimates include network delay; measured offsets still have uncertainty on asymmetric links. Admin samples the authenticated status request midpoint. Its Show clock panel lists active cue starts as elapsed positions and reports stale observations. An elapsed cue counter is not a precomputed linear show duration: decisions and group branches change the route.

## App responsibilities

| App/service | Clock and media behavior |
| --- | --- |
| Server | Owns cue starts, vote windows, deadlines, epochs, and per-group timing. Video and still-narration cues end exactly `expectedDurationMs` after `startedAt`; display `video_ended` reports are ignored, so a missing or late display never changes the show's timing. |
| Display | Video, video questions, extra audio, and still narration follow corrected cue time. Errors over 250 ms seek; small errors adjust playback rate within 0.98–1.02. Pending seeks finish before another correction. Tail holds use the remaining cue duration. Decision stings seek from server `resolvedAt` and expired stings are skipped. |
| Phone | Subtitles/reaction windows follow the connection clock. Downloaded synchronized audio follows the same start, with Web Audio output latency compensation and drift correction. |
| Audio bridge | Receives elapsed `offsetSeconds` from the server for scene starts, reconnection/recovery, and group transfers. Liquidsoap cues the source at that offset. Icecast/browser buffering adds latency; stream `currentTime` is not a scene timecode and must not be sought as one. For precise audiovisual synchronization, author synchronized phone audio. |
| Admin | Read-only Show clock panel: UTC reference, offset, request round trip, shared/group cue elapsed positions. These are targets, not proof of every participant's measured playback position. |
| Studio | Authors relative cue durations and decision windows. Rehearsals use their own authoritative server engine and the same runtime clients; local authoring previews remain independently scrubbable. |
| Credits | Asset authoring/rendering; the rendered asset follows the display cue when used in a show. |
| Realtime cursor relay | Transports input, does not schedule media or decide vote deadlines. Server owns decision timing. |
| Lobby/signage/background music | Intentional ambient loops, independent of an active show's cue position. QR expiry and lobby deadlines use server time. |

## Rehearsal checks

Open a display with `?clock=1` (or append `&clock=1`). The overlay shows server UTC, measured/estimated clock status, offset, round trip/sample age, cue elapsed time, and each display cue media's actual position/drift. Outgoing paused handoff slots may appear briefly alongside the incoming slot. Open Admin's Show clock panel to compare its cue target with the display and each group's timeline.

Reload halfway through ordinary video, video-with-vote, and still+MP3 cues; verify media catches up instead of restarting. Repeat while loading slowly and after a suspended tab resumes. Check subtitles and decision closure against the cue clock. For synchronized phone scenes, enable audio on real phones and compare audible output at the venue. Repeat with group transfers and independent group cues.

Clock offset/round trip are estimates, not frame/sample accuracy guarantees. Stream buffering and browser autoplay restrictions still require real-device rehearsal. Rebuild all clients, restart the server, and hard-refresh the display service worker after deployment.
