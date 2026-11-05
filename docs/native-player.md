# Native player: setup, updates, and rehearsal

The native participant app is in `apps/native`. It is the only supported participant client, for both audiences and all loan tablets. Browser participant routes show native-app joining instructions; Icecast/Janus streams are retired from production. Native devices play verified downloaded files. No Expo or public internet connection is required during a show once the app and content are installed, provided devices can reach the venue server.

## What is implemented

- Name/device-label admission, secure participant lease storage scoped to server and installation, reconnect/backoff, heartbeat recovery, and foreground reconnection.
- Timestamped native MP3 playback, late-join seeking, drift correction, background audio capability, lock-screen controls, device pause/resume, and stop on silent scenes/show end.
- Per-group audio overrides, group selection, cursor positioning, phone-button votes, reactions. Narration text, subtitles and scene titles stay off participant screens. The existing server chooses branches.
- Persistent downloaded audio, SHA-256 and byte-count verification, immutable releases, a release pinned to the server’s active show, and preservation of the previous selection after failed downloads.
- Existing Admin timing telemetry via protocol pings. Download readiness is shown on the phone before joining; this scaffold does not add an Admin fleet provisioning screen.
- Automatic latest-show preparation before every join, without silently joining on stale content after a network error.
- EAS development/preview/production app channels, fingerprint runtime compatibility, and explicit update checks while disconnected. No show-content update or app reload while joined.

The native player does not implement the browser's optional post-show movement-retention opt-in. The server's existing timeout/default deletion policy continues to apply. There is no native streaming/live-microphone fallback or device-management service.

## Stage companion screens

The native UI uses a dark stage-focused layout without header artwork or footer branding. Enter a name on the welcome screen; **Device settings** contains the venue, download/inspect actions and app updates. During a session, **Device details** exposes connection/audio diagnostics without allowing content updates. Leaving returns to setup.

Live scenes show participant guidance and group, server-provided voting/group choices and reaction windows. Cursor input occupies the full screen width, with drag control and accessible direction buttons. Closed or expired votes and disconnected sessions cannot submit answers. Native lock-screen pauses are reflected in the resume control.

The full-width audio field is a playback activity animation driven by the native scheduler's playing foreground cue, excluding the music bed. It is not a measured waveform or a guarantee of audible output. Animation stops when paused/backgrounded and stays static with Reduce Motion enabled. Existing videos/images remain on the shared display; the current protocol has no participant-phone media source.

## First local run

Use Node 22.13+ and the repo's pnpm 9.12.2. Run `pnpm install` at the repository root. Expo Go is not the acceptance environment for background playback; install a development or preview build.

1. Open Studio on the venue server, upload the referenced media and click **Publish** (top right of the Studio editor). This publishes and selects one version for all displays and native devices. See [the unified publishing guide](publishing.md).
2. In the app enter the venue server and your name, then tap **Update show & join**. Every join verifies/downloads the active show's audio before admission. Cached verified files are reused; failed checks block joining. **Download / update show** prepares devices ahead of time. **Inspect saved show** checks the saved copy, but joining still requires a fresh check.
3. Start and operate the show through Admin. Test two differently assigned devices before adding the fleet.

Each MP3 must be at most 64 MiB. Native files and show versions are generated automatically by Studio publication. No separate channel publication or activation is required.

For development on a Mac with Xcode, `cd apps/native && ALLOW_INSECURE_LAN=1 pnpm ios`. Android uses `ALLOW_INSECURE_LAN=1 pnpm android`. Preview/development EAS profiles also set this flag. Internal builds permit HTTP for venue testing, but use trusted HTTPS/WSS for production/store builds. iOS local-network permission must be granted. Never put signing keys, tokens, or private script/media files into git.

## Connect your Expo project

Run these commands inside `apps/native`, using your installed EAS CLI:

```sh
eas login
eas init
```

The app uses a dynamic `app.config.ts`. It falls back to this show's EAS project (`b9d7bb05-…`, owner `manusnijhoff`), so `eas update` works without exporting anything. To point it at a different project, set the environment variables below. Create an ignored `apps/native/.env.local` with:

```dotenv
EXPO_PUBLIC_EAS_PROJECT_ID=YOUR_PROJECT_UUID
EXPO_OWNER=YOUR_EXPO_ACCOUNT_OR_ORGANIZATION
APP_BUNDLE_ID=YOUR_OWN_REVERSE_DNS_APP_ID
EXPO_PUBLIC_SHOW_SERVER=https://YOUR_SHOW_SERVER
EXPO_PUBLIC_SERVER_BUILD_VERSION=0.0.0-dev
```

The bundle identifier is `space.enabler.blackbox.app` on both platforms (the `app.config.ts` default; `APP_BUNDLE_ID` overrides it). Match `EXPO_PUBLIC_SERVER_BUILD_VERSION` to the server's `BUILD_VERSION`; the current server sends a soft reload notice on mismatch. The native app shows that notice without interrupting a performance.

Set the same values in EAS environments **development**, **preview**, and **production** (dashboard or `eas env:create --environment preview --name EXPO_PUBLIC_EAS_PROJECT_ID --value YOUR_PROJECT_UUID --visibility plaintext`, repeated for the other values/environments). These identifiers and URLs are public configuration, not secrets. Set `ALLOW_INSECURE_LAN=1` in the development and preview environments too, so their update fingerprints match their builds; leave it unset or `0` in production. Keep bundle ID, owner and project UUID consistent between each build and its updates.

```sh
eas device:create                         # register each iPhone for internal builds
eas build --profile preview --platform all
```

Install the Android APK and registered-device iOS build using EAS's links. Register new iPhones before building or resigning the iOS app. For a custom development client, use the `development` profile and `pnpm start`. A preview build runs independently of Metro.

## Publish directly from Studio

Use **Publish** (top right) in Studio served by the venue server. It validates and prepares all referenced media, native audio and optional background music before saving and selecting the show. A running performance retains its version until it ends. The separate device publishing action is retired. See [publishing.md](publishing.md) for activation and failure behavior.

### Background music

Upload an audible MP3 in Studio's **Media library**, choose it in **Publish show**, and set the volume (greater than zero, at most 1; default 0.2). The server syncs and freezes it with the release. Choose **No background music** to omit the bed. Music settings are included in the published scenario and restored when importing that publication. Missing or changed files stop publication.

The downloaded music loops beneath narration, including gaps and temporary connection loss. Pause stops both layers; resume returns narration to the current show position. Leaving or ending the session releases both layers. Install the app version with music support before using music; older clients cannot verify that extended manifest.

## Native audio scheduling

Playback runs in `packages/expo-audio-scheduler`, an Expo module with a config plugin (see its README). The app hands each cue to it as a layer anchored to server time (`startAt`/`endAt`) and keeps its clock calibrated; native code then starts the clip at the right position, stops it at the cue end and corrects drift, without JavaScript timers. Narration cues run `NARRATION_START_DELAY_MS` (400 ms, `src/cues.ts`) behind their phase, start and end alike, so phones that receive and prepare a cue in time play it from 0:00 together instead of seeking past its opening; only later arrivals seek in. Video phase audio stays on the phase clock because the display video seeks the same way. This matters behind a locked screen: React Native pauses JS timers on Android and throttles them on iOS, which previously left narration unplayed (Android) or cut off (iOS).

Cues still *arrive* through JavaScript over the WebSocket. Android delivers socket messages to JS while locked, and the app's Android foreground media service keeps the process alive; the client heartbeat is a JS timer, so it pauses while locked (admission is not tied to it). On iOS, the app stays running only while audio is audible, so keep the music bed playing through narration-free stretches.

The module is native code: changing it needs a new EAS build, not an EAS update.

Before production, use installed builds on each supported iPhone/Android model. Keep devices locked for the full show, including at least ten minutes of music without narration, then exercise repeated operator skips, timed advances, group changes and reconnects. Verify music remains audible and every correct narration starts at the show position. Check lock-screen pause/resume stops/starts both layers, phone calls and headphone removal, and leave/show end cleanup. Record cue-to-ear delay at audience-scale load. These physical checks have not been performed by automated tests.

## Show content and application software

| Change | Mechanism | New installed binary? |
| --- | --- | --- |
| Audio files and authored show content | Studio → Publish show; all outputs share the release | No |
| Compatible app JavaScript/UI fixes | EAS Update on preview/production | No |
| Expo SDK, native modules, permissions, native config | EAS Build, then installation/store rollout | Yes |

EAS **preview** and **production** distribute application code. They do not select show content. Phones always download the active show from their venue server; the old rehearsal/production content URLs are compatibility aliases for that same release.

For a JavaScript update, from `apps/native`:

```sh
eas update --channel preview --environment preview --message 'Describe the change'
# Rehearse on installed preview builds, then:
eas update --channel production --environment production --message 'Describe the change'
```

On each device, leave the show and tap **Check & install app update**. The update downloads and restarts the app only through that explicit action. `runtimeVersion: { policy: 'fingerprint' }` keeps incompatible native updates away from existing binaries. Do not force a matching runtime to bypass a new binary requirement. EAS Update remains subject to Apple/Google rules; it is not a review bypass.

For content changes, use **Publish show** once in Studio. No EAS update or installed binary is needed. Retain old server assets and native caches for running sessions and rollback; automated cache cleanup remains future work.

## Build for the stores

From `apps/native` after the physical rehearsal:

```sh
eas build --profile production --platform all
eas submit --profile production --platform ios --latest
eas submit --profile production --platform android --latest
```

Submission requires your Apple/Google accounts and configured credentials. Every store answer (categories, age/content rating, privacy labels, Data safety, foreground-service declaration, review notes, listing copy) and the remaining blockers are in [store-submission.md](store-submission.md). The production profile sets `STORE_BUILD=1` (phone-only iOS, no overlay permission on Android) and pushes the iOS listing from `apps/native/store.config.json`. EAS upload does not itself approve or publish the app. iOS TestFlight and Android testing tracks are suitable before a public rollout.

## Physical acceptance checklist

Cue scheduling is native (see **Native audio scheduling**), but cue *reception* is JavaScript over the WebSocket. Nothing here guarantees arbitrary background execution or waking a suspended iPhone after silence; keeping an audio session active does not grant that ability. Do not advertise locked-screen show control until it passes on your actual devices.

- Run the full show on a real iPhone and Android, with wired headphones first, then the intended Bluetooth devices. Record audible cue-to-ear skew against the main display; the reported drift is playback-position telemetry, not an acoustic measurement.
- Lock both devices for at least ten minutes, including a long silent section. Trigger a new cue and change groups while locked; confirm the right audio actually starts.
- Exercise late joining, switching groups to an older phase epoch, track end, silent phases, phone calls, unplugged headphones, native lock-screen pause and explicit resume.
- Disconnect Wi-Fi: the current local track may finish, but unknown future branches cannot be inferred offline. Restore Wi-Fi and verify the device seeks into the current cue rather than replaying its start.
- Interrupt a download and test corrupted audio; the previous complete show stays selected. Verify new app/show updates are unavailable while joined.
- Rehearse the full device count on venue Wi-Fi and monitor memory, battery, packet loss and output latency. Automated JS bundles/tests do not replace this acceptance.

Official references: [Expo background audio](https://docs.expo.dev/versions/v55.0.0/sdk/audio/), [internal distribution](https://docs.expo.dev/build/internal-distribution/), [runtime compatibility](https://docs.expo.dev/eas-update/runtime-versions/).


## Action notifications before store release

Build new iOS and Android binaries after adding `expo-notifications`; an OTA update alone cannot add the native module. Joining requests notification permission. Denial does not prevent participation; the app explains that it must remain open or notifications must be enabled in system settings. Alerts use generic action text (no participant names or answers) and no notification sound, to preserve show audio. Tapping the system notification opens the single-screen participant app; reconnect resumes authoritative state rather than replaying an old action.

Notifications cover unanswered group selection, open phone-button/cursor votes, and each reaction window. Physical voting and idle cursor movement do not alert. Repeated snapshots do not repeat an alert; answering, closing a window, changing phase, or leaving clears the current alert. These are local notifications triggered by received live state, not remote push. They cannot deliver new cues if the OS suspends the connection, the device is offline, or the app is force-quit.

On physical iPhone and Android release builds, allow notifications, join, lock the phone and trigger each action type. Check the lock screen and home-screen banner, tap to open the correct current controls, answer and verify cleanup. Repeat with permission denied, reconnects, repeated snapshots, phase changes, and expired windows. Check that narration/music remain audible, and test the venue network and device notification/Focus settings. Automated tests do not establish locked-screen delivery or store readiness.

Admin → Display settings → Phone show surface sets the resting show-mode background. The server pushes it over the show WebSocket as a `surface` message stamped with an `applyAt` server time (60 ms ahead). Each device waits on its measured clock offset, so all tablets switch on the same frame. New joiners receive the current colour immediately. Black clears the color; interaction and recovery controls remain visible when needed.

In show mode, text and the transparent **Hold to exit show mode** control fade out after 4 seconds without a touch, and any touch brings them back. Action prompts (votes, group choice) and problems (reconnecting, errors) never fade.

### Colour instrument

Admin → **Instrument** shows one tile per joined device, sorted by label (T2 before T10). Pick a colour, then:
- **Press** a tile to light that tablet. **Release** returns it to the resting colour. A quick tap stays lit for at least 250 ms.
- **Drag** across tiles to play them in turn.
- **All tablets** addresses every device at once.
- Keyboard: Space/Enter on a focused tile.

Each gesture is a `POST /api/admin/surface`, scheduled on the shared clock like the resting colour. It works during a running show. Devices show colours only in show mode.

### Identifying 40 tablets

1. **Label the hardware.** Put a sticker T01–T40 on each tablet's back *and* its case/charger slot. Record label ↔ serial number ↔ OS in a sheet.
2. **Set the label once.** On each tablet: Device settings → **Device label** → `T07`. The label is stored on the device (secure store), survives app updates, and is used as the device's name when it joins. The join screen then shows "This tablet: T07" instead of asking for a name.
3. **Verify with Identify.** Join all tablets, open Admin → Instrument, and press **Identify** on each tile. That tablet flashes white for 3 s with its label in large type, so you can check that sticker and label match.
4. **Watch for duplicates.** Admin flags two connected tablets with the same label. Fix it in that tablet's Device settings before the show.
5. **Charging and storage order.** Store and charge tablets in label order, so a tablet that fails to join is easy to locate from the Admin grid.

Admin → Devices → Phone audio coverage checks every scene/group against the immutable phone download with SHA-256 and byte counts. No audio assigned is distinct from a missing or corrupt file. The foreground activity visualization requires a moving native playhead and updates every 250 ms; it does not measure speaker volume or headphones.
