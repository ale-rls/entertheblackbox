# Enter the Blackbox Studio

Runtime and authoring toolkit for a multiplayer theater piece.
Participant phones and tablets use the native iOS/Android app for downloaded audio and controls, or `/phone/` in a browser for voting without personal audio. Browser pages also render installation displays, M1–M4 monitors, Studio and Admin. TouchDesigner monitor helpers and browser audio delivery are retired. See docs/monitor-displays.md and docs/native-player.md.
Visitors use their native apps as cursors and collectively navigate questions and
video branches on a shared display. The server is authoritative; shows are
versioned scenario graphs, not hard-coded flows.

pnpm workspace, Node 22, pnpm 9.12.2. Apps in `apps/`, shared contracts in
`packages/`. Full orientation is in [README.md](README.md).

## Working here: one issue, one branch, one PR, one thread

Multiple agent threads run on this repo at once. Everything below exists so
they do not run over each other. Full version: [docs/agent-workflow.md](docs/agent-workflow.md).

1. **Take work from GitHub issues**, not from scrollback or another thread's
   notes. `gh issue list`.
2. **Claim it first.** Assign the issue to yourself and comment that you are
   starting. If it is already assigned or has an open PR, **pick a different
   one** — do not help with it.
3. **Branch from `main` as `claude/<topic>`.** Never commit to `main`. Never
   push to a branch another thread opened. Branch isolation is the only locking
   mechanism; there is nothing else protecting you.
4. **Land via PR**, stating the verification you actually ran, and close the
   issue with `Closes #N`.
5. **The director merges.** Do not merge your own PR.

Work discovered mid-PR becomes a **new issue**, not silent scope expansion.

## Verification is mandatory

State what you ran and what happened. "Should pass" is not verification.

```bash
pnpm -r typecheck && pnpm -r test
```

CI runs exactly that, plus the client builds. **There is no e2e job on
purpose** — the real check for this show is a tech rehearsal in the venue with
real phones on the real network, not headless Chromium against a fake scenario.
The Playwright specs are still in `tests/e2e` if you want them by hand:

```bash
pnpm pocketbase:download   # once
pnpm test:e2e
```

Several Studio specs are quarantined with `test.fixme` because they assert UI
text the Studio no longer renders. Do not treat a green e2e run as broad
coverage.

Touching the scenario schema, a scenario, or a media manifest:

```bash
pnpm validate-scenario content/scenarios/dev.json --manifest content/media-manifest.json --media-dir content/media
```

Note: one WebSocket ping-timing test in `apps/server` is flaky. Re-run before
assuming you broke it.

## No show content in the repo

This is a **public** repository. Media and script drafts stay out of git —
`.gitignore` covers `apps/display/src/assets/*.{mp4,mp3,mov,webm}`,
`content/media/*`, and `*Ablauf*.txt`. **Check what `git add -A` sweeps in**
before committing.

Generated code (`markerTracks.generated.ts`), design assets (fonts, logo), and
the dev/test scenario fixtures are not show content and stay tracked.

This repo was forked from the smartphonecracy production. The two shows are
independent and **do not share fixes** — do not propose cherry-picking between
them.

## Keep FEATURES.md current

[FEATURES.md](FEATURES.md) is a feature-by-feature inventory of what this repo
does and which app/service/package each feature depends on. When a PR adds,
removes, or moves a feature across apps, update the relevant entry in that
file as part of the same PR — don't let it drift into a stale snapshot.

## Gotchas

- **Attract clips must be named `attract-*.mp4`** in `apps/display/src/assets/`.
  Any other name is silently ignored by the glob in `IdleAttract.tsx`, and a
  bare `*.mp4` would pull in the rendered `credits.mp4`. First clip by filename
  is the A/hold clip. Empty playlist is a supported state: black on main/group idle displays,
  static centred QR on signage kiosks.
- **The display uses a service worker.** After rebuilding, hard-refresh or you
  will debug a stale bundle. README has the full recovery steps.
- **Studio publishes all show outputs together.** File → Publish show prepares
  content and selects the show; activation waits until a running show ends.
  See docs/publishing.md.
- **Rebuild clients after frontend changes** — the server serves built bundles,
  not a dev server.

## Authoring a show (scenario JSON or Studio backup)

These bit us when generating a show from a script. The generated backup itself
is show content: keep it out of git. The `/update-show` skill
(`.claude/skills/update-show/`) is the procedure for revising a show from a
backup file or a PocketBase Studio draft.
The `/check-script-updates` skill (`.claude/skills/check-script-updates/`)
checks a new script revision (Google Doc link) for cues the software can't do
yet and for text and recording changes, then hands text-only changes to
`/update-show`.

- **Always lay out show nodes left to right in playback order.** Entry is
  leftmost, later scenes advance right, parallel branches use separate rows,
  and their reunion sits to the right of every incoming branch. Do not wrap
  the sequence into a multi-column grid. Preserve explicit cycle back-edges.
  For layout-only edits, change document coordinates/order and viewport only;
  keep runtime phases, transitions, media and show identity unchanged. Follow
  [Updating shows](docs/updating-shows.md) and verify the final saved layout.
- **Scene IDs: letters, digits, `-`, `_` only, starting alphanumeric.** Studio's
  editor enforces this (`phaseIdError`, `apps/studio/src/inspector/model.ts`);
  the runtime schema and `pnpm validate-scenario` only require non-empty IDs.
  An ID with dots, spaces or umlauts passes validation and imports, then cannot
  be edited in Studio.
- **Verify generated backups with Studio's own code**, not only
  `validate-scenario`: run `importBackup` + `compileStudioGraph`
  (`apps/studio/src/io.ts`) under `tsx`, plus the ID rule above.
- **Late joiners never enter a group path.** Path rosters are fixed when a
  group-branch's selection closes (`startGroupPaths`); phones joining later wait
  silently until the reunion. Anything an audience that joins mid-show must take
  part in (e.g. scanning a QR shown in a video) belongs on the shared timeline.
- **The main display is black during a group-branch's selection and paths.** A
  path's media shows only on `/display/?group=<id>`; one projector cannot follow
  both the main and a group display.
- **Membership-only split:** a group-branch whose branches have no `next` just
  labels participants and continues at its `next`. Shared scenes can then give
  each group different headphone audio via `phoneAudioByGroup`. A participant
  has one group at a time, so a later split replaces the label: re-label
  afterwards if later scenes target the earlier group.
- **Self-select splits wait for every phone in the cohort.** If someone does not
  choose, the operator must start the group paths in Admin. There is no
  "first N to press" rule; operators move people during the window instead.
- **Curtain-light polygon zones need an unlit gap.** Zones that tile the whole
  screen leave no neutral entry point and fail validation.
- **Studio rewrites video and still+MP3 durations from library media** on open:
  `expectedDurationMs` = media length + `tailDurationMs`. You cannot trim a video
  by shortening `expectedDurationMs`; use `tailDurationMs` to hold longer.
- **Narration scenes show their text and the corner join QR on the main
  display; video scenes hide the QR.** For a black, silent operator hold use a
  still image + a short silent MP3 with `tailDurationMs` and `allowSkip`.

## Native app update preference

Director decision (2026-10-28): **production EAS Update is the main delivery
path for compatible native-app JavaScript/UI fixes.** Use the `production`
channel and `production` EAS environment; do not default to preview updates
or rebuilding store binaries for compatible changes.

From `apps/native`, publish an authorized, verified release with
`pnpm update:production --message 'Describe the change'`. Production builds
subscribe to that channel. Users leave the show and tap **Check & install app
update**; preserve explicit update checks and never reload during a performance.

Native modules, Expo SDK, permissions, native configuration, or an incompatible
runtime fingerprint still require a new production build and installation.
Never override the fingerprint to force compatibility. Show content publishing
and server deployment remain separate from app updates. Preparing a channel is
not itself a request to publish an OTA release. See [the native player guide](docs/native-player.md).

The `/check-app-update` skill (`.claude/skills/check-app-update/`) checks whether
the **Android preview** app needs an EAS Update or a new EAS build, compared
with main and the live show, and asks before shipping either.
