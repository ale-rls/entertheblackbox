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
  whenever wording or media changes. The default is the show's Drive **VOX
  folder** (`1tUTMifql-T_wOdTxuTP8T2NrEuyGc6Rx`,
  https://drive.google.com/drive/folders/1tUTMifql-T_wOdTxuTP8T2NrEuyGc6Rx):
  look there first (files newer than the baseline draft) and only ask when the
  user names another folder. Voice cues that are still
  missing are generated, not left as gaps (step 3a); never make a silent
  text-only swap.
- **Delivery** — a new backup file, a new Studio draft in PocketBase, or both.
- **Lighting** — **paused** (director decision 2026-11-20): don't ask for
  `lighting.json`; see step 3b.

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

## 3b. Light cues

> **Paused for now (director decision 2026-11-20).** Skip this step: don't ask
> for `lighting.json`, don't write `light-mapping.json` or run `light_plan.py`,
> and don't add or remove `licht-…` outgoing cues. Still lay out vote zones and
> monitor order as the script's field grids say (Mn shows answer N), so lights
> can be added later. In the report, say that light cues were not applied. The
> procedure below stays for when lights are switched back on.

When the parsed script has `lightCues` or `lightColours` (the notation is in
[docs/script-light-cues.md](../../../docs/script-light-cues.md)):

1. **Mapping.** Write `<scratchpad>/light-mapping.json`: `scenes` maps each
   script scene ID with a light cue to its phase ID (the same matching as for
   text). A script scene with no phase of its own runs inside a longer one
   (e.g. a question round in one video scene): map it to
   `{"phase": <phase ID>, "at": <seconds>}`, the start time of the monitor cue
   where its question appears (`monitorCues`, `startMs` / 1000; check the
   monitor images or texts against the script's `[Monitore …]` line, in
   order). `winners` maps each vote-winner scene to `{answer ID: lamp}`.
   Take the answer IDs from the phase's field (`q1`–`q4`, `min`/`max`, zone IDs)
   and find the monitor field (M1–M4) each answer is shown on; field Mn is lit
   by lamp `Ln`. Monitor N shows the Nth answer in outcome order (zone order);
   confirm with the script's field grid (`fieldGrids`: the texts per field)
   and the zone labels. Ask if a match is not clear; never guess.
   Two `set` cues in one script scene (one at its start, one at its end)
   land on the same moment: give the later one its own key in a run copy of
   `parsed.json` and map it to the next phase or a time, and say so.
2. **Generate:**

   ```bash
   python3 -I .claude/skills/update-show/light_plan.py <parsed.json> <current lighting.json> <scratchpad>/light-mapping.json <scratchpad>/light
   ```

   It writes `lighting.json` (the venue part and hand-made entries kept; the
   script's colours, one `licht-…` look per distinct cue, a scene trigger per
   phase with its look or timed steps, and the vote results rebuilt) and
   `light-plan.md`. Exit code 1 means
   problems; they are listed in `light-plan.md`. Fix the mapping, or report
   script problems (unknown lamp or colour) instead of working around them.
3. **Nothing in the draft.** The bridge reacts to scene IDs, so the draft
   needs no light cue names. If a phase still has `licht-…` entries in
   `outgoingCues` from an earlier run, remove them (keep every other cue name).
4. **Check the light file** with the bridge itself:
   `pnpm eos-bridge --config <scratchpad>/light/lighting.json --list`.

## 3c. Monitor cues (M1–M4)

Monitor cues live on each phase as `monitorCues: { M1: [...], …, M4: [...] }`
in `draft.project.scenario.phases`; editing them needs no canvas change. The
schema is `packages/scenario/src/monitors.ts`, the rendering
`apps/display/src/monitors/` (`answerColor.ts`, `countdown.ts`), the rules
[docs/monitor-displays.md](../../../docs/monitor-displays.md).

- **Text, not images.** Use `text` cues. Don't render text to PNGs: image cues
  can't count down and drift from the script. Replace existing text PNGs
  (open them to read the text) with text cues at the same times.
- **Colour.** Set `color` (`#rrggbb`) on text, placeholder, vote-result and
  image-caption cues whenever the script names a colour. Use the presets
  (`MONITOR_TEXT_COLOR_PRESETS`): white `#ffffff`, orange `#f76b15`, green
  `#30a46c`, blue `#3e63dd`, red `#e5484d`, yellow `#f5d90a`. In a vote scene,
  set white explicitly (`#ffffff`), or the answer colours apply. Also set the
  colour on vote scenes' cues when the script gives a section-wide rule, so
  it doesn't depend on the vote's settings. Leave vote-result cues without
  `color`, so they show the winner's colour, unless the script says otherwise.
- **Field order.** Write each field's text as the script's field grid gives
  it (M1–M4), never derived from "low/high" ends of a scale; the grids don't
  always put the same end on the same monitor.
- **"then:" steps.** Question on all four first (each monitor in its own
  colour), then the split at the moment the headphones name the scale.
- **Times.** `startMs` on the phase clock, strictly increasing per monitor.
  Take question/scale moments from the headphone audio with STT word
  timestamps (`scribe_v1`, `timestamps_granularity=word`). Keep a cue
  sequence continuous across consecutive phases: repeat the current screen at
  `@0` of the next phase rather than leaving it black.
- **Countdowns.** `countdownSeconds: N` counts the last N s before the cue
  ends; the end is the next cue's `startMs` or the cue's `durationMs`. Only
  text, vote-result and placeholder cues count down. For a full vote
  countdown (e.g. 30 s), add a cue at `closeAtMs − N·1000` with
  `countdownSeconds: N` and a following cue at `closeAtMs` with the same text
  (better than `durationMs`, which leaves the screen black). "With small
  text" is `countdownShowsText: true`. Without a cue countdown, the monitors
  show only the last 5 s of vote and scene countdowns.
- **Verify by simulation.** Besides step 4, run the display's own functions
  under `tsx` on the compiled scenario: `activeMonitorCue`
  (`packages/scenario`), `monitorTextColor` (`answerColor.ts`) and
  `monitorCueCountdown` (`countdown.ts`). Print M1–M4 text, colour and
  countdown at key moments (each question, each split, the end of each
  countdown) and check them against the script's grids. Also check that
  every `color` survives the compile: an older checkout's schema silently
  drops unknown fields, so validate with code that has the feature.

## 4. Validate

Run every step of "Validate the saved output" in docs/updating-shows.md against the
final JSON. Done when each step has a recorded pass/fail with the command that
produced it.

## 5. Deliver

**Re-check the script first, every time.** When the change comes from a Google
Doc, call `get_file_metadata` on it again right before saving the draft,
uploading media or writing the final backup. Compare its `modifiedTime` with
the revision you worked from. If it changed: export the HTML again, parse it,
diff it against the revision you used, and apply the differences (generate new
voice cues per step 3a, then validate again) before delivering. Repeat until
the doc is unchanged since your last fetch. Report the `modifiedTime` the
delivered draft matches. Tested 2026-11-17: the script changed twice while the
update was being built.

**Backup file:** write `<name> <short-change-label>.studio-backup.json` next to the
baseline. The original stays untouched.

**PocketBase draft:** this writes to a live Studio, so first confirm the target
URL and the new draft name with the user. Then save the result the way Studio's
**Duplicate** does: a fresh `crypto.randomUUID()` id, a distinct name,
`updatedAt: Date.now()`, via `PocketbaseDraftDatabase.put()`. The baseline draft
keeps its id and content. Right before `put()`, list the drafts again: if the
baseline's `updatedAt` changed or a newer draft appeared, stop and diff them.
Viewport-only edits are harmless. Otherwise ask whether to rebuild on the
newer draft (re-run the edit, then step 4 again). Tested 2026-11-20: a
teammate saved a newer draft while the update was being built. Read the new draft back with `list()`, round-trip it
through `exportBackup()` → `importBackup()` (which runs
`compileStudioGraph(draft.project)`), and diff it
against the local result.

New media goes into the PocketBase `media` collection: have the operator add it in
Studio's **Media library**, or upload it with `PocketbaseMediaLibrary.upload()`
from `apps/studio/src/media/pocketbase-media.ts` after the same confirmation.
Generated voice cues are uploaded there and to the Drive VOX folder (step 3a).
Studio refreshes durations from that library when the draft opens.

**Light file** (only when step 3b is active again): the bridge reads `lighting.json` from the repo folder on the
show laptop and reloads it on save. If you run on that laptop, show the diff
against the current file and copy it there after the user confirms. Otherwise,
give the user the path of the generated file. It is show content: never commit
it.

**Publishing stays with the operator:** they open the new draft in Studio, resolve
Diagnostics and use **Publish** (operator sign-in; see docs/publishing.md).

## 6. Report

- Baseline revision and where the result lives (file path and/or draft name + id).
- The script revision the result matches (doc title + `modifiedTime` from the
  final re-check in step 5).
- The change list by phase ID, plus anything requested but not done.
- Generated voice cues (file, scene, length, verification result, Drive and
  library upload), recordings still missing, text-only substitutes,
  disconnected scenes.
- Light: paused (step 3b); say that light cues were not applied.
- Each validation step and its result, kept apart from what still needs venue
  rehearsal.
- Operator next steps: media to upload, draft to open, publish.
