---
name: update-show
description: Update a show from a script revision, director notes or a layout fix — edits a Studio backup file or a Studio draft in PocketBase. Use when asked to update, revise or re-lay-out a show.
---

# Update a show

The rules live in [docs/updating-shows.md](../../../docs/updating-shows.md) and the
"Authoring a show" gotchas in [CLAUDE.md](../../../CLAUDE.md). Read both in full
before step 3. This skill is the procedure around them.

Every show file is **show content**: keep baselines, scripts, media and results in
the scratchpad or a location the user names, never in this repository.

## 1. Collect the inputs

Ask for whatever is missing, in one `AskUserQuestion` round, before opening or
editing anything:

- **Baseline** — one of:
  - a Studio backup file (`*.studio-backup.json`), or
  - a PocketBase URL plus the draft to start from (name or `draftId`). With only
    a URL, list the drafts (step 2) and ask which one.
- **The change** — a script revision (file path), director notes, or an explicit
  change list. If both a script and notes are given, ask which wins on conflict
  (default: the user's notes).
- **Media** — the folder holding new or re-recorded videos, images and MP3s,
  whenever wording or media changes. Ask explicitly; a changed line of narration
  without its recording is a reported gap, never a silent text-only swap.
- **Delivery** — a new backup file, a new Studio draft in PocketBase, or both.

Done when the baseline is pinned to an exact revision (`draftId` + `updatedAt`, or
file path + SHA-256) and every requested change has a source.

## 2. Load and preserve the baseline

- **Backup file:** `importBackup()` from `apps/studio/src/io.ts`.
- **PocketBase:** `new PocketbaseDraftDatabase(url)` from
  `apps/studio/src/pocketbase-drafts.ts`; `list()` for current drafts,
  `revisions(draftId)` for history. The `studio_drafts` and `media` collections
  are open, so no credentials are needed to read or write them.

Put scripts in `apps/studio/` and run them there with `pnpm exec tsx` so the
workspace packages resolve; delete them afterwards. Before changing anything,
write the untouched baseline to the scratchpad with `exportBackup()` as
`<name>.baseline.studio-backup.json`. Every later diff is against this file.

## 3. Apply the change

Follow "Preserve the intended show" and "Always arrange nodes left to right" in
docs/updating-shows.md. Edit only what the inputs ask for; list every change as
you make it, keyed by phase ID.

## 4. Validate

Run every step of "Validate the saved output" in docs/updating-shows.md against the
final JSON. Done when each step has a recorded pass/fail with the command that
produced it.

## 5. Deliver

**Backup file:** write `<name> <short-change-label>.studio-backup.json` next to the
baseline. The original stays untouched.

**PocketBase draft:** this writes to a live Studio, so first confirm the target
URL and the new draft name with the user. Then save the result the way Studio's
**Duplicate** does: a fresh `crypto.randomUUID()` id, a distinct name,
`updatedAt: Date.now()`, via `PocketbaseDraftDatabase.put()`. The baseline draft
keeps its id and content. Read the new draft back with `list()`, round-trip it
through `exportBackup()` → `importBackup()` (which runs
`compileStudioGraph(draft.project)`), and diff it
against the local result.

New media goes into the PocketBase `media` collection: have the operator add it in
Studio's **Media library**, or upload it with `PocketbaseMediaLibrary.upload()`
from `apps/studio/src/media/pocketbase-media.ts` after the same confirmation.
Studio refreshes durations from that library when the draft opens.

**Publishing stays with the operator:** they open the new draft in Studio, resolve
Diagnostics and use **Publish** (operator sign-in; see docs/publishing.md).

## 6. Report

- Baseline revision and where the result lives (file path and/or draft name + id).
- The change list by phase ID, plus anything requested but not done.
- Missing recordings, text-only substitutes, disconnected scenes.
- Each validation step and its result, kept apart from what still needs venue
  rehearsal.
- Operator next steps: media to upload, draft to open, publish.
