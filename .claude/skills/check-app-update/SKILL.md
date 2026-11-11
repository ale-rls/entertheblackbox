---
name: check-app-update
description: Check whether the Android preview app needs an EAS Update or a new EAS build — compares the latest preview build and update with main and with the show live on bb-frontend, then asks before shipping. Use when asked if the app is up to date, needs an update, or is compatible with the current show.
---

# Check the Android preview app

Scope: **Android** and the **preview** channel/branch/profile only. Steps 1–4
only read; nothing is published or built until the user picks an option in
step 5. Run the EAS commands from `apps/native` with `npx eas-cli`.

Background: [docs/native-player.md](../../../docs/native-player.md). The app uses
`runtimeVersion: { policy: 'fingerprint' }`. An installed build runs the newest
preview update whose `runtimeVersion` equals its own and ignores every other
update.

## 1. Latest preview build

```bash
npx eas-cli build:list --platform android --channel preview --status finished --limit 1 --json --non-interactive
```

Record `id`, `runtimeVersion`, `gitCommitHash`, `appVersion`/`appBuildVersion`,
`completedAt` and `artifacts.buildUrl` (the APK). Done when you have the build's
runtime and commit.

## 2. Latest preview update

```bash
npx eas-cli update:list --branch preview --limit 25 --json --non-interactive
```

Entries are update groups, newest first. Take the newest entry whose `platforms`
includes `android` **and** whose `runtimeVersion` equals the build's: this is the
**live update**, the code that phones running the step-1 build use after
**Check & install app update**. Get its commit and time:

```bash
npx eas-cli update:view <group> --json   # this command rejects --non-interactive
```

Also note any newer Android update with a different runtime: phones ignore it,
and that is worth saying. With no matching update, the build's own commit is
the live code. Done when you know the live commit.

## 3. Compare with main

Compare against `origin/main` (`git fetch origin main`), never a feature branch.
Work in a clean checkout of it with dependencies installed, such as a detached
worktree under `.worktrees/`.

**Runtime.** In `apps/native` of that checkout, compute the fingerprint the
preview profile would produce (preview sets `ALLOW_INSECURE_LAN=1`, never
`STORE_BUILD`):

```bash
ALLOW_INSECURE_LAN=1 npx expo-updates fingerprint:generate --platform android
```

Compare `hash` with the build's `runtimeVersion`. If they differ, show what
changed: `git diff --stat <build commit>..origin/main -- apps/native packages/expo-audio-scheduler pnpm-lock.yaml`.

**JavaScript.** List what the app bundle gained since the live commit:

```bash
git log --oneline <live commit>..origin/main -- apps/native packages/protocol packages/scenario packages/shared packages/show-content packages/expo-audio-scheduler
```

Ignore commits that only touch tests or docs.

Verdict:

- **EAS build**: main's fingerprint differs from the build's runtime. An update
  from main would get a new runtime, and installed APKs would ignore it.
- **EAS Update**: same fingerprint, and the bundle has changed since the live
  commit.
- **Up to date**: same fingerprint and no bundle changes.

Done when the verdict is backed by the hash comparison and the commit list.

## 4. Compatibility with the live show

Check the live code from step 2 against `https://bb-frontend.enabler.space`.
Where the verdict is not "up to date", check main as well, so the user sees
whether shipping fixes or breaks anything. Run each check and report it as
**ok**, **mismatch** or **unchecked (reason)**:

1. **Server state.** `GET /api/status`: `ready`, `scenarioVersion`,
   `showLifecycle`, `buildVersion`. If `showLifecycle` is not `idle`, a show is
   running: testers must not update until it ends.
2. **Build version.** `npx eas-cli env:list --environment preview`: compare
   `EXPO_PUBLIC_SERVER_BUILD_VERSION` with the server's `buildVersion`. A
   mismatch makes the app show a reload notice on every join (`reload`
   handling in `apps/native/src/App.tsx`). This is a soft issue, not a block.
3. **Native show content.** `GET /media/native-shows/channels/rehearsal.json` and
   `production.json`. `format` must equal the `format` literal in
   `showManifestSchema` at the checked commit
   (`git show <commit>:packages/show-content/src/index.ts`), or the app rejects
   the show list. `scenarioVersion` should equal the server's; if it does not,
   the show needs republishing, not the app.
4. **Required capabilities.** The server refuses joins with `update_required`
   when the show needs a capability the app does not send. The rule is
   `requiredCapabilities` in `apps/server/src/server.ts`. The app's list is
   `capabilities:` in `apps/native/src/App.tsx` at the checked commit, and
   `admission-programs-v1` is sent only when the build's native module supports
   it. Reading the scenario needs an operator token: ask the user for the
   `admin-token` value from Admin's localStorage on bb-frontend, then
   `curl -H "Authorization: Bearer $TOKEN" https://bb-frontend.enabler.space/api/admin/shows/latest`.
   Use `.scenario` only if its `version` equals the live `scenarioVersion`.
   Without a token or a matching version, report this check as unchecked. The
   token is a credential: keep it out of files, commits and the report.
5. **Protocol.** Compare `PROTOCOL_VERSION` in `packages/protocol/src/messages.ts`
   at the checked commit with `origin/main`. The server reports no commit, so
   say this assumes the server is deployed from main.

Done when all five checks have a result.

## 5. Report and ask

Report in one short table: build (version, runtime, commit, date, APK link),
live update (message, runtime, commit, date), main (fingerprint, bundle
commits), the five compatibility checks, and the verdict. Name the delivery
path explicitly as **EAS Update** or **EAS build**.

If the verdict is up to date and every check is ok, stop there. Otherwise use
one `AskUserQuestion` round. Offer only the paths the verdict allows, plus
"Do nothing":

- **EAS Update (preview, Android).** Free. Testers leave the show and tap
  **Check & install app update**. From `apps/native` in the clean main checkout:
  `npx eas-cli update --channel preview --environment preview --platform android --message '<summary> (main <short sha>)'`.
  Avoid `pnpm update:preview`, because it also publishes iOS.
- **EAS build (preview, Android).** Costs build credits and takes about ten
  minutes. Every tester installs the new APK from the build link. From
  `apps/native` in the clean main checkout:
  `npx eas-cli build --profile preview --platform android --non-interactive`.
  The new build already contains main, so no update needs to follow it.

Run the chosen command only after the user picks it. Before saying it is done,
confirm the result with step 1 or step 2 again.
