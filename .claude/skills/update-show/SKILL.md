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
  whenever wording or media changes. Ask explicitly. Voice cues that are still
  missing are generated, not left as gaps (step 3a); never make a silent
  text-only swap.
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

## 3a. Generate missing voice cues

**Always generate** a voice cue whose final (black or purple) script text has no
matching recording. Never generate red or dark-red ("VORSCHLAG") text.

1. **Check existing files first.** Files dropped in the VOX folder may be old
   takes saved under new names. Compare their SHA-256 with the library hashes;
   for any that differ from what the show plays, transcribe both (step 4 below)
   and keep the one that matches the script. Tested 2026-11-17: three
   "new" K3 files were older takes with outdated wording.
2. **Text.** Take the scene's runs from the parsed script. Keep the ElevenLabs
   delivery tags (`[amused]`, `[dryly]`, `[short pause]`, …; lowercase words
   in brackets) where they are. Drop stage directions and code notes
   (`[Regie/Code …]`, `[Pause / Musikbett …]`, highlighted `Code` runs) and
   speaker labels (`VORHANG:`, `Kopfhörer:`). Restore spaces where runs join
   (`gelernt.Wer` → `gelernt. Wer`) and lowercase stray tags (`[Pause]`).
3. **Generate** with the ElevenLabs API (`ELEVENLABS_API_KEY` in the
   environment): voice **Enniah** `baebHbhnJ9ASPPp11oEY`, `model_id:
   "eleven_v3"`, `language_code: "de"`, `output_format=mp3_44100_128`, default
   voice settings. v3 follows the delivery tags; it does not speak them.
4. **Verify every take** with speech-to-text (`/v1/speech-to-text`,
   `model_id: "scribe_v1"`, `language_code: "deu"`). Compare the words with
   the script after stripping tags. Regenerate takes with real slips; a
   difference that repeats in every take is usually the transcriber. Emotion
   can't be verified this way. Say so in the report.
5. **Multi-block cues** (e.g. the K0.0.2 waiting monologue with
   "Pause / Musikbett 45–90 Sekunden") become **one file**: generate each
   block, then join them with real silence (`ffmpeg` concat with
   `anullsrc`). Use a fixed length for each range and report it.
6. **Name** files `<sceneId>.v<N>.mp3`, matching the script heading's version.
   If that name already exists in the library or the VOX folder for a
   different text, use the next free version and report it.
7. **Upload** each new file to the PocketBase media library and to the
   **Drive VOX folder** (`1tUTMifql-T_wOdTxuTP8T2NrEuyGc6Rx`) with the Drive
   connector's `create_file` (`disableConversionToGoogleType: true`). The
   connector refuses payloads over 10 MB (base64), so re-encode files over
   ~7 MB as VBR (`-c:a libmp3lame -q:a 2`; long pauses shrink to almost
   nothing) **before** uploading anywhere. The library, the draft manifest
   and Drive must hold the same bytes (same hash).

From Node, `PocketbaseMediaLibrary.upload()` can't measure durations (it uses a
browser media element). Create the `media` record directly with `src`,
`bytes`, `hash`, `durationMs` (from `ffprobe`) and `file`.

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
Generated voice cues are uploaded there and to the Drive VOX folder (step 3a).
Studio refreshes durations from that library when the draft opens.

**Publishing stays with the operator:** they open the new draft in Studio, resolve
Diagnostics and use **Publish** (operator sign-in; see docs/publishing.md).

## 6. Report

- Baseline revision and where the result lives (file path and/or draft name + id).
- The change list by phase ID, plus anything requested but not done.
- Generated voice cues (file, scene, length, verification result, Drive and
  library upload), recordings still missing, text-only substitutes,
  disconnected scenes.
- Each validation step and its result, kept apart from what still needs venue
  rehearsal.
- Operator next steps: media to upload, draft to open, publish.
