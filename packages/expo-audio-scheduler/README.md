# @entertheblackbox/expo-audio-scheduler

Expo module and config plugin that plays local audio **layers** on a shared clock,
natively. Starts, offsets, stops and drift correction happen in Swift/Kotlin, so
cues stay on time with the screen locked — when React Native pauses JavaScript
timers (Android) or throttles them (iOS).

```ts
import AudioScheduler from '@entertheblackbox/expo-audio-scheduler';

await AudioScheduler.configure({ title: 'Enter the Blackbox', artist: 'Show audio' });
AudioScheduler.setClock(serverClock.now());           // call whenever you have a fresh estimate

// Free-running: starts now, loops until cleared.
await AudioScheduler.setLayer('bed', { uri: bedUri, loop: true, volume: 0.2 });
// Anchored: file position 0 plays at clock time startAt; a past startAt starts mid-file.
await AudioScheduler.setLayer('cue', { uri: cueUri, startAt: cue.startedAt, endAt: cue.endsAt });

AudioScheduler.addListener('onPausedChange', ({ paused, reason }) => { /* remote | interruption | route | api */ });
AudioScheduler.getTiming(); // [{ id, state, positionMs, targetMs, driftMs, error }]
```

Add the plugin to the app config: `plugins: ['@entertheblackbox/expo-audio-scheduler']`.
It adds the iOS `audio` background mode and the Android foreground-service and wake-lock
permissions; the Android `MediaSessionService` is declared in the library manifest.

## Model

- **Clock.** `setClock(nowMs)` pins the app's clock to a monotonic native clock
  (`CACurrentMediaTime` / `elapsedRealtime`), which keeps advancing while JS is asleep.
  Anchored layers wait in `waiting` until the clock has been set once.
- **Layers.** Each id holds one sound. Setting the same id with the same `uri` and `loop`
  retimes it (volume, `endAt`, `startAt`) without restarting audible playback; a different
  `uri` replaces it. `loop` is for free-running layers; anchored layers play once.
- **Transport.** `pause()` pauses every layer and keeps layers added later paused.
  `resume()` restarts free-running layers where they were and re-aligns anchored layers to
  the clock. Lock-screen play/pause, interruptions (calls) and route loss (headphones
  unplugged) pause or resume natively and emit `onPausedChange`; interruptions never
  auto-resume.
- **Drift.** Anchored layers are re-seeked when they drift more than `resyncThresholdMs`
  (default 250) from the clock.

## Platforms

- **iOS:** one `AVQueuePlayer` per layer. Anchored starts use
  `setRate(_:time:atHostTime:)` and stops use `forwardPlaybackEndTime`, so AVFoundation
  executes them even if no app code runs; loops use `AVPlayerLooper`. The `.playback`
  session must stay active (an audible layer keeps a locked app running).
- **Android:** one ExoPlayer per layer with audio focus, noisy-route handling and a partial
  wake lock owned by the engine (players never take focus from each other). Starts and stops
  are main-looper `Handler` callbacks, which keep firing while locked. A Media3
  `MediaSessionService` keeps the process in the foreground and shows the media
  notification/lock-screen controls.

Native code means a new binary: adding or changing this module needs an EAS build, not an
EAS update.
