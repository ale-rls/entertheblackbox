# Video with synchronized phone audio

In Studio, select **Video + synchronized phone audio** in the scene's Component
type selector. Choose the picture under **Video**, and the separate MP3 under
**Phone headphones → Synchronized phone soundtrack (MP3)**. Export both from the
same editing timeline, retaining identical opening silence and alignment.

The production picture plays on **/display/**. Its embedded audio and optional
extra display track are muted in this mode, including when display sound has
been enabled. Existing video, image + MP3, extra display audio, and streamed phone
narration remain available. Switching back to Video restores its normal behavior;
the selected phone MP3 then uses the existing stream route.

This first mode supports a video scene with one common soundtrack. It does not
replace group narration or add synchronized audio to position-vote scenes. Remove
group soundtrack overrides before using this mode; schema validation rejects
ambiguous combinations. Existing group and vote modes retain their behavior.

## Running the scene

1. Open the display page on the computer feeding the screen/projector. Wait for
   its existing media download to finish.
2. Audience members join on their phones and tap **Enable synchronized audio**.
   Keep the page open in the foreground for these scenes. If the show also uses
   streamed narration, enable **Start headphones** as usual as well.
3. Phones preload synchronized MP3s after joining. The phone status reports active
   soundtrack preparation, blocked playback, and errors. Failed active downloads
   can be retried with the enable button.
4. Cue the scene. The server announces a future start, by default three seconds
   away. Studio's **Preparation interval** can be set from 1–30 seconds. This time
   precedes the media timeline; it does not consume the video's duration.
5. Video and local Web Audio playback follow the shared server clock. A phone or
   display arriving late catches up to the current position. An identical
   reconnect snapshot does not restart phone audio. Scene changes cancel old
   playback and pending decodes.
6. When leaving this mode, previously enabled streaming audio reconnects fresh,
   discarding buffered old narration. Returning to streaming can incur its normal
   buffering delay. A deliberately paused stream stays paused.

Downloads are sequential in the background with a 64 MiB compressed-memory cache;
only the active track is decoded. Evicted tracks may need downloading again.
The preparation interval is not an all-phones-ready barrier: a slow or blocked
phone joins late and may miss the opening. There is currently no operator-side
per-phone synchronized-readiness panel. Rehearse and allow preparation time before
critical scenes, especially after first joining.

## Calibrating the actual outputs

Phones estimate server time using WebSocket ping/pong midpoint samples. Audio is
scheduled on the Web Audio clock, with browser-reported base/output latency
compensation and bounded rate corrections. Large discontinuities rejoin the
current position. The display follows the same timeline and corrects drift.
These are software timing controls, not measurements of audible or projected
output and not a promise of sample-accurate sync across arbitrary devices.

Studio's **Picture timing adjustment** accepts -2000 to +2000 ms. Positive delays
the picture; negative advances it to compensate for projector/NDI output latency.
A negative adjustment needs enough preparation time to start the video early.
Use a flash/click test with the actual display chain and representative phones.
Prefer wired headphones for predictable timing. Test Bluetooth independently.

Rehearse normal starts, long clips, manual skips, late joins, brief disconnects,
phone audio suspension/resume, and stream → synchronized → stream transitions.
Phones must remain open; locked-screen behavior is not guaranteed by this mode.
The video stays muted even when the display's sound control is pressed. Existing
separately configured applause/boo effects remain independent of the soundtrack.
