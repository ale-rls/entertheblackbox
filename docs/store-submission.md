# Store submission: App Store and Google Play

Everything needed to submit the native participant app (`apps/native`) to both stores, sorted by where it is entered. Answers below describe the app as it is in this repo; re-check them whenever the app gains a permission, a data type or a new screen.

Store-side files in the repo:

- `apps/native/store.config.json`: App Store listing, category and age-rating answers for [EAS Metadata](https://docs.expo.dev/eas/metadata/) (`eas metadata:push`). Lint with `eas metadata:lint`.
- `apps/native/eas.json`: the `production` profile sets `STORE_BUILD=1` and submits iOS metadata from `store.config.json`, and Android to the **internal** track as a **draft**.
- `apps/native/app.config.ts`: `STORE_BUILD=1` makes store builds phone-only on iOS and removes Android's overlay permission. It is gated so preview builds keep their update fingerprint.

Reviewer contact details (name, email, phone) are entered in App Store Connect only. This is a public repository.

## 1. Blockers before the first submission

| Blocker | Why | Issue |
| --- | --- | --- |
| App icon, adaptive icon, splash | Without them the build ships Expo's placeholder icon. App Store Connect rejects a missing 1024×1024 icon. | #203 |
| Store join screen | The current screen asks for a server URL and shows rehearsal/production, update and diagnostics controls. Review reads this as a test app (Apple 2.1/2.2, 4.2), and visitors can't use it. | #204 |
| Reviewer access | Both stores must be able to use the app, which only works during a live session. | #205 |
| Privacy policy and visitor notice | Both stores require a public privacy policy URL. Its retention and deletion answers are director decisions. | #4 |
| HTTPS production server | Store builds allow only HTTPS/WSS (`ALLOW_INSECURE_LAN` unset). | — |

## 2. Decisions to confirm

- **Bundle ID / package name.** These are permanent once published. Local and preview builds use `space.enabler.blackbox.app` (via `APP_BUNDLE_ID`). The checked-in fallback `org.entertheblackbox.player` is a scaffold default. Recommended: `space.enabler.blackbox.app` for production too, set as `APP_BUNDLE_ID` in the EAS **production** environment, and the same ID for the App Store Connect app and the Play package.
- **Age rating.** The answers below assume the narration and video contain none of the listed themes. Answer from the script. If the piece has, for example, mature themes, horror or strong language, change the matching `advisory` value in `store.config.json` and the Play questionnaire to match.
- **Target audience.** Recommended: **18 and over** (add 16–17 if those visitors attend). Selecting any age under 13 puts the app under Google's Families policy and Apple's Kids rules.
- **Languages.** The listing is en-US only. Add localisations (e.g. `nl-NL`, `de-DE`) under `apple.info` and in Play's listing if the audience needs them. The app UI itself is English.
- **Rights holder.** Fill in `copyright` in `store.config.json`, and the developer/seller name on both stores.

## 3. Build and upload

EAS **production** environment variables. These are public configuration, not secrets:

| Variable | Value |
| --- | --- |
| `APP_BUNDLE_ID` | the chosen ID (see above) |
| `EXPO_PUBLIC_SHOW_SERVER` | the HTTPS show server origin |
| `EXPO_PUBLIC_SERVER_BUILD_VERSION` | the server's `BUILD_VERSION` |
| `ALLOW_INSECURE_LAN` | unset (or `0`) |

`STORE_BUILD=1` comes from `eas.json`; don't set it in the dashboard.

```sh
cd apps/native
eas build --profile production --platform all     # remote versioning auto-increments build numbers
eas metadata:push                                 # iOS listing + age rating from store.config.json
eas submit --profile production --platform ios --latest      # → TestFlight
eas submit --profile production --platform android --latest  # → Play internal testing, draft
```

- **Google Play:** the **first** upload must be done by hand in Play Console (Test and release → Internal testing → Create release → upload the `.aab` from the EAS build page). Google only accepts API uploads after that. EAS needs a Google service-account JSON key to submit; keep it outside the repo.
- **App Store:** the App Store Connect app must exist first (Apps → + → New App), with the same bundle ID. `eas submit` asks for the Apple ID and the app, or reads `ascAppId` if added to `submit.production.ios`.
- **Updates:** production builds receive updates on the `production` channel: `eas update --channel production --environment production --platform ios` (then `android`). Only JS changes travel this way. Native changes need a new store build and review.

## 4. Apple App Store Connect

### App information

| Field | Value |
| --- | --- |
| Name | Enter the Blackbox |
| Subtitle | Your phone, part of the show |
| Primary category | **Entertainment** |
| Secondary category | none |
| Content rights | Does not contain, show or access third-party content (all audio is the production's own; confirm music licensing) |
| Price | Free, no in-app purchases |
| Availability | Countries where performances run (or all) |

**Why Entertainment:** the app is an audience companion for a live performance. Apple's Music category is for listening or creating music, and Social Networking would imply messaging between users, which this app doesn't have.

### Age rating (questionnaire)

Answers already in `store.config.json`, pending the script check in §2:

- Every content descriptor (violence, sexual content, profanity, horror, mature themes, alcohol/drugs, medical, simulated gambling, contests): **None**.
- Unrestricted web access: **No**. Gambling: **No**. Made for Kids: **No**.
- **Questions EAS Metadata doesn't push**, answered in App Store Connect:
  - User-generated content: **No**. Votes, cursor positions and reactions aren't published content.
  - Messaging or chat between users: **No**.
  - Advertising: **No**. Parental controls: **No**. Age assurance: **No**.
  - Health or wellness topics: **No**.
- **Expected rating:** the lowest band (4+), unless the script changes the descriptors.

### App Privacy ("nutrition label")

Tracking: **No**. The app has no advertising SDKs and no cross-app tracking, so no App Tracking Transparency prompt.

| Data type (Apple category) | Collected because | Linked to user | Tracking |
| --- | --- | --- | --- |
| **Contact Info → Name** | App functionality: the participant's self-entered name (1–40 characters), shown on the operator roster and stored with session records | Yes | No |
| **User Content → Other User Content** | App functionality: votes, group choices, applause/boo reactions and touch-cursor positions sent during the show. Cursor movement is stored per participant until the post-show deletion. | Yes | No |
| **Identifiers → User ID** | App functionality: a server-issued participant lease kept in the device keychain so a reconnecting phone keeps its seat | Yes | No |

**Not collected (don't declare):**
- IP address: used only in memory for join rate limiting, never stored.
- Clock and playback timing reports: kept in server memory for the live monitor, not retained.
- Downloaded show audio: content going to the device, not data collected from it.
- No location, contacts, photos, microphone, health, purchases, browsing history or crash analytics.

Re-check this table against #4 once retention is decided. If session exports keep names longer, the answers stay the same, but the privacy policy has to say so.

### Export compliance

The app uses only standard HTTPS/TLS. `ITSAppUsesNonExemptEncryption` is already `false` in `app.config.ts`, so App Store Connect won't ask per build.

### Capabilities that review will look at

- **Background audio** (`UIBackgroundModes: audio`, from the scheduler plugin). This is the core function: show narration and music keep playing, on schedule, with the phone locked in a pocket. It's explained in the review notes.
- **Notifications.** Local notifications only, asking the participant to act; requested at Join. `expo-notifications` also adds the push (`aps-environment`) entitlement. EAS enables it on the App ID, and no push server is used.
- **Local network** (`NSLocalNetworkUsageDescription`). Kept so venue setups on a local server work; the store build talks to the HTTPS server.

### App Review information

- **Sign-in required:** No. Leave demo account fields empty.
- **Contact:** a person reachable during review (entered in App Store Connect, not in git).
- **Notes:** paste and fill in the following, once #204 and #205 are done:

```text
Enter the Blackbox is the companion app for a live, participatory theatre performance. It only does something while a performance is running on the venue's show server.

To review:
1. Open the app. The demo session on REPLACE_WITH_REVIEW_SERVER is running.
2. Enter any name and tap "Join". The app downloads the show audio, then joins the running demo session.
3. Put on headphones: the narration for the current scene plays. Lock the screen: playback continues and the next cue starts on time.
4. Choose a group, vote and drag the cursor area when the scene asks for it. A notification announces each action.

Background audio (UIBackgroundModes: audio) plays the performance's narration and music while the phone is locked in a pocket; this is the app's core function. Notifications are local only and announce actions during the performance. No account or sign-in exists.

A recording of a real performance: REPLACE_WITH_VIDEO_LINK
```

- **Attachment:** a 1–2 minute screen recording of the app during a rehearsal helps if the demo session is down during review.

### Screenshots

- **Required size:** 6.9" iPhone (1320 × 2868 portrait, or 1290 × 2796). App Store Connect scales them down for smaller iPhones.
- **iPad:** none needed, because store builds set `supportsTablet: false`.
- **Count:** 3–10. Suggested set: the join screen, narration playing with group/scene, voting, the cursor pad, an action notification on the lock screen.
- **What not to show:** script text or show media in a way the production doesn't want public.

### TestFlight

Builds from `eas submit` land in TestFlight. Internal testers (the team, up to 100) need no review. External testers require a short Beta App Review that uses the same notes.

## 5. Google Play Console

### Create app

| Field | Value |
| --- | --- |
| App name | Enter the Blackbox |
| Default language | English (United States) – en-US |
| App or game | **App** |
| Free or paid | **Free** |
| Category | **Entertainment** |
| Tags | Entertainment, Events (optional) |
| Contact email / website | production contact; show website |
| Privacy policy | the public URL from #4 |

### Main store listing

- **Short description** (80 characters max): `Your personal audio and controls for the live theatre show Enter the Blackbox.`
- **Full description:** reuse the App Store description from `store.config.json`.
- **Graphics:**
  - App icon: 512 × 512 PNG, 32-bit (from #203).
  - Feature graphic: 1024 × 500 JPG/PNG.
  - Phone screenshots: 2–8, 9:16 portrait, at least 1080 px on the short side.
- **Tablets:** no tablet screenshots needed. Android builds still install on tablets.

### App content (Policy → App content)

| Declaration | Answer |
| --- | --- |
| Privacy policy | URL from #4 |
| Ads | **No**, the app contains no ads |
| App access | **All or some functionality is restricted**: add the instructions from §4 Review notes (server, demo session, "enter any name"). No username/password. |
| Content rating (IARC) | Category **Entertainment** (closest IARC type for a performance companion). Violence, sex, language, controlled substances, gambling: **No**, pending the script check. Users can interact or exchange content: **No**, because participants only send votes and positions to the show; nothing is visible to other users as their content. Shares user location: **No**. Digital purchases: **No**. |
| Target audience and content | **18 and over** (see §2). Not designed for children. |
| News app | **No** |
| Government app | **No** |
| Financial features | **None** |
| Health | **No health features** |
| Data safety | See below |
| Advertising ID | **No**, the app doesn't use the advertising ID (Android 13+ declaration) |
| Foreground service permissions | See below |

### Data safety

- **Does the app collect or share required data types?** Yes, collects; shares none.
- **Is all user data encrypted in transit?** Yes. Store builds use HTTPS/WSS only.
- **Can users request deletion?** Answer according to #4. If the production offers deletion by email, say Yes and name the contact in the privacy policy.
- **Account creation?** None, so the data deletion URL requirement doesn't apply.

| Data type (Play category) | Collected | Shared | Processed ephemerally | Required/optional | Purpose |
| --- | --- | --- | --- | --- | --- |
| Personal info → **Name** | Yes | No | No | Required | App functionality |
| App activity → **App interactions** (votes, choices, reactions, cursor positions) | Yes | No | No | Required | App functionality |
| Device or other IDs → **Device or other IDs** (participant lease) | Yes | No | No | Required | App functionality |

Not collected: location, contacts, photos/files, audio recordings (`RECORD_AUDIO` is explicitly removed), health, financial, messages, web history, crash logs, performance diagnostics (timing reports are in-memory only).

### Foreground service declaration

The app declares `FOREGROUND_SERVICE_MEDIA_PLAYBACK` (scheduler plugin, Media3 `MediaSessionService`). Play asks for:

- **Type:** Media playback.
- **Description:** "During a live performance, the app plays the participant's show narration and music through headphones on a shared clock, including while the screen is locked and the phone is in a pocket. The participant starts it by joining a performance; it stops when they leave or the show ends. A media notification with play/pause is shown throughout."
- **Video:** a short screen recording showing join → audio playing → lock screen with media notification → leave. Upload it unlisted (e.g. YouTube) and paste the link.

### Permissions in the store build

INTERNET, ACCESS_NETWORK_STATE (expo-updates), FOREGROUND_SERVICE, FOREGROUND_SERVICE_MEDIA_PLAYBACK and WAKE_LOCK (scheduler), VIBRATE, POST_NOTIFICATIONS (requested at Join) and RECEIVE_BOOT_COMPLETED (expo-notifications). None of these are restricted or sensitive permissions needing a separate Play declaration beyond the foreground service. RECORD_AUDIO, READ/WRITE_EXTERNAL_STORAGE and SYSTEM_ALERT_WINDOW are removed from store builds.

### Testing and rollout

1. **Internal testing:** up to 100 testers, available within minutes, no review. Use this for the venue fleet and rehearsals.
2. **Closed testing:** new personal developer accounts must run a closed test with at least 12 testers for 14 days before production access is granted. Organisation accounts don't need this.
3. **Production:** staged rollout is optional; review typically takes a few days for a first release.

## 6. Before pressing Submit

- [ ] #203 icon/splash merged; production build made after it
- [ ] #204 store join screen merged; screenshots taken from it
- [ ] #205 demo session running and the review notes filled in
- [ ] #4 privacy policy published at a public URL, with the URL in both stores
- [ ] `REPLACE_WITH_*` placeholders in `store.config.json` filled in, `eas metadata:lint` passes
- [ ] Age rating answers checked against the script
- [ ] Physical acceptance checklist in [native-player.md](native-player.md) passed on a production build from TestFlight / internal testing
