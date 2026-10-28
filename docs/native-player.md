# Native player: setup, updates, and rehearsal

The native participant app is in `apps/native`. The browser app remains available. Both use the same server; native devices play downloaded files instead of opening Icecast/Janus streams. No Expo or public internet connection is required during a show once the app and content are installed, provided devices can reach the venue server.

## What is implemented

- Name/device-label admission, secure participant lease storage scoped to server and installation, reconnect/backoff, heartbeat recovery, and foreground reconnection.
- Timestamped native MP3 playback, late-join seeking, drift correction, background audio capability, lock-screen controls, device pause/resume, and stop on silent scenes/show end.
- Per-group audio overrides, group selection, cursor positioning, phone-button votes, reactions, narration text and subtitles. The existing server chooses branches.
- Persistent downloaded audio, SHA-256 and byte-count verification, immutable releases, separate rehearsal/production show selections, and preservation of the previous selection after failed downloads.
- Existing Admin timing telemetry via protocol pings. Download readiness is shown on the phone before joining; this scaffold does not add an Admin fleet provisioning screen.
- Automatic latest-show preparation before every join, without silently joining on stale content after a network error.
- EAS development/preview/production app channels, fingerprint runtime compatibility, and explicit update checks while disconnected. No show-content update or app reload while joined.

The native player does not implement the browser's optional post-show movement-retention opt-in. The server's existing timeout/default deletion policy continues to apply. There is no native streaming/live-microphone fallback or device-management service.

## First local run

Use Node 22.13+ and the repo's pnpm 9.12.2. Run `pnpm install` at the repository root. Expo Go is not the acceptance environment for background playback; install a development or preview build.

1. In Studio export the actual show JSON. Put its MP3s in the venue server's media directory, including all group overrides and group-branch instructions.
2. Publish a show channel from the repository root:

   ```sh
   pnpm publish-native-show /absolute/path/show.json /absolute/path/content/media rehearsal
   ```

   This creates `native-shows/audio/<sha256>.mp3`, `native-shows/releases/<revision>.json`, and `native-shows/channels/rehearsal.json` under that media directory. It collects phone audio from every phase and branch. Each compressed MP3 must be at most 64 MiB; split larger recordings into scenes. Release revisions are computed automatically from the manifest, without changing the app version.

3. Start the existing server with `SCENARIO_PATH` pointing to that same show and `MEDIA_MANIFEST_PATH` pointing to its normal media manifest. This publisher does not select/restart the server's scenario or replace Studio publishing. Use the existing scenario validation command before rehearsal. The app verifies `scenarioVersion` against cues; use distinct scenario versions when changing the graph. Server and all devices must use the intended content release, even when only audio bytes change.
4. Check `https://YOUR_SERVER/media/native-shows/channels/rehearsal.json` is reachable. Use your actual server origin, without `/phone/` or another path. The venue server serves the channel with `no-store` and hashed audio with immutable caching.
5. In the app enter the server, choose **rehearsal**, enter a name/device label, and tap **Update show & join**. Every join fetches the current channel manifest and verifies/downloads its complete audio set before admission. Verified cached files are reused. A failed freshness check or download prevents joining; an older saved release is never used silently. **Download / update show** can prepare devices ahead of time; **Inspect saved show** verifies the saved copy without fetching the channel, but joining still requires a fresh check. Downloads include every possible group track.
6. Start/operate the show through the existing Admin UI. Timing reports go to its existing timing monitor. Test two differently assigned devices before adding the fleet.

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

Choose your final bundle identifier before making a store build; the checked-in `org.entertheblackbox.player` is a scaffold default. Match `EXPO_PUBLIC_SERVER_BUILD_VERSION` to the server's `BUILD_VERSION`; the current server sends a soft reload notice on mismatch. The native app shows that notice without interrupting a performance.

Set the same values in EAS environments **development**, **preview**, and **production** (dashboard or `eas env:create --environment preview --name EXPO_PUBLIC_EAS_PROJECT_ID --value YOUR_PROJECT_UUID --visibility plaintext`, repeated for the other values/environments). These identifiers and URLs are public configuration, not secrets. Set `ALLOW_INSECURE_LAN=1` in the development and preview environments too, so their update fingerprints match their builds; leave it unset or `0` in production. Keep bundle ID, owner and project UUID consistent between each build and its updates.

```sh
eas device:create                         # register each iPhone for internal builds
eas build --profile preview --platform all
```

Install the Android APK and registered-device iOS build using EAS's links. Register new iPhones before building or resigning the iOS app. For a custom development client, use the `development` profile and `pnpm start`. A preview build runs independently of Metro.

## Publish directly from Studio

Open Studio on the venue server at `/studio/`, open the draft, and choose **File → Publish to devices…**. Sign in with the same operator account used for Admin, choose **Rehearsal** or **Production**, then press **Publish to devices**. The panel reports the published scenario version, audio-file count, and release revision. Phones pick up the selected channel on their next **Update show & join**.

The action compiles the current draft, validates the graph on the server, and invokes the same release publisher as the CLI. Every referenced MP3 must already exist in the server's media directory; sync newly uploaded media before publishing. Missing/invalid audio leaves the previous channel selected and produces an error. Concurrent publications are rejected, and publishing is disabled/rejected while a live show is active.

This publishes the native audio channel only. It does not publish the scenario to PocketBase, change the active server show, or send an Expo update. Use the existing PocketBase publishing/active-show flow separately and ensure the server scenario matches the device release. The standalone Vite Studio has no publishing API; use the Studio served by the venue server. The CLI below remains available for scripted deployment.

## Local background music

Install the app update containing background-music support before publishing a release with music. Older native clients cannot verify the extended manifest. Releases without music remain compatible.

Upload the music MP3 to the shared media library (Studio **Media library**), the same place narration audio goes. Then, in **File → Publish to devices…**, choose it under **Background music** and set its volume (greater than zero, at most 1; default 0.2). Publishing pulls the chosen file from the library onto the server before the release is hashed, so it does not need to be copied there by hand. The music must be real audible show content. No track is bundled or chosen automatically. Set these fields for every publication; choosing **No background music** publishes a release without music. The existing Admin streaming-music controls do not configure this local layer.

The CLI supports the same settings, but reads the music from the media directory you pass it and does not pull from the library:

```sh
pnpm publish-native-show /absolute/path/show.json /absolute/path/content/media rehearsal music/atmosphere.mp3 0.2
```

Publishing includes the music in the hashed, verified downloads, and volume changes produce a new release revision. A missing music file prevents channel promotion. Join downloads the release before admission. On admission, the music plays as a looping `bed` layer of the native audio scheduler (below), beneath the narration `cue` layer. Skips, auto-advances, narration-free phases and temporary control connection loss leave this loop playing. Device pause stops both layers; explicit resume rejoins narration at the current show position. Leaving or ending the participant session releases both layers. Lock-screen controls pause and resume the whole scheduler natively.

This is continuous local playback, not streaming or pocket mode. Audible background playback supports the intended background operation; it does not prove that all OS interruptions or suspension conditions are handled. A silent recording, muted device, or an audio-session flag is not a guaranteed keep-alive mechanism.

## Native audio scheduling

Playback runs in `packages/expo-audio-scheduler`, an Expo module with a config plugin (see its README). The app hands each cue to it as a layer anchored to server time (`startAt`/`endAt`) and keeps its clock calibrated; native code then starts the clip at the right position, stops it at the cue end and corrects drift, without JavaScript timers. This matters behind a locked screen: React Native pauses JS timers on Android and throttles them on iOS, which previously left narration unplayed (Android) or cut off (iOS).

Cues still *arrive* through JavaScript over the WebSocket. Android delivers socket messages to JS while locked, and the app's Android foreground media service keeps the process alive; the client heartbeat is a JS timer, so it pauses while locked (admission is not tied to it). On iOS, the app stays running only while audio is audible, so keep the music bed playing through narration-free stretches.

The module is native code: changing it needs a new EAS build, not an EAS update.

Before production, use installed builds on each supported iPhone/Android model. Keep devices locked for the full show, including at least ten minutes of music without narration, then exercise repeated operator skips, timed advances, group changes and reconnects. Verify music remains audible and every correct narration starts at the show position. Check lock-screen pause/resume stops/starts both layers, phone calls and headphone removal, and leave/show end cleanup. Record cue-to-ear delay at audience-scale load. These physical checks have not been performed by automated tests.

## Two independent update systems

| Change | Mechanism | New installed binary? |
| --- | --- | --- |
| Audio files and authored show content | Publish rehearsal/production show channel; download between shows | No |
| Compatible app JavaScript/UI fixes | EAS Update on preview/production | No |
| Expo SDK, native modules, permissions, native config | EAS Build, then installation/store rollout | Yes |

App EAS channel names are **preview** and **production**. Show channel names are **rehearsal** and **production**, selectable independently in the app. EAS channels distribute application code; they do not publish show content.

For a JavaScript update, from `apps/native`:

```sh
eas update --channel preview --environment preview --message 'Describe the change'
# Rehearse on installed preview builds, then:
eas update --channel production --environment production --message 'Describe the change'
```

On each device, leave the show and tap **Check & install app update**. The update downloads and restarts the app only through that explicit action. `runtimeVersion: { policy: 'fingerprint' }` keeps incompatible native updates away from existing binaries. Do not force a matching runtime to bypass a new binary requirement. EAS Update remains subject to Apple/Google rules; it is not a review bypass.

For show content, rerun the publisher with the desired channel after preparing the matching server show:

```sh
pnpm publish-native-show /absolute/path/show.json /absolute/path/content/media production
```

The pointer changes only after all referenced audio files exist. On a remote host, upload hashed audio and release JSON first, then atomically replace the channel JSON last. Keep old releases/assets so installed devices and rollback remain valid. Roll back by atomically replacing the channel JSON with a saved release manifest; restore the corresponding server scenario separately if necessary. Devices select the replacement only after a successful download. Every new join automatically checks the current channel. Devices already joined keep their selected release until they leave; publishing does not interrupt an active performance. Publish before admitting participants and avoid changing the channel during admission, so all participants join the intended revision. The running server scenario must still match that release. Old on-device audio is retained; cache cleanup is a future fleet-management feature.

## Build for the stores

From `apps/native` after the physical rehearsal:

```sh
eas build --profile production --platform all
eas submit --profile production --platform ios --latest
eas submit --profile production --platform android --latest
```

Submission requires your Apple/Google accounts and configured credentials. Complete the app icon/splash branding, listings, privacy policy/data disclosures, and review instructions in App Store Connect/Play Console. Provide a reachable demo venue and downloadable test show so reviewers can exercise the app. EAS upload does not itself approve or publish the app. iOS TestFlight and Android testing tracks are suitable before a public rollout.

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
