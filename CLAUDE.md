# Enter the Blackbox Studio

Runtime and authoring toolkit for a browser-based, multiplayer theater piece.
Visitors use their phones as cursors and collectively navigate questions and
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

Several of those specs are quarantined with `test.fixme` because they assert
Studio text that no longer exists (#9). Do not treat a green e2e run as broad
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

## Gotchas

- **Attract clips must be named `attract-*.mp4`** in `apps/display/src/assets/`.
  Any other name is silently ignored by the glob in `IdleAttract.tsx`, and a
  bare `*.mp4` would pull in the rendered `credits.mp4`. First clip by filename
  is the A/hold clip. Empty playlist is a supported state: static centred QR.
- **The display uses a service worker.** After rebuilding, hard-refresh or you
  will debug a stale bundle. README has the full recovery steps.
- **Studio does not publish to a running server.** Restarting the server with
  `SCENARIO_PATH`/`MEDIA_MANIFEST_PATH` is what selects a show locally.
- **Rebuild clients after frontend changes** — the server serves built bundles,
  not a dev server.
