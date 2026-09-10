# Agent workflow (issue + PR based)

How parallel agent threads work on this repo without running over each other.
Inherited from the smartphonecracy production and adapted here.

## The rule that matters

**One issue, one branch, one PR, one thread.** Two threads must never be
editing the same working tree or the same branch. Everything below exists to
enforce that.

## Flow

1. **The backlog lives in GitHub issues.** One issue per unit of work. A thread
   picks up an issue (or a direct request from the director), never an
   unwritten task from another thread's notes or scrollback.

2. **Claim before you touch anything.** Assign the issue to yourself and add a
   comment saying you're starting. If an issue is already assigned or has an
   open PR, pick a different one — do not "help" with it.

3. **Each thread works on its own branch**, `claude/<topic>`, branched fresh
   from `main`. Never commit to `main` directly. Never push to a branch another
   thread opened. Branch isolation is what keeps concurrent threads safe; there
   is no locking mechanism beyond it.

4. **Every change lands via a PR** that states the verification actually run
   (see below) and closes its issue with `Closes #N`.

5. **The director merges.** Agents do not merge their own PRs.

## Verification is mandatory

A PR states exactly what was run and what the results were. "Should pass" is
not verification. Run before opening:

```bash
pnpm -r typecheck && pnpm -r test
```

Add end-to-end when the change touches runtime client or server behavior:

```bash
pnpm test:e2e
```

Add scenario validation when the change touches the scenario schema, a
scenario file, or a media manifest:

```bash
pnpm validate-scenario content/scenarios/dev.json --manifest content/media-manifest.json --media-dir content/media
```

## Conventions

- Work discovered mid-PR becomes a **new issue**, not silent scope expansion.
  If you find a second bug while fixing the first, file it and keep going.
- Director and policy decisions are recorded on the issue they affect, not
  buried in a PR thread where the next thread will not find them. Show-wide
  choices (durations, player cap, late join) belong in the scenario itself and
  its issue.
- No agent approves its own work where a review is owed. High-failure-potential
  changes — grant/lease crypto, vote and resolution correctness, admission
  security, runtime privacy, and any data-loss path — get a second pass from a
  different thread before merge.
- Show content (scenarios, media manifests, Studio drafts) follows the same
  flow as code. A scenario edit is a PR.
